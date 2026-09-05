import { describe, expect, it } from "vitest";
import { assessmentScenarioPackageV1Schema, type AssessmentScenarioPackageV1 } from "../../shared/schema/contentx";
import { mapAssessmentScenarioPackageV1, parseAndMapAssessmentScenarioPackageV1 } from "../../shared/contentxAdapter";

function validPackage(): AssessmentScenarioPackageV1 {
  return {
    schemaVersion: "1.0",
    packageKey: "sales-core",
    version: "1.2.0",
    publishedAt: "2026-09-05T12:00:00Z",
    metadata: { title: "Sales Core", description: "Core scenarios", locale: "en", tags: ["sales"] },
    competencies: [{ key: "empathy", name: "Empathy", description: "Understand the customer" }],
    provenance: { source: "ContentX", sourcePackageId: "cx-pkg-42", contentHash: "0123456789abcdef" },
    scenarios: [{
      key: "renewal",
      title: "Renewal conversation",
      description: "Retain an unhappy customer",
      locale: "en",
      competencies: ["empathy"],
      difficulty: 6,
      context: {
        situation: "The account may churn",
        timeline: "Renewal is tomorrow",
        stakes: "Annual contract",
        playerRole: { position: "Manager", department: "Success", experience: "Senior", responsibility: "Retain account" },
      },
      objectives: ["Find a workable resolution"],
      successCriteria: { optimal: "Renewed", good: "Follow-up", acceptable: "Understood", failure: "Churned" },
      personas: [
        { key: "buyer", name: "Alex", department: "Finance", position: "Buyer", experience: "10 years", personaRef: "analyst", stance: "Skeptical", goal: "Reduce risk", tradeoff: "Can accept phased rollout", primary: true },
        { key: "legal", name: "Sam", department: "Legal", position: "Counsel", experience: "8 years", personaRef: "guardian", stance: "Cautious", goal: "Limit liability", tradeoff: "Can accept capped terms", primary: false },
      ],
      recommendedFlow: ["Discover", "Resolve"],
      flow: { stages: [
        { key: "discover", goal: "Understand", exitConditions: [{ type: "turn_count", operator: "gte", value: 2 }], nextStageKey: "resolve" },
        { key: "resolve", goal: "Agree", exitConditions: [], nextStageKey: "end" },
      ] },
      personaSwitches: [{ key: "legal-joins", targetPersonaKey: "legal", conditions: [{ metric: "totalTurns", operator: "gte", value: 3 }], reason: "Review terms" }],
      personaSwitchMode: "join",
      constraints: { authorityLevel: "manager", cannotOffer: ["Unlimited liability"] },
      evaluation: {
        name: "Renewal rubric",
        passThreshold: 70,
        dimensions: [
          { key: "empathy", name: "Empathy", weight: 6, minScore: 1, maxScore: 10, positiveSignals: ["Acknowledges concern"] },
          { key: "clarity", name: "Clarity", weight: 4, minScore: 1, maxScore: 10 },
        ],
        requiredDimensions: [{ key: "empathy", minScore: 60 }],
      },
      simulation: { affectiveAxes: ["intensity"] },
      analytics: { trackedMetrics: ["totalTurns"], reportSections: ["scoreOverview"] },
      termination: { timeout: { maxTurns: 20, maxTimeSec: 900 } },
      targetDurationMinutes: 15,
      targetTurns: 12,
      minValidTurns: 4,
    }],
  };
}

