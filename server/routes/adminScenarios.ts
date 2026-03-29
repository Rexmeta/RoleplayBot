import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateScenarioWithAI, enhanceScenarioWithAI } from "../services/aiScenarioGenerator";
import { generateIntroVideo, deleteIntroVideo, getVideoGenerationStatus, getDefaultVideoPrompt } from "../services/gemini-video-generator";
import { generateImagePrompt } from "./imageGeneration";
import {
  transformScenariosMedia,
  transformScenarioMedia,
  transformToSignedUrl,
  listGCSFiles
} from "../services/gcsStorage";
import { getOperatorAccessibleCategoryIds, asyncHandler, createHttpError } from "./routerHelpers";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";

export default function createAdminScenariosRouter(isAuthenticated: any) {
  const router = Router();

  const checkOperatorScenarioAccess = async (user: any, scenarioId: string): Promise<{ hasAccess: boolean; error?: string }> => {
    if (user.role === 'admin') return { hasAccess: true };
    if (user.role !== 'operator') return { hasAccess: false, error: 'Unauthorized' };

    const scenarios = await fileManager.getAllScenarios();
    const scenario = scenarios.find((s: any) => s.id === scenarioId);
    if (!scenario) return { hasAccess: false, error: 'Scenario not found' };

    const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
    return { hasAccess: accessibleCategoryIds.includes(scenario.categoryId) };
  };

  router.post("/api/admin/sync-media-to-gcs", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "관리자 권한이 필요합니다");
    }

    if (!process.env.GCS_BUCKET_NAME) {
      throw createHttpError(400, "GCS_BUCKET_NAME이 설정되지 않았습니다");
    }

    console.log(`[Admin] Media sync to GCS triggered by user: ${req.user.email}`);

    const { syncToGCS } = await import("../scripts/syncToGCS");
    const result = await syncToGCS();

    res.json({
      message: "미디어 동기화 완료",
      ...result,
    });
  }));

  router.post("/api/admin/generate-scenario", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const {
      theme,
      industry,
      situation,
      timeline,
      stakes,
      playerRole,
      conflictType,
      objectiveType,
      skills,
      estimatedTime,
      difficulty,
      personaCount
    } = req.body;

    if (!theme) {
      throw createHttpError(400, "주제는 필수입니다");
    }

    const result = await generateScenarioWithAI({
      theme,
      industry,
      situation,
      timeline,
      stakes,
      playerRole,
      conflictType,
      objectiveType,
      skills,
      estimatedTime,
      difficulty: Number(difficulty) || 3,
      personaCount: Number(personaCount) || 3
    });

    const scenarioWithPersonas = {
      ...result.scenario,
      personas: result.personas
    };

    res.json({
      scenario: scenarioWithPersonas,
      personas: result.personas
    });
  }));

  router.post("/api/admin/enhance-scenario/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { enhancementType } = req.body;

    if (!enhancementType || !['improve', 'expand', 'simplify'].includes(enhancementType)) {
      throw createHttpError(400, "올바른 개선 유형을 선택해주세요");
    }

    const scenarios = await fileManager.getAllScenarios();
    const existingScenario = scenarios.find(s => s.id === req.params.id);

    if (!existingScenario) {
      throw createHttpError(404, "시나리오를 찾을 수 없습니다");
    }

    const enhancedData = await enhanceScenarioWithAI(existingScenario, enhancementType);

    res.json(enhancedData);
  }));

  router.get("/api/admin/scenarios", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const scenarios = await fileManager.getAllScenarios();
    const lang = req.query.lang as string;
    const mode = req.query.mode as string;

    const user = (req as any).user;

    let filteredScenarios = scenarios;

    if (user.role === 'operator') {
      const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
      if (accessibleCategoryIds.length === 0) {
        return res.json([]);
      }
      filteredScenarios = scenarios.filter((s: any) => accessibleCategoryIds.includes(s.categoryId));
    }

    if (mode === 'edit') {
      const scenariosWithOriginal = await Promise.all(
        filteredScenarios.map(async (scenario: any) => {
          try {
            const original = await storage.getOriginalScenarioTranslation(scenario.id);
            if (original) {
              return {
                ...scenario,
                title: original.title,
                description: original.description || scenario.description,
                context: {
                  ...scenario.context,
                  situation: original.situation || scenario.context?.situation,
                  timeline: original.timeline || scenario.context?.timeline,
                  stakes: original.stakes || scenario.context?.stakes,
                },
                objectives: original.objectives || scenario.objectives,
                successCriteria: {
                  optimal: original.successCriteriaOptimal || scenario.successCriteria?.optimal,
                  good: original.successCriteriaGood || scenario.successCriteria?.good,
                  acceptable: original.successCriteriaAcceptable || scenario.successCriteria?.acceptable,
                  failure: original.successCriteriaFailure || scenario.successCriteria?.failure,
                },
                _isOriginal: true,
                _sourceLocale: scenario.sourceLocale || 'ko',
              };
            }
            return { ...scenario, _sourceLocale: scenario.sourceLocale || 'ko' };
          } catch (err) {
            console.error(`[Admin Scenarios API] Original fetch error for ${scenario.id}:`, err);
            return scenario;
          }
        })
      );
      return res.json(scenariosWithOriginal);
    }

    if (lang) {
      const translatedScenarios = await Promise.all(
        filteredScenarios.map(async (scenario: any) => {
          try {
            const translation = await storage.getScenarioTranslationWithFallback(scenario.id, lang);
            if (translation) {
              const isOriginal = translation.isOriginal || translation.locale === scenario.sourceLocale;
              return {
                ...scenario,
                title: translation.title || scenario.title,
                description: translation.description || scenario.description,
                context: {
                  ...scenario.context,
                  situation: translation.situation || scenario.context?.situation,
                  timeline: translation.timeline || scenario.context?.timeline,
                  stakes: translation.stakes || scenario.context?.stakes,
                },
                objectives: translation.objectives || scenario.objectives,
                successCriteria: {
                  optimal: translation.successCriteriaOptimal || scenario.successCriteria?.optimal,
                  good: translation.successCriteriaGood || scenario.successCriteria?.good,
                  acceptable: translation.successCriteriaAcceptable || scenario.successCriteria?.acceptable,
                  failure: translation.successCriteriaFailure || scenario.successCriteria?.failure,
                },
                _translated: !isOriginal,
                _translationLocale: translation.locale,
                _sourceLocale: scenario.sourceLocale || 'ko',
              };
            }
            return { ...scenario, _sourceLocale: scenario.sourceLocale || 'ko' };
          } catch (err) {
            console.error(`[Admin Scenarios API] Translation fetch error for ${scenario.id}:`, err);
            return scenario;
          }
        })
      );
      const transformedScenarios = await transformScenariosMedia(translatedScenarios);
      return res.json(transformedScenarios);
    }

    const transformedScenarios = await transformScenariosMedia(filteredScenarios);
    res.json(transformedScenarios);
  }));

  router.post("/api/admin/scenarios", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;

    let scenarioData = req.body;
    const sourceLocale = scenarioData.sourceLocale || user.preferredLanguage || 'ko';

    if (user.role === 'operator') {
      const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
      if (accessibleCategoryIds.length === 0) {
        throw createHttpError(403, "No category assigned. Contact admin.");
      }

      if (user.assignedCategoryId) {
        scenarioData.categoryId = user.assignedCategoryId;
      } else if (scenarioData.categoryId) {
        if (!accessibleCategoryIds.includes(scenarioData.categoryId)) {
          throw createHttpError(403, "You cannot create scenarios in this category");
        }
      } else {
        throw createHttpError(400, "Category is required");
      }
    }

    scenarioData.sourceLocale = sourceLocale;

    const scenario = await fileManager.createScenario(scenarioData);

    try {
      await storage.upsertScenarioTranslation({
        scenarioId: scenario.id,
        locale: sourceLocale,
        sourceLocale: sourceLocale,
        isOriginal: true,
        title: scenario.title,
        description: scenario.description,
        situation: scenario.context?.situation || null,
        timeline: scenario.context?.timeline || null,
        stakes: scenario.context?.stakes || null,
        playerRole: scenario.context?.playerRole ?
          `${scenario.context.playerRole.position} / ${scenario.context.playerRole.department}` : null,
        objectives: scenario.objectives || null,
        skills: scenario.skills || null,
        successCriteriaOptimal: scenario.successCriteria?.optimal || null,
        successCriteriaGood: scenario.successCriteria?.good || null,
        successCriteriaAcceptable: scenario.successCriteria?.acceptable || null,
        successCriteriaFailure: scenario.successCriteria?.failure || null,
        isMachineTranslated: false,
        isReviewed: true,
      });
    } catch (translationError) {
      console.error("Error saving original translation:", translationError);
    }

    const transformedScenario = await transformScenarioMedia(scenario);
    res.json(transformedScenario);
  }));

  router.put("/api/admin/scenarios/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const scenarioId = req.params.id;

    if (req.body._translated) {
      throw createHttpError(400, "Cannot save translated content as original. Please edit in original language mode.");
    }

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "Access denied. Not authorized for this scenario.");
      }

      if (req.body.categoryId) {
        const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
        if (!accessibleCategoryIds.includes(req.body.categoryId)) {
          throw createHttpError(403, "You cannot move scenario to this category");
        }
      }
    }

    const existingScenarios = await fileManager.getAllScenarios();
    const existingScenario = existingScenarios.find((s: any) => s.id === scenarioId);
    const sourceLocale = req.body.sourceLocale || existingScenario?.sourceLocale || 'ko';

    const scenario = await fileManager.updateScenario(scenarioId, req.body);

    try {
      await storage.upsertScenarioTranslation({
        scenarioId: scenario.id,
        locale: sourceLocale,
        sourceLocale: sourceLocale,
        isOriginal: true,
        title: scenario.title,
        description: scenario.description,
        situation: scenario.context?.situation || null,
        timeline: scenario.context?.timeline || null,
        stakes: scenario.context?.stakes || null,
        playerRole: scenario.context?.playerRole ?
          `${scenario.context.playerRole.position} / ${scenario.context.playerRole.department}` : null,
        objectives: scenario.objectives || null,
        skills: scenario.skills || null,
        successCriteriaOptimal: scenario.successCriteria?.optimal || null,
        successCriteriaGood: scenario.successCriteria?.good || null,
        successCriteriaAcceptable: scenario.successCriteria?.acceptable || null,
        successCriteriaFailure: scenario.successCriteria?.failure || null,
        isMachineTranslated: false,
        isReviewed: true,
      });
    } catch (translationError) {
      console.error("Error updating original translation:", translationError);
    }

    const transformedScenario = await transformScenarioMedia(scenario);
    res.json(transformedScenario);
  }));

  router.patch("/api/admin/scenarios/:id/visibility", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const scenarioId = req.params.id;
    const { isPublic } = req.body;
    if (typeof isPublic !== 'boolean') {
      throw createHttpError(400, "isPublic must be a boolean");
    }
    const scenario = await fileManager.updateScenario(scenarioId, { isPublic });
    res.json({ id: scenario.id, isPublic: (scenario as any).isPublic });
  }));

  router.delete("/api/admin/scenarios/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const scenarioId = req.params.id;

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "Access denied. Not authorized for this scenario.");
      }
    }

    await fileManager.deleteScenario(scenarioId);
    res.json({ success: true });
  }));

  router.post("/api/admin/scenarios/default-image-prompt", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { scenarioTitle, description, theme, industry } = req.body;

    if (!scenarioTitle) {
      throw createHttpError(400, "scenarioTitle is required");
    }

    const prompt = generateImagePrompt(scenarioTitle, description, theme, industry);
    res.json({ success: true, prompt });
  }));

  router.post("/api/admin/scenarios/default-video-prompt", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { scenarioTitle, description, context } = req.body;

    if (!scenarioTitle) {
      throw createHttpError(400, "scenarioTitle is required");
    }

    const prompt = getDefaultVideoPrompt({
      scenarioTitle,
      description,
      context
    });
    res.json({ success: true, prompt });
  }));

  router.get("/api/admin/scenarios/images", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const files = await listGCSFiles('scenarios/');
    const imageFiles = files.filter(f =>
      /\.(webp|png|jpg|jpeg)$/i.test(f.name)
    );

    res.json({
      success: true,
      images: imageFiles.map(f => ({
        path: f.name,
        url: f.signedUrl,
        updatedAt: f.updatedAt
      }))
    });
  }));

  router.get("/api/admin/scenarios/videos", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const files = await listGCSFiles('videos/');
    const videoFiles = files.filter(f =>
      /\.(webm|mp4)$/i.test(f.name)
    );

    res.json({
      success: true,
      videos: videoFiles.map(f => ({
        path: f.name,
        url: f.signedUrl,
        updatedAt: f.updatedAt
      }))
    });
  }));

  router.post("/api/admin/scenarios/:id/generate-intro-video", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const scenarioId = req.params.id;
    const { customPrompt } = req.body;

    const scenarios = await fileManager.getAllScenarios();
    const scenario = scenarios.find((s: any) => s.id === scenarioId);

    if (!scenario) {
      throw createHttpError(404, "Scenario not found");
    }

    const status = getVideoGenerationStatus();
    if (!status.available) {
      throw Object.assign(createHttpError(503, "비디오 생성 서비스를 사용할 수 없습니다."), { reason: status.reason });
    }

    const oldVideoPath = scenario.introVideoUrl || null;

    console.log(`🎬 시나리오 인트로 비디오 생성 시작: ${scenario.title}`);

    const result = await generateIntroVideo({
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      description: scenario.description,
      customPrompt: customPrompt,
      context: {
        situation: scenario.context?.situation || scenario.description,
        stakes: scenario.context?.stakes || '',
        timeline: scenario.context?.timeline || ''
      }
    });

    if (!result.success) {
      throw Object.assign(createHttpError(500, result.error || "비디오 생성 실패"), { prompt: result.prompt });
    }

    await fileManager.updateScenario(scenarioId, {
      introVideoUrl: result.videoUrl
    } as any);

    if (oldVideoPath && oldVideoPath !== result.videoUrl) {
      await deleteIntroVideo(oldVideoPath);
    }

    console.log(`✅ 시나리오 인트로 비디오 생성 완료: ${result.videoUrl}`);

    const signedVideoUrl = await transformToSignedUrl(result.videoUrl) || result.videoUrl;

    res.json({
      success: true,
      videoUrl: signedVideoUrl,
      storagePath: result.videoUrl,
      prompt: result.prompt,
      metadata: result.metadata
    });
  }));

  router.delete("/api/admin/scenarios/:id/intro-video", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const scenarioId = req.params.id;

    const scenarios = await fileManager.getAllScenarios();
    const scenario = scenarios.find((s: any) => s.id === scenarioId);

    if (!scenario) {
      throw createHttpError(404, "Scenario not found");
    }

    if (!scenario.introVideoUrl) {
      return res.json({ success: true, message: "No intro video to delete" });
    }

    const deleted = await deleteIntroVideo(scenario.introVideoUrl);

    await fileManager.updateScenario(scenarioId, {
      introVideoUrl: ''
    } as any);

    console.log(`🗑️ 시나리오 인트로 비디오 삭제 완료: ${scenarioId}`);

    res.json({
      success: true,
      deleted
    });
  }));

  router.get("/api/admin/video-generation-status", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const status = getVideoGenerationStatus();
    res.json(status);
  }));

  router.post("/api/admin/scenarios/:id/duplicate", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const scenarioId = req.params.id;

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "Access denied.");
      }
    }

    const scenarios = await fileManager.getAllScenarios();
    const original = scenarios.find((s: any) => s.id === scenarioId);
    if (!original) {
      throw createHttpError(404, "Scenario not found");
    }

    const duplicateData: any = {
      ...original,
      title: `${original.title} (복사본)`,
      isPublic: false,
    };
    delete duplicateData.id;

    const created = await fileManager.createScenario(duplicateData);

    try {
      await storage.upsertScenarioTranslation({
        scenarioId: created.id,
        locale: (original as any).sourceLocale || 'ko',
        sourceLocale: (original as any).sourceLocale || 'ko',
        isOriginal: true,
        title: created.title,
        description: created.description,
        situation: created.context?.situation || null,
        timeline: created.context?.timeline || null,
        stakes: created.context?.stakes || null,
        playerRole: created.context?.playerRole
          ? `${(created.context.playerRole as any).position} / ${(created.context.playerRole as any).department}`
          : null,
        objectives: created.objectives || null,
        skills: created.skills || null,
        successCriteriaOptimal: created.successCriteria?.optimal || null,
        successCriteriaGood: created.successCriteria?.good || null,
        successCriteriaAcceptable: created.successCriteria?.acceptable || null,
        successCriteriaFailure: created.successCriteria?.failure || null,
        isMachineTranslated: false,
        isReviewed: true,
      });
    } catch (translationError) {
      console.error("Error saving duplicate translation:", translationError);
    }

    const transformedScenario = await transformScenarioMedia(created);
    res.json(transformedScenario);
  }));

  return router;
}
