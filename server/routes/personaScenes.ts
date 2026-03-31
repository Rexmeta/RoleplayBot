import { Router } from "express";
import { z } from "zod";
import { generatePersonaScene } from "../services/personaSceneGenerator";
import { asyncHandler, createHttpError } from "./routerHelpers";

const generateSceneSchema = z.object({
  idea: z.string().min(1, "아이디어를 입력해주세요.").max(2000),
  personaName: z.string().min(1, "페르소나 이름이 필요합니다.").max(200),
  personaDescription: z.string().max(2000).optional(),
});

export default function createPersonaScenesRouter(isAuthenticated: any) {
  const router = Router();

  router.post(
    "/api/persona-scenes/generate",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const parsed = generateSceneSchema.safeParse(req.body);
      if (!parsed.success) {
        throw createHttpError(400, parsed.error.errors[0]?.message || "잘못된 요청입니다.");
      }

      const { idea, personaName, personaDescription } = parsed.data;

      const scene = await generatePersonaScene({
        idea: idea.trim(),
        personaName: personaName.trim(),
        personaDescription: personaDescription?.trim(),
      });

      res.json(scene);
    })
  );

  return router;
}
