import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  evaluationCriteriaSets,
  evaluationDimensions,
  scenarios,
  scenarioVersions,
  type Scenario,
  type ScenarioVersion,
} from "@shared/schema";
import type { MappedContentXPackage } from "@shared/contentxAdapter";
import { db } from "./db";
import { RUNTIME_PERSONA_PROFILE_KEY } from "../services/runtimeScenario";

const SUPPORTED_MBTI_TYPES = new Set([
  "istj", "isfj", "infj", "intj", "istp", "isfp", "infp", "intp",
  "estp", "esfp", "enfp", "entp", "estj", "esfj", "enfj", "entj",
]);

async function loadPublishedPersonaProfile(personaRef: string): Promise<Record<string, any>> {
  const mbtiType = personaRef.toLowerCase().replace(/\.json$/, "");
  if (!SUPPORTED_MBTI_TYPES.has(mbtiType)) {
    throw new Error(`ContentX personaRef cannot be resolved: ${personaRef}`);
  }
  const content = await readFile(join(process.cwd(), "personas", `${mbtiType}.json`), "utf8");
  return JSON.parse(content) as Record<string, any>;
}

export interface ContentXImportScenarioResult {
  sourceScenarioKey: string;
  scenarioId: string;
  criteriaSetId: string;
  scenarioVersionId: string;
}

export interface ContentXImportResult {
  sourcePackageId: string;
  contentVersion: string;
  imported: boolean;
  scenarios: ContentXImportScenarioResult[];
}

export interface ContentXImportInput {
  organizationId: string;
  categoryId: string;
  package: MappedContentXPackage;
  sourceContentDigest: string;
  publishedBy?: string | null;
}

export class ContentXImportConflictError extends Error {
  readonly code = "CONTENTX_VERSION_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ContentXImportConflictError";
  }
}

