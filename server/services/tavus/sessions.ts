import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TavusClient, TavusError, palSchema, createdPalSchema, createdConversationSchema, conversationSchema, conversationJoinUrl } from "./client";
import { resolveTavusContext, resolveTavusOwner, ROLEPLAY_PAL_PROMPT } from "./context";
import { TavusStore } from "./store";
import { adaptTavusTranscript, transcriptHash, type TavusMessage } from "./transcriptAdapter";
import { importTavusTranscript, reserveTavusRun } from "./importTranscript";

type State = "creating" | "create_unknown" | "active" | "ending" | "transcript_pending" | "completed";
export interface TavusSession {
  state: State; token: string; userId: string; runId: string; createdAt: string;
  conversationId?: string; conversationUrl?: string; messages?: TavusMessage[];
  transcriptHash?: string; syncUntil?: number; lastError?: string;
}
interface PalRecord { state: "creating" | "create_unknown" | "ready"; token: string; palId?: string }

export const tavusDeps = {
  client: new TavusClient(), store: new TavusStore(), resolve: resolveTavusContext,
  owner: resolveTavusOwner,
  reserve: reserveTavusRun, importTranscript: importTavusTranscript, env: process.env,
};

export class TavusSessions {
  constructor(private readonly deps = tavusDeps) {}

  async config() {
    const saved = await this.deps.store.read<PalRecord>("pal");
    const blockers = [
      ...(!this.deps.env.TAVUS_API_KEY ? ["tavus_api_key_missing"] : []),
      ...(!this.deps.env.TAVUS_PAL_ID && !this.deps.env.TAVUS_DEFAULT_FACE_ID && saved?.state !== "ready"
        ? ["tavus_pal_or_face_missing"] : []),
      ...(!this.deps.env.TAVUS_PAL_ID && saved && saved.state !== "ready" ? ["tavus_pal_setup_pending"] : []),
    ];
    return { available: blockers.length === 0, blockers };
  }

  async ensurePal() {
    if (!this.deps.env.TAVUS_API_KEY) throw new TavusError("tavus_not_configured", 503);
    if (this.deps.env.TAVUS_PAL_ID) {
      const pal = await this.deps.client.call(`/pals/${encodeURIComponent(this.deps.env.TAVUS_PAL_ID)}`, palSchema);
      return pal.pal_id;
    }
    const saved = await this.deps.store.read<PalRecord>("pal");
    if (saved?.state === "ready") {
      const pal = await this.deps.client.call(`/pals/${encodeURIComponent(saved.palId!)}`, palSchema);
      return pal.pal_id;
    }
    if (!this.deps.env.TAVUS_DEFAULT_FACE_ID) throw new TavusError("tavus_pal_or_face_missing", 503);
    const token = randomUUID();
    const record = await this.deps.store.mutate<PalRecord>("pal", current =>
      current ?? { state: "creating", token });
    if (record.state === "ready") return record.palId!;
    if (record.token !== token) throw new TavusError("tavus_pal_setup_pending");
    try {
      const created = await this.deps.client.call("/pals", createdPalSchema, {
        pal_name: "RoleplayX Common Roleplay", pipeline_mode: "full",
        default_face_id: this.deps.env.TAVUS_DEFAULT_FACE_ID, system_prompt: ROLEPLAY_PAL_PROMPT,
        layers: {
          perception: { perception_model: "off" },
          stt: { stt_engine: "tavus-auto" },
          conversational_flow: { turn_detection_model: "sparrow-2", pal_interruptibility: "high" },
        },
      });
      await this.deps.store.mutate<PalRecord>("pal", () => ({ state: "ready", token, palId: created.pal_id }));
      return created.pal_id;
    } catch (error) {
      await this.deps.store.mutate<PalRecord>("pal", () => ({ state: "create_unknown", token }));
      throw error;
    }
  }

  private async owned(userId: string, runId: string) {
    const ownership = await this.deps.owner(userId, runId);
    let session = await this.deps.store.read<TavusSession>(`run:${runId}`);
    if (!session && ownership.run.mode === "tavus_full") {
      session = { state: "create_unknown", token: "missing-binding", runId, userId,
        createdAt: new Date().toISOString(), lastError: "tavus_session_binding_missing" };
    }
    if (session && session.userId !== userId) throw new TavusError("tavus_conversation_forbidden", 403);
    return { ...ownership, session };
  }

  private publicSession(session: TavusSession | null) {
    return session ? {
      state: session.state,
      ...(session.state === "active" ? { conversationUrl: session.conversationUrl } : {}),
      ...(session.messages ? { messages: session.messages } : {}),
      ...(session.lastError ? { error: session.lastError } : {}),
    } : { state: "idle" };
  }

