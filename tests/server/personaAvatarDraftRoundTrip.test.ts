import { beforeEach, describe, expect, it, vi } from "vitest";
const rows = vi.hoisted(() => new Map<string, any>());
vi.mock("../../server/storage", () => ({
  storage: {
    getMbtiPersona: vi.fn(async (id: string) => rows.get(id)),
    getAllMbtiPersonas: vi.fn(async () => [...rows.values()]),
    createMbtiPersona: vi.fn(async (input: any) => { rows.set(input.id, input); return input; }),
    updateMbtiPersona: vi.fn(async (id: string, patch: any) => {
      const updated = { ...rows.get(id), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
      rows.set(id, updated); return updated;
    }),
  },
}));
import { fileManager } from "../../server/services/fileManager";
import { readFileSync } from "node:fs";
const draft = {
  assetId: "12345678-1234-4234-8234-123456789abc", providerId: "tavus",
  projectId: "project-one", validationStatus: "unverified", voiceMode: "roleplayx", activation: "draft",
};
beforeEach(() => rows.clear());
describe("persona draft storage compatibility", () => {
  it("round-trips create, list and edit while preserving images and video slots", async () => {
    const media = { images: { base: "portrait.webp" }, videos: { enabled: true, clips: { male: { speaking_neutral: "clip.mp4" } } } };
    await fileManager.createMBTIPersona({ id: "manager", mbti: "ENTJ", ...media, avatarMode: "live", liveAvatar: draft });
    expect((await fileManager.getAllMBTIPersonas())[0]).toMatchObject({ ...media, avatarMode: "live", liveAvatar: draft });
    await fileManager.updateMBTIPersona("manager", { mbti: "ENTJ", motivation: "updated" });
    expect(rows.get("manager")).toMatchObject({ ...media, avatarMode: "live", liveAvatar: draft });
    await fileManager.updateMBTIPersona("manager", { avatarMode: "image", liveAvatar: null });
    expect((await fileManager.getAllMBTIPersonas())[0]).toMatchObject({ avatarMode: "image", liveAvatar: null });
  });

  it("does not backfill legacy image/video records with live settings", async () => {
    rows.set("legacy", { id: "legacy", mbti: "INTJ", videos: { enabled: true } });
    expect((await fileManager.getAllMBTIPersonas())[0]).toMatchObject({ avatarMode: null, liveAvatar: null, videos: { enabled: true } });
  });

  it("ensures new columns through BOTH startup and numbered migration paths", () => {
    const startup = readFileSync("server/migrate.ts", "utf8");
    const migration = readFileSync("migrations/0022_persona_live_avatar_drafts.sql", "utf8");
    for (const column of ["avatar_mode", "live_avatar"]) {
      expect(startup).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).not.toMatch(/\bUPDATE\b/i);
  });
});
