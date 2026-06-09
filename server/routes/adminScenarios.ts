import { Router } from "express";
import express from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateScenarioWithAI, enhanceScenarioWithAI, fillScenarioFieldsWithAI, generateEvaluationHarnessWithAI, generatePlayerConstraintsWithAI, generateNpcBehaviorHarnessWithAI } from "../services/aiScenarioGenerator";
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
import { validateScenario } from "../services/scenarios/scenarioValidator";
import { mediaStorage } from "../services/mediaStorage";

export default function createAdminScenariosRouter(isAuthenticated: any) {
  const router = Router();

  const checkOperatorScenarioAccess = async (user: any, scenarioId: string): Promise<{ hasAccess: boolean; error?: string }> => {
    if (user.role === 'admin') return { hasAccess: true };
    if (user.role !== 'operator') return { hasAccess: false, error: 'Unauthorized' };

    const scenarios = await fileManager.getAllScenarios();
    const scenario = scenarios.find((s: any) => s.id === scenarioId);
    if (!scenario) return { hasAccess: false, error: 'Scenario not found' };

    const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
    return { hasAccess: accessibleCategoryIds.includes(scenario.categoryId ?? '') };
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
      idea,
      theme,
      industry,
      situation,
      timeline,
      stakes,
      playerRole,
      conflictType,
      objectiveType,
      skills,
      difficulty,
      personaCount
    } = req.body;

    if (!idea && !theme) {
      throw createHttpError(400, "시나리오 아이디어는 필수입니다");
    }

    const result = await generateScenarioWithAI({
      idea: idea || theme,
      theme: theme || idea,
      industry,
      situation,
      timeline,
      stakes,
      playerRole,
      conflictType,
      objectiveType,
      skills,
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

  router.post("/api/admin/generate-evaluation-harness", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { title, description, objectives, situation, playerRole } = req.body;
    if (!title && !description) {
      throw createHttpError(400, "시나리오 제목 또는 설명이 필요합니다");
    }
    const result = await generateEvaluationHarnessWithAI({ title, description, objectives, situation, playerRole });
    res.json({ success: true, evaluationHarness: result });
  }));

  router.post("/api/admin/generate-player-constraints", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { title, description, objectives, situation, playerRole } = req.body;
    if (!title && !description) {
      throw createHttpError(400, "시나리오 제목 또는 설명이 필요합니다");
    }
    const result = await generatePlayerConstraintsWithAI({ title, description, objectives, situation, playerRole });
    res.json({ success: true, playerConstraints: result });
  }));

  router.post("/api/admin/generate-npc-behavior-harness", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { title, description, situation, persona } = req.body;
    if (!title && !description) {
      throw createHttpError(400, "시나리오 제목 또는 설명이 필요합니다");
    }
    if (!persona || typeof persona !== 'object') {
      throw createHttpError(400, "페르소나 정보가 필요합니다");
    }
    const result = await generateNpcBehaviorHarnessWithAI({ title, description, situation, persona });
    res.json({ success: true, npcBehaviorHarness: result });
  }));

  router.post("/api/admin/fill-scenario-fields", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { idea } = req.body;
    if (!idea || !String(idea).trim()) {
      throw createHttpError(400, "시나리오 아이디어는 필수입니다");
    }
    const result = await fillScenarioFieldsWithAI(String(idea).trim());
    res.json(result);
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

    const enhancedData = await enhanceScenarioWithAI(existingScenario as any, enhancementType);

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
      const [translatedScenarios, allLocaleRows] = await Promise.all([
        Promise.all(
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
        ),
        storage.getAllScenarioTranslationLocales(),
      ]);

      const localeMap = new Map<string, Array<{ locale: string; isMachineTranslated: boolean; isReviewed: boolean; isOriginal: boolean }>>();
      for (const row of allLocaleRows) {
        if (!localeMap.has(row.scenarioId)) localeMap.set(row.scenarioId, []);
        localeMap.get(row.scenarioId)!.push({ locale: row.locale, isMachineTranslated: row.isMachineTranslated, isReviewed: row.isReviewed, isOriginal: row.isOriginal });
      }

      const scenariosWithSummary = translatedScenarios.map((s: any) => ({
        ...s,
        _translationLocales: localeMap.get(s.id) || [],
      }));

      const transformedScenarios = await transformScenariosMedia(scenariosWithSummary);
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

    // Auto-fix isPrimary: if no persona is marked primary, designate the first one
    if (Array.isArray(scenarioData.personas) && scenarioData.personas.length > 0) {
      const hasPrimary = scenarioData.personas.some((p: any) => p.isPrimary === true);
      if (!hasPrimary) {
        scenarioData.personas = scenarioData.personas.map((p: any, i: number) => ({ ...p, isPrimary: i === 0 }));
      }
    }

    // Pre-save validation
    const [allPersonas, allLangs] = await Promise.all([
      storage.getAllMbtiPersonas(),
      storage.getActiveSupportedLanguages(),
    ]);
    const mbtiPersonaIds = new Set(allPersonas.map(p => p.id));
    const activeLangs = allLangs.map((l: any) => l.code);
    const preValidation = validateScenario(scenarioData as any, mbtiPersonaIds, [], activeLangs);
    if (preValidation.hasFatalErrors) {
      throw createHttpError(400, "치명적 품질 오류로 저장할 수 없습니다.", { errors: preValidation.issues.filter(i => i.severity === 'error') } as any);
    }

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
    const nonFatalWarnings = preValidation.issues.filter(i => i.severity !== 'error');
    res.json({ ...transformedScenario, warnings: nonFatalWarnings.length > 0 ? nonFatalWarnings : undefined });
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

    // Pre-save validation
    const mergedData = { ...(existingScenario ?? {}), ...req.body };

    // Auto-fix isPrimary: if no persona is marked primary, designate the first one
    if (Array.isArray(mergedData.personas) && mergedData.personas.length > 0) {
      const hasPrimary = mergedData.personas.some((p: any) => p.isPrimary === true);
      if (!hasPrimary) {
        mergedData.personas = mergedData.personas.map((p: any, i: number) => ({ ...p, isPrimary: i === 0 }));
        if (req.body.personas) {
          req.body.personas = mergedData.personas;
        }
      }
    }

    const [allPersonas, allLangs, existingTranslations] = await Promise.all([
      storage.getAllMbtiPersonas(),
      storage.getActiveSupportedLanguages(),
      storage.getScenarioTranslations(scenarioId),
    ]);
    const mbtiPersonaIds = new Set(allPersonas.map(p => p.id));
    const activeLangs = allLangs.map((l: any) => l.code);
    const preValidation = validateScenario(mergedData as any, mbtiPersonaIds, existingTranslations, activeLangs);
    if (preValidation.hasFatalErrors) {
      throw createHttpError(400, "치명적 품질 오류로 저장할 수 없습니다.", { errors: preValidation.issues.filter(i => i.severity === 'error') } as any);
    }

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
    const nonFatalWarnings = preValidation.issues.filter(i => i.severity !== 'error');
    res.json({ ...transformedScenario, warnings: nonFatalWarnings.length > 0 ? nonFatalWarnings : undefined });
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
      introVideoUrl: result.videoUrl,
      introVideoMode: 'custom'
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
      introVideoUrl: '',
      introVideoMode: 'none'
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

  router.get("/api/admin/scenarios/:id/versions", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const scenarioId = req.params.id;

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "Access denied.");
      }
    }

    const versions = await storage.getScenarioVersions(scenarioId);
    res.json(versions);
  }));

  router.post("/api/admin/scenarios/:id/publish", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const scenarioId = req.params.id;

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "Access denied.");
      }
    }

    // Pre-publish validation
    const allScenariosForPublish = await fileManager.getAllScenarios();
    const scenarioForPublish = allScenariosForPublish.find((s: any) => s.id === scenarioId);
    if (!scenarioForPublish) throw createHttpError(404, "Scenario not found");

    const [personasForPublish, langsForPublish, translationsForPublish] = await Promise.all([
      storage.getAllMbtiPersonas(),
      storage.getActiveSupportedLanguages(),
      storage.getScenarioTranslations(scenarioId),
    ]);
    const publishMbtiIds = new Set(personasForPublish.map(p => p.id));
    const publishActiveLangs = langsForPublish.map((l: any) => l.code);
    const publishValidation = validateScenario(scenarioForPublish as any, publishMbtiIds, translationsForPublish, publishActiveLangs);

    if (publishValidation.hasFatalErrors) {
      throw createHttpError(400, "치명적 품질 오류로 발행할 수 없습니다.", { errors: publishValidation.issues.filter(i => i.severity === 'error') } as any);
    }

    const version = await storage.publishScenarioVersion(scenarioId, user.id);
    const nonFatalPublishWarnings = publishValidation.issues.filter(i => i.severity !== 'error');
    res.json({ ...version, warnings: nonFatalPublishWarnings.length > 0 ? nonFatalPublishWarnings : undefined });
  }));

  router.post("/api/admin/scenarios/:id/versions/:versionId/rollback", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const { id: scenarioId, versionId } = req.params;

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "Access denied.");
      }
    }

    const existingVersion = await storage.getScenarioVersion(versionId);
    if (!existingVersion || existingVersion.scenarioId !== scenarioId) {
      throw createHttpError(404, "Version not found");
    }

    const newVersion = await storage.rollbackToVersion(versionId, user.id);
    res.json(newVersion);
  }));

  router.get("/api/admin/scenarios/:id/versions/:versionId", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const { id: scenarioId, versionId } = req.params;

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "Access denied.");
      }
    }

    const version = await storage.getScenarioVersion(versionId);
    if (!version || version.scenarioId !== scenarioId) {
      throw createHttpError(404, "Version not found");
    }

    res.json(version);
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

  // GET /api/admin/default-intro-video — get the current default intro video info (admin only)
  router.get("/api/admin/default-intro-video", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') throw createHttpError(403, "Admin only");

    const setting = await storage.getSystemSetting('media', 'default_intro_video');
    if (!setting?.value) {
      return res.json({ hasCustomVideo: false, url: '/videos/intro_default.webm' });
    }

    const candidate = await transformToSignedUrl(setting.value);
    const isHttpUrl = candidate && /^https?:\/\//i.test(candidate);
    const servingUrl = isHttpUrl ? candidate : `/objects?key=${encodeURIComponent(setting.value)}`;
    return res.json({ hasCustomVideo: true, storagePath: setting.value, url: servingUrl });
  }));

  // POST /api/admin/default-intro-video — upload a new default intro video (admin only)
  router.post(
    "/api/admin/default-intro-video",
    isAuthenticated,
    express.raw({ type: ['video/webm', 'video/mp4', 'video/*', 'application/octet-stream'], limit: '500mb' }),
    asyncHandler(async (req: any, res) => {
      if (req.user?.role !== 'admin') throw createHttpError(403, "Admin only");

      const buffer = req.body as Buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw createHttpError(400, "No video data received");
      }

      const rawContentType = (req.headers['content-type'] || 'video/webm').split(';')[0].trim();
      const ext = rawContentType.includes('mp4') ? 'mp4' : 'webm';
      const contentType = ext === 'mp4' ? 'video/mp4' : 'video/webm';
      const storagePath = `videos/intro_default.${ext}`;

      await mediaStorage.saveToFixedPath(buffer, storagePath, contentType);

      await storage.upsertSystemSetting({
        category: 'media',
        key: 'default_intro_video',
        value: storagePath,
        description: '관리자가 업로드한 기본 인트로 비디오 경로',
        updatedBy: req.user.id,
      });

      const candidate = await transformToSignedUrl(storagePath);
      const isHttpUrl = candidate && /^https?:\/\//i.test(candidate);
      const servingUrl = isHttpUrl ? candidate : `/objects?key=${encodeURIComponent(storagePath)}`;

      console.log(`🎬 기본 인트로 비디오 업데이트 완료: ${storagePath} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);

      res.json({ success: true, storagePath, url: servingUrl });
    })
  );

  // DELETE /api/admin/default-intro-video — revert to static default video (admin only)
  router.delete("/api/admin/default-intro-video", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') throw createHttpError(403, "Admin only");

    await storage.deleteSystemSetting('media', 'default_intro_video');

    res.json({ success: true, message: '기본 인트로 비디오가 초기화되었습니다.' });
  }));

  // GET /api/admin/scenarios/validate — bulk validate all scenarios (for admin UI)
  router.get("/api/admin/scenarios/validate", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;

    let allScenarios = await fileManager.getAllScenarios();
    if (user.role === 'operator') {
      const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
      allScenarios = allScenarios.filter((s: any) => accessibleCategoryIds.includes(s.categoryId));
    }

    const [allPersonas, allLangs] = await Promise.all([
      storage.getAllMbtiPersonas(),
      storage.getActiveSupportedLanguages(),
    ]);
    const mbtiPersonaIds = new Set(allPersonas.map(p => p.id));
    const activeLangs = allLangs.map(l => l.code);

    const results = await Promise.all(
      allScenarios.map(async (scenario: any) => {
        const translations = await storage.getScenarioTranslations(scenario.id);
        return validateScenario(scenario, mbtiPersonaIds, translations, activeLangs);
      })
    );

    const byId: Record<string, { score: number; issues: any[]; hasFatalErrors: boolean }> = {};
    for (const r of results) {
      byId[r.scenarioId] = { score: r.score, issues: r.issues, hasFatalErrors: r.hasFatalErrors };
    }
    res.json(byId);
  }));

  // GET /api/admin/scenarios/:id/validate — validate a single scenario
  router.get("/api/admin/scenarios/:id/validate", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const user = (req as any).user;
    const scenarioId = req.params.id;

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "Access denied.");
      }
    }

    const allScenarios = await fileManager.getAllScenarios();
    const scenario = allScenarios.find((s: any) => s.id === scenarioId);
    if (!scenario) throw createHttpError(404, "Scenario not found");

    const [allPersonas, allLangs, translations] = await Promise.all([
      storage.getAllMbtiPersonas(),
      storage.getActiveSupportedLanguages(),
      storage.getScenarioTranslations(scenarioId),
    ]);

    const mbtiPersonaIds = new Set(allPersonas.map(p => p.id));
    const activeLangs = allLangs.map(l => l.code);

    const result = validateScenario(scenario as any, mbtiPersonaIds, translations, activeLangs);
    res.json(result);
  }));

  return router;
}
