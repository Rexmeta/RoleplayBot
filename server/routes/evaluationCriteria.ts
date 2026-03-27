import { Router } from "express";
import { storage } from "../storage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { GoogleGenAI } from "@google/genai";

export default function createEvaluationCriteriaRouter(isAuthenticated: any) {
  const router = Router();

  // 모든 평가 기준 세트 조회
  router.get("/api/admin/evaluation-criteria", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const lang = req.query.lang as string | undefined;
      const criteriaSets = await storage.getAllEvaluationCriteriaSets();
      
      // If language is specified and not Korean (source), apply translations
      if (lang && lang !== 'ko') {
        const translatedSets = await Promise.all(criteriaSets.map(async (set) => {
          const translation = await storage.getEvaluationCriteriaSetTranslation(set.id, lang);
          if (translation) {
            return {
              ...set,
              name: translation.name || set.name,
              description: translation.description || set.description,
            };
          }
          return set;
        }));
        return res.json(translatedSets);
      }
      
      res.json(criteriaSets);
    } catch (error: any) {
      console.error("Error getting evaluation criteria sets:", error);
      res.status(500).json({ error: error.message || "Failed to get evaluation criteria sets" });
    }
  });
  
  // 활성화된 평가 기준 세트만 조회
  router.get("/api/admin/evaluation-criteria/active", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const criteriaSets = await storage.getActiveEvaluationCriteriaSets();
      res.json(criteriaSets);
    } catch (error: any) {
      console.error("Error getting active evaluation criteria sets:", error);
      res.status(500).json({ error: error.message || "Failed to get active evaluation criteria sets" });
    }
  });
  
  // 특정 평가 기준 세트 조회 (차원 포함)
  router.get("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const lang = req.query.lang as string | undefined;
      const criteriaSetWithDimensions = await storage.getEvaluationCriteriaSetWithDimensions(id);
      
      if (!criteriaSetWithDimensions) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      // Apply translations if language is specified and not Korean
      if (lang && lang !== 'ko') {
        const setTranslation = await storage.getEvaluationCriteriaSetTranslation(id, lang);
        
        // Translate dimensions
        const translatedDimensions = await Promise.all(
          (criteriaSetWithDimensions.dimensions || []).map(async (dim: any) => {
            const dimTranslation = await storage.getEvaluationDimensionTranslation(dim.id, lang);
            if (dimTranslation) {
              return {
                ...dim,
                name: dimTranslation.name || dim.name,
                description: dimTranslation.description || dim.description,
                scoringRubric: dimTranslation.scoringRubric || dim.scoringRubric,
              };
            }
            return dim;
          })
        );
        
        return res.json({
          ...criteriaSetWithDimensions,
          name: setTranslation?.name || criteriaSetWithDimensions.name,
          description: setTranslation?.description || criteriaSetWithDimensions.description,
          dimensions: translatedDimensions,
        });
      }
      
      res.json(criteriaSetWithDimensions);
    } catch (error: any) {
      console.error("Error getting evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to get evaluation criteria set" });
    }
  });
  
  // 모든 평가 기준 세트 목록 조회 (시나리오 생성/수정 시 사용)
  router.get("/api/evaluation-criteria", isAuthenticated, async (req, res) => {
    try {
      const criteriaSets = await storage.getAllEvaluationCriteriaSets();
      const sanitized = criteriaSets.map((set: any) => ({
        ...set,
        dimensions: set.dimensions?.map(({ evaluationPrompt, ...dim }: any) => dim),
      }));
      res.json(sanitized);
    } catch (error: any) {
      console.error("Error getting evaluation criteria sets:", error);
      res.status(500).json({ error: error.message || "Failed to get evaluation criteria sets" });
    }
  });
  
  // 카테고리 또는 기본 평가 기준 세트 조회 (피드백 생성 시 사용)
  router.get("/api/evaluation-criteria/active", isAuthenticated, async (req, res) => {
    try {
      const { categoryId } = req.query;
      const criteriaSet = await storage.getActiveEvaluationCriteriaSetWithDimensions(categoryId as string | undefined);
      
      if (!criteriaSet) {
        return res.status(404).json({ error: "No active evaluation criteria set found" });
      }
      
      const sanitized = {
        ...criteriaSet,
        dimensions: (criteriaSet as any).dimensions?.map(({ evaluationPrompt, ...dim }: any) => dim),
      };
      res.json(sanitized);
    } catch (error: any) {
      console.error("Error getting active evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to get active evaluation criteria set" });
    }
  });
  
  // 평가 기준 세트 생성
  router.post("/api/admin/evaluation-criteria", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const user = req.user;
      const { name, description, isDefault, isActive, categoryId, dimensions, autoTranslate } = req.body;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Name is required" });
      }
      
      // 기본 기준으로 설정하려면 기존 기본 기준 해제
      if (isDefault) {
        const existingDefault = await storage.getDefaultEvaluationCriteriaSet();
        if (existingDefault) {
          await storage.updateEvaluationCriteriaSet(existingDefault.id, { isDefault: false });
        }
      }
      
      // 기준 세트 생성
      const criteriaSet = await storage.createEvaluationCriteriaSet({
        name: name.trim(),
        description: description || null,
        isDefault: isDefault || false,
        isActive: isActive !== false,
        categoryId: categoryId || null,
        createdBy: user?.id || null,
      });
      
      // 차원 생성 (있는 경우)
      const createdDimensions = [];
      if (dimensions && Array.isArray(dimensions)) {
        for (let i = 0; i < dimensions.length; i++) {
          const dim = dimensions[i];
          const dimension = await storage.createEvaluationDimension({
            criteriaSetId: criteriaSet.id,
            key: dim.key,
            name: dim.name,
            description: dim.description || null,
            weight: dim.weight || 1,
            minScore: dim.minScore || 0,
            maxScore: dim.maxScore || 100,
            icon: dim.icon || '📊',
            color: dim.color || 'blue',
            displayOrder: dim.displayOrder ?? i,
            scoringRubric: dim.scoringRubric || null,
            evaluationPrompt: dim.evaluationPrompt || null,
            isActive: dim.isActive !== false,
          });
          createdDimensions.push(dimension);
        }
      }
      
      // Auto-translate if requested
      if (autoTranslate) {
        const sourceLocale = 'ko';
        const createdDimensionsFinal = createdDimensions;
        
        const languages = await storage.getActiveSupportedLanguages();
        const targetLocales = languages.filter(l => l.code !== sourceLocale).map(l => l.code);
        
        const languageNames: Record<string, string> = {
          'ko': 'Korean (한국어)',
          'en': 'English',
          'ja': 'Japanese (日本語)',
          'zh': 'Chinese Simplified (简体中文)',
        };
        
        // Save original content first
        await storage.upsertEvaluationCriteriaSetTranslation({
          criteriaSetId: criteriaSet.id,
          locale: sourceLocale,
          sourceLocale: sourceLocale,
          isOriginal: true,
          name: criteriaSet.name,
          description: criteriaSet.description || null,
          isMachineTranslated: false,
          isReviewed: true,
        });
        
        for (const dim of createdDimensionsFinal) {
          await storage.upsertEvaluationDimensionTranslation({
            dimensionId: dim.id,
            locale: sourceLocale,
            sourceLocale: sourceLocale,
            isOriginal: true,
            name: dim.name,
            description: dim.description || null,
            scoringRubric: dim.scoringRubric || null,
            isMachineTranslated: false,
            isReviewed: true,
          });
        }
        
        // Translate to all other languages (async, non-blocking)
        const translateApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (translateApiKey) {
          const translateGenAI = new GoogleGenAI({ apiKey: translateApiKey });
          (async () => {
            for (const targetLocale of targetLocales) {
              try {
                const setPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation criteria set into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${criteriaSet.name}
Description: ${criteriaSet.description || ''}

Return JSON: {"name": "translated name", "description": "translated description"}`;

                const setResult = await translateGenAI.models.generateContent({
                  model: 'gemini-2.5-flash',
                  contents: setPrompt,
                });
                const setResponse = setResult.text || '';
                const setJsonMatch = setResponse.match(/\{[\s\S]*\}/);
                if (setJsonMatch) {
                  const setTranslation = JSON.parse(setJsonMatch[0]);
                  await storage.upsertEvaluationCriteriaSetTranslation({
                    criteriaSetId: criteriaSet.id,
                    locale: targetLocale,
                    sourceLocale: sourceLocale,
                    isOriginal: false,
                    name: setTranslation.name,
                    description: setTranslation.description,
                    isMachineTranslated: true,
                    isReviewed: false,
                  });
                }
                
                for (const dim of createdDimensionsFinal) {
                  const rubricText = dim.scoringRubric?.map((r: any) => 
                    `Score ${r.score} (${r.label}): ${r.description}`
                  ).join('\n') || '';
                  
                  const dimPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation dimension into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${dim.name}
Description: ${dim.description || ''}
Scoring Rubric:
${rubricText}

Return JSON: {
  "name": "translated name",
  "description": "translated description",
  "scoringRubric": [{"score": 1, "label": "label", "description": "description"}, ...]
}`;

                  const dimResult = await translateGenAI.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: dimPrompt,
                  });
                  const dimResponse = dimResult.text || '';
                  const dimJsonMatch = dimResponse.match(/\{[\s\S]*\}/);
                  if (dimJsonMatch) {
                    const dimTranslation = JSON.parse(dimJsonMatch[0]);
                    await storage.upsertEvaluationDimensionTranslation({
                      dimensionId: dim.id,
                      locale: targetLocale,
                      sourceLocale: sourceLocale,
                      isOriginal: false,
                      name: dimTranslation.name,
                      description: dimTranslation.description,
                      scoringRubric: dimTranslation.scoringRubric,
                      isMachineTranslated: true,
                      isReviewed: false,
                    });
                  }
                }
              } catch (e) {
                console.error(`Failed to auto-translate criteria set ${criteriaSet.id} to ${targetLocale}:`, e);
              }
            }
            console.log(`✅ Auto-translation completed for criteria set: ${criteriaSet.name}`);
          })();
        }
      }
      
      res.json({ ...criteriaSet, dimensions: createdDimensions });
    } catch (error: any) {
      console.error("Error creating evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to create evaluation criteria set" });
    }
  });
  
  // 평가 기준 세트 수정
  router.put("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, isDefault, isActive, categoryId } = req.body;
      
      const existing = await storage.getEvaluationCriteriaSet(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      // 기본 기준으로 변경하려면 기존 기본 기준 해제
      if (isDefault && !existing.isDefault) {
        const existingDefault = await storage.getDefaultEvaluationCriteriaSet();
        if (existingDefault && existingDefault.id !== id) {
          await storage.updateEvaluationCriteriaSet(existingDefault.id, { isDefault: false });
        }
      }
      
      const updated = await storage.updateEvaluationCriteriaSet(id, {
        name: name?.trim(),
        description: description !== undefined ? description : undefined,
        isDefault: isDefault !== undefined ? isDefault : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        categoryId: categoryId !== undefined ? categoryId : undefined,
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to update evaluation criteria set" });
    }
  });
  
  // 평가 기준 세트 삭제
  router.delete("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.getEvaluationCriteriaSet(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      await storage.deleteEvaluationCriteriaSet(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to delete evaluation criteria set" });
    }
  });
  
  // 기본 평가 기준 세트 설정
  router.post("/api/admin/evaluation-criteria/:id/set-default", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.getEvaluationCriteriaSet(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      await storage.setDefaultEvaluationCriteriaSet(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting default evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to set default evaluation criteria set" });
    }
  });
  
  // 차원 추가
  router.post("/api/admin/evaluation-criteria/:criteriaSetId/dimensions", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { criteriaSetId } = req.params;
      const { key, name, description, weight, minScore, maxScore, icon, color, displayOrder, scoringRubric, evaluationPrompt, isActive } = req.body;
      
      if (!key || !name) {
        return res.status(400).json({ error: "Key and name are required" });
      }
      
      // 기준 세트 존재 확인
      const criteriaSet = await storage.getEvaluationCriteriaSet(criteriaSetId);
      if (!criteriaSet) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      // 기존 차원 수 조회하여 displayOrder 기본값 설정
      const existingDimensions = await storage.getEvaluationDimensionsByCriteriaSet(criteriaSetId);
      
      const dimension = await storage.createEvaluationDimension({
        criteriaSetId,
        key,
        name,
        description: description || null,
        weight: weight || 1,
        minScore: minScore || 0,
        maxScore: maxScore || 100,
        icon: icon || null,
        color: color || null,
        displayOrder: displayOrder ?? existingDimensions.length,
        scoringRubric: scoringRubric || null,
        evaluationPrompt: evaluationPrompt || null,
        isActive: isActive !== false,
      });
      
      res.json(dimension);
    } catch (error: any) {
      console.error("Error creating evaluation dimension:", error);
      res.status(500).json({ error: error.message || "Failed to create evaluation dimension" });
    }
  });
  
  // 차원 수정
  router.put("/api/admin/evaluation-dimensions/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const existing = await storage.getEvaluationDimension(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation dimension not found" });
      }
      
      const updated = await storage.updateEvaluationDimension(id, updates);
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating evaluation dimension:", error);
      res.status(500).json({ error: error.message || "Failed to update evaluation dimension" });
    }
  });
  
  // 차원 삭제
  router.delete("/api/admin/evaluation-dimensions/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.getEvaluationDimension(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation dimension not found" });
      }
      
      await storage.deleteEvaluationDimension(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting evaluation dimension:", error);
      res.status(500).json({ error: error.message || "Failed to delete evaluation dimension" });
    }
  });

  // Auto-translate a single evaluation criteria set with all its dimensions
  router.post("/api/admin/evaluation-criteria/:id/auto-translate", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { sourceLocale = 'ko' } = req.body;
      
      const criteriaSet = await storage.getEvaluationCriteriaSetWithDimensions(id);
      if (!criteriaSet) {
        return res.status(404).json({ message: "평가 기준 세트를 찾을 수 없습니다" });
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
      
      // Save original content first
      await storage.upsertEvaluationCriteriaSetTranslation({
        criteriaSetId: id,
        locale: sourceLocale,
        sourceLocale: sourceLocale,
        isOriginal: true,
        name: criteriaSet.name,
        description: criteriaSet.description || null,
        isMachineTranslated: false,
        isReviewed: true,
      });
      
      // Save original dimensions
      for (const dim of criteriaSet.dimensions || []) {
        await storage.upsertEvaluationDimensionTranslation({
          dimensionId: dim.id,
          locale: sourceLocale,
          sourceLocale: sourceLocale,
          isOriginal: true,
          name: dim.name,
          description: dim.description || null,
          scoringRubric: dim.scoringRubric || null,
          isMachineTranslated: false,
          isReviewed: true,
        });
      }
      
      // Get API key for direct Gemini API calls
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "API 키가 설정되지 않았습니다" });
      }
      const genAI = new GoogleGenAI({ apiKey });
      
      // Translate to all other languages
      for (const targetLocale of targetLocales) {
        // Translate criteria set name and description
        const setPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation criteria set into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${criteriaSet.name}
Description: ${criteriaSet.description || ''}

Return JSON: {"name": "translated name", "description": "translated description"}`;

        try {
          const setResult = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: setPrompt,
          });
          const setResponse = setResult.text || '';
          const setJsonMatch = setResponse.match(/\{[\s\S]*\}/);
          if (setJsonMatch) {
            const setTranslation = JSON.parse(setJsonMatch[0]);
            await storage.upsertEvaluationCriteriaSetTranslation({
              criteriaSetId: id,
              locale: targetLocale,
              sourceLocale: sourceLocale,
              isOriginal: false,
              name: setTranslation.name,
              description: setTranslation.description,
              isMachineTranslated: true,
              isReviewed: false,
            });
            translatedCount++;
          }
        } catch (e) {
          console.error(`Failed to translate criteria set ${id} to ${targetLocale}:`, e);
        }
        
        // Translate each dimension
        for (const dim of criteriaSet.dimensions || []) {
          const rubricText = dim.scoringRubric?.map((r: any) => 
            `Score ${r.score} (${r.label}): ${r.description}`
          ).join('\n') || '';
          
          const dimPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation dimension into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${dim.name}
Description: ${dim.description || ''}
Scoring Rubric:
${rubricText}

Return JSON: {
  "name": "translated name",
  "description": "translated description",
  "scoringRubric": [{"score": 1, "label": "label", "description": "description"}, ...]
}`;

          try {
            const dimResult = await genAI.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: dimPrompt,
            });
            const dimResponse = dimResult.text || '';
            const dimJsonMatch = dimResponse.match(/\{[\s\S]*\}/);
            if (dimJsonMatch) {
              const dimTranslation = JSON.parse(dimJsonMatch[0]);
              await storage.upsertEvaluationDimensionTranslation({
                dimensionId: dim.id,
                locale: targetLocale,
                sourceLocale: sourceLocale,
                isOriginal: false,
                name: dimTranslation.name,
                description: dimTranslation.description,
                scoringRubric: dimTranslation.scoringRubric,
                isMachineTranslated: true,
                isReviewed: false,
              });
              translatedCount++;
            }
          } catch (e) {
            console.error(`Failed to translate dimension ${dim.id} to ${targetLocale}:`, e);
          }
        }
      }
      
      res.json({ 
        success: true, 
        message: `${translatedCount}개 항목이 번역되었습니다`,
        translatedCount,
        targetLocales 
      });
    } catch (error) {
      console.error("Error auto-translating evaluation criteria:", error);
      res.status(500).json({ message: "자동 번역 생성 실패" });
    }
  });

  // ================================
  // Difficulty Settings API (운영자/관리자)
  // ================================

  router.get("/api/admin/difficulty-settings", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const settings = await storage.getSystemSettingsByCategory('difficulty');
      const difficultySettings: Record<number, any> = {};
      for (const setting of settings) {
        if (setting.key.startsWith('level_')) {
          const level = parseInt(setting.key.replace('level_', ''));
          try {
            difficultySettings[level] = JSON.parse(setting.value);
          } catch (e) {
            console.warn(`Failed to parse difficulty setting for level ${level}:`, e);
          }
        }
      }
      res.json(difficultySettings);
    } catch (error: any) {
      console.error("Error getting difficulty settings:", error);
      res.status(500).json({ error: error.message || "Failed to get difficulty settings" });
    }
  });

  router.get("/api/admin/difficulty-settings/:level", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const level = parseInt(req.params.level);
      if (isNaN(level) || level < 1 || level > 4) {
        return res.status(400).json({ error: "Invalid level. Must be 1-4." });
      }
      const settings = await storage.getSystemSettingsByCategory('difficulty');
      const levelSetting = settings.find((s: any) => s.key === `level_${level}`);
      if (levelSetting) {
        try {
          res.json(JSON.parse(levelSetting.value));
        } catch (e) {
          res.status(500).json({ error: "Failed to parse difficulty setting" });
        }
      } else {
        const { getDifficultyGuidelines } = await import('../services/conversationDifficultyPolicy');
        res.json(getDifficultyGuidelines(level));
      }
    } catch (error: any) {
      console.error("Error getting difficulty setting:", error);
      res.status(500).json({ error: error.message || "Failed to get difficulty setting" });
    }
  });

  router.put("/api/admin/difficulty-settings/:level", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const level = parseInt(req.params.level);
      if (isNaN(level) || level < 1 || level > 4) {
        return res.status(400).json({ error: "Invalid level. Must be 1-4." });
      }
      const { name, description, responseLength, tone, pressure, feedback, constraints } = req.body;
      if (!name || !description || !responseLength || !tone || !pressure || !feedback) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const user = req.user as any;
      const settingValue = { level, name, description, responseLength, tone, pressure, feedback, constraints: constraints || [] };
      await storage.upsertSystemSetting({
        category: 'difficulty',
        key: `level_${level}`,
        value: JSON.stringify(settingValue),
        description: `Difficulty level ${level} settings`,
        updatedBy: user?.id,
      });
      const { invalidateDifficultyCache } = await import('../services/conversationDifficultyPolicy');
      invalidateDifficultyCache();
      res.json({ success: true, setting: settingValue });
    } catch (error: any) {
      console.error("Error saving difficulty setting:", error);
      res.status(500).json({ error: error.message || "Failed to save difficulty setting" });
    }
  });

  router.put("/api/admin/difficulty-settings", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { settings } = req.body;
      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ error: "Settings must be an object with level keys" });
      }
      const user = req.user as any;
      const savedSettings: Record<number, any> = {};
      for (const [levelKey, setting] of Object.entries(settings)) {
        const level = parseInt(levelKey);
        if (isNaN(level) || level < 1 || level > 4) continue;
        const { name, description, responseLength, tone, pressure, feedback, constraints } = setting as any;
        if (!name || !description || !responseLength || !tone || !pressure || !feedback) continue;
        const settingValue = { level, name, description, responseLength, tone, pressure, feedback, constraints: constraints || [] };
        await storage.upsertSystemSetting({
          category: 'difficulty',
          key: `level_${level}`,
          value: JSON.stringify(settingValue),
          description: `Difficulty level ${level} settings`,
          updatedBy: user?.id,
        });
        savedSettings[level] = settingValue;
      }
      const { invalidateDifficultyCache } = await import('../services/conversationDifficultyPolicy');
      invalidateDifficultyCache();
      res.json({ success: true, settings: savedSettings });
    } catch (error: any) {
      console.error("Error saving difficulty settings batch:", error);
      res.status(500).json({ error: error.message || "Failed to save difficulty settings" });
    }
  });

  router.post("/api/admin/difficulty-settings/reset", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const { getDefaultDifficultySettings, invalidateDifficultyCache } = await import('../services/conversationDifficultyPolicy');
      const defaultSettings = getDefaultDifficultySettings();
      for (const [level, setting] of Object.entries(defaultSettings)) {
        await storage.upsertSystemSetting({
          category: 'difficulty',
          key: `level_${level}`,
          value: JSON.stringify(setting),
          description: `Difficulty level ${level} settings (reset to default)`,
          updatedBy: user?.id,
        });
      }
      invalidateDifficultyCache();
      res.json({ success: true, settings: defaultSettings });
    } catch (error: any) {
      console.error("Error resetting difficulty settings:", error);
      res.status(500).json({ error: error.message || "Failed to reset difficulty settings" });
    }
  });

  return router;
}
