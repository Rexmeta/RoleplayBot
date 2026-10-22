import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CultureProfileForm, emptyCultureProfile, validateCultureProfile } from "./CultureProfileForm";

export function CultureProfileCreatePage({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { user } = useAuth();
  const [draft, setDraft] = useState(emptyCultureProfile);
  const [errorText, setErrorText] = useState("");
  const reset = () => { setDraft(emptyCultureProfile()); setErrorText(""); };
  const saveMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/culture-profiles", draft)).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/culture-profiles"] });
      reset();
      onCreated();
    },
    onError: error => setErrorText(error instanceof Error ? error.message : "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."),
  });

  return (
    <section className="w-full max-w-4xl rounded-lg border border-teal-200 bg-[#fbfdfb] p-4 sm:p-7" aria-label="새 문화 프로필 작성">
      <CultureProfileForm
        draft={draft}
        onChange={setDraft}
        isAdmin={user?.role === "admin"}
        saving={saveMutation.isPending}
        errorText={errorText}
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
      />
    </section>
  );
}
