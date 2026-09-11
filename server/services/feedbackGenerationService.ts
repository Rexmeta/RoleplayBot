import { db } from "../storage";
import { agentSessions, conversations, personaRuns, feedbacks } from "@shared/schema";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { generateAndSaveFeedback, performStrategicAnalysis } from "../routes/routerHelpers";
import { randomUUID } from "crypto";
import { dispatchWebhook } from "./webhookDelivery";

export type FeedbackJobStatus = "queued" | "generating" | "completed" | "error" | "expired";
export const FEEDBACK_QUEUE_DEADLINE_MS = 30_000;
export const FEEDBACK_PROVIDER_DEADLINE_MS = 120_000;
export const FEEDBACK_OVERALL_DEADLINE_MS = 180_000;
const FEEDBACK_POSTPROCESS_LEASE_MS = 120_000;
const FEEDBACK_POSTPROCESS_RETRY_DELAYS_MS = [30_000, 5 * 60_000, 30 * 60_000] as const;
// Longer than the provider deadline, but short enough to reclaim a crashed
// worker before the original overall generation deadline.
const FEEDBACK_WORKER_LEASE_MS = 135_000;

export interface FeedbackJobInput {
  conversationId: string;
  conversation: any;
  scenario: any;
  persona: any;
  language?: "ko" | "en" | "ja" | "zh";
  evaluationHarnessSnapshot?: Record<string, any> | null;
  completionContext?: {
    kind: "agent";
    sessionId: string;
    agentKeyId: string;
  };
  onCompleted?: (feedback: any) => Promise<void> | void;
}

type PersistedFeedbackJobPayload = Omit<FeedbackJobInput, "onCompleted">;

function persistedPayload(input: FeedbackJobInput): PersistedFeedbackJobPayload {
  const { onCompleted: _onCompleted, ...payload } = input;
  return payload;
}

function timed<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      // A pending deadline must not keep a worker/process alive during shutdown.
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Queue once, then execute only after an atomic DB claim. */
export async function enqueueFeedbackJob(input: FeedbackJobInput): Promise<{ status: FeedbackJobStatus }> {
  const now = new Date();
  const expires = new Date(now.getTime() + FEEDBACK_OVERALL_DEADLINE_MS);
  const generationToken = randomUUID();
  const queued = await db.update(personaRuns).set({
    feedbackStatus: "queued",
    feedbackQueuedAt: now,
    feedbackJobStartedAt: null,
    feedbackCompletedAt: null,
    feedbackError: null,
    feedbackExpiresAt: expires,
    feedbackJobToken: generationToken,
    feedbackWorkerToken: null,
    feedbackJobPayload: persistedPayload(input),
    feedbackPostprocessAttempts: 0,
    feedbackPostprocessNextRetryAt: null,
  }).where(and(eq(personaRuns.id, input.conversationId),
    or(isNull(personaRuns.feedbackStatus), eq(personaRuns.feedbackStatus, "error"), eq(personaRuns.feedbackStatus, "expired"))))
    .returning({ status: personaRuns.feedbackStatus, token: personaRuns.feedbackJobToken });
  if (queued[0]?.token === generationToken) {
    setImmediate(() => runFeedbackJob(persistedPayload(input), generationToken, input.onCompleted).catch(() => {}));
    return { status: "queued" };
  }
  const [claimed] = await db.select({ status: personaRuns.feedbackStatus }).from(personaRuns)
    .where(eq(personaRuns.id, input.conversationId)).limit(1);
  return { status: (claimed?.status as FeedbackJobStatus) ?? "error" };
}

