import { Router } from "express";
import { storage } from "../storage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { fileManager } from "../services/fileManager";
import { GoogleGenAI } from "@google/genai";
import { asyncHandler, createHttpError } from "./routerHelpers";

export default function createTranslationsRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/languages", asyncHandler(async (req, res) => {
    const languages = await storage.getActiveSupportedLanguages();
    res.json(languages);
  }));

  router.get("/api/admin/languages", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const languages = await storage.getSupportedLanguages();
    res.json(languages);
  }));

  router.post("/api/admin/languages", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { code, name, nativeName, displayOrder } = req.body;
    if (!code || !name || !nativeName) {
      throw createHttpError(400, "언어 코드, 이름, 네이티브 이름은 필수입니다");
    }

    const language = await storage.createSupportedLanguage({
      code,
      name,
      nativeName,
      isActive: true,
      isDefault: false,
      displayOrder: displayOrder || 99,
    });
    res.json(language);
  }));

  router.put("/api/admin/languages/:code", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { code } = req.params;
    const updates = req.body;
    const language = await storage.updateSupportedLanguage(code, updates);
    res.json(language);
  }));

  router.delete("/api/admin/languages/:code", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { code } = req.params;

    if (code === 'ko') {
      throw createHttpError(400, "기본 언어(한국어)는 삭제할 수 없습니다");
    }

    await storage.deleteSupportedLanguage(code);
    res.json({ success: true });
  }));

  router.get("/api/scenarios/:scenarioId/translations/:locale", asyncHandler(async (req, res) => {
    const { scenarioId, locale } = req.params;
    const translation = await storage.getScenarioTranslation(scenarioId, locale);

    if (!translation) {
      throw createHttpError(404, "번역을 찾을 수 없습니다");
    }

    res.json(translation);
  }));

  router.get("/api/scenarios/:scenarioId/translations", asyncHandler(async (req, res) => {
    const { scenarioId } = req.params;
    const translations = await storage.getScenarioTranslations(scenarioId);
    res.json(translations);
  }));

  router.put("/api/admin/scenarios/:scenarioId/translations/:locale", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { scenarioId, locale } = req.params;
    const {
      title,
      description,
      situation,
      timeline,
      stakes,
      playerRole,
      objectives,
      skills,
      successCriteriaOptimal,
      successCriteriaGood,
      successCriteriaAcceptable,
      successCriteriaFailure,
      personaContexts,
      isMachineTranslated
    } = req.body;

    if (!title) {
      throw createHttpError(400, "제목은 필수입니다");
    }

    const translation = await storage.upsertScenarioTranslation({
      scenarioId,
      locale,
      title,
      description,
      situation,
      timeline,
      stakes,
      playerRole,
      objectives: objectives || null,
      skills: skills || null,
      successCriteriaOptimal,
      successCriteriaGood,
      successCriteriaAcceptable,
      successCriteriaFailure,
      personaContexts: personaContexts || null,
      isMachineTranslated: isMachineTranslated || false,
      isReviewed: false,
    });

    res.json(translation);
  }));

  router.post("/api/admin/scenarios/:scenarioId/translations/:locale/review", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { scenarioId, locale } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw createHttpError(401, "인증이 필요합니다");
    }

    const translation = await storage.markScenarioTranslationReviewed(scenarioId, locale, userId);
    res.json(translation);
  }));

  router.delete("/api/admin/scenarios/:scenarioId/translations/:locale", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { scenarioId, locale } = req.params;

    if (locale === 'ko') {
      throw createHttpError(400, "기본 언어 번역은 삭제할 수 없습니다");
    }

    await storage.deleteScenarioTranslation(scenarioId, locale);
    res.json({ success: true });
  }));

  router.post("/api/admin/scenarios/:scenarioId/generate-translation", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { scenarioId } = req.params;
    const { targetLocale, sourceLocale = 'ko' } = req.body;

    if (!targetLocale) {
      throw createHttpError(400, "대상 언어가 필요합니다");
    }

    if (sourceLocale === targetLocale) {
      throw createHttpError(400, "원문 언어와 대상 언어가 동일합니다");
    }

    const allScenarios = await fileManager.getAllScenarios();
    const scenario = allScenarios.find(s => s.id === scenarioId);
    if (!scenario) {
      throw createHttpError(404, "시나리오를 찾을 수 없습니다");
    }

    const languages = await storage.getActiveSupportedLanguages();
    const targetLang = languages.find(l => l.code === targetLocale);
    const sourceLang = languages.find(l => l.code === sourceLocale);
    if (!targetLang) {
      throw createHttpError(400, "지원하지 않는 대상 언어입니다");
    }
    if (!sourceLang) {
      throw createHttpError(400, "지원하지 않는 원문 언어입니다");
    }

    const languageNames: Record<string, string> = {
      'ko': 'Korean (한국어)',
      'en': 'English',
      'ja': 'Japanese (日本語)',
      'zh': 'Chinese Simplified (简体中文)',
    };

    let sourceData: any = {
      title: scenario.title,
      description: scenario.description,
      situation: (scenario as any).context?.situation || '',
      timeline: (scenario as any).context?.timeline || '',
      stakes: (scenario as any).context?.stakes || '',
      playerRole: '',
      objectives: (scenario as any).objectives || [],
      skills: (scenario as any).skills || [],
      successCriteriaOptimal: (scenario as any).successCriteria?.optimal || '',
      successCriteriaGood: (scenario as any).successCriteria?.good || '',
      successCriteriaAcceptable: (scenario as any).successCriteria?.acceptable || '',
      successCriteriaFailure: (scenario as any).successCriteria?.failure || '',
    };

    const playerRoleObj = (scenario as any).context?.playerRole;
    sourceData.playerRole = typeof playerRoleObj === 'object'
      ? [playerRoleObj?.position, playerRoleObj?.department, playerRoleObj?.experience, playerRoleObj?.responsibility].filter(Boolean).join(' / ')
      : (playerRoleObj || '');

    const scenarioPersonas = (scenario as any).personas || [];
    const personaContextsSource = scenarioPersonas.map((p: any) => ({
      personaId: p.id || p.personaRef || '',
      personaName: p.name || p.id || '',
      position: p.position || '',
      department: p.department || '',
      role: p.role || '',
      stance: p.stance || '',
      goal: p.goal || '',
      tradeoff: p.tradeoff || '',
    })).filter((p: any) => p.personaId);
    sourceData.personaContexts = personaContextsSource;

    if (sourceLocale !== 'ko') {
      const sourceTranslation = await storage.getScenarioTranslation(scenarioId, sourceLocale);
      if (!sourceTranslation) {
        throw createHttpError(400, `원문 언어(${sourceLocale})의 번역이 존재하지 않습니다`);
      }
      sourceData = {
        title: sourceTranslation.title,
        description: sourceTranslation.description || '',
        situation: sourceTranslation.situation || '',
        timeline: sourceTranslation.timeline || '',
        stakes: sourceTranslation.stakes || '',
        playerRole: sourceTranslation.playerRole || '',
        objectives: sourceTranslation.objectives || [],
        skills: (sourceTranslation as any).skills || (scenario as any).skills || [],
        successCriteriaOptimal: sourceTranslation.successCriteriaOptimal || '',
        successCriteriaGood: sourceTranslation.successCriteriaGood || '',
        successCriteriaAcceptable: sourceTranslation.successCriteriaAcceptable || '',
        successCriteriaFailure: sourceTranslation.successCriteriaFailure || '',
        personaContexts: (sourceTranslation as any).personaContexts || personaContextsSource,
      };
    }

    const personaContextsPrompt = sourceData.personaContexts?.length > 0
      ? `\nPersona Contexts (translate position, department, role, stance, goal, tradeoff for each persona):\n${JSON.stringify(sourceData.personaContexts, null, 2)}`
      : '';

    const personaContextsJsonFormat = sourceData.personaContexts?.length > 0
      ? `,
    "personaContexts": [
      {
        "personaId": "keep the original personaId unchanged",
        "position": "translated position",
        "department": "translated department",
        "role": "translated role",
        "stance": "translated stance",
        "goal": "translated goal",
        "tradeoff": "translated tradeoff"
      }
    ]`
      : '';

    const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} roleplay scenario into ${languageNames[targetLocale] || targetLocale}. 
