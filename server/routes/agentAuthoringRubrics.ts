/**
 * Agent API: evaluation rubric authoring (mounted under /api/v1/agent/authoring).
 *
 * Rubrics change scores, so agents only draft and polish them and may request a review.
 * Approval, rejection, defaults, archiving and deletion stay with people in the admin UI and
 * have no agent endpoint. Validation reuses the admin rules (evaluationEngine); approved
 * versions are never edited in place - edits fork a new draft version.
 */
import { Router } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, storage } from "../storage";
import { auditLogs } from "@shared/schema";
import { agentError } from "../middleware/agentApiKeyMiddleware";
import {
  requireAuthoring,
  getAuthoringContext,
  canAccessCategory,
  denyCategory,
  denyAsNotFound,
  rejectPublishAttempts,
  rubricDraftFields,
  recordAuthoringAudit,
  type AgentAuthoringContext,
} from "../services/agentAuthoring";
import {
  validateEvaluationCriteriaSet,
  validateEvaluationDimension,
  calculateRubricQualityScore,
} from "../services/evaluationEngine";
import { RUBRIC_TEMPLATES } from "../data/rubricTemplates";
import { generateFeedback } from "../services/aiServiceFactory";
import { createForkOfApprovedSet } from "./evaluationCriteria";

const router = Router();

export const MAX_AGENT_RUBRIC_DIMENSIONS = 12;
export const AGENT_DRY_RUN_DAILY_LIMIT = Number(process.env.AGENT_RUBRIC_DRY_RUN_DAILY_LIMIT) || 10;
const DRY_RUN_ACTION = "agent_authoring.rubric.dry_run";

const text = (max: number) => z.string().max(max);

const rubricStep = z.object({
  score: z.number().int().min(0).max(100),
  label: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  behaviorAnchor: z.string().min(1).max(1000),
});

const dimensionFields = {
  key: z.string().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9_]*$/, "key must start with a letter and use letters, digits or _"),
  name: z.string().trim().min(1).max(100),
  description: text(1000).nullable(),
  weight: z.number().min(0).max(100),
  minScore: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(1).max(100),
  icon: text(50).nullable(),
  color: text(20).nullable(),
  scoringRubric: z.array(rubricStep).max(20).nullable(),
  evaluationPrompt: text(4000).nullable(),
  isActive: z.boolean(),
  dimensionType: z.enum(["core", "standard", "bonus"]),
};
const dimensionCreate = z.object({
  key: dimensionFields.key,
  name: dimensionFields.name,
  description: dimensionFields.description.optional(),
  weight: dimensionFields.weight.optional(),
  minScore: dimensionFields.minScore.optional(),
  maxScore: dimensionFields.maxScore.optional(),
  icon: dimensionFields.icon.optional(),
  color: dimensionFields.color.optional(),
  scoringRubric: dimensionFields.scoringRubric.optional(),
  evaluationPrompt: dimensionFields.evaluationPrompt.optional(),
  isActive: dimensionFields.isActive.optional(),
  dimensionType: dimensionFields.dimensionType.optional(),
});
const dimensionPatch = dimensionCreate.partial();

const rubricCreate = z.object({
  name: z.string().trim().min(1).max(200),
  description: text(2000).nullable().optional(),
  categoryId: z.string().min(1),
  templateId: z.string().min(1).optional(),
  dimensions: z.array(dimensionCreate).min(1).max(MAX_AGENT_RUBRIC_DIMENSIONS).optional(),
});
const rubricPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: text(2000).nullable().optional(),
  categoryId: z.string().min(1).optional(),
});

const dryRunInput = z.object({
  messages: z.array(z.object({
    sender: z.enum(["user", "ai"]),
    message: z.string().min(1).max(4000),
  })).min(2).max(40),
  scenarioContext: z.object({
    title: text(200),
    context: z.object({ situation: text(4000) }).passthrough().optional(),
    objectives: z.array(text(500)).max(20).optional(),
  }).optional(),
  personaContext: z.object({ id: text(100), name: text(100), role: text(100).optional() }).optional(),
  language: z.enum(["ko", "en", "ja", "zh"]).default("ko"),
});

