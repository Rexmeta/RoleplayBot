import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type ConversationMessage } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { PersonaSwitchCard, type PersonaSwitchEvent } from "@/components/chat/PersonaSwitchCard";

interface SwitchLogEntry {
  turn: number;
  fromPersonaIndex: number;
  toPersonaIndex: number;
  fromPersonaId: string;
  toPersonaId: string;
  reason: string;
  transitionLine: string;
  timestamp: string;
}

interface ScenarioPersona {
  id?: string;
  name?: string;
  department?: string;
  role?: string;
}

export default function ConversationView() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [, params] = useRoute("/chat/:conversationId");
  const [, navigate] = useLocation();
  const conversationId = params?.conversationId;
  const returnTo = new URLSearchParams(window.location.search).get('returnTo') || null;

  const { data: conversation, isLoading: conversationLoading } = useQuery<any>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const { data: scenario, isLoading: scenarioLoading, isError: scenarioError } = useQuery<any>({
    queryKey: ["/api/scenarios", conversation?.scenarioId],
    enabled: !!conversation?.scenarioId,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: false,
  });

  const isLoading = conversationLoading || (scenarioLoading && !scenarioError);

  const { effectiveTitle, effectivePersonaLabel, isScenarioMissing } = useMemo(() => {
    if (!conversation) return { effectiveTitle: '', effectivePersonaLabel: '', isScenarioMissing: false };

    let title = '';
    let missing = false;

    const personas: ScenarioPersona[] =
      (scenario?.personas as ScenarioPersona[] | undefined) ??
      (conversation.personaSnapshot ? [conversation.personaSnapshot as ScenarioPersona] : []);

    const buildLabel = (p: ScenarioPersona | undefined): string =>
      p ? [p.department, p.name, p.role].filter(Boolean).join(' ') : '';

    if (scenario) {
      title = scenario.title;
    }

    if (!title) {
      title = conversation.scenarioName || conversation.scenarioId || '삭제된 시나리오';
      missing = true;
    }

    // Resolve initial persona label
    let initialLabel = '';
    if (scenario) {
      const p = scenario.personas?.find((p: any) => p.id === conversation.personaId);
      initialLabel = buildLabel(p);
    }
    if (!initialLabel && conversation.personaSnapshot) {
      initialLabel = buildLabel(conversation.personaSnapshot as ScenarioPersona);
    }
    if (!initialLabel) {
      initialLabel = t('common.unknown');
    }

    // Resolve final persona label from switch log
    const rawLog = conversation.personaSwitchLog;
    const log: SwitchLogEntry[] = Array.isArray(rawLog) ? (rawLog as SwitchLogEntry[]) : [];

    let personaLabel = initialLabel;
    if (log.length > 0) {
      const sorted = [...log].sort((a, b) => a.turn - b.turn);
      const lastEntry = sorted[sorted.length - 1];
      const finalPersona = personas[lastEntry.toPersonaIndex];
      const finalLabel = buildLabel(finalPersona);
      if (finalLabel && finalLabel !== initialLabel) {
        personaLabel = `${initialLabel} → ${finalLabel}`;
      } else if (finalLabel) {
        personaLabel = finalLabel;
      }
    }

    return { effectiveTitle: title, effectivePersonaLabel: personaLabel, isScenarioMissing: missing };
  }, [conversation, scenario, t]);

  const scenarioPersonas: ScenarioPersona[] = useMemo<ScenarioPersona[]>(
    () => (scenario?.personas as ScenarioPersona[] | undefined) ?? (conversation?.personaSnapshot ? [conversation.personaSnapshot as ScenarioPersona] : []),
    [scenario?.personas, conversation?.personaSnapshot],
  );

  const personaSwitchEvents: PersonaSwitchEvent[] = useMemo(() => {
    const rawLog = conversation?.personaSwitchLog;
    const log: SwitchLogEntry[] = Array.isArray(rawLog) ? (rawLog as SwitchLogEntry[]) : [];
    return log.map((entry) => ({
      fromIndex: entry.fromPersonaIndex,
      fromPersonaName: scenarioPersonas[entry.fromPersonaIndex]?.name,
      toIndex: entry.toPersonaIndex,
      newPersonaName: scenarioPersonas[entry.toPersonaIndex]?.name ?? `페르소나 #${entry.toPersonaIndex + 1}`,
      reason: entry.reason,
      transitionLine: entry.transitionLine,
      timestamp: entry.timestamp,
      turnIndex: entry.turn,
    }));
  }, [conversation?.personaSwitchLog, scenarioPersonas]);

  const switchEventKey = (ev: PersonaSwitchEvent): string =>
    `${ev.turnIndex ?? ev.toIndex}-${ev.fromIndex}-${ev.toIndex}`;

  // Returns the persona label that should be shown on an AI message given its
  // position in the conversation.  We walk the switch log (sorted by turn) and
  // return the name of the most-recent persona whose switch turn is <= the
  // message's effective turn index.  Falls back to effectivePersonaLabel when
  // there is no switch log or no earlier switch applies.
  const getPersonaLabelForMessage = useMemo(() => {
    const rawLog = conversation?.personaSwitchLog;
    const log: SwitchLogEntry[] = Array.isArray(rawLog) ? (rawLog as SwitchLogEntry[]) : [];
    const sorted = [...log].sort((a, b) => a.turn - b.turn);

    return (msg: ConversationMessage, idx: number): string => {
      if (sorted.length === 0) return effectivePersonaLabel;
      const effectiveTurn = msg.turnIndex != null ? msg.turnIndex : idx;
      let activePersonaIndex = -1;
      for (const entry of sorted) {
        if (entry.turn <= effectiveTurn) {
          activePersonaIndex = entry.toPersonaIndex;
        } else {
          break;
        }
      }
      if (activePersonaIndex < 0) return effectivePersonaLabel;
      const p = scenarioPersonas[activePersonaIndex];
      if (!p) return effectivePersonaLabel;
      return [p.department, p.name, p.role].filter(Boolean).join(' ') || effectivePersonaLabel;
    };
  }, [conversation?.personaSwitchLog, scenarioPersonas, effectivePersonaLabel]);

  if (isLoading || !conversation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('conversation.loading')}</p>
        </div>
      </div>
    );
  }

  const showDeletedBanner = scenario?.isDeleted || isScenarioMissing;

  const isAdminOrOperator = currentUser?.role === 'admin' || currentUser?.role === 'operator';
  const isAdminView = isAdminOrOperator && conversation?.userId && conversation.userId !== currentUser?.id;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {isAdminView && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-blue-800">관리자 열람 모드 — 읽기 전용입니다.</span>
          <Button size="sm" variant="outline" onClick={() => returnTo ? navigate(returnTo) : window.history.back()}>뒤로 가기</Button>
        </div>
      )}
      <div className="max-w-4xl mx-auto p-6">
        {showDeletedBanner && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-center">
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 mr-2">삭제된 시나리오</Badge>
            <span className="text-sm text-yellow-800">이 시나리오는 삭제되었지만, 대화 기록은 계속 열람할 수 있습니다.</span>
          </div>
        )}
        <div className="mb-6 flex items-center justify-between">
          {isAdminView ? (
            <Button
              variant="outline"
              onClick={() => returnTo ? navigate(returnTo) : window.history.back()}
              data-testid="back-button"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              뒤로 가기
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => window.location.href = '/mypage'}
              data-testid="back-button"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t('conversation.backToMyPage')}
            </Button>
          )}
          {!isAdminView && conversation.status === 'completed' && (
            <Button
              onClick={() => window.location.href = `/feedback/${conversationId}`}
              data-testid="view-feedback-button"
            >
              {t('conversation.viewFeedback')}
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              {t('conversation.history')} - {effectiveTitle}
            </CardTitle>
            <div className="text-sm text-slate-600">
              {t('conversation.partner')}: {effectivePersonaLabel}
            </div>
            <div className="text-xs text-slate-500">
              {format(new Date(conversation.createdAt), 'yyyy년 MM월 dd일 HH:mm')}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {conversation.messages.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">{t('conversation.noMessages')}</p>
                  <p className="text-sm mt-2">{t('conversation.noMessagesHint')}</p>
                </div>
              ) : (
                (() => {
                  type ListItem =
                    | { type: 'message'; message: ConversationMessage; index: number }
                    | { type: 'switch'; event: PersonaSwitchEvent; targetMessageIndex?: number };
                  const items: ListItem[] = [];
                  const placedKeys = new Set<string>();

                  (conversation.messages as ConversationMessage[]).forEach((msg, idx) => {
                    // Insert switch markers BEFORE the first AI message of the new persona.
                    // Restrict to sender === 'ai' so that when multiple messages share a
                    // turnIndex (e.g. an initial AI greeting + a later AI response both at
                    // turn 0), the marker only fires at the AI response generated after the
                    // user's turn — not at any earlier message sharing that turn index.
                    personaSwitchEvents
                      .filter(ev => {
                        if (msg.sender !== 'ai') return false;
                        const match = ev.turnIndex != null
                          ? msg.turnIndex != null
                            ? msg.turnIndex === ev.turnIndex
                            : idx === ev.turnIndex
                          : idx === ev.toIndex;
                        return match;
                      })
                      .forEach(ev => {
                        const key = switchEventKey(ev);
                        if (!placedKeys.has(key)) {
                          placedKeys.add(key);
                          // idx is the message array index of the first AI message for the
                          // new persona — use it as the scroll target, not the persona index.
                          items.push({ type: 'switch', event: ev, targetMessageIndex: idx });
                        }
                      });
                    items.push({ type: 'message', message: msg, index: idx });
                  });

                  // Append any switch events that didn't match any message position
                  personaSwitchEvents
                    .filter(ev => !placedKeys.has(switchEventKey(ev)))
                    .forEach(ev => items.push({ type: 'switch', event: ev }));

                  return items.map((item, itemIndex) => {
                    if (item.type === 'switch') {
                      return (
                        <PersonaSwitchCard
                          key={`switch-${switchEventKey(item.event)}-${itemIndex}`}
                          event={item.event}
                          targetIndex={item.targetMessageIndex}
                        />
                      );
                    }
                    const message = item.message;
                    const index = item.index;
                    return (
                      <div
                        key={index}
                        id={`message-${index}`}
                        className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                        data-testid={`message-${index}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg px-4 py-3 ${
                            message.sender === 'user'
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-900'
                          }`}
                        >
                          {message.sender !== 'user' && (
                            <div className="font-semibold text-sm mb-1">
                              {getPersonaLabelForMessage(message, index)}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap">{message.message}</div>
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
