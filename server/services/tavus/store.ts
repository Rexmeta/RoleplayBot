import { and, asc, eq, like, sql } from "drizzle-orm";
import { db } from "../../storage/db";
import { systemSettings } from "../../../shared/schema/settings";

const CATEGORY = "tavus_runtime";

/** Existing settings storage, with cross-worker serialization; no new table or migration. */
export class TavusStore {
  async pendingSessions(): Promise<Array<{ userId: string; runId: string; state: string }>> {
    const rows = await db.select({ value: systemSettings.value }).from(systemSettings)
      .where(and(eq(systemSettings.category, CATEGORY), like(systemSettings.key, "run:%"),
        sql`(${systemSettings.value}::jsonb->>'state' IN ('creating', 'active', 'ending') OR
          (${systemSettings.value}::jsonb->>'state' = 'ended' AND
           ${systemSettings.value}::jsonb->>'transcriptState' IN ('pending', 'importing', 'failed') AND
           COALESCE((${systemSettings.value}::jsonb->>'transcriptRetryAt')::bigint, 0) <= ${Date.now()}))`))
      .orderBy(asc(systemSettings.updatedAt)).limit(20);
    return rows.map(row => JSON.parse(row.value));
  }

  async read<T>(key: string): Promise<T | null> {
    const [row] = await db.select().from(systemSettings)
      .where(and(eq(systemSettings.category, CATEGORY), eq(systemSettings.key, key)));
    return row ? JSON.parse(row.value) : null;
  }

  async mutate<T>(key: string, fn: (current: T | null) => T): Promise<T> {
    return db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"tavus:" + key}))`);
      const filter = and(eq(systemSettings.category, CATEGORY), eq(systemSettings.key, key));
      const [row] = await tx.select().from(systemSettings).where(filter);
      const next = fn(row ? JSON.parse(row.value) : null);
      if (row) await tx.update(systemSettings).set({ value: JSON.stringify(next), updatedAt: new Date() }).where(filter);
      else await tx.insert(systemSettings).values({ category: CATEGORY, key, value: JSON.stringify(next) });
      return next;
    });
  }
}
