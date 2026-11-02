import { createHash } from "node:crypto";
import { z } from "zod";
import { storage } from "../../storage";
import { AvatarIdentityError } from "./delegatedIdentity";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { inspectConversationAvatarSelection, ownedAvatarConversation, resolveConversationAvatar } from "./conversationTarget";
import { testConnectionSchema, testLimitsSchema, testSessionSchema } from "./testContracts";
import { avatarTestReady, avatarTestTerminal } from "../../../shared/avatar/adminAvatarTest";
import { ConversationAvatarAudio } from "./conversationAudio";

const sessionSchema = testSessionSchema.extend({
  avatarId: z.string().min(1).max(160), avatarAssetId: z.string().uuid().nullable().optional(),
  purpose: z.enum(["validation", "conversation"]).optional(),
});
const recordSchema = z.object({
  conversationId: z.string(), personaId: z.string(), projectId: z.string(),
  avatarId: z.string(), assetId: z.string().nullable(), sessionId: testSessionSchema.shape.id.nullable(),
  pending: z.boolean(), baseline: z.array(z.string()).max(500),
});
type Record = z.infer<typeof recordSchema>;
const CATEGORY = "live_avatar_conversation";
const deps = {
  store: storage, client: new AvatarProjectClient(storage), connection: avatarRouterProjectConnection,
  owned: ownedAvatarConversation, resolve: resolveConversationAvatar,
  selection: inspectConversationAvatarSelection,
};

