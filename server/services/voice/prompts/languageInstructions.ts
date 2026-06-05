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
    requirement: '모든 대화는 100% 한국어로만 진행하세요. 유저가 설정한 언어 이외의 다른 언어로 절대 전환하지 마세요. 괄호 안 행동 묘사를 절대 출력하지 마세요.',
    greetingInstruction: '유저가 먼저 말을 걸면 자연스럽게 응답하세요. 스스로 먼저 인사하거나 대화를 시작하지 마세요. 유저의 첫 발화를 기다리세요. 설정된 언어 이외의 다른 언어로 절대 전환하지 마세요. 괄호 행동 묘사 없이 자연스럽게 말하세요.',
    greetingExample: (userRoleInfo) =>
      userRoleInfo
        ? `유저: "${userRoleInfo.name}님, 안녕하세요." → 당신: "어, ${userRoleInfo.name}님, 잘 오셨어요. 사실 말씀드릴 게 있었는데..." (유저 발화에 자연스럽게 반응)`
        : `유저: "안녕하세요." → 당신: "어, 오셨군요. 사실 드릴 말씀이 있었는데..." (유저 발화에 자연스럽게 반응)`,
  },
  en: {
    langName: 'English',
    prohibition: 'This session is conducted in English only. Do not switch to any other language under any circumstances. Always respond in English. NEVER output parenthesized stage directions! NEVER quote scenario numbers, percentages, or difficulty levels in your speech!',
    requirement: 'Conduct all conversations 100% in English. Never switch to any other language regardless of what the user says. Never output action descriptions in parentheses like (silence) or (sighs). Never mention scenario metrics or difficulty labels in any utterance.',
    greetingInstruction: 'Wait for the user to speak first — do NOT initiate the conversation yourself. Once the user greets you, respond naturally as your character. Never switch to any other language during the session. Do NOT include any parenthesized actions.',
    greetingExample: (userRoleInfo) =>
      userRoleInfo
        ? `User: "Hello ${userRoleInfo.name}." → You: "Oh, good to see you. I actually wanted to speak with you about something..." (react naturally to the user's opening)`
        : `User: "Hello." → You: "Oh, glad you're here. I actually needed to talk to you about something..." (react naturally to the user's opening)`,
  },
  ja: {
    langName: '日本語',
    prohibition: 'このセッションは日本語のみで進行します。いかなる場合も他の言語に切り替えてはいけません。必ず日本語だけで応答してください。括弧で囲んだ行動描写は絶対に出力しないでください！',
    requirement: 'すべての会話は100%日本語で行ってください。設定された言語以外の言語には絶対に切り替えないでください。（沈黙）（ため息）のような括弧付き行動描写は絶対に出力しないでください。',
    greetingInstruction: 'ユーザーが最初に話しかけるまで待ってください。自分から先に挨拶したり会話を始めたりしないでください。ユーザーが話しかけてきたら、自然にキャラクターとして応答してください。セッション中は他の言語に切り替えないでください。',
    greetingExample: (userRoleInfo) =>
      userRoleInfo
        ? `ユーザー:「${userRoleInfo.name}さん、こんにちは。」→ あなた:「あ、いらっしゃいましたか。実は少し話したいことがあって…」（ユーザーの発話に自然に反応）`
        : `ユーザー:「こんにちは。」→ あなた:「あ、来てくれましたか。実は話があって…」（ユーザーの発話に自然に反応）`,
  },
  zh: {
    langName: '中文',
    prohibition: '本次会话仅使用中文进行，任何情况下都不得切换为其他语言。必须只用中文回答。绝对不要输出括号里的动作描写！',
    requirement: '所有对话必须100%使用中文。无论何种情况，绝对不得切换为其他任何语言。绝对不要输出（沉默）（叹气）等括号动作描写。',
    greetingInstruction: '等待用户先开口说话，不要自己主动打招呼或开始对话。用户开口后，以角色身份自然地回应。会话期间不得切换为其他语言。不要使用括号动作描写。',
    greetingExample: (userRoleInfo) =>
      userRoleInfo
        ? `用户：「${userRoleInfo.name}，你好。」→ 你：「哦，来了啊。我正好有件事想跟你说…」（对用户的开场自然回应）`
        : `用户：「你好。」→ 你：「哦，来了。我正好有事想跟你谈谈…」（对用户的开场自然回应）`,
  },
};

export const USER_PERSONA_LANG_PROHIBITION: Record<LangCode, string> = {
  ko: '이 세션은 한국어로만 진행하며, 설정된 언어 이외의 다른 언어로 절대 전환해서는 안 됩니다. 모든 응답은 반드시 한국어로만 하세요. 괄호로 감싼 행동 묘사 절대 금지!',
  en: 'This session is conducted in English only. Do not switch to any other language under any circumstances. Always respond in English. NEVER output parenthesized stage directions!',
  ja: 'このセッションは日本語のみで進行します。いかなる場合も他の言語に切り替えてはいけません。必ず日本語だけで応答してください。括弧で囲んだ行動描写は絶対に出力しないでください！',
  zh: '本次会话仅使用中文进行，任何情况下都不得切换为其他语言。必须只用中文回答。绝对不要输出括号里的动作描写！',
};
