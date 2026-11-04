import { randomUUID } from "node:crypto";
import { storage } from "../../storage";
import { TavusError } from "./client";
import { resolveTavusContext, resolveTavusOwner, ROLEPLAY_PAL_PROMPT } from "./context";
import { TavusStore } from "./store";
import { reserveTavusRun } from "./importTranscript";
import { AvatarProjectClient } from "../liveAvatar/projectClient";
import { avatarRouterProjectConnection } from "../liveAvatar/projectConnection";
import { resolveConversationAvatar, inspectConversationAvatarSelection } from "../liveAvatar/conversationTarget";
import { AvatarIdentityError } from "../liveAvatar/delegatedIdentity";
import { inspectTavusLimits, tavusLimitsSchema } from "./runtimeLimits";
import { dailyConnectionSchema, routerSessionSchema } from "./routerContracts";

type State = "creating" | "create_unknown" | "active" | "ending" | "ended";
export interface TavusSession {
  state: State; token: string; userId: string; runId: string; createdAt: string;
  sessionId?: string; projectId?: string; avatarId?: string; assetId?: string | null;
  expiresAt?: string; lastError?: string;
}
const requiredFeatures = ["tavus_full_pipeline", "daily_private_connection"];
const requiredScopes = ["live-limits:read", "sessions:create", "sessions:read", "sessions:connect", "sessions:end"];
export const tavusDeps = {
  client: new AvatarProjectClient(storage), store: new TavusStore(),
  connection: avatarRouterProjectConnection, resolve: resolveTavusContext, owner: resolveTavusOwner,
  target: resolveConversationAvatar, selection: inspectConversationAvatarSelection, reserve: reserveTavusRun,
};

/** Router-only full pipeline. No provider PAL API, Gemini audio, or invented transcript API. */
export class TavusSessions {
  constructor(private readonly deps = tavusDeps) {}

  async config(userId?: string, runId?: string) {
    const blockers: string[] = [];
    let runtime: ReturnType<typeof inspectTavusLimits>["limits"] | null = null;
    let selectable = false;
    if (!userId) blockers.push("avatar_authenticated_user_required");
    else try {
      const auth = await this.deps.connection.check(userId);
      if (!requiredFeatures.every(f => auth.integration?.features.includes(f))) blockers.push("avatar_router_full_pipeline_unavailable");
      if (!requiredScopes.every(s => auth.scopes.includes(s as any))) blockers.push("avatar_full_pipeline_scopes_missing");
      if (runId) {
        const selection = await this.deps.selection(userId, runId);
        blockers.push(...selection.blockers);
      }
      selectable = blockers.length === 0;
      if (selectable) {
        const inspected = inspectTavusLimits(await this.deps.client.call(userId, "/live-limits", tavusLimitsSchema));
        runtime = inspected.limits;
        blockers.push(...inspected.blockers);
      }
    } catch (error) {
      blockers.push(error instanceof AvatarIdentityError || error instanceof TavusError ? error.code : "avatar_router_unavailable");
    }
    return { available: blockers.length === 0, selectable, blockers, runtime, maxSeconds: 120,
      evaluationAvailable: false, palStrategy: "per_session" };
  }

  async ensurePal(): Promise<string> {
    throw new TavusError("avatar_router_manages_session_pal", 409);
  }

  private async owned(userId: string, runId: string) {
    const owner = await this.deps.owner(userId, runId);
    const session = await this.deps.store.read<TavusSession>(`run:${runId}`);
    if (session && session.userId !== userId) throw new TavusError("tavus_conversation_forbidden", 403);
    if (!session && owner.run.mode === "tavus_full") throw new TavusError("tavus_session_binding_missing", 409);
    return { ...owner, session };
  }

  private publicSession(session: TavusSession | null) {
    return { state: session?.state ?? "idle", evaluationAvailable: false,
      ...(session?.expiresAt ? { expiresAt: session.expiresAt } : {}),
      ...(session?.lastError ? { error: session.lastError } : {}) };
  }

  private async remote(userId: string, session: TavusSession) {
    const auth = await this.deps.connection.check(userId);
    if (!session.projectId || auth.projectId !== session.projectId) throw new TavusError("persona_avatar_project_mismatch", 409);
    if (!session.sessionId) throw new TavusError("tavus_create_reconciliation_required", 409);
    const remote = await this.deps.client.call(userId, `/sessions/${session.sessionId}`, routerSessionSchema);
    if (remote.id !== session.sessionId || remote.avatarId !== session.avatarId ||
        (remote.avatarAssetId ?? null) !== (session.assetId ?? null)) throw new TavusError("tavus_session_mismatch", 502);
    return remote;
  }

