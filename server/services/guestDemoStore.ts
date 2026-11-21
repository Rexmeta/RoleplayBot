import { and, eq, lt, sql } from "drizzle-orm";
import { systemSettings } from "@shared/schema";
import type { GuestMessage, GuestScenario } from "@shared/guestDemo";
import type { ConversationLanguage } from "@shared/conversationLanguage";
import { db } from "../storage/db";

export const GUEST_SESSION_MS = 24 * 60 * 60 * 1000;
const SESSION = "guest_demo_session";
const BUDGET = "guest_demo_budget";

export interface GuestSession {
  expiresAt: number;
  language: ConversationLanguage;
  attempts: number;
  messages: GuestMessage[];
  progress?: { scenario: GuestScenario; actorId: string; turnLimit: number };
  pending?: { token: string; until: number };
}

export interface GuestDemoStore {
  read(key: string): Promise<GuestSession | null>;
  create(key: string, session: GuestSession): Promise<boolean>;
  mutate<T>(key: string, update: (session: GuestSession) => T): Promise<T | null>;
  allowTurn(): Promise<boolean>;
}

function field(category: string, key: string) {
  return and(eq(systemSettings.category, category), eq(systemSettings.key, key));
}

export const guestDemoStore: GuestDemoStore = {
  async read(key) {
    const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(field(SESSION, key));
    const session: GuestSession | null = row ? JSON.parse(row.value) : null;
    return session && session.expiresAt > Date.now() ? session : null;
  },

  async create(key, session) {
    return db.transaction(async tx => {
      if (!await consumeBudget(tx, "start", 5 * 60_000, 150)) return false;
      // Expire only records owned by this feature. updatedAt is set to the
      // absolute expiry and is deliberately not extended by mutations.
      await tx.delete(systemSettings).where(and(
        eq(systemSettings.category, SESSION), lt(systemSettings.updatedAt, new Date()),
      ));
      await tx.insert(systemSettings).values({
        category: SESSION, key, value: JSON.stringify(session), updatedAt: new Date(session.expiresAt),
      });
      return true;
    });
  },

  async mutate(key, update) {
    return db.transaction(async tx => {
      const where = field(SESSION, key);
      const [row] = await tx.select({ value: systemSettings.value }).from(systemSettings).where(where).for("update");
      if (!row) return null;
      const session: GuestSession = JSON.parse(row.value);
      if (session.expiresAt <= Date.now()) return null;
      const result = update(session);
      await tx.update(systemSettings).set({ value: JSON.stringify(session) }).where(where);
      return result;
    });
  },

  allowTurn() {
    return db.transaction(tx => consumeBudget(tx, "turn", 5 * 60_000, 240));
  },
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function consumeBudget(tx: Transaction, key: string, windowMs: number, limit: number) {
  // The gate is shared across workers, including visitors with no cookie yet.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${BUDGET + ":" + key}))`);
  const where = field(BUDGET, key);
  const [row] = await tx.select({ value: systemSettings.value }).from(systemSettings).where(where);
  const window = Math.floor(Date.now() / windowMs);
  const saved: { window: number; count: number } | undefined = row && JSON.parse(row.value);
  const count = saved?.window === window ? saved.count : 0;
  if (count >= limit) return false;
  const value = JSON.stringify({ window, count: count + 1 });
  if (row) await tx.update(systemSettings).set({ value }).where(where);
  else await tx.insert(systemSettings).values({ category: BUDGET, key, value });
  return true;
}
