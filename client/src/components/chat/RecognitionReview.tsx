import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { feedbackQueryKey } from '@/lib/feedbackQuery';
import type { ConversationMessage } from '@shared/schema';
import type { PersonaSwitchEvent } from './PersonaSwitchCard';
import { ConversationHistoryPanel } from '../report/ConversationHistoryPanel';
import { Button } from '@/components/ui/button';

export interface Evidence {
  id: string;
  revision: number;
  status: string;
  providerText: string | null;
  candidateText: string | null;
  canonicalText: string | null;
  reason: string | null;
  language: string;
  createdAt?: string;
}

export function recognitionMessageId(message: ConversationMessage) {
  return message.voiceTurnId ?? message.utteranceId ?? message.ledger?.id;
}

const resolved = (evidence: Evidence) => evidence.status === 'verified' || evidence.status === 'confirmed';

export function useRecognitionEvidence(runId: string) {
  return useQuery<Evidence[]>({
    queryKey: ['/api/conversations', runId, 'voice-recognition'],
    queryFn: async () => (await apiRequest('GET', `/api/conversations/${encodeURIComponent(runId)}/voice-recognition`)).json(),
    refetchInterval: 3000, enabled: !!runId,
  });
}

export function RecognitionReview({
  runId, personaName = 'AI', personaSwitchEvents = [], onSubmitted,
}: {
  runId: string;
  personaName?: string;
  personaSwitchEvents?: PersonaSwitchEvent[];
  onSubmitted?: () => void | Promise<unknown>;
}) {
  // A run change must not carry unsaved corrections into another conversation.
  return <RecognitionConversationReview key={runId} runId={runId} personaName={personaName}
    personaSwitchEvents={personaSwitchEvents} onSubmitted={onSubmitted} />;
}

