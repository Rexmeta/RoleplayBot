import { Router } from "express";
import { z } from "zod";
import { AvatarIdentityError } from "../services/liveAvatar/delegatedIdentity";
import { personaAvatarCreation } from "../services/liveAvatar/personaCreation";
import { personaAvatarValidation } from "../services/liveAvatar/personaValidation";
import { personaAvatarCreationInput } from "../../shared/avatar/personaAvatarCreation";
import { testTurnSchema } from "../services/liveAvatar/testContracts";

/** Mounted behind existing login + operator/admin guard. No provider credentials from browsers. */
export function createPersonaAvatarOperationsRouter(
  creation = personaAvatarCreation, validation = personaAvatarValidation,
) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const handle = (fn: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
    try { await fn(req, res); }
    catch (error) {
      if (error instanceof AvatarIdentityError) res.status(error.status).json({ code: error.code, error: error.code });
      else res.status(502).json({ code: "persona_avatar_operation_failed", error: "persona_avatar_operation_failed" });
    }
  };
  const valid = <T>(schema: z.ZodType<T, z.ZodTypeDef, any>, req: any, res: any): T | undefined => {
    const result = schema.safeParse(req.body ?? {});
    if (result.success) return result.data;
    res.status(400).json({ code: "persona_avatar_invalid_input" });
  };
  router.get("/creation", handle(async (req, res) => res.json(await creation.status(req.user.id))));
  router.post("/creation", handle(async (req, res) => {
    const input = valid(personaAvatarCreationInput, req, res);
    if (input) res.status(202).json(await creation.create(req.user.id, input));
  }));
  const service = (req: any) => validation.service(req.params.assetId);
  router.get("/assets/:assetId/validation/preflight", handle(async (req, res) => res.json(await service(req).preflight(req.user.id))));
  router.post("/assets/:assetId/validation/sessions", handle(async (req, res) => {
    if (valid(z.object({ costConfirmed: z.literal(true), audioConfirmed: z.literal(true) }).strict(), req, res)) {
      res.status(201).json(await service(req).create(req.user.id));
    }
  }));
  router.get("/assets/:assetId/validation/sessions/:id", handle(async (req, res) =>
    res.json(await service(req).session(req.user.id, req.params.id))));
  router.get("/assets/:assetId/validation/sessions/:id/connection", handle(async (req, res) =>
    res.json(await service(req).connectionToken(req.user.id, req.params.id))));
  router.post("/assets/:assetId/validation/sessions/:id/turn", handle(async (req, res) => {
    const input = valid(testTurnSchema, req, res);
    if (input) res.json(await service(req).turn(req.user.id, req.params.id, input));
  }));
  for (const action of ["interrupt", "end"] as const) {
    router.post(`/assets/:assetId/validation/sessions/:id/${action}`, handle(async (req, res) => {
      if (valid(z.object({}).strict(), req, res)) {
        res.json(await service(req).stop(req.user.id, req.params.id, action === "end"));
      }
    }));
  }
  router.post("/assets/:assetId/validation/report", handle(async (req, res) => {
    const input = valid(z.object({
      sessionId: z.string().uuid(), videoObserved: z.literal(true), audioObserved: z.literal(true),
    }).strict(), req, res);
    if (input) res.json(await validation.report(req.user.id, req.params.assetId, input.sessionId));
  }));
  return router;
}
