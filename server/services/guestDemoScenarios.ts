import { and, asc, eq, isNull } from "drizzle-orm";
import { scenarios } from "@shared/schema";
import type { GuestScenario } from "@shared/guestDemo";
import { db } from "../storage/db";

const eligible = and(eq(scenarios.isPublic, true), eq(scenarios.isDemo, true),
  eq(scenarios.isDeleted, false), eq(scenarios.storeListed, false), isNull(scenarios.storePackId));

const fields = {
  id: scenarios.id, title: scenarios.title, description: scenarios.description,
  context: scenarios.context, difficulty: scenarios.difficulty, objectives: scenarios.objectives,
  personas: scenarios.personas, targetTurns: scenarios.targetTurns,
};

function prepare(row: Pick<typeof scenarios.$inferSelect, keyof typeof fields>) {
  const actors = (row.personas ?? []).filter(actor => actor && typeof actor.id === "string" && actor.id && actor.name?.trim());
  const actor = actors.find(candidate => candidate.isPrimary) ?? actors[0];
  if (!actor) return null;
  const summary: GuestScenario = {
    id: row.id, title: row.title, description: row.description,
    situation: row.context?.situation || row.description,
    partner: { name: actor.name, role: [actor.department, actor.position].filter(Boolean).join(" · ") },
  };
  const turnLimit = Math.max(3, Math.min(row.targetTurns, 10));
  return { summary, actor, scenario: {
    id: row.id, title: row.title, description: row.description, difficulty: row.difficulty,
    context: row.context ?? undefined, objectives: row.objectives ?? undefined,
    personas: [actor], targetTurns: turnLimit,
  }, turnLimit };
}

export const guestDemoScenarios = {
  async list() {
    const rows = await db.select(fields).from(scenarios).where(eligible).orderBy(asc(scenarios.title), asc(scenarios.id));
    return rows.flatMap(row => {
      const prepared = prepare(row);
      return prepared ? [prepared.summary] : [];
    });
  },
  async get(id: string) {
    const [row] = await db.select(fields).from(scenarios).where(and(eligible, eq(scenarios.id, id))).limit(1);
    return row ? prepare(row) : null;
  },
};
