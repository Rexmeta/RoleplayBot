export { db, pool, checkDatabaseConnection } from "./db";

import { ConversationsMixin, MemConversationsStorage } from "./conversations";
import { SessionsMixin, MemSessionsStorage } from "./sessions";
import { UsersMixin, MemUsersStorage } from "./users";
import { CategoriesMixin, MemCategoriesStorage } from "./categories";
import { SettingsMixin, MemSettingsStorage } from "./settings";
import { AnalyticsMixin, MemAnalyticsStorage } from "./analytics";
import { TranslationsMixin, MemTranslationsStorage } from "./translations";
import { ScenariosMixin, MemScenariosStorage } from "./scenarios";
import { PersonasMixin, MemPersonasStorage } from "./personas";
import { OrganizationsMixin, MemOrganizationsStorage } from "./organizations";

export type { IConversationsStorage } from "./conversations";
export type { ISessionsStorage } from "./sessions";
export type { IUsersStorage } from "./users";
export type { ICategoriesStorage } from "./categories";
export type { ISettingsStorage } from "./settings";
export type { IAnalyticsStorage } from "./analytics";
export type { ITranslationsStorage } from "./translations";
export type { IScenariosStorage } from "./scenarios";
export type { IPersonasStorage } from "./personas";
export type { IOrganizationsStorage } from "./organizations";

import type { IConversationsStorage } from "./conversations";
import type { ISessionsStorage } from "./sessions";
import type { IUsersStorage } from "./users";
import type { ICategoriesStorage } from "./categories";
import type { ISettingsStorage } from "./settings";
import type { IAnalyticsStorage } from "./analytics";
import type { ITranslationsStorage } from "./translations";
import type { IScenariosStorage } from "./scenarios";
import type { IPersonasStorage } from "./personas";
import type { IOrganizationsStorage } from "./organizations";

import type {
  Conversation, InsertConversation, Feedback, InsertFeedback,
  PersonaSelection, StrategyChoice, SequenceAnalysis,
  ScenarioRun, InsertScenarioRun, PersonaRun, InsertPersonaRun,
  ChatMessage, InsertChatMessage,
  User, UpsertUser,
  Category, InsertCategory, UserBookmark, ScenarioStats,
  SystemSetting,
  AiUsageLog, InsertAiUsageLog, AiUsageSummary, AiUsageByFeature, AiUsageByModel, AiUsageDaily,
  EvaluationCriteriaSet, InsertEvaluationCriteriaSet,
  EvaluationDimension, InsertEvaluationDimension,
  EvaluationCriteriaSetWithDimensions,
  SupportedLanguage, InsertSupportedLanguage,
  ScenarioTranslation, InsertScenarioTranslation,
  PersonaTranslation, InsertPersonaTranslation,
  CategoryTranslation, InsertCategoryTranslation,
  EvaluationCriteriaSetTranslation, InsertEvaluationCriteriaSetTranslation,
  EvaluationDimensionTranslation, InsertEvaluationDimensionTranslation,
  Scenario, InsertScenario, MbtiPersona, InsertMbtiPersona,
  UserPersona, InsertUserPersona, PersonaUserScene, InsertPersonaUserScene,
  Company, InsertCompany, Organization, InsertOrganization,
  OperatorAssignment, InsertOperatorAssignment,
} from "@shared/schema";

import type { ScenarioRunWithPersonaRuns, EmotionStat, EmotionStatByScenario, EmotionStatByMbti, EmotionStatByDifficulty, EmotionTimeline } from "./sessions";
import type { DashboardSummary } from "./organizations";

export interface IStorage extends
  IConversationsStorage,
  ISessionsStorage,
  IUsersStorage,
  ICategoriesStorage,
  ISettingsStorage,
  IAnalyticsStorage,
  ITranslationsStorage,
  IScenariosStorage,
  IPersonasStorage,
  IOrganizationsStorage {}