function fieldError(res: any, error: z.ZodError): void {
  agentError(res, 400, "authoring_validation_failed", "The request body failed validation.", {
    fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

function rulesError(res: any, message: string, errors: string[]): void {
  agentError(res, 400, "authoring_validation_failed", message, { errors });
}

function authoredBy(set: any) {
  return set.authoredByAgent
    ? { type: "agent", agentKeyName: set.authoredByAgent.agentKeyName, ownerUserId: set.authoredByAgent.ownerUserId }
    : { type: "human" };
}

function dimensionView(d: any) {
  return {
    id: d.id, key: d.key, name: d.name, description: d.description ?? null, weight: d.weight,
    minScore: d.minScore, maxScore: d.maxScore, icon: d.icon ?? null, color: d.color ?? null,
    displayOrder: d.displayOrder, scoringRubric: d.scoringRubric ?? null,
    evaluationPrompt: d.evaluationPrompt ?? null, isActive: d.isActive, dimensionType: d.dimensionType ?? null,
  };
}

function setView(set: any, dimensions?: any[]) {
  return {
    id: set.id, name: set.name, description: set.description ?? null, categoryId: set.categoryId ?? null,
    status: set.status, version: set.version ?? 1, parentSetId: set.parentSetId ?? null,
    isDefault: !!set.isDefault, authoredBy: authoredBy(set),
    ...(dimensions ? { dimensions: dimensions.map(dimensionView) } : {}),
  };
}

/** Rubrics outside the owner's category scope (or without a category) look missing. */
async function loadScopedSet(ctx: AgentAuthoringContext, id: string, res: any) {
  const set: any = await storage.getEvaluationCriteriaSet(id);
  if (!set || !canAccessCategory(ctx, set.categoryId)) {
    denyAsNotFound(res, "rubric");
    return null;
  }
  return set;
}

function rejectArchived(res: any, set: any): boolean {
  if (set.status === "archived") {
    agentError(res, 409, "rubric_archived", "Archived rubrics cannot be changed.");
    return true;
  }
  return false;
}

/** Approved versions fork into a new agent-attributed draft; other sets are edited in place. */
async function resolveWritableSet(ctx: AgentAuthoringContext, set: any) {
  if (set.status !== "approved") return { target: set, forkId: null as string | null, dimKeyToForkId: null as Map<string, string> | null };
  const { forkId, dimKeyToForkId } = await createForkOfApprovedSet(set.id, ctx.owner.id, ctx.owner.id);
  const fork: any = await storage.updateEvaluationCriteriaSet(forkId, { authoredByAgent: ctx.authorship } as any);
  return { target: fork, forkId, dimKeyToForkId };
}

function toDimensionRow(criteriaSetId: string, d: z.infer<typeof dimensionCreate>, order: number) {
  return {
    criteriaSetId,
    key: d.key,
    name: d.name,
    description: d.description ?? null,
    weight: d.weight ?? 20,
    minScore: d.minScore ?? 1,
    maxScore: d.maxScore ?? 10,
    icon: d.icon ?? null,
    color: d.color ?? null,
    displayOrder: order,
    scoringRubric: d.scoringRubric ?? null,
    evaluationPrompt: d.evaluationPrompt ?? null,
    isActive: d.isActive !== false,
    ...(d.dimensionType ? { dimensionType: d.dimensionType } : {}),
  };
}

function validateDimensionList(dims: any[], opts: { skipWeight: boolean; skipMin: boolean }) {
  const errors: string[] = [];
  if (dims.length > MAX_AGENT_RUBRIC_DIMENSIONS) {
    errors.push(`평가 차원은 최대 ${MAX_AGENT_RUBRIC_DIMENSIONS}개까지 가능합니다 (현재: ${dims.length}개)`);
  }
  const setCheck = validateEvaluationCriteriaSet(dims, { skipWeightValidation: opts.skipWeight, skipMinDimensions: opts.skipMin });
  errors.push(...setCheck.errors);
  return errors;
}

// ─────────────────────────────────────────────────────────────────────────────
router.get("/rubrics/templates", ...requireAuthoring("rubrics:write"), (req: any, res) => {
  res.json({
    templates: RUBRIC_TEMPLATES.map((t) => ({
      id: t.id, name: t.name, description: t.description, scenarioType: t.scenarioType,
      dimensions: t.dimensions.map((d) => ({ key: d.key, name: d.name, weight: d.weight, dimensionType: d.dimensionType })),
    })),
    requestId: req.agentRequestId,
  });
});

router.get("/rubrics", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const all = await storage.getAllEvaluationCriteriaSets();
    const rubrics = all.filter((s: any) => canAccessCategory(ctx, s.categoryId)).map((s: any) => setView(s));
    res.json({ rubrics, total: rubrics.length, requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] GET /rubrics error:", err);
    agentError(res, 500, "internal_error", "Failed to list rubrics.");
  }
});

router.get("/rubrics/:id", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const set = await loadScopedSet(getAuthoringContext(req), req.params.id, res);
    if (!set) return;
    const dims = await storage.getEvaluationDimensionsByCriteriaSet(set.id);
    res.json({ ...setView(set, dims), requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] GET /rubrics/:id error:", err);
    agentError(res, 500, "internal_error", "Failed to fetch the rubric.");
  }
});

router.post("/rubrics", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    if (rejectPublishAttempts(res, req.body)) return;
    const parsed = rubricCreate.safeParse(req.body);
    if (!parsed.success) return fieldError(res, parsed.error);
    const data = parsed.data;
    if (!canAccessCategory(ctx, data.categoryId)) return denyCategory(res);

    let dims: z.infer<typeof dimensionCreate>[];
    let description = data.description ?? null;
    if (data.templateId) {
      const template = RUBRIC_TEMPLATES.find((t) => t.id === data.templateId);
      if (!template) {
        return agentError(res, 400, "authoring_validation_failed", "Unknown template.", {
          fields: [{ path: "templateId", message: `Template "${data.templateId}" not found.` }],
        });
      }
      dims = template.dimensions.map((d) => ({ ...d }));
      description = description ?? template.description;
    } else if (data.dimensions) {
      dims = data.dimensions;
    } else {
      return agentError(res, 400, "authoring_validation_failed", "Provide templateId or dimensions.", {
        fields: [{ path: "templateId", message: "Provide templateId or dimensions." }],
      });
    }

    // Weight sum is enforced at review time (same as the admin flow); structure is checked now.
    const errors = validateDimensionList(dims, { skipWeight: true, skipMin: true });
    if (errors.length) return rulesError(res, "The rubric failed validation.", errors);

    const set: any = await storage.createEvaluationCriteriaSet({
      name: data.name,
      description,
      isActive: true,
      categoryId: data.categoryId,
      ...rubricDraftFields(ctx),
    } as any);
    const created = [];
    for (let i = 0; i < dims.length; i++) created.push(await storage.createEvaluationDimension(toDimensionRow(set.id, dims[i], i) as any));
    await recordAuthoringAudit(req, "rubric.created", "rubric", set.id, {
      name: set.name, categoryId: data.categoryId, templateId: data.templateId ?? null,
    });
    res.status(201).json({ ...setView({ ...set, authoredByAgent: ctx.authorship }, created), requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] POST /rubrics error:", err);
    agentError(res, 500, "internal_error", "Failed to create the rubric.");
  }
});

