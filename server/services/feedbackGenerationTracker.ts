import { db } from "../storage";
import { personaRuns } from "@shared/schema";
import { eq } from "drizzle-orm";

const generatingSet = new Set<string>();
const errorMap = new Map<string, string>();

const FEEDBACK_JOB_TTL_MS = 10 * 60 * 1000;

async function persistStatus(id: string, status: string | null): Promise<void> {
  try {
    await db.update(personaRuns)
      .set({
        feedbackStatus: status,
        feedbackJobStartedAt: status === "generating" ? new Date() : null,
      })
      .where(eq(personaRuns.id, id));
  } catch (err) {
    console.error(`[feedbackTracker] Failed to persist feedbackStatus for ${id}:`, err);
  }
}

export function markGenerating(id: string): void {
  generatingSet.add(id);
  errorMap.delete(id);
  persistStatus(id, "generating").catch(() => {});
}

export function isGenerating(id: string): boolean {
  return generatingSet.has(id);
}

export function unmarkGenerating(id: string): void {
  generatingSet.delete(id);
  persistStatus(id, null).catch(() => {});
}

export function markGenerationError(id: string, message: string): void {
  generatingSet.delete(id);
  errorMap.set(id, message);
  persistStatus(id, "error").catch(() => {});
}

export function getGenerationError(id: string): string | undefined {
  return errorMap.get(id);
}

export function clearGenerationError(id: string): void {
  errorMap.delete(id);
  persistStatus(id, null).catch(() => {});
}

export async function isGeneratingWithDbFallback(id: string): Promise<boolean> {
  if (generatingSet.has(id)) return true;

  try {
    const [row] = await db.select({
      feedbackStatus: personaRuns.feedbackStatus,
      feedbackJobStartedAt: personaRuns.feedbackJobStartedAt,
    }).from(personaRuns).where(eq(personaRuns.id, id));

    if (!row || row.feedbackStatus !== "generating") return false;

    const startedAt = row.feedbackJobStartedAt;
    if (!startedAt) return false;

    const age = Date.now() - new Date(startedAt).getTime();
    if (age > FEEDBACK_JOB_TTL_MS) {
      persistStatus(id, null).catch(() => {});
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[feedbackTracker] DB fallback check failed for ${id}:`, err);
    return false;
  }
}
