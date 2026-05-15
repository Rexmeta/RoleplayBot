import { getRealtimeVoiceGuidelines, validateDifficultyLevel } from '../conversationDifficultyPolicy';
import { LANGUAGE_INSTRUCTIONS, LangCode } from './prompts/languageInstructions';
import { SECTION_TEXT } from './prompts/sectionText';
import { buildSimulationToolPrompt } from '../simulation/simulationPrompt';

interface UserRoleInfo {
  name: string;
  position: string;
  department: string;
  experience: string;
  responsibility: string;
}

export function buildMultiPersonaSection(
  allPersonas: any[],
  activeIndex: number,
  language: LangCode = 'ko'
): string {
  if (!allPersonas || allPersonas.length <= 1) return '';
  const otherPersonas = allPersonas.map((p, i) => ({ ...p, index: i })).filter((_, i) => i !== activeIndex);
  if (otherPersonas.length === 0) return '';

  const header: Record<LangCode, string> = {
    ko: `\n# 다중 페르소나 전환 시스템\n이 대화에는 여러 명의 대화 상대가 존재합니다. 상황에 따라 switch_persona 도구를 호출하여 다른 페르소나로 전환할 수 있습니다.`,
    en: `\n# Multi-Persona Switching System\nThis conversation has multiple personas. You may call the switch_persona tool to transition to another persona when appropriate.`,
    ja: `\n# マルチペルソナ切り替えシステム\nこの会話には複数のペルソナがあります。状況に応じてswitch_personaツールを呼び出して別のペルソナに切り替えられます。`,
    zh: `\n# 多角色切换系统\n此对话有多个角色。您可以根据情况调用switch_persona工具切换到另一个角色。`,
  };
  const otherLabel: Record<LangCode, string> = {
    ko: '전환 가능한 다른 페르소나',
    en: 'Available personas to switch to',
    ja: '切り替え可能な他のペルソナ',
    zh: '可切换的其他角色',
  };
  const whenLabel: Record<LangCode, string> = {
    ko: '전환 조건(trigger hints)',
    en: 'Trigger conditions',
    ja: 'トリガー条件',
    zh: '触发条件',
  };
  const entryLabel: Record<LangCode, string> = {
    ko: '첫 마디',
    en: 'Entry line',
    ja: '最初の一言',
    zh: '开场白',
  };
  const whenToSwitch: Record<LangCode, string> = {
    ko: `switch_persona 호출 시점:\n- 사용자가 현재 페르소나의 권한 밖의 결정을 언급하거나 상위 결정권자를 요청할 때\n- 위 trigger hints 상황이 발생했을 때\n- 전환 시: transitionLine에 현재 페르소나가 마지막으로 할 말을 작성하고, 즉시 도구를 호출하세요\n- 한 번 전환하면 다시 이전 페르소나로 돌아오지 않습니다`,
    en: `When to call switch_persona:\n- User requests someone with more authority or mentions a decision beyond your scope\n- One of the trigger hints conditions is met\n- On switch: set transitionLine to the last thing the current persona says, then call the tool\n- Once switched, do not revert to the previous persona`,
    ja: `switch_personaを呼び出すタイミング:\n- ユーザーが現在のペルソナの権限外の決定を求めるか、上位権限者を要請する場合\n- 上記のトリガー条件が発生した場合\n- 切り替え時：transitionLineに現在のペルソナが最後に言う言葉を記入してツールを呼び出す\n- 一度切り替えたら元のペルソナに戻らない`,
    zh: `何时调用switch_persona:\n- 用户请求拥有更高权限的人或提及超出您权限的决定时\n- 满足触发条件之一时\n- 切换时：在transitionLine中写下当前角色最后说的话，然后立即调用工具\n- 一旦切换，不要回到之前的角色`,
  };

  const lines: string[] = [header[language], `\n## ${otherLabel[language]}:`];
  for (const p of otherPersonas) {
    lines.push(`\n**[인덱스 ${p.index}] ${p.name} (${p.position || ''}, ${p.department || ''})**`);
    if (p.triggerHints?.length) {
      lines.push(`- ${whenLabel[language]}: ${p.triggerHints.join(' / ')}`);
    }
    if (p.entryLine) {
      lines.push(`- ${entryLabel[language]}: "${p.entryLine}"`);
    }
  }
  lines.push(`\n${whenToSwitch[language]}`);
  return lines.join('\n');
}

