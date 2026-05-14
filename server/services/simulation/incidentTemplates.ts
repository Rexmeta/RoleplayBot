import { IncidentType } from './simulationTypes';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type Severity = 'low' | 'medium' | 'high';

interface IncidentTemplate {
  ko: Record<Severity, string>;
  en: Record<Severity, string>;
}

const INCIDENT_TEMPLATES: Record<IncidentType, IncidentTemplate> = {
  executive_join: {
    ko: {
      low: '임원이 대화에 참여하여 진행 상황을 확인합니다.',
      medium: '임원이 갑자기 회의에 참여했습니다. 상황을 신속하게 정리해야 합니다.',
      high: '최고 경영진이 직접 개입했습니다. 즉각적인 해결책을 요구합니다.',
    },
    en: {
      low: 'An executive has joined the conversation to check on progress.',
      medium: 'An executive has suddenly joined the meeting. The situation must be summarized quickly.',
      high: 'Senior management has intervened directly and demands an immediate resolution.',
    },
  },
  customer_escalation: {
    ko: {
      low: '고객이 불만을 제기하며 더 명확한 설명을 요청합니다.',
      medium: '고객이 강하게 항의하며 책임자와 직접 통화를 요청합니다.',
      high: '고객이 공식 이의 제기를 선언하며 협상 결렬을 경고합니다.',
    },
    en: {
      low: 'The customer has raised a complaint and is requesting a clearer explanation.',
      medium: 'The customer is strongly objecting and requesting to speak with a supervisor.',
      high: 'The customer has declared a formal complaint and is warning of a negotiation breakdown.',
    },
  },
  deadline_pressure: {
    ko: {
      low: '마감 기한이 다가오고 있어 결정을 서두를 필요가 있습니다.',
      medium: '마감이 2시간 이내로 남았습니다. 즉각적인 결정이 필요합니다.',
      high: '마감이 30분 남았습니다. 지금 당장 최종 결정을 내려야 합니다.',
    },
    en: {
      low: 'The deadline is approaching and a decision needs to be made soon.',
      medium: 'The deadline is within 2 hours. An immediate decision is required.',
      high: 'Only 30 minutes remain until the deadline. A final decision must be made right now.',
    },
  },
  new_evidence: {
    ko: {
      low: '새로운 데이터가 발견되어 상황을 재검토해야 합니다.',
      medium: '예상치 못한 새 증거가 제시되어 협상 기반이 흔들립니다.',
      high: '결정적인 새 정보가 등장하여 기존 합의가 모두 무효화될 수 있습니다.',
    },
    en: {
      low: 'New data has been discovered and the situation needs to be re-evaluated.',
      medium: 'Unexpected new evidence has been presented, shaking the foundation of the negotiation.',
      high: 'Critical new information has emerged that could invalidate all previous agreements.',
    },
  },
  competitor_offer: {
    ko: {
      low: '경쟁사에서 유사한 제안을 했다는 소식이 들어왔습니다.',
      medium: '경쟁사가 더 나은 조건을 제시했습니다. 빠른 대응이 필요합니다.',
      high: '경쟁사가 파격적인 조건을 제시하여 상대방이 심각하게 고려하고 있습니다.',
    },
    en: {
      low: 'News has come in that a competitor has made a similar offer.',
      medium: 'A competitor has presented better terms. A quick response is needed.',
      high: 'A competitor has made a groundbreaking offer that the other party is seriously considering.',
    },
  },
  policy_constraint: {
    ko: {
      low: '내부 정책으로 인해 일부 사항의 변경이 어렵습니다.',
      medium: '규정 변경으로 인해 합의 내용을 수정해야 할 수 있습니다.',
      high: '규제 기관의 긴급 지시로 인해 현재 협상 전제가 무효화될 위기입니다.',
    },
    en: {
      low: 'Internal policy makes it difficult to change certain items.',
      medium: 'A policy change may require revising the agreed terms.',
      high: 'An urgent directive from a regulatory body threatens to invalidate the current negotiation premise.',
    },
  },
  quality_issue: {
    ko: {
      low: '품질 검토 중 일부 미흡한 점이 발견되었습니다.',
      medium: '품질 기준 미달 문제가 발생했습니다. 즉각적인 설명이 필요합니다.',
      high: '심각한 품질 결함이 발견되었습니다. 모든 협상이 중단될 수 있습니다.',
    },
    en: {
      low: 'Some deficiencies have been found during a quality review.',
      medium: 'A quality standard failure has occurred. An immediate explanation is required.',
      high: 'A serious quality defect has been found. All negotiations may be halted.',
    },
  },
  manager_interrupt: {
    ko: {
      low: '관리자가 진행 상황을 확인하기 위해 대화에 개입했습니다.',
      medium: '관리자가 협상 방향에 의문을 제기하며 개입했습니다.',
      high: '관리자가 협상 권한을 회수하겠다고 경고했습니다.',
    },
    en: {
      low: 'A manager has intervened to check on the progress.',
      medium: 'A manager has intervened questioning the direction of the negotiation.',
      high: 'A manager has warned they will revoke negotiation authority.',
    },
  },
  budget_cut: {
    ko: {
      low: '예산 검토로 인해 일부 항목의 조정이 필요합니다.',
      medium: '긴급 예산 삭감으로 인해 제안 내용을 수정해야 합니다.',
      high: '대규모 예산 삭감이 결정되어 현재 협상 범위 전체를 재검토해야 합니다.',
    },
    en: {
      low: 'A budget review requires adjustments to some items.',
      medium: 'An emergency budget cut requires revising the proposal.',
      high: 'A large-scale budget cut has been decided, requiring a full re-evaluation of the negotiation scope.',
    },
  },
  compliance_warning: {
    ko: {
      low: '법적 검토가 필요한 사항이 발생했습니다.',
      medium: '컴플라이언스 팀에서 현재 조건에 대한 우려를 표명했습니다.',
      high: '컴플라이언스 위반 가능성이 제기되어 즉각적인 대응이 필요합니다.',
    },
    en: {
      low: 'A matter requiring legal review has arisen.',
      medium: 'The compliance team has expressed concerns about the current terms.',
      high: 'A potential compliance violation has been raised, requiring an immediate response.',
    },
  },
};

export function renderIncidentMessage(
  type: IncidentType,
  severity: Severity,
  scenarioContext: string,
  language: Language
): string {
  const template = INCIDENT_TEMPLATES[type];
  if (!template) return `[Incident: ${type} (${severity})]`;

  const lang = language === 'ja' || language === 'zh' ? 'en' : language;
  const msg = template[lang]?.[severity] ?? template.en[severity];

  if (scenarioContext) {
    return `${msg} [${scenarioContext}]`;
  }
  return msg;
}
