import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { transformScenariosMedia } from "../services/gcsStorage";
import { getOperatorAccessibleCategoryIds, asyncHandler, createHttpError } from "./routerHelpers";

export default function createScenariosRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/stats", asyncHandler(async (req, res) => {
    const stats = await storage.getScenarioStats();
    res.json(stats);
  }));

  router.get("/", asyncHandler(async (req, res) => {
    const scenarios = await fileManager.getAllScenarios();
    const categoryIdParam = req.query.categoryId as string | undefined;

    const token = (req as any).cookies?.token || (req.headers.authorization?.split(' ')[1]);

    let userLanguage = 'ko';
    let filteredScenarios = scenarios;

    if (token) {
      try {
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.verify(token, process.env.JWT_SECRET!) as any;
        const user = await storage.getUser(decoded.userId);

        if (user) {
          userLanguage = (user as any).preferredLanguage || 'ko';

          const isGuestAccount = user.email === 'guest@mothle.com';
          if (isGuestAccount) {
            filteredScenarios = scenarios.filter((s: any) => s.isDemo === true);
          } else if (user.role === 'admin') {
            if (categoryIdParam) {
              filteredScenarios = scenarios.filter((s: any) =>
                String(s.categoryId) === String(categoryIdParam)
              );
            }
          } else {
            const userWithAssignments = user as any;

            if (user.role === 'operator') {
              const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);

              if (accessibleCategoryIds.length > 0) {
                if (categoryIdParam) {
                  if (accessibleCategoryIds.includes(String(categoryIdParam))) {
                    filteredScenarios = scenarios.filter((s: any) =>
                      String(s.categoryId) === String(categoryIdParam)
                    );
                  } else {
                    filteredScenarios = [];
                  }
                } else {
                  filteredScenarios = scenarios.filter((s: any) =>
                    accessibleCategoryIds.includes(String(s.categoryId))
                  );
                }
              } else {
                filteredScenarios = [];
              }
            } else {
              let accessibleCategoryIds: string[] = [];

              if (userWithAssignments.assignedCategoryId) {
                accessibleCategoryIds.push(userWithAssignments.assignedCategoryId);
              }

              if (userWithAssignments.organizationId || userWithAssignments.companyId) {
                try {
                  const allCategories = await storage.getAllCategories();

                  for (const cat of allCategories) {
                    const catAny = cat as any;
                    if (userWithAssignments.organizationId && catAny.organizationId === userWithAssignments.organizationId) {
                      if (!accessibleCategoryIds.includes(cat.id)) {
                        accessibleCategoryIds.push(cat.id);
                      }
                    } else if (userWithAssignments.companyId && catAny.companyId === userWithAssignments.companyId) {
                      if (!accessibleCategoryIds.includes(cat.id)) {
                        accessibleCategoryIds.push(cat.id);
                      }
                    }
                  }
                } catch (err) {
                  console.error('[Scenarios API] Error fetching categories for org filtering:', err);
                }
              }

              if (accessibleCategoryIds.length > 0) {
                filteredScenarios = scenarios.filter((s: any) =>
                  accessibleCategoryIds.includes(String(s.categoryId))
                );
              }
            }
          }
        }
      } catch (tokenError) {
        // Token verification failed - treat as unauthenticated user
      }
    }

    if (userLanguage !== 'ko') {
      const translatedScenarios = await Promise.all(
        filteredScenarios.map(async (scenario: any) => {
          try {
            const translation = await storage.getScenarioTranslation(scenario.id, userLanguage);
            if (translation) {
              return {
                ...scenario,
                title: translation.title || scenario.title,
                description: translation.description || scenario.description,
                context: {
                  ...scenario.context,
                  situation: translation.situation || scenario.context?.situation,
                  timeline: translation.timeline || scenario.context?.timeline,
                  stakes: translation.stakes || scenario.context?.stakes,
                  playerRoleText: translation.playerRole || null,
                },
                objectives: translation.objectives || scenario.objectives,
                successCriteria: {
                  optimal: translation.successCriteriaOptimal || scenario.successCriteria?.optimal,
                  good: translation.successCriteriaGood || scenario.successCriteria?.good,
                  acceptable: translation.successCriteriaAcceptable || scenario.successCriteria?.acceptable,
                  failure: translation.successCriteriaFailure || scenario.successCriteria?.failure,
                },
                _translated: true,
                _translationLocale: userLanguage,
              };
            }
            return scenario;
          } catch (err) {
            console.error(`[Scenarios API] Translation fetch error for ${scenario.id}:`, err);
            return scenario;
          }
        })
      );
      const transformedScenarios = await transformScenariosMedia(translatedScenarios);
      return res.json(transformedScenarios);
    }

    console.log(`[Scenarios API] Returning ${filteredScenarios.length} scenarios (language: ${userLanguage})`);
    const transformedScenarios = await transformScenariosMedia(filteredScenarios);
    res.json(transformedScenarios);
  }));

  router.get("/:scenarioId", isAuthenticated, asyncHandler(async (req, res) => {
    const scenario = await fileManager.getScenarioById(req.params.scenarioId);
    if (!scenario) {
      throw createHttpError(404, "Scenario not found");
    }
    res.json(scenario);
  }));

  return router;
}