  async session(userId: string, runId: string) {
    const { session } = await this.owned(userId, runId);
    if (!session || session.state === "ended") return this.publicSession(session);
    if (!session.sessionId) {
      if (session.state === "creating" && Date.now() - Date.parse(session.createdAt) > 60000) {
        return this.publicSession(await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
          current?.state === "creating" && !current.sessionId ? { ...current, state: "create_unknown" } : current!));
      }
      return this.publicSession(session);
    }
    const remote = await this.remote(userId, session);
    const closed = remote.rendererState === "closed" && !remote.cleanupPending && remote.status !== "active";
    const state: State = closed ? "ended" :
      session.state === "ending" || remote.stopRequested || remote.status !== "active" ||
      Date.parse(remote.expiresAt) <= Date.now() ? "ending" :
      remote.rendererState === "running" && !remote.cleanupPending ? "active" : "creating";
    const saved = await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => ({
      ...current!, state: current?.state === "ended" ? "ended" :
        current?.state === "ending" && state !== "ended" ? "ending" : state,
      expiresAt: remote.expiresAt,
    }));
    return this.publicSession(saved);
  }

  async start(userId: string, runId: string, consent: boolean) {
    if (!consent) throw new TavusError("tavus_consent_required", 400);
    const { session, run, scenarioRun } = await this.owned(userId, runId);
    if (session) return this.session(userId, runId);
    if (run.status !== "active" || scenarioRun.status === "completed") throw new TavusError("tavus_fresh_run_required");
    const config = await this.config(userId, runId);
    if (!config.available) {
      // No identities, provider credentials or raw router payloads in diagnostics.
      console.warn("[tavus] start preflight blocked", { blockers: config.blockers, runtime: config.runtime });
      throw new TavusError(config.blockers[0] ?? "tavus_not_configured",
        config.runtime ? 409 : 503, { creationAttempted: false, blockers: config.blockers });
    }
    const target = await this.deps.target(userId, runId);
    const binding = await this.deps.resolve(userId, runId);
    if (binding.context.length > 12000) throw new TavusError("tavus_context_too_large", 422);
    // Config just checked admission. The router rechecks atomically on POST;
    // no reservation or playback success is inferred from the free GET.
    const token = randomUUID();
    const pending = await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => current ?? {
      state: "creating", token, userId, runId, createdAt: new Date().toISOString(),
      projectId: target.projectId, avatarId: target.avatarId, assetId: target.assetId,
    });
    if (pending.token !== token) return this.publicSession(pending);
    try {
      // Persist paid-create fence and reject native writes before the non-idempotent POST.
      await this.deps.reserve(runId);
      const created = await this.deps.client.call(userId, "/sessions", routerSessionSchema, {
        providerId: "tavus", avatarId: target.avatarId,
        ...(target.assetId ? { avatarAssetId: target.assetId } : {}),
        mode: "live", pipeline: "tavus_full", costConfirmed: true,
        fullPipeline: { systemPrompt: ROLEPLAY_PAL_PROMPT, context: binding.context, languages: [binding.language] },
      });
      // Retain the ID even if a later identity check fails; never create again.
      const bound = await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => ({
        ...current!, sessionId: created.id, expiresAt: created.expiresAt,
      }));
      if (bound.state === "ending") return await this.end(userId, runId);
      return await this.session(userId, runId);
    } catch (error) {
      await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => ({
        ...current!, state: current?.sessionId ? "ending" : "create_unknown",
        lastError: error instanceof AvatarIdentityError || error instanceof TavusError ? error.code : "tavus_create_uncertain",
      }));
      throw error;
    }
  }

  async connection(userId: string, runId: string) {
    const state = await this.session(userId, runId);
    if (state.state !== "active") throw new TavusError("tavus_session_not_ready", 409);
    const { session } = await this.owned(userId, runId);
    const result = await this.deps.client.call(userId, `/sessions/${session!.sessionId}/full-connection`, dailyConnectionSchema);
    if (Date.parse(result.expiresAt) <= Date.now()) throw new TavusError("tavus_connection_expired", 409);
    return result;
  }

  async end(userId: string, runId: string) {
    const { session } = await this.owned(userId, runId);
    if (!session || session.state === "ended") return this.publicSession(session);
    if (!session.sessionId) {
      if (session.state === "creating" || session.state === "ending") {
        const pending = await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
          ({ ...current!, state: "ending" }));
        return this.publicSession(pending);
      }
      throw new TavusError("tavus_create_reconciliation_required", 409);
    }
    await this.remote(userId, session);
    await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => ({ ...current!, state: "ending" }));
    // End is retryable; its acknowledgement is NOT confirmation of provider cleanup.
    await this.deps.client.call(userId, `/sessions/${session.sessionId}/end`, routerSessionSchema, {});
    return this.session(userId, runId);
  }

  async sync(userId: string, runId: string) { return this.session(userId, runId); }
}
export const tavusSessions = new TavusSessions();
let workerStarted = false;
export function startTavusWorker() {
  if (workerStarted) return;
  workerStarted = true;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const row of await tavusDeps.store.pendingSessions()) {
        try {
          const state = await tavusSessions.session(row.userId, row.runId);
          if (state.state === "ending") await tavusSessions.end(row.userId, row.runId);
        } catch { console.warn("[tavus] router cleanup/status deferred"); }
      }
    } catch { console.warn("[tavus] pending-session scan deferred"); }
    finally { busy = false; }
  }, 30000);
  timer.unref();
}
