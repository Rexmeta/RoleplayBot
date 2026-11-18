import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CultureProfile, CultureProfileInput } from "@shared/cultureMap";

/** One persistence contract for standalone creation and manager create/edit flows. */
export function useSaveCultureProfile({
  draft, editing = null, onSuccess, onError,
}: {
  draft: CultureProfileInput;
  editing?: CultureProfile | null;
  onSuccess: () => void | Promise<void>;
  onError: (error: Error) => void | Promise<void>;
}) {
  return useMutation({
    mutationFn: async () => {
      const response = editing
        ? await apiRequest("PUT", `/api/admin/culture-profiles/${editing.id}`, { ...draft, expectedVersion: editing.version })
        : await apiRequest("POST", "/api/admin/culture-profiles", draft);
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/culture-profiles"] });
      await onSuccess();
    },
    onError,
  });
}
