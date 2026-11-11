import { z } from "zod";

export const personaAvatarCreationInput = z.object({
  name: z.string().trim().min(1).max(80),
  imageBase64: z.string().min(4).max(6_000_000)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  likeness: z.enum(["synthetic", "real_person"]),
  consentReference: z.string().trim().min(1).max(200).optional(),
  rightsConfirmed: z.literal(true),
  transferConfirmed: z.literal(true),
  costConfirmed: z.literal(true),
}).strict().refine(v => v.likeness !== "real_person" || Boolean(v.consentReference), {
  message: "실존 인물은 동의 증빙 참조가 필요합니다.", path: ["consentReference"],
});

export type PersonaAvatarCreationInput = z.infer<typeof personaAvatarCreationInput>;
export type PersonaAvatarCreationState = {
  stage: "idle" | "ingesting" | "image_ready" | "provisioning" | "submitted";
  imageId?: string;
  assetId?: string;
  consentStatus?: "not_required" | "pending_review" | "verified";
  uncertain: boolean;
};