export interface IContentXImportsStorage {
  findContentXScenarios(
    organizationId: string,
    sourcePackageId: string,
    contentVersion: string,
  ): Promise<Scenario[]>;
  importContentXPackage(input: ContentXImportInput): Promise<ContentXImportResult>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

function toResult(
  sourcePackageId: string,
  contentVersion: string,
  imported: boolean,
  rows: Array<{ scenario: Scenario; version: ScenarioVersion }>,
): ContentXImportResult {
  return {
    sourcePackageId,
    contentVersion,
    imported,
    scenarios: rows.map(({ scenario, version }) => ({
      sourceScenarioKey: scenario.contentxScenarioKey!,
      scenarioId: scenario.id,
      criteriaSetId: scenario.evaluationCriteriaSetId!,
      scenarioVersionId: version.id,
    })),
  };
}

export function ContentXImportsMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IContentXImportsStorage {
    async findContentXScenarios(
      organizationId: string,
      sourcePackageId: string,
      contentVersion: string,
    ): Promise<Scenario[]> {
      return db.select().from(scenarios).where(and(
        eq(scenarios.organizationId, organizationId),
        eq(scenarios.contentxPackageId, sourcePackageId),
        eq(scenarios.contentxVersion, contentVersion),
      )).orderBy(asc(scenarios.contentxScenarioKey));
    }

    async importContentXPackage(input: ContentXImportInput): Promise<ContentXImportResult> {
      const sourcePackageId = input.package.provenance.sourcePackageId;
      const contentVersion = input.package.packageVersion;
      const contentHash = input.sourceContentDigest;
      const publishedAt = new Date(input.package.publishedAt);

      if (Number.isNaN(publishedAt.getTime())) {
        throw new Error("ContentX package publishedAt is invalid");
      }

      return db.transaction(async tx => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtext(${`${input.organizationId}\u001f${sourcePackageId}\u001f${contentVersion}`})
          )
        `);

        const existing = await tx.select().from(scenarios).where(and(
          eq(scenarios.organizationId, input.organizationId),
          eq(scenarios.contentxPackageId, sourcePackageId),
          eq(scenarios.contentxVersion, contentVersion),
        )).orderBy(asc(scenarios.contentxScenarioKey));

        if (existing.length > 0) {
          const requestedKeys = [...input.package.scenarios.map(item => item.sourceKey)].sort();
          const existingKeys = existing.map(item => item.contentxScenarioKey!).sort();
          const exactIdentity = requestedKeys.length === existingKeys.length
            && requestedKeys.every((key, index) => key === existingKeys[index]);
          const exactContent = existing.every(item => item.contentxContentHash === contentHash);
          const exactTarget = existing.every(item => item.categoryId === input.categoryId);

          if (!exactIdentity || !exactContent || !exactTarget) {
            throw new ContentXImportConflictError(
              `ContentX package ${sourcePackageId}@${contentVersion} was already imported with different content`,
            );
          }

          const rows = await Promise.all(existing.map(async scenario => {
            const [version] = await tx.select().from(scenarioVersions)
              .where(and(
                eq(scenarioVersions.scenarioId, scenario.id),
                eq(scenarioVersions.status, "published"),
              ))
              .orderBy(asc(scenarioVersions.version))
              .limit(1);
            if (!version) {
              throw new ContentXImportConflictError(
                `ContentX scenario ${scenario.contentxScenarioKey} is missing its published snapshot`,
              );
            }
            return { scenario, version };
          }));
          return toResult(sourcePackageId, contentVersion, false, rows);
        }

        const created: Array<{ scenario: Scenario; version: ScenarioVersion }> = [];
        for (const mapped of input.package.scenarios) {
          const criteriaSetId = randomUUID();
          const scenarioId = randomUUID();

          await tx.insert(evaluationCriteriaSets).values({
            ...mapped.criteriaSet,
            id: criteriaSetId,
            categoryId: input.categoryId,
            approvedBy: input.publishedBy ?? null,
            approvedAt: publishedAt,
          } as any);

          if (mapped.dimensions.length > 0) {
            await tx.insert(evaluationDimensions).values(mapped.dimensions.map(dimension => ({
              ...dimension.input,
              id: randomUUID(),
              criteriaSetId,
            })) as any);
          }

          const [scenario] = await tx.insert(scenarios).values({
            ...mapped.scenario,
            id: scenarioId,
            organizationId: input.organizationId,
            categoryId: input.categoryId,
            evaluationCriteriaSetId: criteriaSetId,
            contentxPackageId: sourcePackageId,
            contentxVersion: contentVersion,
            contentxScenarioKey: mapped.sourceKey,
            contentxPublishedAt: publishedAt,
            contentxContentHash: contentHash,
          } as any).returning();

          const publishedPersonas = await Promise.all(
            ((scenario.personas as any[]) ?? []).map(async persona => ({
              ...persona,
              [RUNTIME_PERSONA_PROFILE_KEY]: await loadPublishedPersonaProfile(persona.personaRef),
            })),
          );

          const [version] = await tx.insert(scenarioVersions).values({
            scenarioId,
            version: 1,
            status: "published",
            contentSnapshot: {
              ...scenario,
              personas: publishedPersonas,
              _evaluationCriteriaSnapshot: {
                ...mapped.criteriaSet,
                id: criteriaSetId,
                dimensions: mapped.dimensions.map(dimension => ({
                  ...dimension.input,
                  criteriaSetId,
                })),
              },
            },
            evaluationHarnessSnapshot: scenario.evaluationHarness ?? null,
            publishedAt,
            publishedBy: input.publishedBy ?? null,
          } as any).returning();

          created.push({ scenario, version });
        }

        return toResult(sourcePackageId, contentVersion, true, created);
      });
    }
  };
}

export class MemContentXImportsStorage implements IContentXImportsStorage {
  async findContentXScenarios(_: string, __: string, ___: string): Promise<Scenario[]> { return []; }
  async importContentXPackage(_: ContentXImportInput): Promise<ContentXImportResult> {
    throw new Error("Not implemented in MemStorage");
  }
}