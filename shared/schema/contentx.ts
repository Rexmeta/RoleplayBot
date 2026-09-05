import { z } from "zod";
import {
  evaluationHarnessDimensionSchema,
  REPORT_SECTIONS,
  TRACKED_METRICS,
} from "./scenarios";

const keySchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/, "Must be a lowercase ContentX key");
const boundedText = z.string().trim().min(1).max(4_000);
const shortText = z.string().trim().min(1).max(200);
const conditionOperatorSchema = z.enum(["gte", "lte", "gt", "lt", "eq"]);

const strictPlayerConstraintsSchema = z.object({
  authorityLevel: shortText.optional(),
  canOffer: z.array(shortText).max(50).optional(),
  cannotOffer: z.array(shortText).max(50).optional(),
  requiredBehaviors: z.array(shortText).max(50).optional(),
  forbiddenBehaviors: z.array(shortText).max(50).optional(),
}).strict();

const strictDifficultyProfileSchema = z.object({
  npcPatience: z.number().min(1).max(10).optional(),
  hintFrequency: z.number().min(0).max(1).optional(),
  incidentProbability: z.number().min(0).max(2).optional(),
  passThreshold: z.number().min(0).max(100).optional(),
}).strict();

const stateConditionSchema = z.object({
  operator: conditionOperatorSchema,
  value: z.number().finite(),
}).strict();

const terminationConditionSchema = z.object({
  cognitive: z.object({
    confusion: stateConditionSchema.optional(),
    load: stateConditionSchema.optional(),
  }).strict().optional(),
  relational: z.object({
    trust: stateConditionSchema.optional(),
    rapport: stateConditionSchema.optional(),
  }).strict().optional(),
  motivational: z.object({
    interest: stateConditionSchema.optional(),
    cooperativeness: stateConditionSchema.optional(),
  }).strict().optional(),
  currentScore: stateConditionSchema.optional(),
  stage: shortText.optional(),
  totalTurns: stateConditionSchema.optional(),
  consecutiveTurnsBelow: z.object({
    scoreThreshold: z.number().finite(),
    turns: z.number().int().positive().max(500),
  }).strict().optional(),
  logic: z.enum(["all", "any"]).optional(),
}).strict();

const strictTerminationRulesSchema = z.object({
  success: terminationConditionSchema.optional(),
  failure: terminationConditionSchema.optional(),
  timeout: z.object({
    maxTurns: z.number().int().positive().max(500).optional(),
    maxTimeSec: z.number().positive().max(86_400).optional(),
  }).strict().optional(),
}).strict();

const cooldownSchema = z.object({
  globalCooldownSec: z.number().min(0).max(86_400).optional(),
  perTypeCooldownSec: z.number().min(0).max(86_400).optional(),
}).strict();

const strictSimulationHarnessSchema = z.object({
  affectiveAxes: z.array(shortText).max(30).optional(),
  toolPolicy: z.object({
    npcAffectiveStateDelta: z.object({
      maxCallsPerTurn: z.number().int().min(1).max(10).optional(),
      maxDeltaPerCall: z.number().min(1).max(100).optional(),
    }).strict().optional(),
    triggerIncident: z.object({
      allowedTypes: z.array(shortText).max(50).optional(),
      cooldownOverride: cooldownSchema.optional(),
      cooldowns: z.record(shortText, cooldownSchema).optional(),
    }).strict().optional(),
    updateScenarioState: z.object({
      enabled: z.boolean().optional(),
    }).strict().optional(),
  }).strict().optional(),
  preferredSignals: z.record(shortText, shortText).optional(),
}).strict();

const strictAnalyticsSpecSchema = z.object({
  trackedMetrics: z.array(z.enum(TRACKED_METRICS)).max(TRACKED_METRICS.length).optional(),
  reportSections: z.array(z.enum(REPORT_SECTIONS)).max(REPORT_SECTIONS.length).optional(),
  benchmarkGroup: shortText.optional(),
}).strict();

