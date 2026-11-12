import { z } from "zod";
import { storage } from "../../storage";
import { fileManager } from "../fileManager";
import { ledgerRuntimeBinding } from "../conversationLedger/transcript";
import { findRuntimePersona, resolveRuntimeScenario, RUNTIME_PERSONA_PROFILE_KEY } from "../runtimeScenario";
import { personaLiveAvatarSchema, personaAvatarAssetSchema, personaStockAvatarSchema,
  isLiveValidatedPersonaAvatar, isSelectableStockAvatar } from "../../../shared/avatar/personaAvatar";
import { supportsCustomLiveContract } from "../../../shared/avatar/routerContract";
import { AvatarIdentityError } from "./delegatedIdentity";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { testScopes } from "./testContracts";
import { nativeScopes } from "./managedClient";
import { seedLiveOptionsSchema } from "../../../shared/avatar/personaSeedLive";

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
  const activeIndex = personaRun.activePersonaIndex;
  const activeActor = scenario && Number.isInteger(activeIndex) && activeIndex >= 0
    ? scenario.personas?.[activeIndex] : null;
  const actor = activeActor ?? (scenario && findRuntimePersona(scenario, personaRun.personaId));
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
export async function resolveConversationAvatar(userId: string, conversationId: string, deps = conversationTargetDeps) {
  const { personaRun, scenarioRun } = await ownedAvatarConversation(userId, conversationId, deps);
  if (personaRun.mode === "tavus_full") throw new AvatarIdentityError("tavus_full_pipeline_active", 409);
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
  const scopes = selected.providerId === "anam" ? nativeScopes : testScopes;
  if (![...scopes, "assets:read"].every(scope => auth.scopes.includes(scope as any))) {
    throw new AvatarIdentityError("avatar_conversation_scopes_missing", 403);
  }
  if (selected.projectId && selected.projectId !== auth.projectId) {
    throw new AvatarIdentityError("persona_avatar_project_mismatch", 409);
  }
  if (selected.kind === "stock") {
    const stock = await deps.client.call(userId, "/avatars", z.array(personaStockAvatarSchema).max(1000));
    if (!stock.some(a => a.id === selected.avatarId && a.providerId === selected.providerId && isSelectableStockAvatar(a))) {
      throw new AvatarIdentityError("persona_stock_avatar_unavailable", 409);
    }
    return { projectId: auth.projectId, avatarId: selected.avatarId, assetId: null, providerId: selected.providerId,
      personaId };
  }
  if (selected.providerId !== "tavus" || !supportsCustomLiveContract(auth.integration)) {
    throw new AvatarIdentityError("persona_avatar_custom_runtime_unavailable", 409);
  }
  let seedProviderAvatarId: string | undefined;
  if (selected.seedImageAssetId) {
    const options = await deps.client.call(userId, `/assets/images/${selected.seedImageAssetId}/live-options`, seedLiveOptionsSchema);
    const candidate = options.candidates.find(c => c.avatarAssetId === selected.assetId);
    if (options.imageAssetId !== selected.seedImageAssetId || options.imageVersion !== selected.seedImageVersion ||
        !candidate?.canActivate || candidate.liveReference?.avatarAssetId !== selected.assetId) {
      throw new AvatarIdentityError("persona_avatar_playback_validation_required", 409);
    }
    seedProviderAvatarId = candidate.liveReference.avatarId;
  }
  const asset = await deps.client.call(userId, `/avatar-assets/${selected.assetId}`, personaAvatarAssetSchema);
  if (asset.id !== selected.assetId || asset.providerId !== selected.providerId ||
      !asset.liveValidation?.runtimeSupported || !isLiveValidatedPersonaAvatar(asset) ||
      seedProviderAvatarId && asset.providerAvatarId !== seedProviderAvatarId) {
    throw new AvatarIdentityError("persona_avatar_playback_validation_required", 409);
  }
  return { projectId: auth.projectId, avatarId: asset.providerAvatarId!, assetId: asset.id, providerId: selected.providerId,
    personaId };
}
