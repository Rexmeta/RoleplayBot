import { useTranslation } from "react-i18next";

/** Shared transition while a conversation is finalized and its report is prepared. */
export function FeedbackTransitionOverlay({ analyzing = false }: { analyzing?: boolean }) {
  const { t } = useTranslation();
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white px-6"
    data-testid="feedback-transition-overlay" role="status" aria-live="polite" aria-busy="true">
    <div className="text-center">
      <div aria-hidden="true" className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-corporate-600" />
      <h2 className="mb-2 text-xl font-semibold text-slate-900">
        {analyzing ? t("home.analyzingFeedback") : t("home.preparingFeedback")}
      </h2>
      <p className="text-slate-600">
        {analyzing ? t("home.analyzingFeedbackDesc") : t("home.preparingFeedbackDesc")}
      </p>
    </div>
  </div>;
}
