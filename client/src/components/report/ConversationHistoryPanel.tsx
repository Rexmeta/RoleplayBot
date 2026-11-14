import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ConversationMessage } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonaSwitchCard, type PersonaSwitchEvent } from "../chat/PersonaSwitchCard";

export function ConversationHistoryPanel({
  messages, personaSwitchEvents = [], personaName, renderUserMessage,
}: {
  messages: ConversationMessage[];
  personaSwitchEvents?: PersonaSwitchEvent[];
  personaName: string;
  renderUserMessage?: (message: ConversationMessage, index: number) => ReactNode;
}) {
  const { t } = useTranslation();
  const visibleMessages = messages.filter(m => m.sender === "user" || m.sender === "ai");
  type Item = { type: "message"; message: ConversationMessage; index: number }
    | { type: "switch"; event: PersonaSwitchEvent };
  const items: Item[] = [];
  visibleMessages.forEach((msg, index) => {
    items.push({ type: "message", message: msg, index });
    personaSwitchEvents.filter(ev => ev.turnIndex != null
      ? msg.turnIndex != null ? msg.turnIndex === ev.turnIndex : index === ev.turnIndex
      : index === ev.toIndex
    ).forEach(event => items.push({ type: "switch", event }));
  });
  const placed = new Set(items.filter((item): item is Extract<Item, { type: "switch" }> =>
    item.type === "switch").map(item => item.event.timestamp));
  personaSwitchEvents.filter(event => !placed.has(event.timestamp))
    .forEach(event => items.push({ type: "switch", event }));

  return (
    <Card className="border-0 shadow-lg" data-testid="conversation-history">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
          <i className="fas fa-comments text-indigo-500" aria-hidden="true" />
          {t("report.tabs.conversation", "대화 내역")}
          <span className="ml-auto text-xs font-normal text-slate-400">
            {visibleMessages.length}{t("report.conversation.turns", "개 메시지")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 max-h-[600px] overflow-y-auto overscroll-contain pr-1">
          {!items.length && <p className="py-12 text-center text-slate-400">{t("report.conversation.empty", "대화 내역이 없습니다.")}</p>}
          {items.map((item, index) => {
            if (item.type === "switch") return <PersonaSwitchCard key={`switch-${item.event.timestamp}-${index}`} event={item.event} />;
            const msg = item.message;
            const isUser = msg.sender === "user";
            return (
              <div key={msg.utteranceId ?? `${msg.voiceTurnId ?? "message"}-${index}`}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div className={`min-w-0 max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  isUser ? "bg-blue-600 text-white rounded-br-sm" : "bg-slate-100 text-slate-800 rounded-bl-sm"
                }`}>
                  <div className={`text-[10px] font-semibold mb-1 ${isUser ? "text-blue-200" : "text-slate-400"}`}>
                    {isUser ? t("chat.me", "나") : personaName}
                  </div>
                  <div className="whitespace-pre-wrap break-words">
                    {isUser && renderUserMessage ? renderUserMessage(msg, item.index) : msg.message}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
