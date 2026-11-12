import { Router } from "express";
import { z } from "zod";
import { TavusError } from "../services/tavus/client";
import { tavusSessions } from "../services/tavus/sessions";
import { isSystemAdmin } from "../middleware/authMiddleware";
import { AvatarIdentityError } from "../services/liveAvatar/delegatedIdentity";

export default function createTavusRouter(isAuthenticated: any, service = tavusSessions) {
  const router = Router();
  router.use(isAuthenticated);
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    // Cookie-authenticated lifecycle writes must originate in this application.
    const origin = req.headers.origin;
    if (req.method !== "GET" && origin) {
      try {
        const parsed = new URL(origin);
        // The HTTPS proxy may connect to Express over HTTP. Compare the public host, not req.protocol.
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.host !== req.get("host")) {
          return res.status(403).json({ code: "tavus_origin_forbidden" });
        }
      } catch {
        return res.status(403).json({ code: "tavus_origin_forbidden" });
      }
    }
    next();
  });
  const handle = (fn: (req: any) => Promise<unknown>) => async (req: any, res: any, next: any) => {
    try { res.json(await fn(req)); }
    catch (error) {
      if (error instanceof TavusError || error instanceof AvatarIdentityError) res.status(error.status).json({
        code: error.code, error: error.code,
        ...(error instanceof TavusError && error.details ? error.details : {}),
      });
      else next(error);
    }
  };
  router.get("/config", handle(req => service.config(req.user.id, typeof req.query.runId === "string" ? req.query.runId : undefined)));
  router.post("/pal", isSystemAdmin, handle(async () => ({ palId: await service.ensurePal() })));
  router.get("/conversations/:id/session", handle(req => service.session(req.user.id, req.params.id)));
  router.get("/conversations/:id/connection", handle(req => service.connection(req.user.id, req.params.id)));
  router.post("/conversations/:id/client-connection", handle(req => service.managedConnection(req.user.id, req.params.id)));
  router.post("/conversations/:id/interrupt", handle(req => service.interrupt(req.user.id, req.params.id)));
  router.post("/conversations/:id/start", handle(req => {
    const parsed = z.object({ consent: z.literal(true) }).strict().safeParse(req.body);
    if (!parsed.success) throw new TavusError("tavus_consent_required", 400);
    return service.start(req.user.id, req.params.id, true);
  }));
  router.post("/conversations/:id/end", handle(req => service.end(req.user.id, req.params.id)));
  router.post("/conversations/:id/sync", handle(req => service.sync(req.user.id, req.params.id)));
  return router;
}
