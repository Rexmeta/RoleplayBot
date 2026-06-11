import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, X, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

const FEEDBACK_KEY_PREFIX = "feedback_gen_start_";
const POLL_INTERVAL_MS = 1500;

function getInProgressIds(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(FEEDBACK_KEY_PREFIX)) {
        keys.push(k.slice(FEEDBACK_KEY_PREFIX.length));
      }
    }
    return keys;
  } catch {
    return [];
  }
}

export function FeedbackGeneratingBanner() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [inProgressIds, setInProgressIds] = useState<string[]>(() => getInProgressIds());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const interval = setInterval(() => {
      setInProgressIds(getInProgressIds());
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

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