async function claimFeedbackJob(
  id: string,
  expectedToken: string,
): Promise<{ generationToken: string; workerToken: string } | null> {
  const now = new Date();
  const workerToken = randomUUID();
  const queueCutoff = new Date(now.getTime() - FEEDBACK_QUEUE_DEADLINE_MS);
  await db.update(personaRuns).set({ feedbackStatus: "expired", feedbackError: "feedback_queue_deadline_exceeded" })
    .where(and(eq(personaRuns.id, id), eq(personaRuns.feedbackStatus, "queued"),
      lt(personaRuns.feedbackQueuedAt, queueCutoff)));
  // A stale generating row is expired rather than run twice after a restart.
  await db.update(personaRuns).set({ feedbackStatus: "expired", feedbackError: "feedback_deadline_exceeded" })
    .where(and(eq(personaRuns.id, id), eq(personaRuns.feedbackStatus, "generating"),
      lt(personaRuns.feedbackExpiresAt, now)));
  const claimed = await db.update(personaRuns).set({
    feedbackStatus: "generating",
    feedbackJobStartedAt: now,
    feedbackWorkerToken: workerToken,
  }).where(and(eq(personaRuns.id, id), eq(personaRuns.feedbackStatus, "queued"),
    eq(personaRuns.feedbackJobToken, expectedToken),
    or(isNull(personaRuns.feedbackQueuedAt), gte(personaRuns.feedbackQueuedAt, queueCutoff)),
    or(isNull(personaRuns.feedbackExpiresAt), gte(personaRuns.feedbackExpiresAt, now))))
    .returning({ token: personaRuns.feedbackJobToken, workerToken: personaRuns.feedbackWorkerToken });
  return claimed[0]?.token && claimed[0]?.workerToken
    ? { generationToken: claimed[0].token, workerToken: claimed[0].workerToken }
    : null;
}

async function runFeedbackJob(
  input: PersistedFeedbackJobPayload,
  expectedToken: string,
  onCompleted?: FeedbackJobInput["onCompleted"],
): Promise<void> {
  const started = Date.now();
  const claim = await claimFeedbackJob(input.conversationId, expectedToken);
  if (!claim) return;
  const { generationToken: token, workerToken } = claim;
  try {
    const prepStarted = Date.now();
    console.info("[feedbackTiming]", { conversationId: input.conversationId, stage: "data_prep", durationMs: 0 });
    console.info("[feedbackTiming]", { conversationId: input.conversationId, stage: "provider_start", durationMs: Date.now() - prepStarted });
    const feedback = await timed(
      generateAndSaveFeedback(input.conversationId, input.conversation, input.scenario, input.persona,
        input.language ?? "ko", input.evaluationHarnessSnapshot,
        async () => {
          const [row] = await db.select({
            token: personaRuns.feedbackJobToken,
            workerToken: personaRuns.feedbackWorkerToken,
            status: personaRuns.feedbackStatus,
          })
            .from(personaRuns).where(eq(personaRuns.id, input.conversationId)).limit(1);
          return row?.status === "generating" &&
            row.token === token &&
            row.workerToken === workerToken;
        },
        async (payload: any, existingFeedback = false) => db.transaction(async (tx) => {
          const [claimed] = await tx.update(personaRuns).set({ feedbackStatus: "generating" })
            .where(and(
              eq(personaRuns.id, input.conversationId),
              eq(personaRuns.feedbackStatus, "generating"),
              eq(personaRuns.feedbackJobToken, token),
              eq(personaRuns.feedbackWorkerToken, workerToken),
            ))
            .returning({ id: personaRuns.id });
          if (!claimed) throw new Error("feedback_job_cancelled");
          const [saved] = existingFeedback
            ? [null]
            : await tx.insert(feedbacks).values(payload).onConflictDoNothing({ target: feedbacks.personaRunId }).returning();
          if (!saved) {
            const [existing] = await tx.select().from(feedbacks).where(eq(feedbacks.personaRunId, input.conversationId)).limit(1);
            if (!existing) throw new Error("feedback_insert_conflict_without_existing_row");
            const completed = await tx.update(personaRuns).set({
              feedbackStatus: "completed",
              feedbackCompletedAt: new Date(),
              feedbackPostprocessStatus: "queued",
              feedbackPostprocessStartedAt: null,
              feedbackPostprocessToken: null,
              ...(payload.reportStatus !== "insufficient_data" && Number.isFinite(payload.overallScore)
                ? { score: Math.round(payload.overallScore) }
                : {}),
            }).where(and(
              eq(personaRuns.id, input.conversationId),
              eq(personaRuns.feedbackStatus, "generating"),
              eq(personaRuns.feedbackJobToken, token),
              eq(personaRuns.feedbackWorkerToken, workerToken),
            )).returning({ id: personaRuns.id });
            if (completed.length === 0) throw new Error("feedback_job_cancelled");
            return existing;
          }
          await tx.update(personaRuns).set({
            feedbackStatus: "completed",
            feedbackCompletedAt: new Date(),
            feedbackError: null,
            feedbackPostprocessStatus: "queued",
            feedbackPostprocessStartedAt: null,
            feedbackPostprocessToken: null,
            ...(payload.reportStatus !== "insufficient_data" && Number.isFinite(payload.overallScore)
              ? { score: Math.round(payload.overallScore) }
              : {}),
          })
            .where(and(
              eq(personaRuns.id, input.conversationId),
              eq(personaRuns.feedbackStatus, "generating"),
              eq(personaRuns.feedbackJobToken, token),
              eq(personaRuns.feedbackWorkerToken, workerToken),
            ));
          return saved;
        }),
      ),
      FEEDBACK_PROVIDER_DEADLINE_MS,
      "feedback_provider",
    );
    console.info("[feedbackTiming]", { conversationId: input.conversationId, stage: "validation_segments", durationMs: Date.now() - prepStarted });
    console.info("[feedbackTiming]", { conversationId: input.conversationId, stage: "db_save", durationMs: Date.now() - prepStarted });
    console.info("[feedbackTiming]", { conversationId: input.conversationId, status: "completed", durationMs: Date.now() - started });
    await onCompleted?.(feedback);
    setImmediate(() => runStrategicPostProcessing(input, token, feedback).catch(() => {}));
  } catch (error: any) {
    const reason = String(error?.message || "feedback_generation_failed").slice(0, 500);
    const expired = reason.includes("timeout") || Date.now() > (started + FEEDBACK_OVERALL_DEADLINE_MS);
    await db.update(personaRuns).set({
      feedbackStatus: expired ? "expired" : "error",
      feedbackError: reason,
    }).where(and(
      eq(personaRuns.id, input.conversationId),
      eq(personaRuns.feedbackStatus, "generating"),
      eq(personaRuns.feedbackJobToken, token),
      eq(personaRuns.feedbackWorkerToken, workerToken),
    ));
    console.warn("[feedbackTiming]", { conversationId: input.conversationId, status: expired ? "expired" : "error", durationMs: Date.now() - started, reason });
  }
}

