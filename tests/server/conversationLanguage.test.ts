import { describe, expect, it } from "vitest";
import { CONVERSATION_LANGUAGES, resolveConversationLanguage, conversationSpeechLocale, defaultPersonaGreeting } from "../../shared/conversationLanguage";
import { buildUserPersonaInstructions } from "../../server/services/voice/prompts/userPersonaPrompt";

describe("conversation language across profile changes and mode switches", () => {
  it.each(CONVERSATION_LANGUAGES)("keeps %s for text, voice and avatar after a profile change", language => {
    for (const preference of CONVERSATION_LANGUAGES) {
      expect(resolveConversationLanguage(language, "en", preference)).toBe(language);
      expect(resolveConversationLanguage(undefined, language, preference)).toBe(language);
    }
  });
  it.each(CONVERSATION_LANGUAGES)("initializes a new conversation from %s only when unbound", language => {
    expect(resolveConversationLanguage(undefined, null, language)).toBe(language);
    expect(conversationSpeechLocale(language)).toMatch(new RegExp(`^${language}-`));
  });
  it("does not silently change a corrupt pinned language to Korean", () => {
    expect(() => resolveConversationLanguage("fr", "en", "ko")).toThrow("invalid_conversation_language");
    expect(() => resolveConversationLanguage(undefined, "", "ko")).toThrow("invalid_conversation_language");
    expect(resolveConversationLanguage(null, null, "invalid")).toBe("ko");
  });
  it.each(CONVERSATION_LANGUAGES)("uses a localized %s persona greeting without forcing Korean honorifics", language => {
    const prompt = buildUserPersonaInstructions({ name: "Alex" }, "Sam", language);
    expect(prompt).toContain(defaultPersonaGreeting("Alex", language));
    expect(prompt).not.toContain('"Sam"님');
    if (language !== "ko") expect(prompt).not.toContain("안녕하세요!");
    expect(prompt).not.toContain("반드시 먼저 이렇게 인사");
  });
  it("treats a saved foreign-language greeting as material to express in the selected language", () => {
    const prompt = buildUserPersonaInstructions({ name: "Alex", greeting: "안녕하세요, 가격을 설명해주세요." }, "", "en");
    expect(prompt).toContain("반드시 선택된 대화 언어로 표현");
    expect(prompt).toContain("Always respond in English");
  });
});
