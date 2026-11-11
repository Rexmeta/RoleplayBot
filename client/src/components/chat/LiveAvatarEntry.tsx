import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type Props = {
  conversationId: string;
  actorId: string | number;
  optionsOpen: boolean;
  onOpenOptions: () => void;
  playbackState?: LiveAvatarPlaybackState;
};

export type LiveAvatarPlaybackState = "idle" | "starting" | "connecting" | "playing" | "failed" | "stopping";
type Selection = {
  configured: boolean;
  enabled: boolean;
  allowed: boolean;
  blockers: string[];
  personaId: string;
};

export function useLiveAvatarSelection(conversationId: string, actorId: string | number) {
  return useQuery<Selection>({
    queryKey: ["/api/live-avatar/conversations", conversationId, "selection", actorId],
    enabled: Boolean(conversationId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => (await apiRequest(
      "GET",
      `/api/live-avatar/conversations/${encodeURIComponent(conversationId)}/selection`,
    )).json(),
  });
}

export function LiveAvatarEntry({ conversationId, actorId, optionsOpen, onOpenOptions, playbackState = "idle" }: Props) {
  const selectionQuery = useLiveAvatarSelection(conversationId, actorId);

  useEffect(() => {
    if (optionsOpen) void selectionQuery.refetch();
  }, [optionsOpen, selectionQuery.refetch]);

  if (!selectionQuery.data?.configured) return null;

  const statusLabels: Record<LiveAvatarPlaybackState, [string, string]> = {
    idle: ["라이브 아바타 연결 대기", "아직 영상 미연결 · 눌러서 동의 후 연결 시작"],
    starting: ["라이브 아바타 영상 준비 중", "외부 서비스가 영상을 준비하고 있습니다."],
    connecting: ["라이브 아바타 연결 중", "실제 영상·음성 수신을 확인하고 있습니다."],
    playing: ["라이브 아바타 재생 중", "실제 영상·음성 연결됨 · 눌러서 옵션 열기"],
    failed: ["라이브 아바타 연결 실패", "기존 이미지·음성 유지 · 눌러서 오류 확인"],
    stopping: ["라이브 아바타 종료 확인 중", "중복 연결을 막기 위해 종료 상태를 확인합니다."],
  };

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
                 ? statusLabels[playbackState][0]
                : "라이브 아바타 사용 조건 확인 필요"}
          </span>
          <span className="mt-0.5 block text-[11px] text-white/75">
            {selectionQuery.isError ? "눌러서 다시 확인" : statusLabels[playbackState][1]}
          </span>
        </span>
      </button>
    </div>
  );
}
