import { createHash } from "node:crypto";
import { z } from "zod";
import { storage } from "../../storage";
import { avatarTestReady, avatarTestTerminal } from "../../../shared/avatar/adminAvatarTest";
import type { AvatarVoiceChoice, AvatarVoiceTestCatalogPage, AvatarVoiceTestSession } from "../../../shared/avatar/voiceTest";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { AvatarIdentityError } from "./delegatedIdentity";
import { managedClientDescriptor, managedConnectionSchema } from "./managedClient";
import { personaAvatarValidation } from "./personaValidation";
import { testSessionSchema } from "./testContracts";

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const avatarVoiceChoiceSchema = z.object({
  voiceId: z.string().min(1).max(160).refine(id => id.trim() === id),
  gender: z.enum(["male", "female", "neutral"]).optional(),
}).strict();
export const avatarVoiceTestStartSchema = z.object({ voice: avatarVoiceChoiceSchema.optional() }).strict();

const remoteSchema = testSessionSchema.extend({
  providerId: z.enum(["anam", "tavus"]), avatarId: idSchema,
  pipeline: z.enum(["anam_full", "tavus_full"]),
});
const bindingSchema = z.object({
  id: idSchema, avatarId: idSchema, projectId: z.string(),
  requestedVoice: avatarVoiceChoiceSchema.nullable(),
});
type Binding = z.infer<typeof bindingSchema>;
const category = "avatar_voice_test";
const features = ["provider_voice_catalog_v1", "unified_client_connection", "hosted_browser_client", "unified_roleplay_context"];
const creating = new Set<string>();

function resolveTarget(target: string) {
  if (target === "anam-persona-default") return { providerId: "anam" as const, assetId: null };
  if (target === "tavus-stock-lucy") return { providerId: "tavus" as const, assetId: null };
  if (target === target.toLowerCase() && z.string().uuid().safeParse(target).success) {
    return { providerId: "tavus" as const, assetId: target };
  }
  throw new AvatarIdentityError("avatar_voice_test_target_invalid", 400);
}

function keyFor(userId: string, target: string) {
  return createHash("sha256").update(JSON.stringify([userId, target])).digest("hex");
}

/** Only diagnostic sessions created and bound by this flow can be opened or ended here. */
export class AvatarVoiceTest {
  constructor(
    private readonly client: Pick<AvatarProjectClient, "call" | "voiceCatalogPage"> = new AvatarProjectClient(storage),
    private readonly connection: Pick<typeof avatarRouterProjectConnection, "check"> = avatarRouterProjectConnection,
    private readonly store: Pick<typeof storage, "getSystemSetting" | "upsertSystemSetting"> = storage,
    private readonly custom: Pick<typeof personaAvatarValidation, "resolve"> = personaAvatarValidation,
  ) {}

  async catalog(userId: string, target: string, offset: number): Promise<AvatarVoiceTestCatalogPage> {
    const { providerId } = resolveTarget(target);
    const auth = await this.connection.check(userId);
    if (![`${providerId}_full_pipeline`, ...features].every(feature => auth.integration?.features.includes(feature))) {
      return { providerId, status: "unsupported", voices: [], nextOffset: null };
    }
    const page = await this.client.voiceCatalogPage(userId, offset);
    const status = page.providers.find(provider => provider.providerId === providerId)?.status ?? "unavailable";
    return { providerId, status, voices: status === "available" ? page.voices.filter(voice => voice.providerId === providerId && voice.available) : [],
      nextOffset: status === "available" ? page.nextOffset : null };
  }

  private verified(remote: z.infer<typeof remoteSchema>, target: string, binding: Binding): AvatarVoiceTestSession {
    const { providerId, assetId } = resolveTarget(target);
    if (remote.id !== binding.id || remote.avatarId !== binding.avatarId || remote.providerId !== providerId ||
        remote.pipeline !== `${providerId}_full` || (remote.avatarAssetId ?? null) !== assetId ||
        (assetId && remote.purpose !== "validation")) {
      throw new AvatarIdentityError("avatar_voice_test_session_mismatch", 502);
    }
    return { ...remote, requestedVoice: binding.requestedVoice };
  }