router.patch("/rubrics/:id", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    if (rejectPublishAttempts(res, req.body)) return;
    const set = await loadScopedSet(ctx, req.params.id, res);
    if (!set) return;
    if (rejectArchived(res, set)) return;
    const parsed = rubricPatch.safeParse(req.body);
    if (!parsed.success) return fieldError(res, parsed.error);
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) updates[k] = k === "name" ? (v as string).trim() : v;
    if (Object.keys(updates).length === 0) {
      return agentError(res, 400, "authoring_validation_failed", "At least one editable field is required.", { fields: [] });
    }
    if (parsed.data.categoryId && parsed.data.categoryId !== set.categoryId && !canAccessCategory(ctx, parsed.data.categoryId)) {
      return denyCategory(res);
    }
    const { target, forkId } = await resolveWritableSet(ctx, set);
    const updated: any = await storage.updateEvaluationCriteriaSet(target.id, updates as any);
    await recordAuthoringAudit(req, forkId ? "rubric.draft_version_saved" : "rubric.updated", "rubric", set.id, {
      fields: Object.keys(updates), forkId,
    });
    const dims = await storage.getEvaluationDimensionsByCriteriaSet(target.id);
    res.status(forkId ? 201 : 200).json({
      ...setView({ ...updated, authoredByAgent: forkId ? ctx.authorship : set.authoredByAgent }, dims),
      ...(forkId ? { autoForked: true, forkedFromId: set.id } : {}),
      requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] PATCH /rubrics/:id error:", err);
    agentError(res, 500, "internal_error", "Failed to update the rubric.");
  }
});

