import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Keep children mounted when closed: hiding settings must not end paid media. */
export function LiveAvatarOptionsDialog({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useTranslation();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      data-testid="live-avatar-options-dialog"
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[80dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border-0 bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-950/30 sm:mx-auto sm:max-w-lg"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
          <h2 id={titleId} className="text-sm font-medium">
            {t("chat.liveAvatarOptionsTitle", { defaultValue: "라이브 아바타 설정" })}
          </h2>
          <button type="button" onClick={onClose}
            aria-label={t("common.close", { defaultValue: "닫기" })}
            className="grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-3">
          <p className="mb-3 text-xs leading-5 text-slate-600">
            {t("chat.liveAvatarDurationNotice", { defaultValue: "라이브 아바타 대화는 시나리오 목표 시간에 맞춰 진행되며 최대 10분으로 제한됩니다. 연결 준비 시간이 포함되며, 제공자의 세션 제한이 더 짧으면 해당 제한이 적용됩니다." })}
          </p>
          {children}
        </div>
      </div>
    </dialog>
  );
}
