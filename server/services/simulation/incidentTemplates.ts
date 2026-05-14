import { IncidentType } from './simulationTypes';

type Language = 'ko' | 'en' | 'ja' | 'zh';
type Severity = 'low' | 'medium' | 'high';

interface IncidentTemplate {
  ko: Record<Severity, string>;
  en: Record<Severity, string>;
  ja: Record<Severity, string>;
  zh: Record<Severity, string>;
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
    ja: {
      low: '役員が会話に参加して進捗を確認しています。',
      medium: '役員が突然会議に参加しました。状況を迅速に整理する必要があります。',
      high: '上層部が直接介入しました。即座の解決策を求めています。',
    },
    zh: {
      low: '高管加入了对话，正在检查进展。',
      medium: '高管突然加入了会议，需要迅速整理情况。',
      high: '高层管理人员直接介入，要求立即解决。',
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
    ja: {
      low: 'お客様が不満を申し立て、より明確な説明を求めています。',
      medium: 'お客様が強く抗議し、担当者との直接対話を求めています。',
      high: 'お客様が正式な異議申し立てを宣言し、交渉決裂を警告しています。',
    },
    zh: {
      low: '客户提出了投诉，要求更清晰的说明。',
      medium: '客户强烈抗议，要求直接与负责人通话。',
      high: '客户宣布正式投诉，警告谈判破裂。',
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
    ja: {
      low: '締め切りが迫っており、早急な決断が必要です。',
      medium: '締め切りまで2時間を切りました。即座の決断が必要です。',
      high: '締め切りまで30分しかありません。今すぐ最終決断を下す必要があります。',
    },
    zh: {
      low: '截止日期临近，需要尽快做出决定。',
      medium: '截止日期不足2小时，需要立即做出决定。',
      high: '距截止日期只剩30分钟，必须立即做出最终决定。',
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
    ja: {
      low: '新たなデータが発見され、状況の再検討が必要です。',
      medium: '予期せぬ新証拠が提示され、交渉の基盤が揺らいでいます。',
      high: '決定的な新情報が浮上し、これまでの合意がすべて無効になる可能性があります。',
    },
    zh: {
      low: '发现了新数据，需要重新评估情况。',
      medium: '意外出现了新证据，动摇了谈判基础。',
      high: '出现了关键新信息，可能使之前所有协议无效。',
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
    ja: {
      low: '競合他社から類似の提案があったとの情報が入りました。',
      medium: '競合他社がより良い条件を提示しました。迅速な対応が必要です。',
      high: '競合他社が破格の条件を提示しており、相手方が真剣に検討しています。',
    },
    zh: {
      low: '有消息称竞争对手提出了类似方案。',
      medium: '竞争对手提出了更优条件，需要快速回应。',
      high: '竞争对手提出了破格条件，对方正在认真考虑。',
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
    ja: {
      low: '内部規定により、一部の変更が困難です。',
      medium: '規定変更により、合意内容の修正が必要になる可能性があります。',
      high: '規制機関の緊急指示により、現在の交渉前提が無効になる危機です。',
    },
    zh: {
      low: '内部政策使某些变更变得困难。',
      medium: '政策变更可能需要修改协议内容。',
      high: '监管机构的紧急指令威胁使当前谈判前提无效。',
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
    ja: {
      low: '品質審査中にいくつかの不備が発見されました。',
      medium: '品質基準不適合の問題が発生しました。即座の説明が必要です。',
      high: '深刻な品質上の欠陥が発見されました。すべての交渉が中断する可能性があります。',
    },
    zh: {
      low: '质量审查中发现了一些不足之处。',
      medium: '发生了质量标准不达标问题，需要立即说明。',
      high: '发现了严重的质量缺陷，所有谈判可能中断。',
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
    ja: {
      low: '管理者が進捗を確認するために会話に介入しました。',
      medium: '管理者が交渉の方向性に疑問を呈して介入しました。',
      high: '管理者が交渉権限を剥奪すると警告しました。',
    },
    zh: {
      low: '管理者介入谈话以检查进展。',
      medium: '管理者对谈判方向提出质疑并介入。',
      high: '管理者警告将撤销谈判授权。',
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
    ja: {
      low: '予算審査により、一部項目の調整が必要です。',
      medium: '緊急予算削減により、提案内容の修正が必要です。',
      high: '大規模な予算削減が決定し、現在の交渉範囲全体の再検討が必要です。',
    },
    zh: {
      low: '预算审查需要对某些项目进行调整。',
      medium: '紧急预算削减需要修改提案。',
      high: '大规模预算削减已决定，需要全面重新评估谈判范围。',
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
    ja: {
      low: '法的審査が必要な事項が発生しました。',
      medium: 'コンプライアンスチームが現在の条件について懸念を示しました。',
      high: 'コンプライアンス違反の可能性が指摘され、即座の対応が必要です。',
    },
    zh: {
      low: '出现了需要法律审查的事项。',
      medium: '合规团队对当前条件表示担忧。',
      high: '提出了潜在合规违规问题，需要立即回应。',
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

  const msg = template[language]?.[severity] ?? template.en[severity];

  if (scenarioContext) {
    return `${msg} [${scenarioContext}]`;
  }
  return msg;
}
