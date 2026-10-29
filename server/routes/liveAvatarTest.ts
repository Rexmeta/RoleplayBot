import { Router } from "express";
import { z } from "zod";
import { isSystemAdmin } from "../middleware/authMiddleware";
import { AvatarIdentityError } from "../services/liveAvatar/delegatedIdentity";
import { adminAvatarTestService, type AdminAvatarTestService } from "../services/liveAvatar/adminTestService";
import { testTurnSchema } from "../services/liveAvatar/testContracts";

/** Mounted behind existing login + no-store. No browser key, URL, user or tenant accepted. */
export function createLiveAvatarTestRouter(service: AdminAvatarTestService = adminAvatarTestService) {
  const router = Router();
  router.use(isSystemAdmin);
  const handle = (fn: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
    try { await fn(req, res); }
    catch (error) {
      if (error instanceof AvatarIdentityError) res.status(error.status).json({ code: error.code, error: error.code });
      else res.status(502).json({ code: "avatar_test_failed", error: "avatar_test_failed" });
    }
  };
  const empty = (req: any, res: any) => {
    if (z.object({}).strict().safeParse(req.body ?? {}).success) return true;
    res.status(400).json({ code: "avatar_test_invalid_input" });
    return false;
  };
  router.get("/preflight", handle(async (req, res) => res.json(await service.preflight(req.user.id))));
  router.post("/sessions", handle(async (req, res) => {
    if (!z.object({ costConfirmed: z.literal(true), audioConfirmed: z.literal(true) }).strict().safeParse(req.body).success) {
      res.status(400).json({ code: "avatar_test_consent_required" }); return;
    }
    res.status(201).json(await service.create(req.user.id));
  }));
  router.get("/sessions/:id", handle(async (req, res) => res.json(await service.session(req.user.id, req.params.id))));
  router.get("/sessions/:id/connection", handle(async (req, res) =>
    res.json(await service.connectionToken(req.user.id, req.params.id))));
  router.post("/sessions/:id/turn", handle(async (req, res) => {
    const parsed = testTurnSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ code: "avatar_test_invalid_input" }); return; }
    res.json(await service.turn(req.user.id, req.params.id, parsed.data));
  }));
  for (const operation of ["interrupt", "end"] as const) {
    router.post(`/sessions/:id/${operation}`, handle(async (req, res) => {
      if (empty(req, res)) res.json(await service.stop(req.user.id, req.params.id, operation === "end"));
    }));
  }
  return router;
}