  async session(userId: string, runId: string) {
    const { session } = await this.owned(userId, runId);
    if (session?.state === "creating" && Date.now() - Date.parse(session.createdAt) > 60000) {
      return this.publicSession(await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
        current?.state === "creating" ? { ...current, state: "create_unknown" } : current!));
    }
    return this.publicSession(session);
  }

  async start(userId: string, runId: string, consent: boolean) {
    if (!consent) throw new TavusError("tavus_consent_required", 400);
    const { session: existing } = await this.owned(userId, runId);
    if (existing) return this.publicSession(existing); // no second paid creation, including unknown outcomes
    const binding = await this.deps.resolve(userId, runId);
    if (binding.run.status !== "active" || binding.scenarioRun.status === "completed") throw new TavusError("tavus_fresh_run_required");
    if (!(await this.config()).available) throw new TavusError("tavus_not_configured", 503);
    const palId = await this.ensurePal();
    const token = randomUUID();
    const pending = await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
      current ?? { state: "creating", token, userId, runId, createdAt: new Date().toISOString() });
    if (pending.token !== token) return this.publicSession(pending);
    // Durable create fence must commit before sending any billable request.
    let reserved = false;
    try {
      await this.deps.reserve(runId);
      reserved = true;
      const result = await this.deps.client.call("/conversations", createdConversationSchema, {
        pal_id: palId, conversational_context: binding.context,
        conversation_name: `RoleplayX ${runId}`, dynamic_greeting: true,
        require_auth: true, max_participants: 2,
        properties: { languages: [binding.language], max_call_duration: Math.min(1800, Math.max(60,
          Math.round((binding.scenario?.targetDurationMinutes ?? 30) * 60))),
          participant_left_timeout: 20, participant_absent_timeout: 60, enable_closed_captions: true,
          enable_recording: false },
      });
      // Persist provider identity BEFORE validating its room URL so cleanup is still possible.
      await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
        ({ ...current!, conversationId: result.conversation_id, state: "ending" }));
      const conversationUrl = conversationJoinUrl(result);
      const active = await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
        ({ ...current!, conversationUrl, state: "active" }));
      return this.publicSession(active);
    } catch (error) {
      await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => ({
        ...current!, state: current?.conversationId ? "ending" : "create_unknown",
        lastError: error instanceof TavusError ? error.code : reserved ? "tavus_create_uncertain" : "tavus_fresh_run_required",
      }));
      throw error;
    }
  }

  async end(userId: string, runId: string) {
    const { session } = await this.owned(userId, runId);
    if (!session || session.state === "completed" || session.state === "transcript_pending") return this.publicSession(session);
    if (!session.conversationId) throw new TavusError("tavus_create_reconciliation_required");
    await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => ({ ...current!, state: "ending" }));
    // End is safe to retry; only creation is fenced against retries.
    await this.deps.client.call(`/conversations/${session.conversationId}/end`, z.object({}), {});
    const ended = await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
      ({ ...current!, state: current?.state === "completed" ? "completed" : "transcript_pending" }));
    return this.publicSession(ended);
  }

  async sync(userId: string, runId: string) {
    const { session } = await this.owned(userId, runId);
    if (!session?.conversationId || session.state === "completed") return this.publicSession(session);
    if (session.state === "ending") await this.end(userId, runId);
    const now = Date.now(), token = randomUUID();
    // Cross-worker import lease; deterministic import IDs also protect crash/retry recovery.
    const claimed = await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => {
      if (!current || (current.syncUntil ?? 0) > now) return current!;
      return { ...current, token, syncUntil: now + 120000 };
    });
    if (claimed.token !== token) return this.publicSession(claimed);
    try {
      const conversation = await this.deps.client.call(`/conversations/${session.conversationId}?verbose=true`, conversationSchema);
      if (conversation.conversation_id !== session.conversationId) throw new TavusError("tavus_conversation_mismatch", 502);
      const messages = adaptTavusTranscript(conversation);
      if (messages !== null) {
        const hash = transcriptHash(messages);
        if (claimed.transcriptHash && claimed.transcriptHash !== hash) throw new TavusError("tavus_transcript_changed");
        await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
          ({ ...current!, transcriptHash: hash, state: "transcript_pending" }));
        const binding = await this.deps.resolve(userId, runId);
        await this.deps.importTranscript(binding, session.conversationId, messages);
        await this.deps.store.mutate<TavusSession>(`run:${runId}`, current =>
          ({ ...current!, state: "completed", messages, conversationUrl: undefined, lastError: undefined }));
      } else if (conversation.status === "ended") {
        await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => ({ ...current!, state: "transcript_pending" }));
      }
    } finally {
      await this.deps.store.mutate<TavusSession>(`run:${runId}`, current => ({ ...current!, syncUntil: 0 }));
    }
    return this.publicSession(await this.deps.store.read<TavusSession>(`run:${runId}`));
  }
}

export const tavusSessions = new TavusSessions();

let workerStarted = false;
/** Recovers safe reads/end/import after page exit or process restart. Never creates paid sessions. */
export function startTavusWorker() {
  if (workerStarted) return;
  workerStarted = true;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || !process.env.TAVUS_API_KEY) return;
    busy = true;
    try {
      const pending = await tavusDeps.store.pendingSessions();
      for (const session of pending) {
        try { await tavusSessions.sync(session.userId, session.runId); }
        catch (error) {
          console.warn("[tavus] session synchronization deferred",
            error instanceof TavusError ? error.code : "tavus_sync_failed");
        }
      }
    } catch {
      console.warn("[tavus] pending-session scan deferred");
    } finally { busy = false; }
  }, 30000);
  timer.unref();
}
