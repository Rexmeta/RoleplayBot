import { storage } from "../../storage";
import { fileManager } from "../fileManager";
import { scenarioOverrideDataSchema, scenarioOverrideSchemaForDimensions, type ScenarioOverrideData } from "@shared/schema";
import { ORGANIZATION_OVERRIDE_KEY, resolveOverrideWeights } from "@shared/organizationOverride";
import { applyScenarioOverride } from "./overrideResolver";
import { assertImportedSnapshotComplete, EVALUATION_CRITERIA_SNAPSHOT_KEY, RUNTIME_PERSONA_PROFILE_KEY } from "../runtimeScenario";
import { createHttpError, loadEvaluationCriteria } from "../../routes/routerHelpers";
import { DEFAULT_DIMENSIONS } from "../evaluationEngine";

/** Management delegation is deliberately not considered learner membership. */
export async function resolveExecutionOrganization(user: any): Promise<string | null> {
  if (!user) throw createHttpError(401, "사용자를 확인할 수 없습니다");
  if (user.isActive === false) throw createHttpError(403, "비활성 사용자는 실행할 수 없습니다");
  const ids = Array.from(new Set([user.organizationId, user.assignedOrganizationId].filter(Boolean))) as string[];
  if (ids.length > 1) throw createHttpError(409, "조직 소속과 배정 조직이 다릅니다. 관리자가 소속을 확인해야 합니다");
  const id = ids[0] ?? null;
  if (!id) return null;
  const org = await storage.getOrganization(id);
  const company = org && await storage.getCompany(org.companyId);
  if (!org || !company || !org.isActive || !company.isActive) throw createHttpError(409, "비활성 또는 유효하지 않은 조직에는 새 실행을 적용할 수 없습니다");
  for (const companyId of [user.companyId, user.assignedCompanyId].filter(Boolean)) {
    if (companyId !== org.companyId) throw createHttpError(409, "회사와 조직 소속이 일치하지 않습니다");
  }
  if (user.assignedCategoryId) {
    const category = await storage.getCategory(user.assignedCategoryId);
    if (!category || (category.organizationId && category.organizationId !== id)) {
      throw createHttpError(409, "카테고리 배정과 조직 소속이 일치하지 않습니다");
    }
  }
  return id;
}

export async function assertOrganizationContentAccess(organizationId: string | null, scenario: any) {
  const category = scenario.categoryId ? await storage.getCategory(String(scenario.categoryId)) : null;
  const ownerIds = [scenario.organizationId, category?.organizationId].filter(Boolean);
  if (ownerIds.some(id => id !== organizationId)) throw createHttpError(403, "해당 조직에 사용 권한이 없는 조직 전용 콘텐츠입니다");
  if (scenario.isDeleted) throw createHttpError(410, "삭제된 시나리오입니다");
}

/** Returns a copy. Published/ContentX source objects are never modified. */
export async function loadOverrideBase(scenarioId: string, language = "ko") {
  const source = await storage.getScenario(scenarioId);
  if (!source) throw createHttpError(404, "시나리오를 찾을 수 없습니다");
  const version = await storage.getLatestPublishedVersion(scenarioId);
  if (source.contentxPackageId && !version) throw createHttpError(503, "게시 시나리오 스냅샷을 불러올 수 없습니다. 다시 시도하세요");
  const base: any = structuredClone(version?.contentSnapshot ?? source);
  if (version) {
    assertImportedSnapshotComplete(base);
    base.evaluationHarness = structuredClone(version.evaluationHarnessSnapshot ?? base.evaluationHarness ?? null);
  }
  if (!Object.prototype.hasOwnProperty.call(base, EVALUATION_CRITERIA_SNAPSHOT_KEY)) {
    base[EVALUATION_CRITERIA_SNAPSHOT_KEY] = await loadEvaluationCriteria(base, language as any) ?? {
      id: "builtin-default", name: "기본 평가기준", version: 1, dimensions: structuredClone(DEFAULT_DIMENSIONS),
    };
  }
  return { base, source, version };
}

