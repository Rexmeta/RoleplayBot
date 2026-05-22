import type { SimulationHarness } from '@shared/schema/scenarios';
import { DEFAULT_SIMULATION_HARNESS, resolveHarness } from './simulationHarness';

export function buildSimulationToolPrompt(language: 'ko' | 'en' | 'ja' | 'zh' = 'ko', harness?: SimulationHarness | null): string {
  const h = resolveHarness({ simulationHarness: harness });
  const maxCalls = h.toolPolicy.updateNpcEmotion.maxCallsPerTurn;
  const maxDelta = h.toolPolicy.updateNpcEmotion.maxDeltaPerCall;
  const allowedTypes = h.toolPolicy.triggerIncident.allowedTypes;
  const globalCooldown = h.toolPolicy.triggerIncident.cooldownOverride.globalCooldownSec;
  const perTypeCooldown = h.toolPolicy.triggerIncident.cooldownOverride.perTypeCooldownSec;
  const scenarioStateEnabled = h.toolPolicy.updateScenarioState.enabled !== false;
  const emotionModel = h.emotionModel;
  const preferredSignals = h.preferredSignals;

  const hasCustomPolicy = harness != null;
  const emotionList = emotionModel.join(', ');

  let preferredSignalLines = '';
  if (preferredSignals && Object.keys(preferredSignals).length > 0) {
    const lines = Object.entries(preferredSignals).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
    if (language === 'ko') {
      preferredSignalLines = `\n**선호 반응 패턴:**\n${lines}`;
    } else {
      preferredSignalLines = `\n**Preferred response signals:**\n${lines}`;
    }
  }

  if (language === 'ko') {
    const stateToolSection = scenarioStateEnabled ? `
**update_scenario_state** (시나리오 상태 업데이트) — 다음 상황에서 호출:
- 갈등이 심화될 때: intro → conflict, conflict → negotiation
- 협상이 막힐 때: negotiation → escalation
- 긍정적으로 해결될 때: negotiation → resolution, escalation → resolution
- 압박이 증가할 때: pressureDelta +1 (최대 +5)
- 협상이 순조로울 때: pressureDelta -1
- 주의: 단계 전환은 앞으로만 가능하며, 이전 단계로 되돌아갈 수 없습니다.
` : '';

    const allowedTypesLine = allowedTypes.length < 10
      ? `- 허용된 이벤트 유형: ${allowedTypes.join(', ')}`
      : '';

    return `
## 시뮬레이션 상태 관리 도구 사용 지침
${hasCustomPolicy ? '\n> 이 시나리오에는 맞춤 시뮬레이션 정책이 적용됩니다.\n' : ''}
### 도구 호출 기준

**update_npc_emotion** (감정 업데이트) — 다음 상황에서 호출:
- 사용자가 공감적이거나 논리적인 답변을 했을 때 → trust +5~+15, anger -5~-10
- 사용자가 무례하거나 회피적인 답변을 했을 때 → anger +5~+15, trust -5~-10
- 사용자의 답변이 모호하거나 불명확할 때 → confusion +5~+10
- 사용자가 창의적이거나 흥미로운 제안을 했을 때 → interest +5~+15
- 활성 감정 모델: ${emotionList}
- 한 턴에 최대 ${maxCalls}회까지만 호출. delta는 절대값 기준 ${maxDelta} 이하.
${preferredSignalLines}
${stateToolSection}
**trigger_incident** (돌발 이벤트) — 다음 상황에서만 호출:
- anger > 80이고 이미 여러 번 경고가 있었을 때 → customer_escalation (high)
- 협상이 장기화될 때 → deadline_pressure (medium)
- 예상치 못한 정보가 나왔을 때 → new_evidence
- 같은 턴에 한 번만 호출 가능
- ${globalCooldown}초 글로벌 쿨다운, 같은 타입은 ${perTypeCooldown}초 쿨다운 적용
${allowedTypesLine}

### 중요 원칙
- 도구 결과를 사용자에게 직접 언급하지 마세요. 상태를 바탕으로 말투와 반응 강도를 자연스럽게 조절하세요.
- delta는 절대값이 아닌 변화량입니다. 현재 감정 수치를 모르더라도 상황에 맞는 변화량만 제공하세요.
- 중립적인 대화에서는 도구를 호출하지 않아도 됩니다.
`;
  }

  const stateToolSection = scenarioStateEnabled ? `
**update_scenario_state** — Call when:
- Conflict deepens: intro → conflict, conflict → negotiation
- Negotiation stalls: negotiation → escalation
- Positive resolution: negotiation → resolution, escalation → resolution
- Pressure increases: pressureDelta +1 (max 5)
- Negotiation going well: pressureDelta -1
- Note: stage transitions are forward-only; backward transitions are rejected by the engine.
` : '';

  const allowedTypesLine = allowedTypes.length < 10
    ? `- Allowed incident types: ${allowedTypes.join(', ')}`
    : '';

  return `
## Simulation State Management Tool Usage Guidelines
${hasCustomPolicy ? '\n> This scenario uses a custom simulation policy.\n' : ''}
### When to Call Each Tool

**update_npc_emotion** — Call when:
- User gave empathetic or logical response → trust +5~+15, anger -5~-10
- User was rude or evasive → anger +5~+15, trust -5~-10
- User's answer was vague or unclear → confusion +5~+10
- User made a creative or interesting proposal → interest +5~+15
- Active emotion model: ${emotionList}
- Maximum ${maxCalls} calls per turn. Each delta must be within ±${maxDelta}.
${preferredSignalLines}
${stateToolSection}
**trigger_incident** — Call only when:
- anger > 80 and multiple warnings have occurred → customer_escalation (high)
- Negotiation has been prolonged → deadline_pressure (medium)
- Unexpected information emerges → new_evidence
- Only once per turn
- ${globalCooldown}s global cooldown, ${perTypeCooldown}s per-type cooldown applies
${allowedTypesLine}

### Key Principles
- Never directly mention tool results to the user. Use the state to naturally adjust your tone and response intensity.
- Deltas are changes, not absolute values. Provide appropriate change amounts based on the situation.
- You don't need to call tools for neutral exchanges.
`;
}