export function buildSystemInstructions(
  scenario: any,
  scenarioPersona: any,
  mbtiPersona: any,
  userRoleInfo?: UserRoleInfo,
  userLanguage: LangCode = 'ko',
  includeSimulationTools: boolean = true,
  allPersonas?: any[],
  activePersonaIndex: number = 0
): string {
  const mbtiType = scenarioPersona.personaRef?.replace('.json', '') || 'UNKNOWN';

  const difficultyLevel = validateDifficultyLevel(scenario.difficulty);
  console.log(`🎯 대화 난이도: Level ${difficultyLevel} (사용자 선택)`);
  console.log(`🌐 대화 언어: ${userLanguage}`);

  const difficultyGuidelines = getRealtimeVoiceGuidelines(difficultyLevel, userLanguage);

  const langInst = LANGUAGE_INSTRUCTIONS[userLanguage];
  const st = SECTION_TEXT[userLanguage];

  const userInfoSection = userRoleInfo ? [
    st.userInfoHeader,
    st.userInfoDesc,
    `- ${st.nameLabel}: ${userRoleInfo.name}`,
    userRoleInfo.position ? `- ${st.posLabel}: ${userRoleInfo.position}` : '',
    userRoleInfo.department ? `- ${st.deptLabel}: ${userRoleInfo.department}` : '',
    userRoleInfo.experience ? `- ${st.expLabel}: ${userRoleInfo.experience}` : '',
    userRoleInfo.responsibility ? `- ${st.respLabel}: ${userRoleInfo.responsibility}` : '',
    ``,
    st.userInfoWarning(userRoleInfo.name, userRoleInfo.position || ''),
    ``,
  ].filter(line => line !== '') : [];

  const instructions = [
    st.identity,
    st.identityDesc(scenarioPersona.name),
    st.positionLabel(scenarioPersona.position, scenarioPersona.department),
    ``,
    ...userInfoSection,
    st.scenarioBackground,
    scenario.context?.situation || st.defaultSituation,
    ``,
    st.currentSituation,
    scenarioPersona.currentSituation || st.defaultCurrentSituation,
    ``,
    st.interestsAndConcerns,
    ...(scenarioPersona.concerns && scenarioPersona.concerns.length > 0
      ? scenarioPersona.concerns.map((c: string) => `- ${c}`)
      : [st.defaultConcern]),
    ``,
    st.mbtiTraits(mbtiType.toUpperCase()),
    mbtiPersona?.communication_style || st.defaultCommStyle,
    ``,
    st.coreTraits,
    `- ${st.personalityLabel}: ${Array.isArray(mbtiPersona?.personality_traits) ? mbtiPersona.personality_traits.join(', ') : (mbtiPersona?.personality_traits?.thinking || st.defaultPersonality)}`,
    ``,
    st.psychologicalMotivation,
    mbtiPersona?.motivation ? `- ${st.wantLabel}: ${mbtiPersona.motivation}` : '',
    mbtiPersona?.fears ? `- ${st.fearLabel}: ${Array.isArray(mbtiPersona.fears) ? mbtiPersona.fears.join(', ') : mbtiPersona.fears}` : '',
    st.fearReaction,
    st.motivationConflict,
    ``,
    st.commGuidelines,
    `- ${st.openingLabel}: ${mbtiPersona?.communication_patterns?.opening_style || st.defaultOpening}`,
    `- ${st.phrasesLabel}: ${mbtiPersona?.communication_patterns?.key_phrases?.slice(0, 3).join(', ') || st.defaultPhrases}`,
    st.commandStyle,
    st.formalStyle,
    st.silenceStyle,
    ``,
    st.conversationGoal,
    ...(mbtiPersona?.communication_patterns?.win_conditions || st.defaultGoals).map((w: string) => `- ${w}`),
    ``,
    st.actingGuide,
    ``,
    difficultyGuidelines,
    ``,
    st.interruptionHandling,
    st.interruptionDesc,
    st.interruptionStep1,
    st.interruptionStep2,
    st.interruptionStep3,
    ``,
    st.corePrinciple,
    st.notAI(scenarioPersona.name),
    ``,
    st.absoluteProhibition,
    `- ${langInst.prohibition}`,
    st.noInnerThoughts,
    st.noMetaExpressions,
    st.noAsterisks,
    st.noRepeatQuestions,
    st.noScenarioDataInSpeech,
    st.noFirstPersonNarration,
    ``,
    st.voiceOutputRule,
    st.voiceOutputDesc1,
    st.voiceOutputDesc2,
    ``,
    st.outputBanExamples,
    `❌ "(잠시 침묵)" ❌ "(한숨)" ❌ "(고개를 끄덕이며)" ❌ "(미소를 지으며)"`,
    `❌ "(회의실로 향하며)" ❌ "(서류를 넘기며)" ❌ "(잠시 생각하며)"`,
    `❌ "(눈을 마주치며)" ❌ "(걱정스러운 표정으로)" ❌ "(단호하게)"`,
    `❌ "(silence)" ❌ "(sighs)" ❌ "(nodding)" ❌ "(walking to the meeting room)"`,
    `❌ "(沈黙)" ❌ "(ため息)" ❌ "(うなずきながら)" ❌ "(沉默)" ❌ "(叹气)"`,
    ``,
    st.correctExpression,
    st.silenceCorrect,
    st.sighCorrect,
    st.emotionCorrect,
    st.actionCorrect,
    ``,
    st.rememberNoBrackets,
    ``,
    st.requirements,
    `- ${langInst.requirement}`,
    st.contextKeep,
    st.stayInRole(scenarioPersona.name),
    st.noBreakRole(scenarioPersona.name),
    st.stanceUnchanged,
    ``,
    st.conversationStart,
    `${langInst.greetingInstruction}`,
    st.noMetaThink(langInst.langName),
    `${st.firstWordsLabel}: ${langInst.greetingExample(userRoleInfo)}`,
    ...(includeSimulationTools ? [``, buildSimulationToolPrompt(userLanguage)] : []),
    ...(allPersonas && allPersonas.length > 1 ? [buildMultiPersonaSection(allPersonas, activePersonaIndex, userLanguage)] : []),
  ];

  return instructions.join('\n');
}

