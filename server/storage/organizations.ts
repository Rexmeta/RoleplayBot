import { type Company, type InsertCompany, type Organization, type InsertOrganization, type OperatorAssignment, type InsertOperatorAssignment, type User, type Category, companies, organizations, operatorAssignments, users, scenarios, categories, scenarioRuns } from "@shared/schema";
import { db } from "./db";
import { eq, asc, desc, and, inArray } from "drizzle-orm";

export type DashboardSummary = {
  resumeScenario: { scenarioRunId: string; scenarioId: string; scenarioName: string; startedAt: Date } | null;
  lastCompletedScenario: { scenarioRunId: string; scenarioId: string; scenarioName: string; completedAt: Date; score: number | null } | null;
  recommendedScenarioId: string | null;
  isRecommendationRechallenge: boolean;
  totalCompleted: number;
  totalScenarios: number;
  averageScore: number | null;
  totalPracticeCount: number;
  categoryScores: { categoryId: string; categoryName: string; averageScore: number; count: number }[];
};

export interface IOrganizationsStorage {
  getCompany(id: string): Promise<Company | undefined>;
  getCompanyByName(name: string): Promise<Company | undefined>;
  getAllCompanies(): Promise<Company[]>;
  getActiveCompanies(): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, updates: Partial<InsertCompany>): Promise<Company>;
  deleteCompany(id: string): Promise<void>;

  getOrganization(id: string): Promise<Organization | undefined>;
  getOrganizationsByCompany(companyId: string): Promise<Organization[]>;
  getActiveOrganizationsByCompany(companyId: string): Promise<Organization[]>;
  getAllOrganizations(): Promise<Organization[]>;
  createOrganization(organization: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, updates: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: string): Promise<void>;

  getCategoriesByOrganization(organizationId: string): Promise<Category[]>;
  getActiveCategoriesByOrganization(organizationId: string): Promise<Category[]>;

  getOperatorAssignment(id: string): Promise<OperatorAssignment | undefined>;
  getOperatorAssignmentsByUser(userId: string): Promise<OperatorAssignment[]>;
  getOperatorAssignmentsByCompany(companyId: string): Promise<OperatorAssignment[]>;
  getOperatorAssignmentsByOrganization(organizationId: string): Promise<OperatorAssignment[]>;
  createOperatorAssignment(assignment: InsertOperatorAssignment): Promise<OperatorAssignment>;
  deleteOperatorAssignment(id: string): Promise<void>;
  deleteOperatorAssignmentsByUser(userId: string): Promise<void>;

  canOperatorManageCompany(userId: string, companyId: string): Promise<boolean>;
  canOperatorManageOrganization(userId: string, organizationId: string): Promise<boolean>;
  canOperatorManageCategory(userId: string, categoryId: string): Promise<boolean>;
  getOperatorManagedCompanyIds(userId: string): Promise<string[]>;
  getOperatorManagedOrganizationIds(userId: string): Promise<string[]>;
  getOperatorManagedCategoryIds(userId: string): Promise<string[]>;

  getUsersByCompany(companyId: string): Promise<User[]>;
  getUsersByOrganization(organizationId: string): Promise<User[]>;
  updateUserCompanyOrganization(userId: string, companyId: string | null, organizationId: string | null): Promise<User>;

  getDashboardSummary(userId: string, accessibleScenarioIds?: string[] | null): Promise<DashboardSummary>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

interface WithGetCategory {
  getCategory(id: string): Promise<Category | undefined>;
}

