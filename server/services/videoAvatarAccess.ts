import type { Request } from "express";
import { storage } from "../storage";
import { createHttpError } from "../routes/routerHelpers";

export const VIDEO_AVATAR_ACCESS_SETTING = {
  category: "features",
  key: "operator_video_avatar_enabled",
  description: "Allow operators to manage video avatar clips and scenario video-avatar settings",
} as const;

export function parseBooleanSetting(value: string | undefined): boolean {
  return value === "true";
}

export async function isVideoAvatarManagementAllowed(user: any): Promise<boolean> {
  if (user?.role === "admin") return true;
  if (user?.role !== "operator") return false;

  const setting = await storage.getSystemSetting(
    VIDEO_AVATAR_ACCESS_SETTING.category,
    VIDEO_AVATAR_ACCESS_SETTING.key,
  );
  return parseBooleanSetting(setting?.value);
}

export async function requireVideoAvatarManagementAccess(req: Request): Promise<void> {
  if (!(await isVideoAvatarManagementAllowed((req as any).user))) {
    throw createHttpError(403, "Video avatar management is disabled for operators.");
  }
}

export function hasVideoAvatarConfiguration(videos: unknown): boolean {
  if (!videos || typeof videos !== "object") return false;
  const value = videos as Record<string, unknown>;
  if (value.enabled === true) return true;
  if (typeof value.avatarId === "string" && value.avatarId.trim() !== "") return true;
  const clips = value.clips;
  return !!clips && typeof clips === "object" && Object.values(clips as Record<string, unknown>)
    .some((group) => group && typeof group === "object" && Object.keys(group as object).length > 0);
}