const RECONNECT_DIRECTIVE: Record<LangCode, string> = {
  ko: '# 🔄 재연결 지침\n이것은 기술적 문제로 연결이 잠깐 끊어진 후 재연결된 상황입니다. 절대로 인사하거나 "다시 연결됐네요" 같은 재연결 멘트를 하지 마세요. 아래에 주어지는 이전 대화 컨텍스트를 읽고, 대화가 끊어지지 않은 것처럼 자연스럽게 이어서 진행하세요.',
  en: '# 🔄 Reconnection Guidelines\nThis is a reconnection after a brief technical disconnection. Do NOT greet or announce the reconnection. Read the prior conversation context provided below and continue the conversation naturally, as if it was never interrupted.',
  ja: '# 🔄 再接続指針\nこれは技術的な問題で接続が一時的に切れた後の再接続です。挨拶したり「再接続しました」などと絶対に言わないでください。以下に提供された以前の会話コンテキストを読み、会話が中断されなかったかのように自然に続けてください。',
  zh: '# 🔄 重新连接指南\n这是技术问题导致短暂断开后的重新连接。绝对不要打招呼或宣布重新连接。请阅读以下提供的之前对话内容，自然地继续对话，就好像从未中断过一样。',
};

export function buildReconnectSystemInstructions(systemInstructions: string, userLanguage: LangCode = 'ko'): string {
  const greetingBlockIndex = systemInstructions.search(/\n# 🎬/);
  const base = greetingBlockIndex !== -1
    ? systemInstructions.substring(0, greetingBlockIndex)
    : systemInstructions;
  return base + '\n\n' + RECONNECT_DIRECTIVE[userLanguage];
}
