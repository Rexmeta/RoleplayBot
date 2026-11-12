import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../storage/db";
import { systemSettings } from "../../../shared/schema/settings";
import { CultureError } from "./service";

const CATEGORY = "culture_experiment_lease";
export const EXPERIMENT_LEASE_MS = 120_000;
const HEARTBEAT_MS = 20_000;
const unavailable = () => new CultureError("실행 잠금을 확인할 수 없어 중단했습니다. 잠시 후 다시 시도해 주세요.", 503);
type LeaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Reuses the existing settings store (as Tavus does), without a migration.
 * All mutations serialize on one short transaction lock, including the two-slot cap.
 * DB time, not worker clocks, determines expiry. No memory/Redis fallback is safe here.
 */
export class ExperimentLeaseStore {
  private async mutate<T>(fn: (tx: LeaseTransaction, now: number) => Promise<T>): Promise<T> {
    return db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5000'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '5000'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${CATEGORY}))`);
      const result = await tx.execute(sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now`);
      return fn(tx, Number(result.rows[0].now));
    });
  }

  async acquire(userId: string, token: string): Promise<boolean> {
    return this.mutate(async (tx, now) => {
      const rows = await tx.select().from(systemSettings).where(eq(systemSettings.category, CATEGORY));
      const active = rows.filter(row => JSON.parse(row.value).expiresAt > now);
      if (active.some(row => row.key === userId) || active.length >= 2) return false;
      // Expired rows are bounded by concurrent work, not the number of past users.
      for (const row of rows.filter(row => !active.includes(row)))
        await tx.delete(systemSettings).where(eq(systemSettings.id, row.id));
      await tx.insert(systemSettings).values({
        category: CATEGORY, key: userId,
        value: JSON.stringify({ token, expiresAt: now + EXPERIMENT_LEASE_MS }),
      });
      return true;
    });
  }

  async renew(userId: string, token: string): Promise<boolean> {
    return this.mutate(async (tx, now) => {
      const filter = and(eq(systemSettings.category, CATEGORY), eq(systemSettings.key, userId));
      const [row] = await tx.select().from(systemSettings).where(filter);
      const lease = row && JSON.parse(row.value);
      // Never resurrect an expired lease, even if no replacement has claimed it yet.
      if (!lease || lease.token !== token || lease.expiresAt <= now) return false;
      await tx.update(systemSettings).set({
        value: JSON.stringify({ token, expiresAt: now + EXPERIMENT_LEASE_MS }), updatedAt: new Date(now),
      }).where(filter);
      return true;
    });
  }

  async release(userId: string, token: string): Promise<void> {
    await this.mutate(async tx => {
      const filter = and(eq(systemSettings.category, CATEGORY), eq(systemSettings.key, userId));
      const [row] = await tx.select().from(systemSettings).where(filter);
      if (row && JSON.parse(row.value).token === token)
        await tx.delete(systemSettings).where(filter);
    });
  }
}

const store = new ExperimentLeaseStore();

export async function withCultureExperimentLease<T>(
  userId: string,
  work: (signal: AbortSignal, assertActive: () => Promise<void>) => Promise<T>,
  options: { timeoutMs?: number; timeoutMessage?: string } = {},
): Promise<T> {
  const token = randomUUID();
  let acquired: boolean;
  try { acquired = await store.acquire(userId, token); }
  catch { throw unavailable(); }
  if (!acquired) throw new CultureError("이미 생성 또는 비교가 실행 중입니다. 완료 후 다시 시도해 주세요.", 409);

  const controller = new AbortController();
  let unsafeToRelease = false;
  let closed = false;
  let renewing = false;
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const stop = (error: Error) => {
    if (closed || controller.signal.aborted) return;
    unsafeToRelease = true;
    controller.abort(error);
    rejectStopped(error);
  };
  const assertActive = async () => {
    controller.signal.throwIfAborted();
    try {
      if (!await store.renew(userId, token)) throw unavailable();
    } catch {
      stop(unavailable());
    }
    controller.signal.throwIfAborted();
  };
  const heartbeat = setInterval(() => {
    if (renewing || closed) return;
    renewing = true;
    void assertActive().catch(() => {}).finally(() => { renewing = false; });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  const deadline = options.timeoutMs ? setTimeout(() => stop(new CultureError(
    options.timeoutMessage ?? "실행 시간이 초과되었습니다.", 504,
  )), options.timeoutMs) : undefined;
  try {
    return await Promise.race([
      (async () => {
        const result = await work(controller.signal, assertActive);
        await assertActive(); // Late/stale workers must not publish a successful response.
        return result;
      })(),
      stopped,
    ]);
  } finally {
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(deadline);
    controller.abort();
    // A timed-out SDK may ignore abort. Quarantine until expiry, never unlock
    // immediately or let a late worker delete a replacement owner's lease.
    if (!unsafeToRelease) {
      try { await store.release(userId, token); }
      catch { console.warn("[CultureExperiment] Lease release failed; awaiting expiry"); }
    }
  }
}
