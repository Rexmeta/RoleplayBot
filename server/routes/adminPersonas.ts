import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { mediaStorage } from "../services/mediaStorage";
import { transformPersonasMedia, transformPersonaMedia, safeTransformToSignedUrl } from "../services/gcsStorage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import {
  generateAvatarClip,
  avatarClipSlot,
  AVATAR_CLIP_BEHAVIORS,
  AVATAR_CLIP_EMOTIONS,
  type AvatarClipBehavior,
  type AvatarClipEmotion,
} from "../services/gemini-video-generator";
import { videoJobStore } from "../utils/videoJobStore";

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('비디오 파일만 업로드할 수 있습니다.'));
    }
  },
});

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
    const { behavior, emotion, styleHint, gender, neutralImageUrl, extraPrompt } = req.body as {
      behavior?: string;
      emotion?: string;
      styleHint?: string;
      gender?: string;
      neutralImageUrl?: string;
      extraPrompt?: string;
    };

    // The clip library is behaviour (audio stream) × emotion (LLM); both are required.
    if (!behavior || !AVATAR_CLIP_BEHAVIORS.includes(behavior as AvatarClipBehavior)) {
      throw createHttpError(400, `behavior must be one of: ${AVATAR_CLIP_BEHAVIORS.join(', ')}`);
    }
    if (!emotion || !AVATAR_CLIP_EMOTIONS.includes(emotion as AvatarClipEmotion)) {
      throw createHttpError(400, `emotion must be one of: ${AVATAR_CLIP_EMOTIONS.join(', ')}`);
    }

    const resolvedGender: 'male' | 'female' =
      gender === 'female' ? 'female' : 'male';
    const resolvedBehavior = behavior as AvatarClipBehavior;
    const resolvedEmotion = emotion as AvatarClipEmotion;
    const slot = avatarClipSlot(resolvedBehavior, resolvedEmotion);

    const jobId = randomUUID();
    // Create job record in memory + DB (fire-and-forget DB write)
    videoJobStore.create(jobId, personaId, slot, resolvedGender);

    // Fire-and-forget background generation
    setImmediate(async () => {
      videoJobStore.setRunning(jobId);
      try {
        const result = await generateAvatarClip({
          personaId,
          behavior: resolvedBehavior,
          emotion: resolvedEmotion,
          styleHint,
          gender: resolvedGender,
          neutralImageUrl: neutralImageUrl || undefined,
          extraPrompt: extraPrompt || undefined,
        });

        if (result.success && result.videoUrl) {
          const usedModel = result.metadata?.model;
          videoJobStore.setDone(jobId, result.videoUrl, slot, resolvedGender, usedModel);

          // Auto-save the generated clip directly into the persona's DB record.
          // This means the user doesn't need to click "Save" after generation,
          // and the clip persists even if the user navigated away.
          try {
            const persona = await storage.getMbtiPersona(personaId);
            if (persona) {
              const currentVideos = (persona.videos as any) ?? { enabled: true, avatarId: personaId, clips: {} };
              const currentClips = (currentVideos.clips ?? {}) as Record<string, Record<string, string>>;
              // Remember old URL before overwriting — we'll delete the file after saving.
              const oldClipUrl: string | undefined = currentClips[resolvedGender]?.[slot];
              const updatedClips = {
                ...currentClips,
                [resolvedGender]: {
                  ...(currentClips[resolvedGender] ?? {}),
                  [slot]: result.videoUrl,
                },
              };
              // Also persist the model used for each clip slot.
              const currentClipModels = (currentVideos.clipModels ?? {}) as Record<string, Record<string, string>>;
              const updatedClipModels = usedModel ? {
                ...currentClipModels,
                [resolvedGender]: {
                  ...(currentClipModels[resolvedGender] ?? {}),
                  [slot]: usedModel,
                },
              } : currentClipModels;
              // Auto-enable video avatar when the first clip is successfully saved.
              const enableVideos = currentVideos.enabled !== true;
              await storage.updateMbtiPersona(personaId, {
                videos: { ...currentVideos, enabled: true, clips: updatedClips, clipModels: updatedClipModels },
              });
              if (enableVideos) {
                console.log(`✅ [videoJob:${jobId}] videos.enabled 자동 활성화: ${personaId}`);
              }
              console.log(`✅ [videoJob:${jobId}] 클립 자동 저장 완료: ${personaId}/${resolvedGender}/${slot}`);
              // Delete the previous clip file to avoid orphaned storage accumulation.
              if (oldClipUrl && oldClipUrl !== result.videoUrl) {
                mediaStorage.deleteFromStorage(oldClipUrl).catch(err =>
                  console.warn(`⚠️ [videoJob:${jobId}] 구버전 클립 삭제 실패 (무시):`, err?.message)
                );
              }
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

  /**
   * POST /api/admin/personas/:id/video/upload-clip
   * Accepts a video file upload and stores it as an avatar clip for the given slot/gender.
   * Updates the persona's videos.clips in the DB automatically.
   */
  router.post(
    "/api/admin/personas/:id/video/upload-clip",
    isAuthenticated,
    isOperatorOrAdmin,
    videoUpload.single('file'),
    asyncHandler(async (req: any, res) => {
      const personaId = req.params.id;
      const { behavior, emotion, gender } = req.body as {
        behavior?: string;
        emotion?: string;
        gender?: string;
      };
      const file = req.file;

      if (!behavior || !AVATAR_CLIP_BEHAVIORS.includes(behavior as AvatarClipBehavior)) {
        throw createHttpError(400, `behavior must be one of: ${AVATAR_CLIP_BEHAVIORS.join(', ')}`);
      }
      if (!emotion || !AVATAR_CLIP_EMOTIONS.includes(emotion as AvatarClipEmotion)) {
        throw createHttpError(400, `emotion must be one of: ${AVATAR_CLIP_EMOTIONS.join(', ')}`);
      }
      if (!file) {
        throw createHttpError(400, '비디오 파일이 필요합니다.');
      }

      const resolvedGender: 'male' | 'female' = gender === 'female' ? 'female' : 'male';
      const slot = avatarClipSlot(behavior as AvatarClipBehavior, emotion as AvatarClipEmotion);

      // Determine extension from MIME type
      const ext = file.mimetype === 'video/webm' ? 'webm' : 'mp4';
      const safePersonaId = personaId.replace(/[^a-zA-Z0-9]/g, '-');
      const safeSlot = slot.replace(/_/g, '-');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fixedKey = `videos/avatar-${safePersonaId}-${resolvedGender}-${safeSlot}-${timestamp}.${ext}`;

      const storagePath = await mediaStorage.saveToFixedPath(file.buffer, fixedKey, file.mimetype);

      // Auto-save to persona record
      const persona = await storage.getMbtiPersona(personaId);
      if (!persona) throw createHttpError(404, '페르소나를 찾을 수 없습니다.');

      const currentVideos = (persona.videos as any) ?? { enabled: true, avatarId: personaId, clips: {} };
      const currentClips = (currentVideos.clips ?? {}) as Record<string, Record<string, string>>;
      // Remember the old clip URL so we can delete it from storage after saving.
      const oldClipUrl: string | undefined = currentClips[resolvedGender]?.[slot];
      const updatedClips = {
        ...currentClips,
        [resolvedGender]: { ...(currentClips[resolvedGender] ?? {}), [slot]: storagePath },
      };
      // Auto-enable video avatar on upload as well.
      await storage.updateMbtiPersona(personaId, {
        videos: { ...currentVideos, enabled: true, clips: updatedClips },
      });
      // Delete the previous clip file to keep storage clean.
      if (oldClipUrl && oldClipUrl !== storagePath) {
        mediaStorage.deleteFromStorage(oldClipUrl).catch(err =>
          console.warn(`⚠️ 구버전 클립 삭제 실패 (무시):`, err?.message)
        );
      }

      const displayUrl = await safeTransformToSignedUrl(storagePath);
      console.log(`✅ 아바타 클립 업로드 완료: ${personaId}/${resolvedGender}/${slot} → ${storagePath}`);

      res.json({ videoUrl: displayUrl, storageKey: storagePath });
    })
  );

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