Maintain the professional tone and context. Provide translations in JSON format.

Source scenario:
Title: ${sourceData.title}
Description: ${sourceData.description}
Situation: ${sourceData.situation}
Timeline: ${sourceData.timeline}
Stakes: ${sourceData.stakes}
Player Role: ${sourceData.playerRole}
Objectives: ${JSON.stringify(sourceData.objectives)}
Skills (Key Competencies): ${JSON.stringify(sourceData.skills)}
Success Criteria (Optimal): ${sourceData.successCriteriaOptimal}
Success Criteria (Good): ${sourceData.successCriteriaGood}
Success Criteria (Acceptable): ${sourceData.successCriteriaAcceptable}
Success Criteria (Failure): ${sourceData.successCriteriaFailure}${personaContextsPrompt}

Return ONLY valid JSON in this exact format:
{
  "title": "translated title",
  "description": "translated description",
  "situation": "translated situation",
  "timeline": "translated timeline",
  "stakes": "translated stakes",
  "playerRole": "translated player role",
  "objectives": ["translated objective 1", "translated objective 2"],
  "skills": ["translated skill 1", "translated skill 2"],
  "successCriteriaOptimal": "translated optimal criteria",
  "successCriteriaGood": "translated good criteria",
  "successCriteriaAcceptable": "translated acceptable criteria",
  "successCriteriaFailure": "translated failure criteria"${personaContextsJsonFormat}
}`;

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw createHttpError(500, "API 키가 설정되지 않았습니다");
    }

    const genAI = new GoogleGenAI({ apiKey });
    const model = (genAI as any).getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    let translation;
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        translation = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("JSON not found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse AI translation response:", parseError);
      throw createHttpError(500, "AI 응답 파싱 실패");
    }

    res.json({ success: true, translation });
  }));

  router.post("/api/admin/scenarios/:scenarioId/auto-translate", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { scenarioId } = req.params;
    const { sourceLocale = 'ko' } = req.body;

    const allScenarios = await fileManager.getAllScenarios();
    const scenario = allScenarios.find(s => s.id === scenarioId);
    if (!scenario) {
      throw createHttpError(404, "시나리오를 찾을 수 없습니다");
    }

    const languages = await storage.getActiveSupportedLanguages();
    const targetLocales = languages.filter(l => l.code !== sourceLocale).map(l => l.code);

    const languageNames: Record<string, string> = {
      'ko': 'Korean (한국어)',
      'en': 'English',
      'ja': 'Japanese (日本語)',
      'zh': 'Chinese Simplified (简体中文)',
    };

    let translatedCount = 0;

    const playerRoleObj = (scenario as any).context?.playerRole;
    const playerRoleStr = typeof playerRoleObj === 'object'
      ? [playerRoleObj?.position, playerRoleObj?.department, playerRoleObj?.experience, playerRoleObj?.responsibility].filter(Boolean).join(' / ')
      : (playerRoleObj || '');

    const scenarioPersonas = (scenario as any).personas || [];
    const personaContexts = scenarioPersonas.map((p: any) => ({
      personaId: p.id || p.personaRef || '',
      position: p.position || '',
      department: p.department || '',
      role: p.role || '',
      stance: p.stance || '',
      goal: p.goal || '',
      tradeoff: p.tradeoff || '',
    })).filter((p: any) => p.personaId);

    await storage.upsertScenarioTranslation({
      scenarioId,
      locale: sourceLocale,
      sourceLocale,
      isOriginal: true,
      title: scenario.title,
      description: scenario.description,
      situation: (scenario as any).context?.situation || '',
      timeline: (scenario as any).context?.timeline || '',
      stakes: (scenario as any).context?.stakes || '',
      playerRole: playerRoleStr,
      objectives: (scenario as any).objectives || [],
      successCriteriaOptimal: (scenario as any).successCriteria?.optimal || '',
      successCriteriaGood: (scenario as any).successCriteria?.good || '',
      successCriteriaAcceptable: (scenario as any).successCriteria?.acceptable || '',
      successCriteriaFailure: (scenario as any).successCriteria?.failure || '',
      personaContexts,
      isMachineTranslated: false,
      isReviewed: true,
    });

    for (const targetLocale of targetLocales) {
      const personaContextsPrompt = personaContexts.length > 0
        ? `\nPersona Contexts (translate position, department, role, stance, goal, tradeoff for each persona):\n${JSON.stringify(personaContexts, null, 2)}`
        : '';

      const personaContextsJsonFormat = personaContexts.length > 0
        ? `,
    "personaContexts": [
      {
        "personaId": "keep the original personaId unchanged",
        "position": "translated position",
        "department": "translated department",
        "role": "translated role",
        "stance": "translated stance",
        "goal": "translated goal",
        "tradeoff": "translated tradeoff"
      }
    ]`
        : '';

      const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} roleplay scenario into ${languageNames[targetLocale] || targetLocale}. 
Maintain the professional tone and context. Provide translations in JSON format.

Source scenario:
Title: ${scenario.title}
Description: ${scenario.description}
Situation: ${(scenario as any).context?.situation || ''}
Timeline: ${(scenario as any).context?.timeline || ''}
Stakes: ${(scenario as any).context?.stakes || ''}
Player Role: ${playerRoleStr}
Objectives: ${JSON.stringify((scenario as any).objectives || [])}
Success Criteria - Optimal: ${(scenario as any).successCriteria?.optimal || ''}
Success Criteria - Good: ${(scenario as any).successCriteria?.good || ''}
Success Criteria - Acceptable: ${(scenario as any).successCriteria?.acceptable || ''}
Success Criteria - Failure: ${(scenario as any).successCriteria?.failure || ''}${personaContextsPrompt}

Return ONLY valid JSON:
{
  "title": "translated title",
  "description": "translated description",
  "situation": "translated situation",
  "timeline": "translated timeline",
  "stakes": "translated stakes",
  "playerRole": "translated player role",
  "objectives": ["translated objective 1", "translated objective 2"],
  "successCriteriaOptimal": "translated optimal criteria",
  "successCriteriaGood": "translated good criteria",
  "successCriteriaAcceptable": "translated acceptable criteria",
  "successCriteriaFailure": "translated failure criteria"${personaContextsJsonFormat}
}`;

      try {
        const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("API Key not found");
        const genAI = new GoogleGenAI({ apiKey });
        const model = (genAI as any).getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(prompt);
        const response = result.response.text();

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const translation = JSON.parse(jsonMatch[0]);
          await storage.upsertScenarioTranslation({
            scenarioId,
            locale: targetLocale,
            sourceLocale,
            isOriginal: false,
            title: translation.title,
            description: translation.description,
            situation: translation.situation,
            timeline: translation.timeline,
            stakes: translation.stakes,
            playerRole: translation.playerRole,
            objectives: translation.objectives || [],
            successCriteriaOptimal: translation.successCriteriaOptimal,
            successCriteriaGood: translation.successCriteriaGood,
            successCriteriaAcceptable: translation.successCriteriaAcceptable,
            successCriteriaFailure: translation.successCriteriaFailure,
            personaContexts: translation.personaContexts || personaContexts,
            isMachineTranslated: true,
            isReviewed: false,
          });
          translatedCount++;
        }
      } catch (e) {
        console.error(`Failed to translate scenario ${scenarioId} to ${targetLocale}:`, e);
      }
    }

    res.json({
      success: true,
      message: `${translatedCount}개 언어로 번역 완료`,
      translatedCount,
      targetLocales
    });
  }));

  router.get("/api/personas/:personaId/translations/:locale", asyncHandler(async (req, res) => {
    const { personaId, locale } = req.params;
    const translation = await storage.getPersonaTranslation(personaId, locale);

    if (!translation) {
      throw createHttpError(404, "번역을 찾을 수 없습니다");
    }

    res.json(translation);
  }));

  router.get("/api/personas/:personaId/translations", asyncHandler(async (req, res) => {
    const { personaId } = req.params;
    const translations = await storage.getPersonaTranslations(personaId);
    res.json(translations);
  }));

  router.put("/api/admin/personas/:personaId/translations/:locale", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { personaId, locale } = req.params;
    const {
      name,
      personalityDescription,
      isMachineTranslated
    } = req.body;

    if (!name) {
      throw createHttpError(400, "이름은 필수입니다");
    }

    const translation = await storage.upsertPersonaTranslation({
      personaId,
      locale,
      name,
      personalityDescription,
      isMachineTranslated: isMachineTranslated || false,
      isReviewed: false,
    });

    res.json(translation);
  }));

  router.post("/api/admin/personas/:personaId/translations/:locale/review", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { personaId, locale } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw createHttpError(401, "인증이 필요합니다");
    }

    const translation = await storage.markPersonaTranslationReviewed(personaId, locale, userId);
    res.json(translation);
  }));

  router.delete("/api/admin/personas/:personaId/translations/:locale", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { personaId, locale } = req.params;

    if (locale === 'ko') {
      throw createHttpError(400, "기본 언어 번역은 삭제할 수 없습니다");
    }

    await storage.deletePersonaTranslation(personaId, locale);
    res.json({ success: true });
  }));

  router.post("/api/admin/personas/:personaId/generate-translation", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { personaId } = req.params;
    const { targetLocale, sourceLocale = 'ko' } = req.body;

    if (!targetLocale) {
      throw createHttpError(400, "대상 언어가 필요합니다");
    }

    const personas = await fileManager.getAllPersonas();
    const persona = personas.find(p => p.id === personaId);
    if (!persona) {
      throw createHttpError(404, "페르소나를 찾을 수 없습니다");
    }

    const languageNames: Record<string, string> = {
      'ko': 'Korean (한국어)',
      'en': 'English',
      'ja': 'Japanese (日本語)',
      'zh': 'Chinese Simplified (简体中文)',
    };

    let sourceName = persona.name;
    let sourceDesc = (persona as any).personalityDescription || '';

    if (sourceLocale !== 'ko') {
      const sourceTranslation = await storage.getPersonaTranslation(personaId, sourceLocale);
      if (sourceTranslation) {
        sourceName = sourceTranslation.name;
        sourceDesc = sourceTranslation.personalityDescription || '';
      }
    }

    const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} persona description into ${languageNames[targetLocale] || targetLocale}. 