export function buildOrganizationPreview(base: any, override: ScenarioOverrideData) {
  const dimensions = base[EVALUATION_CRITERIA_SNAPSHOT_KEY]?.dimensions ?? [];
  const resolved = resolveOverrideWeights(dimensions, override.evaluationWeights);
  const contextual = scenarioOverrideSchemaForDimensions(
    dimensions.filter((d: any) => d.isActive !== false).map((d: any) => d.key),
  ).safeParse(override);
  if (!contextual.success) {
    resolved.errors = Array.from(new Set([...resolved.errors, ...contextual.error.issues.map(issue => issue.message)]));
  }
  const defaults: ScenarioOverrideData = {
    terminology: base._terminology ?? {}, policyConstraints: base._policyConstraints ?? [],
    forbiddenPhrases: base._forbiddenPhrases ?? [], customIncidents: base._customIncidents ?? [],
    evaluationWeights: Object.fromEntries(resolved.dimensions.map(d => [d.key, d.baseWeight])),
  };
  return { base: defaults, override, effective: {
    terminology: { ...defaults.terminology, ...override.terminology },
    policyConstraints: [...(defaults.policyConstraints ?? []), ...(override.policyConstraints ?? [])],
    forbiddenPhrases: [...(defaults.forbiddenPhrases ?? []), ...(override.forbiddenPhrases ?? [])],
    customIncidents: [...(defaults.customIncidents ?? []), ...(override.customIncidents ?? [])],
    evaluationWeights: Object.fromEntries(resolved.dimensions.map(d => [d.key, d.weight])),
  }, ...resolved };
}

export async function captureOrganizationRunSnapshot(
  scenarioId: string, organizationId: string | null, language = "ko",
) {
  const { base, source, version } = await loadOverrideBase(scenarioId, language);
  await assertOrganizationContentAccess(organizationId, source);
  if (organizationId) {
    const org = await storage.getOrganization(organizationId);
    const company = org && await storage.getCompany(org.companyId);
    if (!org?.isActive || !company?.isActive) throw createHttpError(409, "비활성 조직에는 새 실행을 적용할 수 없습니다");
  }
  // Failure is never reinterpreted as an absent override; no provider has been called.
  let record;
  try {
    record = organizationId ? await storage.getScenarioOverrideByOrgAndScenario(organizationId, scenarioId) : null;
  } catch {
    throw createHttpError(503, "조직 설정을 불러오지 못했습니다. 다시 시도하세요. 유료 실행은 시작되지 않았습니다");
  }
  const parsed = scenarioOverrideDataSchema.safeParse(record?.override ?? {});
  if (!parsed.success) throw createHttpError(422, "저장된 조직 설정이 유효하지 않습니다. 관리자가 설정을 수정해야 합니다");
  const override = parsed.data;
  const preview = buildOrganizationPreview(base, override);
  if (preview.errors.length) throw createHttpError(422, preview.errors.join("; "));
  // Include only explicitly overridden weights in the patch. The resolver
  // retains default rubric weights for prompt-only/unconfigured runs.
  const effective = applyScenarioOverride(base, { ...preview.effective, evaluationWeights: override.evaluationWeights });
  effective.personas = await Promise.all((base.personas ?? []).map(async (actor: any) => {
    if (actor[RUNTIME_PERSONA_PROFILE_KEY]) return structuredClone(actor);
    if (version?.contentSnapshot) return { ...actor, [RUNTIME_PERSONA_PROFILE_KEY]: structuredClone(actor) };
    const ref = actor.mbti ?? actor.personaRef?.replace(/\.json$/i, "");
    const profile = ref ? await fileManager.getPersonaByMBTI(ref) : null;
    const media = ref ? await fileManager.getPersonaAvatarSettings(actor.personaRef ?? ref) : null;
    return { ...actor, [RUNTIME_PERSONA_PROFILE_KEY]: { ...(profile ?? actor), ...media } };
  }));
  effective[ORGANIZATION_OVERRIDE_KEY] = {
    organizationId, overrideId: record?.id ?? null, updatedAt: record?.updatedAt ?? null,
    capturedAt: new Date().toISOString(), override,
    dimensions: preview.dimensions,
    itemCount: Object.values(override).reduce((sum: number, items) => sum + Object.keys(items ?? {}).length, 0),
  };
  return { scenarioSnapshot: effective, evaluationHarnessSnapshot: effective.evaluationHarness ?? null,
    scenarioVersionId: version?.id ?? null };
}
