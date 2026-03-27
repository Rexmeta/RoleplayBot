import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { transformScenariosMedia } from "../services/gcsStorage";
import { getOperatorAccessibleCategoryIds } from "./routerHelpers";

export default function createScenariosRouter(isAuthenticated: any) {
  const router = Router();

  // 시나리오 완료 통계 조회
  router.get("/stats", async (req, res) => {
    try {
      const stats = await storage.getScenarioStats();
      res.json(stats);
    } catch (error: any) {
      console.error("Error fetching scenario stats:", error);
      res.status(500).json({ error: error.message || "Failed to fetch scenario stats" });
    }
  });

  // 메인 사용자용 시나리오/페르소나 API
  router.get("/", async (req, res) => {
    try {
      const scenarios = await fileManager.getAllScenarios();
      const categoryIdParam = req.query.categoryId as string | undefined;
      
      // 인증된 사용자인지 확인 (토큰이 있는 경우)
      const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
      
      let userLanguage = 'ko'; // 기본 언어
      let filteredScenarios = scenarios;
      
      if (token) {
        try {
          const jwt = await import('jsonwebtoken');
          const decoded = jwt.default.verify(token, process.env.JWT_SECRET!) as any;
          const user = await storage.getUser(decoded.userId);
          
          if (user) {
            userLanguage = (user as any).preferredLanguage || 'ko';
            
            // 게스트 계정 체크 (guest@mothle.com)
            const isGuestAccount = user.email === 'guest@mothle.com';
            if (isGuestAccount) {
              // 게스트는 데모 시나리오만 볼 수 있음
              filteredScenarios = scenarios.filter((s: any) => s.isDemo === true);
            }
            // 시스템관리자(admin)는 모든 시나리오 접근 가능 (카테고리 필터 선택 가능)
            else if (user.role === 'admin') {
              if (categoryIdParam) {
                filteredScenarios = scenarios.filter((s: any) => 
                  String(s.categoryId) === String(categoryIdParam)
                );
              }
            } else {
              // 운영자/일반 사용자: 계층적 권한에 따라 필터링
              const userWithAssignments = user as any;
              
              // 운영자: 할당된 회사/조직/카테고리 기반 필터링
              if (user.role === 'operator') {
                const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
                
                if (accessibleCategoryIds.length > 0) {
                  // 카테고리 파라미터가 있으면 추가 필터링
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
              }
              // 일반 사용자: 자신이 속한 조직/회사 기반 필터링
              else {
                let accessibleCategoryIds: string[] = [];
                
                // 사용자에게 할당된 카테고리가 있으면 포함
                if (userWithAssignments.assignedCategoryId) {
                  accessibleCategoryIds.push(userWithAssignments.assignedCategoryId);
                }
                
                // 사용자의 조직/회사에 속한 카테고리 찾기
                if (userWithAssignments.organizationId || userWithAssignments.companyId) {
                  try {
                    const allCategories = await storage.getAllCategories();
                    
                    for (const cat of allCategories) {
                      const catAny = cat as any;
                      // 조직이 일치하면 해당 카테고리 포함
                      if (userWithAssignments.organizationId && catAny.organizationId === userWithAssignments.organizationId) {
                        if (!accessibleCategoryIds.includes(cat.id)) {
                          accessibleCategoryIds.push(cat.id);
                        }
                      }
                      // 회사가 일치하면 해당 카테고리 포함 (조직 미지정인 경우)
                      else if (userWithAssignments.companyId && catAny.companyId === userWithAssignments.companyId) {
                        if (!accessibleCategoryIds.includes(cat.id)) {
                          accessibleCategoryIds.push(cat.id);
                        }
                      }
                    }
                  } catch (err) {
                    console.error('[Scenarios API] Error fetching categories for org filtering:', err);
                  }
                }
                
                // 접근 가능한 카테고리가 있으면 필터링
                if (accessibleCategoryIds.length > 0) {
                  filteredScenarios = scenarios.filter((s: any) => 
                    accessibleCategoryIds.includes(String(s.categoryId))
                  );
                }
              }
            }
          }
        } catch (tokenError) {
          // 토큰 검증 실패 시 전체 시나리오 반환 (비로그인 사용자와 동일 처리)
        }
      }
      
      // 사용자 언어에 따라 번역 적용
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
        // Transform media URLs to signed URLs for GCS environment
        const transformedScenarios = await transformScenariosMedia(translatedScenarios);
        return res.json(transformedScenarios);
      }
      
      // 비로그인 사용자 또는 카테고리 미할당 사용자는 전체 시나리오 접근 가능
      console.log(`[Scenarios API] Returning ${filteredScenarios.length} scenarios (language: ${userLanguage})`);
      // Transform media URLs to signed URLs for GCS environment
      const transformedScenarios = await transformScenariosMedia(filteredScenarios);
      res.json(transformedScenarios);
    } catch (error) {
      console.error("Failed to fetch scenarios:", error);
      res.status(500).json({ error: "Failed to fetch scenarios" });
    }
  });

  router.get("/:scenarioId", isAuthenticated, async (req, res) => {
    try {
      const scenario = await fileManager.getScenarioById(req.params.scenarioId);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      res.json(scenario);
    } catch (error) {
      console.error("Failed to fetch scenario:", error);
      res.status(500).json({ error: "Failed to fetch scenario" });
    }
  });

  return router;
}
