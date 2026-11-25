/**
 * Agent API: scenario and persona authoring (mounted under /api/v1/agent/authoring).
 *
 * Agents write private drafts on behalf of the key owner (an operator/admin). Validation,
 * source-language translation and version rules mirror the admin save paths. Media, live
 * avatar and image fields are never writable here; anything outside the schemas is ignored.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { fillScenarioFieldsWithAI } from "../services/aiScenarioGenerator";
import { validateScenario } from "../services/scenarios/scenarioValidator";
import { agentError } from "../middleware/agentApiKeyMiddleware";
import {
  requireAuthoring,
  getAuthoringContext,
  canAccessCategory,
  denyCategory,
  denyAsNotFound,
  rejectPublishAttempts,
  scenarioDraftFields,
  recordAuthoringAudit,
  type AgentAuthoringContext,
} from "../services/agentAuthoring";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Input schemas (unknown keys, including every media/avatar field, are stripped)
// ─────────────────────────────────────────────────────────────────────────────
const text = (max: number) => z.string().max(max);

const scenarioPersonaInput = z.object({
  id: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(100),
  personaRef: z.string().min(1).max(120),
  department: text(200).optional(),
  position: text(200).optional(),
  experience: text(200).optional(),
  stance: text(1000).optional(),
  goal: text(1000).optional(),
  tradeoff: text(1000).optional(),
  gender: z.enum(["male", "female"]).optional(),
  mbti: text(10).optional(),
  isPrimary: z.boolean().optional(),
  triggerHints: z.array(text(300)).max(20).optional(),
  entryLine: text(500).optional(),
});

const scenarioInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().min(1).max(4000),
  categoryId: z.string().min(1),
  difficulty: z.number().int().min(1).max(5).optional(),
  estimatedTime: text(100).optional(),
  skills: z.array(text(100)).max(30).optional(),
  objectiveType: text(100).optional(),
  context: z.object({
    situation: text(4000),
    timeline: text(2000),
    stakes: text(2000),
    playerRole: z.object({
      position: text(200),
      department: text(200),
      experience: text(200),
      responsibility: text(1000),
    }),
  }).optional(),
  objectives: z.array(text(500)).max(20).optional(),
  successCriteria: z.object({
    optimal: text(1000),
    good: text(1000),
    acceptable: text(1000),
    failure: text(1000),
  }).optional(),
  personas: z.array(scenarioPersonaInput).min(1).max(10),
  recommendedFlow: z.array(text(300)).max(20).optional(),
  targetDurationMinutes: z.number().int().min(1).max(120).optional(),
  targetTurns: z.number().int().min(1).max(100).optional(),
  minValidTurns: z.number().int().min(1).max(100).optional(),
  personaSwitchMode: z.enum(["replace", "join", "none"]).nullable().optional(),
  sourceLocale: z.string().min(2).max(10).optional(),
});
const scenarioPatchInput = scenarioInput.partial();

const personaFields = {
  mbti: z.string().regex(/^[A-Za-z]{4}$/, "mbti must be a 4-letter type such as ENTJ"),
  gender: z.enum(["male", "female"]).nullable(),
  personality_traits: z.array(text(200)).max(30),
  communication_style: text(2000).nullable(),
  motivation: text(2000).nullable(),
  fears: z.array(text(300)).max(30),
  background: z.object({
    personal_values: z.array(text(200)).max(20),
    hobbies: z.array(text(200)).max(20),
    social: z.object({ preference: text(500), behavior: text(500) }),
  }).nullable(),
  communication_patterns: z.object({
    opening_style: text(500),
    key_phrases: z.array(text(300)).max(30),
    response_to_arguments: z.record(z.string(), text(500)),
    win_conditions: z.array(text(300)).max(20),
  }).nullable(),
  voice: z.object({
    tone: text(200),
    pace: text(200),
    volume: text(200).optional(),
    pitch: text(200).optional(),
  }).nullable(),
};
const personaCreateInput = z.object({
  mbti: personaFields.mbti,
  gender: personaFields.gender.optional(),
  personality_traits: personaFields.personality_traits.optional(),
  communication_style: personaFields.communication_style.optional(),
  motivation: personaFields.motivation.optional(),
  fears: personaFields.fears.optional(),
  background: personaFields.background.optional(),
  communication_patterns: personaFields.communication_patterns.optional(),
  voice: personaFields.voice.optional(),
});
const personaPatchInput = personaCreateInput.partial();

function sendValidationError(res: any, error: z.ZodError): void {
  agentError(res, 400, "authoring_validation_failed", "The request body failed validation.", {
    fields: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

function ignoredFieldsOf(body: unknown, schema: z.ZodObject<any>): string[] {
  if (!body || typeof body !== "object") return [];
  const known = new Set(Object.keys(schema.shape));
  return Object.keys(body as object).filter((k) => !known.has(k));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
type DbScenario = NonNullable<Awaited<ReturnType<typeof storage.getScenario>>>;

async function isPublished(scenario: DbScenario): Promise<boolean> {
  if (scenario.isPublic) return true;
  return !!(await storage.getLatestPublishedVersion(scenario.id));
}

/** Persona records an agent may reference: human/system records and its owner's own agent drafts. */
function visiblePersona(ctx: AgentAuthoringContext, p: { authoredByAgent?: { ownerUserId: string } | null }): boolean {
  return !p.authoredByAgent || p.authoredByAgent.ownerUserId === ctx.owner.id;
}