const CombinedBase = OrganizationsMixin(
  PersonasMixin(
    ScenariosMixin(
      TranslationsMixin(
        AnalyticsMixin(
          SettingsMixin(
            CategoriesMixin(
              SessionsMixin(
                UsersMixin(
                  ConversationsMixin(class {})
                )
              )
            )
          )
        )
      )
    )
  )
);

export class PostgreSQLStorage extends CombinedBase implements IStorage {}

export class MemStorage implements IStorage {
  private conv: MemConversationsStorage;
  private sess: MemSessionsStorage;
  private usr: MemUsersStorage;
  private cat: MemCategoriesStorage;
  private sett: MemSettingsStorage;
  private anal: MemAnalyticsStorage;
  private trans: MemTranslationsStorage;
  private scen: MemScenariosStorage;
  private pers: MemPersonasStorage;
  private org: MemOrganizationsStorage;

  constructor() {
    this.conv = new MemConversationsStorage();
    this.sess = new MemSessionsStorage();
    this.usr = new MemUsersStorage();
    this.cat = new MemCategoriesStorage();
    this.sett = new MemSettingsStorage();
    this.anal = new MemAnalyticsStorage();
    this.trans = new MemTranslationsStorage();
    this.scen = new MemScenariosStorage();
    this.pers = new MemPersonasStorage();
    this.org = new MemOrganizationsStorage();
  }

  // ── Conversations ──────────────────────────────────────────────────────────
  createConversation(c: InsertConversation): Promise<Conversation> { return this.conv.createConversation(c); }
  getConversation(id: string): Promise<Conversation | undefined> { return this.conv.getConversation(id); }
  updateConversation(id: string, u: Partial<Conversation>): Promise<Conversation> { return this.conv.updateConversation(id, u); }
  deleteConversation(id: string): Promise<void> { return this.conv.deleteConversation(id); }
  getAllConversations(): Promise<Conversation[]> { return this.conv.getAllConversations(); }
  getUserConversations(uid: string): Promise<Conversation[]> { return this.conv.getUserConversations(uid); }
  createFeedback(f: InsertFeedback): Promise<Feedback> { return this.conv.createFeedback(f); }
  getFeedbackByConversationId(cid: string): Promise<Feedback | undefined> { return this.conv.getFeedbackByConversationId(cid); }
  deleteFeedback(id: string): Promise<void> { return this.conv.deleteFeedback(id); }
  getAllFeedbacks(): Promise<Feedback[]> { return this.conv.getAllFeedbacks(); }
  getUserFeedbacks(uid: string): Promise<Feedback[]> { return this.conv.getUserFeedbacks(uid); }
  addPersonaSelection(cid: string, s: PersonaSelection): Promise<Conversation> { return this.conv.addPersonaSelection(cid, s); }
  getPersonaSelections(cid: string): Promise<PersonaSelection[]> { return this.conv.getPersonaSelections(cid); }
  addStrategyChoice(cid: string, c: StrategyChoice): Promise<Conversation> { return this.conv.addStrategyChoice(cid, c); }
  getStrategyChoices(cid: string): Promise<StrategyChoice[]> { return this.conv.getStrategyChoices(cid); }
  saveSequenceAnalysis(cid: string, a: SequenceAnalysis): Promise<Conversation> { return this.conv.saveSequenceAnalysis(cid, a); }
  getSequenceAnalysis(cid: string): Promise<SequenceAnalysis | undefined> { return this.conv.getSequenceAnalysis(cid); }
  saveStrategyReflection(cid: string, r: string, co: string[]): Promise<Conversation> { return this.conv.saveStrategyReflection(cid, r, co); }

