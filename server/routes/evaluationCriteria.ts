import { Router } from "express";
import { storage } from "../storage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { GoogleGenAI } from "@google/genai";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { validateEvaluationCriteriaSet, validateEvaluationDimension } from "../services/evaluationEngine";

async function createForkOfApprovedSet(existingId: string, userId: string | null): Promise<{ forkId: string; forkSet: any; dimKeyToForkId: Map<string, string> }> {
  const existing = await storage.getEvaluationCriteriaSet(existingId);
  if (!existing) throw createHttpError(404, "Evaluation criteria set not found");

  const rootId = existing.parentSetId || existingId;
  const allVersions = await storage.getEvaluationCriteriaSetVersionHistory(rootId);
  const maxVersion = allVersions.reduce((m: number, v: any) => Math.max(m, v.version ?? 1), 1);

  const forkSet = await storage.createEvaluationCriteriaSet({
    name: existing.name,
    description: existing.description,
    isDefault: false,
    isActive: existing.isActive,
    categoryId: existing.categoryId,
    createdBy: userId,
    status: 'draft',
    version: maxVersion + 1,
    parentSetId: rootId,
  });

  const existingDimensions = await storage.getEvaluationDimensionsByCriteriaSet(existingId);
  const dimKeyToForkId = new Map<string, string>();
  for (const dim of existingDimensions) {
    const newDim = await storage.createEvaluationDimension({
      criteriaSetId: forkSet.id,
      key: dim.key,
      name: dim.name,
      description: dim.description,
      weight: dim.weight,
      minScore: dim.minScore,
      maxScore: dim.maxScore,
      icon: dim.icon,
      color: dim.color,
      displayOrder: dim.displayOrder,
      scoringRubric: dim.scoringRubric,
      evaluationPrompt: dim.evaluationPrompt,
      isActive: dim.isActive,
      dimensionType: dim.dimensionType,
    });
    dimKeyToForkId.set(dim.key, newDim.id);
  }
  return { forkId: forkSet.id, forkSet, dimKeyToForkId };
}