// ── Dimensions ───────────────────────────────────────────────────────────────
router.post("/rubrics/:id/dimensions", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const set = await loadScopedSet(ctx, req.params.id, res);
    if (!set) return;
    if (rejectArchived(res, set)) return;
    const parsed = dimensionCreate.safeParse(req.body);
    if (!parsed.success) return fieldError(res, parsed.error);
    const existing = await storage.getEvaluationDimensionsByCriteriaSet(set.id);
    if (existing.some((d: any) => d.key === parsed.data.key)) {
      return agentError(res, 400, "authoring_validation_failed", `Dimension key "${parsed.data.key}" already exists.`, {
        fields: [{ path: "key", message: "Duplicate key." }],
      });
    }
    const row = toDimensionRow(set.id, parsed.data, existing.length);
    const errors = [
      ...validateEvaluationDimension(row as any).errors,
      ...validateDimensionList([...existing, row], { skipWeight: true, skipMin: true }),
    ];
    if (errors.length) return rulesError(res, "The dimension failed validation.", errors);

    const { target, forkId } = await resolveWritableSet(ctx, set);
    const dimension = await storage.createEvaluationDimension({ ...row, criteriaSetId: target.id, displayOrder: existing.length } as any);
    await recordAuthoringAudit(req, forkId ? "rubric.draft_version_saved" : "rubric.dimension_added", "rubric", set.id, {
      key: row.key, forkId,
    });
    res.status(201).json({
      rubricId: target.id, ...(forkId ? { autoForked: true, forkedFromId: set.id } : {}),
      dimension: dimensionView(dimension), requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] POST dimension error:", err);
    agentError(res, 500, "internal_error", "Failed to add the dimension.");
  }
});

async function loadDimension(ctx: AgentAuthoringContext, rubricId: string, dimId: string, res: any) {
  const set = await loadScopedSet(ctx, rubricId, res);
  if (!set) return null;
  const dim: any = await storage.getEvaluationDimension(dimId);
  if (!dim || dim.criteriaSetId !== set.id) {
    agentError(res, 404, "dimension_not_found", "Dimension not found.");
    return null;
  }
  return { set, dim };
}

router.patch("/rubrics/:id/dimensions/:dimId", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const loaded = await loadDimension(ctx, req.params.id, req.params.dimId, res);
    if (!loaded) return;
    const { set, dim } = loaded;
    if (rejectArchived(res, set)) return;
    const parsed = dimensionPatch.safeParse(req.body);
    if (!parsed.success) return fieldError(res, parsed.error);
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) updates[k] = v;
    if (Object.keys(updates).length === 0) {
      return agentError(res, 400, "authoring_validation_failed", "At least one editable field is required.", { fields: [] });
    }
    const siblings = await storage.getEvaluationDimensionsByCriteriaSet(set.id);
    if (updates.key && updates.key !== dim.key && siblings.some((d: any) => d.key === updates.key && d.id !== dim.id)) {
      return agentError(res, 400, "authoring_validation_failed", `Dimension key "${updates.key}" already exists.`, {
        fields: [{ path: "key", message: "Duplicate key." }],
      });
    }
    const merged = { ...dim, ...updates };
    const errors = [
      ...validateEvaluationDimension(merged).errors,
      ...validateDimensionList(siblings.map((d: any) => (d.id === dim.id ? merged : d)), { skipWeight: true, skipMin: true }),
    ];
    if (errors.length) return rulesError(res, "The dimension failed validation.", errors);

    const { target, forkId, dimKeyToForkId } = await resolveWritableSet(ctx, set);
    const targetDimId = forkId ? dimKeyToForkId!.get(dim.key)! : dim.id;
    const updated = await storage.updateEvaluationDimension(targetDimId, updates as any);
    await recordAuthoringAudit(req, forkId ? "rubric.draft_version_saved" : "rubric.dimension_updated", "rubric", set.id, {
      key: dim.key, fields: Object.keys(updates), forkId,
    });
    res.status(forkId ? 201 : 200).json({
      rubricId: target.id, ...(forkId ? { autoForked: true, forkedFromId: set.id } : {}),
      dimension: dimensionView(updated), requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] PATCH dimension error:", err);
    agentError(res, 500, "internal_error", "Failed to update the dimension.");
  }
});

