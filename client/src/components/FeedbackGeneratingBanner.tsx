import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, X, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueries } from "@tanstack/react-query";
import { authFetchRaw } from "@/lib/authFetch";
import { feedbackQueryKey, isFeedbackPending } from "@/lib/feedbackQuery";

export function FeedbackGeneratingBanner() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { data: conversations = [] } = useQuery<any[]>({ queryKey: ["/api/conversations"] });
  const feedbackQueries = useQueries({
    queries: conversations.map(conversation => ({
      queryKey: feedbackQueryKey(conversation.id),
      enabled: !!conversation.id,
      retry: false,
      refetchInterval: (query: any) => isFeedbackPending(query.state.data as any) ? 3000 : false,
      queryFn: async () => {
        const response = await authFetchRaw(`/api/conversations/${conversation.id}/feedback`);
        if (!response.ok) return { status: "expired" };
        const value = await response.json();
        return value?.status ? value : { status: "completed" };
      },
    })),
  });
  const inProgressIds = conversations
    .filter((conversation, index) => isFeedbackPending(feedbackQueries[index]?.data as any))
    .map(conversation => conversation.id);

  const visible = inProgressIds.filter(id => !dismissed.has(id));

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mb-4">
      {visible.map(id => (
        <div
          key={id}
          className="flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-sm shadow-sm cursor-pointer hover:bg-blue-100 transition-colors"
          onClick={() => navigate(`/feedback/${id}`)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate(`/feedback/${id}`); }}
        >
          <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-blue-600" />
          <span className="flex-1 font-medium">
            {t('feedback.generatingBanner', '피드백을 생성하고 있습니다. 클릭하여 진행 상황을 확인하세요.')}
          </span>
          <ChevronRight className="w-4 h-4 flex-shrink-0 text-blue-500" />
          <button
            className="ml-1 p-0.5 rounded hover:bg-blue-200 transition-colors flex-shrink-0"
            onClick={e => {
              e.stopPropagation();
              setDismissed(prev => new Set(prev).add(id));
            }}
            aria-label={t('common.dismiss', '닫기')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