/** Used by force regeneration. The reset is conditional and cannot revive a
 * newer job; late workers are fenced by feedbackJobToken. */
export async function resetFeedbackJob(
  id: string,
  expected: { status: string | null; token: string | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const statusCondition = expected.status === null
      ? isNull(personaRuns.feedbackStatus)
      : eq(personaRuns.feedbackStatus, expected.status);
    const tokenCondition = expected.token === null
      ? isNull(personaRuns.feedbackJobToken)
      : eq(personaRuns.feedbackJobToken, expected.token);
    const claimed = await tx.update(personaRuns).set({
      feedbackStatus: null, feedbackQueuedAt: null, feedbackJobStartedAt: null,
      feedbackCompletedAt: null, feedbackError: null, feedbackExpiresAt: null,
      feedbackJobToken: null,
      feedbackWorkerToken: null,
      feedbackJobPayload: null,
      feedbackPostprocessStatus: null,
      feedbackPostprocessStartedAt: null,
      feedbackPostprocessToken: null,
      feedbackPostprocessAttempts: 0,
      feedbackPostprocessNextRetryAt: null,
    }).where(and(eq(personaRuns.id, id), statusCondition, tokenCondition))
      .returning({ id: personaRuns.id });
    if (claimed.length === 0) return false;
    await tx.delete(feedbacks).where(eq(feedbacks.personaRunId, id));
    return true;
  });
}