export default function createEvaluationCriteriaRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/admin/evaluation-criteria", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const lang = req.query.lang as string | undefined;
    const criteriaSets = await storage.getAllEvaluationCriteriaSets();

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
  }));

  router.get("/api/admin/evaluation-criteria/active", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const criteriaSets = await storage.getActiveEvaluationCriteriaSets();
    res.json(criteriaSets);
  }));

  router.get("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const lang = req.query.lang as string | undefined;
    const criteriaSetWithDimensions = await storage.getEvaluationCriteriaSetWithDimensions(id);

    if (!criteriaSetWithDimensions) {
      throw createHttpError(404, "Evaluation criteria set not found");
    }

    if (lang && lang !== 'ko') {
      const setTranslation = await storage.getEvaluationCriteriaSetTranslation(id, lang);

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
  }));

  router.get("/api/evaluation-criteria", isAuthenticated, asyncHandler(async (req, res) => {
    const criteriaSets = await storage.getAllEvaluationCriteriaSets();
    const sanitized = criteriaSets.map((set: any) => ({
      ...set,
      dimensions: set.dimensions?.map(({ evaluationPrompt, ...dim }: any) => dim),
    }));
    res.json(sanitized);
  }));

  router.get("/api/evaluation-criteria/active", isAuthenticated, asyncHandler(async (req, res) => {
    const { categoryId } = req.query;
    const criteriaSet = await storage.getActiveEvaluationCriteriaSetWithDimensions(categoryId as string | undefined);

    if (!criteriaSet) {
      throw createHttpError(404, "No active evaluation criteria set found");
    }

    const sanitized = {
      ...criteriaSet,
      dimensions: (criteriaSet as any).dimensions?.map(({ evaluationPrompt, ...dim }: any) => dim),
    };
    res.json(sanitized);
  }));

  router.post("/api/admin/evaluation-criteria", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const { name, description, isDefault, isActive, categoryId, dimensions, autoTranslate } = req.body;

    if (!name || name.trim() === "") {
      throw createHttpError(400, "Name is required");
    }

    // Validate BEFORE persisting anything so we can fail fast without orphaning data or clearing the existing default
    const setValidation = validateEvaluationCriteriaSet(Array.isArray(dimensions) ? dimensions : []);
    if (!setValidation.valid) {
      throw createHttpError(400, `평가 기준 유효성 검사 실패:\n${setValidation.errors.join('\n')}`);
    }

    if (isDefault) {
      throw createHttpError(400, "새로 생성된 루브릭은 초안(draft) 상태이므로 기본값으로 설정할 수 없습니다. 루브릭을 승인한 후 기본값으로 지정하세요.");
    }

    const criteriaSet = await storage.createEvaluationCriteriaSet({
      name: name.trim(),
      description: description || null,
      isDefault: false,
      isActive: isActive !== false,
      categoryId: categoryId || null,
      createdBy: user?.id || null,
    });

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
          minScore: dim.minScore ?? 1,
          maxScore: dim.maxScore ?? 10,
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
  }));

  // POLICY: This endpoint updates set-level metadata only (name, description, isDefault,
  // isActive, categoryId). It intentionally does NOT run validateEvaluationCriteriaSet()
  // because changing metadata cannot alter dimension count, weight sum, or rubric state.
  // All dimension-level invariants are enforced at the dimension create/update/delete
  // endpoints, which re-validate the full post-change set before every persist.
  router.put("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, description, isDefault, isActive, categoryId } = req.body;

    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) {
      throw createHttpError(404, "Evaluation criteria set not found");
    }

    if (existing.status === 'archived' && (name !== undefined || description !== undefined)) {
      throw createHttpError(409, "보관된 루브릭은 수정할 수 없습니다.");
    }

    const mutableFieldChanged = (
      name !== undefined ||
      description !== undefined ||
      (categoryId !== undefined && categoryId !== existing.categoryId) ||
      (isActive !== undefined && isActive !== existing.isActive)
    );

    if (existing.status === 'approved' && mutableFieldChanged) {
      const { forkId, forkSet } = await createForkOfApprovedSet(id, (req as any).user?.id ?? null);
      const updatedFork = await storage.updateEvaluationCriteriaSet(forkId, {
        name: name?.trim(),
        description: description !== undefined ? description : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        categoryId: categoryId !== undefined ? categoryId : undefined,
      });
      return res.status(201).json({ autoForked: true, forkId, version: forkSet.version, ...updatedFork });
    }

    if (isDefault && !existing.isDefault) {
      if (existing.status && existing.status !== 'approved') {
        throw createHttpError(400, "승인된 루브릭만 기본값으로 설정할 수 있습니다.");
      }
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
  }));

  router.delete("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) {
      throw createHttpError(404, "Evaluation criteria set not found");
    }

    await storage.deleteEvaluationCriteriaSet(id);
    res.json({ success: true });
  }));

  router.post("/api/admin/evaluation-criteria/:id/set-default", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) {
      throw createHttpError(404, "Evaluation criteria set not found");
    }

    if (existing.status && existing.status !== 'approved') {
      throw createHttpError(400, "승인된 루브릭만 기본값으로 설정할 수 있습니다. 먼저 검토 요청 → 승인 절차를 진행하세요.");
    }

    await storage.setDefaultEvaluationCriteriaSet(id);
    res.json({ success: true });
  }));

  router.post("/api/admin/evaluation-criteria/:id/request-review", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    if (existing.status === 'approved') throw createHttpError(400, "이미 승인된 기준은 검토 요청할 수 없습니다");
    if (existing.status === 'archived') throw createHttpError(400, "보관된 기준은 검토 요청할 수 없습니다");
    const updated = await storage.updateEvaluationCriteriaSetStatus(id, 'review');
    res.json(updated);
  }));

  router.post("/api/admin/evaluation-criteria/:id/approve", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const user = req.user as any;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    if (existing.status !== 'review') throw createHttpError(400, "검토(review) 상태인 기준만 승인할 수 있습니다. 먼저 '검토 요청'을 진행하세요.");
    const updated = await storage.updateEvaluationCriteriaSetStatus(id, 'approved', user?.id);
    res.json(updated);
  }));

  router.post("/api/admin/evaluation-criteria/:id/reject", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    if (existing.status !== 'review') throw createHttpError(400, "검토 중인 기준만 반려할 수 있습니다");
    const updated = await storage.updateEvaluationCriteriaSetStatus(id, 'draft');
    res.json(updated);
  }));

  router.post("/api/admin/evaluation-criteria/:id/archive", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    if (existing.isDefault) throw createHttpError(400, "기본 기준으로 설정된 루브릭은 보관할 수 없습니다. 먼저 기본 설정을 해제하세요.");
    const updated = await storage.updateEvaluationCriteriaSetStatus(id, 'archived');
    res.json(updated);
  }));

  router.get("/api/admin/evaluation-criteria/:id/versions", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    const rootId = existing.parentSetId || id;
    const versions = await storage.getEvaluationCriteriaSetVersionHistory(rootId);
    res.json(versions);
  }));

  router.post("/api/admin/evaluation-criteria/:id/fork-version", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const user = req.user as any;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    if (existing.status !== 'approved') throw createHttpError(400, "승인된 기준만 새 버전으로 분기할 수 있습니다");

    const rootId = existing.parentSetId || id;
    const allVersions = await storage.getEvaluationCriteriaSetVersionHistory(rootId);
    const maxVersion = allVersions.reduce((m, v) => Math.max(m, v.version || 1), 1);

    const newSet = await storage.createEvaluationCriteriaSet({
      name: existing.name,
      description: existing.description,
      isDefault: false,
      isActive: existing.isActive,
      categoryId: existing.categoryId,
      createdBy: user?.id || null,
      status: 'draft',
      version: maxVersion + 1,
      parentSetId: rootId,
    });

    const existingDimensions = await storage.getEvaluationDimensionsByCriteriaSet(id);
    const newDimensions = [];
    for (const dim of existingDimensions) {
      const newDim = await storage.createEvaluationDimension({
        criteriaSetId: newSet.id,
        key: dim.key,
        name: dim.name,
        description: dim.description,
        weight: dim.weight,
        minScore: dim.minScore,
        maxScore: dim.maxScore,
        icon: dim.icon,
        color: dim.color,
        displayOrder: dim.displayOrder,
        scoringRubric: dim.scoringRubric,
        evaluationPrompt: dim.evaluationPrompt,
        isActive: dim.isActive,
        dimensionType: dim.dimensionType,
      });
      newDimensions.push(newDim);
    }

    res.json({ ...newSet, dimensions: newDimensions });
  }));

  router.post("/api/admin/evaluation-criteria/:criteriaSetId/dimensions", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { criteriaSetId } = req.params;
    const { key, name, description, weight, minScore, maxScore, icon, color, displayOrder, scoringRubric, evaluationPrompt, isActive } = req.body;

    if (!key || !name) {
      throw createHttpError(400, "Key and name are required");
    }

    const criteriaSet = await storage.getEvaluationCriteriaSet(criteriaSetId);
    if (!criteriaSet) {
      throw createHttpError(404, "Evaluation criteria set not found");
    }

    if (criteriaSet.status === 'archived') {
      throw createHttpError(409, "보관된 루브릭에는 차원을 추가할 수 없습니다.");
    }

    const resolvedMinScore = minScore ?? 1;
    const resolvedMaxScore = maxScore ?? 10;
    const dimValidation = validateEvaluationDimension({
      key, name,
      minScore: resolvedMinScore,
      maxScore: resolvedMaxScore,
      scoringRubric: scoringRubric || null,
      evaluationPrompt: evaluationPrompt || null,
    });
    if (!dimValidation.valid) {
      throw createHttpError(400, `평가 차원 유효성 검사 실패:\n${dimValidation.errors.join('\n')}`);
    }

    const existingDimensions = await storage.getEvaluationDimensionsByCriteriaSet(criteriaSetId);

    const duplicateKey = existingDimensions.find((d: any) => d.key === key);
    if (duplicateKey) {
      throw createHttpError(400, `평가 차원 키 "${key}"가 이미 존재합니다. 다른 키를 사용하세요.`);
    }

    // Validate the full post-change set (count ≥ 3, weight sum ≈ 100, rubric ≥ 5 per active dimension)
    const postAddDims = [
      ...existingDimensions,
      {
        key,
        name,
        weight: weight ?? 1,
        minScore: resolvedMinScore,
        maxScore: resolvedMaxScore,
        isActive: isActive !== false,
        scoringRubric: scoringRubric || null,
        evaluationPrompt: evaluationPrompt || null,
      },
    ];
    const postAddSetValidation = validateEvaluationCriteriaSet(postAddDims);
    if (!postAddSetValidation.valid) {
      throw createHttpError(400, `세트 전체 유효성 검사 실패:\n${postAddSetValidation.errors.join('\n')}`);
    }

    if (criteriaSet.status === 'approved') {
      const { forkId, dimKeyToForkId } = await createForkOfApprovedSet(criteriaSetId, (req as any).user?.id ?? null);
      const forkDimensions = await storage.getEvaluationDimensionsByCriteriaSet(forkId);
      const newDim = await storage.createEvaluationDimension({
        criteriaSetId: forkId,
        key,
        name,
        description: description || null,
        weight: weight || 1,
        minScore: resolvedMinScore,
        maxScore: resolvedMaxScore,
        icon: icon || null,
        color: color || null,
        displayOrder: displayOrder ?? forkDimensions.length,
        scoringRubric: scoringRubric || null,
        evaluationPrompt: evaluationPrompt || null,
        isActive: isActive !== false,
      });
      return res.status(201).json({ autoForked: true, forkId, dimension: newDim });
    }

    const dimension = await storage.createEvaluationDimension({
      criteriaSetId,
      key,
      name,
      description: description || null,
      weight: weight || 1,
      minScore: resolvedMinScore,
      maxScore: resolvedMaxScore,
      icon: icon || null,
      color: color || null,
      displayOrder: displayOrder ?? existingDimensions.length,
      scoringRubric: scoringRubric || null,
      evaluationPrompt: evaluationPrompt || null,
      isActive: isActive !== false,
    });

    res.json(dimension);
  }));

  router.put("/api/admin/evaluation-dimensions/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const existing = await storage.getEvaluationDimension(id);
    if (!existing) {
      throw createHttpError(404, "Evaluation dimension not found");
    }

    const parentSet = await storage.getEvaluationCriteriaSet(existing.criteriaSetId);
    if (parentSet?.status === 'archived') {
      throw createHttpError(409, "보관된 루브릭의 차원은 수정할 수 없습니다.");
    }

    const resolvedKey = updates.key ?? existing.key;
    const dimValidation = validateEvaluationDimension({
      key: resolvedKey,
      name: updates.name ?? existing.name,
      minScore: updates.minScore ?? existing.minScore,
      maxScore: updates.maxScore ?? existing.maxScore,
      scoringRubric: updates.scoringRubric !== undefined ? updates.scoringRubric : existing.scoringRubric,
      evaluationPrompt: updates.evaluationPrompt !== undefined ? updates.evaluationPrompt : existing.evaluationPrompt,
    });
    if (!dimValidation.valid) {
      throw createHttpError(400, `평가 차원 유효성 검사 실패:\n${dimValidation.errors.join('\n')}`);
    }

    const siblings = await storage.getEvaluationDimensionsByCriteriaSet(existing.criteriaSetId);

    if (updates.key && updates.key !== existing.key) {
      const duplicateKey = siblings.find((d: any) => d.key === updates.key && d.id !== id);
      if (duplicateKey) {
        throw createHttpError(400, `평가 차원 키 "${updates.key}"가 이미 존재합니다. 다른 키를 사용하세요.`);
      }
    }

    // Validate the full post-change set (count ≥ 3, weight sum ≈ 100, rubric ≥ 5 per active dimension)
    const postUpdateDims = siblings.map((d: any) =>
      d.id === id
        ? {
            key: updates.key ?? d.key,
            name: updates.name ?? d.name,
            weight: updates.weight ?? d.weight,
            minScore: updates.minScore ?? d.minScore,
            maxScore: updates.maxScore ?? d.maxScore,
            isActive: updates.isActive !== undefined ? updates.isActive : d.isActive,
            scoringRubric: updates.scoringRubric !== undefined ? updates.scoringRubric : d.scoringRubric,
            evaluationPrompt: updates.evaluationPrompt !== undefined ? updates.evaluationPrompt : d.evaluationPrompt,
          }
        : d
    );
    const postUpdateSetValidation = validateEvaluationCriteriaSet(postUpdateDims);
    if (!postUpdateSetValidation.valid) {
      throw createHttpError(400, `세트 전체 유효성 검사 실패:\n${postUpdateSetValidation.errors.join('\n')}`);
    }

    if (parentSet?.status === 'approved') {
      const { forkId, dimKeyToForkId } = await createForkOfApprovedSet(existing.criteriaSetId, (req as any).user?.id ?? null);
      const forkDimId = dimKeyToForkId.get(existing.key);
      if (!forkDimId) throw createHttpError(500, "Auto-fork failed: dimension key not found in fork");
      const updated = await storage.updateEvaluationDimension(forkDimId, updates);
      return res.status(201).json({ autoForked: true, forkId, dimension: updated });
    }

    const updated = await storage.updateEvaluationDimension(id, updates);
    res.json(updated);
  }));

  router.delete("/api/admin/evaluation-dimensions/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const existing = await storage.getEvaluationDimension(id);
    if (!existing) {
      throw createHttpError(404, "Evaluation dimension not found");
    }

    const parentSetForDelete = await storage.getEvaluationCriteriaSet(existing.criteriaSetId);
    if (parentSetForDelete?.status === 'archived') {
      throw createHttpError(409, "보관된 루브릭의 차원은 삭제할 수 없습니다.");
    }

    // Validate the full post-delete set (count ≥ 3, weight sum ≈ 100)
    const siblings = await storage.getEvaluationDimensionsByCriteriaSet(existing.criteriaSetId);
    const postDeleteDims = siblings.filter((d: any) => d.id !== id);
    const postDeleteSetValidation = validateEvaluationCriteriaSet(postDeleteDims);
    if (!postDeleteSetValidation.valid) {
      throw createHttpError(400, `삭제 후 세트 유효성 검사 실패:\n${postDeleteSetValidation.errors.join('\n')}`);
    }

    if (parentSetForDelete?.status === 'approved') {
      const { forkId, dimKeyToForkId } = await createForkOfApprovedSet(existing.criteriaSetId, (req as any).user?.id ?? null);
      const forkDimId = dimKeyToForkId.get(existing.key);
      if (!forkDimId) throw createHttpError(500, "Auto-fork failed: dimension key not found in fork");
      await storage.deleteEvaluationDimension(forkDimId);
      return res.status(201).json({ autoForked: true, forkId, success: true });
    }

    await storage.deleteEvaluationDimension(id);
    res.json({ success: true });
  }));

  router.post("/api/admin/evaluation-criteria/:id/auto-translate", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const { sourceLocale = 'ko' } = req.body;

    const criteriaSet = await storage.getEvaluationCriteriaSetWithDimensions(id);
    if (!criteriaSet) {
      throw createHttpError(404, "평가 기준 세트를 찾을 수 없습니다");
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

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw createHttpError(500, "API 키가 설정되지 않았습니다");
    }
    const genAI = new GoogleGenAI({ apiKey });

    for (const targetLocale of targetLocales) {
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
  }));

  router.get("/api/admin/difficulty-settings", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
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
  }));

  router.get("/api/admin/difficulty-settings/:level", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const level = parseInt(req.params.level);
    if (isNaN(level) || level < 1 || level > 4) {
      throw createHttpError(400, "Invalid level. Must be 1-4.");
    }
    const settings = await storage.getSystemSettingsByCategory('difficulty');
    const levelSetting = settings.find((s: any) => s.key === `level_${level}`);
    if (levelSetting) {
      try {
        res.json(JSON.parse(levelSetting.value));
      } catch (e) {
        throw createHttpError(500, "Failed to parse difficulty setting");
      }
    } else {
      const { getDifficultyGuidelines } = await import('../services/conversationDifficultyPolicy');
      res.json(getDifficultyGuidelines(level));
    }
  }));

  router.put("/api/admin/difficulty-settings/:level", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const level = parseInt(req.params.level);
    if (isNaN(level) || level < 1 || level > 4) {
      throw createHttpError(400, "Invalid level. Must be 1-4.");
    }
    const { name, description, responseLength, tone, pressure, feedback, constraints } = req.body;
    if (!name || !description || !responseLength || !tone || !pressure || !feedback) {
      throw createHttpError(400, "Missing required fields");
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
  }));

  router.put("/api/admin/difficulty-settings", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      throw createHttpError(400, "Settings must be an object with level keys");
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
  }));

  router.post("/api/admin/difficulty-settings/reset", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
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
  }));

  return router;
}