router.delete("/rubrics/:id/dimensions/:dimId", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const loaded = await loadDimension(ctx, req.params.id, req.params.dimId, res);
    if (!loaded) return;
    const { set, dim } = loaded;
    if (rejectArchived(res, set)) return;
    const siblings = await storage.getEvaluationDimensionsByCriteriaSet(set.id);
    const remaining = siblings.filter((d: any) => d.id !== dim.id);
    if (remaining.length === 0) {
      return rulesError(res, "A rubric needs at least one dimension.", ["마지막 평가 차원은 삭제할 수 없습니다."]);
    }
    const errors = validateDimensionList(remaining, { skipWeight: true, skipMin: true });
    if (errors.length) return rulesError(res, "The rubric would become invalid.", errors);

    const { target, forkId, dimKeyToForkId } = await resolveWritableSet(ctx, set);
    await storage.deleteEvaluationDimension(forkId ? dimKeyToForkId!.get(dim.key)! : dim.id);
    await recordAuthoringAudit(req, forkId ? "rubric.draft_version_saved" : "rubric.dimension_deleted", "rubric", set.id, {
      key: dim.key, forkId,
    });
    res.json({
      success: true, rubricId: target.id, ...(forkId ? { autoForked: true, forkedFromId: set.id } : {}),
      requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] DELETE dimension error:", err);
    agentError(res, 500, "internal_error", "Failed to delete the dimension.");
  }
});

// ── Quality, dry-run, review ─────────────────────────────────────────────────
router.get("/rubrics/:id/quality-score", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const set = await loadScopedSet(getAuthoringContext(req), req.params.id, res);
    if (!set) return;
    const dims = await storage.getEvaluationDimensionsByCriteriaSet(set.id);
    res.json({ ...calculateRubricQualityScore(dims), approvalThreshold: 80, requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] quality-score error:", err);
    agentError(res, 500, "internal_error", "Failed to calculate the quality score.");
  }
});

async function dryRunsToday(agentKeyId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows: any[] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.action, DRY_RUN_ACTION),
      sql`${auditLogs.metadata}->>'agentKeyId' = ${agentKeyId}`,
      gte(auditLogs.createdAt, start),
    ));
  return Number(rows[0]?.n ?? 0);
}

// Dry-run calls the AI provider (costs money), so each key has a daily cap.
router.post("/rubrics/:id/dry-run", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const set = await loadScopedSet(ctx, req.params.id, res);
    if (!set) return;
    const parsed = dryRunInput.safeParse(req.body);
    if (!parsed.success) return fieldError(res, parsed.error);

    const used = await dryRunsToday(ctx.key.id);
    if (used >= AGENT_DRY_RUN_DAILY_LIMIT) {
      return agentError(res, 429, "authoring_dry_run_limit_exceeded",
        `Daily dry-run limit reached (${AGENT_DRY_RUN_DAILY_LIMIT} per key per UTC day).`,
        { limit: AGENT_DRY_RUN_DAILY_LIMIT, used });
    }
    // Reserve the call before the paid request so failures and retries still count.
    await recordAuthoringAudit(req, "rubric.dry_run", "rubric", set.id, { messageCount: parsed.data.messages.length });

    const withDims: any = await storage.getEvaluationCriteriaSetWithDimensions(set.id);
    if (!withDims || !withDims.dimensions?.length) {
      return rulesError(res, "The rubric has no dimensions to evaluate with.", ["평가 차원이 없습니다."]);
    }
    const now = new Date().toISOString();
    const messages = parsed.data.messages.map((m, i) => ({ ...m, timestamp: now, turnIndex: i }));
    const scenario: any = parsed.data.scenarioContext ?? {
      title: "드라이런 테스트", context: { situation: "테스트 대화" }, objectives: ["소통 능력 평가"],
    };
    const persona: any = parsed.data.personaContext ?? { id: "dry-run-persona", name: "테스트 페르소나", role: "동료" };
    try {
      const feedback = await generateFeedback(scenario, messages as any, persona, undefined, withDims, parsed.data.language as any);
      res.json({
        feedback, rubricId: set.id, isDryRun: true,
        usage: { usedToday: used + 1, dailyLimit: AGENT_DRY_RUN_DAILY_LIMIT },
        requestId: req.agentRequestId,
      });
    } catch (err: any) {
      console.error("[agentAuthoring] dry-run failed:", err);
      agentError(res, 502, "dry_run_failed", "The trial evaluation failed. This attempt counted toward the daily limit.");
    }
  } catch (err) {
    console.error("[agentAuthoring] dry-run error:", err);
    agentError(res, 500, "internal_error", "Failed to run the trial evaluation.");
  }
});

