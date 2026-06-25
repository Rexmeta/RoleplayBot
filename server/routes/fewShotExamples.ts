import { Router } from "express";
import { storage } from "../storage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { z } from "zod";

const createSchema = z.object({
  context: z.string().optional().nullable(),
  transcript: z.string().min(1, "Transcript is required"),
  score: z.number().int().min(1).max(10),
  rationale: z.string().min(1, "Rationale is required"),
  isActive: z.boolean().optional().default(true),
});

const patchSchema = z.object({
  context: z.string().optional().nullable(),
  transcript: z.string().min(1).optional(),
  score: z.number().int().min(1).max(10).optional(),
  rationale: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export default function createFewShotExamplesRouter(isAuthenticated: any) {
  const router = Router();

  router.get(
    "/api/evaluation-dimensions/:dimensionId/few-shot-examples",
    isAuthenticated,
    isOperatorOrAdmin,
    asyncHandler(async (req, res) => {
      const { dimensionId } = req.params;
      const dimension = await storage.getEvaluationDimension(dimensionId);
      if (!dimension) throw createHttpError(404, "Dimension not found");
      const examples = await storage.getFewShotExamplesByDimension(dimensionId);
      res.json(examples);
    })
  );

  router.post(
    "/api/evaluation-dimensions/:dimensionId/few-shot-examples",
    isAuthenticated,
    isOperatorOrAdmin,
    asyncHandler(async (req, res) => {
      const { dimensionId } = req.params;
      const dimension = await storage.getEvaluationDimension(dimensionId);
      if (!dimension) throw createHttpError(404, "Dimension not found");
      const body = createSchema.parse(req.body);
      const example = await storage.createFewShotExample({
        dimensionId,
        context: body.context ?? null,
        transcript: body.transcript,
        score: body.score,
        rationale: body.rationale,
        isActive: body.isActive ?? true,
      });
      res.status(201).json(example);
    })
  );

  router.patch(
    "/api/few-shot-examples/:id",
    isAuthenticated,
    isOperatorOrAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const patch = patchSchema.parse(req.body);
      const updated = await storage.updateFewShotExample(id, patch);
      res.json(updated);
    })
  );

  router.delete(
    "/api/few-shot-examples/:id",
    isAuthenticated,
    isOperatorOrAdmin,
    asyncHandler(async (req, res) => {
      await storage.deleteFewShotExample(req.params.id);
      res.json({ ok: true });
    })
  );

  return router;
}
