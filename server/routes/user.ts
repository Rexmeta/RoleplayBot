import { Router } from "express";
import { storage } from "../storage";
import path from "path";
import fs from "fs";

export default function createUserRouter(isAuthenticated: any) {
  const router = Router();

  router.patch("/api/user/profile", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { name, currentPassword, newPassword, profileImage } = req.body;

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
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
          return res.status(400).json({ error: "Current password is required to change password" });
        }

        const { verifyPassword, hashPassword } = await import('../auth');
        const isValidPassword = await verifyPassword(currentPassword, user.password);
        if (!isValidPassword) {
          return res.status(400).json({ error: "Current password is incorrect" });
        }

        updates.password = await hashPassword(newPassword);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No updates provided" });
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
    } catch (error: any) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ error: error.message || "Failed to update profile" });
    }
  });

  router.post("/api/user/profile-image", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { imageData } = req.body;
      if (!imageData) {
        return res.status(400).json({ error: "Image data is required" });
      }

      const fs = await import('fs');
      const path = await import('path');

      const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ error: "Invalid image format" });
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
    } catch (error: any) {
      console.error("Error uploading profile image:", error);
      res.status(500).json({ error: error.message || "Failed to upload profile image" });
    }
  });

  router.get("/api/user/profile", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
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
    } catch (error: any) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: error.message || "Failed to fetch profile" });
    }
  });

  // ============================== 파일 서빙 (uploads) ==============================

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

  // ============================== 사용자 제작 페르소나 ==============================

  /** GET /api/user-personas — 내가 만든 페르소나 목록 (시스템 관리자 전용) */
  router.get("/api/user-personas", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const userId = req.user?.id;
      const personas = await storage.getUserPersonasByCreator(userId);
      res.json(personas);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user personas" });
    }
  });

  /** GET /api/user-personas/featured — 인기 페르소나 (좋아요 순 상위 5개, 시스템 관리자 전용) */
  router.get("/api/user-personas/featured", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const personas = await storage.getPublicUserPersonas('likes', 5, 0);
      res.json(personas);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch featured personas" });
    }
  });

  /** GET /api/user-personas/discover — 공개 페르소나 탐색 (시스템 관리자 전용) */
  router.get("/api/user-personas/discover", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const sortBy = (req.query.sort as string) === 'recent' ? 'recent' : 'likes';
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const tag = req.query.tag as string | undefined;
      const mbti = req.query.mbti as string | undefined;
      const personas = await storage.getPublicUserPersonas(sortBy, limit, offset, tag, mbti);
      res.json(personas);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch public personas" });
    }
  });

  /** GET /api/user-personas/:id — 특정 페르소나 조회 (시스템 관리자 전용) */
  router.get("/api/user-personas/:id", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const persona = await storage.getUserPersonaById(req.params.id);
      if (!persona) return res.status(404).json({ error: "Persona not found" });
      if (!persona.isPublic && persona.creatorId !== req.user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      const liked = await storage.getUserPersonaLike(req.user?.id, persona.id);
      const creator = await storage.getUser(persona.creatorId);
      res.json({ ...persona, liked, creatorName: creator?.name ?? null });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch persona" });
    }
  });

  /** POST /api/user-personas — 페르소나 생성 (시스템 관리자 전용) */
  router.post("/api/user-personas", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const userId = req.user?.id;
      const { name, description, greeting, avatarUrl, personality, tags, isPublic } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
      const persona = await storage.createUserPersona({
        creatorId: userId,
        name: name.trim(),
        description: description?.trim() || "",
        greeting: greeting?.trim() || `안녕하세요! 저는 ${name.trim()}입니다.`,
        avatarUrl: avatarUrl || null,
        personality: personality || { traits: [], communicationStyle: "", background: "", speechStyle: "" },
        tags: tags || [],
        isPublic: isPublic ?? false,
      });
      res.status(201).json(persona);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create persona" });
    }
  });

  /** PUT /api/user-personas/:id — 페르소나 수정 (시스템 관리자 전용) */
  router.put("/api/user-personas/:id", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const userId = req.user?.id;
      const { name, description, greeting, avatarUrl, personality, tags, isPublic } = req.body;
      const persona = await storage.updateUserPersona(req.params.id, userId, {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description.trim() }),
        ...(greeting !== undefined && { greeting: greeting.trim() }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(personality !== undefined && { personality }),
        ...(tags !== undefined && { tags }),
        ...(isPublic !== undefined && { isPublic }),
      });
      res.json(persona);
    } catch (error: any) {
      if (error.message?.includes("not found or unauthorized")) return res.status(403).json({ error: error.message });
      res.status(500).json({ error: "Failed to update persona" });
    }
  });

  /** DELETE /api/user-personas/:id — 페르소나 삭제 (시스템 관리자 전용) */
  router.delete("/api/user-personas/:id", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      await storage.deleteUserPersona(req.params.id, req.user?.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete persona" });
    }
  });

  /** POST /api/user-personas/:id/like — 좋아요 토글 (시스템 관리자 전용) */
  router.post("/api/user-personas/:id/like", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const result = await storage.toggleUserPersonaLike(req.user?.id, req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to toggle like" });
    }
  });

  /** POST /api/user-personas/:id/start-chat — 채팅 시작 (시스템 관리자 전용) */
  router.post("/api/user-personas/:id/start-chat", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const userId = req.user?.id;
      const { mode = "text", difficulty = 2 } = req.body;
      const persona = await storage.getUserPersonaById(req.params.id);
      if (!persona) return res.status(404).json({ error: "Persona not found" });
      if (!persona.isPublic && persona.creatorId !== userId) {
        return res.status(403).json({ error: "Access denied" });
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

      const greetingText = persona.greeting || `안녕하세요! 저는 ${persona.name}입니다. 무슨 이야기든 편하게 나눠요.`;

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
        });
      }

      await storage.createChatMessage({
        personaRunId: personaRun.id,
        sender: "ai",
        message: greetingText,
        turnIndex: 0,
        emotion: "중립",
        emotionReason: "인사",
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
        messages: [{
          sender: "ai",
          message: greetingText,
          timestamp: new Date().toISOString(),
          emotion: "중립",
          emotionReason: "인사",
        }],
      });
    } catch (error: any) {
      console.error("User persona chat start error:", error);
      res.status(500).json({ error: error.message || "Failed to start chat" });
    }
  });

  return router;
}
