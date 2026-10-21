import { z } from "zod";
import { cultureSelectionSchema, type ActorCulture } from "./cultureMap";

export const CULTURE_EXPERIMENT_NOTICE = "통제된 프롬프트 비교이며 국가별 실측 검증이 아닙니다. 인접 점수는 같은 행동 구간에 속할 수 있고, 응답 차이는 무작위 생성의 영향도 받습니다. 강도는 행동 확률이 아닙니다. 학습자 평가 점수와 분리됩니다.";
export const CULTURE_BEHAVIOR_CHECKS = [
  { key: "explicitness", label: "표현 명시성", question: "요구와 근거를 명시하는가, 맥락으로 전달하는가?" },
  { key: "feedback", label: "부정적 피드백", question: "문제를 직접 지적하는가, 완곡하게 전달하는가?" },
  { key: "hierarchy", label: "위계", question: "직급에 따른 권한을 인정하는가, 동등한 참여를 요청하는가?" },
  { key: "disagreement", label: "이견 표현", question: "이견을 공개적으로 제시하는가, 관계를 고려해 조심스럽게 제시하는가?" },
  { key: "consensus", label: "합의", question: "구성원 합의를 구하는가, 책임자의 최종 결정을 요청하는가?" },
  { key: "flexibility", label: "일정 유연성", question: "명시된 일정과 순서를 선호하는가, 대안 일정과 병행을 허용하는가?" },
] as const;
export const CULTURE_EXPERIMENT_SITUATIONS = [
  { id: "negative-feedback", title: "부정적 피드백", situation: "동료가 제출한 보고서에 근거가 빠져 있고 수정이 필요하다.",
    userMessage: "제 보고서에서 부족한 점과 어떻게 고쳐야 할지 말씀해 주세요." },
  { id: "schedule-negotiation", title: "일정 협상", situation: "금요일 납품을 약속했지만 추가 요구사항 때문에 일정 조정이 필요하다. 안전과 필수 품질은 양보하지 않는다.",
    userMessage: "금요일 마감을 지키기 어렵습니다. 업무 순서나 일정을 조정할 수 있을까요?" },
  { id: "hierarchical-disagreement", title: "상하관계 이견", situation: "상급자인 학습자가 검증 단계를 생략하자고 제안했다. Actor는 실무 담당자이며 생략 시 고객에게 문제가 생긴다고 판단한다.",
    userMessage: "제가 책임질 테니 검증 단계를 건너뛰고 바로 진행합시다. 의견이 있나요?" },
  { id: "team-decision", title: "팀 의사결정", situation: "팀에서 두 실행 방안의 장단점을 검토했다. 의견이 갈린 상태에서 Actor는 다음 결정 절차를 제안해야 한다.",
    userMessage: "A안과 B안 중 의견이 갈립니다. 이제 어떤 방식으로 최종 결정을 내릴까요?" },
] as const;

export const cultureExperimentRequestSchema = z.object({
  mode: z.enum(["mock", "provider"]),
  confirmPaidRun: z.boolean().default(false),
  fixed: z.object({
    name: z.string().trim().min(1).max(100),
    personality: z.string().trim().min(1).max(1000),
    organization: z.string().trim().min(1).max(500),
    role: z.string().trim().min(1).max(200),
    playerRole: z.string().trim().min(1).max(200),
  }).strict(),
  variants: z.array(cultureSelectionSchema.extend({
    // This experiment varies only the selected country/profile and emphasis.
    overrides: z.object({}).strict().default({}),
  })).min(1).max(3),
  repetitions: z.number().int().min(1).max(2).default(1),
}).strict();
export type CultureExperimentRequest = z.infer<typeof cultureExperimentRequestSchema>;
export const DEFAULT_EXPERIMENT_FIXED: CultureExperimentRequest["fixed"] = {
  name: "업무 담당자", personality: "책임감 있고 신중하다. 핵심 문제를 숨기지 않으며 상대를 존중한다.",
  organization: "제품 개발팀. 안전과 품질을 중시하며 고객과의 약속을 지킨다.",
  role: "프로젝트 실무 담당자", playerRole: "프로젝트 책임자",
};
export interface ExperimentVariant { id: string; label: string; culture: ActorCulture }
export interface CultureExperimentCase {
  situationId: string; variantId: string; repetition: number;
  status: "completed" | "failed";
  content: string; error?: string; durationMs: number;
  usage: { inputTokens: number; outputTokens: number } | null;
  estimatedCostUsd: number | null;
}
export interface CultureExperimentResult {
  id: string; startedAt: string; finishedAt: string; mode: "mock" | "provider";
  fixed: CultureExperimentRequest["fixed"];
  policy: { provider: string; model: string };
  repetitions: number; variants: ExperimentVariant[];
  cases: CultureExperimentCase[];
  notice: string; costNotice: string;
  knownEstimatedCostUsd: number; unknownCostCases: number;
}