function scenarioView(s: any, published: boolean) {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    categoryId: s.categoryId ?? null,
    difficulty: s.difficulty,
    estimatedTime: s.estimatedTime ?? null,
    skills: s.skills ?? [],
    objectiveType: s.objectiveType ?? null,
    context: s.context ?? null,
    objectives: s.objectives ?? [],
    successCriteria: s.successCriteria ?? null,
    personas: (s.personas ?? []).map((p: any) => ({
      id: p.id, name: p.name, personaRef: p.personaRef, department: p.department, position: p.position,
      experience: p.experience, stance: p.stance, goal: p.goal, tradeoff: p.tradeoff, gender: p.gender,
      mbti: p.mbti, isPrimary: p.isPrimary, triggerHints: p.triggerHints, entryLine: p.entryLine,
    })),
    recommendedFlow: s.recommendedFlow ?? [],
    targetDurationMinutes: s.targetDurationMinutes,
    targetTurns: s.targetTurns,
    minValidTurns: s.minValidTurns,
    status: published ? "published" : "draft",
    authoredBy: s.authoredByAgent
      ? { type: "agent", agentKeyName: s.authoredByAgent.agentKeyName, ownerUserId: s.authoredByAgent.ownerUserId }
      : { type: "human" },
  };
}

function personaView(p: any) {
  return {
    id: p.id,
    mbti: p.mbti,
    gender: p.gender ?? null,
    personality_traits: p.personalityTraits ?? [],
    communication_style: p.communicationStyle ?? null,
    motivation: p.motivation ?? null,
    fears: p.fears ?? [],
    background: p.background ?? null,
    communication_patterns: p.communicationPatterns ?? null,
    voice: p.voice ?? null,
    authoredBy: p.authoredByAgent
      ? { type: "agent", agentKeyName: p.authoredByAgent.agentKeyName, ownerUserId: p.authoredByAgent.ownerUserId }
      : { type: "human" },
  };
}

