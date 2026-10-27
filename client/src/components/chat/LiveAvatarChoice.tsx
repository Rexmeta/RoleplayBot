import React, { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { liveAvatarBlockerText } from "@/lib/liveAvatarBlockers";

type Props = { conversationId: string; voiceMode: boolean };
type Availability = {
  enabled: boolean;
  allowed: boolean;
  contractReady: false;
  available: false;
  blockers: string[];
};
type SessionResponse = { code?: string; blockers?: string[] };

export function LiveAvatarChoice({ conversationId, voiceMode }: Props) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(false);
  const [consent, setConsent] = useState(false);
  const availabilityQuery = useQuery<Availability>({
    queryKey: ["/api/live-avatar/conversations", conversationId, "availability"],
    enabled: Boolean(conversationId),
    queryFn: async () =>
      (await apiRequest("GET", `/api/live-avatar/conversations/${encodeURIComponent(conversationId)}/availability`)).json(),
  });
  const availability = availabilityQuery.data;
  const session = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/live-avatar/conversations/${encodeURIComponent(conversationId)}/sessions`, {
        service: "avatar-router",
        consent: true,
      })).json() as Promise<SessionResponse>,
  });
  // No media transport consumer is installed yet: fail closed even if a newer
  // server reports availability. Never create a billable orphan session.
  const mediaConsumerInstalled = false;
  const readyForSession = Boolean(mediaConsumerInstalled && voiceMode && availability?.enabled && availability.allowed && availability.contractReady && availability.available && consent);
  const errorText = (error: unknown) => error instanceof Error ? error.message : t("liveAvatar.errors.unknown", { defaultValue: "알 수 없는 오류가 발생했습니다." });

  useEffect(() => {
    setRequested(false);
    setConsent(false);
  }, [conversationId]);

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label={t("liveAvatar.choice.title", { defaultValue: "실시간 아바타 선택" })}>
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Radio className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{t("liveAvatar.choice.title", { defaultValue: "실시간 아바타" })}</h3>
            <Badge variant="secondary">{t("liveAvatar.choice.optional", { defaultValue: "선택 사항" })}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {voiceMode
              ? t("liveAvatar.choice.voiceModeNote", { defaultValue: "기존 음성 대화는 그대로 유지됩니다. 실시간 아바타는 직접 선택해야 합니다." })
              : t("liveAvatar.choice.textModeNote", { defaultValue: "기본 채팅은 그대로 유지됩니다. 실시간 아바타는 직접 선택해야 합니다." })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("liveAvatar.choice.currentMode", { defaultValue: "현재: 기존 아바타·음성 사용" })}
          </p>
        </div>
      </div>

      {!requested ? (
        <Button type="button" variant="outline" onClick={() => setRequested(true)}>
          {t("liveAvatar.choice.request", { defaultValue: "실시간 아바타 옵션 보기" })}
        </Button>
      ) : (
        <div className="space-y-3 border-t pt-3">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <Checkbox
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
              aria-label={t("liveAvatar.choice.consent", { defaultValue: "외부 AI 오디오 사용에 동의합니다." })}
            />
            <span className="text-sm leading-5">
              <span className="font-medium">{t("liveAvatar.choice.consentTitle", { defaultValue: "외부 AI 오디오에 동의" })}</span>
              <span className="mt-1 block text-muted-foreground">
                {t("liveAvatar.choice.consent", { defaultValue: "외부 AI 서비스로 오디오가 전송될 수 있으며 사용 요금이 발생할 수 있음을 확인합니다." })}
              </span>
            </span>
          </label>

          {availabilityQuery.isLoading ? (
            <div className="h-14 animate-pulse rounded-md bg-muted/70" aria-label={t("common.loading", { defaultValue: "불러오는 중" })} />
          ) : availabilityQuery.isError ? (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>{t("liveAvatar.errors.availability", { defaultValue: "실시간 사용 가능 상태를 확인하지 못했습니다." })} {errorText(availabilityQuery.error)}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => availabilityQuery.refetch()}>
                {t("common.retry", { defaultValue: "다시 시도" })}
              </Button>
            </div>
          ) : availability ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                {availability.available && availability.contractReady && mediaConsumerInstalled
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  : <AlertTriangle className="h-4 w-4 text-amber-700" />}
                <span className="font-medium">
                  {availability.available && availability.contractReady && mediaConsumerInstalled
                    ? t("liveAvatar.choice.available", { defaultValue: "사용 가능" })
                    : t("liveAvatar.choice.unavailable", { defaultValue: "현재 사용할 수 없음" })}
                </span>
              </div>
              {!availability.enabled && (
                <p className="text-sm text-muted-foreground">{t("liveAvatar.choice.globalOff", { defaultValue: "전역 설정이 꺼져 있습니다." })}</p>
              )}
              {!availability.allowed && (
                <p className="text-sm text-muted-foreground">{t("liveAvatar.choice.scenarioBlocked", { defaultValue: "이 시나리오에서 허용되지 않았습니다." })}</p>
              )}
              {!availability.contractReady && (
                <p className="text-sm text-muted-foreground">{t("liveAvatar.choice.contractBlocked", { defaultValue: "외부 서비스 연동 계약이 검증되지 않아 실시간 세션을 시작할 수 없습니다." })}</p>
              )}
              {!mediaConsumerInstalled && availability.contractReady && <p className="text-sm text-muted-foreground">{t("liveAvatar.choice.mediaBlocked", { defaultValue: "이 앱의 라이브 영상·음성 수신 기능이 아직 검증되지 않았습니다." })}</p>}
              {availability.blockers.length > 0 && (
                <ul className="list-inside list-disc space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
                  {availability.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{liveAvatarBlockerText(blocker, t)}</li>)}
                </ul>
              )}
            </>
          ) : null}

          {session.isError && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {session.error instanceof Error && session.error.message.includes("409")
                ? t("liveAvatar.choice.contractConflict", { defaultValue: "외부 연동 계약이 검증되지 않아 세션을 시작할 수 없습니다." })
                : `${t("liveAvatar.errors.session", { defaultValue: "실시간 세션 요청을 완료하지 못했습니다." })} ${errorText(session.error)}`}
            </div>
          )}
          {!voiceMode && <p className="text-sm text-muted-foreground">{t("liveAvatar.choice.voiceOnly", { defaultValue: "라이브 아바타는 실시간 음성 대화에서만 사용할 수 있습니다." })}</p>}
          <Button type="button" variant="outline" className="mr-2" onClick={() => { setRequested(false); setConsent(false); session.reset(); }}>
            {t("liveAvatar.choice.keepExisting", { defaultValue: "기존 방식 유지" })}
          </Button>
          <Button
            type="button"
            disabled={!readyForSession || session.isPending}
            onClick={() => {
              if (readyForSession) session.mutate();
            }}
          >
            {session.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {session.isPending
              ? t("liveAvatar.choice.starting", { defaultValue: "요청 중…" })
              : t("liveAvatar.choice.start", { defaultValue: "실시간 아바타 시작" })}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t("liveAvatar.choice.notStarted", { defaultValue: "사용 가능 상태를 확인하고 동의한 경우에만 요청됩니다. 현재는 계약 검증 전이므로 시작할 수 없습니다." })}
          </p>
        </div>
      )}
    </section>
  );
}