async function runStrategicPostProcessing(
  input: PersistedFeedbackJobPayload,
  token: string,
  feedbackReport?: any,
): Promise<void> {
  const postprocessToken = randomUUID();
  const [claimed] = await db.update(personaRuns).set({
    feedbackPostprocessStatus: "generating",
    feedbackPostprocessStartedAt: new Date(),
    feedbackPostprocessToken: postprocessToken,
    feedbackPostprocessAttempts: sql`${personaRuns.feedbackPostprocessAttempts} + 1`,
    feedbackPostprocessNextRetryAt: null,
  }).where(and(
    eq(personaRuns.id, input.conversationId),
    eq(personaRuns.feedbackStatus, "completed"),
    eq(personaRuns.feedbackJobToken, token),
    or(
      isNull(personaRuns.feedbackPostprocessStatus),
      eq(personaRuns.feedbackPostprocessStatus, "queued"),
      eq(personaRuns.feedbackPostprocessStatus, "error"),
    ),
  )).returning({
    id: personaRuns.id,
    attempt: personaRuns.feedbackPostprocessAttempts,
  });
  if (!claimed) return;
  try {
    if (input.completionContext?.kind === "agent") {
      const report = feedbackReport ?? await db.select().from(feedbacks)
        .where(eq(feedbacks.personaRunId, input.conversationId)).limit(1)
        .then((rows: any[]) => rows[0] ?? null);
      if (!report) throw new Error("agent_feedback_report_missing");
      const [session] = await db.select({ metadata: agentSessions.metadata })
        .from(agentSessions)
        .where(eq(agentSessions.id, input.completionContext.sessionId))
        .limit(1);
      const metadata = (session?.metadata as Record<string, any>) ?? {};
      const [stillOwned] = await db.select({ id: personaRuns.id }).from(personaRuns)
        .where(and(
          eq(personaRuns.id, input.conversationId),
          eq(personaRuns.feedbackStatus, "completed"),
          eq(personaRuns.feedbackJobToken, token),
          eq(personaRuns.feedbackPostprocessStatus, "generating"),
          eq(personaRuns.feedbackPostprocessToken, postprocessToken),
        )).limit(1);
      if (!stillOwned) throw new Error("feedback_job_cancelled");
      await db.update(agentSessions).set({
        metadata: {
          ...metadata,
          feedbackReport: report,
          feedbackStatus: "completed",
          feedbackGenerationToken: token,
        },
      }).where(eq(agentSessions.id, input.completionContext.sessionId));
      const delivered = await dispatchWebhook(
        input.completionContext.agentKeyId,
        "feedback.completed",
        { sessionId: input.completionContext.sessionId, feedbackReport: report },
        { deliveryId: `feedback_${token}` },
      );
      if (!delivered) throw new Error("agent_feedback_webhook_delivery_failed");
    }
    await performStrategicAnalysis(
      input.conversationId,
      input.conversation,
      input.scenario,
      input.language ?? "ko",
      async (analysis) => db.transaction(async (tx) => {
        const [owned] = await tx.update(personaRuns).set({ feedbackStatus: "completed" })
          .where(and(
            eq(personaRuns.id, input.conversationId),
            eq(personaRuns.feedbackStatus, "completed"),
            eq(personaRuns.feedbackJobToken, token),
            eq(personaRuns.feedbackPostprocessStatus, "generating"),
            eq(personaRuns.feedbackPostprocessToken, postprocessToken),
          )).returning({ id: personaRuns.id });
        if (!owned) throw new Error("feedback_job_cancelled");
        await tx.update(conversations).set({ sequenceAnalysis: analysis })
          .where(eq(conversations.id, input.conversationId));
      }),
    );
  } catch (error: any) {
    console.warn("[feedbackTiming]", {
      conversationId: input.conversationId,
      stage: "strategic_post_processing",
      reason: String(error?.message || error).slice(0, 500),
    });
    const retryDelay = FEEDBACK_POSTPROCESS_RETRY_DELAYS_MS[claimed.attempt - 1] ?? null;
    const retryAt = retryDelay === null ? null : new Date(Date.now() + retryDelay);
    await db.update(personaRuns).set({
      feedbackPostprocessStatus: "error",
      feedbackPostprocessStartedAt: null,
      feedbackPostprocessNextRetryAt: retryAt,
    }).where(and(
      eq(personaRuns.id, input.conversationId),
      eq(personaRuns.feedbackStatus, "completed"),
      eq(personaRuns.feedbackJobToken, token),
      eq(personaRuns.feedbackPostprocessStatus, "generating"),
      eq(personaRuns.feedbackPostprocessToken, postprocessToken),
    ));
    if (retryDelay !== null) {
      const timer = setTimeout(() => recoverFeedbackJobs().catch(() => {}), retryDelay + 25);
      timer.unref?.();
    }
    return;
  }
  await db.update(personaRuns).set({
    feedbackJobPayload: null,
    feedbackPostprocessStatus: "completed",
    feedbackPostprocessStartedAt: null,
    feedbackPostprocessNextRetryAt: null,
  }).where(and(
    eq(personaRuns.id, input.conversationId),
    eq(personaRuns.feedbackStatus, "completed"),
    eq(personaRuns.feedbackJobToken, token),
    eq(personaRuns.feedbackPostprocessStatus, "generating"),
    eq(personaRuns.feedbackPostprocessToken, postprocessToken),
  ));
}

