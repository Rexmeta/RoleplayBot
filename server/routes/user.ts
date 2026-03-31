import { Router } from "express";
import { storage } from "../storage";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { generateSceneOpeningLine } from "../services/personaSceneGenerator";

const sceneSchema = z.object({
  title: z.string().max(200).optional(),
  setting: z.string().max(1000),
  mood: z.string().max(500),
  openingLine: z.string().max(1000).optional(),
  genre: z.string().max(100).optional(),
}).nullable();

export default function createUserRouter(isAuthenticated: any) {
  const router = Router();

  router.patch("/api/user/profile", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createHttpError(401, "Unauthorized");
    }

    const { name, currentPassword, newPassword, profileImage } = req.body;

    const user = await storage.getUser(userId);
    if (!user) {
      throw createHttpError(404, "User not found");
    }

    const updates: { name?: string; password?: string; profileImage?: string } = {};

    if (name && name.trim()) {
      updates.name = name.trim();
    }

    if (profileImage !== undefined) {
      updates.profileImage = profileImage;
    }

    if (newPassword) {
      if (!currentPassword) {
        throw createHttpError(400, "Current password is required to change password");
      }

      const { verifyPassword, hashPassword } = await import('../auth');
      const isValidPassword = await verifyPassword(currentPassword, user.password);
      if (!isValidPassword) {
        throw createHttpError(400, "Current password is incorrect");
      }

      updates.password = await hashPassword(newPassword);
    }

    if (Object.keys(updates).length === 0) {
      throw createHttpError(400, "No updates provided");
    }

    const updatedUser = await storage.updateUser(userId, updates);

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      profileImage: updatedUser.profileImage,
      tier: updatedUser.tier,
      updatedAt: updatedUser.updatedAt,
    });
  }));

  router.post("/api/user/profile-image", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createHttpError(401, "Unauthorized");
    }

    const { imageData } = req.body;
    if (!imageData) {
      throw createHttpError(400, "Image data is required");
    }

    const fs = await import('fs');
    const path = await import('path');

    const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw createHttpError(400, "Invalid image format");
    }

    const ext = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'profiles');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filename = `${userId}-${Date.now()}.${ext}`;
    const filepath = path.join(uploadDir, filename);

    fs.writeFileSync(filepath, buffer);

    const imageUrl = `/uploads/profiles/${filename}`;

    const updatedUser = await storage.updateUser(userId, { profileImage: imageUrl });

    res.json({
      profileImage: updatedUser.profileImage,
      message: "Profile image uploaded successfully"
    });
  }));

  router.get("/api/user/profile", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createHttpError(401, "Unauthorized");
    }

    const user = await storage.getUser(userId);
    if (!user) {
      throw createHttpError(404, "User not found");
    }

    const isGuest = user.email === 'guest@mothle.com';
    let hasCompletedDemo = false;

    if (isGuest) {
      const scenarioRuns = await storage.getUserScenarioRuns(userId);
      hasCompletedDemo = scenarioRuns.some((run: any) => run.status === 'completed');
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      profileImage: user.profileImage,
      tier: user.tier,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      isGuest,
      hasCompletedDemo,
    });
  }));

  router.get('/uploads/profiles/*', (req: any, res) => {
    const filePath = path.join(process.cwd(), 'public', req.path);
    const normalizedPath = path.normalize(filePath);
    const profilesDir = path.join(process.cwd(), 'public', 'uploads', 'profiles');
    if (!normalizedPath.startsWith(profilesDir)) {
      return res.status(403).json({ message: "접근이 거부되었습니다" });
    }
    if (fs.existsSync(normalizedPath)) {
      res.sendFile(normalizedPath);
    } else {
      res.status(404).json({ message: "파일을 찾을 수 없습니다" });
    }
  });

  router.get('/uploads/*', isAuthenticated, (req: any, res) => {
    const filePath = path.join(process.cwd(), 'public', req.path);
    const normalizedPath = path.normalize(filePath);
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!normalizedPath.startsWith(uploadsDir)) {
      return res.status(403).json({ message: "접근이 거부되었습니다" });
    }
    if (fs.existsSync(normalizedPath)) {
      res.sendFile(normalizedPath);
    } else {
      res.status(404).json({ message: "파일을 찾을 수 없습니다" });
    }
  });

  router.get("/api/user-personas", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const userId = req.user?.id;
    const personas = await storage.getUserPersonasByCreator(userId, true);
    res.json(personas);
  }));

  router.get("/api/user-personas/featured", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const personas = await storage.getPublicUserPersonas('likes', 5, 0);
    res.json(personas);
  }));

  router.get("/api/user-personas/discover", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const sortBy = (req.query.sort as string) === 'recent' ? 'recent' : 'likes';
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const tag = req.query.tag as string | undefined;
    const mbti = req.query.mbti as string | undefined;
    const personas = await storage.getPublicUserPersonas(sortBy, limit, offset, tag, mbti);
    res.json(personas);
  }));

  router.get("/api/user-personas/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const persona = await storage.getUserPersonaById(req.params.id);
    if (!persona) throw createHttpError(404, "Persona not found");
    if (!persona.isPublic && persona.creatorId !== req.user?.id) {
      throw createHttpError(403, "Access denied");
    }
    const liked = await storage.getUserPersonaLike(req.user?.id, persona.id);
    const creator = await storage.getUser(persona.creatorId);
    res.json({ ...persona, liked, creatorName: creator?.name ?? null });
  }));

  router.post("/api/user-personas", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const userId = req.user?.id;
    const { name, description, greeting, avatarUrl, expressions, personality, tags, isPublic } = req.body;
    if (!name || !name.trim()) throw createHttpError(400, "Name is required");
    const persona = await storage.createUserPersona({
      creatorId: userId,
      name: name.trim(),
      description: description?.trim() || "",
      greeting: greeting?.trim() || `안녕하세요! 저는 ${name.trim()}입니다.`,
      avatarUrl: avatarUrl || null,
      expressions: expressions || null,
      personality: personality || { traits: [], communicationStyle: "", background: "", speechStyle: "" },
      tags: tags || [],
      isPublic: isPublic ?? false,
    });
    res.status(201).json(persona);
  }));

  router.put("/api/user-personas/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const isAdmin = req.user?.role === 'admin';
    const userId = req.user?.id;
    const { name, description, greeting, avatarUrl, expressions, personality, tags, isPublic } = req.body;
    const persona = await storage.updateUserPersona(req.params.id, userId, {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description.trim() }),
      ...(greeting !== undefined && { greeting: greeting.trim() }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      ...(expressions !== undefined && { expressions }),
      ...(personality !== undefined && { personality }),
      ...(tags !== undefined && { tags }),
      ...(isPublic !== undefined && { isPublic }),
    }, isAdmin);
    res.json(persona);
  }));

  router.delete("/api/user-personas/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const isAdmin = req.user?.role === 'admin';
    await storage.deleteUserPersona(req.params.id, req.user?.id, isAdmin);
    res.json({ success: true });
  }));

  router.post("/api/user-personas/generate-sample-images", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const force = req.body?.force === true;
    res.json({ started: true, message: '백그라운드에서 샘플 페르소나 이미지 생성을 시작했습니다.' });
    setImmediate(async () => {
      try {
        const { generateSamplePersonaImages } = await import('../scripts/generateSamplePersonaImages');
        await generateSamplePersonaImages(force);
      } catch (err: any) {
        console.error('[샘플 이미지 생성] 오류:', err.message);
      }
    });
  }));

  router.post("/api/user-personas/:id/like", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const result = await storage.toggleUserPersonaLike(req.user?.id, req.params.id);
    res.json(result);
  }));

  router.post("/api/user-personas/:id/start-chat", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "Access denied. System admin only.");
    }
    const userId = req.user?.id;
    const { mode = "text", difficulty = 2, scene: rawScene = null } = req.body;
    const sceneResult = sceneSchema.safeParse(rawScene ?? null);
    if (!sceneResult.success && rawScene !== null && rawScene !== undefined) {
      throw createHttpError(400, "Invalid scene payload");
    }
    const scene = sceneResult.success ? sceneResult.data : null;
    const persona = await storage.getUserPersonaById(req.params.id);
    if (!persona) throw createHttpError(404, "Persona not found");
    if (!persona.isPublic && persona.creatorId !== userId) {
      throw createHttpError(403, "Access denied");
    }

    const scenarioId = `__user_persona__:${persona.id}`;
    const scenarioName = `${persona.name}와의 대화`;

    const existingRuns = await storage.getUserScenarioRuns(userId);
    const prevAttempts = existingRuns.filter(r => r.scenarioId === scenarioId).length;

    const scenarioRun = await storage.createScenarioRun({
      userId,
      scenarioId,
      scenarioName,
      attemptNumber: prevAttempts + 1,
      mode,
      difficulty,
      status: "active",
    });

    const pers = (persona.personality as any) || {};
    const personaSnapshot = {
      id: persona.id,
      name: persona.name,
      avatarUrl: persona.avatarUrl,
      description: persona.description,
      greeting: persona.greeting,
      personality: pers,
      tags: persona.tags,
      scene: scene || null,
    };

    const personaRun = await storage.createPersonaRun({
      scenarioRunId: scenarioRun.id,
      personaId: persona.id,
      personaName: persona.name,
      personaSnapshot,
      phase: 1,
      mode,
      difficulty,
      status: "active",
    });

    await storage.incrementUserPersonaChatCount(persona.id);

    if (mode === "realtime_voice") {
      return res.json({
        id: personaRun.id,
        scenarioRunId: scenarioRun.id,
        scenarioId,
        scenarioName,
        personaId: persona.id,
        personaSnapshot,
        turnCount: 0,
        status: "active",
        mode,
        difficulty,
        userId,
        messages: [],
        scene: scene || null,
      });
    }

    // Build scene-aware greeting/opening line (text mode only - after early return for realtime_voice)
    let greetingText: string;
    if (scene && scene.openingLine) {
      greetingText = scene.openingLine;
    } else if (scene && scene.setting) {
      try {
        greetingText = await generateSceneOpeningLine(
          persona.name,
          { setting: scene.setting, mood: scene.mood, genre: scene.genre },
          persona.description ?? undefined
        );
      } catch {
        greetingText = persona.greeting || `안녕하세요! 저는 ${persona.name}입니다. 무슨 이야기든 편하게 나눠요.`;
      }
    } else {
      greetingText = persona.greeting || `안녕하세요! 저는 ${persona.name}입니다. 무슨 이야기든 편하게 나눠요.`;
    }

    await storage.createChatMessage({
      personaRunId: personaRun.id,
      sender: "ai",
      message: greetingText,
      turnIndex: 0,
      emotion: scene ? "기대" : "중립",
      emotionReason: scene ? "장면 시작" : "인사",
    });

    res.json({
      id: personaRun.id,
      scenarioRunId: scenarioRun.id,
      scenarioId,
      scenarioName,
      personaId: persona.id,
      personaSnapshot,
      turnCount: 0,
      status: "active",
      mode,
      difficulty,
      userId,
      scene: scene || null,
      messages: [{
        sender: "ai",
        message: greetingText,
        timestamp: new Date().toISOString(),
        emotion: scene ? "기대" : "중립",
        emotionReason: scene ? "장면 시작" : "인사",
      }],
    });
  }));

  return router;
}
