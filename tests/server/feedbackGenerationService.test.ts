import { beforeEach, describe, expect, it, vi } from "vitest";

type JobRow = {
  status: string | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  expiresAt: Date | null;
  token: string | null;
  workerToken?: string | null;
  payload?: Record<string, any> | null;
  postprocessStatus?: string | null;
  postprocessStartedAt?: Date | null;
  postprocessToken?: string | null;
  postprocessAttempts?: number;
  postprocessNextRetryAt?: Date | null;
};

const mocks = vi.hoisted(() => {
  const state: JobRow = {
    status: null,
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    error: null,
    expiresAt: null,
    token: null,
    workerToken: null,
    payload: null,
    postprocessStatus: null,
    postprocessStartedAt: null,
    postprocessToken: null,
    postprocessAttempts: 0,
    postprocessNextRetryAt: null,
  };
  const generateAndSaveFeedback = vi.fn();
  const performStrategicAnalysis = vi.fn();
  const dispatchWebhook = vi.fn();
  let allowResetClaim: boolean | null = null;
  function thenable<T>(value: T, returningValue: unknown[] = []) {
    const promise = Promise.resolve(value);
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
      returning: vi.fn().mockResolvedValue(returningValue),
    };
  }
  const db: any = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => {
        const rows = [{
          id: "run-1",
          status: state.status,
          queuedAt: state.queuedAt,
          completedAt: state.completedAt,
          error: state.error,
          expiresAt: state.expiresAt,
          token: state.token,
          workerToken: state.workerToken,
          workerStartedAt: state.startedAt,
          payload: state.payload,
          postprocessStatus: state.postprocessStatus,
          postprocessStartedAt: state.postprocessStartedAt,
          postprocessToken: state.postprocessToken,
          postprocessAttempts: state.postprocessAttempts,
          postprocessNextRetryAt: state.postprocessNextRetryAt,
        }];
        const result: any = Promise.resolve(rows);
        result.limit = vi.fn(async () => rows);
        return result;
      }),
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((values: Record<string, any>) => ({
      where: vi.fn(() => {
        let claimed = false;
        if (
          values.feedbackPostprocessStatus === "queued" &&
          state.status === "completed" &&
          state.postprocessStatus === "generating"
        ) {
          claimed = true;
          state.postprocessStatus = "queued";
          state.postprocessStartedAt = null;
          state.postprocessToken = null;
        } else if (values.feedbackPostprocessStatus === "generating") {
          claimed = state.status === "completed" &&
            (state.postprocessStatus === null ||
              state.postprocessStatus === "queued" ||
              state.postprocessStatus === "error");
          if (claimed) {
            state.postprocessStatus = "generating";
            state.postprocessStartedAt = values.feedbackPostprocessStartedAt;
            state.postprocessToken = values.feedbackPostprocessToken;
            state.postprocessAttempts = (state.postprocessAttempts ?? 0) + 1;
            state.postprocessNextRetryAt = null;
          }
        } else if (values.feedbackPostprocessStatus === "completed") {
          claimed = state.status === "completed" && state.postprocessStatus === "generating";
          if (claimed) {
            state.postprocessStatus = "completed";
            state.payload = null;
            state.postprocessNextRetryAt = null;
          }
        } else if (values.feedbackPostprocessStatus === "error") {
          claimed = state.status === "completed" && state.postprocessStatus === "generating";
          if (claimed) {
            state.postprocessStatus = "error";
            state.postprocessNextRetryAt = values.feedbackPostprocessNextRetryAt;
          }
        } else if (values.feedbackStatus === "queued") {
          const recoveringInterruptedWorker =
            values.feedbackJobToken === undefined &&
            (state.status === "generating" || state.status === "queued");
          claimed = recoveringInterruptedWorker ||
            state.status === null || state.status === "error" || state.status === "expired";
          if (claimed) {
            if (recoveringInterruptedWorker) {
              Object.assign(state, {
                status: "queued",
                queuedAt: values.feedbackQueuedAt,
                startedAt: null,
                expiresAt: values.feedbackExpiresAt,
                workerToken: values.feedbackWorkerToken,
              });
            } else {
              Object.assign(state, {
                status: "queued",
                queuedAt: values.feedbackQueuedAt,
                startedAt: null,
                completedAt: null,
                error: null,
                expiresAt: values.feedbackExpiresAt,
                token: values.feedbackJobToken,
                workerToken: values.feedbackWorkerToken,
                payload: values.feedbackJobPayload,
                postprocessAttempts: values.feedbackPostprocessAttempts,
                postprocessNextRetryAt: values.feedbackPostprocessNextRetryAt,
              });
            }
          }
        } else if (
          values.feedbackStatus === "generating" &&
          values.feedbackJobStartedAt !== undefined &&
          state.status === "queued"
        ) {
          claimed = true;
          Object.assign(state, {
            status: "generating",
            startedAt: values.feedbackJobStartedAt,
            token: state.token,
            workerToken: values.feedbackWorkerToken,
          });
        } else if (
          values.feedbackStatus === "generating" &&
          values.feedbackJobToken === undefined &&
          state.status === "generating"
        ) {
          claimed = true;
        } else if (values.feedbackStatus === "completed" && state.status === "generating") {
          claimed = true;
          Object.assign(state, {
            status: "completed",
            completedAt: values.feedbackCompletedAt,
            error: null,
            postprocessStatus: values.feedbackPostprocessStatus,
          });
        } else if (
          (values.feedbackStatus === "error" || values.feedbackStatus === "expired") &&
          state.status === "generating"
        ) {
          Object.assign(state, {
            status: values.feedbackStatus,
            error: values.feedbackError,
          });
        } else if (
          values.feedbackStatus === "expired" &&
          state.status === "queued" &&
          state.queuedAt &&
          state.queuedAt.getTime() < Date.now() - 30_000
        ) {
          claimed = true;
          Object.assign(state, { status: "expired", error: values.feedbackError });
        } else if (values.feedbackStatus === null) {
          claimed = allowResetClaim ?? (state.status !== null || state.token !== null || state.completedAt !== null);
          allowResetClaim = null;
          if (claimed) {
            Object.assign(state, {
              status: null,
              queuedAt: null,
              startedAt: null,
              completedAt: null,
              error: null,
              expiresAt: null,
              token: null,
              workerToken: null,
              payload: null,
              postprocessStatus: null,
              postprocessStartedAt: null,
              postprocessToken: null,
              postprocessAttempts: 0,
              postprocessNextRetryAt: null,
            });
          }
        }
        return thenable(undefined, claimed ? [{
          id: "run-1",
          token: state.token,
          workerToken: state.workerToken,
          attempt: state.postprocessAttempts,
        }] : []);
      }),
    })),
  })),
  };
  db.transaction = vi.fn(async (callback: (tx: any) => Promise<any>) => callback(db));
  db.delete = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
  db.insert = vi.fn(() => ({
    values: vi.fn((payload: any) => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "feedback-1", ...payload }]),
      })),
    })),
  }));
  return {
    state,
    generateAndSaveFeedback,
    performStrategicAnalysis,
    dispatchWebhook,
    db,
    rejectNextResetClaim() { allowResetClaim = false; },
  };
});

