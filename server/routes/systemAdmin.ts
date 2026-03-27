import { Router } from "express";
import { storage } from "../storage";
import { isSystemAdmin } from "../middleware/authMiddleware";

export default function createSystemAdminRouter(isAuthenticated: any) {
  const router = Router();

  // 날짜를 해당 날짜의 끝(23:59:59.999)으로 설정하는 헬퍼 함수
  const setEndOfDay = (date: Date): Date => {
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
  };

  // GET /api/system-admin/users
  router.get("/users", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      
      // 비밀번호 제외한 사용자 정보 반환
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
    } catch (error: any) {
      console.error("Error fetching all users:", error);
      res.status(500).json({ error: error.message || "Failed to fetch users" });
    }
  });

  // PATCH /api/system-admin/users/:id
  router.patch("/users/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { role, tier, isActive, assignedCompanyId, assignedOrganizationId, assignedCategoryId } = req.body;
      
      // 자기 자신의 역할 변경 방지 (안전장치)
      // @ts-ignore
      if (id === req.user?.id && role && role !== 'admin') {
        return res.status(400).json({ error: "Cannot change your own admin role" });
      }
      
      const updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedOrganizationId?: string | null; assignedCategoryId?: string | null } = {};
      
      if (role !== undefined) {
        if (!['admin', 'operator', 'user'].includes(role)) {
          return res.status(400).json({ error: "Invalid role. Must be admin, operator, or user" });
        }
        updates.role = role;
      }
      
      if (tier !== undefined) {
        if (!['bronze', 'silver', 'gold', 'platinum', 'diamond'].includes(tier)) {
          return res.status(400).json({ error: "Invalid tier" });
        }
        updates.tier = tier;
      }
      
      if (isActive !== undefined) {
        updates.isActive = isActive;
      }
      
      // 운영자 계층적 권한 할당 (회사/조직/카테고리)
      if (assignedCompanyId !== undefined) {
        updates.assignedCompanyId = assignedCompanyId;
      }
      if (assignedOrganizationId !== undefined) {
        updates.assignedOrganizationId = assignedOrganizationId;
      }
      if (assignedCategoryId !== undefined) {
        updates.assignedCategoryId = assignedCategoryId;
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
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
    } catch (error: any) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: error.message || "Failed to update user" });
    }
  });

  // POST /api/system-admin/users/:id/reset-password
  router.post("/users/:id/reset-password", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;
      
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      
      // 비밀번호 해싱
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // 사용자 비밀번호 업데이트
      const updatedUser = await storage.updateUser(id, { password: hashedPassword });
      
      res.json({
        success: true,
        message: "Password reset successfully",
        userId: updatedUser.id,
      });
    } catch (error: any) {
      console.error("Error resetting password:", error);
      res.status(500).json({ error: error.message || "Failed to reset password" });
    }
  });

  // GET /api/system-admin/companies
  router.get("/companies", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const allCompanies = await storage.getAllCompanies();
      res.json(allCompanies);
    } catch (error: any) {
      console.error("Error getting companies:", error);
      res.status(500).json({ error: error.message || "Failed to get companies" });
    }
  });

  // POST /api/system-admin/companies
  router.post("/companies", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { name, code, description, logo, isActive } = req.body;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Company name is required" });
      }
      
      const company = await storage.createCompany({
        name: name.trim(),
        code: code?.trim() || null,
        description: description || null,
        logo: logo || null,
        isActive: isActive !== false,
      });
      
      res.json(company);
    } catch (error: any) {
      console.error("Error creating company:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Company name or code already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to create company" });
      }
    }
  });

  // PATCH /api/system-admin/companies/:id
  router.patch("/companies/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, description, logo, isActive } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (code !== undefined) updates.code = code?.trim() || null;
      if (description !== undefined) updates.description = description;
      if (logo !== undefined) updates.logo = logo;
      if (isActive !== undefined) updates.isActive = isActive;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const company = await storage.updateCompany(id, updates);
      res.json(company);
    } catch (error: any) {
      console.error("Error updating company:", error);
      res.status(500).json({ error: error.message || "Failed to update company" });
    }
  });

  // DELETE /api/system-admin/companies/:id
  router.delete("/companies/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      // 해당 회사에 조직이 있는지 확인
      const organizations = await storage.getOrganizationsByCompany(id);
      if (organizations.length > 0) {
        return res.status(400).json({
          error: "Cannot delete company with organizations",
          organizations: organizations.map(o => ({ id: o.id, name: o.name })),
        });
      }
      
      await storage.deleteCompany(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting company:", error);
      res.status(500).json({ error: error.message || "Failed to delete company" });
    }
  });

  // GET /api/system-admin/companies/:companyId/organizations
  router.get("/companies/:companyId/organizations", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { companyId } = req.params;
      const organizations = await storage.getOrganizationsByCompany(companyId);
      res.json(organizations);
    } catch (error: any) {
      console.error("Error getting organizations:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });

  // GET /api/system-admin/organizations
  router.get("/organizations", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const organizations = await storage.getAllOrganizations();
      res.json(organizations);
    } catch (error: any) {
      console.error("Error getting all organizations:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });

  // POST /api/system-admin/organizations
  router.post("/organizations", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { companyId, name, code, description, isActive } = req.body;
      
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

  // PATCH /api/system-admin/organizations/:id
  router.patch("/organizations/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, description, isActive } = req.body;
      
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

  // DELETE /api/system-admin/organizations/:id
  router.delete("/organizations/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
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

  // GET /api/system-admin/users/:userId/operator-assignments
  router.get("/users/:userId/operator-assignments", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const assignments = await storage.getOperatorAssignmentsByUser(userId);
      res.json(assignments);
    } catch (error: any) {
      console.error("Error getting operator assignments:", error);
      res.status(500).json({ error: error.message || "Failed to get operator assignments" });
    }
  });

  // POST /api/system-admin/operator-assignments
  router.post("/operator-assignments", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { userId, companyId, organizationId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      if (!companyId && !organizationId) {
        return res.status(400).json({ error: "Either company ID or organization ID is required" });
      }
      
      const assignment = await storage.createOperatorAssignment({
        userId,
        companyId: companyId || null,
        organizationId: organizationId || null,
      });
      
      res.json(assignment);
    } catch (error: any) {
      console.error("Error creating operator assignment:", error);
      res.status(500).json({ error: error.message || "Failed to create operator assignment" });
    }
  });

  // DELETE /api/system-admin/operator-assignments/:id
  router.delete("/operator-assignments/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteOperatorAssignment(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting operator assignment:", error);
      res.status(500).json({ error: error.message || "Failed to delete operator assignment" });
    }
  });

  // DELETE /api/system-admin/users/:userId/operator-assignments
  router.delete("/users/:userId/operator-assignments", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      await storage.deleteOperatorAssignmentsByUser(userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting operator assignments:", error);
      res.status(500).json({ error: error.message || "Failed to delete operator assignments" });
    }
  });

  // PATCH /api/system-admin/users/:userId/organization
  router.patch("/users/:userId/organization", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { companyId, organizationId } = req.body;
      
      const user = await storage.updateUserCompanyOrganization(
        userId, 
        companyId || null, 
        organizationId || null
      );
      res.json(user);
    } catch (error: any) {
      console.error("Error updating user organization:", error);
      res.status(500).json({ error: error.message || "Failed to update user organization" });
    }
  });

  // GET /api/system-admin/settings
  router.get("/settings", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json(settings);
    } catch (error: any) {
      console.error("Error getting system settings:", error);
      res.status(500).json({ error: error.message || "Failed to get system settings" });
    }
  });

  // GET /api/system-admin/settings/:category
  router.get("/settings/:category", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { category } = req.params;
      const settings = await storage.getSystemSettingsByCategory(category);
      res.json(settings);
    } catch (error: any) {
      console.error("Error getting system settings by category:", error);
      res.status(500).json({ error: error.message || "Failed to get system settings" });
    }
  });

  // PUT /api/system-admin/settings
  router.put("/settings", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { category, key, value, description } = req.body;
      
      if (!category || !key) {
        return res.status(400).json({ error: "Category and key are required" });
      }
      
      const user = (req as any).user;
      const setting = await storage.upsertSystemSetting({
        category,
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
        description,
        updatedBy: user?.id,
      });
      
      res.json(setting);
    } catch (error: any) {
      console.error("Error saving system setting:", error);
      res.status(500).json({ error: error.message || "Failed to save system setting" });
    }
  });

  // PUT /api/system-admin/settings/batch
  router.put("/settings/batch", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { settings } = req.body;
      
      if (!Array.isArray(settings)) {
        return res.status(400).json({ error: "Settings must be an array" });
      }
      
      const user = (req as any).user;
      const savedSettings = [];
      
      for (const setting of settings) {
        const { category, key, value, description } = setting;
        
        if (!category || !key) {
          continue; // Skip invalid settings
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
    } catch (error: any) {
      console.error("Error saving system settings batch:", error);
      res.status(500).json({ error: error.message || "Failed to save system settings" });
    }
  });

  // DELETE /api/system-admin/settings/:category/:key
  router.delete("/settings/:category/:key", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { category, key } = req.params;
      await storage.deleteSystemSetting(category, key);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting system setting:", error);
      res.status(500).json({ error: error.message || "Failed to delete system setting" });
    }
  });

  // GET /api/system-admin/api-keys-status
  router.get("/api-keys-status", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const status = {
        gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        openai: !!process.env.OPENAI_API_KEY,
        elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      };
      res.json(status);
    } catch (error: any) {
      console.error("Error checking API keys status:", error);
      res.status(500).json({ error: error.message || "Failed to check API keys status" });
    }
  });

  // GET /api/system-admin/ai-usage/summary
  router.get("/ai-usage/summary", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end);
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const summary = await storage.getAiUsageSummary(start, end);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching AI usage summary:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI usage summary" });
    }
  });

  // GET /api/system-admin/ai-usage/by-feature
  router.get("/ai-usage/by-feature", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end);
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const usageByFeature = await storage.getAiUsageByFeature(start, end);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(usageByFeature);
    } catch (error: any) {
      console.error("Error fetching AI usage by feature:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI usage by feature" });
    }
  });

  // GET /api/system-admin/ai-usage/by-model
  router.get("/ai-usage/by-model", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end);
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const usageByModel = await storage.getAiUsageByModel(start, end);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(usageByModel);
    } catch (error: any) {
      console.error("Error fetching AI usage by model:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI usage by model" });
    }
  });

  // GET /api/system-admin/ai-usage/daily
  router.get("/ai-usage/daily", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end);
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const dailyUsage = await storage.getAiUsageDaily(start, end);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(dailyUsage);
    } catch (error: any) {
      console.error("Error fetching daily AI usage:", error);
      res.status(500).json({ error: error.message || "Failed to fetch daily AI usage" });
    }
  });

  // GET /api/system-admin/ai-usage/logs
  router.get("/ai-usage/logs", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate, limit } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end);
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const logLimit = limit ? parseInt(limit as string) : 100;
      
      const logs = await storage.getAiUsageLogs(start, end, logLimit);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(logs);
    } catch (error: any) {
      console.error("Error fetching AI usage logs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI usage logs" });
    }
  });

  return router;
}
