import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MappedContentXPackage } from "../../shared/contentxAdapter";

const mockState = vi.hoisted(() => ({
  existing: [] as any[],
  versions: [] as any[],
  inserted: [] as Array<{ values: any }>,
  failAtInsert: 0,
  insertCalls: 0,
}));

vi.mock("../../server/storage/db", () => {
  function chain(rows: any[]) {
    const value: any = {
      from: vi.fn(() => value),
      where: vi.fn(() => value),
      orderBy: vi.fn(() => value),
      limit: vi.fn(() => value),
      then(resolve: (rows: any[]) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return value;
  }

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(() => {
      const rows = tx.select.mock.calls.length === 1
        ? mockState.existing
        : [mockState.versions[tx.select.mock.calls.length - 2]];
      return chain(rows.filter(Boolean));
    }),
    insert: vi.fn(() => {
      const insertChain: any = {
        values: vi.fn((values: any) => {
          mockState.insertCalls += 1;
          if (mockState.failAtInsert === mockState.insertCalls) {
            throw new Error("forced insert failure");
          }
          mockState.inserted.push({ values });
          insertChain.current = values;
          return insertChain;
        }),
        returning: vi.fn(() => {
          const input = insertChain.current;
          const isVersion = "contentSnapshot" in input;
          return Promise.resolve([isVersion
            ? { ...input, id: "version-new" }
            : {
              isDeleted: false,
              deletedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...input,
            }]);
        }),
      };
      return insertChain;
    }),
  };

  return {
    db: {
      transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
      select: vi.fn(),
    },
  };
});

import {
  ContentXImportConflictError,
  ContentXImportsMixin,
} from "../../server/storage/contentxImports";

const Storage = ContentXImportsMixin(class {});

function mappedPackage(hash = "0123456789abcdef"): MappedContentXPackage {
  return {
    packageKey: "sales",
    packageVersion: "1.0.0",
    publishedAt: "2026-09-05T12:00:00Z",
    provenance: {
      source: "ContentX",
      sourcePackageId: "package-1",
      contentHash: hash,
    },
    scenarios: [{
      sourceKey: "renewal",
      scenarioId: "mapped-scenario",
      criteriaSetId: "mapped-criteria",
      scenario: {
        id: "mapped-scenario",
        title: "Renewal",
        description: "Handle renewal",
        evaluationCriteriaSetId: "mapped-criteria",
      },
      criteriaSet: {
        id: "mapped-criteria",
        name: "Renewal rubric",
        status: "approved",
      },
      dimensions: [{
        id: "mapped-dimension",
        input: {
          id: "mapped-dimension",
          criteriaSetId: "mapped-criteria",
          key: "empathy",
          name: "Empathy",
        },
      }],
    }],
  };
}

describe("ContentX import persistence", () => {
  beforeEach(() => {
    mockState.existing = [];
    mockState.versions = [];
    mockState.inserted = [];
    mockState.failAtInsert = 0;
    mockState.insertCalls = 0;
    vi.clearAllMocks();
  });

  it("creates evaluation records, a tenant-scoped scenario, and its published snapshot atomically", async () => {
    const result = await new Storage().importContentXPackage({
      organizationId: "org-1",
      package: mappedPackage(),
      publishedBy: "user-1",
    });

    expect(result).toMatchObject({
      sourcePackageId: "package-1",
      contentVersion: "1.0.0",
      imported: true,
      scenarios: [{ sourceScenarioKey: "renewal", scenarioVersionId: "version-new" }],
    });
    expect(mockState.inserted).toHaveLength(4);
    const scenario = mockState.inserted[2].values;
    expect(scenario).toMatchObject({
      organizationId: "org-1",
      contentxPackageId: "package-1",
      contentxVersion: "1.0.0",
      contentxScenarioKey: "renewal",
      contentxContentHash: "0123456789abcdef",
    });
    const snapshot = mockState.inserted[3].values;
    expect(snapshot).toMatchObject({
      version: 1,
      status: "published",
      publishedBy: "user-1",
    });
    expect(snapshot.contentSnapshot).toMatchObject({
      id: scenario.id,
      evaluationCriteriaSetId: scenario.evaluationCriteriaSetId,
      contentxVersion: "1.0.0",
    });
  });

  it("returns existing identifiers without inserting anything on an exact retry", async () => {
    mockState.existing = [{
      id: "scenario-existing",
      organizationId: "org-1",
      evaluationCriteriaSetId: "criteria-existing",
      contentxPackageId: "package-1",
      contentxVersion: "1.0.0",
      contentxScenarioKey: "renewal",
      contentxContentHash: "0123456789abcdef",
    }];
    mockState.versions = [{ id: "version-existing", scenarioId: "scenario-existing", version: 1 }];

    const result = await new Storage().importContentXPackage({
      organizationId: "org-1",
      package: mappedPackage(),
    });

    expect(result).toEqual({
      sourcePackageId: "package-1",
      contentVersion: "1.0.0",
      imported: false,
      scenarios: [{
        sourceScenarioKey: "renewal",
        scenarioId: "scenario-existing",
        criteriaSetId: "criteria-existing",
        scenarioVersionId: "version-existing",
      }],
    });
    expect(mockState.inserted).toHaveLength(0);
  });

  it("rejects different content under an already-imported package version", async () => {
    mockState.existing = [{
      id: "scenario-existing",
      contentxScenarioKey: "renewal",
      contentxContentHash: "different-content",
    }];

    await expect(new Storage().importContentXPackage({
      organizationId: "org-1",
      package: mappedPackage(),
    })).rejects.toBeInstanceOf(ContentXImportConflictError);
    expect(mockState.inserted).toHaveLength(0);
  });

  it("rejects a changed scenario key set under the same immutable package version", async () => {
    mockState.existing = [{
      id: "scenario-existing",
      contentxScenarioKey: "different-scenario",
      contentxContentHash: "0123456789abcdef",
    }];

    await expect(new Storage().importContentXPackage({
      organizationId: "org-1",
      package: mappedPackage(),
    })).rejects.toBeInstanceOf(ContentXImportConflictError);
    expect(mockState.inserted).toHaveLength(0);
  });

  it("rejects an exact retry when its published runtime snapshot is missing", async () => {
    mockState.existing = [{
      id: "scenario-existing",
      contentxScenarioKey: "renewal",
      contentxContentHash: "0123456789abcdef",
    }];
    mockState.versions = [];

    await expect(new Storage().importContentXPackage({
      organizationId: "org-1",
      package: mappedPackage(),
    })).rejects.toThrow(/missing its published snapshot/);
    expect(mockState.inserted).toHaveLength(0);
  });

  it("propagates a write failure from the single transaction", async () => {
    mockState.failAtInsert = 3;
    await expect(new Storage().importContentXPackage({
      organizationId: "org-1",
      package: mappedPackage(),
    })).rejects.toThrow("forced insert failure");
  });
});