  // ── Sessions ───────────────────────────────────────────────────────────────
  createScenarioRun(s: InsertScenarioRun): Promise<ScenarioRun> { return this.sess.createScenarioRun(s); }
  getScenarioRun(id: string): Promise<ScenarioRun | undefined> { return this.sess.getScenarioRun(id); }
  updateScenarioRun(id: string, u: Partial<ScenarioRun>): Promise<ScenarioRun> { return this.sess.updateScenarioRun(id, u); }
  getUserScenarioRuns(uid: string): Promise<ScenarioRun[]> { return this.sess.getUserScenarioRuns(uid); }
  getAllScenarioRuns(): Promise<ScenarioRun[]> { return this.sess.getAllScenarioRuns(); }
  findActiveScenarioRun(uid: string, sid: string): Promise<ScenarioRun | undefined> { return this.sess.findActiveScenarioRun(uid, sid); }
  getUserScenarioRunsWithPersonaRuns(uid: string): Promise<ScenarioRunWithPersonaRuns[]> { return this.sess.getUserScenarioRunsWithPersonaRuns(uid); }
  getScenarioRunWithPersonaRuns(id: string): Promise<ScenarioRunWithPersonaRuns | undefined> { return this.sess.getScenarioRunWithPersonaRuns(id); }
  createPersonaRun(p: InsertPersonaRun): Promise<PersonaRun> { return this.sess.createPersonaRun(p); }
  getPersonaRun(id: string): Promise<PersonaRun | undefined> { return this.sess.getPersonaRun(id); }
  getPersonaRunByConversationId(cid: string): Promise<PersonaRun | undefined> { return this.sess.getPersonaRunByConversationId(cid); }
  updatePersonaRun(id: string, u: Partial<PersonaRun>): Promise<PersonaRun> { return this.sess.updatePersonaRun(id, u); }
  getPersonaRunsByScenarioRun(srid: string): Promise<PersonaRun[]> { return this.sess.getPersonaRunsByScenarioRun(srid); }
  getAllPersonaRuns(): Promise<PersonaRun[]> { return this.sess.getAllPersonaRuns(); }
  createChatMessage(m: InsertChatMessage): Promise<ChatMessage> { return this.sess.createChatMessage(m); }
  getChatMessagesByPersonaRun(pid: string): Promise<ChatMessage[]> { return this.sess.getChatMessagesByPersonaRun(pid); }
  deleteChatMessagesByPersonaRun(pid: string): Promise<void> { return this.sess.deleteChatMessagesByPersonaRun(pid); }
  getAllEmotionStats(sids?: string[]): Promise<EmotionStat[]> { return this.sess.getAllEmotionStats(sids); }
  getEmotionStatsByScenario(sids?: string[]): Promise<EmotionStatByScenario[]> { return this.sess.getEmotionStatsByScenario(sids); }
  getEmotionStatsByMbti(sids?: string[]): Promise<EmotionStatByMbti[]> { return this.sess.getEmotionStatsByMbti(sids); }
  getEmotionStatsByDifficulty(sids?: string[]): Promise<EmotionStatByDifficulty[]> { return this.sess.getEmotionStatsByDifficulty(sids); }
  getEmotionTimelineByPersonaRun(pid: string): Promise<EmotionTimeline[]> { return this.sess.getEmotionTimelineByPersonaRun(pid); }
  deleteScenarioRun(id: string): Promise<void> { return this.sess.deleteScenarioRun(id); }

