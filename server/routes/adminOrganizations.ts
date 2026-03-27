import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { isOperatorOrAdmin, isSystemAdmin } from "../middleware/authMiddleware";

export default function createAdminOrganizationsRouter(isAuthenticated: any) {
  const router = Router();

  // 모든 카테고리 조회 (공개 - 회원가입 시 카테고리 선택에 필요)
  router.get("/api/categories", async (req: any, res) => {
    try {
      const allCategories = await storage.getAllCategories();
      
      // 🚀 최적화: 캐시된 시나리오 카운트 사용 (파일 전체 파싱 대신 카운트만)
      const scenarioCounts = await fileManager.getScenarioCountsByCategory();
      const categoriesWithCount = allCategories.map(category => ({
        ...category,
        scenarioCount: scenarioCounts.get(category.id) || 0
      }));
      
      res.json(categoriesWithCount);
    } catch (error: any) {
      console.error("Error getting categories:", error);
      res.status(500).json({ error: error.message || "Failed to get categories" });
    }
  });

  // 카테고리 생성 (시스템 관리자 전용)
  router.post("/api/system-admin/categories", isAuthenticated, isSystemAdmin, async (req: any, res) => {
    try {
      const { name, description, order } = req.body;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Category name is required" });
      }
      
      const category = await storage.createCategory({
        name: name.trim(),
        description: description || null,
        order: order || 0,
      });
      
      res.json(category);
    } catch (error: any) {
      console.error("Error creating category:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Category name already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to create category" });
      }
    }
  });

  // 카테고리 수정 (시스템 관리자 전용)
  router.patch("/api/system-admin/categories/:id", isAuthenticated, isSystemAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { name, description, order } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (description !== undefined) updates.description = description;
      if (order !== undefined) updates.order = order;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const category = await storage.updateCategory(id, updates);
      res.json(category);
    } catch (error: any) {
      console.error("Error updating category:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Category name already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to update category" });
      }
    }
  });

  // 카테고리 삭제 (시스템 관리자 전용)
  router.delete("/api/system-admin/categories/:id", isAuthenticated, isSystemAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      
      // 해당 카테고리에 연결된 시나리오가 있는지 확인
      const scenarios = await fileManager.getAllScenarios();
      const connectedScenarios = scenarios.filter((s: any) => s.categoryId === id);
      
      if (connectedScenarios.length > 0) {
        return res.status(400).json({
          error: "Cannot delete category with connected scenarios",
          connectedScenarios: connectedScenarios.map((s: any) => ({ id: s.id, title: s.title })),
        });
      }
      
      // 해당 카테고리가 할당된 운영자가 있는지 확인
      const allUsers = await storage.getAllUsers();
      const assignedOperators = allUsers.filter(u => u.assignedCategoryId === id);
      
      if (assignedOperators.length > 0) {
        return res.status(400).json({
          error: "Cannot delete category with assigned operators",
          assignedOperators: assignedOperators.map(u => ({ id: u.id, name: u.name, email: u.email })),
        });
      }
      
      await storage.deleteCategory(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting category:", error);
      res.status(500).json({ error: error.message || "Failed to delete category" });
    }
  });

  // ========== 조직 계층 조회 API ==========
  
  // 모든 조직 조회 (회사 정보 포함)
  router.get("/api/admin/organizations-with-hierarchy", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const organizations = await storage.getAllOrganizations();
      const companies = await storage.getAllCompanies();
      
      const organizationsWithHierarchy = organizations.map(org => {
        const company = companies.find(c => c.id === org.companyId);
        return {
          ...org,
          company: company ? { id: company.id, name: company.name, code: company.code } : null,
        };
      });
      
      res.json(organizationsWithHierarchy);
    } catch (error: any) {
      console.error("Error getting organizations with hierarchy:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });

  // ========== 조직 관리 API (운영자용 - 회사 레벨 운영자만) ==========
  
  // 회사 레벨 운영자 권한 체크 헬퍼
  const isCompanyLevelOperator = (user: any): boolean => {
    return user.role === 'operator' && 
           user.assignedCompanyId && 
           !user.assignedOrganizationId && 
           !user.assignedCategoryId;
  };
  
  // 운영자용 조직 목록 조회 (회사 레벨 운영자: 자신의 회사 조직만)
  router.get("/api/admin/organizations", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const user = req.user;
      const organizations = await storage.getAllOrganizations();
      const companies = await storage.getAllCompanies();
      
      let filteredOrgs = organizations;
      
      // 회사 레벨 운영자인 경우 해당 회사의 조직만 반환
      if (user.role === 'operator') {
        if (isCompanyLevelOperator(user)) {
          filteredOrgs = organizations.filter(org => org.companyId === user.assignedCompanyId);
        } else if (user.assignedOrganizationId) {
          // 조직/카테고리 레벨 운영자는 자신의 조직만
          filteredOrgs = organizations.filter(org => org.id === user.assignedOrganizationId);
        } else {
          filteredOrgs = [];
        }
      }
      
      const organizationsWithHierarchy = filteredOrgs.map(org => {
        const company = companies.find(c => c.id === org.companyId);
        return {
          ...org,
          company: company ? { id: company.id, name: company.name, code: company.code } : null,
        };
      });
      
      res.json(organizationsWithHierarchy);
    } catch (error: any) {
      console.error("Error getting organizations for operator:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });
  
  // 운영자용 조직 생성 (회사 레벨 운영자만)
  router.post("/api/admin/organizations", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const user = req.user;
      const { name, code, description, isActive } = req.body;
      
      // 권한 체크: admin 또는 회사 레벨 운영자만 가능
      if (user.role === 'operator' && !isCompanyLevelOperator(user)) {
        return res.status(403).json({ error: "Only company-level operators can create organizations" });
      }
      
      // 운영자인 경우 companyId는 자동으로 할당된 회사로 설정
      const companyId = user.role === 'admin' ? req.body.companyId : user.assignedCompanyId;
      
      if (!companyId) {
        return res.status(400).json({ error: "Company ID is required" });
      }
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Organization name is required" });
      }
      
      const organization = await storage.createOrganization({
        companyId,
        name: name.trim(),
        code: code?.trim() || null,
        description: description || null,
        isActive: isActive !== false,
      });
      
      res.json(organization);
    } catch (error: any) {
      console.error("Error creating organization:", error);
      res.status(500).json({ error: error.message || "Failed to create organization" });
    }
  });
  
  // 운영자용 조직 수정 (회사 레벨 운영자만, 자신의 회사 조직만)
  router.patch("/api/admin/organizations/:id", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      const { name, code, description, isActive } = req.body;
      
      // 권한 체크
      if (user.role === 'operator') {
        if (!isCompanyLevelOperator(user)) {
          return res.status(403).json({ error: "Only company-level operators can update organizations" });
        }
        
        // 해당 조직이 운영자의 회사에 속하는지 확인
        const organization = await storage.getOrganization(id);
        if (!organization || organization.companyId !== user.assignedCompanyId) {
          return res.status(403).json({ error: "You can only update organizations in your assigned company" });
        }
      }
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (code !== undefined) updates.code = code?.trim() || null;
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.isActive = isActive;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const organization = await storage.updateOrganization(id, updates);
      res.json(organization);
    } catch (error: any) {
      console.error("Error updating organization:", error);
      res.status(500).json({ error: error.message || "Failed to update organization" });
    }
  });
  
  // 운영자용 조직 삭제 (회사 레벨 운영자만, 자신의 회사 조직만)
  router.delete("/api/admin/organizations/:id", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const user = req.user;
      const { id } = req.params;
      
      // 권한 체크
      if (user.role === 'operator') {
        if (!isCompanyLevelOperator(user)) {
          return res.status(403).json({ error: "Only company-level operators can delete organizations" });
        }
        
        // 해당 조직이 운영자의 회사에 속하는지 확인
        const organization = await storage.getOrganization(id);
        if (!organization || organization.companyId !== user.assignedCompanyId) {
          return res.status(403).json({ error: "You can only delete organizations in your assigned company" });
        }
      }
      
      // 해당 조직에 카테고리가 있는지 확인
      const categories = await storage.getCategoriesByOrganization(id);
      if (categories.length > 0) {
        return res.status(400).json({
          error: "Cannot delete organization with categories",
          categories: categories.map(c => ({ id: c.id, name: c.name })),
        });
      }
      
      await storage.deleteOrganization(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting organization:", error);
      res.status(500).json({ error: error.message || "Failed to delete organization" });
    }
  });

  // ========== 카테고리 관리 API (관리자/운영자용 - 계층적 권한 지원) ==========
  
  // 운영자 계층적 권한 체크 헬퍼 함수
  // 회사만 할당: 해당 회사의 모든 조직/카테고리 접근 가능
  // 회사+조직 할당: 해당 조직의 모든 카테고리 접근 가능
  // 회사+조직+카테고리 할당: 해당 카테고리만 접근 가능
  const checkOperatorCategoryAccess = async (user: any, categoryId: string): Promise<{ hasAccess: boolean; error?: string }> => {
    if (user.role === 'admin') return { hasAccess: true };
    if (user.role !== 'operator') return { hasAccess: false, error: 'Unauthorized' };
    
    // 어떤 권한도 할당되지 않은 경우
    if (!user.assignedCompanyId && !user.assignedOrganizationId && !user.assignedCategoryId) {
      return { hasAccess: false, error: 'Operator must be assigned to manage categories' };
    }
    
    const category = await storage.getCategory(categoryId);
    if (!category) return { hasAccess: false, error: 'Category not found' };
    
    // 카테고리 레벨 할당: 해당 카테고리만 접근 가능
    if (user.assignedCategoryId) {
      return { hasAccess: category.id === user.assignedCategoryId };
    }
    
    // 조직 레벨 할당: 해당 조직의 모든 카테고리 접근 가능
    if (user.assignedOrganizationId) {
      return { hasAccess: category.organizationId === user.assignedOrganizationId };
    }
    
    // 회사 레벨 할당: 해당 회사의 모든 조직/카테고리 접근 가능
    if (user.assignedCompanyId && category.organizationId) {
      const org = await storage.getOrganization(category.organizationId);
      return { hasAccess: org?.companyId === user.assignedCompanyId };
    }
    
    return { hasAccess: false };
  };
  
  // 운영자가 접근 가능한 조직 목록 가져오기
  const getOperatorAccessibleOrganizations = async (user: any): Promise<string[]> => {
    if (user.role === 'admin') {
      const allOrgs = await storage.getAllOrganizations();
      return allOrgs.map(o => o.id);
    }
    if (user.role !== 'operator') return [];
    
    // 카테고리 레벨: 해당 카테고리의 조직만
    if (user.assignedCategoryId) {
      const cat = await storage.getCategory(user.assignedCategoryId);
      return cat?.organizationId ? [cat.organizationId] : [];
    }
    
    // 조직 레벨: 해당 조직만
    if (user.assignedOrganizationId) {
      return [user.assignedOrganizationId];
    }
    
    // 회사 레벨: 해당 회사의 모든 조직
    if (user.assignedCompanyId) {
      const allOrgs = await storage.getAllOrganizations();
      return allOrgs.filter(o => o.companyId === user.assignedCompanyId).map(o => o.id);
    }
    
    return [];
  };
  
  // 모든 카테고리 조회 (조직 정보 포함 - 계층적 권한 적용)
  router.get("/api/admin/categories", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const user = req.user;
      
      console.log(`[Categories API] User: ${user.email}, role: ${user.role}, assignedCompanyId: ${user.assignedCompanyId}, assignedOrgId: ${user.assignedOrganizationId}, assignedCatId: ${user.assignedCategoryId}`);
      
      let allCategories = await storage.getAllCategories();
      const organizations = await storage.getAllOrganizations();
      const companies = await storage.getAllCompanies();
      
      console.log(`[Categories API] Total categories: ${allCategories.length}, Total orgs: ${organizations.length}`);
      
      // 운영자는 계층적 권한에 따라 카테고리 필터링
      if (user.role === 'operator') {
        // 카테고리 레벨 할당: 해당 카테고리만
        if (user.assignedCategoryId) {
          allCategories = allCategories.filter(cat => cat.id === user.assignedCategoryId);
          console.log(`[Categories API] Category-level filter applied: ${allCategories.length} categories`);
        }
        // 조직 레벨 할당: 해당 조직의 모든 카테고리
        else if (user.assignedOrganizationId) {
          allCategories = allCategories.filter(cat => cat.organizationId === user.assignedOrganizationId);
          console.log(`[Categories API] Org-level filter applied: ${allCategories.length} categories`);
        }
        // 회사 레벨 할당: 해당 회사의 모든 조직의 카테고리
        else if (user.assignedCompanyId) {
          const companyOrgIds = organizations.filter(o => o.companyId === user.assignedCompanyId).map(o => o.id);
          console.log(`[Categories API] Company ${user.assignedCompanyId} has orgs: ${companyOrgIds.join(', ')}`);
          allCategories = allCategories.filter(cat => cat.organizationId && companyOrgIds.includes(cat.organizationId));
          console.log(`[Categories API] Company-level filter applied: ${allCategories.length} categories`);
        }
        // 어떤 권한도 없으면 빈 배열
        else {
          console.log(`[Categories API] No assignments - returning empty array`);
          return res.json([]);
        }
      }
      
      const categoriesWithHierarchy = allCategories.map(category => {
        const org = organizations.find(o => o.id === category.organizationId);
        const company = org ? companies.find(c => c.id === org.companyId) : null;
        return {
          ...category,
          organization: org ? { id: org.id, name: org.name, code: org.code } : null,
          company: company ? { id: company.id, name: company.name, code: company.code } : null,
        };
      });
      
      res.json(categoriesWithHierarchy);
    } catch (error: any) {
      console.error("Error getting categories with hierarchy:", error);
      res.status(500).json({ error: error.message || "Failed to get categories" });
    }
  });

  // 카테고리 생성 (계층적 권한 적용)
  router.post("/api/admin/categories", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { name, description, organizationId, order } = req.body;
      const user = req.user;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Category name is required" });
      }
      
      // 운영자는 자신의 권한 범위 내 조직에만 카테고리 생성 가능
      let effectiveOrganizationId = organizationId || null;
      if (user.role === 'operator') {
        const accessibleOrgIds = await getOperatorAccessibleOrganizations(user);
        
        // 카테고리 레벨 할당: 카테고리 생성 불가
        if (user.assignedCategoryId) {
          return res.status(403).json({ error: "Category-level operators cannot create new categories" });
        }
        
        // 조직 레벨 할당: 해당 조직에만 생성 가능
        if (user.assignedOrganizationId) {
          effectiveOrganizationId = user.assignedOrganizationId;
        }
        // 회사 레벨 할당: 클라이언트가 보낸 조직이 접근 가능한 조직인지 확인
        else if (user.assignedCompanyId) {
          if (!organizationId || !accessibleOrgIds.includes(organizationId)) {
            return res.status(400).json({ error: "Please select a valid organization within your assigned company" });
          }
          effectiveOrganizationId = organizationId;
        }
        else {
          return res.status(403).json({ error: "Operator must be assigned to create categories" });
        }
      }
      
      const category = await storage.createCategory({
        name: name.trim(),
        description: description || null,
        organizationId: effectiveOrganizationId,
        order: order || 0,
      });
      
      res.json(category);
    } catch (error: any) {
      console.error("Error creating category:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Category name already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to create category" });
      }
    }
  });

  // 카테고리 수정 (계층적 권한 적용)
  router.patch("/api/admin/categories/:id", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { name, description, organizationId, order, isActive } = req.body;
      const user = req.user;
      
      // 운영자는 계층적 권한에 따라 수정 가능
      if (user.role === 'operator') {
        const accessCheck = await checkOperatorCategoryAccess(user, id);
        if (!accessCheck.hasAccess) {
          return res.status(403).json({ error: accessCheck.error || "You cannot update this category" });
        }
      }
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (description !== undefined) updates.description = description;
      // 조직 변경: admin은 무제한, 회사 레벨 운영자는 자신의 회사 내 조직만 가능
      if (organizationId !== undefined) {
        if (user.role === 'admin') {
          updates.organizationId = organizationId;
        } else if (user.role === 'operator' && user.assignedCompanyId && !user.assignedOrganizationId && !user.assignedCategoryId) {
          // 회사 레벨 운영자: 해당 회사 내 조직인지 확인
          const accessibleOrgIds = await getOperatorAccessibleOrganizations(user);
          if (accessibleOrgIds.includes(organizationId)) {
            updates.organizationId = organizationId;
          } else {
            return res.status(403).json({ error: "You can only move categories to organizations within your assigned company" });
          }
        }
        // 조직/카테고리 레벨 운영자는 조직 변경 불가 (기존 동작 유지)
      }
      if (order !== undefined) updates.order = order;
      if (isActive !== undefined) updates.isActive = isActive;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const category = await storage.updateCategory(id, updates);
      res.json(category);
    } catch (error: any) {
      console.error("Error updating category:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Category name already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to update category" });
      }
    }
  });

  // 카테고리 삭제 (계층적 권한 적용)
  router.delete("/api/admin/categories/:id", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const user = req.user;
      
      // 운영자는 계층적 권한에 따라 삭제 가능 (카테고리 레벨 할당은 삭제 불가)
      if (user.role === 'operator') {
        // 카테고리 레벨 할당: 카테고리 삭제 불가
        if (user.assignedCategoryId) {
          return res.status(403).json({ error: "Category-level operators cannot delete categories" });
        }
        
        const accessCheck = await checkOperatorCategoryAccess(user, id);
        if (!accessCheck.hasAccess) {
          return res.status(403).json({ error: accessCheck.error || "You cannot delete this category" });
        }
      }
      
      // 해당 카테고리에 연결된 시나리오가 있는지 확인
      const scenarios = await fileManager.getAllScenarios();
      const connectedScenarios = scenarios.filter((s: any) => s.categoryId === id);
      
      if (connectedScenarios.length > 0) {
        return res.status(400).json({
          error: "Cannot delete category with connected scenarios",
          connectedScenarios: connectedScenarios.map((s: any) => ({ id: s.id, title: s.title })),
        });
      }
      
      // 해당 카테고리가 할당된 운영자가 있는지 확인
      const allUsers = await storage.getAllUsers();
      const assignedOperators = allUsers.filter(u => u.assignedCategoryId === id);
      
      if (assignedOperators.length > 0) {
        return res.status(400).json({
          error: "Cannot delete category with assigned operators",
          assignedOperators: assignedOperators.map(u => ({ id: u.id, name: u.name, email: u.email })),
        });
      }
      
      await storage.deleteCategory(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting category:", error);
      res.status(500).json({ error: error.message || "Failed to delete category" });
    }
  });

  // Public: list companies for registration form
  router.get("/api/public/companies", async (req, res) => {
    try {
      const companies = await storage.getAllCompanies();
      res.json(companies.map((c: any) => ({ id: c.id, name: c.name })));
    } catch (error: any) {
      console.error("Error fetching public companies:", error);
      res.status(500).json({ error: "Failed to fetch companies" });
    }
  });

  // Public: list organizations for a company (for registration form)
  router.get("/api/public/organizations", async (req, res) => {
    try {
      const companyId = req.query.companyId as string | undefined;
      const allOrgs = await storage.getAllOrganizations();
      const filtered = companyId ? allOrgs.filter((o: any) => String(o.companyId) === companyId) : allOrgs;
      res.json(filtered.map((o: any) => ({ id: o.id, name: o.name, companyId: o.companyId })));
    } catch (error: any) {
      console.error("Error fetching public organizations:", error);
      res.status(500).json({ error: "Failed to fetch organizations" });
    }
  });

  return router;
}
