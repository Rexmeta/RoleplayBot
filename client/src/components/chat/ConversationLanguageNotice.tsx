import { useTranslation } from "react-i18next";
import type { ConversationLanguage } from "@shared/conversationLanguage";

const names = { ko: "한국어", en: "English", ja: "日本語", zh: "中文" };
const messages = {
  ko: (name: string) => `이 대화는 ${name}로 진행됩니다. 언어 설정 변경은 새 대화부터 적용됩니다.`,
  en: (name: string) => `This conversation uses ${name}. Language setting changes apply to new conversations.`,
  ja: (name: string) => `この会話の言語は${name}です。言語設定の変更は新しい会話から適用されます。`,
  zh: (name: string) => `本次对话使用${name}。语言设置更改将应用于新对话。`,
};

export function ConversationLanguageNotice({ language }: { language?: ConversationLanguage }) {
  const { i18n } = useTranslation();
  const uiLanguage = (i18n.resolvedLanguage || i18n.language).split("-")[0];
  if (!language || uiLanguage === language) return null;
  const message = messages[uiLanguage as ConversationLanguage] ?? messages.en;
  return <p role="status" data-testid="conversation-language-notice" className="mx-auto max-w-5xl px-3 py-2 text-xs text-slate-500">
    {message(names[language])}
  </p>;
}