export const contentXPersonaV1Schema = z.object({
  key: keySchema,
  name: shortText,
  department: shortText,
  position: shortText,
  experience: shortText,
  personaRef: shortText,
  stance: boundedText,
  goal: boundedText,
  tradeoff: boundedText,
  gender: shortText.optional(),
  mbti: shortText.optional(),
  primary: z.boolean(),
  triggerHints: z.array(shortText).max(20).optional(),
  entryLine: boundedText.optional(),
  voiceId: shortText.nullable().optional(),
  npcBehavior: z.object({
    negotiationBounds: z.object({
      minRelationalTrustToYield: z.number().min(0).max(100).optional(),
      maxAffectiveIntensityBeforeWalkout: z.number().min(0).max(100).optional(),
      maxPatienceTurns: z.number().int().positive().max(100).optional(),
    }).strict().optional(),
    trustTriggers: z.array(z.object({
      keyword: shortText,
      relationalTrustDelta: z.number().min(-100).max(100).optional(),
      affectiveIntensityDelta: z.number().min(-100).max(100).optional(),
      description: boundedText.optional(),
    }).strict()).max(50).optional(),
    escalationTriggers: z.array(z.object({
      keyword: shortText,
      relationalTrustDelta: z.number().min(-100).max(100).optional(),
      affectiveIntensityDelta: z.number().min(-100).max(100).optional(),
      description: boundedText.optional(),
    }).strict()).max(50).optional(),
  }).strict().optional(),
}).strict();

const flowStageSchema = z.object({
  key: keySchema,
  goal: boundedText,
  exitConditions: z.array(z.object({
    type: z.enum(["turn_count", "turn_score", "npc_emotion"]),
    metric: shortText.optional(),
    operator: z.enum(["gte", "lte", "gt", "lt", "eq"]),
    value: z.number().finite(),
    windowTurns: z.number().int().positive().max(100).optional(),
  }).strict()).max(20),
  exitConditionsLogic: z.enum(["all", "any"]).optional(),
  nextStageKey: z.union([keySchema, z.literal("end")]),
}).strict();

const personaSwitchSchema = z.object({
  key: keySchema,
  targetPersonaKey: keySchema,
  conditions: z.array(z.object({
    metric: shortText,
    operator: z.enum(["gte", "lte", "gt", "lt", "eq"]),
    value: z.number().finite(),
    consecutiveTurns: z.number().int().positive().max(100).optional(),
  }).strict()).min(1).max(20),
  reason: boundedText,
  lockAfterSwitch: z.boolean().optional(),
}).strict();

const evaluationSchema = z.object({
  name: shortText,
  description: boundedText.optional(),
  passThreshold: z.number().min(0).max(100),
  dimensions: z.array(evaluationHarnessDimensionSchema.extend({
    name: shortText,
    description: boundedText.optional(),
    icon: shortText.optional(),
    color: shortText.optional(),
    minScore: z.number().int().min(0).max(100).default(1),
    maxScore: z.number().int().min(1).max(100).default(10),
    evaluationPrompt: boundedText.optional(),
  }).strict()).min(1).max(20),
  requiredDimensions: z.array(z.object({
    key: z.enum(["clarity", "empathy", "logic", "ownership", "actionPlan"]),
    minScore: z.number().min(0).max(100),
  }).strict()).max(20).optional(),
}).strict();

