
/**
 * Prompt Adapter Layer — injects only the minimum context the model needs.
 *
 * Design intent: all tool-policy rules (cooldowns, per-type thresholds, allowed types,
 * stage transition conditions, etc.) are enforced server-side by the engine.
 * The prompt adapter communicates only:
 *   1. What tools are available and their one-line purpose
 *   2. A note that the server validates/enforces all limits
 *   3. Current simulation state (stage, pressure, emotions) via buildSimulationStateBlock()
 *   4. Active playerConstraints summary via buildPlayerConstraintsBlock()
 *   5. Next-action hints derived from current stage (added per-turn via buildSimulationStateBlock)
 *
 * Static harness rules (npcBehaviorHarness, difficultyProfile, evaluationHarness,
 * flowGraph transition conditions) are NOT injected here — the engine enforces them.
 */
export function buildSimulationToolPrompt(
  language: 'ko' | 'en' | 'ja' | 'zh' = 'ko'
): string {
  if (language === 'ko') {
    return `## 시뮬레이션 도구
서버가 모든 쿨다운·한도·단계 전환 유효성을 검증합니다. 아래 도구를 상황에 맞게 사용하세요.
- **update_npc_emotion**: 사용자 반응에 따라 NPC 감정(anger/trust/confusion/interest)을 조정.
- **update_scenario_state**: 갈등 심화, 긴장 고조, 해결, 또는 압박 수준 변화 시 호출.
- **trigger_incident**: 중요한 전환점에서 돌발 이벤트 발생.
원칙: 도구 결과를 대화 중 직접 언급하지 말고 자연스러운 말투 변화로 표현하세요.`;
  }

  return `## Simulation Tools
The server validates all cooldowns, limits, and stage transition rules. Use these tools as appropriate.
- **update_npc_emotion**: Adjust NPC emotions (anger/trust/confusion/interest) based on user response quality.
- **update_scenario_state**: Call on deepening conflict, escalation, resolution, or pressure change.
- **trigger_incident**: Trigger an unexpected event at a pivotal moment.
Principle: never mention tool results directly — reflect them through natural tone adjustments.`;
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
