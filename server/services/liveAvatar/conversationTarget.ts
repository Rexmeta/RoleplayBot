import { z } from "zod";
import { storage } from "../../storage";
import { fileManager } from "../fileManager";
import { ledgerRuntimeBinding } from "../conversationLedger/transcript";
import { resolveRuntimeScenario, RUNTIME_PERSONA_PROFILE_KEY } from "../runtimeScenario";
import { personaLiveAvatarSchema, personaAvatarAssetSchema, personaStockAvatarSchema } from "../../../shared/avatar/personaAvatar";
import { AvatarIdentityError } from "./delegatedIdentity";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { testScopes } from "./testContracts";
import { nativeScopes } from "./managedClient";
import { conversationActor } from "../../../shared/conversationActor";

export const conversationTargetDeps = {
  storage, fileManager, ledgerRuntimeBinding,
  client: new AvatarProjectClient(storage), connection: avatarRouterProjectConnection,
};

export async function ownedAvatarConversation(userId: string, conversationId: string, deps = conversationTargetDeps) {
  const personaRun = await deps.storage.getPersonaRun(conversationId);
  const scenarioRun = personaRun && await deps.storage.getScenarioRun(personaRun.scenarioRunId);
  if (!personaRun || !scenarioRun || scenarioRun.userId !== userId) {
    throw new AvatarIdentityError("avatar_conversation_forbidden", 403);
  }
  return { personaRun, scenarioRun };
}

/** Local-only inspection: no provider requests, credentials, media, or session recovery. */
async function selectedAvatarReference(
  conversationId: string,
  personaRun: any,
  scenarioRun: any,
  deps: typeof conversationTargetDeps,
) {
  const ledger = await deps.ledgerRuntimeBinding(conversationId);
  const boundRun = ledger ? { ...scenarioRun, scenarioSnapshot: ledger.scenarioSnapshot,
    evaluationHarnessSnapshot: ledger.evaluationHarnessSnapshot } : scenarioRun;
  const live = boundRun.scenarioSnapshot ? null :
    (await deps.fileManager.getAllScenarios()).find(s => s.id === scenarioRun.scenarioId);
  const scenario = resolveRuntimeScenario(boundRun, live);
  const actor = scenario && conversationActor<any>(scenario.personas, personaRun);
  if (!actor) throw new AvatarIdentityError("avatar_persona_not_found", 409);
  const profile = boundRun.scenarioSnapshot
    ? actor[RUNTIME_PERSONA_PROFILE_KEY] ?? actor
    : actor.personaRef ? await deps.fileManager.getPersonaAvatarSettings(actor.personaRef) : actor;
  const mode = actor.avatarMode ?? profile?.avatarMode;
  const reference = personaLiveAvatarSchema.safeParse(actor.liveAvatar ?? profile?.liveAvatar);
  if (mode !== "live" || !reference.success) throw new AvatarIdentityError("avatar_persona_not_selected", 409);
  return { selected: reference.data, personaId: actor.id ?? personaRun.personaId };
}

export async function inspectConversationAvatarSelection(userId: string, conversationId: string, deps = conversationTargetDeps) {
  const { personaRun, scenarioRun } = await ownedAvatarConversation(userId, conversationId, deps);
  const [global, policy] = await Promise.all([
    deps.storage.getSystemSetting("live_avatar", "enabled"),
    deps.storage.getSystemSetting("live_avatar_policy", scenarioRun.scenarioId),
  ]);
  const enabled = global?.value === "true", allowed = policy?.value === "true";
  const blockers: string[] = [
    ...(!enabled ? ["globally_disabled"] : []),
    ...(!allowed ? ["scenario_not_allowed"] : []),
  ];
  let configured = false;
  let personaId = personaRun.personaId;
  let providerId: "tavus" | "anam" | undefined;
  try {
    const selection = await selectedAvatarReference(conversationId, personaRun, scenarioRun, deps);
    personaId = selection.personaId;
    providerId = selection.selected.providerId;
    configured = true;
  } catch (error) {
    if (!(error instanceof AvatarIdentityError)) throw error;
    blockers.push(error.code);
  }
  if (personaRun.status === "completed" || scenarioRun.status === "completed") blockers.push("avatar_conversation_ended");
  return { configured, enabled, allowed, blockers, personaId, providerId };
}

/** Resolve only the run's selected actor. Published snapshots never borrow mutable persona settings. */
export async function resolveConversationAvatar(
  userId: string, conversationId: string, deps = conversationTargetDeps,
  pipeline: "render" | "full" = "render",
) {
  const { personaRun, scenarioRun } = await ownedAvatarConversation(userId, conversationId, deps);
  if (personaRun.mode === "tavus_full" && pipeline !== "full") throw new AvatarIdentityError("tavus_full_pipeline_active", 409);
  if (personaRun.status === "completed" || scenarioRun.status === "completed") {
    throw new AvatarIdentityError("avatar_conversation_ended", 409);
  }
  const [global, policy] = await Promise.all([
    deps.storage.getSystemSetting("live_avatar", "enabled"),
    deps.storage.getSystemSetting("live_avatar_policy", scenarioRun.scenarioId),
  ]);
  if (global?.value !== "true" || policy?.value !== "true") {
    throw new AvatarIdentityError(global?.value !== "true" ? "globally_disabled" : "scenario_not_allowed", 409);
  }
  const { selected, personaId } = await selectedAvatarReference(conversationId, personaRun, scenarioRun, deps);
  const auth = await deps.connection.check(userId);
  const scopes = pipeline === "full"
    ? ["sessions:create", "sessions:read", "sessions:connect", "sessions:end"]
    : selected.providerId === "anam" ? nativeScopes : testScopes;
  if (![...scopes, "assets:read"].every(scope => auth.scopes.includes(scope as any))) {
    throw new AvatarIdentityError("avatar_conversation_scopes_missing", 403);
  }
  if (selected.projectId && selected.projectId !== auth.projectId) {
    throw new AvatarIdentityError("persona_avatar_project_mismatch", 409);
  }
  if (selected.kind === "stock") {
    const stock = await deps.client.call(userId, "/avatars", z.array(personaStockAvatarSchema).max(1000));
    if (!stock.some(a => a.id === selected.avatarId && a.providerId === selected.providerId)) {
      throw new AvatarIdentityError("persona_stock_avatar_unavailable", 409);
    }
    return { projectId: auth.projectId, avatarId: selected.avatarId, assetId: null, providerId: selected.providerId,
      personaId };
  }
  // Resolve the saved identity only. Readiness and playback validation belong
  // to AvatarRouter for both rendering and full-pipeline connections.
  const asset = await deps.client.call(userId, `/avatar-assets/${selected.assetId}`, personaAvatarAssetSchema);
  if (asset.id !== selected.assetId || asset.providerId !== selected.providerId) {
    throw new AvatarIdentityError("persona_avatar_asset_mismatch", 502);
  }
  if (!asset.providerAvatarId) throw new AvatarIdentityError("persona_avatar_provider_reference_missing", 409);
  return { projectId: auth.projectId, avatarId: asset.providerAvatarId, assetId: asset.id,
    providerId: selected.providerId, personaId };
}

/** Full-pipeline starts resolve identity only; legacy PCM validation is unrelated. */
export function resolveFullPipelineConversationAvatar(userId: string, conversationId: string, deps = conversationTargetDeps) {
  return resolveConversationAvatar(userId, conversationId, deps, "full");
}
