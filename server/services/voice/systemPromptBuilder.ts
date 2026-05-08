import { getRealtimeVoiceGuidelines, validateDifficultyLevel } from '../conversationDifficultyPolicy';
import { LANGUAGE_INSTRUCTIONS, LangCode } from './prompts/languageInstructions';
import { SECTION_TEXT } from './prompts/sectionText';

interface UserRoleInfo {
  name: string;
  position: string;
  department: string;
  experience: string;
  responsibility: string;
}

export function buildSystemInstructions(
  scenario: any,
  scenarioPersona: any,
  mbtiPersona: any,
  userRoleInfo?: UserRoleInfo,
  userLanguage: LangCode = 'ko'
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