  // ── Users ──────────────────────────────────────────────────────────────────
  getUser(id: string): Promise<User | undefined> { return this.usr.getUser(id); }
  getUserByEmail(e: string): Promise<User | undefined> { return this.usr.getUserByEmail(e); }
  createUser(u: { email: string; password: string; name: string; assignedCategoryId?: string | null; companyId?: string | null; organizationId?: string | null; preferredLanguage?: string }): Promise<User> { return this.usr.createUser(u); }
  updateUser(id: string, u: { name?: string; password?: string; profileImage?: string; tier?: string }): Promise<User> { return this.usr.updateUser(id, u); }
  updateUserLanguage(id: string, l: string): Promise<User> { return this.usr.updateUserLanguage(id, l); }
  upsertUser(u: UpsertUser): Promise<User> { return this.usr.upsertUser(u); }
  updateUserLastLogin(id: string): Promise<void> { return this.usr.updateUserLastLogin(id); }
  getAllUsers(): Promise<User[]> { return this.usr.getAllUsers(); }
  adminUpdateUser(id: string, u: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedCategoryId?: string | null; assignedOrganizationId?: string | null }): Promise<User> { return this.usr.adminUpdateUser(id, u); }

  // ── Categories ─────────────────────────────────────────────────────────────
  createCategory(c: InsertCategory): Promise<Category> { return this.cat.createCategory(c); }
  getCategory(id: string): Promise<Category | undefined> { return this.cat.getCategory(id); }
  getAllCategories(): Promise<Category[]> { return this.cat.getAllCategories(); }
  updateCategory(id: string, u: Partial<InsertCategory>): Promise<Category> { return this.cat.updateCategory(id, u); }
  deleteCategory(id: string): Promise<void> { return this.cat.deleteCategory(id); }
  addBookmark(uid: string, sid: string): Promise<UserBookmark> { return this.cat.addBookmark(uid, sid); }
  removeBookmark(uid: string, sid: string): Promise<void> { return this.cat.removeBookmark(uid, sid); }
  getUserBookmarks(uid: string): Promise<UserBookmark[]> { return this.cat.getUserBookmarks(uid); }
  getScenarioStats(sids?: string[]): Promise<ScenarioStats[]> { return this.cat.getScenarioStats(sids); }

  // ── Settings ───────────────────────────────────────────────────────────────
  getSystemSettings(): Promise<SystemSetting[]> { return this.sett.getSystemSettings(); }
  getSystemSettingsByCategory(c: string): Promise<SystemSetting[]> { return this.sett.getSystemSettingsByCategory(c); }
  getSystemSetting(c: string, k: string): Promise<SystemSetting | undefined> { return this.sett.getSystemSetting(c, k); }
  upsertSystemSetting(s: { category: string; key: string; value: string; description?: string; updatedBy?: string }): Promise<SystemSetting> { return this.sett.upsertSystemSetting(s); }
  deleteSystemSetting(c: string, k: string): Promise<void> { return this.sett.deleteSystemSetting(c, k); }

  // ── Analytics ──────────────────────────────────────────────────────────────
  createAiUsageLog(l: InsertAiUsageLog): Promise<AiUsageLog> { return this.anal.createAiUsageLog(l); }
  getAiUsageSummary(s: Date, e: Date): Promise<AiUsageSummary> { return this.anal.getAiUsageSummary(s, e); }
  getAiUsageByFeature(s: Date, e: Date): Promise<AiUsageByFeature[]> { return this.anal.getAiUsageByFeature(s, e); }
  getAiUsageByModel(s: Date, e: Date): Promise<AiUsageByModel[]> { return this.anal.getAiUsageByModel(s, e); }
  getAiUsageDaily(s: Date, e: Date): Promise<AiUsageDaily[]> { return this.anal.getAiUsageDaily(s, e); }
  getAiUsageLogs(s: Date, e: Date, l?: number): Promise<AiUsageLog[]> { return this.anal.getAiUsageLogs(s, e, l); }
  createEvaluationCriteriaSet(c: InsertEvaluationCriteriaSet): Promise<EvaluationCriteriaSet> { return this.anal.createEvaluationCriteriaSet(c); }
  getEvaluationCriteriaSet(id: string): Promise<EvaluationCriteriaSet | undefined> { return this.anal.getEvaluationCriteriaSet(id); }
  getAllEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> { return this.anal.getAllEvaluationCriteriaSets(); }
  getActiveEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> { return this.anal.getActiveEvaluationCriteriaSets(); }
  getDefaultEvaluationCriteriaSet(): Promise<EvaluationCriteriaSet | undefined> { return this.anal.getDefaultEvaluationCriteriaSet(); }
  getEvaluationCriteriaSetByCategory(cid: string): Promise<EvaluationCriteriaSet | undefined> { return this.anal.getEvaluationCriteriaSetByCategory(cid); }
  updateEvaluationCriteriaSet(id: string, u: Partial<InsertEvaluationCriteriaSet>): Promise<EvaluationCriteriaSet> { return this.anal.updateEvaluationCriteriaSet(id, u); }
  deleteEvaluationCriteriaSet(id: string): Promise<void> { return this.anal.deleteEvaluationCriteriaSet(id); }
  setDefaultEvaluationCriteriaSet(id: string): Promise<void> { return this.anal.setDefaultEvaluationCriteriaSet(id); }
  createEvaluationDimension(d: InsertEvaluationDimension): Promise<EvaluationDimension> { return this.anal.createEvaluationDimension(d); }
  getEvaluationDimension(id: string): Promise<EvaluationDimension | undefined> { return this.anal.getEvaluationDimension(id); }
  getEvaluationDimensionsByCriteriaSet(csid: string): Promise<EvaluationDimension[]> { return this.anal.getEvaluationDimensionsByCriteriaSet(csid); }
  updateEvaluationDimension(id: string, u: Partial<InsertEvaluationDimension>): Promise<EvaluationDimension> { return this.anal.updateEvaluationDimension(id, u); }
  deleteEvaluationDimension(id: string): Promise<void> { return this.anal.deleteEvaluationDimension(id); }
  getEvaluationCriteriaSetWithDimensions(id: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> { return this.anal.getEvaluationCriteriaSetWithDimensions(id); }
  getActiveEvaluationCriteriaSetWithDimensions(cid?: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> { return this.anal.getActiveEvaluationCriteriaSetWithDimensions(cid); }

  // ── Translations ───────────────────────────────────────────────────────────
  getSupportedLanguages(): Promise<SupportedLanguage[]> { return this.trans.getSupportedLanguages(); }
  getActiveSupportedLanguages(): Promise<SupportedLanguage[]> { return this.trans.getActiveSupportedLanguages(); }
  getSupportedLanguage(c: string): Promise<SupportedLanguage | undefined> { return this.trans.getSupportedLanguage(c); }
  createSupportedLanguage(l: InsertSupportedLanguage): Promise<SupportedLanguage> { return this.trans.createSupportedLanguage(l); }
  updateSupportedLanguage(c: string, u: Partial<InsertSupportedLanguage>): Promise<SupportedLanguage> { return this.trans.updateSupportedLanguage(c, u); }
  deleteSupportedLanguage(c: string): Promise<void> { return this.trans.deleteSupportedLanguage(c); }
  getScenarioTranslation(sid: string, loc: string): Promise<ScenarioTranslation | undefined> { return this.trans.getScenarioTranslation(sid, loc); }
  getScenarioTranslations(sid: string): Promise<ScenarioTranslation[]> { return this.trans.getScenarioTranslations(sid); }
  getAllScenarioTranslations(loc: string): Promise<ScenarioTranslation[]> { return this.trans.getAllScenarioTranslations(loc); }
  getOriginalScenarioTranslation(sid: string): Promise<ScenarioTranslation | undefined> { return this.trans.getOriginalScenarioTranslation(sid); }
  getScenarioTranslationWithFallback(sid: string, loc: string): Promise<ScenarioTranslation | undefined> { return this.trans.getScenarioTranslationWithFallback(sid, loc); }
  upsertScenarioTranslation(t: InsertScenarioTranslation): Promise<ScenarioTranslation> { return this.trans.upsertScenarioTranslation(t); }
  deleteScenarioTranslation(sid: string, loc: string): Promise<void> { return this.trans.deleteScenarioTranslation(sid, loc); }
  markScenarioTranslationReviewed(sid: string, loc: string, rid: string): Promise<ScenarioTranslation> { return this.trans.markScenarioTranslationReviewed(sid, loc, rid); }
  getPersonaTranslation(pid: string, loc: string): Promise<PersonaTranslation | undefined> { return this.trans.getPersonaTranslation(pid, loc); }
  getPersonaTranslations(pid: string): Promise<PersonaTranslation[]> { return this.trans.getPersonaTranslations(pid); }
  getAllPersonaTranslations(loc: string): Promise<PersonaTranslation[]> { return this.trans.getAllPersonaTranslations(loc); }
  upsertPersonaTranslation(t: InsertPersonaTranslation): Promise<PersonaTranslation> { return this.trans.upsertPersonaTranslation(t); }
  deletePersonaTranslation(pid: string, loc: string): Promise<void> { return this.trans.deletePersonaTranslation(pid, loc); }
  markPersonaTranslationReviewed(pid: string, loc: string, rid: string): Promise<PersonaTranslation> { return this.trans.markPersonaTranslationReviewed(pid, loc, rid); }
  getCategoryTranslation(cid: string, loc: string): Promise<CategoryTranslation | undefined> { return this.trans.getCategoryTranslation(cid, loc); }
  getCategoryTranslations(cid: string): Promise<CategoryTranslation[]> { return this.trans.getCategoryTranslations(cid); }
  upsertCategoryTranslation(t: InsertCategoryTranslation): Promise<CategoryTranslation> { return this.trans.upsertCategoryTranslation(t); }
  deleteCategoryTranslation(cid: string, loc: string): Promise<void> { return this.trans.deleteCategoryTranslation(cid, loc); }
  getEvaluationCriteriaSetTranslation(csid: string, loc: string): Promise<EvaluationCriteriaSetTranslation | undefined> { return this.trans.getEvaluationCriteriaSetTranslation(csid, loc); }
  getEvaluationCriteriaSetTranslations(csid: string): Promise<EvaluationCriteriaSetTranslation[]> { return this.trans.getEvaluationCriteriaSetTranslations(csid); }
  upsertEvaluationCriteriaSetTranslation(t: InsertEvaluationCriteriaSetTranslation): Promise<EvaluationCriteriaSetTranslation> { return this.trans.upsertEvaluationCriteriaSetTranslation(t); }
  deleteEvaluationCriteriaSetTranslation(csid: string, loc: string): Promise<void> { return this.trans.deleteEvaluationCriteriaSetTranslation(csid, loc); }
  getEvaluationDimensionTranslation(did: string, loc: string): Promise<EvaluationDimensionTranslation | undefined> { return this.trans.getEvaluationDimensionTranslation(did, loc); }
  getEvaluationDimensionTranslations(did: string): Promise<EvaluationDimensionTranslation[]> { return this.trans.getEvaluationDimensionTranslations(did); }
  upsertEvaluationDimensionTranslation(t: InsertEvaluationDimensionTranslation): Promise<EvaluationDimensionTranslation> { return this.trans.upsertEvaluationDimensionTranslation(t); }
  deleteEvaluationDimensionTranslation(did: string, loc: string): Promise<void> { return this.trans.deleteEvaluationDimensionTranslation(did, loc); }

  // ── Scenarios ──────────────────────────────────────────────────────────────
  getScenario(id: string): Promise<Scenario | undefined> { return this.scen.getScenario(id); }
  getAllScenarios(i?: boolean): Promise<Scenario[]> { return this.scen.getAllScenarios(i); }
  getScenariosByCategory(cid: string): Promise<Scenario[]> { return this.scen.getScenariosByCategory(cid); }
  createScenario(s: InsertScenario): Promise<Scenario> { return this.scen.createScenario(s); }
  updateScenario(id: string, u: Partial<InsertScenario>): Promise<Scenario> { return this.scen.updateScenario(id, u); }
  deleteScenario(id: string): Promise<void> { return this.scen.deleteScenario(id); }
  getMbtiPersona(id: string): Promise<MbtiPersona | undefined> { return this.scen.getMbtiPersona(id); }
  getAllMbtiPersonas(): Promise<MbtiPersona[]> { return this.scen.getAllMbtiPersonas(); }
  getFreeChatPersonas(): Promise<MbtiPersona[]> { return this.scen.getFreeChatPersonas(); }
  createMbtiPersona(p: InsertMbtiPersona): Promise<MbtiPersona> { return this.scen.createMbtiPersona(p); }
  updateMbtiPersona(id: string, u: Partial<InsertMbtiPersona>): Promise<MbtiPersona> { return this.scen.updateMbtiPersona(id, u); }
  deleteMbtiPersona(id: string): Promise<void> { return this.scen.deleteMbtiPersona(id); }

  // ── Personas ───────────────────────────────────────────────────────────────
  createUserPersona(d: InsertUserPersona): Promise<UserPersona> { return this.pers.createUserPersona(d); }
  getUserPersonaById(id: string): Promise<UserPersona | undefined> { return this.pers.getUserPersonaById(id); }
  getUserPersonasByCreator(cid: string, i?: boolean): Promise<UserPersona[]> { return this.pers.getUserPersonasByCreator(cid, i); }
  getPublicUserPersonas(s?: 'likes' | 'recent', l?: number, o?: number, t?: string, m?: string): Promise<UserPersona[]> { return this.pers.getPublicUserPersonas(s, l, o, t, m); }
  getAllPersonas(): Promise<UserPersona[]> { return this.pers.getAllPersonas(); }
  updateUserPersona(id: string, cid: string, d: Partial<InsertUserPersona>, ia?: boolean): Promise<UserPersona> { return this.pers.updateUserPersona(id, cid, d, ia); }
  deleteUserPersona(id: string, cid: string, ia?: boolean): Promise<void> { return this.pers.deleteUserPersona(id, cid, ia); }
  toggleUserPersonaLike(uid: string, pid: string): Promise<{ liked: boolean; likeCount: number }> { return this.pers.toggleUserPersonaLike(uid, pid); }
  getUserPersonaLike(uid: string, pid: string): Promise<boolean> { return this.pers.getUserPersonaLike(uid, pid); }
  incrementUserPersonaChatCount(id: string): Promise<void> { return this.pers.incrementUserPersonaChatCount(id); }
  createPersonaUserScene(d: InsertPersonaUserScene): Promise<PersonaUserScene> { return this.pers.createPersonaUserScene(d); }
  getPersonaUserSceneById(id: string): Promise<PersonaUserScene | undefined> { return this.pers.getPersonaUserSceneById(id); }
  getPersonaUserScenesByCreator(cid: string, s?: string): Promise<PersonaUserScene[]> { return this.pers.getPersonaUserScenesByCreator(cid, s); }
  getPublicPersonaUserScenes(o?: { genre?: string; tag?: string; search?: string; limit?: number; offset?: number }): Promise<PersonaUserScene[]> { return this.pers.getPublicPersonaUserScenes(o); }
  updatePersonaUserScene(id: string, cid: string, d: Partial<InsertPersonaUserScene>): Promise<PersonaUserScene> { return this.pers.updatePersonaUserScene(id, cid, d); }
  deletePersonaUserScene(id: string, cid: string): Promise<void> { return this.pers.deletePersonaUserScene(id, cid); }
  incrementPersonaUserSceneUseCount(id: string): Promise<void> { return this.pers.incrementPersonaUserSceneUseCount(id); }

  // ── Organizations ──────────────────────────────────────────────────────────
  getCompany(id: string): Promise<Company | undefined> { return this.org.getCompany(id); }
  getCompanyByName(n: string): Promise<Company | undefined> { return this.org.getCompanyByName(n); }
  getAllCompanies(): Promise<Company[]> { return this.org.getAllCompanies(); }
  getActiveCompanies(): Promise<Company[]> { return this.org.getActiveCompanies(); }
  createCompany(c: InsertCompany): Promise<Company> { return this.org.createCompany(c); }
  updateCompany(id: string, u: Partial<InsertCompany>): Promise<Company> { return this.org.updateCompany(id, u); }
  deleteCompany(id: string): Promise<void> { return this.org.deleteCompany(id); }
  getOrganization(id: string): Promise<Organization | undefined> { return this.org.getOrganization(id); }
  getOrganizationsByCompany(cid: string): Promise<Organization[]> { return this.org.getOrganizationsByCompany(cid); }
  getActiveOrganizationsByCompany(cid: string): Promise<Organization[]> { return this.org.getActiveOrganizationsByCompany(cid); }
  getAllOrganizations(): Promise<Organization[]> { return this.org.getAllOrganizations(); }
  createOrganization(o: InsertOrganization): Promise<Organization> { return this.org.createOrganization(o); }
  updateOrganization(id: string, u: Partial<InsertOrganization>): Promise<Organization> { return this.org.updateOrganization(id, u); }
  deleteOrganization(id: string): Promise<void> { return this.org.deleteOrganization(id); }
  getCategoriesByOrganization(oid: string): Promise<Category[]> { return this.org.getCategoriesByOrganization(oid); }
  getActiveCategoriesByOrganization(oid: string): Promise<Category[]> { return this.org.getActiveCategoriesByOrganization(oid); }
  getOperatorAssignment(id: string): Promise<OperatorAssignment | undefined> { return this.org.getOperatorAssignment(id); }
  getOperatorAssignmentsByUser(uid: string): Promise<OperatorAssignment[]> { return this.org.getOperatorAssignmentsByUser(uid); }
  getOperatorAssignmentsByCompany(cid: string): Promise<OperatorAssignment[]> { return this.org.getOperatorAssignmentsByCompany(cid); }
  getOperatorAssignmentsByOrganization(oid: string): Promise<OperatorAssignment[]> { return this.org.getOperatorAssignmentsByOrganization(oid); }
  createOperatorAssignment(a: InsertOperatorAssignment): Promise<OperatorAssignment> { return this.org.createOperatorAssignment(a); }
  deleteOperatorAssignment(id: string): Promise<void> { return this.org.deleteOperatorAssignment(id); }
  deleteOperatorAssignmentsByUser(uid: string): Promise<void> { return this.org.deleteOperatorAssignmentsByUser(uid); }
  canOperatorManageCompany(uid: string, cid: string): Promise<boolean> { return this.org.canOperatorManageCompany(uid, cid); }
  canOperatorManageOrganization(uid: string, oid: string): Promise<boolean> { return this.org.canOperatorManageOrganization(uid, oid); }
  canOperatorManageCategory(uid: string, cid: string): Promise<boolean> { return this.org.canOperatorManageCategory(uid, cid); }
  getOperatorManagedCompanyIds(uid: string): Promise<string[]> { return this.org.getOperatorManagedCompanyIds(uid); }
  getOperatorManagedOrganizationIds(uid: string): Promise<string[]> { return this.org.getOperatorManagedOrganizationIds(uid); }
  getOperatorManagedCategoryIds(uid: string): Promise<string[]> { return this.org.getOperatorManagedCategoryIds(uid); }
  getUsersByCompany(cid: string): Promise<User[]> { return this.org.getUsersByCompany(cid); }
  getUsersByOrganization(oid: string): Promise<User[]> { return this.org.getUsersByOrganization(oid); }
  updateUserCompanyOrganization(uid: string, cid: string | null, oid: string | null): Promise<User> { return this.org.updateUserCompanyOrganization(uid, cid, oid); }
  getDashboardSummary(uid: string, asids?: string[] | null): Promise<DashboardSummary> { return this.org.getDashboardSummary(uid, asids); }
}

export const storage = new PostgreSQLStorage();
