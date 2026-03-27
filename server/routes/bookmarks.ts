import { Router } from "express";
import { storage } from "../storage";

export default function createBookmarksRouter(isAuthenticated: any) {
  const router = Router();

  // 사용자 북마크 목록 조회
  router.get("/", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const bookmarks = await storage.getUserBookmarks(userId);
      res.json(bookmarks);
    } catch (error: any) {
      console.error("Error fetching bookmarks:", error);
      res.status(500).json({ error: error.message || "Failed to fetch bookmarks" });
    }
  });

  // 북마크 추가
  router.post("/", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { scenarioId } = req.body;
      if (!scenarioId) return res.status(400).json({ error: "scenarioId is required" });
      const bookmark = await storage.addBookmark(userId, scenarioId);
      res.json(bookmark);
    } catch (error: any) {
      console.error("Error adding bookmark:", error);
      res.status(500).json({ error: error.message || "Failed to add bookmark" });
    }
  });

  // 북마크 삭제
  router.delete("/:scenarioId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { scenarioId } = req.params;
      await storage.removeBookmark(userId, scenarioId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error removing bookmark:", error);
      res.status(500).json({ error: error.message || "Failed to remove bookmark" });
    }
  });

  return router;
}