/** Local ownership binding survives restarts; remote create/audio writes are never retried. */
export class ConversationAvatarSessions {
  private creating = new Set<string>();
  private media = new Map<string, { record: Record; userId: string; audio: ConversationAvatarAudio;
    expires: number; notify?: (message: any) => void; expiryTimer?: ReturnType<typeof setTimeout> }>();
  constructor(private d = deps) {}
  selection(userId: string, conversationId: string) {
    return this.d.selection(userId, conversationId);
  }
  private key(userId: string, projectId: string) {
    return createHash("sha256").update(`${projectId}:${userId}`).digest("hex");
  }
  private async read(userId: string, projectId: string) {
    const row = await this.d.store.getSystemSetting(CATEGORY, this.key(userId, projectId));
    return row ? recordSchema.parse(JSON.parse(row.value)) : null;
  }
  private save(userId: string, record: Record) {
    return this.d.store.upsertSystemSetting({
      category: CATEGORY, key: this.key(userId, record.projectId), value: JSON.stringify(record), updatedBy: userId,
      description: "Owned live conversation binding and uncertain paid-create fence; no media or credentials",
    });
  }
  async availability(userId: string, conversationId: string) {
    const { scenarioRun } = await this.d.owned(userId, conversationId);
    const [global, policy] = await Promise.all([
      this.d.store.getSystemSetting("live_avatar", "enabled"),
      this.d.store.getSystemSetting("live_avatar_policy", scenarioRun.scenarioId),
    ]);
    const enabled = global?.value === "true", allowed = policy?.value === "true";
    let blockers: string[] = [];
    try { await this.d.resolve(userId, conversationId); }
    catch (error) {
      blockers = [error instanceof AvatarIdentityError ? error.code : "avatar_runtime_unavailable"];
    }
    return { enabled, allowed, contractReady: true, available: enabled && allowed && !blockers.length, blockers };
  }
  async create(userId: string, conversationId: string) {
    const target = await this.d.resolve(userId, conversationId);
    const key = this.key(userId, target.projectId);
    if (this.creating.has(key)) throw new AvatarIdentityError("avatar_session_creation_in_progress", 409);
    this.creating.add(key);
    try {
      const prior = await this.read(userId, target.projectId);
      const sessions = await this.d.client.call(userId, "/sessions", z.array(sessionSchema).max(500));
      if (prior?.pending) {
        const found = sessions.filter(s => !prior.baseline.includes(s.id) && this.matches(prior, s));
        if (found.length !== 1) throw new AvatarIdentityError("avatar_session_creation_uncertain", 409);
        prior.sessionId = found[0].id; prior.pending = false;
        await this.save(userId, prior);
      }
      if (prior?.sessionId) {
        const remote = await this.d.client.call(userId, `/sessions/${prior.sessionId}`, sessionSchema);
        if (!avatarTestTerminal(remote)) {
          if (prior.conversationId !== conversationId || !this.matches(prior, remote) ||
              prior.avatarId !== target.avatarId || prior.assetId !== target.assetId || prior.personaId !== target.personaId) {
            throw new AvatarIdentityError("avatar_previous_session_cleanup_required", 409);
          }
          return remote;
        }
      }
      if (sessions.some(s => !avatarTestTerminal(s))) throw new AvatarIdentityError("avatar_previous_session_cleanup_required", 409);
      const limits = await this.d.client.call(userId, "/live-limits", testLimitsSchema);
      if (!limits.workerReady || limits.cleanupPending || limits.userRemainingSeconds < limits.sessionSeconds ||
          limits.globalRemainingSeconds < limits.sessionSeconds) throw new AvatarIdentityError("avatar_runtime_limits_unavailable", 409);
      const record: Record = { ...target, conversationId, sessionId: null, pending: true,
        baseline: sessions.map(s => s.id) };
      await this.save(userId, record);
      const created = await this.d.client.call(userId, "/sessions", sessionSchema, {
        providerId: "tavus", avatarId: target.avatarId, mode: "live", costConfirmed: true,
        ...(target.assetId ? { avatarAssetId: target.assetId, purpose: "conversation" } : {}),
      });
      if (!this.matches(record, created)) throw new AvatarIdentityError("avatar_session_target_mismatch", 502);
      await this.save(userId, { ...record, sessionId: created.id, pending: false });
      return created;
    } finally { this.creating.delete(key); }
  }
  async recover(userId: string, conversationId: string) {
    await this.d.owned(userId, conversationId);
    const auth = await this.d.connection.check(userId);
    const record = await this.read(userId, auth.projectId);
    if (!record || record.conversationId !== conversationId) return { session: null, creationUncertain: false };
    if (record.pending) {
      const sessions = await this.d.client.call(userId, "/sessions", z.array(sessionSchema).max(500));
      const found = sessions.filter(s => !record.baseline.includes(s.id) && this.matches(record, s));
      if (found.length !== 1) return { session: null, creationUncertain: true };
      record.sessionId = found[0].id; record.pending = false;
      await this.save(userId, record);
    }
    const session = record.sessionId ? await this.session(userId, conversationId, record.sessionId) : null;
    return { session: session && !avatarTestTerminal(session) ? session : null, creationUncertain: false };
  }
  private matches(record: Record, session: z.infer<typeof sessionSchema>) {
    return session.providerId === "tavus" && session.avatarId === record.avatarId &&
      (record.assetId ? session.avatarAssetId === record.assetId && session.purpose === "conversation" : !session.avatarAssetId);
  }
  private async binding(userId: string, conversationId: string, id: string) {
    if (!testSessionSchema.shape.id.safeParse(id).success) throw new AvatarIdentityError("avatar_session_id_invalid", 400);
    await this.d.owned(userId, conversationId);
    const auth = await this.d.connection.check(userId);
    const record = await this.read(userId, auth.projectId);
    if (!record || record.conversationId !== conversationId || record.sessionId !== id || record.pending) {
      throw new AvatarIdentityError("avatar_session_forbidden", 403);
    }
    return record;
  }
  async session(userId: string, conversationId: string, id: string) {
    const record = await this.binding(userId, conversationId, id);
    const session = await this.d.client.call(userId, `/sessions/${id}`, sessionSchema);
    if (!this.matches(record, session)) throw new AvatarIdentityError("avatar_session_target_mismatch", 502);
    if (!avatarTestReady(session)) this.closeMedia(conversationId);
    const active = this.media.get(conversationId);
    if (active) {
      try {
        const current = await this.d.resolve(userId, conversationId);
        if (current.projectId !== record.projectId || current.avatarId !== record.avatarId ||
            current.assetId !== record.assetId || current.personaId !== record.personaId) throw new Error("target changed");
      } catch {
        active.notify?.({ type: "avatar.fallback" });
        this.closeMedia(conversationId);
        return this.d.client.call(userId, `/sessions/${id}/end`, sessionSchema, {});
      }
    }
    return session;
  }
  async connection(userId: string, conversationId: string, id: string) {
    if (!avatarTestReady(await this.session(userId, conversationId, id))) throw new AvatarIdentityError("avatar_session_not_ready", 409);
    const token = await this.d.client.call(userId, `/sessions/${id}/connection`, testConnectionSchema);
    if (Date.parse(token.expiresAt) <= Date.now()) throw new AvatarIdentityError("avatar_session_token_expired", 502);
    return token;
  }
  async mediaReady(userId: string, conversationId: string, id: string) {
    const target = await this.d.resolve(userId, conversationId);
    const record = await this.binding(userId, conversationId, id);
    const session = await this.session(userId, conversationId, id);
    if (!avatarTestReady(session) || Date.parse(session.expiresAt) <= Date.now() ||
        target.avatarId !== record.avatarId || target.assetId !== record.assetId || target.personaId !== record.personaId) {
      throw new AvatarIdentityError("avatar_session_not_ready", 409);
    }
    if (this.media.get(conversationId)?.record.sessionId === id && this.media.get(conversationId)?.audio.ready) {
      return { ready: true };
    }
    this.closeMedia(conversationId);
    const audio = new ConversationAvatarAudio(this.d.client, userId, id, () => {
      this.media.get(conversationId)?.notify?.({ type: "avatar.fallback" });
      this.closeMedia(conversationId);
      // Best-effort cleanup; the durable binding remains available for manual end.
      void this.d.client.call(userId, `/sessions/${id}/end`, sessionSchema, {}).catch(() => {});
    }, undefined, () => this.media.get(conversationId)?.notify?.({ type: "avatar.playback.done" }));
    audio.ready = true;
    const expiryTimer = setTimeout(() => {
      this.media.get(conversationId)?.notify?.({ type: "avatar.fallback" });
      this.closeMedia(conversationId);
      void this.d.client.call(userId, `/sessions/${id}/end`, sessionSchema, {}).catch(() => {});
    }, Math.min(120000, Math.max(1, Date.parse(session.expiresAt) - Date.now())));
    expiryTimer.unref?.();
    this.media.set(conversationId, { record, userId, audio, expires: Date.parse(session.expiresAt), expiryTimer });
    return { ready: true };
  }
  /** Only server-origin AI PCM enters here; browsers cannot POST arbitrary audio. */
  routeAudio(userId: string, conversationId: string, personaId: string, message: any, notify?: (message: any) => void) {
    const entry = this.media.get(conversationId);
    if (!entry) return false;
    if (notify) entry.notify = notify;
    if (entry.userId !== userId || entry.record.personaId !== personaId || entry.expires <= Date.now()) {
      this.closeMedia(conversationId);
      notify?.({ type: "avatar.fallback" });
      void this.d.client.call(entry.userId, `/sessions/${entry.record.sessionId}/end`, sessionSchema, {}).catch(() => {});
      return false;
    }
    if (message.type === "audio.delta") return entry.audio.push(message.delta, message.turnSeq, message.pcmSampleRate);
    if (message.type === "response.done") entry.audio.finish();
    if (message.type === "response.interrupted" || message.type === "session.reconnecting" ||
        message.type === "persona.switched" || message.type === "session.closed") {
      this.closeMedia(conversationId);
      entry.notify?.({ type: "avatar.fallback" });
      void this.d.client.call(userId, `/sessions/${entry.record.sessionId}/end`, sessionSchema, {}).catch(() => {});
    }
    return false;
  }
  closeMedia(conversationId: string) {
    clearTimeout(this.media.get(conversationId)?.expiryTimer);
    this.media.get(conversationId)?.audio.close();
    this.media.delete(conversationId);
  }
  async stop(userId: string, conversationId: string, id: string, end: boolean) {
    await this.d.owned(userId, conversationId);
    const active = this.media.get(conversationId);
    if (active?.userId === userId && active.record.sessionId === id) this.closeMedia(conversationId);
    await this.binding(userId, conversationId, id);
    this.closeMedia(conversationId);
    return this.d.client.call(userId, `/sessions/${id}/${end ? "end" : "interrupt"}`, sessionSchema, {});
  }
}
export const conversationAvatarSessions = new ConversationAvatarSessions();
