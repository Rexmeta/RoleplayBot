import { useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Dialog } from "@/components/ui/dialog";
import { CultureProfileForm, emptyCultureProfile, validateCultureProfile } from "./CultureProfileForm";
import { useSaveCultureProfile } from "./useSaveCultureProfile";

/** Create flow: opens the same full-screen editor used for editing. Render only while active. */
export function CultureProfileCreatePage({ onCreated, onCancel, open = true, onCloseAutoFocus }: {
  onCreated: () => void; onCancel: () => void; open?: boolean;
  /** Opened without a DialogTrigger, so callers restore focus explicitly. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { user } = useAuth();
  const [draft, setDraft] = useState(emptyCultureProfile);
  const [errorText, setErrorText] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const reset = () => { setDraft(emptyCultureProfile()); setErrorText(""); };
  const saveMutation = useSaveCultureProfile({
    draft,
    onSuccess: () => {
      reset();
      onCreated();
    },
    onError: error => setErrorText(error instanceof Error ? error.message : "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."),
  });

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !saveMutation.isPending) { reset(); onCancel(); } }}>
      {open && <CultureProfileForm
        draft={draft}
        onChange={setDraft}
        isAdmin={user?.role === "admin"}
        saving={saveMutation.isPending}
        errorText={errorText}
        nameInputRef={nameInputRef}
        onCloseAutoFocus={onCloseAutoFocus}
        onOpenAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => nameInputRef.current?.focus({ preventScroll: true })); }}
        onSave={() => {
          const error = validateCultureProfile(draft);
          setErrorText(error);
          if (!error && !saveMutation.isPending) saveMutation.mutate();
        }}
        onCancel={() => {
          if (saveMutation.isPending) return;
          reset();
          onCancel();
        }}
      />}
    </Dialog>
  );
}
