import type { PersonaVoice } from "./personaAvatar";
import type { AvatarTestSession } from "./adminAvatarTest";

export type AvatarVoiceChoice = { voiceId: string; gender?: "male" | "female" | "neutral" };
export type AvatarVoiceTestCatalogPage = {
  providerId: "tavus" | "anam";
  status: "available" | "unavailable" | "unconfigured" | "unsupported";
  voices: PersonaVoice[];
  nextOffset: number | null;
};
export type AvatarVoiceTestSession = AvatarTestSession & {
  requestedVoice: AvatarVoiceChoice | null;
};