vi.mock("../../server/storage", () => ({ db: mocks.db }));
vi.mock("../../server/routes/routerHelpers", () => ({
  generateAndSaveFeedback: mocks.generateAndSaveFeedback,
  performStrategicAnalysis: mocks.performStrategicAnalysis,
}));
vi.mock("../../server/services/webhookDelivery", () => ({
  dispatchWebhook: mocks.dispatchWebhook,
}));

import {
  enqueueFeedbackJob,
  getFeedbackJobStatus,
  recoverFeedbackJobs,
  resetFeedbackJob,
} from "../../server/services/feedbackGenerationService";

const input = {
  conversationId: "run-1",
  conversation: { messages: [] },
  scenario: { id: "scenario-1" },
  persona: { id: "persona-1" },
} as const;

async function flushJob() {
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
}

describe("durable feedback generation service", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.performStrategicAnalysis.mockReset().mockResolvedValue(undefined);
    mocks.dispatchWebhook.mockReset().mockResolvedValue(true);
    await resetFeedbackJob("run-1", { status: mocks.state.status, token: mocks.state.token });
  });

  it("claims concurrent enqueue requests only once", async () => {
    mocks.generateAndSaveFeedback.mockImplementation(async (...args: any[]) => {
      const persistFeedback = args[7];
      return persistFeedback({ personaRunId: "run-1", scores: [], detailedFeedback: {} });
    });

    const [first, second] = await Promise.all([
      enqueueFeedbackJob(input),
      enqueueFeedbackJob(input),
    ]);
    await flushJob();

    expect([first.status, second.status]).toEqual(["queued", "queued"]);
    expect(mocks.generateAndSaveFeedback).toHaveBeenCalledTimes(1);
    expect(mocks.state.status).toBe("completed");
  });

  it("allows only one concurrent force reset to replace the observed generation", async () => {
    mocks.state.status = "completed";
    mocks.state.completedAt = new Date();
    const [first, second] = await Promise.all([
      resetFeedbackJob("run-1", { status: "completed", token: null }),
      resetFeedbackJob("run-1", { status: "completed", token: null }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(mocks.state.status).toBeNull();
  });

  it("does not delete or reset a newer job after a stale force observation", async () => {
    mocks.state.status = "completed";
    mocks.state.token = "newer-job-token";
    mocks.rejectNextResetClaim();
    const deleteCallsBefore = mocks.db.delete.mock.calls.length;

    const reset = await resetFeedbackJob("run-1", { status: "completed", token: "older-job-token" });

    expect(reset).toBe(false);
    expect(mocks.state.status).toBe("completed");
    expect(mocks.state.token).toBe("newer-job-token");
    expect(mocks.db.delete).toHaveBeenCalledTimes(deleteCallsBefore);
  });

  it("does not reset a newer queued generation with the same status", async () => {
    mocks.state.status = "queued";
    mocks.state.token = "newer-queued-token";
    mocks.rejectNextResetClaim();

    const reset = await resetFeedbackJob("run-1", { status: "queued", token: "older-queued-token" });

    expect(reset).toBe(false);
    expect(mocks.state.status).toBe("queued");
    expect(mocks.state.token).toBe("newer-queued-token");
  });

  it("recovers a stale queued job as expired after a restart", async () => {
    mocks.state.status = "queued";
    mocks.state.queuedAt = new Date(Date.now() - 31_000);
    mocks.state.error = null;

    await expect(getFeedbackJobStatus("run-1")).resolves.toEqual({
      status: "expired",
      error: "feedback_queue_deadline_exceeded",
    });
    expect(mocks.state.status).toBe("expired");
  });

  it("persists a provider or malformed-response failure as error", async () => {
    mocks.generateAndSaveFeedback.mockRejectedValue(new SyntaxError("malformed_provider_response"));

    await enqueueFeedbackJob(input);
    await flushJob();

    expect(mocks.generateAndSaveFeedback).toHaveBeenCalledTimes(1);
    expect(mocks.state.status).toBe("error");
    expect(mocks.state.error).toContain("malformed_provider_response");
  });

  it("completes a claimed legacy job when its feedback row already exists", async () => {
    mocks.generateAndSaveFeedback.mockImplementation(async (...args: any[]) => {
      const persistFeedback = args[7];
      return persistFeedback({
        id: "existing-feedback",
        personaRunId: "run-1",
        overallScore: 75,
        reportStatus: "completed",
      }, true);
    });

    await enqueueFeedbackJob(input);
    await flushJob();

    expect(mocks.state.status).toBe("completed");
    expect(mocks.state.postprocessStatus).toBe("completed");
  });

  it("recovers an interrupted generating job from its persisted payload", async () => {
    mocks.state.status = "generating";
    mocks.state.token = "persisted-generation-token";
    mocks.state.payload = input;
    mocks.state.queuedAt = new Date(Date.now() - 90_000);
    mocks.state.startedAt = new Date(Date.now() - 135_001);
    mocks.state.expiresAt = new Date(Date.now() + 60_000);
    mocks.generateAndSaveFeedback.mockImplementation(async (...args: any[]) => {
      const persistFeedback = args[7];
      return persistFeedback({ personaRunId: "run-1", overallScore: 80, reportStatus: "completed" });
    });

    await expect(recoverFeedbackJobs()).resolves.toBe(1);
    await flushJob();

    expect(mocks.generateAndSaveFeedback).toHaveBeenCalledTimes(1);
    expect(mocks.state.status).toBe("completed");
  });

  it("does not steal an active core feedback worker lease during recovery", async () => {
    mocks.state.status = "generating";
    mocks.state.token = "active-generation-token";
    mocks.state.workerToken = "active-worker-token";
    mocks.state.payload = input;
    mocks.state.startedAt = new Date();
    mocks.state.expiresAt = new Date(Date.now() + 60_000);

    await expect(recoverFeedbackJobs()).resolves.toBe(0);
    await flushJob();

    expect(mocks.generateAndSaveFeedback).not.toHaveBeenCalled();
    expect(mocks.state.status).toBe("generating");
    expect(mocks.state.workerToken).toBe("active-worker-token");
  });

  it("reclaims one crashed production worker and fences its late publication", async () => {
    let releaseFirst!: () => void;
    const firstWorkerBlocked = new Promise<void>(resolve => { releaseFirst = resolve; });
    mocks.generateAndSaveFeedback
      .mockImplementationOnce(async (...args: any[]) => {
        await firstWorkerBlocked;
        return args[7]({ personaRunId: "run-1", overallScore: 10, reportStatus: "completed" });
      })
      .mockImplementationOnce(async (...args: any[]) =>
        args[7]({ personaRunId: "run-1", overallScore: 90, reportStatus: "completed" }));

    await enqueueFeedbackJob(input);
    await flushJob();
    const staleWorkerToken = mocks.state.workerToken;
    mocks.state.startedAt = new Date(Date.now() - 135_001);
    mocks.state.expiresAt = new Date(Date.now() + 30_000);

    await expect(recoverFeedbackJobs()).resolves.toBe(1);
    await flushJob();

    expect(mocks.generateAndSaveFeedback).toHaveBeenCalledTimes(2);
    expect(mocks.state.status).toBe("completed");
    expect(mocks.state.workerToken).not.toBe(staleWorkerToken);

    releaseFirst();
    await flushJob();
    expect(mocks.state.status).toBe("completed");
  });

  it("refreshes queue age and recovers a queued job after downtime", async () => {
    mocks.state.status = "queued";
    mocks.state.token = "persisted-queued-token";
    mocks.state.payload = input;
    mocks.state.queuedAt = new Date(Date.now() - 90_000);
    mocks.state.expiresAt = new Date(Date.now() + 60_000);
    mocks.generateAndSaveFeedback.mockImplementation(async (...args: any[]) => {
      const persistFeedback = args[7];
      return persistFeedback({ personaRunId: "run-1", overallScore: 80, reportStatus: "completed" });
    });

    await expect(recoverFeedbackJobs()).resolves.toBe(1);
    await flushJob();

    expect(mocks.generateAndSaveFeedback).toHaveBeenCalledTimes(1);
    expect(mocks.state.status).toBe("completed");
  });

  it("retains the durable payload when strategic post-processing fails", async () => {
    mocks.generateAndSaveFeedback.mockImplementation(async (...args: any[]) => {
      const persistFeedback = args[7];
      return persistFeedback({ personaRunId: "run-1", overallScore: 80, reportStatus: "completed" });
    });
    mocks.performStrategicAnalysis.mockRejectedValueOnce(new Error("strategic_provider_unavailable"));

    await enqueueFeedbackJob(input);
    await flushJob();

    expect(mocks.state.status).toBe("completed");
    expect(mocks.state.postprocessStatus).toBe("error");
    expect(mocks.state.payload).toEqual(input);
  });

  it("single-claims concurrent strategic recovery and clears payload on success", async () => {
    mocks.state.status = "completed";
    mocks.state.token = "postprocess-token";
    mocks.state.payload = input;
    mocks.state.postprocessStatus = "error";

    await Promise.all([recoverFeedbackJobs(), recoverFeedbackJobs()]);
    await flushJob();

    expect(mocks.performStrategicAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.state.postprocessStatus).toBe("completed");
    expect(mocks.state.payload).toBeNull();
  });

  it("does not steal a strategic lease from an active worker during recovery", async () => {
    mocks.state.status = "completed";
    mocks.state.token = "feedback-token";
    mocks.state.payload = input;
    mocks.state.postprocessStatus = "generating";
    mocks.state.postprocessStartedAt = new Date();
    mocks.state.postprocessToken = "active-postprocess-token";

    await expect(recoverFeedbackJobs()).resolves.toBe(0);
    await flushJob();

    expect(mocks.performStrategicAnalysis).not.toHaveBeenCalled();
    expect(mocks.state.postprocessStatus).toBe("generating");
    expect(mocks.state.postprocessToken).toBe("active-postprocess-token");
  });

  it("reclaims an expired strategic lease with a new owner token", async () => {
    mocks.state.status = "completed";
    mocks.state.token = "feedback-token";
    mocks.state.payload = input;
    mocks.state.postprocessStatus = "generating";
    mocks.state.postprocessStartedAt = new Date(Date.now() - 121_000);
    mocks.state.postprocessToken = "expired-postprocess-token";

    await expect(recoverFeedbackJobs()).resolves.toBe(1);
    await flushJob();

    expect(mocks.performStrategicAnalysis).toHaveBeenCalledTimes(1);
    expect(mocks.state.postprocessStatus).toBe("completed");
    expect(mocks.state.postprocessToken).not.toBe("expired-postprocess-token");
  });

  it("replays Agent completion metadata and an idempotent webhook after restart", async () => {
    const agentInput = {
      ...input,
      completionContext: {
        kind: "agent" as const,
        sessionId: "agent-session-1",
        agentKeyId: "agent-key-1",
      },
    };
    mocks.state.status = "completed";
    mocks.state.token = "agent-generation-token";
    mocks.state.payload = agentInput;
    mocks.state.postprocessStatus = "error";

    await expect(recoverFeedbackJobs()).resolves.toBe(1);
    await flushJob();

    expect(mocks.dispatchWebhook).toHaveBeenCalledWith(
      "agent-key-1",
      "feedback.completed",
      expect.objectContaining({ sessionId: "agent-session-1" }),
      { deliveryId: "feedback_agent-generation-token" },
    );
    expect(mocks.state.payload).toBeNull();
  });

  it("retries a transient Agent webhook failure in the same process", async () => {
    const realSetTimeout = global.setTimeout;
    let scheduledRetry: (() => void) | undefined;
    const timeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation(((callback: any, delay?: number, ...args: any[]) => {
      if (delay === 30_025) {
        scheduledRetry = () => callback(...args);
        return { unref: vi.fn() } as any;
      }
      return realSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout);
    try {
      const agentInput = {
        ...input,
        completionContext: {
          kind: "agent" as const,
          sessionId: "agent-session-1",
          agentKeyId: "agent-key-1",
        },
      };
      mocks.generateAndSaveFeedback.mockImplementation(async (...args: any[]) =>
        args[7]({ personaRunId: "run-1", overallScore: 88, reportStatus: "completed" }));
      mocks.dispatchWebhook
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await enqueueFeedbackJob(agentInput);
      await flushJob();

      expect(mocks.state.status).toBe("completed");
      expect(mocks.state.postprocessStatus).toBe("error");
      expect(mocks.state.postprocessAttempts).toBe(1);
      expect(mocks.state.payload).toEqual(agentInput);
      expect(scheduledRetry).toBeTypeOf("function");

      mocks.state.postprocessNextRetryAt = new Date(Date.now() - 1);
      scheduledRetry!();
      await flushJob();

      expect(mocks.dispatchWebhook).toHaveBeenCalledTimes(2);
      expect(mocks.state.postprocessStatus).toBe("completed");
      expect(mocks.state.postprocessAttempts).toBe(2);
      expect(mocks.state.payload).toBeNull();
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});