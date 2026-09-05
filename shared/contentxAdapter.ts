import type {
  InsertEvaluationCriteriaSet,
  InsertEvaluationDimension,
  InsertScenario,
} from "./schema";
import {
  assessmentScenarioPackageV1Schema,
  type AssessmentScenarioPackageV1,
} from "./schema/contentx";

export interface MappedContentXDimension {
  id: string;
  input: InsertEvaluationDimension & { id: string };
}

export interface MappedContentXScenario {
  sourceKey: string;
  categoryKey?: string;
  scenarioId: string;
  criteriaSetId: string;
  scenario: InsertScenario;
  criteriaSet: InsertEvaluationCriteriaSet & { id: string };
  dimensions: MappedContentXDimension[];
}

export interface MappedContentXPackage {
  packageKey: string;
  packageVersion: string;
  publishedAt: string;
  provenance: AssessmentScenarioPackageV1["provenance"];
  scenarios: MappedContentXScenario[];
}

function stableId(kind: string, ...parts: string[]): string {
  const source = [kind, ...parts].join("\u001f");
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    first = Math.imul(first ^ source.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ source.charCodeAt(index), 0x85ebca6b);
  }
  const digest = `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
  return `contentx_${kind}_${digest}`;
}

export function mapAssessmentScenarioPackageV1(input: AssessmentScenarioPackageV1): MappedContentXPackage {
  const pkg = assessmentScenarioPackageV1Schema.parse(input);
  return {
    packageKey: pkg.packageKey,
    packageVersion: pkg.version,
    publishedAt: pkg.publishedAt,
    provenance: pkg.provenance,
    scenarios: pkg.scenarios.map(source => {
      const identityParts = [pkg.provenance.sourcePackageId, pkg.version, source.key];
      const scenarioId = stableId("scenario", ...identityParts);
      const criteriaSetId = stableId("criteria", ...identityParts);
      const personaIndex = new Map(source.personas.map((persona, index) => [persona.key, index]));
      const evaluationHarness = {
        dimensions: source.evaluation.dimensions.map(dimension => ({
          key: dimension.key,
          weight: dimension.weight,
          scenarioSpecificDefinition: dimension.scenarioSpecificDefinition,
          positiveSignals: dimension.positiveSignals,
          negativeSignals: dimension.negativeSignals,
        })),
        passingRule: {
          minAverageScore: source.evaluation.passThreshold,
          requiredDimensions: source.evaluation.requiredDimensions,
        },
      };
      const scenario: InsertScenario = {
        id: scenarioId,
        title: source.title,
        description: source.description,
        sourceLocale: source.locale,
        difficulty: source.difficulty,
        estimatedTime: source.estimatedTime ?? `${source.targetDurationMinutes} minutes`,
        skills: source.competencies,
        categoryId: null,
        objectiveType: source.objectiveType ?? null,
        context: source.context,
        objectives: source.objectives,
        successCriteria: source.successCriteria,
        personas: source.personas.map(persona => ({
          id: stableId("persona", ...identityParts, persona.key),
          name: persona.name,
          department: persona.department,
          position: persona.position,
          experience: persona.experience,
          personaRef: persona.personaRef,
          stance: persona.stance,
          goal: persona.goal,
          tradeoff: persona.tradeoff,
          gender: persona.gender,
          mbti: persona.mbti,
          isPrimary: persona.primary,
          triggerHints: persona.triggerHints,
          entryLine: persona.entryLine,
          voiceId: persona.voiceId,
          npcBehaviorHarness: persona.npcBehavior,
        })),
        recommendedFlow: source.recommendedFlow,
        flowGraph: source.flow ? {
          stages: source.flow.stages.map(stage => ({
            id: stage.key,
            goal: stage.goal,
            exitConditions: stage.exitConditions,
            exitConditionsLogic: stage.exitConditionsLogic,
            nextStage: stage.nextStageKey,
          })),
        } : null,
        personaSwitchRules: source.personaSwitches.length ? {
          rules: source.personaSwitches.map(rule => ({
            id: rule.key,
            targetPersonaIndex: personaIndex.get(rule.targetPersonaKey)!,
            conditions: rule.conditions,
            reason: rule.reason,
            lockAfterSwitch: rule.lockAfterSwitch,
          })),
        } : null,
        evaluationCriteriaSetId: criteriaSetId,
        targetDurationMinutes: source.targetDurationMinutes,
        targetTurns: source.targetTurns,
        minValidTurns: source.minValidTurns,
        evaluationHarness,
        terminationRules: source.termination ?? null,
        playerConstraints: source.constraints,
        difficultyProfile: source.difficultyProfile ?? { passThreshold: source.evaluation.passThreshold },
        personaSwitchMode: source.personaSwitchMode,
        simulationHarness: source.simulation ?? null,
        analyticsSpec: source.analytics ?? null,
        isDemo: false,
        isPublic: false,
        storeListed: false,
        useVideoAvatar: false,
      };
      const criteriaSet: InsertEvaluationCriteriaSet & { id: string } = {
        id: criteriaSetId,
        name: source.evaluation.name,
        description: source.evaluation.description ?? null,
        isDefault: false,
        isActive: true,
        status: "approved",
        version: 1,
      };
      const dimensions = source.evaluation.dimensions.map((dimension, displayOrder) => {
        const dimensionId = stableId("dimension", ...identityParts, dimension.key);
        return {
          id: dimensionId,
          input: {
            id: dimensionId,
            criteriaSetId,
            key: dimension.key,
            name: dimension.name,
            description: dimension.description ?? dimension.scenarioSpecificDefinition ?? null,
            icon: dimension.icon ?? "📊",
            color: dimension.color ?? "blue",
            weight: dimension.weight * 10,
            dimensionType: "standard",
            minScore: dimension.minScore,
            maxScore: dimension.maxScore,
            evaluationPrompt: dimension.evaluationPrompt ?? null,
            displayOrder,
            isActive: true,
          },
        };
      });
      return { sourceKey: source.key, categoryKey: source.categoryKey, scenarioId, criteriaSetId, scenario, criteriaSet, dimensions };
    }),
  };
}

export function parseAndMapAssessmentScenarioPackageV1(input: unknown): MappedContentXPackage {
  return mapAssessmentScenarioPackageV1(assessmentScenarioPackageV1Schema.parse(input));
}