/** Normalises persona references and checks they point to visible MBTI persona records. */
async function resolvePersonas(ctx: AgentAuthoringContext, personas: z.infer<typeof scenarioPersonaInput>[]) {
  const records = (await storage.getAllMbtiPersonas()).filter((p) => visiblePersona(ctx, p as any));
  const ids = new Set(records.map((p) => p.id));
  const missing: { path: string; message: string }[] = [];
  const resolved = personas.map((p, i) => {
    const ref = p.personaRef.replace(/\.json$/i, "");
    if (!ids.has(ref)) missing.push({ path: `personas.${i}.personaRef`, message: `Persona record "${ref}" was not found.` });
    return { ...p, id: p.id ?? ref, personaRef: `${ref}.json` };
  });
  const withPrimary = resolved.some((p) => p.isPrimary === true)
    ? resolved
    : resolved.map((p, i) => ({ ...p, isPrimary: i === 0 }));
  return { personas: withPrimary, missing, ids };
}

async function saveOriginalTranslation(scenario: any, sourceLocale: string): Promise<void> {
  try {
    await storage.upsertScenarioTranslation({
      scenarioId: scenario.id,
      locale: sourceLocale,
      sourceLocale,
      isOriginal: true,
      title: scenario.title,
      description: scenario.description,
      situation: scenario.context?.situation || null,
      timeline: scenario.context?.timeline || null,
      stakes: scenario.context?.stakes || null,
      playerRole: scenario.context?.playerRole
        ? `${scenario.context.playerRole.position} / ${scenario.context.playerRole.department}` : null,
      objectives: scenario.objectives || null,
      skills: scenario.skills || null,
      successCriteriaOptimal: scenario.successCriteria?.optimal || null,
      successCriteriaGood: scenario.successCriteria?.good || null,
      successCriteriaAcceptable: scenario.successCriteria?.acceptable || null,
      successCriteriaFailure: scenario.successCriteria?.failure || null,
      isMachineTranslated: false,
      isReviewed: true,
    } as any);
  } catch (err) {
    console.error("[agentAuthoring] original translation save failed:", err);
  }
}

async function runValidation(scenarioData: any, mbtiIds: Set<string>, translations: any[] = []) {
  const langs = (await storage.getActiveSupportedLanguages()).map((l: any) => l.code);
  return validateScenario(scenarioData, mbtiIds, translations, langs);
}