  private async binding(userId: string, target: string): Promise<Binding | null> {
    resolveTarget(target);
    const saved = await this.store.getSystemSetting(category, keyFor(userId, target));
    if (!saved) return null;
    const binding = bindingSchema.parse(JSON.parse(saved.value));
    const auth = await this.connection.check(userId);
    return binding.projectId === auth.projectId ? binding : null;
  }

  async create(userId: string, target: string, voice?: AvatarVoiceChoice) {
    const { providerId, assetId } = resolveTarget(target);
    if (creating.has(userId)) throw new AvatarIdentityError("avatar_test_creation_in_progress", 409);
    creating.add(userId);
    try {
      const auth = await this.connection.check(userId);
      const required = [`${providerId}_full_pipeline`, ...features.filter(f => voice || f !== "provider_voice_catalog_v1")];
      if (!required.every(feature => auth.integration?.features.includes(feature))) {
        throw new AvatarIdentityError("avatar_voice_test_unsupported", 409);
      }
      const avatarId = assetId ? (await this.custom.resolve(userId, assetId)).providerAvatarId : target;
      if (!idSchema.safeParse(avatarId).success) throw new AvatarIdentityError("avatar_voice_test_target_invalid", 409);
      // The router owns catalog membership, provider readiness, and paid admission.
      // A selected voice is sent as-is and is never retried as the default.
      const remote = await this.client.call(userId, "/sessions", remoteSchema, {
        providerId, avatarId, mode: "live", pipeline: `${providerId}_full`, costConfirmed: true,
        ...(assetId ? { avatarAssetId: assetId, purpose: "validation" } : {}),
        fullPipeline: {
          systemPrompt: "당신은 라이브 아바타 음성 연결을 확인하는 대화 상대입니다. 한국어로 자연스럽고 짧게 답하세요.",
          context: "관리자가 선택한 음성을 들어 보는 짧은 연결 테스트입니다. 학습 시나리오나 평가가 아닙니다.",
          languages: ["ko"],
          ...(voice ? { voiceId: voice.voiceId, ...(voice.gender ? { voiceGender: voice.gender } : {}) } : {}),
        },
      });
      const binding = { id: remote.id, projectId: auth.projectId, avatarId, requestedVoice: voice ?? null };
      const session = this.verified(remote, target, binding);
      try {
        await this.store.upsertSystemSetting({ category, key: keyFor(userId, target), updatedBy: userId,
          value: JSON.stringify(binding), description: "Latest bound administrator voice test for this avatar" });
      } catch (error) {
        // Best-effort cleanup only for the exact verified session just created.
        await this.client.call(userId, `/sessions/${remote.id}/end`, remoteSchema, {}).catch(() => {});
        throw error;
      }
      return session;
    } finally {
      creating.delete(userId);
    }
  }

  async session(userId: string, target: string, id?: string) {
    const binding = await this.binding(userId, target);
    if (id !== undefined && (!binding || id !== binding.id)) {
      throw new AvatarIdentityError("avatar_voice_test_session_not_found", 404);
    }
    if (!binding) return null;
    const remote = await this.client.call(userId, `/sessions/${binding.id}`, remoteSchema);
    return this.verified(remote, target, binding);
  }

  async connectionToken(userId: string, target: string, id: string) {
    const session = await this.session(userId, target, id);
    if (!session || !avatarTestReady(session) || Date.parse(session.expiresAt) <= Date.now()) {
      throw new AvatarIdentityError("avatar_test_session_not_running", 409);
    }
    const connection = await this.client.call(userId, `/sessions/${id}/client-connection`, managedConnectionSchema, {});
    if (connection.pipeline !== `${session.providerId}_full`) throw new AvatarIdentityError("avatar_voice_test_session_mismatch", 502);
    return managedClientDescriptor(connection, id);
  }

  async stop(userId: string, target: string, id: string, end: boolean) {
    const session = await this.session(userId, target, id);
    if (!session || avatarTestTerminal(session)) return session;
    const remote = await this.client.call(userId, `/sessions/${id}/${end ? "end" : "interrupt"}`, remoteSchema, {});
    return this.verified(remote, target, { id, avatarId: session.avatarId, projectId: "", requestedVoice: session.requestedVoice });
  }
}
