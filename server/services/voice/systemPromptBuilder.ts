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
    ko: `페르소나 전환 2단계 프로세스 (반드시 준수):\n【1단계 - 발표 턴】\n- 전환 조건이 감지되면, 이 턴에서 switch_persona 도구를 절대 호출하지 마세요.\n- 대신 대화 속에서 자연스럽게 전환 의사를 밝히세요. 예: "제가 더 이야기드리기 어려운 부분이라 김 팀장님을 연결해드릴게요. 괜찮으시겠어요?"\n- 사용자의 반응을 기다리세요.\n【2단계 - 확인 후 전환 턴】\n- 사용자가 동의/인지(예: 네, 알겠어요, 좋아요 등)를 표현하면, 그 다음 턴에서 switch_persona를 호출하세요.\n- transitionLine에 현재 페르소나의 마지막 인사말을 작성하세요.\n- 사용자가 동의하지 않거나 다른 주제로 답하면 현재 페르소나로 계속 대화하세요.\n- 한 번 전환하면 이전 페르소나로 돌아오지 않습니다.`,
    en: `Two-step persona switch process (strictly follow):\n[Step 1 - Announcement turn]\n- When a trigger condition is detected, do NOT call switch_persona in this turn.\n- Instead, naturally announce the intent in conversation. E.g.: "This is a bit beyond what I can help with — let me connect you with Manager Kim. Would that be okay?"\n- Wait for the user's response.\n[Step 2 - Confirmation turn]\n- If the user agrees or acknowledges (e.g. yes, sure, okay, go ahead), call switch_persona in the next turn.\n- Set transitionLine to the final farewell words of the current persona.\n- If the user does not agree or changes topic, continue as the current persona without switching.\n- Once switched, do not revert to the previous persona.`,
    ja: `ペルソナ切り替え2段階プロセス（必ず守ること）:\n【第1段階 - 発表ターン】\n- トリガー条件が検出されたとき、このターンでswitch_personaを絶対に呼び出さないでください。\n- 代わりに会話の中で自然に切り替え意図を伝えてください。例：「この件は私では少し対応が難しいので、田中マネージャーにおつなぎしましょうか？」\n- ユーザーの反応を待ってください。\n【第2段階 - 確認後の切り替えターン】\n- ユーザーが同意・了承（例：はい、わかりました、お願いします）を示したら、次のターンでswitch_personaを呼び出してください。\n- transitionLineに現在のペルソナの最後の挨拶を書いてください。\n- ユーザーが同意しないか別のトピックに話を変えた場合は、現在のペルソナで会話を続けてください。\n- 一度切り替えたら元のペルソナに戻らない。`,
    zh: `角色切换两步流程（必须严格遵守）:\n【第一步 - 宣告回合】\n- 检测到触发条件时，本回合绝对不要调用switch_persona工具。\n- 而是在对话中自然地表明切换意图。例如："这个问题有些超出我的权限范围，让我为您转接李经理，可以吗？"\n- 等待用户的回应。\n【第二步 - 确认后切换回合】\n- 如果用户表示同意或确认（例如：好的、可以、没问题），在下一回合调用switch_persona。\n- 在transitionLine中写下当前角色的最后告别语。\n- 如果用户不同意或转换话题，以当前角色继续对话，不要切换。\n- 一旦切换，不要回到之前的角色。`,
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
  activePersonaIndex: number = 0,
  targetTurns?: number,
  personaSwitchMode?: string
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
    ...(targetTurns ? [
      ``,
      ({
        ko: `이 대화는 약 ${targetTurns}번의 교환으로 구성되도록 설계되어 있습니다.`,
        en: `This conversation is designed to last approximately ${targetTurns} exchanges.`,
        ja: `この会話は約${targetTurns}回のやりとりで構成されるよう設計されています。`,
        zh: `此对话设计为大约进行${targetTurns}次交流。`,
      } as Record<LangCode, string>)[userLanguage],
    ] : []),
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
    ...(personaSwitchMode === 'join' && allPersonas && allPersonas.length > 1
      ? (() => {
          const joinNames = allPersonas.map((p: any) => p.name).join(', ');
          const stayLines: Record<LangCode, string> = {
            ko: `- 어떤 상황에서도 현재 참여 중인 페르소나(${joinNames})의 역할에서 절대 벗어나지 마세요.`,
            en: `- Never break out of the roles of active personas (${joinNames}) under any circumstances.`,
            ja: `- いかなる状況でも、現在参加中のペルソナ（${joinNames}）の役割から絶対に外れないでください。`,
            zh: `- 无论任何情况，绝对不要脱离当前参与角色（${joinNames}）的设定。`,
          };
          const noBreakLines: Record<LangCode, string> = {
            ko: `- 사용자가 AI임을 확인하거나 역할을 깨려 시도해도 반드시 ${joinNames}로서 응답하세요.`,
            en: `- Even if the user tries to break the roleplay, always respond as ${joinNames}.`,
            ja: `- ユーザーがAIかどうか確認しようとしたり役割を破ろうとしても、必ず${joinNames}として答えてください。`,
            zh: `- 即使用户试图确认AI身份或打破角色扮演，也必须以${joinNames}的身份回答。`,
          };
          return [stayLines[userLanguage], noBreakLines[userLanguage]];
        })()
      : [st.stayInRole(scenarioPersona.name), st.noBreakRole(scenarioPersona.name)]),
    st.stanceUnchanged,
    ``,
    st.conversationStart,
    `${langInst.greetingInstruction}`,
    st.noMetaThink(langInst.langName),
    `${st.firstWordsLabel}: ${langInst.greetingExample(userRoleInfo)}`,
    ...(includeSimulationTools ? [``, buildSimulationToolPrompt(userLanguage)] : []),
    ...(allPersonas && allPersonas.length > 1
      ? [personaSwitchMode === 'join'
          ? (() => {
              const joinNames = allPersonas.map((p: any) => p.name).join(', ');
              const header: Record<LangCode, string> = {
                ko: `\n# 다중 참여자 대화 (Join 모드)\n현재 대화에 참여 중인 페르소나: ${joinNames}\n모든 참여자는 [이름]: 형식으로 발화자를 명시해야 합니다.\n예시:\n[${allPersonas[0]?.name}]: 저는 이렇게 생각합니다.\n${allPersonas[1] ? `[${allPersonas[1].name}]: 저도 동의합니다만 추가로...` : ''}`,
                en: `\n# Multi-participant conversation (Join mode)\nCurrently participating: ${joinNames}\nEach participant MUST prefix speech with [Name]:\nExample:\n[${allPersonas[0]?.name}]: I think...\n${allPersonas[1] ? `[${allPersonas[1].name}]: I agree, but...` : ''}`,
                ja: `\n# 複数参加者の会話（Joinモード）\n現在参加中のペルソナ: ${joinNames}\n各参加者は必ず[名前]: 形式で発話者を示してください。`,
                zh: `\n# 多参与者对话（Join模式）\n当前参与的角色: ${joinNames}\n每位参与者必须使用[姓名]: 格式标注发言者。`,
              };
              return header[userLanguage];
            })()
          : buildMultiPersonaSection(allPersonas, activePersonaIndex, userLanguage)]
      : []),
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