function validationFailure(res: any, validation: ReturnType<typeof validateScenario>): void {
  agentError(res, 400, "authoring_validation_failed", "The scenario failed quality validation.", {
    errors: validation.issues.filter((i) => i.severity === "error"),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────────────────────
router.get("/scenarios", ...requireAuthoring("scenarios:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const all = await storage.getAllScenarios();
    const visible = all.filter((s: any) => !s.isDeleted && canAccessCategory(ctx, s.categoryId));
    const items = await Promise.all(visible.map(async (s: any) => ({
      id: s.id,
      title: s.title,
      categoryId: s.categoryId ?? null,
      difficulty: s.difficulty,
      personaCount: (s.personas ?? []).length,
      status: (await isPublished(s)) ? "published" : "draft",
      authoredBy: s.authoredByAgent
        ? { type: "agent", agentKeyName: s.authoredByAgent.agentKeyName, ownerUserId: s.authoredByAgent.ownerUserId }
        : { type: "human" },
    })));
    res.json({ scenarios: items, total: items.length, requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] GET /scenarios error:", err);
    agentError(res, 500, "internal_error", "Failed to list scenarios.");
  }
});

router.get("/scenarios/:id", ...requireAuthoring("scenarios:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const s: any = await storage.getScenario(req.params.id);
    if (!s || s.isDeleted || !canAccessCategory(ctx, s.categoryId)) return denyAsNotFound(res, "scenario");
    res.json({ ...scenarioView(s, await isPublished(s)), requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] GET /scenarios/:id error:", err);
    agentError(res, 500, "internal_error", "Failed to fetch the scenario.");
  }
});

router.post("/scenarios", ...requireAuthoring("scenarios:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    if (rejectPublishAttempts(res, req.body)) return;
    const parsed = scenarioInput.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const data = parsed.data;

    if (!canAccessCategory(ctx, data.categoryId)) return denyCategory(res);

    const { personas, missing, ids } = await resolvePersonas(ctx, data.personas);
    if (missing.length) {
      return agentError(res, 400, "authoring_validation_failed", "Some persona references are invalid.", { fields: missing });
    }

    const sourceLocale = data.sourceLocale ?? "ko";
    const scenarioData: any = { ...data, personas, sourceLocale, ...scenarioDraftFields(ctx) };
    const validation = await runValidation(scenarioData, ids);
    if (validation.hasFatalErrors) return validationFailure(res, validation);

    const scenario: any = await fileManager.createScenario(scenarioData);
    await saveOriginalTranslation(scenario, sourceLocale);
    await recordAuthoringAudit(req, "scenario.created", "scenario", scenario.id, { title: scenario.title, categoryId: data.categoryId });

    res.status(201).json({
      ...scenarioView({ ...scenario, authoredByAgent: ctx.authorship }, false),
      warnings: validation.issues.filter((i) => i.severity !== "error"),
      ignoredFields: ignoredFieldsOf(req.body, scenarioInput),
      requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] POST /scenarios error:", err);
    agentError(res, 500, "internal_error", "Failed to create the scenario.");
  }
});

router.patch("/scenarios/:id", ...requireAuthoring("scenarios:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    if (rejectPublishAttempts(res, req.body)) return;

    const existing: any = await storage.getScenario(req.params.id);
    if (!existing || existing.isDeleted || !canAccessCategory(ctx, existing.categoryId)) {
      return denyAsNotFound(res, "scenario");
    }

    const parsed = scenarioPatchInput.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const patch: any = { ...parsed.data };
    if (Object.keys(patch).length === 0) {
      return agentError(res, 400, "authoring_validation_failed", "At least one editable field is required.", { fields: [] });
    }
    if (patch.categoryId && !canAccessCategory(ctx, patch.categoryId)) return denyCategory(res);

    let ids: Set<string>;
    if (patch.personas) {
      const r = await resolvePersonas(ctx, patch.personas);
      if (r.missing.length) {
        return agentError(res, 400, "authoring_validation_failed", "Some persona references are invalid.", { fields: r.missing });
      }
      patch.personas = r.personas;
      ids = r.ids;
    } else {
      ids = new Set((await storage.getAllMbtiPersonas()).map((p) => p.id));
    }

    const merged: any = { ...existing, ...patch };
    const translations = await storage.getScenarioTranslations(existing.id);
    const validation = await runValidation(merged, ids, translations);
    if (validation.hasFatalErrors) return validationFailure(res, validation);

    const published = await isPublished(existing);
    const warnings = validation.issues.filter((i) => i.severity !== "error");
    const ignoredFields = ignoredFieldsOf(req.body, scenarioInput);

    if (published) {
      // Published scenarios are never edited in place: the change becomes a new draft version.
      const version = await storage.saveScenarioDraftVersion(
        existing.id,
        { ...merged, authoredByAgent: ctx.authorship },
        ctx.owner.id,
      );
      await recordAuthoringAudit(req, "scenario.draft_version_saved", "scenario", existing.id, {
        version: version.version, fields: Object.keys(patch),
      });
      return res.status(201).json({
        scenarioId: existing.id,
        status: "published",
        draftVersion: { id: version.id, version: version.version, status: version.status },
        warnings,
        ignoredFields,
        requestId: req.agentRequestId,
      });
    }

    const updated: any = await fileManager.updateScenario(existing.id, patch);
    if (patch.title !== undefined || patch.description !== undefined || patch.context !== undefined
      || patch.objectives !== undefined || patch.skills !== undefined || patch.successCriteria !== undefined) {
      await saveOriginalTranslation(updated, existing.sourceLocale ?? "ko");
    }
    await recordAuthoringAudit(req, "scenario.updated", "scenario", existing.id, { fields: Object.keys(patch) });
    res.json({
      ...scenarioView({ ...updated, authoredByAgent: existing.authoredByAgent }, false),
      warnings,
      ignoredFields,
      requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] PATCH /scenarios/:id error:", err);
    agentError(res, 500, "internal_error", "Failed to update the scenario.");
  }
});

// Text-only AI assist (same service as the admin "fill fields" helper). No media generation is exposed.
router.post("/scenarios/fill-fields", ...requireAuthoring("scenarios:write"), async (req: any, res) => {
  try {
    const idea = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
    if (!idea || idea.length > 2000) {
      return agentError(res, 400, "authoring_validation_failed", "idea is required (max 2000 characters).", {
        fields: [{ path: "idea", message: "Required, 1-2000 characters." }],
      });
    }
    const result = await fillScenarioFieldsWithAI(idea);
    await recordAuthoringAudit(req, "scenario.fill_fields", "scenario", "-", { ideaLength: idea.length });
    res.json({ ...result, requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] fill-fields error:", err);
    agentError(res, 500, "internal_error", "Failed to generate scenario fields.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Persona records (text fields only)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/personas", ...requireAuthoring("personas:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    const records = (await storage.getAllMbtiPersonas()).filter((p) => visiblePersona(ctx, p as any));
    const personas = records.map(personaView);
    res.json({ personas, total: personas.length, requestId: req.agentRequestId });
  } catch (err) {
    console.error("[agentAuthoring] GET /personas error:", err);
    agentError(res, 500, "internal_error", "Failed to list personas.");
  }
});

function toDbPersona(input: Record<string, any>) {
  const map: Record<string, string> = {
    mbti: "mbti", gender: "gender", personality_traits: "personalityTraits",
    communication_style: "communicationStyle", motivation: "motivation", fears: "fears",
    background: "background", communication_patterns: "communicationPatterns", voice: "voice",
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (k in map && v !== undefined) out[map[k]] = k === "mbti" ? String(v).toUpperCase() : v;
  return out;
}

router.post("/personas", ...requireAuthoring("personas:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    if (rejectPublishAttempts(res, req.body)) return;
    const parsed = personaCreateInput.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);

    const id = `agent-${parsed.data.mbti.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    // Avatar, video and image columns are intentionally not written; storeListed stays false.
    const created = await storage.createMbtiPersona({
      id,
      ...toDbPersona(parsed.data),
      storeListed: false,
      authoredByAgent: ctx.authorship,
    } as any);
    await recordAuthoringAudit(req, "persona.created", "persona", id, { mbti: created.mbti });
    res.status(201).json({
      ...personaView(created),
      ignoredFields: ignoredFieldsOf(req.body, personaCreateInput),
      requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] POST /personas error:", err);
    agentError(res, 500, "internal_error", "Failed to create the persona.");
  }
});

router.patch("/personas/:id", ...requireAuthoring("personas:write"), async (req: any, res) => {
  try {
    const ctx = getAuthoringContext(req);
    if (rejectPublishAttempts(res, req.body)) return;
    const existing: any = await storage.getMbtiPersona(req.params.id);
    // Only persona drafts created by this owner's agents can be edited; everything else looks missing.
    if (!existing || existing.authoredByAgent?.ownerUserId !== ctx.owner.id) return denyAsNotFound(res, "persona");

    const parsed = personaPatchInput.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed.error);
    const updates = toDbPersona(parsed.data);
    if (Object.keys(updates).length === 0) {
      return agentError(res, 400, "authoring_validation_failed", "At least one editable field is required.", { fields: [] });
    }
    const updated = await storage.updateMbtiPersona(existing.id, updates as any);
    await recordAuthoringAudit(req, "persona.updated", "persona", existing.id, { fields: Object.keys(parsed.data) });
    res.json({
      ...personaView(updated),
      ignoredFields: ignoredFieldsOf(req.body, personaCreateInput),
      requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentAuthoring] PATCH /personas/:id error:", err);
    agentError(res, 500, "internal_error", "Failed to update the persona.");
  }
});

export default router;