// Agents can only move a draft to "review". Approve/reject/default/archive have no agent endpoint.
router.post("/rubrics/:id/request-review", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const set = await loadScopedSet(ctx, req.params.id, res);
    if (!set) return;
    if (set.status === "approved") return agentError(res, 400, "rubric_already_approved", "Approved rubrics cannot be sent for review. Edit them to create a new draft version.");
    if (set.status === "archived") return rejectArchived(res, set) as unknown as void;
    const dims = await storage.getEvaluationDimensionsByCriteriaSet(set.id);
    const errors = validateDimensionList(dims, { skipWeight: false, skipMin: false });
    if (errors.length) return rulesError(res, "The rubric failed the pre-review validation.", errors);

    const updated: any = await storage.updateEvaluationCriteriaSetStatus(set.id, "review");
    await recordAuthoringAudit(req, "rubric.review_requested", "rubric", set.id, { qualityScore: calculateRubricQualityScore(dims).totalScore });
    res.json({ ...setView(updated), requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] request-review error:", err);
    agentError(res, 500, "internal_error", "Failed to request a review.");
  }
});

// ── Scenario link ────────────────────────────────────────────────────────────
// Only stores the link on a draft (or a new draft version of a published scenario). Runtime
// evaluation still ignores rubrics that are not approved (loadEvaluationCriteria).
router.put("/scenarios/:id/rubric", ...requireAuthoring("rubrics:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    if (!(ctx.key.scopes ?? []).includes("scenarios:write")) {
      return agentError(res, 403, "missing_scope", "Linking a rubric to a scenario also requires scenarios:write.");
    }
    const parsed = z.object({ rubricId: z.string().min(1).nullable() }).safeParse(req.body);
    if (!parsed.success) return fieldError(res, parsed.error);

    const scenario: any = await storage.getScenario(req.params.id);
    if (!scenario || scenario.isDeleted || !canAccessCategory(ctx, scenario.categoryId)) return denyAsNotFound(res, "scenario");

    let rubric: any = null;
    if (parsed.data.rubricId) {
      rubric = await loadScopedSet(ctx, parsed.data.rubricId, res);
      if (!rubric) return;
      if (rubric.status === "archived") return rejectArchived(res, rubric) as unknown as void;
    }
    const link = parsed.data.rubricId;
    const published = scenario.isPublic || !!(await storage.getLatestPublishedVersion(scenario.id));
    const note = rubric && rubric.status !== "approved"
      ? "The rubric is not approved yet; live conversations keep using the category or default rubric until it is approved."
      : undefined;

    if (published) {
      const version = await storage.saveScenarioDraftVersion(
        scenario.id,
        { ...scenario, evaluationCriteriaSetId: link, authoredByAgent: ctx.authorship },
        ctx.owner.id,
      );
      await recordAuthoringAudit(req, "scenario.rubric_link_draft_version", "scenario", scenario.id, { rubricId: link, version: version.version });
      return res.status(201).json({
        scenarioId: scenario.id, rubricId: link, rubricStatus: rubric?.status ?? null, status: "published",
        draftVersion: { id: version.id, version: version.version, status: version.status },
        ...(note ? { note } : {}), requestId: req.agentRequestId,
      });
    }
    const { fileManager } = await import("../services/fileManager");
    await fileManager.updateScenario(scenario.id, { evaluationCriteriaSetId: link } as any);
    await recordAuthoringAudit(req, "scenario.rubric_linked", "scenario", scenario.id, { rubricId: link });
    res.json({
      scenarioId: scenario.id, rubricId: link, rubricStatus: rubric?.status ?? null, status: "draft",
      ...(note ? { note } : {}), requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] PUT scenario rubric error:", err);
    agentError(res, 500, "internal_error", "Failed to link the rubric.");
  }
});

export default router;