describe("AssessmentScenarioPackage v1", () => {
  it("parses a complete package", () => {
    expect(assessmentScenarioPackageV1Schema.parse(validPackage()).schemaVersion).toBe("1.0");
  });

  it("rejects unsupported versions, missing fields, and malformed nested values", () => {
    expect(() => assessmentScenarioPackageV1Schema.parse({ ...validPackage(), schemaVersion: "2.0" })).toThrow(/Unsupported schemaVersion/);
    const missing = validPackage() as unknown as Record<string, unknown>;
    delete missing.provenance;
    expect(() => assessmentScenarioPackageV1Schema.parse(missing)).toThrow(/Required/);
    const malformed = validPackage();
    malformed.scenarios[0].difficulty = 99;
    expect(() => assessmentScenarioPackageV1Schema.parse(malformed)).toThrow(/less than or equal to 10/);
  });

  it("rejects duplicate and dangling scenario relationships", () => {
    const duplicate = validPackage();
    duplicate.scenarios.push(structuredClone(duplicate.scenarios[0]));
    expect(() => assessmentScenarioPackageV1Schema.parse(duplicate)).toThrow(/Scenario keys must be unique/);
    const danglingPersona = validPackage();
    danglingPersona.scenarios[0].personaSwitches[0].targetPersonaKey = "missing";
    expect(() => assessmentScenarioPackageV1Schema.parse(danglingPersona)).toThrow(/Unknown persona key/);
    const danglingFlow = validPackage();
    danglingFlow.scenarios[0].flow!.stages[0].nextStageKey = "missing";
    expect(() => assessmentScenarioPackageV1Schema.parse(danglingFlow)).toThrow(/Unknown flow stage key/);
  });

  it("rejects inconsistent evaluation weights", () => {
    const pkg = validPackage();
    pkg.scenarios[0].evaluation.dimensions[0].weight = 50;
    expect(() => assessmentScenarioPackageV1Schema.parse(pkg)).toThrow(/must total 10/);
  });

  it("rejects invalid evaluation references and incompatible switch configuration", () => {
    const unknownDimension = validPackage();
    unknownDimension.scenarios[0].evaluation.requiredDimensions = [{ key: "logic", minScore: 60 }];
    expect(() => assessmentScenarioPackageV1Schema.parse(unknownDimension)).toThrow(/Required dimension is not configured/);
    const disabledSwitches = validPackage();
    disabledSwitches.scenarios[0].personaSwitchMode = "none";
    expect(() => assessmentScenarioPackageV1Schema.parse(disabledSwitches)).toThrow(/cannot be none/);
  });

  it("rejects unknown fields inside reused runtime-shaped objects", () => {
    const pkg = validPackage();
    (pkg.scenarios[0].constraints as Record<string, unknown>).unexpected = true;
    expect(() => assessmentScenarioPackageV1Schema.parse(pkg)).toThrow(/Unrecognized key/);
    const nested = validPackage();
    (nested.scenarios[0].termination!.timeout as Record<string, unknown>).unexpected = true;
    expect(() => assessmentScenarioPackageV1Schema.parse(nested)).toThrow(/Unrecognized key/);
  });

  it("maps scenario, personas, flow, constraints, simulation and evaluation inputs", () => {
    const mapped = parseAndMapAssessmentScenarioPackageV1(validPackage()).scenarios[0];
    expect(mapped.scenario.id).toBe(mapped.scenarioId);
    expect(mapped.scenario.personas?.[0]).toMatchObject({ name: "Alex", isPrimary: true });
    expect(mapped.scenario.flowGraph?.stages[0]).toMatchObject({ id: "discover", nextStage: "resolve" });
    expect(mapped.scenario.personaSwitchRules?.rules[0].targetPersonaIndex).toBe(1);
    expect(mapped.scenario.playerConstraints).toEqual({ authorityLevel: "manager", cannotOffer: ["Unlimited liability"] });
    expect(mapped.scenario.simulationHarness).toEqual({ affectiveAxes: ["intensity"] });
    expect(mapped.scenario.analyticsSpec).toEqual({ trackedMetrics: ["totalTurns"], reportSections: ["scoreOverview"] });
    expect(mapped.scenario.terminationRules).toEqual({ timeout: { maxTurns: 20, maxTimeSec: 900 } });
    expect(mapped.criteriaSet).toMatchObject({ name: "Renewal rubric", status: "approved", isActive: true });
    expect(mapped.criteriaSet.id).toBe(mapped.criteriaSetId);
    expect(mapped.dimensions).toHaveLength(2);
    expect(mapped.dimensions[0].input).toMatchObject({ id: mapped.dimensions[0].id, criteriaSetId: mapped.criteriaSet.id, key: "empathy", weight: 60 });
  });

  it("is deterministic and uses source-derived stable identities", () => {
    const pkg = validPackage();
    const first = mapAssessmentScenarioPackageV1(pkg);
    const second = mapAssessmentScenarioPackageV1(structuredClone(pkg));
    expect(second).toEqual(first);
    expect(first.scenarios[0].scenarioId).toMatch(/^contentx_scenario_/);
    expect(first.scenarios[0].dimensions[0].id).toMatch(/^contentx_dimension_/);
    const nextVersion = structuredClone(pkg);
    nextVersion.version = "1.3.0";
    expect(mapAssessmentScenarioPackageV1(nextVersion).scenarios[0].scenarioId).not.toBe(first.scenarios[0].scenarioId);
  });
});