function RecognitionConversationReview({ runId, personaName, personaSwitchEvents, onSubmitted }: {
  runId: string;
  personaName: string;
  personaSwitchEvents: PersonaSwitchEvent[];
  onSubmitted?: () => void | Promise<unknown>;
}) {
  const query = useRecognitionEvidence(runId);
  const history = useQuery<{ messages: ConversationMessage[] }>({
    queryKey: ['/api/conversations', runId],
    queryFn: async () => (await apiRequest('GET', `/api/conversations/${encodeURIComponent(runId)}`)).json(),
  });
  const cache = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const rows = query.data ?? [];
  const byId = new Map(rows.map(row => [row.id, row]));
  const messages: ConversationMessage[] = [];
  const messageIndices = new Map<string, number>();
  for (const message of history.data?.messages ?? []) {
    const id = message.sender === 'user' ? recognitionMessageId(message) : undefined;
    const index = id ? messageIndices.get(id) : undefined;
    if (index !== undefined) messages[index] = message;
    else {
      if (id) messageIndices.set(id, messages.length);
      messages.push(message);
    }
  }
  const present = new Set(messages.filter(message => message.sender === 'user').map(recognitionMessageId));
  // Capture-only utterances still need one editable bubble, not an extra review card.
  for (const row of rows) {
    if (!present.has(row.id)) messages.push({
      sender: 'user', voiceTurnId: row.id,
      message: row.providerText ?? row.candidateText ?? '',
      timestamp: row.createdAt ?? messages.at(-1)?.timestamp ?? '',
    });
  }
  const displayed = messages.map(message => {
    const row = byId.get(recognitionMessageId(message) ?? '');
    return message.sender === 'user' && row && resolved(row)
      ? { ...message, message: row.canonicalText ?? message.message } : message;
  }).sort((a, b) => {
    if (a.turnIndex != null && b.turnIndex != null && a.turnIndex !== b.turnIndex) return a.turnIndex - b.turnIndex;
    return (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0);
  });
  const valueFor = (row: Evidence) => drafts[row.id] ?? (resolved(row)
    ? row.canonicalText ?? ''
    : messages.find(message => message.sender === 'user' && recognitionMessageId(message) === row.id)?.message
      ?? row.providerText ?? row.candidateText ?? '');
  const targets = rows.filter(row => !resolved(row) || drafts[row.id] !== undefined);
  const invalid = targets.some(row => !valueFor(row).trim() || valueFor(row).length > 10000);
  const missingEvidence = messages.some(message => message.sender === 'user' &&
    message.voiceTurnId && !byId.has(message.voiceTurnId));
  const submit = async () => {
    if (inFlight.current || invalid || missingEvidence) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      // Reuse the authenticated, revision-checked confirmation API. A partial
      // failure never proceeds to feedback; already saved turns remain saved.
      for (const row of targets) {
        const response = await apiRequest('POST',
          `/api/conversations/${encodeURIComponent(runId)}/voice-recognition/${encodeURIComponent(row.id)}/confirm`,
          { revision: row.revision, text: valueFor(row) });
        const saved: Evidence = await response.json();
        if (!saved || saved.id !== row.id || !resolved(saved)) throw new Error('confirmation_not_saved');
        cache.setQueryData<Evidence[]>(['/api/conversations', runId, 'voice-recognition'],
          current => current?.map(item => item.id === row.id ? saved : item));
        setDrafts(current => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
      }
      const latest: Evidence[] = await (await apiRequest('GET',
        `/api/conversations/${encodeURIComponent(runId)}/voice-recognition`)).json();
      cache.setQueryData(['/api/conversations', runId, 'voice-recognition'], latest);
      if (latest.some(row => !resolved(row)) || rows.some(row => !latest.some(item => item.id === row.id))) {
        throw new Error('recognition_still_pending');
      }
      await cache.invalidateQueries({ queryKey: ['/api/conversations', runId], exact: true });
      if (onSubmitted) await onSubmitted();
      else await cache.invalidateQueries({ queryKey: feedbackQueryKey(runId) });
    } catch {
      setError('일부 기록을 저장하지 못했거나 인식 기록이 변경되었습니다. 수정 내용은 유지됩니다. 말풍선을 다시 확인한 뒤 제출해 주세요.');
      await cache.invalidateQueries({ queryKey: ['/api/conversations', runId, 'voice-recognition'] });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  if (query.isError || history.isError || (!history.isPending && !history.data)) return (
    <div role="alert" className="space-y-2 p-2 text-sm">
      <p>대화 기록과 인식 확인 상태를 불러오지 못했습니다. 수정 내용은 유지됩니다.</p>
      <Button variant="outline" onClick={() => { void query.refetch(); void history.refetch(); }}>다시 불러오기</Button>
    </div>
  );
  if (query.isPending || history.isPending) return <p role="status">대화 기록을 불러오는 중입니다.</p>;
  return (
    <div className="space-y-4" data-testid="recognition-conversation-review">
      <p className="text-sm text-slate-600">내 말풍선에서 실제로 말한 내용을 수정한 뒤 한 번에 제출하세요. AI 대사는 수정되지 않습니다. 기억이 불확실한 내용은 추측해서 입력하지 마세요.</p>
      <ConversationHistoryPanel messages={displayed} personaName={personaName}
        personaSwitchEvents={personaSwitchEvents}
        renderUserMessage={(message, index) => {
          const row = byId.get(recognitionMessageId(message) ?? '');
          if (!row) return message.message;
          return <textarea aria-label={`내 발화 ${index + 1} 수정`}
            data-testid={`recognition-edit-${row.id}`}
            rows={Math.min(8, Math.max(2, valueFor(row).split('\n').length))}
            className="block w-full min-w-[min(12rem,50vw)] resize-y rounded-lg border border-white/40 bg-white/10 p-2 text-sm text-white placeholder:text-blue-100 focus:outline-none focus:ring-2 focus:ring-white"
            value={valueFor(row)} maxLength={10000} disabled={busy}
            onChange={event => setDrafts(current => ({ ...current, [row.id]: event.target.value }))} />;
        }} />
      {missingEvidence && <p role="status" className="text-sm text-amber-800">일부 발화의 인식 확인 정보를 기다리고 있습니다.</p>}
      {invalid && <p role="status" className="text-sm text-amber-800">비어 있는 말풍선에 실제로 말한 내용을 입력해 주세요.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button onClick={() => void submit()} disabled={busy || invalid || missingEvidence}
        data-testid="submit-recognition-review">
        {busy ? '기록 저장 중…' : onSubmitted ? '확인한 기록 제출 및 피드백 생성' : '확인한 기록 한 번에 제출'}
      </Button>
    </div>
  );
}