export async function recoverFeedbackJobs(): Promise<number> {
  const rows = await db.select({
    id: personaRuns.id,
    status: personaRuns.feedbackStatus,
    token: personaRuns.feedbackJobToken,
    payload: personaRuns.feedbackJobPayload,
    expiresAt: personaRuns.feedbackExpiresAt,
    postprocessStatus: personaRuns.feedbackPostprocessStatus,
    postprocessStartedAt: personaRuns.feedbackPostprocessStartedAt,
    postprocessToken: personaRuns.feedbackPostprocessToken,
    postprocessAttempts: personaRuns.feedbackPostprocessAttempts,
    postprocessNextRetryAt: personaRuns.feedbackPostprocessNextRetryAt,
    workerToken: personaRuns.feedbackWorkerToken,
    workerStartedAt: personaRuns.feedbackJobStartedAt,
  }).from(personaRuns).where(inArray(personaRuns.feedbackStatus, ["queued", "generating", "completed"]));
  let recovered = 0;
  for (const row of rows) {
    if (row.status === "completed") {
      if (row.token && row.payload) {
        if (
          row.postprocessStatus === "error" &&
          row.postprocessAttempts > FEEDBACK_POSTPROCESS_RETRY_DELAYS_MS.length
        ) {
          continue;
        }
        if (
          row.postprocessStatus === "error" &&
          row.postprocessNextRetryAt &&
          row.postprocessNextRetryAt.getTime() > Date.now()
        ) {
          const timer = setTimeout(
            () => recoverFeedbackJobs().catch(() => {}),
            row.postprocessNextRetryAt.getTime() - Date.now() + 25,
          );
          timer.unref?.();
          continue;
        }
        if (row.postprocessStatus === "generating") {
          const leaseAge = row.postprocessStartedAt
            ? Date.now() - row.postprocessStartedAt.getTime()
            : FEEDBACK_POSTPROCESS_LEASE_MS;
          if (leaseAge < FEEDBACK_POSTPROCESS_LEASE_MS) {
            const timer = setTimeout(
              () => recoverFeedbackJobs().catch(() => {}),
              FEEDBACK_POSTPROCESS_LEASE_MS - leaseAge + 25,
            );
            timer.unref?.();
            continue;
          }
          const postprocessTokenCondition = row.postprocessToken === null
            ? isNull(personaRuns.feedbackPostprocessToken)
            : eq(personaRuns.feedbackPostprocessToken, row.postprocessToken);
          const released = await db.update(personaRuns).set({
            feedbackPostprocessStatus: "queued",
            feedbackPostprocessStartedAt: null,
            feedbackPostprocessToken: null,
          }).where(and(
            eq(personaRuns.id, row.id),
            eq(personaRuns.feedbackStatus, "completed"),
            eq(personaRuns.feedbackJobToken, row.token),
            eq(personaRuns.feedbackPostprocessStatus, "generating"),
            postprocessTokenCondition,
          )).returning({ id: personaRuns.id });
          if (released.length === 0) continue;
        }
        recovered += 1;
        setImmediate(() => runStrategicPostProcessing(
          row.payload as PersistedFeedbackJobPayload,
          row.token!,
        ).catch(() => {}));
      }
      continue;
    }
    if (row.status === "generating") {
      const leaseAge = row.workerStartedAt
        ? Date.now() - row.workerStartedAt.getTime()
        : FEEDBACK_WORKER_LEASE_MS;
      if (leaseAge < FEEDBACK_WORKER_LEASE_MS) {
        const timer = setTimeout(
          () => recoverFeedbackJobs().catch(() => {}),
          FEEDBACK_WORKER_LEASE_MS - leaseAge + 25,
        );
        timer.unref?.();
        continue;
      }
    }
    if (!row.token || !row.payload || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
      const tokenCondition = row.token === null
        ? isNull(personaRuns.feedbackJobToken)
        : eq(personaRuns.feedbackJobToken, row.token);
      await db.update(personaRuns).set({
        feedbackStatus: "expired",
        feedbackError: !row.payload ? "feedback_job_payload_missing" : "feedback_deadline_exceeded",
      }).where(and(
        eq(personaRuns.id, row.id),
        inArray(personaRuns.feedbackStatus, ["queued", "generating"]),
        tokenCondition,
      ));
      continue;
    }
    const reset = await db.update(personaRuns).set({
      feedbackStatus: "queued",
      feedbackQueuedAt: new Date(),
      feedbackJobStartedAt: null,
      feedbackWorkerToken: null,
      // Give the replacement worker a full execution budget while retaining
      // the generation token that fences out the previous worker.
      feedbackExpiresAt: new Date(Date.now() + FEEDBACK_OVERALL_DEADLINE_MS),
    }).where(and(
      eq(personaRuns.id, row.id),
      eq(personaRuns.feedbackStatus, row.status!),
      eq(personaRuns.feedbackJobToken, row.token),
      ...(row.status === "generating"
        ? [row.workerToken === null
            ? isNull(personaRuns.feedbackWorkerToken)
            : eq(personaRuns.feedbackWorkerToken, row.workerToken)]
        : []),
    )).returning({ id: personaRuns.id });
    if (reset.length === 0) continue;
    recovered += 1;
    setImmediate(() => runFeedbackJob(row.payload as PersistedFeedbackJobPayload, row.token!).catch(() => {}));
  }
  if (recovered > 0) console.info("[feedbackTiming]", { stage: "startup_recovery", recovered });
  return recovered;
}

