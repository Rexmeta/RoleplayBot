import { Router } from "express";
import { z } from "zod";
import { isSystemAdmin } from "../middleware/authMiddleware";
import { AvatarIdentityError } from "../services/liveAvatar/delegatedIdentity";
import { AvatarVoiceTest, avatarVoiceTestStartSchema } from "../services/liveAvatar/voiceTest";

const empty = z.object({}).strict();
const offsetQuery = z.object({ offset: z.string().regex(/^\d{1,4}$/).transform(Number).pipe(z.number().max(5000)).optional() }).strict();

export function createAvatarVoiceTestRouter(service = new AvatarVoiceTest()) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(isSystemAdmin);
  const respond = (
    fn: (userId: string, target: string, sessionId: string, input: any) => Promise<unknown>,
    input?: z.ZodTypeAny, status = 200, query = false,
  ) => async (req: any, res: any) => {
    const parsed = input?.safeParse(query ? req.query : (req.body ?? {}));
    if (parsed && !parsed.success) return res.status(400).json({ code: "avatar_test_invalid_input" });
    try {
      res.status(status).json(await fn(req.user.id, req.params.target, req.params.id, parsed?.data));
    } catch (error) {
      if (error instanceof AvatarIdentityError) {
        const profile = error.routerResponse;
        return res.status(error.status).json({ code: profile?.code ?? error.code, error: profile?.error ?? error.code });
      }
      res.status(502).json({ code: "avatar_voice_test_failed" });
    }
  };
  router.get("/:target/voices", respond((user, target, _id, query) => service.catalog(user, target, query.offset ?? 0), offsetQuery, 200, true));
  router.get("/:target/session", respond((user, target) => service.session(user, target)));
  router.post("/:target/sessions", respond((user, target, _id, input) => service.create(user, target, input.voice), avatarVoiceTestStartSchema, 201));
  router.get("/:target/sessions/:id", respond((user, target, id) => service.session(user, target, id)));
  router.post("/:target/sessions/:id/client-connection", respond((user, target, id) => service.connectionToken(user, target, id), empty));
  for (const operation of ["end", "interrupt"] as const) {
    router.post(`/:target/sessions/:id/${operation}`, respond((user, target, id) => service.stop(user, target, id, operation === "end"), empty));
  }
  return router;
}