export function buildPlayerConstraintsBlock(
  constraints: {
    authorityLevel?: string;
    canOffer?: string[];
    cannotOffer?: string[];
    requiredBehaviors?: string[];
    forbiddenBehaviors?: string[];
  } | null | undefined,
  language: 'ko' | 'en' | 'ja' | 'zh' = 'ko'
): string {
  if (!constraints) return '';
  const hasContent = constraints.authorityLevel
    || (constraints.canOffer?.length ?? 0) > 0
    || (constraints.cannotOffer?.length ?? 0) > 0
    || (constraints.requiredBehaviors?.length ?? 0) > 0
    || (constraints.forbiddenBehaviors?.length ?? 0) > 0;
  if (!hasContent) return '';

  if (language === 'ko') {
    const lines = ['\n# 플레이어 권한 제약 (Player Authority Constraints)'];
    lines.push('상대방(플레이어)이 이 시나리오에서 가진 권한과 제약입니다. 플레이어가 권한을 벗어난 제안을 할 경우, 당신은 이를 인식하고 적절히 반응해야 합니다.');
    if (constraints.authorityLevel) lines.push(`- 권한 수준: ${constraints.authorityLevel}`);
    if (constraints.canOffer?.length) lines.push(`- 제안 가능한 것: ${constraints.canOffer.join(', ')}`);
    if (constraints.cannotOffer?.length) lines.push(`- 제안 불가한 것 (권한 밖): ${constraints.cannotOffer.join(', ')}`);
    if (constraints.requiredBehaviors?.length) lines.push(`- 상대방이 해야 하는 행동: ${constraints.requiredBehaviors.join(', ')}`);
    if (constraints.forbiddenBehaviors?.length) lines.push(`- 상대방이 해서는 안 되는 행동: ${constraints.forbiddenBehaviors.join(', ')}`);
    lines.push('⚠️ 상대방이 권한 밖의 약속이나 제안을 하면, 당신은 그것이 그들의 권한을 벗어났음을 현실적으로 지적하거나 의구심을 표현하세요.');
    return lines.join('\n');
  }

  const lines = ['\n# Player Authority Constraints'];
  lines.push("The following defines the conversation partner's (player's) authority and boundaries in this scenario. If the player makes offers or commitments outside their authority, you should recognize and react to this realistically.");
  if (constraints.authorityLevel) lines.push(`- Authority level: ${constraints.authorityLevel}`);
  if (constraints.canOffer?.length) lines.push(`- Can offer: ${constraints.canOffer.join(', ')}`);
  if (constraints.cannotOffer?.length) lines.push(`- Cannot offer (outside authority): ${constraints.cannotOffer.join(', ')}`);
  if (constraints.requiredBehaviors?.length) lines.push(`- Required behaviors: ${constraints.requiredBehaviors.join(', ')}`);
  if (constraints.forbiddenBehaviors?.length) lines.push(`- Forbidden behaviors: ${constraints.forbiddenBehaviors.join(', ')}`);
  lines.push("⚠️ If the player makes promises or offers outside their authority, realistically point it out or express skepticism.");
  return lines.join('\n');
}

export function buildSimulationStateBlock(state: {
  stage: string;
  pressureLevel: number;
  npcEmotions: { anger: number; trust: number; confusion: number; interest: number };
  currentScore: number;
  recentTurnScores?: Array<{ clarity: number; empathy: number; actionPlan: number }>;
  behaviorInstruction?: string;
  currentStageGoal?: string;
}): string {
  const lastScore = state.recentTurnScores?.[state.recentTurnScores.length - 1];
  const lines = [
    '[SIMULATION_STATE]',
    `stage=${state.stage}`,
    `pressureLevel=${state.pressureLevel}`,
    `anger=${state.npcEmotions.anger}, trust=${state.npcEmotions.trust}, confusion=${state.npcEmotions.confusion}, interest=${state.npcEmotions.interest}`,
    `currentScore=${state.currentScore}`,
  ];
  if (lastScore) {
    lines.push(`latestTurnScore: clarity=${lastScore.clarity}, empathy=${lastScore.empathy}, actionPlan=${lastScore.actionPlan}`);
  }
  if (state.currentStageGoal) {
    lines.push(`currentStageGoal: ${state.currentStageGoal}`);
  }
  if (state.behaviorInstruction) {
    lines.push(`behaviorInstruction: ${state.behaviorInstruction}`);
  }
  lines.push('[/SIMULATION_STATE]');
  lines.push('규칙: AI는 이 상태 정보를 사용자에게 그대로 노출하지 않는다. 상태를 바탕으로 말투와 반응 강도를 조절한다.');
  return lines.join('\n');
}
