import { createHash } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z, ZodError } from "zod";
import { mapAssessmentScenarioPackageV1 } from "@shared/contentxAdapter";
import { assessmentScenarioPackageV1Schema } from "@shared/schema/contentx";
import { storage } from "../storage";
import { isOperatorOrAdmin } from "../middleware/authMiddleware";
import { ContentXImportConflictError } from "../storage/contentxImports";
import { asyncHandler, createHttpError } from "./routerHelpers";

const targetSchema = z.object({
  organizationId: z.string().uuid(),
  categoryId: z.string().uuid(),
  package: z.unknown(),
}).strict();

type ContentImportStorage = Pick<typeof storage,
  | "getCategory"
  | "getOrganization"
  | "canOperatorManageCategory"
  | "importContentXPackage"
>;

function validationError(error: ZodError) {
  return {
    code: "CONTENTX_INVALID_PACKAGE",
    details: {
      diagnostics: error.issues.map(issue => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    },
  };
}

async function resolveTrustedTarget(
  store: ContentImportStorage,
  user: any,
  organizationId: string,
  categoryId: string,
) {
  const [category, organization] = await Promise.all([
    store.getCategory(categoryId),
    store.getOrganization(organizationId),
  ]);

  if (!organization || !category) {
    throw Object.assign(createHttpError(404, "Target organization or category was not found"), {
      code: "CONTENTX_TARGET_NOT_FOUND",
    });
  }
  if (!organization.isActive || !category.isActive) {
    throw Object.assign(createHttpError(400, "Target organization and category must be active"), {
      code: "CONTENTX_TARGET_INACTIVE",
    });
  }
  if (category.organizationId !== organization.id) {
    throw Object.assign(createHttpError(400, "Category does not belong to the target organization"), {
      code: "CONTENTX_TARGET_MISMATCH",
    });
  }

  if (user.role === "operator") {
    let allowed = false;
    if (user.assignedCategoryId) {
      allowed = user.assignedCategoryId === category.id;
    } else if (user.assignedOrganizationId) {
      allowed = user.assignedOrganizationId === organization.id;
    } else if (user.assignedCompanyId) {
      allowed = user.assignedCompanyId === organization.companyId;
    }
    if (!allowed) {
      allowed = await store.canOperatorManageCategory(user.id, category.id);
    }
    if (!allowed) {
      throw Object.assign(createHttpError(403, "You cannot import content into this category"), {
        code: "CONTENTX_TARGET_FORBIDDEN",
      });
    }
  }

  return { organizationId: organization.id, categoryId: category.id };
}

function parseRequest(body: unknown) {
  const request = targetSchema.parse(body);
  const sourcePackage = assessmentScenarioPackageV1Schema.parse(request.package);
  const digestInput = {
    ...sourcePackage,
    provenance: {
      ...sourcePackage.provenance,
      contentHash: undefined,
    },
  };
  return {
    ...request,
    mappedPackage: mapAssessmentScenarioPackageV1(sourcePackage),
    sourceContentDigest: createHash("sha256")
      .update(canonicalJson(digestInput))
      .digest("hex"),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter(key => object[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export default function createContentImportsRouter(
  isAuthenticated: RequestHandler,
  store: ContentImportStorage = storage,
) {
  const router = Router();

  router.post("/api/content/import/validate", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    try {
      const parsed = parseRequest(req.body);
      const target = await resolveTrustedTarget(store, req.user, parsed.organizationId, parsed.categoryId);
      res.json({
        valid: true,
        target,
        package: {
          sourcePackageId: parsed.mappedPackage.provenance.sourcePackageId,
          packageKey: parsed.mappedPackage.packageKey,
          contentVersion: parsed.mappedPackage.packageVersion,
          scenarioCount: parsed.mappedPackage.scenarios.length,
        },
        diagnostics: [],
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const details = validationError(error);
        throw Object.assign(createHttpError(400, "ContentX package validation failed"), details);
      }
      if (typeof (error as any)?.status === "number") {
        throw error;
      }
      console.error("[ContentX import] Validation failed:", error);
      throw Object.assign(createHttpError(500, "ContentX validation failed"), {
        code: "CONTENTX_VALIDATION_FAILED",
      });
    }
  }));

  router.post("/api/content/import", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    try {
      const parsed = parseRequest(req.body);
      const target = await resolveTrustedTarget(store, req.user, parsed.organizationId, parsed.categoryId);
      const result = await store.importContentXPackage({
        ...target,
        package: parsed.mappedPackage,
        sourceContentDigest: parsed.sourceContentDigest,
        publishedBy: req.user.id,
      });
      res.status(result.imported ? 201 : 200).json({
        package: {
          sourcePackageId: result.sourcePackageId,
          contentVersion: result.contentVersion,
          created: result.imported,
        },
        scenarios: result.scenarios.map(item => ({
          sourceScenarioKey: item.sourceScenarioKey,
          scenario: { id: item.scenarioId, created: result.imported },
          criteriaSet: { id: item.criteriaSetId, created: result.imported },
          publishedVersion: { id: item.scenarioVersionId, created: result.imported },
        })),
      });
    } catch (error) {
      if (error instanceof ZodError) {
        const details = validationError(error);
        throw Object.assign(createHttpError(400, "ContentX package validation failed"), details);
      }
      if (error instanceof ContentXImportConflictError) {
        throw Object.assign(createHttpError(409, "This ContentX package version conflicts with an existing import"), {
          code: error.code,
        });
      }
      if (typeof (error as any)?.status === "number") {
        throw error;
      }
      console.error("[ContentX import] Import failed:", error);
      throw Object.assign(createHttpError(500, "ContentX import failed"), {
        code: "CONTENTX_IMPORT_FAILED",
      });
    }
  }));

  return router;
}