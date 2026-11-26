/**
 * Agent API server-side client (zero dependencies, Node 18+).
 * Keep the API key on your server. Never ship it to the browser.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type Language = "ko" | "en" | "ja" | "zh";

export interface GameContext {
  contextId?: string;
  sceneSummary?: string;
  objective?: string;
  playerState?: Record<string, string | number | boolean>;
  recentEvents?: string[];
}

export interface CreateSessionInput {
  scenarioId: string;
  personaId: string;
  externalUserId: string;
  externalSessionId?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  language?: Language;
  metadata?: Record<string, unknown>;
  gameContext?: GameContext;
}

export interface Session {
  sessionId: string;
  status: "active" | "ended" | "expired";
  scenarioId: string;
  personaId: string;
  externalUserId: string;
  externalSessionId?: string | null;
  language: Language;
  difficulty: number;
  createdAt: string;
  expiresAt: string;
  contextLost: boolean;
  requestId: string;
}

export interface PlayLink {
  sessionId: string;
  playUrl: string;
  expiresAt: string;
  singleUse: true;
  requestId: string;
}

export interface GameResultBody {
  passed: boolean | null;
  overallScore: number | null;
  scenarioSuccessLevel: "excellent" | "success" | "partial" | "failure" | null;
  dimensionScores?: { key: string; name: string; score: number; maxScore: number }[];
  strengths?: string[];
  improvements?: string[];
  emotionFlow?: { start: string; end: string; dominant: string; turns: number; sequence: string[] } | null;
  narrativeHook: string;
  reportStatus?: string | null;
  confidence?: number | null;
}

export interface GameResult {
  sessionId: string;
  externalSessionId?: string | null;
  gameContextId?: string | null;
  sessionStatus?: "active" | "ended" | "expired";
  scenarioId?: string;
  personaId?: string;
  status: "in_progress" | "completed" | "failed";
  result: GameResultBody | null;
  error?: { code: string; message: string } | null;
  requestId?: string;
}

export interface WebhookEvent<T = unknown> {
  event: string;
  deliveryId: string;
  timestamp: string;
  data: T;
}

export class AgentApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

export interface AgentApiClientOptions {
  apiKey: string;
  /** Server origin, e.g. https://your-host (no /api/v1/agent suffix). */
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class AgentApiClient {
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(private readonly opts: AgentApiClientOptions) {
    if (!opts.apiKey) throw new Error("apiKey is required");
    this.base = opts.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1\/agent$/, "") + "/api/v1/agent";
    this.f = opts.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.f(this.base + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new AgentApiError(
        res.status,
        json?.error?.code ?? "unknown_error",
        json?.error?.message ?? `HTTP ${res.status}`,
        json?.requestId,
        json?.error?.details,
      );
    }
    return json as T;
  }

  /** Create a session. Pass `idempotencyKey` to make retries safe. */
  createSession(input: CreateSessionInput, idempotencyKey?: string): Promise<Session> {
    return this.request("POST", "/sessions", input, idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
  }

  /** Issue a single-use, short-lived link to the hosted play screen. */
  createPlayLink(sessionId: string, ttlSeconds?: number): Promise<PlayLink> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/play-link`, ttlSeconds ? { ttlSeconds } : {});
  }

  /** One call: create the session and issue its play link. */
  async startRoleplay(input: CreateSessionInput, opts: { ttlSeconds?: number; idempotencyKey?: string } = {}) {
    const session = await this.createSession(input, opts.idempotencyKey);
    const link = await this.createPlayLink(session.sessionId, opts.ttlSeconds);
    return { sessionId: session.sessionId, playUrl: link.playUrl, expiresAt: link.expiresAt, session };
  }

  getResult(sessionId: string): Promise<GameResult> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/result`);
  }

  /** End a session (starts feedback generation). Safe to call to retry a failed feedback. */
  endSession(sessionId: string): Promise<unknown> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/end`, {});
  }

  /**
   * Poll until the result is `completed`. Throws AgentApiError("feedback_failed") if it failed,
   * and an Error on timeout. Prefer webhooks in production; use this for simple setups.
   */
  async waitForResult(sessionId: string, opts: WaitOptions = {}): Promise<GameResult & { result: GameResultBody }> {
    const interval = opts.intervalMs ?? 2000;
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    for (;;) {
      if (opts.signal?.aborted) throw new Error("waitForResult aborted");
      const r = await this.getResult(sessionId);
      if (r.status === "completed" && r.result) return r as GameResult & { result: GameResultBody };
      if (r.status === "failed") {
        throw new AgentApiError(502, r.error?.code ?? "feedback_failed", r.error?.message ?? "Feedback generation failed.", r.requestId);
      }
      if (Date.now() + interval > deadline) throw new Error(`Timed out waiting for result of ${sessionId}`);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

/**
 * Verify an `X-Webhook-Signature` header (`sha256=<hex>`) against the RAW request body.
 * Use the bytes exactly as received (e.g. express.raw), not re-serialised JSON.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | undefined | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(m[1], "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Verify and parse a webhook delivery. Throws if the signature is invalid. */
export function parseWebhook<T = { result?: GameResult; sessionId?: string }>(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
  secret: string,
): WebhookEvent<T> {
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) throw new Error("Invalid webhook signature");
  return JSON.parse(rawBody.toString("utf8"));
}