export function OrganizationsMixin<TBase extends Constructor<WithGetCategory>>(Base: TBase) {
  return class extends Base implements IOrganizationsStorage {
    async getCompany(id: string): Promise<Company | undefined> {
      const [company] = await db.select().from(companies).where(eq(companies.id, id));
      return company;
    }

    async getCompanyByName(name: string): Promise<Company | undefined> {
      const [company] = await db.select().from(companies).where(eq(companies.name, name));
      return company;
    }

    async getAllCompanies(): Promise<Company[]> {
      return await db.select().from(companies).orderBy(asc(companies.name));
    }

    async getActiveCompanies(): Promise<Company[]> {
      return await db.select().from(companies).where(eq(companies.isActive, true)).orderBy(asc(companies.name));
    }

    async createCompany(company: InsertCompany): Promise<Company> {
      const [created] = await db.insert(companies).values(company).returning();
      return created;
    }

    async updateCompany(id: string, updates: Partial<InsertCompany>): Promise<Company> {
      const [updated] = await db.update(companies).set({ ...updates, updatedAt: new Date() }).where(eq(companies.id, id)).returning();
      if (!updated) throw new Error("Company not found");
      return updated;
    }

    async deleteCompany(id: string): Promise<void> {
      await db.delete(companies).where(eq(companies.id, id));
    }

    async getOrganization(id: string): Promise<Organization | undefined> {
      const [organization] = await db.select().from(organizations).where(eq(organizations.id, id));
      return organization;
    }

    async getOrganizationsByCompany(companyId: string): Promise<Organization[]> {
      return await db.select().from(organizations).where(eq(organizations.companyId, companyId)).orderBy(asc(organizations.name));
    }

    async getActiveOrganizationsByCompany(companyId: string): Promise<Organization[]> {
      return await db.select().from(organizations).where(and(eq(organizations.companyId, companyId), eq(organizations.isActive, true))).orderBy(asc(organizations.name));
    }

    async getAllOrganizations(): Promise<Organization[]> {
      return await db.select().from(organizations).orderBy(asc(organizations.name));
    }

    async createOrganization(organization: InsertOrganization): Promise<Organization> {
      const [created] = await db.insert(organizations).values(organization).returning();
      return created;
    }

    async updateOrganization(id: string, updates: Partial<InsertOrganization>): Promise<Organization> {
      const [updated] = await db.update(organizations).set({ ...updates, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
      if (!updated) throw new Error("Organization not found");
      return updated;
    }

    async deleteOrganization(id: string): Promise<void> {
      await db.delete(organizations).where(eq(organizations.id, id));
    }

    async getCategoriesByOrganization(organizationId: string): Promise<Category[]> {
      return await db.select().from(categories).where(eq(categories.organizationId, organizationId)).orderBy(asc(categories.order));
    }

    async getActiveCategoriesByOrganization(organizationId: string): Promise<Category[]> {
      return await db.select().from(categories).where(and(eq(categories.organizationId, organizationId), eq(categories.isActive, true))).orderBy(asc(categories.order));
    }

    async getOperatorAssignment(id: string): Promise<OperatorAssignment | undefined> {
      const [assignment] = await db.select().from(operatorAssignments).where(eq(operatorAssignments.id, id));
      return assignment;
    }

    async getOperatorAssignmentsByUser(userId: string): Promise<OperatorAssignment[]> {
      return await db.select().from(operatorAssignments).where(eq(operatorAssignments.userId, userId));
    }

    async getOperatorAssignmentsByCompany(companyId: string): Promise<OperatorAssignment[]> {
      return await db.select().from(operatorAssignments).where(eq(operatorAssignments.companyId, companyId));
    }

    async getOperatorAssignmentsByOrganization(organizationId: string): Promise<OperatorAssignment[]> {
      return await db.select().from(operatorAssignments).where(eq(operatorAssignments.organizationId, organizationId));
    }

    async createOperatorAssignment(assignment: InsertOperatorAssignment): Promise<OperatorAssignment> {
      const [created] = await db.insert(operatorAssignments).values(assignment).returning();
      return created;
    }

    async deleteOperatorAssignment(id: string): Promise<void> {
      await db.delete(operatorAssignments).where(eq(operatorAssignments.id, id));
    }

    async deleteOperatorAssignmentsByUser(userId: string): Promise<void> {
      await db.delete(operatorAssignments).where(eq(operatorAssignments.userId, userId));
    }

    async canOperatorManageCompany(userId: string, companyId: string): Promise<boolean> {
      const assignments = await this.getOperatorAssignmentsByUser(userId);
      return assignments.some(a => a.companyId === companyId && !a.organizationId);
    }

    async canOperatorManageOrganization(userId: string, organizationId: string): Promise<boolean> {
      const assignments = await this.getOperatorAssignmentsByUser(userId);
      if (assignments.some(a => a.organizationId === organizationId)) return true;
      const organization = await this.getOrganization(organizationId);
      if (organization) return assignments.some(a => a.companyId === organization.companyId && !a.organizationId);
      return false;
    }

    async canOperatorManageCategory(userId: string, categoryId: string): Promise<boolean> {
      const category = await this.getCategory(categoryId);
      if (!category || !category.organizationId) return false;
      return this.canOperatorManageOrganization(userId, category.organizationId);
    }

    async getOperatorManagedCompanyIds(userId: string): Promise<string[]> {
      const assignments = await this.getOperatorAssignmentsByUser(userId);
      return assignments.filter(a => a.companyId && !a.organizationId).map(a => a.companyId as string);
    }

    async getOperatorManagedOrganizationIds(userId: string): Promise<string[]> {
      const assignments = await this.getOperatorAssignmentsByUser(userId);
      const managedOrgIds: string[] = [];
      assignments.forEach(a => { if (a.organizationId) managedOrgIds.push(a.organizationId); });
      for (const assignment of assignments) {
        if (assignment.companyId && !assignment.organizationId) {
          const orgs = await this.getOrganizationsByCompany(assignment.companyId);
          orgs.forEach(org => { if (!managedOrgIds.includes(org.id)) managedOrgIds.push(org.id); });
        }
      }
      return managedOrgIds;
    }

    async getOperatorManagedCategoryIds(userId: string): Promise<string[]> {
      const managedOrgIds = await this.getOperatorManagedOrganizationIds(userId);
      const categoryIds: string[] = [];
      for (const orgId of managedOrgIds) {
        const cats = await this.getCategoriesByOrganization(orgId);
        cats.forEach(cat => categoryIds.push(cat.id));
      }
      return categoryIds;
    }

    async getUsersByCompany(companyId: string): Promise<User[]> {
      return await db.select().from(users).where(eq(users.companyId, companyId)).orderBy(asc(users.name));
    }

    async getUsersByOrganization(organizationId: string): Promise<User[]> {
      return await db.select().from(users).where(eq(users.organizationId, organizationId)).orderBy(asc(users.name));
    }

    async updateUserCompanyOrganization(userId: string, companyId: string | null, organizationId: string | null): Promise<User> {
      const [updated] = await db.update(users).set({ companyId, organizationId, updatedAt: new Date() }).where(eq(users.id, userId)).returning();
      if (!updated) throw new Error("User not found");
      return updated;
    }

    async getDashboardSummary(userId: string, accessibleScenarioIds?: string[] | null): Promise<DashboardSummary> {
      const allUserScenarioRunsRaw = await db.select().from(scenarioRuns).where(eq(scenarioRuns.userId, userId)).orderBy(desc(scenarioRuns.startedAt));
      const allUserScenarioRuns = allUserScenarioRunsRaw.filter(sr => sr.scenarioId !== '__free_chat__');

      let allScopeScenarios: { id: string; categoryId: string | null }[];
      if (accessibleScenarioIds) {
        const dbScenarios = await db
          .select({ id: scenarios.id, categoryId: scenarios.categoryId })
          .from(scenarios)
          .where(and(eq(scenarios.isDeleted, false), inArray(scenarios.id, accessibleScenarioIds.length > 0 ? accessibleScenarioIds : ['__none__'])));
        allScopeScenarios = dbScenarios;
      } else {
        allScopeScenarios = await db.select({ id: scenarios.id, categoryId: scenarios.categoryId }).from(scenarios).where(eq(scenarios.isDeleted, false));
      }
      const totalScenarios = allScopeScenarios.length;
      const scopeScenarioIdSet = new Set(allScopeScenarios.map(s => s.id));

      const userScenarioRuns = accessibleScenarioIds !== null && accessibleScenarioIds !== undefined
        ? allUserScenarioRuns.filter(sr => scopeScenarioIdSet.has(sr.scenarioId))
        : allUserScenarioRuns;

      const completedRuns = userScenarioRuns.filter(sr => sr.status === 'completed');
      const activeRuns = userScenarioRuns.filter(sr => sr.status === 'active' || sr.status === 'in_progress');

      const resumeRun = activeRuns.length > 0 ? activeRuns[0] : null;
      const resumeScenario = resumeRun
        ? { scenarioRunId: resumeRun.id, scenarioId: resumeRun.scenarioId, scenarioName: resumeRun.scenarioName, startedAt: resumeRun.startedAt }
        : null;

      const completedRunsSortedByCompletion = [...completedRuns].filter(sr => sr.completedAt !== null).sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());
      const lastCompleted = completedRunsSortedByCompletion.length > 0 ? completedRunsSortedByCompletion[0] : null;
      const lastCompletedScenario = lastCompleted
        ? { scenarioRunId: lastCompleted.id, scenarioId: lastCompleted.scenarioId, scenarioName: lastCompleted.scenarioName, completedAt: lastCompleted.completedAt!, score: lastCompleted.totalScore ?? null }
        : null;

      const totalPracticeCount = userScenarioRuns.length;
      const totalCompleted = new Set(completedRuns.map(sr => sr.scenarioId)).size;

      const scoresWithValues = completedRuns.filter(sr => sr.totalScore !== null && sr.totalScore !== undefined);
      const averageScore = scoresWithValues.length > 0
        ? Math.round(scoresWithValues.reduce((sum, sr) => sum + (sr.totalScore || 0), 0) / scoresWithValues.length)
        : null;

      const completedScenarioIds = new Set(completedRuns.map(sr => sr.scenarioId));
      const lowestScoreByScenario = new Map<string, number>();
      for (const sr of completedRuns) {
        if (sr.totalScore !== null && sr.totalScore !== undefined) {
          const prev = lowestScoreByScenario.get(sr.scenarioId);
          if (prev === undefined || sr.totalScore < prev) lowestScoreByScenario.set(sr.scenarioId, sr.totalScore);
        }
      }

      let recommendedScenarioId: string | null = null;
      let isRecommendationRechallenge = false;
      const notCompletedScenarios = allScopeScenarios.filter(s => !completedScenarioIds.has(s.id));
      if (notCompletedScenarios.length > 0) {
        const categoryGroups = new Map<string, string>();
        for (const scenario of notCompletedScenarios) {
          const catKey = scenario.categoryId || 'uncategorized';
          if (!categoryGroups.has(catKey)) categoryGroups.set(catKey, scenario.id);
        }
        const categoryKeys = Array.from(categoryGroups.keys());
        const completedCategories = new Set(allScopeScenarios.filter(s => completedScenarioIds.has(s.id)).map(s => s.categoryId || 'uncategorized'));
        const untriedCategory = categoryKeys.find(c => !completedCategories.has(c));
        const pickedCategory = untriedCategory || categoryKeys[0];
        recommendedScenarioId = categoryGroups.get(pickedCategory) || null;
        isRecommendationRechallenge = false;
      } else if (lowestScoreByScenario.size > 0) {
        let minScore = Infinity;
        let minId: string | null = null;
        Array.from(lowestScoreByScenario.entries()).forEach(([id, score]) => {
          if (score < minScore) { minScore = score; minId = id; }
        });
        if (minId && scopeScenarioIdSet.has(minId)) {
          recommendedScenarioId = minId;
          isRecommendationRechallenge = true;
        }
      }

      const categoryScoreMap = new Map<string, { total: number; count: number; name: string }>();
      if (completedRuns.length > 0) {
        const completedScenarioIdsList = Array.from(new Set(completedRuns.map(sr => sr.scenarioId)));
        const scenarioCategories = await db.select({ id: scenarios.id, categoryId: scenarios.categoryId }).from(scenarios).where(inArray(scenarios.id, completedScenarioIdsList));
        const scenarioCategoryMap = new Map(scenarioCategories.map(s => [s.id, s.categoryId]));
        const catIds = Array.from(new Set(scenarioCategories.map(s => s.categoryId).filter(Boolean))) as string[];
        let catNameMap = new Map<string, string>();
        if (catIds.length > 0) {
          const catRows = await db.select({ id: categories.id, name: categories.name }).from(categories).where(inArray(categories.id, catIds));
          catNameMap = new Map(catRows.map(c => [c.id, c.name]));
        }
        for (const sr of completedRuns) {
          if (sr.totalScore === null || sr.totalScore === undefined) continue;
          const catId = scenarioCategoryMap.get(sr.scenarioId) || 'uncategorized';
          const catName = catId !== 'uncategorized' ? (catNameMap.get(catId) || catId) : '기타';
          const existing = categoryScoreMap.get(catId) || { total: 0, count: 0, name: catName };
          existing.total += sr.totalScore;
          existing.count += 1;
          categoryScoreMap.set(catId, existing);
        }
      }

      const categoryScores = Array.from(categoryScoreMap.entries()).map(([categoryId, data]) => ({
        categoryId,
        categoryName: data.name,
        averageScore: Math.round(data.total / data.count),
        count: data.count,
      })).sort((a, b) => b.averageScore - a.averageScore);

      return { resumeScenario, lastCompletedScenario, recommendedScenarioId, isRecommendationRechallenge, totalCompleted, totalScenarios, averageScore, totalPracticeCount, categoryScores };
    }
  };
}

export class MemOrganizationsStorage implements IOrganizationsStorage {
  async getCompany(_: string): Promise<Company | undefined> { return undefined; }
  async getCompanyByName(_: string): Promise<Company | undefined> { return undefined; }
  async getAllCompanies(): Promise<Company[]> { return []; }
  async getActiveCompanies(): Promise<Company[]> { return []; }
  async createCompany(_: InsertCompany): Promise<Company> { throw new Error("Not implemented"); }
  async updateCompany(_: string, __: Partial<InsertCompany>): Promise<Company> { throw new Error("Not implemented"); }
  async deleteCompany(_: string): Promise<void> {}
  async getOrganization(_: string): Promise<Organization | undefined> { return undefined; }
  async getOrganizationsByCompany(_: string): Promise<Organization[]> { return []; }
  async getActiveOrganizationsByCompany(_: string): Promise<Organization[]> { return []; }
  async getAllOrganizations(): Promise<Organization[]> { return []; }
  async createOrganization(_: InsertOrganization): Promise<Organization> { throw new Error("Not implemented"); }
  async updateOrganization(_: string, __: Partial<InsertOrganization>): Promise<Organization> { throw new Error("Not implemented"); }
  async deleteOrganization(_: string): Promise<void> {}
  async getCategoriesByOrganization(_: string): Promise<Category[]> { return []; }
  async getActiveCategoriesByOrganization(_: string): Promise<Category[]> { return []; }
  async getOperatorAssignment(_: string): Promise<OperatorAssignment | undefined> { return undefined; }
  async getOperatorAssignmentsByUser(_: string): Promise<OperatorAssignment[]> { return []; }
  async getOperatorAssignmentsByCompany(_: string): Promise<OperatorAssignment[]> { return []; }
  async getOperatorAssignmentsByOrganization(_: string): Promise<OperatorAssignment[]> { return []; }
  async createOperatorAssignment(_: InsertOperatorAssignment): Promise<OperatorAssignment> { throw new Error("Not implemented"); }
  async deleteOperatorAssignment(_: string): Promise<void> {}
  async deleteOperatorAssignmentsByUser(_: string): Promise<void> {}
  async canOperatorManageCompany(_: string, __: string): Promise<boolean> { return false; }
  async canOperatorManageOrganization(_: string, __: string): Promise<boolean> { return false; }
  async canOperatorManageCategory(_: string, __: string): Promise<boolean> { return false; }
  async getOperatorManagedCompanyIds(_: string): Promise<string[]> { return []; }
  async getOperatorManagedOrganizationIds(_: string): Promise<string[]> { return []; }
  async getOperatorManagedCategoryIds(_: string): Promise<string[]> { return []; }
  async getUsersByCompany(_: string): Promise<User[]> { return []; }
  async getUsersByOrganization(_: string): Promise<User[]> { return []; }
  async updateUserCompanyOrganization(_: string, __: string | null, ___: string | null): Promise<User> { throw new Error("Not implemented"); }
  async getDashboardSummary(_userId: string, _accessibleScenarioIds?: string[] | null): Promise<DashboardSummary> {
    return { resumeScenario: null, lastCompletedScenario: null, recommendedScenarioId: null, isRecommendationRechallenge: false, totalCompleted: 0, totalScenarios: 0, averageScore: null, totalPracticeCount: 0, categoryScores: [] };
  }
}
