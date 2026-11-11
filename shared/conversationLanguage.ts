export const CONVERSATION_LANGUAGES = ["ko", "en", "ja", "zh"] as const;
export type ConversationLanguage = typeof CONVERSATION_LANGUAGES[number];

export function isConversationLanguage(value: unknown): value is ConversationLanguage {
  return typeof value === "string" && (CONVERSATION_LANGUAGES as readonly string[]).includes(value);
}

/** Runtime binding wins; changing a profile only affects new conversations. */
export function resolveConversationLanguage(
  boundLanguage: unknown, runLanguage?: unknown, preferredLanguage?: unknown,
): ConversationLanguage {
  for (const value of [boundLanguage, runLanguage]) {
    if (value == null) continue;
    if (!isConversationLanguage(value)) throw new Error("invalid_conversation_language");
    return value;
  }
  return isConversationLanguage(preferredLanguage) ? preferredLanguage : "ko";
}

export function conversationSpeechLocale(language: ConversationLanguage): string {
  return { ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN" }[language];
}

export function defaultPersonaGreeting(name: string, language: ConversationLanguage): string {
  return {
    ko: `안녕하세요! 저는 ${name}입니다.`,
    en: `Hello! I'm ${name}.`,
    ja: `こんにちは！${name}です。`,
    zh: `你好！我是${name}。`,
  }[language];
}
