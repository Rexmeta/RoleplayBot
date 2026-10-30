/** Authentication success is not evidence that the remote build supports custom live playback. */
export function supportsCustomLiveContract(integration: unknown): boolean {
  if (!integration || typeof integration !== "object") return false;
  const contract = integration as { features?: unknown; customLiveProviders?: unknown };
  return Array.isArray(contract.features) &&
    contract.features.includes("custom_live_validation") &&
    contract.features.includes("client_playback_report") &&
    Array.isArray(contract.customLiveProviders) &&
    contract.customLiveProviders.includes("tavus");
}
