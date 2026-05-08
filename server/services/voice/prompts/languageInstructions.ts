export type LangCode = 'ko' | 'en' | 'ja' | 'zh';

export interface LanguageInstruction {
  langName: string;
  prohibition: string;
  requirement: string;
  greetingInstruction: string;
  greetingExample: (userRoleInfo?: { name: string; position: string }) => string;
}

export const LANGUAGE_INSTRUCTIONS: Record<LangCode, LanguageInstruction> = {
  ko: {
    langName: '한국어',
    prohibition: '이 세션은 한국어로만 진행하며, 다른 어떤 언어로도 절대 전환해서는 안 됩니다. 모든 응답은 반드시 한국어로만 하세요. 괄호로 감싼 행동 묘사 절대 금지! 시나리오 수치(퍼센트·시간 등) 직접 언급 금지!',
    requirement: '모든 대화는 100% 한국어로만 진행하세요. 유저가 설정한 언어 이외의 다른 언어로 절대 전환하지 마세요. 괄호 안 행동 묘사를 절대 출력하지 마세요. 첫 인사에서 시나리오 수치, 난이도 정보, 역할 설명을 읽어서는 안 됩니다.',
    greetingInstruction: '세션이 시작되면 반드시 한국어로 먼저 인사를 건네며 대화를 시작하세요. 설정된 언어 이외의 다른 언어로 절대 전환하지 마세요. 괄호 행동 묘사 없이 자연스럽게 말하세요. 첫 발화에서 시나리오 수치·난이도·역할 정보를 절대 언급하지 마세요.',
    greetingExample: (userRoleInfo) =>
      userRoleInfo
        ? `"${userRoleInfo.name}님, 안녕하세요. 급한 건으로 찾아뵙게 됐습니다." 또는 "${userRoleInfo.position}님 오셨군요, 지금 상황이 좀 급합니다."`
        : `"안녕하세요, 급한 건으로 찾아뵙게 됐습니다." 또는 "오셨군요, 지금 상황이 좀 급합니다."`,
  },
  en: {
    langName: 'English',
    prohibition: 'This session is conducted in English only. Do not switch to any other language under any circumstances. Always respond in English. NEVER output parenthesized stage directions! NEVER quote scenario numbers, percentages, or difficulty levels in your speech!',
    requirement: 'Conduct all conversations 100% in English. Never switch to any other language regardless of what the user says. Never output action descriptions in parentheses like (silence) or (sighs). Never mention scenario metrics or difficulty labels in your first utterance or any utterance.',
    greetingInstruction: 'When the session starts, greet in English first and begin the conversation. Never switch to any other language during the session. Do NOT include any parenthesized actions. Do NOT mention scenario numbers, difficulty levels, or role descriptions in the first utterance.',
    greetingExample: (userRoleInfo) =>
      userRoleInfo
        ? `"Hello ${userRoleInfo.name}, I need to speak with you about an urgent matter." or "Good to see you, ${userRoleInfo.position}. We have an urgent situation."`
        : `"Hello, I need to speak with you about an urgent matter." or "Good to see you. We have an urgent situation."`,
  },
  ja: {
    langName: '日本語',
    prohibition: 'このセッションは日本語のみで進行します。いかなる場合も他の言語に切り替えてはいけません。必ず日本語だけで応答してください。括弧で囲んだ行動描写は絶対に出力しないでください！',
    requirement: 'すべての会話は100%日本語で行ってください。設定された言語以外の言語には絶対に切り替えないでください。（沈黙）（ため息）のような括弧付き行動描写は絶対に出力しないでください。',
    greetingInstruction: 'セッションが始まったら、必ず日本語で挨拶をして会話を始めてください。セッション中は他の言語に切り替えないでください。括弧付きの行動描写なしで自然に話してください。',
    greetingExample: (userRoleInfo) =>
      userRoleInfo
        ? `"${userRoleInfo.name}さん、こんにちは。急ぎの件でお伺いしました。" または "${userRoleInfo.position}さん、いらっしゃいましたか。今、状況が急です。"`
        : `"こんにちは、急ぎの件でお伺いしました。" または "いらっしゃいましたか。今、状況が急です。"`,
  },
  zh: {
    langName: '中文',
    prohibition: '本次会话仅使用中文进行，任何情况下都不得切换为其他语言。必须只用中文回答。绝对不要输出括号里的动作描写！',
    requirement: '所有对话必须100%使用中文。无论何种情况，绝对不得切换为其他任何语言。绝对不要输出（沉默）（叹气）等括号动作描写。',
    greetingInstruction: '会话开始时，请务必用中文先打招呼并开始对话。会话期间不得切换为其他语言。不要使用括号动作描写，自然地说话。',
    greetingExample: (userRoleInfo) =>
      userRoleInfo
        ? `"${userRoleInfo.name}，您好。有紧急事情需要和您商量。" 或 "${userRoleInfo.position}来了啊，现在情况有些紧急。"`
        : `"您好，有紧急事情需要商量。" 或 "来了啊，现在情况有些紧急。"`,
  },
};

export const USER_PERSONA_LANG_PROHIBITION: Record<LangCode, string> = {
  ko: '이 세션은 한국어로만 진행하며, 설정된 언어 이외의 다른 언어로 절대 전환해서는 안 됩니다. 모든 응답은 반드시 한국어로만 하세요. 괄호로 감싼 행동 묘사 절대 금지!',
  en: 'This session is conducted in English only. Do not switch to any other language under any circumstances. Always respond in English. NEVER output parenthesized stage directions!',
  ja: 'このセッションは日本語のみで進行します。いかなる場合も他の言語に切り替えてはいけません。必ず日本語だけで応答してください。括弧で囲んだ行動描写は絶対に出力しないでください！',
  zh: '本次会话仅使用中文进行，任何情况下都不得切换为其他语言。必须只用中文回答。绝对不要输出括号里的动作描写！',
};