export const contentXScenarioV1Schema = z.object({
  key: keySchema,
  title: shortText,
  description: boundedText,
  locale: z.string().min(2).max(10),
  categoryKey: keySchema.optional(),
  competencies: z.array(keySchema).min(1).max(30),
  difficulty: z.number().int().min(1).max(10),
  estimatedTime: shortText.optional(),
  objectiveType: shortText.optional(),
  context: z.object({
    situation: boundedText,
    timeline: boundedText,
    stakes: boundedText,
    playerRole: z.object({
      position: shortText,
      department: shortText,
      experience: shortText,
      responsibility: boundedText,
    }).strict(),
  }).strict(),
  objectives: z.array(boundedText).min(1).max(30),
  successCriteria: z.object({
    optimal: boundedText,
    good: boundedText,
    acceptable: boundedText,
    failure: boundedText,
  }).strict(),
  personas: z.array(contentXPersonaV1Schema).min(1).max(20),
  recommendedFlow: z.array(boundedText).max(30).default([]),
  flow: z.object({ stages: z.array(flowStageSchema).min(1).max(50) }).strict().optional(),
  personaSwitches: z.array(personaSwitchSchema).max(30).default([]),
  personaSwitchMode: z.enum(["replace", "join", "none"]).default("none"),
  constraints: strictPlayerConstraintsSchema,
  difficultyProfile: strictDifficultyProfileSchema.optional(),
  evaluation: evaluationSchema,
  termination: strictTerminationRulesSchema.optional(),
  simulation: strictSimulationHarnessSchema.optional(),
  analytics: strictAnalyticsSpecSchema.optional(),
  targetDurationMinutes: z.number().int().positive().max(240),
  targetTurns: z.number().int().positive().max(500),
  minValidTurns: z.number().int().positive().max(500),
}).strict().superRefine((scenario, ctx) => {
  const addDuplicateIssues = (values: string[], path: (string | number)[], label: string) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, index, "key"], message: `Duplicate ${label} key: ${value}` });
      seen.add(value);
    });
  };
  addDuplicateIssues(scenario.personas.map(persona => persona.key), ["personas"], "persona");
  if (scenario.flow) addDuplicateIssues(scenario.flow.stages.map(stage => stage.key), ["flow", "stages"], "flow stage");
  const primaryCount = scenario.personas.filter(persona => persona.primary).length;
  if (primaryCount !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["personas"], message: "Exactly one persona must be primary" });
  if (scenario.minValidTurns > scenario.targetTurns) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minValidTurns"], message: "minValidTurns cannot exceed targetTurns" });

  const personaKeys = new Set(scenario.personas.map(persona => persona.key));
  scenario.personaSwitches.forEach((rule, index) => {
    if (!personaKeys.has(rule.targetPersonaKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["personaSwitches", index, "targetPersonaKey"], message: `Unknown persona key: ${rule.targetPersonaKey}` });
  });
  if (scenario.flow) {
    const stageKeys = new Set(scenario.flow.stages.map(stage => stage.key));
    scenario.flow.stages.forEach((stage, index) => {
      if (stage.nextStageKey !== "end" && !stageKeys.has(stage.nextStageKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["flow", "stages", index, "nextStageKey"], message: `Unknown flow stage key: ${stage.nextStageKey}` });
    });
  }
  const dimensionKeys = scenario.evaluation.dimensions.map(dimension => dimension.key);
  if (new Set(dimensionKeys).size !== dimensionKeys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluation", "dimensions"], message: "Evaluation dimension keys must be unique" });
  const knownDimensionKeys = new Set(dimensionKeys);
  const requiredDimensionKeys = scenario.evaluation.requiredDimensions?.map(dimension => dimension.key) ?? [];
  if (new Set(requiredDimensionKeys).size !== requiredDimensionKeys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluation", "requiredDimensions"], message: "Required evaluation dimension keys must be unique" });
  scenario.evaluation.requiredDimensions?.forEach((dimension, index) => {
    if (!knownDimensionKeys.has(dimension.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluation", "requiredDimensions", index, "key"], message: `Required dimension is not configured: ${dimension.key}` });
  });
  const totalWeight = scenario.evaluation.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (Math.abs(totalWeight - 10) > 0.001) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluation", "dimensions"], message: `Evaluation weights must total 10; received ${totalWeight}` });
  scenario.evaluation.dimensions.forEach((dimension, index) => {
    if (dimension.minScore >= dimension.maxScore) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evaluation", "dimensions", index], message: "minScore must be less than maxScore" });
  });
  if (scenario.personaSwitchMode === "none" && scenario.personaSwitches.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["personaSwitchMode"], message: "personaSwitchMode cannot be none when persona switches are configured" });
});

export const assessmentScenarioPackageV1Schema = z.object({
  schemaVersion: z.literal("1.0", {
    errorMap: () => ({ message: "Unsupported schemaVersion; expected 1.0" }),
  }),
  packageKey: keySchema,
  version: z.string().min(1).max(40).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "Must be a semantic version"),
  publishedAt: z.string().datetime({ offset: true }),
  metadata: z.object({
    title: shortText,
    description: boundedText,
    locale: z.string().min(2).max(10),
    tags: z.array(shortText).max(30).default([]),
  }).strict(),
  competencies: z.array(z.object({
    key: keySchema,
    name: shortText,
    description: boundedText,
  }).strict()).min(1).max(100),
  scenarios: z.array(contentXScenarioV1Schema).min(1).max(100),
  provenance: z.object({
    source: z.literal("ContentX"),
    sourcePackageId: shortText,
    author: shortText.optional(),
    contentHash: z.string().min(16).max(128),
  }).strict(),
}).strict().superRefine((pkg, ctx) => {
  const scenarioKeys = pkg.scenarios.map(scenario => scenario.key);
  if (new Set(scenarioKeys).size !== scenarioKeys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarios"], message: "Scenario keys must be unique" });
  const competencyKeys = pkg.competencies.map(item => item.key);
  if (new Set(competencyKeys).size !== competencyKeys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["competencies"], message: "Competency keys must be unique" });
  const knownCompetencies = new Set(competencyKeys);
  pkg.scenarios.forEach((scenario, scenarioIndex) => scenario.competencies.forEach((key, index) => {
    if (!knownCompetencies.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scenarios", scenarioIndex, "competencies", index], message: `Unknown competency key: ${key}` });
  }));
});

export type AssessmentScenarioPackageV1 = z.infer<typeof assessmentScenarioPackageV1Schema>;
export type ContentXScenarioV1 = z.infer<typeof contentXScenarioV1Schema>;
export type ContentXPersonaV1 = z.infer<typeof contentXPersonaV1Schema>;