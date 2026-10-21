import { Router } from "express";
import { z } from "zod";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler } from "./routerHelpers";
import { CultureError, listCultureProfiles, getCultureProfile, createCultureProfile, updateCultureProfile,
  deleteCultureProfile, listCultureVersions, duplicateCultureProfile } from "../services/cultureMap/service";

export default function createCultureMapRouter(isAuthenticated: any) {
  const router = Router();
  const base = "/api/admin/culture-profiles";
  router.use(base, isAuthenticated, isOperatorOrAdmin);
  router.param("cultureId", (req, res, next, id) => {
    if (!z.string().uuid().safeParse(id).success) return res.status(400).json({ error: "잘못된 문화 프로필 ID입니다." });
    next();
  });
  const version = (body: any) => {
    const result = z.number().int().positive().safeParse(body?.expectedVersion);
    if (!result.success) throw new CultureError("expectedVersion이 필요합니다.");
    return result.data;
  };
  router.get("/api/admin/culture-profiles", asyncHandler(async (req: any, res) => res.json(await listCultureProfiles(req.user))));
  router.post("/api/admin/culture-profiles", asyncHandler(async (req: any, res) => res.status(201).json(await createCultureProfile(req.body, req.user))));
  router.get("/api/admin/culture-profiles/:cultureId", asyncHandler(async (req: any, res) => res.json(await getCultureProfile(req.params.cultureId, req.user))));
  router.get("/api/admin/culture-profiles/:cultureId/versions", asyncHandler(async (req: any, res) => res.json(await listCultureVersions(req.params.cultureId, req.user))));
  router.post("/api/admin/culture-profiles/:cultureId/duplicate", asyncHandler(async (req: any, res) => res.status(201).json(await duplicateCultureProfile(req.params.cultureId, req.user))));
  router.put("/api/admin/culture-profiles/:cultureId", asyncHandler(async (req: any, res) => {
    const expected = version(req.body);
    const { expectedVersion: _, ...content } = req.body;
    res.json(await updateCultureProfile(req.params.cultureId, content, expected, req.user));
  }));
  router.delete("/api/admin/culture-profiles/:cultureId", asyncHandler(async (req: any, res) => {
    await deleteCultureProfile(req.params.cultureId, version(req.body), req.user);
    res.status(204).end();
  }));
  router.use((error: any, _req: any, res: any, next: any) => {
    if (error instanceof CultureError) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  });
  return router;
}
