import { Router } from "express";
import { storage } from "../storage";
import { isSystemAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";

export default function createSystemAdminRouter(isAuthenticated: any) {
  const router = Router();

  const setEndOfDay = (date: Date): Date => {
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
  };

  router.get("/users", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const allUsers = await storage.getAllUsers();

    const usersWithoutPassword = allUsers.map(user => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tier: user.tier,
      isActive: user.isActive ?? true,
      profileImage: user.profileImage,
      lastLoginAt: user.lastLoginAt,
      assignedCompanyId: user.assignedCompanyId,
      assignedOrganizationId: user.assignedOrganizationId,
      assignedCategoryId: user.assignedCategoryId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }));

    res.json(usersWithoutPassword);
  }));

  router.patch("/users/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
    const { id } = req.params;
    const { role, tier, isActive, assignedCompanyId, assignedOrganizationId, assignedCategoryId } = req.body;

    if (id === req.user?.id && role && role !== 'admin') {
      throw createHttpError(400, "Cannot change your own admin role");
    }

    const updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedOrganizationId?: string | null; assignedCategoryId?: string | null } = {};

    if (role !== undefined) {
      if (!['admin', 'operator', 'user'].includes(role)) {
        throw createHttpError(400, "Invalid role. Must be admin, operator, or user");
      }
      updates.role = role;
    }

    if (tier !== undefined) {
      if (!['bronze', 'silver', 'gold', 'platinum', 'diamond'].includes(tier)) {
        throw createHttpError(400, "Invalid tier");
      }
      updates.tier = tier;
    }

    if (isActive !== undefined) {
      updates.isActive = isActive;
    }

    if (assignedCompanyId !== undefined) updates.assignedCompanyId = assignedCompanyId;
    if (assignedOrganizationId !== undefined) updates.assignedOrganizationId = assignedOrganizationId;
    if (assignedCategoryId !== undefined) updates.assignedCategoryId = assignedCategoryId;

    if (Object.keys(updates).length === 0) {
      throw createHttpError(400, "No valid updates provided");
    }

    const updatedUser = await storage.adminUpdateUser(id, updates);

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      tier: updatedUser.tier,
      isActive: updatedUser.isActive ?? true,
      profileImage: updatedUser.profileImage,
      lastLoginAt: updatedUser.lastLoginAt,
      assignedCompanyId: updatedUser.assignedCompanyId,
      assignedOrganizationId: updatedUser.assignedOrganizationId,
      assignedCategoryId: updatedUser.assignedCategoryId,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
    });
  }));

  router.post("/users/:id/reset-password", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      throw createHttpError(400, "Password must be at least 6 characters");
    }

    const bcrypt = await import("bcryptjs");
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await storage.updateUser(id, { password: hashedPassword });

    res.json({
      success: true,
      message: "Password reset successfully",
      userId: updatedUser.id,
    });
  }));

  router.get("/companies", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const allCompanies = await storage.getAllCompanies();
    res.json(allCompanies);
  }));

  router.post("/companies", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { name, code, description, logo, isActive } = req.body;

    if (!name || name.trim() === "") {
      throw createHttpError(400, "Company name is required");
    }

    const company = await storage.createCompany({
      name: name.trim(),
      code: code?.trim() || null,
      description: description || null,
      logo: logo || null,
      isActive: isActive !== false,
    });

    res.json(company);
  }));

  router.patch("/companies/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, code, description, logo, isActive } = req.body;

    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (code !== undefined) updates.code = code?.trim() || null;
    if (description !== undefined) updates.description = description;
    if (logo !== undefined) updates.logo = logo;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) {
      throw createHttpError(400, "No valid updates provided");
    }

    const company = await storage.updateCompany(id, updates);
    res.json(company);
  }));

  router.delete("/companies/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const organizations = await storage.getOrganizationsByCompany(id);
    if (organizations.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete company with organizations"), {
        organizations: organizations.map(o => ({ id: o.id, name: o.name }))
      });
    }

    await storage.deleteCompany(id);
    res.json({ success: true });
  }));

  router.get("/companies/:companyId/organizations", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const organizations = await storage.getOrganizationsByCompany(companyId);
    res.json(organizations);
  }));

  router.get("/organizations", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const organizations = await storage.getAllOrganizations();
    res.json(organizations);
  }));

  router.post("/organizations", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { companyId, name, code, description, isActive } = req.body;

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

  router.patch("/organizations/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, code, description, isActive } = req.body;

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

  router.delete("/organizations/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;

    const categories = await storage.getCategoriesByOrganization(id);
    if (categories.length > 0) {
      throw Object.assign(createHttpError(400, "Cannot delete organization with categories"), {
        categories: categories.map(c => ({ id: c.id, name: c.name }))
      });
    }

    await storage.deleteOrganization(id);
    res.json({ success: true });
  }));

  router.get("/users/:userId/operator-assignments", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const assignments = await storage.getOperatorAssignmentsByUser(userId);
    res.json(assignments);
  }));

  router.post("/operator-assignments", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { userId, companyId, organizationId } = req.body;

    if (!userId) {
      throw createHttpError(400, "User ID is required");
    }
    if (!companyId && !organizationId) {
      throw createHttpError(400, "Either company ID or organization ID is required");
    }

    const assignment = await storage.createOperatorAssignment({
      userId,
      companyId: companyId || null,
      organizationId: organizationId || null,
    });

    res.json(assignment);
  }));

  router.delete("/operator-assignments/:id", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    await storage.deleteOperatorAssignment(id);
    res.json({ success: true });
  }));

  router.delete("/users/:userId/operator-assignments", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    await storage.deleteOperatorAssignmentsByUser(userId);
    res.json({ success: true });
  }));

  router.patch("/users/:userId/organization", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { companyId, organizationId } = req.body;

    const user = await storage.updateUserCompanyOrganization(
      userId,
      companyId || null,
      organizationId || null
    );
    res.json(user);
  }));

  router.get("/settings", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const settings = await storage.getSystemSettings();
    res.json(settings);
  }));

  router.get("/settings/:category", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { category } = req.params;
    const settings = await storage.getSystemSettingsByCategory(category);
    res.json(settings);
  }));

  router.put("/settings", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
    const { category, key, value, description } = req.body;

    if (!category || !key) {
      throw createHttpError(400, "Category and key are required");
    }

    const user = req.user;
    const setting = await storage.upsertSystemSetting({
      category,
      key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
      description,
      updatedBy: user?.id,
    });

    res.json(setting);
  }));

  router.put("/settings/batch", isAuthenticated, isSystemAdmin, asyncHandler(async (req: any, res) => {
    const { settings } = req.body;

    if (!Array.isArray(settings)) {
      throw createHttpError(400, "Settings must be an array");
    }

    const user = req.user;
    const savedSettings = [];

    for (const setting of settings) {
      const { category, key, value, description } = setting;

      if (!category || !key) {
        continue;
      }

      const saved = await storage.upsertSystemSetting({
        category,
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
        description,
        updatedBy: user?.id,
      });
      savedSettings.push(saved);
    }

    res.json(savedSettings);
  }));

  router.delete("/settings/:category/:key", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { category, key } = req.params;
    await storage.deleteSystemSetting(category, key);
    res.json({ success: true });
  }));

  router.get("/api-keys-status", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const status = {
      gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      openai: !!process.env.OPENAI_API_KEY,
      elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    };
    res.json(status);
  }));

  router.get("/ai-usage/summary", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    let end = endDate ? new Date(endDate as string) : new Date();
    end = setEndOfDay(end);
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const summary = await storage.getAiUsageSummary(start, end);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(summary);
  }));

  router.get("/ai-usage/by-feature", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    let end = endDate ? new Date(endDate as string) : new Date();
    end = setEndOfDay(end);
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const usageByFeature = await storage.getAiUsageByFeature(start, end);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(usageByFeature);
  }));

  router.get("/ai-usage/by-model", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    let end = endDate ? new Date(endDate as string) : new Date();
    end = setEndOfDay(end);
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const usageByModel = await storage.getAiUsageByModel(start, end);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(usageByModel);
  }));

  router.get("/ai-usage/daily", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    let end = endDate ? new Date(endDate as string) : new Date();
    end = setEndOfDay(end);
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const dailyUsage = await storage.getAiUsageDaily(start, end);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(dailyUsage);
  }));

  router.get("/ai-usage/logs", isAuthenticated, isSystemAdmin, asyncHandler(async (req, res) => {
    const { startDate, endDate, limit } = req.query;

    let end = endDate ? new Date(endDate as string) : new Date();
    end = setEndOfDay(end);
    const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const logLimit = limit ? parseInt(limit as string) : 100;

    const logs = await storage.getAiUsageLogs(start, end, logLimit);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(logs);
  }));

  return router;
}