export async function getFeedbackJobStatus(id: string): Promise<{ status: FeedbackJobStatus | null; error?: string | null }> {
  const [row] = await db.select({
    status: personaRuns.feedbackStatus, error: personaRuns.feedbackError,
    queuedAt: personaRuns.feedbackQueuedAt, expiresAt: personaRuns.feedbackExpiresAt,
  })
    .from(personaRuns).where(eq(personaRuns.id, id)).limit(1);
  if (row?.status === "queued" && row.queuedAt &&
      row.queuedAt.getTime() + FEEDBACK_QUEUE_DEADLINE_MS < Date.now()) {
    const expired = await db.update(personaRuns).set({
      feedbackStatus: "expired", feedbackError: "feedback_queue_deadline_exceeded",
    }).where(and(
      eq(personaRuns.id, id),
      eq(personaRuns.feedbackStatus, "queued"),
      eq(personaRuns.feedbackQueuedAt, row.queuedAt),
    )).returning({ id: personaRuns.id });
    if (expired.length > 0) {
      return { status: "expired", error: "feedback_queue_deadline_exceeded" };
    }
    return getFeedbackJobStatus(id);
  }
  if (row?.status === "generating") {
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      const expired = await db.update(personaRuns).set({
        feedbackStatus: "expired",
        feedbackError: "feedback_deadline_exceeded",
      }).where(and(
        eq(personaRuns.id, id),
        eq(personaRuns.feedbackStatus, "generating"),
        eq(personaRuns.feedbackExpiresAt, row.expiresAt),
      )).returning({ id: personaRuns.id });
      if (expired.length > 0) {
        return { status: "expired", error: "feedback_deadline_exceeded" };
      }
      return getFeedbackJobStatus(id);
    }
  }
  return { status: (row?.status as FeedbackJobStatus | null) ?? null, error: row?.error };
}