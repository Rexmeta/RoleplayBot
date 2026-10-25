import { z } from "zod";

export const CULTURE_DIMENSIONS = [
  { key: "communicating", label: "의사소통", low: "저맥락", high: "고맥락" },
  { key: "evaluating", label: "평가 피드백", low: "직접적", high: "간접적" },
  { key: "persuading", label: "설득", low: "원리 우선", high: "적용 우선" },
  { key: "leading", label: "리더십", low: "평등", high: "위계" },
  { key: "deciding", label: "의사결정", low: "합의", high: "하향식" },
  { key: "trusting", label: "신뢰", low: "과업 중심", high: "관계 중심" },
  { key: "disagreeing", label: "이견 표현", low: "대립 허용", high: "대립 회피" },
  { key: "scheduling", label: "일정", low: "선형", high: "유연" },
] as const;
export type CultureDimension = typeof CULTURE_DIMENSIONS[number]["key"];
export const SYSTEM_CULTURE_OWNER_ID = "system:roleplayx-culture-map-2026";
export const EDITORIAL_CULTURE_NOTICE = "Erin Meyer의 8개 문화 차원을 참고한 RoleplayX 자체 추정 프로필입니다. 국가별 개인의 성격이나 행동을 확정하지 않습니다.";
export const isSystemCultureProfile = (profile: { ownerId: string }) => profile.ownerId === SYSTEM_CULTURE_OWNER_ID;
const score = z.number().finite().min(0).max(100);
export const cultureValuesSchema = z.object({
  communicating: score, evaluating: score, persuading: score, leading: score,
  deciding: score, trusting: score, disagreeing: score, scheduling: score,
}).strict();
export const cultureSourceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.string().url().max(2000).refine(v => /^https?:\/\//i.test(v), "HTTP(S) URL required"),
  locator: z.string().trim().max(1000),
  note: z.string().trim().max(2000),
}).strict();
export const cultureAssessmentSchema = z.object({
  kind: z.literal("organization_editorial_estimate"),
  confidence: z.literal("low"),
  notice: z.string().trim().min(1).max(1000),
}).strict();
/** Retain the uploaded record verbatim, including its ORIGINAL axis direction.
 * Only the operational dimensions below are adapted to the app's scales.
 */
export const cultureDatasetProfileSchema = z.object({
  id: z.string().min(1).max(150),
  countryCode: z.string().min(2).max(10),
  countryNameKo: z.string().min(1).max(100),
  region: z.string().max(100),
  schemaVersion: z.string().min(1).max(50),
  profileVersion: z.string().min(1).max(50),
  profileType: z.literal("editorial_estimate"),
  confidence: z.enum(["low", "medium", "high"]),
  dimensions: cultureValuesSchema,
  context: z.string().max(1000),
  notesKo: z.string().max(2000),
  sourceIds: z.array(z.string().min(1)).max(20),
  individuationRule: z.string().max(2000),
  reviewStatus: z.literal("draft_requires_validation"),
}).strict();
export const cultureOriginSchema = z.object({
  datasetId: z.literal("roleplayx-2026"),
  dataset: z.string().max(300),
  createdOn: z.string().max(30),
  importantNotice: z.string().max(2000),
  method: z.string().max(2000),
  originalProfile: cultureDatasetProfileSchema,
  axisTransforms: z.tuple([z.literal("persuading:100-x")]),
}).strict();
export const cultureProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(150),
  country: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100),
  description: z.string().trim().max(2000),
  dimensions: cultureValuesSchema,
  sources: z.array(cultureSourceSchema).max(20),
  visibility: z.enum(["private", "shared"]).default("private"),
  origin: cultureOriginSchema.optional(),
  assessment: cultureAssessmentSchema.optional(),
}).strict();
export type CultureValues = z.infer<typeof cultureValuesSchema>;
export type CultureSource = z.infer<typeof cultureSourceSchema>;
export type CultureProfileInput = z.infer<typeof cultureProfileInputSchema>;
export interface CultureProfile extends CultureProfileInput {
  id: string;
  ownerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export const cultureSelectionSchema = z.object({
  enabled: z.literal(true),
  profileId: z.string().uuid(),
  profileVersion: z.number().int().positive(),
  intensity: score,
  overrides: cultureValuesSchema.partial().default({}),
}).strict();
export const cultureSnapshotSchema = cultureSelectionSchema.extend({
  snapshotVersion: z.literal(1),
  name: z.string().min(1).max(150),
  country: z.string().min(1).max(100),
  region: z.string().max(100),
  dimensions: cultureValuesSchema,
  sources: z.array(cultureSourceSchema).max(20),
  origin: cultureOriginSchema.optional(),
  assessment: cultureAssessmentSchema.optional(),
}).strict();
export type CultureSnapshot = z.infer<typeof cultureSnapshotSchema>;
export type CultureSelection = z.infer<typeof cultureSelectionSchema>;
export type ActorCulture = CultureSelection | CultureSnapshot | { enabled: false };
export const CULTURE_DISCLAIMER = "문화 차원은 상황에 따른 행동 경향이며, 국적에 따른 개인의 고정 성격이나 능력이 아닙니다. 반영 강도는 지침의 강조 수준이지 행동 확률이 아니며 평가 점수를 직접 가감하지 않습니다.";

/** Neutral custom-authoring defaults only, not country scores. The optional
 * country dataset is separately labeled as unvalidated editorial estimates.
 */
export const newCultureValues = (): CultureValues => ({
  communicating: 50, evaluating: 50, persuading: 50, leading: 50,
  deciding: 50, trusting: 50, disagreeing: 50, scheduling: 50,
});
