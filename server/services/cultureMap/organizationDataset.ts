import { v5 as uuidv5 } from "uuid";
import {
  CULTURE_DIMENSIONS,
  SYSTEM_CULTURE_OWNER_ID,
  cultureProfileInputSchema,
  type CultureProfileInput,
  type CultureValues,
} from "../../../shared/cultureMap";

const estimateNotice =
  "기업이 공개한 가치·문화 소개를 Culture Map 8개 차원에 대응시킨 RoleplayX 자체 추정입니다. 기업의 공식 점수나 직원 행동 측정값이 아니며, 팀·직무·지역·시점에 따라 달라질 수 있습니다.";
const sourceReviewedAt = "2026-10-27";
const revision = "2026.2";

type OrganizationRecord = {
  slug: string;
  name: string;
  description: string;
  dimensions: CultureValues;
  sources: CultureProfileInput["sources"];
};

const organizationRecords: OrganizationRecord[] = [
  {
    slug: "meta",
    name: "Meta",
    description: "속도, 직접적인 피드백, 높은 영향의 실행과 협업을 강조하는 공개 문화 소개를 바탕으로 한 추정입니다.",
    dimensions: { communicating: 25, evaluating: 20, persuading: 35, leading: 40, deciding: 60, trusting: 35, disagreeing: 25, scheduling: 25 },
    sources: [{
      title: "Work Culture at Meta",
      url: "https://www.metacareers.com/culture",
      locator: "Our core values",
      note: "Meta의 자체 채용·문화 소개 자료입니다. 아래 점수를 측정하거나 검증한 자료는 아닙니다.",
    }],
  },
  {
    slug: "google",
    name: "Google",
    description: "팀 효과성 연구와 협업·심리적 안전에 관한 공개 자료를 참고한 추정입니다. 연구 결과를 현재 모든 팀의 일하는 방식으로 일반화하지 않습니다.",
    dimensions: { communicating: 35, evaluating: 40, persuading: 40, leading: 35, deciding: 45, trusting: 30, disagreeing: 35, scheduling: 30 },
    sources: [{
      title: "Google re:Work — Understand team effectiveness",
      url: "https://rework.withgoogle.com/intl/en/guides/understand-team-effectiveness",
      locator: "Project Aristotle and team effectiveness",
      note: "Google의 팀 효과성 연구 소개입니다. 기업 전체의 현재 문화 점수를 뜻하지 않습니다.",
    }],
  },
  {
    slug: "apple",
    name: "Apple",
    description: "전문성, 협업, 포용, 독창성과 informed risk를 강조하는 공개 소개 자료를 바탕으로 한 추정입니다.",
    dimensions: { communicating: 35, evaluating: 35, persuading: 40, leading: 40, deciding: 55, trusting: 35, disagreeing: 35, scheduling: 30 },
    sources: [{
      title: "Apple Careers — Shared Values",
      url: "https://www.apple.com/careers/us/life-at-apple/shared-values.html",
      locator: "Shared Values",
      note: "Apple의 자체 구성원 이야기와 가치 소개입니다. 아래 점수를 측정하거나 검증한 자료는 아닙니다.",
    }, {
      title: "Apple Careers — Work at Apple",
      url: "https://www.apple.com/careers/us/work-at-apple.html",
      locator: "How We Work; Collaboration",
      note: "전문가 주도 조직과 협업·토론에 관한 자체 소개입니다. 독립적인 직원 행동 측정 자료는 아닙니다.",
    }],
  },
  {
    slug: "intel",
    name: "Intel",
    description: "데이터 기반 의사결정, 건설적 토론, 팀 성공과 명확한 결과 실행을 강조하는 공개 가치 자료를 바탕으로 한 추정입니다.",
    dimensions: { communicating: 30, evaluating: 30, persuading: 35, leading: 50, deciding: 55, trusting: 30, disagreeing: 20, scheduling: 30 },
    sources: [{
      title: "Intel — Our values",
      url: "https://www.intel.com/content/www/us/en/corporate-responsibility/our-values.html",
      locator: "Results driven, One Intel, Integrity",
      note: "Intel의 자체 가치 소개입니다. 아래 점수를 측정하거나 검증한 자료는 아닙니다.",
    }],
  },
  {
    slug: "anthropic",
    name: "Anthropic",
    description: "안전 연구, 과학적 접근, 학제 간 협력과 책임 있는 개발을 강조하는 공개 회사 소개를 바탕으로 한 추정입니다.",
    dimensions: { communicating: 30, evaluating: 30, persuading: 20, leading: 35, deciding: 40, trusting: 35, disagreeing: 25, scheduling: 35 },
    sources: [{
      title: "Anthropic — Company",
      url: "https://www.anthropic.com/company",
      locator: "Our purpose; What we value and how we act",
      note: "Anthropic의 자체 회사·가치 소개입니다. 아래 점수를 측정하거나 검증한 자료는 아닙니다.",
    }, {
      title: "Anthropic — Careers",
      url: "https://www.anthropic.com/careers",
      locator: "Principles that guide how we show up",
      note: "Anthropic의 공개 채용·업무 원칙 소개입니다. 독립적인 직원 행동 측정 자료는 아닙니다.",
    }],
  },
  {
    slug: "openai",
    name: "OpenAI",
    description: "개인의 주도성, 빠른 업데이트, 창의적 해결과 강한 집중을 강조하는 공개 업무 원칙을 바탕으로 한 추정입니다.",
    dimensions: { communicating: 25, evaluating: 30, persuading: 20, leading: 30, deciding: 45, trusting: 30, disagreeing: 30, scheduling: 25 },
    sources: [{
      title: "OpenAI — Careers",
      url: "https://openai.com/careers",
      locator: "Values; Operating Principles",
      note: "OpenAI의 자체 채용·업무 원칙 소개입니다. 아래 점수를 측정하거나 검증한 자료는 아닙니다.",
    }],
  },
];

export const organizationCultureSeedProfiles = organizationRecords.map(record => {
  if (CULTURE_DIMENSIONS.some(({ key }) => record.dimensions[key] % 5 !== 0)) {
    throw new Error(`Invalid organization estimate precision: ${record.slug}`);
  }
  const content = cultureProfileInputSchema.parse({
    name: record.name,
    country: "기업",
    region: "글로벌 기술",
    description: `${estimateNotice}\n${record.description}`,
    dimensions: record.dimensions,
    sources: record.sources,
    visibility: "shared",
    assessment: {
      kind: "organization_editorial_estimate",
      confidence: "low",
      notice: estimateNotice,
      sourceReviewedAt,
      revision,
    },
  });
  return {
    // Keep the profile identity stable. New estimates become a new profile
    // version so saved Actor snapshots can continue to reference older ones.
    id: uuidv5(`${SYSTEM_CULTURE_OWNER_ID}:organization:${record.slug}:2026.1`, uuidv5.URL),
    content,
  };
});
