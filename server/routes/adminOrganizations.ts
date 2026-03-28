import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { isOperatorOrAdmin, isSystemAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";

export default function createAdminOrganizationsRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/categories", asyncHandler(async (req: any, res) => {
    const allCategories = await storage.getAllCategories();

    const scenarioCounts = await fileManager.getScenarioCountsByCategory();
    const categoriesWithCount = allCategories.map(category => ({
      ...category,
      scenarioCount: scenarioCounts.get(category.id) || 0
    }));

    res.json(categoriesWithCount);
  }));

  router.post("/api/system-admin/categories", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
    const { name, description, order } = req.body;

    if (!name || name.trim() === "") {
      throw createHttpError(400, "Category name is required");
    }

    try {
      const category = await storage.createCategory({
        name: name.trim(),
        description: description || null,
        order: order || 0,
      });
      res.json(category);
    } catch (error: any) {
      if (error.message?.includes("unique") || error.code === "23505") {
        throw createHttpError(400, "Category name already exists");
      }
      throw error;
    }
  }));

  router.patch("/api/system-admin/categories/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const { name, description, order } = req.body;

    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (order !== undefined) updates.order = order;

    if (Object.keys(updates).length === 0) {
      throw createHttpError(400, "No valid updates provided");
    }

    try {
      const category = await storage.updateCategory(id, updates);
      res.json(category);
    } catch (error: any) {
      if (error.message?.includes("unique") || error.code === "23505") {
        throw createHttpError(400, "Category name already exists");
      }
      throw error;
    }
  }));

  router.delete("/api/system-admin/categories/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;

    const scenarios = await fileManager.getAllScenarios();
    const connectedScenarios = scenarios.filter((s: any) => s.categoryId === id);

    if (connectedScenarios.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete category with connected scenarios"), {
        connectedScenarios: connectedScenarios.map((s: any) => ({ id: s.id, title: s.title }))
      });
    }

    const allUsers = await storage.getAllUsers();
    const assignedOperators = allUsers.filter(u => u.assignedCategoryId === id);

    if (assignedOperators.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete category with assigned operators"), {
        assignedOperators: assignedOperators.map(u => ({ id: u.id, name: u.name, email: u.email }))
      });
    }

    await storage.deleteCategory(id);
    res.json({ success: true });
  }));

  router.get("/api/admin/organizations-with-hierarchy", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
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
  }));

  const isCompanyLevelOperator = (user: any): boolean => {
    return user.role === 'operator' &&
      user.assignedCompanyId &&
      !user.assignedOrganizationId &&
      !user.assignedCategoryId;
  };

  router.get("/api/admin/organizations", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const organizations = await storage.getAllOrganizations();
    const companies = await storage.getAllCompanies();

    let filteredOrgs = organizations;

    if (user.role === 'operator') {
      if (isCompanyLevelOperator(user)) {
        filteredOrgs = organizations.filter(org => org.companyId === user.assignedCompanyId);
      } else if (user.assignedOrganizationId) {
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
  }));

  router.post("/api/admin/organizations", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const { name, code, description, isActive } = req.body;

    if (user.role === 'operator' && !isCompanyLevelOperator(user)) {
      throw createHttpError(403, "Only company-level operators can create organizations");
    }

    const companyId = user.role === 'admin' ? req.body.companyId : user.assignedCompanyId;

    if (!companyId) {
      throw createHttpError(400, "Company ID is required");
    }
    if (!name || name.trim() === "") {
      throw createHttpError(400, "Organization name is required");
    }

    const organization = await storage.createOrganization({
      companyId,
      name: name.trim(),
      code: code?.trim() || null,
      description: description || null,
      isActive: isActive !== false,
    });

    res.json(organization);
  }));

  router.patch("/api/admin/organizations/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const { id } = req.params;
    const { name, code, description, isActive } = req.body;

    if (user.role === 'operator') {
      if (!isCompanyLevelOperator(user)) {
        throw createHttpError(403, "Only company-level operators can update organizations");
      }

      const organization = await storage.getOrganization(id);
      if (!organization || organization.companyId !== user.assignedCompanyId) {
        throw createHttpError(403, "You can only update organizations in your assigned company");
      }
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (code !== undefined) updates.code = code?.trim() || null;
    if (description !== undefined) updates.description = description;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) {
      throw createHttpError(400, "No valid updates provided");
    }

    const organization = await storage.updateOrganization(id, updates);
    res.json(organization);
  }));

  router.delete("/api/admin/organizations/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const { id } = req.params;

    if (user.role === 'operator') {
      if (!isCompanyLevelOperator(user)) {
        throw createHttpError(403, "Only company-level operators can delete organizations");
      }

      const organization = await storage.getOrganization(id);
      if (!organization || organization.companyId !== user.assignedCompanyId) {
        throw createHttpError(403, "You can only delete organizations in your assigned company");
      }
    }

    const categories = await storage.getCategoriesByOrganization(id);
    if (categories.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete organization with categories"), {
        categories: categories.map(c => ({ id: c.id, name: c.name }))
      });
    }

    await storage.deleteOrganization(id);
    res.json({ success: true });
  }));

  const checkOperatorCategoryAccess = async (user: any, categoryId: string): Promise<{ hasAccess: boolean; error?: string }> => {
    if (user.role === 'admin') return { hasAccess: true };
    if (user.role !== 'operator') return { hasAccess: false, error: 'Unauthorized' };

    if (!user.assignedCompanyId && !user.assignedOrganizationId && !user.assignedCategoryId) {
      return { hasAccess: false, error: 'Operator must be assigned to manage categories' };
    }

    const category = await storage.getCategory(categoryId);
    if (!category) return { hasAccess: false, error: 'Category not found' };

    if (user.assignedCategoryId) {
      return { hasAccess: category.id === user.assignedCategoryId };
    }

    if (user.assignedOrganizationId) {
      return { hasAccess: category.organizationId === user.assignedOrganizationId };
    }

    if (user.assignedCompanyId && category.organizationId) {
      const org = await storage.getOrganization(category.organizationId);
      return { hasAccess: org?.companyId === user.assignedCompanyId };
    }

    return { hasAccess: false };
  };

  const getOperatorAccessibleOrganizations = async (user: any): Promise<string[]> => {
    if (user.role === 'admin') {
      const allOrgs = await storage.getAllOrganizations();
      return allOrgs.map(o => o.id);
    }
    if (user.role !== 'operator') return [];

    if (user.assignedCategoryId) {
      const cat = await storage.getCategory(user.assignedCategoryId);
      return cat?.organizationId ? [cat.organizationId] : [];
    }

    if (user.assignedOrganizationId) {
      return [user.assignedOrganizationId];
    }

    if (user.assignedCompanyId) {
      const allOrgs = await storage.getAllOrganizations();
      return allOrgs.filter(o => o.companyId === user.assignedCompanyId).map(o => o.id);
    }

    return [];
  };

  router.get("/api/admin/categories", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const user = req.user;

    console.log(`[Categories API] User: ${user.email}, role: ${user.role}, assignedCompanyId: ${user.assignedCompanyId}, assignedOrgId: ${user.assignedOrganizationId}, assignedCatId: ${user.assignedCategoryId}`);

    let allCategories = await storage.getAllCategories();
    const organizations = await storage.getAllOrganizations();
    const companies = await storage.getAllCompanies();

    console.log(`[Categories API] Total categories: ${allCategories.length}, Total orgs: ${organizations.length}`);

    if (user.role === 'operator') {
      if (user.assignedCategoryId) {
        allCategories = allCategories.filter(cat => cat.id === user.assignedCategoryId);
        console.log(`[Categories API] Category-level filter applied: ${allCategories.length} categories`);
      } else if (user.assignedOrganizationId) {
        allCategories = allCategories.filter(cat => cat.organizationId === user.assignedOrganizationId);
        console.log(`[Categories API] Org-level filter applied: ${allCategories.length} categories`);
      } else if (user.assignedCompanyId) {
        const companyOrgIds = organizations.filter(o => o.companyId === user.assignedCompanyId).map(o => o.id);
        console.log(`[Categories API] Company ${user.assignedCompanyId} has orgs: ${companyOrgIds.join(', ')}`);
        allCategories = allCategories.filter(cat => cat.organizationId && companyOrgIds.includes(cat.organizationId));
        console.log(`[Categories API] Company-level filter applied: ${allCategories.length} categories`);
      } else {
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
  }));

  router.post("/api/admin/categories", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { name, description, organizationId, order } = req.body;
    const user = req.user;

    if (!name || name.trim() === "") {
      throw createHttpError(400, "Category name is required");
    }

    let effectiveOrganizationId = organizationId || null;
    if (user.role === 'operator') {
      const accessibleOrgIds = await getOperatorAccessibleOrganizations(user);

      if (user.assignedCategoryId) {
        throw createHttpError(403, "Category-level operators cannot create new categories");
      }

      if (user.assignedOrganizationId) {
        effectiveOrganizationId = user.assignedOrganizationId;
      } else if (user.assignedCompanyId) {
        if (!organizationId || !accessibleOrgIds.includes(organizationId)) {
          throw createHttpError(400, "Please select a valid organization within your assigned company");
        }
        effectiveOrganizationId = organizationId;
      } else {
        throw createHttpError(403, "Operator must be assigned to create categories");
      }
    }

    try {
      const category = await storage.createCategory({
        name: name.trim(),
        description: description || null,
        organizationId: effectiveOrganizationId,
        order: order || 0,
      });
      res.json(category);
    } catch (error: any) {
      if (error.message?.includes("unique") || error.code === "23505") {
        throw createHttpError(400, "Category name already exists");
      }
      throw error;
    }
  }));

  router.patch("/api/admin/categories/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const { name, description, organizationId, order, isActive } = req.body;
    const user = req.user;

    if (user.role === 'operator') {
      const accessCheck = await checkOperatorCategoryAccess(user, id);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "You cannot update this category");
      }
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (organizationId !== undefined) {
      if (user.role === 'admin') {
        updates.organizationId = organizationId;
      } else if (user.role === 'operator' && user.assignedCompanyId && !user.assignedOrganizationId && !user.assignedCategoryId) {
        const accessibleOrgIds = await getOperatorAccessibleOrganizations(user);
        if (accessibleOrgIds.includes(organizationId)) {
          updates.organizationId = organizationId;
        } else {
          throw createHttpError(403, "You can only move categories to organizations within your assigned company");
        }
      }
    }
    if (order !== undefined) updates.order = order;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) {
      throw createHttpError(400, "No valid updates provided");
    }

    try {
      const category = await storage.updateCategory(id, updates);
      res.json(category);
    } catch (error: any) {
      if (error.message?.includes("unique") || error.code === "23505") {
        throw createHttpError(400, "Category name already exists");
      }
      throw error;
    }
  }));

  router.delete("/api/admin/categories/:id", isAuthenticated, isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const user = req.user;

    if (user.role === 'operator') {
      if (user.assignedCategoryId) {
        throw createHttpError(403, "Category-level operators cannot delete categories");
      }

      const accessCheck = await checkOperatorCategoryAccess(user, id);
      if (!accessCheck.hasAccess) {
        throw createHttpError(403, accessCheck.error || "You cannot delete this category");
      }
    }

    const scenarios = await fileManager.getAllScenarios();
    const connectedScenarios = scenarios.filter((s: any) => s.categoryId === id);

    if (connectedScenarios.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete category with connected scenarios"), {
        connectedScenarios: connectedScenarios.map((s: any) => ({ id: s.id, title: s.title }))
      });
    }

    const allUsers = await storage.getAllUsers();
    const assignedOperators = allUsers.filter(u => u.assignedCategoryId === id);

    if (assignedOperators.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete category with assigned operators"), {
        assignedOperators: assignedOperators.map(u => ({ id: u.id, name: u.name, email: u.email }))
      });
    }

    await storage.deleteCategory(id);
    res.json({ success: true });
  }));

  router.get("/api/public/companies", asyncHandler(async (req, res) => {
    const companies = await storage.getAllCompanies();
    res.json(companies.map((c: any) => ({ id: c.id, name: c.name })));
  }));

  router.get("/api/public/organizations", asyncHandler(async (req, res) => {
    const companyId = req.query.companyId as string | undefined;
    const allOrgs = await storage.getAllOrganizations();
    const filtered = companyId ? allOrgs.filter((o: any) => String(o.companyId) === companyId) : allOrgs;
    res.json(filtered.map((o: any) => ({ id: o.id, name: o.name, companyId: o.companyId })));
  }));

  return router;
}
