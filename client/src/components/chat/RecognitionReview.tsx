import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from 'react-i18next';
import { feedbackQueryKey } from '@/lib/feedbackQuery';

interface Evidence {
  id: string;
  revision: number;
  status: string;
  providerText: string | null;
  candidateText: string | null;
  canonicalText: string | null;
  reason: string | null;
  language: string;
}

function UtteranceReview({ runId, evidence }: { runId: string; evidence: Evidence }) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cache = useQueryClient();
  const resolved = evidence.status === 'verified' || evidence.status === 'confirmed';
  const candidate = text ?? evidence.candidateText ?? evidence.providerText ?? '';
  const confirm = async () => {
    setBusy(true); setError('');
    try {
      await apiRequest('POST', `/api/conversations/${encodeURIComponent(runId)}/voice-recognition/${encodeURIComponent(evidence.id)}/confirm`, {
        revision: evidence.revision, text: candidate,
      });
      setText(null);
      await cache.invalidateQueries({ queryKey: ['/api/conversations', runId, 'voice-recognition'] });
      await cache.invalidateQueries({ queryKey: feedbackQueryKey(runId) });
    } catch {
      setError('확인 내용을 저장하지 못했습니다. 최신 후보를 확인한 뒤 다시 시도해 주세요.');
      await cache.invalidateQueries({ queryKey: ['/api/conversations', runId, 'voice-recognition'] });
    } finally { setBusy(false); }
  };
  return (
    <section className="rounded border p-2 space-y-2 text-xs">
      <strong>{resolved ? '확인된 전사' : evidence.status === 'processing' ? '원음 전사 처리 중' : '인식 확인 필요'}</strong>
      <details>
        <summary>Live 원문 (별도 출처)</summary>
        <p className="whitespace-pre-wrap">{evidence.providerText ?? '제공자 완료 전사가 없습니다.'}</p>
      </details>
      {evidence.candidateText !== null && <p>원음 기반 STT 후보: {evidence.candidateText}</p>}
      {resolved && <p>평가용 전사: {evidence.canonicalText}</p>}
      {!resolved && <p>확인 전에는 평가를 확정하지 않습니다. 실제로 말한 내용만 확인해 주세요. 기억이 불확실하면 추측하여 입력하지 마세요.</p>}
      <textarea aria-label="실제로 말한 내용 확인" className="w-full border rounded p-2 text-slate-900"
        value={candidate} onChange={e => setText(e.target.value)} maxLength={10000} />
      <button type="button" className="border rounded px-2 py-1" disabled={busy || !candidate.trim()} onClick={confirm}>
        {busy ? '저장 중' : '이 발화 내용 확인'}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function useRecognitionEvidence(runId: string) {
  return useQuery<Evidence[]>({
    queryKey: ['/api/conversations', runId, 'voice-recognition'],
    queryFn: async () => (await apiRequest('GET', `/api/conversations/${encodeURIComponent(runId)}/voice-recognition`)).json(),
    refetchInterval: 3000, enabled: !!runId,
  });
}

export function RecognitionReview({ runId }: { runId: string }) {
  const query = useRecognitionEvidence(runId);
  const { i18n } = useTranslation();
  if (query.isError) return <p role="alert" className="p-2 text-xs">음성 인식 확인 상태를 불러오지 못했습니다. 평가 확정 전에 다시 확인해 주세요.</p>;
  if (!query.data?.length) return null;
  return (
    <div className="p-2 space-y-2">
      <h3 className="font-semibold text-sm">음성 기록 확인</h3>
      <p className="text-xs">한국어 세션 · 원음은 일시적으로 전사 처리에만 사용됩니다. 숫자·약어·혼합 언어도 그대로 확인할 수 있습니다.</p>
      <p className="text-xs">실시간 전사 언어: ko (계정 언어) · 일반 받아쓰기 언어: {i18n.resolvedLanguage ?? i18n.language} (화면 언어). 일반 받아쓰기는 입력란에서 확인한 뒤 제출하세요. 외국어 학습 발화는 문자 종류로 거부하지 않습니다.</p>
      {query.data.map(e => <UtteranceReview key={e.id} runId={runId} evidence={e} />)}
    </div>
  );
}