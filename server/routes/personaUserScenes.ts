import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { generatePersonaScene } from "../services/personaSceneGenerator";
import { asyncHandler, createHttpError } from "./routerHelpers";

const createSceneSchema = z.object({
  title: z.string().min(1, "제목을 입력해주세요.").max(200),
  description: z.string().max(1000).optional().default(""),
  setting: z.string().max(2000).optional().default(""),
  mood: z.string().max(500).optional().default(""),
  openingLine: z.string().max(1000).optional().default(""),
  genre: z.string().max(100).optional().default("일상"),
  tags: z.array(z.string().max(50)).max(10).optional().default([]),
  isPublic: z.boolean().optional().default(false),
});

const updateSceneSchema = createSceneSchema.partial();

const generateSceneSchema = z.object({
  idea: z.string().min(1, "아이디어를 입력해주세요.").max(2000),
  personaName: z.string().min(1).max(200).optional().default("캐릭터"),
  personaDescription: z.string().max(2000).optional(),
});

function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: "Access denied. System admin only." });
    return;
  }
  next();
}

export default function createPersonaUserScenesRouter(isAuthenticated: any) {
  const router = Router();

  router.get(
    "/api/persona-user-scenes",
    isAuthenticated,
    requireAdmin,
    asyncHandler(async (req: any, res) => {
      const genre = typeof req.query.genre === "string" ? req.query.genre : undefined;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const mine = req.query.mine === "true";
      const userId = req.user?.id;

      if (mine) {
        const scenes = await storage.getPersonaUserScenesByCreator(userId, search);
        return res.json(scenes);
      }

      const scenes = await storage.getPublicPersonaUserScenes({ genre, search });
      res.json(scenes);
    })
  );

  router.post(
    "/api/persona-user-scenes/generate",
    isAuthenticated,
    requireAdmin,
    asyncHandler(async (req: any, res) => {
      const parsed = generateSceneSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createHttpError(400, parsed.error.errors[0]?.message || "잘못된 요청입니다.");
      }
      const { idea, personaName, personaDescription } = parsed.data;
      const scene = await generatePersonaScene({
        idea: idea.trim(),
        personaName: (personaName || "캐릭터").trim(),
        personaDescription: personaDescription?.trim(),
      });
      res.json(scene);
    })
  );

  router.get(
    "/api/persona-user-scenes/:id",
    isAuthenticated,
    requireAdmin,
    asyncHandler(async (req: any, res) => {
      const scene = await storage.getPersonaUserSceneById(req.params.id);
      if (!scene) throw createHttpError(404, "장면을 찾을 수 없습니다.");
      if (!scene.isPublic && scene.creatorId !== req.user?.id) {
        throw createHttpError(403, "이 장면에 접근할 권한이 없습니다.");
      }
      res.json(scene);
    })
  );

  router.post(
    "/api/persona-user-scenes",
    isAuthenticated,
    requireAdmin,
    asyncHandler(async (req: any, res) => {
      const parsed = createSceneSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createHttpError(400, parsed.error.errors[0]?.message || "잘못된 요청입니다.");
      }
      const userId = req.user?.id;
      const scene = await storage.createPersonaUserScene({
        ...parsed.data,
        creatorId: userId,
      });
      res.status(201).json(scene);
    })
  );

  router.patch(
    "/api/persona-user-scenes/:id",
    isAuthenticated,
    requireAdmin,
    asyncHandler(async (req: any, res) => {
      const parsed = updateSceneSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createHttpError(400, parsed.error.errors[0]?.message || "잘못된 요청입니다.");
      }
      const userId = req.user?.id;
      const existing = await storage.getPersonaUserSceneById(req.params.id);
      if (!existing) throw createHttpError(404, "장면을 찾을 수 없습니다.");
      if (existing.creatorId !== userId) throw createHttpError(403, "이 장면을 수정할 권한이 없습니다.");
      const scene = await storage.updatePersonaUserScene(req.params.id, userId, parsed.data);
      res.json(scene);
    })
  );

  router.delete(
    "/api/persona-user-scenes/:id",
    isAuthenticated,
    requireAdmin,
    asyncHandler(async (req: any, res) => {
      const userId = req.user?.id;
      const existing = await storage.getPersonaUserSceneById(req.params.id);
      if (!existing) throw createHttpError(404, "장면을 찾을 수 없습니다.");
      if (existing.creatorId !== userId) throw createHttpError(403, "이 장면을 삭제할 권한이 없습니다.");
      await storage.deletePersonaUserScene(req.params.id, userId);
      res.json({ success: true });
    })
  );

  router.post(
    "/api/persona-user-scenes/:id/use",
    isAuthenticated,
    requireAdmin,
    asyncHandler(async (req: any, res) => {
      const scene = await storage.getPersonaUserSceneById(req.params.id);
      if (!scene) throw createHttpError(404, "장면을 찾을 수 없습니다.");
      if (!scene.isPublic && scene.creatorId !== req.user?.id) {
        throw createHttpError(403, "이 장면에 접근할 권한이 없습니다.");
      }
      await storage.incrementPersonaUserSceneUseCount(req.params.id);
      res.json({ success: true });
    })
  );

  return router;
}
