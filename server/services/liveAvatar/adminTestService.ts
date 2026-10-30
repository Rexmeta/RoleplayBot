import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { storage } from "../../storage";
import {
  avatarTestReady, avatarTestTerminal, type AvatarTestSession, type AvatarTestTurnInput,
} from "../../../shared/avatar/adminAvatarTest";
import { AvatarIdentityError } from "./delegatedIdentity";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { OpenAIAvatarTestDialogue, type AvatarTestDialogue } from "./testDialogue";
import { testConnectionSchema, testLimitsSchema, testScopes, testSessionSchema } from "./testContracts";

const anyTavusSessionSchema = testSessionSchema.extend({
  avatarId: z.string().min(1).max(160),
  avatarAssetId: z.string().uuid().nullable().optional(),
  purpose: z.enum(["validation", "conversation"]).optional(),
});
const listSchema = z.array(z.unknown()).max(500).transform(rows => rows.filter((row: any) =>
  row?.mode === "live" && row?.providerId === "tavus",
)).pipe(z.array(anyTavusSessionSchema));
// Shared across stock/custom service instances so switching assets cannot race a paid create.
const creating = new Set<string>();
export const AVATAR_TEST_ATTEMPTS = "live_avatar_test_attempt";
type AttemptStore = {
  getSystemSetting(category: string, key: string): Promise<{ value: string } | undefined>;
  upsertSystemSetting(input: { category: string; key: string; value: string; updatedBy: string; description: string }): Promise<unknown>;
};
const attemptSchema = z.object({ pending: z.boolean(), baseline: z.array(z.string().max(160)).max(500) });

/** Admin diagnostic only. Does not unlock ordinary conversation sessions or alter policy. */
export class AdminAvatarTestService {
  private turns = new Map<string, { owner: string; controller: AbortController }>();
  private turnCounts = new Map<string, { count: number; expires: number }>();

