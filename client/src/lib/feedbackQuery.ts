import { useQuery, type QueryObserverResult } from "@tanstack/react-query";
import { authFetchRaw } from "@/lib/authFetch";

export type FeedbackStatus = "queued" | "generating" | "completed" | "error" | "expired";

export type FeedbackQueryData<T = any> = {
  status: FeedbackStatus;
  feedback?: T;
  message?: string;
  error?: string;
  [key: string]: any;
};

export const feedbackQueryKey = (conversationId: string) =>
  ["/api/conversations", conversationId, "feedback"] as const;

export const isFeedbackPending = (data?: FeedbackQueryData | null) =>
  data?.status === "queued" || data?.status === "generating";

export const isFeedbackTerminal = (data?: FeedbackQueryData | null) =>
  data?.status === "completed" || data?.status === "error" || data?.status === "expired";

export function useFeedbackQuery<T = any>(conversationId?: string) {
  return useQuery<FeedbackQueryData<T>>({
    queryKey: feedbackQueryKey(conversationId || ""),
    enabled: !!conversationId,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchInterval: query => isFeedbackPending(query.state.data) ? 3000 : false,
    queryFn: async () => {
      const response = await authFetchRaw(`/api/conversations/${conversationId}/feedback`);
      if (response.status === 404) {
        return { status: "expired", message: "FEEDBACK_NOT_FOUND" };
      }
      if (!response.ok) {
        return { status: "error", message: `HTTP ${response.status}` };
      }
      const value = await response.json();
      // Completed responses historically contain the feedback object without status.
      return value?.status
        ? value
        : { ...value, status: "completed", feedback: value };
    },
  });
}

export type FeedbackQueryResult<T = any> = QueryObserverResult<FeedbackQueryData<T>>;