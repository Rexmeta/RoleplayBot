import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type Props = {
  conversationId: string;
  actorId: string | number;
  optionsOpen: boolean;
  onOpenOptions: () => void;
};

type Selection = {
  configured: boolean;
  enabled: boolean;
  allowed: boolean;
  blockers: string[];
  personaId: string;
};

export function LiveAvatarEntry({ conversationId, actorId, optionsOpen, onOpenOptions }: Props) {
  const selectionQuery = useQuery<Selection>({
    queryKey: ["/api/live-avatar/conversations", conversationId, "selection", actorId],
    enabled: Boolean(conversationId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => (await apiRequest(
      "GET",
      `/api/live-avatar/conversations/${encodeURIComponent(conversationId)}/selection`,
    )).json(),
  });

  useEffect(() => {
    if (optionsOpen) void selectionQuery.refetch();
  }, [optionsOpen, selectionQuery.refetch]);

  if (!selectionQuery.data?.configured && !selectionQuery.isError) return null;

  return (
    <div className="absolute right-3 top-16 z-[16] max-w-[min(19rem,calc(100%-1.5rem))]">
      <button
        type="button"
        onClick={() => {
          if (selectionQuery.isError) {
            void selectionQuery.refetch();
            return;
          }
          onOpenOptions();
        }}
        aria-label={selectionQuery.isError
          ? "라이브 아바타 설정 확인 다시 시도"
          : "라이브 아바타 옵션 열기"}
        className="flex w-full items-center gap-2 rounded-xl border border-white/25 bg-slate-950/75 px-3 py-2 text-left text-white shadow-lg backdrop-blur-md transition-colors hover:bg-slate-950/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-emerald-200">
          <Radio className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold">
            {selectionQuery.isError
              ? "라이브 아바타 설정 확인 실패"
              : selectionQuery.data?.enabled && selectionQuery.data?.allowed
                ? "라이브 아바타 설정됨"
                : "라이브 아바타 사용 조건 확인 필요"}
          </span>
          <span className="mt-0.5 block text-[11px] text-white/75">
            {selectionQuery.isError ? "눌러서 다시 확인" : "눌러서 옵션과 사용 가능 상태 확인"}
          </span>
        </span>
      </button>
    </div>
  );
}