  constructor(
    private readonly client = new AvatarProjectClient(storage),
    private readonly connection: Pick<typeof avatarRouterProjectConnection, "check"> = avatarRouterProjectConnection,
    private readonly attempts: AttemptStore = storage,
    private readonly dialogue: AvatarTestDialogue = new OpenAIAvatarTestDialogue(),
    private readonly wait = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }),
    private readonly custom?: {
      assetId: string;
      resolve: (userId: string) => Promise<{ providerAvatarId: string }>;
    },
  ) {}

  private get sessionSchema(): z.ZodType<AvatarTestSession, z.ZodTypeDef, any> {
    return this.custom ? anyTavusSessionSchema.extend({
      avatarAssetId: z.literal(this.custom.assetId), purpose: z.literal("validation"),
    }) : testSessionSchema;
  }
  private belongs(session: AvatarTestSession & { avatarAssetId?: string | null; purpose?: string }) {
    return this.custom ? session.avatarAssetId === this.custom.assetId && session.purpose === "validation" :
      session.avatarId === "tavus-stock-lucy" && !session.avatarAssetId;
  }
  private attemptKey(projectId: string, userId: string) {
    return createHash("sha256").update(`${projectId}:${userId}`).digest("hex");
  }
  private saveAttempt(key: string, userId: string, pending: boolean, baseline: string[]) {
    return this.attempts.upsertSystemSetting({
      category: AVATAR_TEST_ATTEMPTS, key, updatedBy: userId,
      description: "Paid test creation fence; do not clear unknown outcomes without provider reconciliation",
      value: JSON.stringify({ pending, baseline }),
    });
  }

  async preflight(userId: string) {
    const auth = await this.connection.check(userId);
    const required = this.custom ? [...testScopes, "assets:read", "assets:write"] as const : testScopes;
    const missingScopes = required.filter(scope => !auth.scopes.includes(scope));
    if (missingScopes.includes("live-limits:read") || missingScopes.includes("sessions:read")) {
      throw new AvatarIdentityError("avatar_test_read_scopes_missing", 403);
    }
    const [limits, sessions] = await Promise.all([
      this.client.call(userId, "/live-limits", testLimitsSchema),
      this.client.call<AvatarTestSession[]>(userId, "/sessions", listSchema),
    ]);
    const attemptKey = this.attemptKey(auth.projectId, userId);
    const saved = await this.attempts.getSystemSetting(AVATAR_TEST_ATTEMPTS, attemptKey);
    const attempt = saved ? attemptSchema.parse(JSON.parse(saved.value)) : undefined;
    let creationUncertain = Boolean(attempt?.pending);
    if (attempt?.pending && sessions.some(session => !attempt.baseline.includes(session.id))) {
      // Durable remote ownership resolves an ambiguous create. Never issue a second create to recover.
      await this.saveAttempt(attemptKey, userId, false, []);
      creationUncertain = false;
    }
    const aiReady = this.dialogue.ready();
    let runtimeReady = true;
    let runtimeError: string | undefined;
    if (this.custom) {
      try { await this.custom.resolve(userId); }
      catch (error) {
        // Keep owned session recovery/end available even if the asset was deleted or changed.
        runtimeReady = false;
        runtimeError = error instanceof AvatarIdentityError ? error.code : "persona_avatar_runtime_check_failed";
      }
    }
    return {
      ready: runtimeReady && !creationUncertain && aiReady && !missingScopes.length && limits.workerReady &&
        limits.cleanupPending === 0 && limits.userRemainingSeconds >= 120 &&
        limits.globalRemainingSeconds >= 120 && !sessions.some(s => !avatarTestTerminal(s)),
      aiReady, creationUncertain, missingScopes, limits, sessions: sessions.filter(s => this.belongs(s)),
      ...(runtimeError ? { runtimeError } : {}),
    };
  }

  async create(userId: string) {
    if (creating.has(userId)) throw new AvatarIdentityError("avatar_test_creation_in_progress", 409);
    creating.add(userId);
    try {
      const state = await this.preflight(userId);
      if (!state.ready) throw new AvatarIdentityError(state.creationUncertain ? "avatar_test_creation_uncertain" : "avatar_test_not_ready", 409);
      const auth = await this.connection.check(userId);
      const key = this.attemptKey(auth.projectId, userId);
      const target = this.custom ? await this.custom.resolve(userId) : undefined;
      const baseline = await this.client.call(userId, "/sessions", listSchema);
      // Save BEFORE calling the paid endpoint, including across app restarts.
      await this.saveAttempt(key, userId, true, baseline.map((s: AvatarTestSession) => s.id));
      let session: AvatarTestSession;
      try {
        session = await this.client.call(userId, "/sessions", this.sessionSchema, {
          providerId: "tavus", avatarId: target?.providerAvatarId ?? "tavus-stock-lucy", mode: "live", costConfirmed: true,
          ...(this.custom ? { avatarAssetId: this.custom.assetId, purpose: "validation" } : {}),
        });
        if (target && session.avatarId !== target.providerAvatarId) {
          throw new AvatarIdentityError("persona_avatar_session_revision_mismatch", 502);
        }
      } catch (error) {
        if (error instanceof AvatarIdentityError && ["avatar_test_upstream_401", "avatar_test_upstream_403",
          "avatar_test_upstream_404", "avatar_test_upstream_429"].includes(error.code)) {
          await this.saveAttempt(key, userId, false, []);
        }
        throw error;
      }
      await this.saveAttempt(key, userId, false, []);
      return session;
    } finally { creating.delete(userId); }
  }

  async session(userId: string, id: string) {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new AvatarIdentityError("avatar_test_id_invalid", 400);
    const session = await this.client.call(userId, `/sessions/${id}`, this.sessionSchema);
    if (session.id !== id) throw new AvatarIdentityError("avatar_test_session_mismatch", 502);
    return session;
  }

  private async running(userId: string, id: string) {
    const session = await this.session(userId, id);
    if (!avatarTestReady(session) || Date.parse(session.expiresAt) <= Date.now()) {
      throw new AvatarIdentityError("avatar_test_session_not_running", 409);
    }
    return session;
  }

  async connectionToken(userId: string, id: string) {
    await this.running(userId, id);
    const result = await this.client.call(userId, `/sessions/${id}/connection`, testConnectionSchema);
    if (Date.parse(result.expiresAt) <= Date.now()) throw new AvatarIdentityError("avatar_test_token_expired", 502);
    return result;
  }

  async turn(userId: string, id: string, input: AvatarTestTurnInput) {
    const lock = `${userId}:${id}`;
    if (this.turns.has(lock)) throw new AvatarIdentityError("avatar_test_turn_in_progress", 409);
    const controller = new AbortController();
    this.turns.set(lock, { owner: userId, controller });
    const timeout = setTimeout(() => controller.abort(), 65_000);
    try {
      const session = await this.running(userId, id);
      this.turnCounts.forEach((entry, key) => { if (entry.expires <= Date.now()) this.turnCounts.delete(key); });
      const quota = this.turnCounts.get(lock) ?? { count: 0, expires: Date.parse(session.expiresAt) };
      if (quota.count >= 12) throw new AvatarIdentityError("avatar_test_turn_limit", 429);
      quota.count++;
      this.turnCounts.set(lock, quota);
      const { userText, replyText, pcm } = await this.dialogue.reply(input, controller.signal);
      if (controller.signal.aborted) throw new AvatarIdentityError("avatar_test_turn_cancelled", 409);
      if (pcm.length < 960 || pcm.length > 720_000 || pcm.length % 2) {
        throw new AvatarIdentityError("avatar_test_pcm_invalid", 502);
      }
      // 24kHz mono PCM16 = 48000 bytes/s. Each command is <=4s, never retried.
      for (let offset = 0; offset < pcm.length;) {
        controller.signal.throwIfAborted();
        await this.running(userId, id);
        controller.signal.throwIfAborted();
        let end = Math.min(offset + 192_000, pcm.length);
        if (pcm.length - end > 0 && pcm.length - end < 960) end = pcm.length;
        const clip = pcm.subarray(offset, end);
        const accepted = await this.client.call(userId, `/sessions/${id}/audio`,
          z.object({ accepted: z.literal(true) }), { pcmBase64: clip.toString("base64") }, controller.signal);
        if (!accepted.accepted) throw new AvatarIdentityError("avatar_test_audio_rejected", 502);
        offset = end;
        // Limit queued renderer audio; don't send a continuous Gemini stream.
        if (offset < pcm.length) await this.wait(clip.length / 48, controller.signal);
      }
      controller.signal.throwIfAborted();
      return { userText, replyText };
    } catch (error) {
      if (error instanceof AvatarIdentityError) throw error;
      throw new AvatarIdentityError("avatar_test_turn_cancelled", 409);
    } finally {
      clearTimeout(timeout);
      this.turns.delete(lock);
    }
  }

  async stop(userId: string, id: string, end: boolean) {
    this.turns.get(`${userId}:${id}`)?.controller.abort();
    const session = await this.session(userId, id);
    if (avatarTestTerminal(session)) return session;
    return this.client.call(userId, `/sessions/${id}/${end ? "end" : "interrupt"}`, this.sessionSchema, {});
  }
}

export const adminAvatarTestService = new AdminAvatarTestService();
