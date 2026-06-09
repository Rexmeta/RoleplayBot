import { Router } from "express";
import { storage } from "../storage";
import { isOperatorOrAdmin, isSystemAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { validateEvaluationCriteriaSet, validateEvaluationDimension, calculateRubricQualityScore } from "../services/evaluationEngine";
import { RUBRIC_TEMPLATES } from "../data/rubricTemplates";
import { generateFeedback, getAIServiceForFeature } from "../services/aiServiceFactory";

function classifyTranslationError(error: unknown): { isFatal: boolean; userMessage: string } {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('insufficient_quota') ||
    msg.includes('credit')
  ) {
    return { isFatal: true, userMessage: 'AI API 할당량이 소진되었습니다. 잠시 후 다시 시도하거나 API 크레딧을 충전하세요.' };
  }
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthenticated') ||
    msg.includes('invalid api key') ||
    msg.includes('api_key') ||
    msg.includes('authentication') ||
    msg.includes('permission denied')
  ) {
    return { isFatal: true, userMessage: 'AI API 인증에 실패했습니다. 시스템 어드민에서 API 키 설정을 확인하세요.' };
  }
  return { isFatal: false, userMessage: (error instanceof Error ? error.message : String(error)) };
}

async function createForkOfApprovedSet(
  existingId: string,
  userId: string | null,
  ownerOperatorId?: string | null,
): Promise<{ forkId: string; forkSet: any; dimKeyToForkId: Map<string, string> }> {
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
    ownerOperatorId: ownerOperatorId !== undefined ? ownerOperatorId : null,
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

/**
 * Returns true if an operator user has access to a rubric set based on current scope:
 * 1. The rubric's categoryId matches their assignedCategoryId (category-scoped operators)
 * 2. The rubric's category belongs to their assignedOrganizationId (org-scoped operators)
 *
 * Ownership (ownerOperatorId / createdBy) is NOT a standalone grant — scope is authoritative.
 * This prevents operators from retaining access to rubrics after scope reassignment.
 */
async function operatorCanAccessSet(set: any, user: any): Promise<boolean> {
  if (!user || user.role !== 'operator' || !set) return false;
  if (user.assignedCategoryId) {
    // Category-scoped operator: rubric must belong to their exact assigned category
    return set.categoryId === user.assignedCategoryId;
  }
  if (user.assignedOrganizationId) {
    // Org-scoped operator: rubric's category must belong to their org
    if (!set.categoryId) return false; // global rubrics are not accessible to org-scoped operators
    try {
      const category = await storage.getCategory(set.categoryId);
      return !!(category && category.organizationId === user.assignedOrganizationId);
    } catch { return false; }
  }
  return false;
}

/**
 * Throws 403 if the authenticated user is an operator who does not own the rubric set.
 * Admins always pass. Pass `set` as the fetched EvaluationCriteriaSet object.
 */
async function assertOperatorRubricAccess(set: any, user: any): Promise<void> {
  if (!user || user.role !== 'operator') return; // admin (or other roles) — allow
  if (!set) throw createHttpError(404, "Evaluation criteria set not found");
  const allowed = await operatorCanAccessSet(set, user);
  if (!allowed) {
    throw createHttpError(403, "이 루브릭에 접근할 권한이 없습니다.");
  }
}

export default function createEvaluationCriteriaRouter(isAuthenticated: any) {
  const router = Router();

  // ── 루브릭 템플릿 목록 조회 ──
  router.get("/api/admin/evaluation-criteria/templates", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (_req, res) => {
    const templates = RUBRIC_TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      scenarioType: t.scenarioType,
      dimensionCount: t.dimensions.length,
      dimensions: t.dimensions.map(d => ({
        key: d.key,
        name: d.name,
        description: d.description,
        weight: d.weight,
        dimensionType: d.dimensionType,
      })),
    }));
    res.json(templates);
  }));

  // ── 템플릿으로 루브릭 생성 ──
  router.post("/api/admin/evaluation-criteria/from-template", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { templateId, name, description, categoryId } = req.body;
    const user = req.user as any;

    if (!templateId) throw createHttpError(400, "templateId is required");

    const template = RUBRIC_TEMPLATES.find(t => t.id === templateId);
    if (!template) throw createHttpError(404, `Template "${templateId}" not found`);

    // Operators scope check
    if (user?.role === 'operator') {
      const requestedCategoryId = categoryId || null;
      if (user.assignedCategoryId) {
        if (!requestedCategoryId || requestedCategoryId !== user.assignedCategoryId) {
          throw createHttpError(403, "운영자는 담당 카테고리에 속한 루브릭만 생성할 수 있습니다.");
        }
      } else if (user.assignedOrganizationId) {
        if (!requestedCategoryId) throw createHttpError(403, "운영자는 카테고리를 반드시 지정해야 합니다.");
        const cat = await storage.getCategory(requestedCategoryId);
        if (!cat) throw createHttpError(400, "지정한 카테고리를 찾을 수 없습니다.");
        if (cat.organizationId !== user.assignedOrganizationId) {
          throw createHttpError(403, "운영자는 담당 조직에 속한 카테고리에만 루브릭을 생성할 수 있습니다.");
        }
      }
    }

    const setName = name?.trim() || `${template.name} (복사본)`;
    const criteriaSet = await storage.createEvaluationCriteriaSet({
      name: setName,
      description: description || template.description,
      isDefault: false,
      isActive: true,
      categoryId: categoryId || null,
      createdBy: user?.id || null,
      ownerOperatorId: user?.role === 'operator' ? (user?.id || null) : null,
      status: 'draft',
    });

    const createdDimensions = [];
    for (let i = 0; i < template.dimensions.length; i++) {
      const dim = template.dimensions[i];
      const dimension = await storage.createEvaluationDimension({
        criteriaSetId: criteriaSet.id,
        key: dim.key,
        name: dim.name,
        description: dim.description,
        weight: dim.weight,
        minScore: dim.minScore,
        maxScore: dim.maxScore,
        icon: dim.icon,
        color: dim.color,
        displayOrder: i,
        scoringRubric: dim.scoringRubric,
        evaluationPrompt: dim.evaluationPrompt,
        isActive: true,
        dimensionType: dim.dimensionType,
      });
      createdDimensions.push(dimension);
    }

    res.status(201).json({ ...criteriaSet, dimensions: createdDimensions, fromTemplate: templateId });
  }));

  router.get("/api/admin/evaluation-criteria", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const lang = req.query.lang as string | undefined;
    const user = req.user as any;
    let criteriaSets = await storage.getAllEvaluationCriteriaSets();

    // Operators only see rubrics within their scope (category, org, or company)
    if (user?.role === 'operator') {
      const filtered: typeof criteriaSets = [];
      for (const set of criteriaSets) {
        if (await operatorCanAccessSet(set, user)) filtered.push(set);
      }
      criteriaSets = filtered;
    }

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

  router.get("/api/admin/evaluation-criteria/active", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const user = req.user as any;
    let criteriaSets = await storage.getActiveEvaluationCriteriaSets();

    // Operators only see active rubrics within their scope
    if (user?.role === 'operator') {
      const filtered: typeof criteriaSets = [];
      for (const set of criteriaSets) {
        if (await operatorCanAccessSet(set, user)) filtered.push(set);
      }
      criteriaSets = filtered;
    }

    res.json(criteriaSets);
  }));

  router.get("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const lang = req.query.lang as string | undefined;
    const criteriaSetWithDimensions = await storage.getEvaluationCriteriaSetWithDimensions(id);

    if (!criteriaSetWithDimensions) {
      throw createHttpError(404, "Evaluation criteria set not found");
    }
    await assertOperatorRubricAccess(criteriaSetWithDimensions, req.user);

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

  router.get("/api/evaluation-criteria", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user as any;
    let criteriaSets = await storage.getAllEvaluationCriteriaSets();

    // Operators only see rubrics within their assigned scope
    if (user?.role === 'operator') {
      const filtered: typeof criteriaSets = [];
      for (const set of criteriaSets) {
        if (await operatorCanAccessSet(set, user)) filtered.push(set);
      }
      criteriaSets = filtered;
    }

    const sanitized = criteriaSets.map((set: any) => ({
      ...set,
      dimensions: set.dimensions?.map(({ evaluationPrompt, ...dim }: any) => dim),
    }));
    res.json(sanitized);
  }));

  router.get("/api/evaluation-criteria/active", isAuthenticated, asyncHandler(async (req: any, res) => {
    const { categoryId } = req.query;
    const user = req.user as any;

    // Operators requesting the active rubric for a category outside their scope get 403
    if (user?.role === 'operator' && categoryId) {
      const requestedCatId = categoryId as string;
      const allowed =
        (user.assignedCategoryId && requestedCatId === user.assignedCategoryId) ||
        (!user.assignedCategoryId && user.assignedOrganizationId &&
          await (async () => {
            try {
              const cat = await storage.getCategory(requestedCatId);
              return cat && cat.organizationId === user.assignedOrganizationId;
            } catch { return false; }
          })());
      if (!allowed) throw createHttpError(403, "이 카테고리의 루브릭에 접근할 권한이 없습니다.");
    }

    const criteriaSet = await storage.getActiveEvaluationCriteriaSetWithDimensions(categoryId as string | undefined);

    if (!criteriaSet) {
      throw createHttpError(404, "No active evaluation criteria set found");
    }

    // Operators verify the returned set is within their scope
    if (user?.role === 'operator') {
      const allowed = await operatorCanAccessSet(criteriaSet, user);
      if (!allowed) throw createHttpError(403, "이 루브릭에 접근할 권한이 없습니다.");
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

    // Operators can only create rubrics within their assigned scope
    if (user?.role === 'operator') {
      const requestedCategoryId = categoryId || null;
      if (user.assignedCategoryId) {
        // Category-scoped operator: must specify their exact assigned category (null not allowed)
        if (!requestedCategoryId || requestedCategoryId !== user.assignedCategoryId) {
          throw createHttpError(403, "운영자는 담당 카테고리에 속한 루브릭만 생성할 수 있습니다.");
        }
      } else if (user.assignedOrganizationId) {
        // Org-scoped operator: must specify a category that belongs to their org (null not allowed)
        if (!requestedCategoryId) {
          throw createHttpError(403, "운영자는 카테고리를 반드시 지정해야 합니다.");
        }
        const cat = await storage.getCategory(requestedCategoryId);
        if (!cat) throw createHttpError(400, "지정한 카테고리를 찾을 수 없습니다.");
        if (cat.organizationId !== user.assignedOrganizationId) {
          throw createHttpError(403, "운영자는 담당 조직에 속한 카테고리에만 루브릭을 생성할 수 있습니다.");
        }
      }
    }

    const criteriaSet = await storage.createEvaluationCriteriaSet({
      name: name.trim(),
      description: description || null,
      isDefault: false,
      isActive: isActive !== false,
      categoryId: categoryId || null,
      createdBy: user?.id || null,
      ownerOperatorId: user?.role === 'operator' ? (user?.id || null) : null,
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

      (async () => {
        try {
          const aiService = await getAIServiceForFeature('translation');
          for (const targetLocale of targetLocales) {
            try {
              const setPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation criteria set into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${criteriaSet.name}
Description: ${criteriaSet.description || ''}

Return JSON: {"name": "translated name", "description": "translated description"}`;

              const setResponse = await aiService.generateText(setPrompt);
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

                const dimResponse = await aiService.generateText(dimPrompt);
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
              if (classifyTranslationError(e).isFatal) break;
            }
          }
          console.log(`✅ Auto-translation completed for criteria set: ${criteriaSet.name}`);
        } catch (e) {
          console.error(`Failed to get AI service for translation:`, e);
        }
      })();
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
    const reqUser = (req as any).user;
    await assertOperatorRubricAccess(existing, reqUser);

    // Operators cannot reassign a rubric to a category/org outside their scope (null not allowed)
    if (reqUser?.role === 'operator' && categoryId !== undefined && categoryId !== existing.categoryId) {
      const newCatId = categoryId || null;
      if (reqUser.assignedCategoryId) {
        // Must stay in their assigned category; null-category is not permitted
        if (!newCatId || newCatId !== reqUser.assignedCategoryId) {
          throw createHttpError(403, "운영자는 담당 카테고리 외 카테고리로 루브릭을 이전할 수 없습니다.");
        }
      } else if (reqUser.assignedOrganizationId) {
        // Must stay in a category belonging to their org; null-category is not permitted
        if (!newCatId) {
          throw createHttpError(403, "운영자는 카테고리를 반드시 지정해야 합니다.");
        }
        const cat = await storage.getCategory(newCatId);
        if (!cat) throw createHttpError(400, "지정한 카테고리를 찾을 수 없습니다.");
        if (cat.organizationId !== reqUser.assignedOrganizationId) {
          throw createHttpError(403, "운영자는 담당 조직에 속한 카테고리로만 루브릭을 이전할 수 있습니다.");
        }
      }
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
      const operatorId = reqUser?.role === 'operator' ? (reqUser?.id ?? null) : null;
      const { forkId, forkSet } = await createForkOfApprovedSet(id, reqUser?.id ?? null, operatorId);
      const updatedFork = await storage.updateEvaluationCriteriaSet(forkId, {
        name: name?.trim(),
        description: description !== undefined ? description : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        categoryId: categoryId !== undefined ? categoryId : undefined,
      });
      return res.status(201).json({ autoForked: true, forkId, ...updatedFork, version: forkSet.version });
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
    await assertOperatorRubricAccess(existing, (req as any).user);

    await storage.deleteEvaluationCriteriaSet(id);
    res.json({ success: true });
  }));

  /**
   * Transfer (reassign) the ownerOperatorId of a rubric set.
   * - Admins can transfer any rubric to any operator (or clear ownership by passing null).
   * - Operators can transfer only rubrics they currently own to another operator in their scope.
   */
  router.patch("/api/admin/evaluation-criteria/:id/transfer-owner", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { ownerOperatorId } = req.body;
    const reqUser = (req as any).user;

    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");

    if (reqUser.role === 'operator') {
      // Enforce scope access first (consistent with the rest of the file's scope-authoritative model)
      await assertOperatorRubricAccess(existing, reqUser);
      // Additionally, operators may only transfer rubrics they currently own
      if (existing.ownerOperatorId !== reqUser.id) {
        throw createHttpError(403, "자신이 소유한 루브릭만 이관할 수 있습니다.");
      }
      // Target must still be within the operator's scope
      if (ownerOperatorId) {
        const targetUser = await storage.getUser(ownerOperatorId);
        if (!targetUser || targetUser.role !== 'operator') {
          throw createHttpError(400, "지정한 사용자는 운영자가 아닙니다.");
        }
        // Verify the target operator shares scope with the rubric
        const targetAllowed = await operatorCanAccessSet(existing, targetUser);
        if (!targetAllowed) {
          throw createHttpError(403, "대상 운영자는 이 루브릭의 범위(카테고리/조직)에 속하지 않습니다.");
        }
      }
    } else {
      // Admin path: validate target if provided
      if (ownerOperatorId) {
        const targetUser = await storage.getUser(ownerOperatorId);
        if (!targetUser || targetUser.role !== 'operator') {
          throw createHttpError(400, "지정한 사용자는 운영자가 아닙니다.");
        }
      }
    }

    const updated = await storage.updateEvaluationCriteriaSet(id, {
      ownerOperatorId: ownerOperatorId || null,
    });
    res.json(updated);
  }));

  /**
   * List all active operators — used by admin to populate the ownership-transfer dropdown.
   */
  router.get("/api/admin/operators", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const allUsers = await storage.getAllUsers();
    const operators = allUsers
      .filter((u: any) => u.role === 'operator' && u.isActive !== false)
      .map((u: any) => ({ id: u.id, name: u.name, email: u.email }));
    res.json(operators);
  }));

  router.post("/api/admin/evaluation-criteria/:id/set-default", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) {
      throw createHttpError(404, "Evaluation criteria set not found");
    }
    await assertOperatorRubricAccess(existing, (req as any).user);

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
    await assertOperatorRubricAccess(existing, req.user);
    if (existing.status === 'approved') throw createHttpError(400, "이미 승인된 기준은 검토 요청할 수 없습니다");
    if (existing.status === 'archived') throw createHttpError(400, "보관된 기준은 검토 요청할 수 없습니다");
    const updated = await storage.updateEvaluationCriteriaSetStatus(id, 'review');
    res.json(updated);
  }));

  router.post("/api/admin/evaluation-criteria/:id/approve", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const user = req.user as any;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    if (existing.status !== 'review') throw createHttpError(400, "검토(review) 상태인 기준만 승인할 수 있습니다. 먼저 '검토 요청'을 진행하세요.");

    // Quality gate: block approval if quality score < 80
    const dimensions = await storage.getEvaluationDimensionsByCriteriaSet(id);
    const qualityResult = calculateRubricQualityScore(dimensions);
    if (qualityResult.totalScore < 80) {
      throw createHttpError(400, `루브릭 품질 점수(${qualityResult.totalScore}점)가 승인 기준(80점)에 미달합니다. 권고 사항: ${qualityResult.recommendations.slice(0, 3).join(' / ')}`);
    }

    const updated = await storage.updateEvaluationCriteriaSetStatus(id, 'approved', user?.id);
    res.json(updated);
  }));

  router.post("/api/admin/evaluation-criteria/:id/reject", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
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
    await assertOperatorRubricAccess(existing, req.user);
    if (existing.isDefault) throw createHttpError(400, "기본 기준으로 설정된 루브릭은 보관할 수 없습니다. 먼저 기본 설정을 해제하세요.");
    const updated = await storage.updateEvaluationCriteriaSetStatus(id, 'archived');
    res.json(updated);
  }));

  // ── 루브릭 품질 점수 조회 ──
  router.get("/api/admin/evaluation-criteria/:id/quality-score", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    await assertOperatorRubricAccess(existing, req.user);
    const dimensions = await storage.getEvaluationDimensionsByCriteriaSet(id);
    const result = calculateRubricQualityScore(dimensions);
    res.json(result);
  }));

  // ── 드라이런(테스트) 평가 ──
  router.post("/api/admin/evaluation-criteria/:id/dry-run", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const { messages, scenarioContext, personaContext, language = 'ko' } = req.body;

    const existing = await storage.getEvaluationCriteriaSetWithDimensions(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    await assertOperatorRubricAccess(existing, req.user);

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw createHttpError(400, "messages 배열이 필요합니다");
    }

    const scenario = scenarioContext || {
      title: '드라이런 테스트',
      context: { situation: '테스트 대화' },
      objectives: ['소통 능력 평가'],
    };

    const persona = personaContext || {
      id: 'dry-run-persona',
      name: '테스트 페르소나',
      role: '동료',
    };

    try {
      const feedback = await generateFeedback(
        scenario,
        messages,
        persona,
        undefined,
        existing,
        language as any,
      );
      res.json({ feedback, criteriaSetId: id, isDryRun: true });
    } catch (err: any) {
      throw createHttpError(500, `드라이런 평가 실패: ${err.message}`);
    }
  }));

  router.get("/api/admin/evaluation-criteria/:id/versions", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    await assertOperatorRubricAccess(existing, (req as any).user);
    const rootId = existing.parentSetId || id;
    const versions = await storage.getEvaluationCriteriaSetVersionHistory(rootId);
    res.json(versions);
  }));

  router.post("/api/admin/evaluation-criteria/:id/fork-version", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const user = req.user as any;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "Evaluation criteria set not found");
    await assertOperatorRubricAccess(existing, user);
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
      ownerOperatorId: user?.role === 'operator' ? (user?.id || null) : null,
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
    await assertOperatorRubricAccess(criteriaSet, (req as any).user);

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
      const _reqUser = (req as any).user;
      const _opId = _reqUser?.role === 'operator' ? (_reqUser?.id ?? null) : null;
      const { forkId, dimKeyToForkId } = await createForkOfApprovedSet(criteriaSetId, _reqUser?.id ?? null, _opId);
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
    await assertOperatorRubricAccess(parentSet, (req as any).user);
    if (parentSet?.status === 'archived') {
      throw createHttpError(409, "보관된 루브릭의 차원은 수정할 수 없습니다.");
    }
    if (parentSet?.status === 'approved') {
      throw createHttpError(409, "승인된 루브릭의 차원은 수정할 수 없습니다. 먼저 '새 버전 만들기'를 통해 초안 버전을 생성한 후 수정하세요.");
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
    await assertOperatorRubricAccess(parentSetForDelete, (req as any).user);
    if (parentSetForDelete?.status === 'archived') {
      throw createHttpError(409, "보관된 루브릭의 차원은 삭제할 수 없습니다.");
    }
    if (parentSetForDelete?.status === 'approved') {
      throw createHttpError(409, "승인된 루브릭의 차원은 삭제할 수 없습니다. 먼저 '새 버전 만들기'를 통해 초안 버전을 생성한 후 수정하세요.");
    }

    // Validate the full post-delete set (count ≥ 3, weight sum ≈ 100)
    const siblings = await storage.getEvaluationDimensionsByCriteriaSet(existing.criteriaSetId);
    const postDeleteDims = siblings.filter((d: any) => d.id !== id);
    const postDeleteSetValidation = validateEvaluationCriteriaSet(postDeleteDims);
    if (!postDeleteSetValidation.valid) {
      throw createHttpError(400, `삭제 후 세트 유효성 검사 실패:\n${postDeleteSetValidation.errors.join('\n')}`);
    }

    await storage.deleteEvaluationDimension(id);
    res.json({ success: true });
  }));

  router.get("/api/admin/evaluation-criteria/:id/translations", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const existing = await storage.getEvaluationCriteriaSet(id);
    if (!existing) throw createHttpError(404, "평가 기준 세트를 찾을 수 없습니다");
    await assertOperatorRubricAccess(existing, req.user);
    const translations = await storage.getEvaluationCriteriaSetTranslations(id);
    res.json(translations);
  }));

  router.post("/api/admin/evaluation-criteria/:id/auto-translate", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const { sourceLocale = 'ko' } = req.body;

    const criteriaSet = await storage.getEvaluationCriteriaSetWithDimensions(id);
    if (!criteriaSet) {
      throw createHttpError(404, "평가 기준 세트를 찾을 수 없습니다");
    }
    await assertOperatorRubricAccess(criteriaSet, req.user);

    const languages = await storage.getActiveSupportedLanguages();
    const targetLocales = languages.filter(l => l.code !== sourceLocale).map(l => l.code);

    const languageNames: Record<string, string> = {
      'ko': 'Korean (한국어)',
      'en': 'English',
      'ja': 'Japanese (日本語)',
      'zh': 'Chinese Simplified (简体中文)',
    };

    let translatedCount = 0;
    const failedLocales: { locale: string; reason: string }[] = [];

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

    const aiService = await getAIServiceForFeature('translation');
    let fatalError: string | undefined;

    for (const targetLocale of targetLocales) {
      if (fatalError) break;

      const setPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation criteria set into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${criteriaSet.name}
Description: ${criteriaSet.description || ''}

Return JSON: {"name": "translated name", "description": "translated description"}`;

      try {
        const setResponse = await aiService.generateText(setPrompt);
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
        const classified = classifyTranslationError(e);
        failedLocales.push({ locale: targetLocale, reason: classified.userMessage });
        if (classified.isFatal) { fatalError = classified.userMessage; break; }
      }

      for (const dim of criteriaSet.dimensions || []) {
        if (fatalError) break;
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
          const dimResponse = await aiService.generateText(dimPrompt);
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
          const classified = classifyTranslationError(e);
          if (classified.isFatal) { fatalError = classified.userMessage; break; }
        }
      }
    }

    res.json({
      success: true,
      message: `${translatedCount}개 항목이 번역되었습니다`,
      translatedCount,
      targetLocales,
      failedLocales,
      ...(fatalError ? { fatalError } : {}),
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
