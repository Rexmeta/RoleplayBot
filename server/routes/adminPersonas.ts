import { Router } from "express";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { transformPersonasMedia, transformPersonaMedia, safeTransformToSignedUrl } from "../services/gcsStorage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { generateAvatarClip, type AvatarClipState } from "../services/gemini-video-generator";
import { videoJobStore } from "../utils/videoJobStore";

export default function createAdminPersonasRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/admin/personas", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const [personas, allLocaleRows] = await Promise.all([
      fileManager.getAllMBTIPersonas(),
      storage.getAllPersonaTranslationLocales(),
    ]);

    const localeMap = new Map<string, Array<{ locale: string; isMachineTranslated: boolean; isReviewed: boolean }>>();
    for (const row of allLocaleRows) {
      if (!localeMap.has(row.personaId)) localeMap.set(row.personaId, []);
      localeMap.get(row.personaId)!.push({ locale: row.locale, isMachineTranslated: row.isMachineTranslated, isReviewed: row.isReviewed });
    }

    const personasWithLocales = (personas as any[]).map(p => ({
      ...p,
      _translationLocales: localeMap.get(p.id) || [],
    }));

    const transformedPersonas = await transformPersonasMedia(personasWithLocales);
    res.json(transformedPersonas);
  }));

  router.post("/api/admin/personas", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const persona = await fileManager.createMBTIPersona(req.body);
    const transformedPersona = await transformPersonaMedia(persona);
    res.json(transformedPersona);
  }));

  router.put("/api/admin/personas/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const persona = await fileManager.updateMBTIPersona(req.params.id, req.body);
    const transformedPersona = await transformPersonaMedia(persona);
    res.json(transformedPersona);
  }));

  /**
   * POST /api/admin/personas/:id/video/generate-clip
   * Kicks off avatar clip generation in the background and returns a jobId immediately.
   */
  router.post("/api/admin/personas/:id/video/generate-clip", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const personaId = req.params.id;
    const { state, styleHint } = req.body as { state?: string; styleHint?: string };

    const VALID_STATES: AvatarClipState[] = [
      'idle', 'listening', 'listening_nod', 'thinking', 'speaking', 'speaking_pause',
    ];
    if (!state || !VALID_STATES.includes(state as AvatarClipState)) {
      throw createHttpError(400, `state must be one of: ${VALID_STATES.join(', ')}`);
    }

    const jobId = randomUUID();
    videoJobStore.create(jobId);

    // Fire-and-forget background generation
    setImmediate(async () => {
      videoJobStore.setRunning(jobId);
      try {
        const result = await generateAvatarClip({
          personaId,
          state: state as AvatarClipState,
          styleHint,
        });
        if (result.success && result.videoUrl) {
          videoJobStore.setDone(jobId, result.videoUrl, state);
        } else {
          videoJobStore.setError(jobId, result.error || '비디오 생성 실패');
        }
      } catch (err: any) {
        console.error(`[videoJob:${jobId}] Unhandled error:`, err);
        videoJobStore.setError(jobId, err?.message || '알 수 없는 오류가 발생했습니다.');
      }
    });

    res.status(202).json({ jobId });
  }));

  /**
   * GET /api/admin/personas/:id/video/generate-clip/status?jobId=<id>
   * Returns the current status (and result/error) of a background generation job.
   */
  router.get("/api/admin/personas/:id/video/generate-clip/status", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { jobId } = req.query as { jobId?: string };
    if (!jobId) throw createHttpError(400, 'jobId query parameter is required');

    const record = videoJobStore.get(jobId);
    if (!record) throw createHttpError(404, 'Job not found or expired');

    // Resolve raw storage path to a browser-accessible URL before returning to client
    let result = record.result ?? null;
    if (result?.videoUrl) {
      result = { ...result, videoUrl: await safeTransformToSignedUrl(result.videoUrl) };
    }

    res.json({
      status: record.status,
      result,
      error: record.error ?? null,
    });
  }));

  router.delete("/api/admin/personas/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const personaId = req.params.id;

    const scenarios = await fileManager.getAllScenarios();
    const connectedScenarios = (scenarios as any[]).filter(scenario =>
      scenario.personas.includes(personaId)
    );

    if (connectedScenarios.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete persona with connected scenarios"), {
        connectedScenarios: connectedScenarios.map(s => ({ id: s.id, title: s.title }))
      });
    }

    await fileManager.deleteMBTIPersona(personaId);
    res.json({ success: true });
  }));

  return router;
}