Return ONLY valid JSON.

Persona Name: ${sourceName}
Description: ${sourceDesc}

Return JSON: {"name": "translated name", "personalityDescription": "translated description"}`;

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("API Key not found");
    const genAI = new GoogleGenAI({ apiKey });
    const model = (genAI as any).getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    const jsonMatch = response.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const translation = JSON.parse(jsonMatch[0]);
      res.json({ success: true, translation });
    } else {
      throw new Error("Invalid AI response format");
    }
  }));

  router.get("/api/categories/:categoryId/translations/:locale", asyncHandler(async (req, res) => {
    const { categoryId, locale } = req.params;
    const translation = await storage.getCategoryTranslation(categoryId, locale);

    if (!translation) {
      throw createHttpError(404, "번역을 찾을 수 없습니다");
    }

    res.json(translation);
  }));

  router.get("/api/categories/:categoryId/translations", asyncHandler(async (req, res) => {
    const { categoryId } = req.params;
    const translations = await storage.getCategoryTranslations(categoryId);
    res.json(translations);
  }));

  router.put("/api/admin/categories/:categoryId/translations/:locale", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { categoryId, locale } = req.params;
    const {
      name,
      description,
      isMachineTranslated
    } = req.body;

    if (!name) {
      throw createHttpError(400, "이름은 필수입니다");
    }

    const translation = await storage.upsertCategoryTranslation({
      categoryId,
      locale,
      name,
      description,
      isMachineTranslated: isMachineTranslated || false,
      isReviewed: false,
    });

    res.json(translation);
  }));

  router.delete("/api/admin/categories/:categoryId/translations/:locale", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { categoryId, locale } = req.params;

    if (locale === 'ko') {
      throw createHttpError(400, "기본 언어 번역은 삭제할 수 없습니다");
    }

    await storage.deleteCategoryTranslation(categoryId, locale);
    res.json({ success: true });
  }));

  router.post("/api/admin/generate-all-translations", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { targetLocale, contentType, sourceLocale = 'ko' } = req.body;

    if (!targetLocale || !contentType) {
      throw createHttpError(400, "대상 언어와 콘텐츠 타입이 필요합니다");
    }

    if (sourceLocale === targetLocale) {
      throw createHttpError(400, "원문 언어와 대상 언어가 동일합니다");
    }

    const languages = await storage.getActiveSupportedLanguages();
    const targetLang = languages.find(l => l.code === targetLocale);
    const sourceLang = languages.find(l => l.code === sourceLocale);
    if (!targetLang) {
      throw createHttpError(400, "지원하지 않는 대상 언어입니다");
    }
    if (!sourceLang) {
      throw createHttpError(400, "지원하지 않는 원문 언어입니다");
    }

    const languageNames: Record<string, string> = {
      'ko': 'Korean (한국어)',
      'en': 'English',
      'ja': 'Japanese (日本語)',
      'zh': 'Chinese Simplified (简体中文)',
    };

    let count = 0;

    if (contentType === 'scenarios') {
      const scenarios = await storage.getAllScenarios();
      for (const scenario of scenarios) {
        const existing = await storage.getScenarioTranslation(String(scenario.id), targetLocale);
        if (!existing) {
          let sourceTitle = scenario.title;
          let sourceDesc = scenario.description;

          if (sourceLocale !== 'ko') {
            const sourceTranslation = await storage.getScenarioTranslation(String(scenario.id), sourceLocale);
            if (!sourceTranslation) continue;
            sourceTitle = sourceTranslation.title;
            sourceDesc = sourceTranslation.description || '';
          }

          const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} roleplay scenario into ${languageNames[targetLocale] || targetLocale}. 
Maintain the professional tone and context. Return ONLY valid JSON.

Source scenario:
Title: ${sourceTitle}
Description: ${sourceDesc}

Return JSON: {"title": "translated title", "description": "translated description"}`;

          try {
            const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
            if (!apiKey) throw new Error("API Key not found");
            const genAI = new GoogleGenAI({ apiKey });
            const model = (genAI as any).getGenerativeModel({ model: 'gemini-2.0-flash' });
            const result = await model.generateContent(prompt);
            const response = result.response.text();

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const translation = JSON.parse(jsonMatch[0]);
              await storage.upsertScenarioTranslation({
                scenarioId: String(scenario.id),
                locale: targetLocale,
                title: translation.title,
                description: translation.description,
                isMachineTranslated: true,
                isReviewed: false,
                sourceLocale: sourceLocale,
              });
              count++;
            }
          } catch (e) {
            console.error(`Failed to translate scenario ${scenario.id}:`, e);
          }
        }
      }
    } else if (contentType === 'personas') {
      const personas = await fileManager.getAllPersonas();
      for (const persona of personas) {
        const existing = await storage.getPersonaTranslation(persona.id, targetLocale);
        if (!existing) {
          const personaData = persona as any;
          let sourceName = '';
          let sourceDesc = '';

          if (sourceLocale !== 'ko') {
            const sourceTranslation = await storage.getPersonaTranslation(persona.id, sourceLocale);
            if (!sourceTranslation) continue;
            sourceName = sourceTranslation.name;
            sourceDesc = sourceTranslation.personalityDescription || '';
          }

          const prompt = sourceLocale === 'ko'
            ? `Translate the following ${languageNames[sourceLocale] || sourceLocale} MBTI persona into ${languageNames[targetLocale] || targetLocale}. 
Return ONLY valid JSON.

Source: MBTI ${personaData.mbti}, Traits: ${JSON.stringify(personaData.personality_traits || [])}

Return JSON: {"name": "type name", "personalityDescription": "description"}`
            : `Translate the following ${languageNames[sourceLocale] || sourceLocale} MBTI persona into ${languageNames[targetLocale] || targetLocale}. 
Return ONLY valid JSON.

Source: Name: ${sourceName}, Description: ${sourceDesc}

Return JSON: {"name": "type name", "personalityDescription": "description"}`;

          try {
            const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
            if (!apiKey) throw new Error("API Key not found");
            const genAI = new GoogleGenAI({ apiKey });
            const model = (genAI as any).getGenerativeModel({ model: 'gemini-2.0-flash' });
            const result = await model.generateContent(prompt);
            const response = result.response.text();

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const translation = JSON.parse(jsonMatch[0]);
              await storage.upsertPersonaTranslation({
                personaId: persona.id,
                locale: targetLocale,
                name: translation.name,
                personalityDescription: translation.personalityDescription,
                isMachineTranslated: true,
                isReviewed: false,
                sourceLocale: sourceLocale,
              });
              count++;
            }
          } catch (e) {
            console.error(`Failed to translate persona ${persona.id}:`, e);
          }
        }
      }
    } else if (contentType === 'categories') {
      const categories = await storage.getAllCategories();
      for (const category of categories) {
        const existing = await storage.getCategoryTranslation(String(category.id), targetLocale);
        if (!existing) {
          let sourceName = category.name;
          let sourceDesc = category.description || '';

          if (sourceLocale !== 'ko') {
            const sourceTranslation = await storage.getCategoryTranslation(String(category.id), sourceLocale);
            if (!sourceTranslation) continue;
            sourceName = sourceTranslation.name;
            sourceDesc = sourceTranslation.description || '';
          }

          const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} category into ${languageNames[targetLocale] || targetLocale}. 
Return ONLY valid JSON.

Source: Name: ${sourceName}, Description: ${sourceDesc}

Return JSON: {"name": "translated name", "description": "translated description"}`;

          try {
            const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
            if (!apiKey) throw new Error("API Key not found");
            const genAI = new GoogleGenAI({ apiKey });
            const model = (genAI as any).getGenerativeModel({ model: 'gemini-2.0-flash' });
            const result = await model.generateContent(prompt);
            const response = result.response.text();

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const translation = JSON.parse(jsonMatch[0]);
              await storage.upsertCategoryTranslation({
                categoryId: String(category.id),
                locale: targetLocale,
                name: translation.name,
                description: translation.description,
                isMachineTranslated: true,
                isReviewed: false,
                sourceLocale: sourceLocale,
              });
              count++;
            }
          } catch (e) {
            console.error(`Failed to translate category ${category.id}:`, e);
          }
        }
      }
    }

    res.json({ success: true, count });
  }));

  router.get("/api/admin/translation-status", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const languages = await storage.getActiveSupportedLanguages();
    const nonDefaultLanguages = languages.filter((l: any) => !l.isDefault);
    const scenarios = await storage.getAllScenarios();
    const personas = await storage.getAllPersonas();
    const categories = await storage.getAllCategories();

    const scenarioTranslations: Record<string, { count: number; reviewed: number; machine: number }> = {};
    const personaTranslations: Record<string, { count: number; reviewed: number; machine: number }> = {};
    const categoryTranslations: Record<string, { count: number; reviewed: number; machine: number }> = {};

    for (const lang of nonDefaultLanguages) {
      scenarioTranslations[(lang as any).code] = { count: 0, reviewed: 0, machine: 0 };
      personaTranslations[(lang as any).code] = { count: 0, reviewed: 0, machine: 0 };
      categoryTranslations[(lang as any).code] = { count: 0, reviewed: 0, machine: 0 };
    }

    for (const scenario of scenarios) {
      const translations = await storage.getScenarioTranslations(String(scenario.id));
      for (const t of translations) {
        if (scenarioTranslations[(t as any).locale]) {
          scenarioTranslations[(t as any).locale].count++;
          if ((t as any).isReviewed) scenarioTranslations[(t as any).locale].reviewed++;
          if ((t as any).isMachineTranslated) scenarioTranslations[(t as any).locale].machine++;
        }
      }
    }

    for (const persona of personas) {
      const translations = await storage.getPersonaTranslations((persona as any).id);
      for (const t of translations) {
        if (personaTranslations[(t as any).locale]) {
          personaTranslations[(t as any).locale].count++;
          if ((t as any).isReviewed) personaTranslations[(t as any).locale].reviewed++;
          if ((t as any).isMachineTranslated) personaTranslations[(t as any).locale].machine++;
        }
      }
    }

    for (const category of categories) {
      const translations = await storage.getCategoryTranslations(String((category as any).id));
      for (const t of translations) {
        if (categoryTranslations[(t as any).locale]) {
          categoryTranslations[(t as any).locale].count++;
          if ((t as any).isReviewed) categoryTranslations[(t as any).locale].reviewed++;
          if ((t as any).isMachineTranslated) categoryTranslations[(t as any).locale].machine++;
        }
      }
    }

    res.json({
      scenarios: { total: scenarios.length, translated: scenarioTranslations },
      personas: { total: personas.length, translated: personaTranslations },
      categories: { total: categories.length, translated: categoryTranslations },
    });
  }));

  return router;
}
