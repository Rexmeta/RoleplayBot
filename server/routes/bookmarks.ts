import { Router } from "express";
import { storage } from "../storage";
import { asyncHandler, createHttpError } from "./routerHelpers";

export default function createBookmarksRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) throw createHttpError(401, "Unauthorized");
    const bookmarks = await storage.getUserBookmarks(userId);
    res.json(bookmarks);
  }));

  router.post("/", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) throw createHttpError(401, "Unauthorized");
    const { scenarioId } = req.body;
    if (!scenarioId) throw createHttpError(400, "scenarioId is required");
    const bookmark = await storage.addBookmark(userId, scenarioId);
    res.json(bookmark);
  }));

  router.delete("/:scenarioId", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user?.id;
    if (!userId) throw createHttpError(401, "Unauthorized");
    const { scenarioId } = req.params;
    await storage.removeBookmark(userId, scenarioId);
    res.json({ success: true });
  }));

  return router;
}
