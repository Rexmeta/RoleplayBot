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
   * On completion the clip is automatically saved to the persona's `videos.clips` in the DB.
   */
  router.post("/api/admin/personas/:id/video/generate-clip", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const personaId = req.params.id;
    const { state, styleHint, gender, neutralImageUrl, extraPrompt } = req.body as {
      state?: string;
      styleHint?: string;
      gender?: string;
      neutralImageUrl?: string;
      extraPrompt?: string;
    };

    const VALID_STATES: AvatarClipState[] = [
      'idle', 'listening', 'listening_nod', 'thinking', 'speaking', 'speaking_pause',
    ];
    if (!state || !VALID_STATES.includes(state as AvatarClipState)) {
      throw createHttpError(400, `state must be one of: ${VALID_STATES.join(', ')}`);
    }

    const resolvedGender: 'male' | 'female' =
      gender === 'female' ? 'female' : 'male';

    const jobId = randomUUID();
    // Create job record in memory + DB (fire-and-forget DB write)
    videoJobStore.create(jobId, personaId, state, resolvedGender);

    // Fire-and-forget background generation
    setImmediate(async () => {
      videoJobStore.setRunning(jobId);
      try {
        const result = await generateAvatarClip({
          personaId,
          state: state as AvatarClipState,
          styleHint,
          gender: resolvedGender,
          neutralImageUrl: neutralImageUrl || undefined,
          extraPrompt: extraPrompt || undefined,
        });

        if (result.success && result.videoUrl) {
          const usedModel = result.metadata?.model;
          videoJobStore.setDone(jobId, result.videoUrl, state, resolvedGender, usedModel);

          // Auto-save the generated clip directly into the persona's DB record.
          // This means the user doesn't need to click "Save" after generation,
          // and the clip persists even if the user navigated away.
          try {
            const persona = await storage.getMbtiPersona(personaId);
            if (persona) {
              const currentVideos = (persona.videos as any) ?? { enabled: true, avatarId: personaId, clips: {} };
              const currentClips = (currentVideos.clips ?? {}) as Record<string, Record<string, string>>;
              const updatedClips = {
                ...currentClips,
                [resolvedGender]: {
                  ...(currentClips[resolvedGender] ?? {}),
                  [state]: result.videoUrl,
                },
              };
              // Also persist the model used for each clip slot.
              const currentClipModels = (currentVideos.clipModels ?? {}) as Record<string, Record<string, string>>;
              const updatedClipModels = usedModel ? {
                ...currentClipModels,
                [resolvedGender]: {
                  ...(currentClipModels[resolvedGender] ?? {}),
                  [state]: usedModel,
                },
              } : currentClipModels;
              await storage.updateMbtiPersona(personaId, {
                videos: { ...currentVideos, clips: updatedClips, clipModels: updatedClipModels },
              });
              console.log(`✅ [videoJob:${jobId}] 클립 자동 저장 완료: ${personaId}/${resolvedGender}/${state}`);
            }
          } catch (saveErr: any) {
            // Auto-save failure is non-fatal — client still gets the storageKey via polling
            console.warn(`⚠️ [videoJob:${jobId}] 클립 자동 저장 실패 (무시):`, saveErr.message);
          }
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
   * Falls back to DB when the job is not in memory (e.g. after a server restart).
   */
  router.get("/api/admin/personas/:id/video/generate-clip/status", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { jobId } = req.query as { jobId?: string };
    if (!jobId) throw createHttpError(400, 'jobId query parameter is required');

    // Async get: checks memory first, then DB
    const record = await videoJobStore.get(jobId);
    if (!record) throw createHttpError(404, 'Job not found or expired');

    // Resolve raw storage path to a browser-accessible URL before returning to client.
    // Always include the raw storageKey so the client persists a stable key, not an expiring signed URL.
    let result = record.result ?? null;
    if (result?.videoUrl) {
      const storageKey = result.videoUrl; // raw stable key
      const displayUrl = await safeTransformToSignedUrl(storageKey);
      result = { ...result, storageKey, videoUrl: displayUrl } as typeof result & { storageKey: string };
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
