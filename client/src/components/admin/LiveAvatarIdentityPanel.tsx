import React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

type IdentityStatus = {
  state: "unconfigured" | "invalid" | "configured";
  issuer?: string;
  jwksUrl?: string;
  kid?: string;
  audience: string;
  clientId: string;
  tokenLifetimeSeconds: 45;
};

type IdentityCheckResult = {
  accepted: true;
  checkedAt: string;
  limits: {
    userDailySeconds: number;
    globalDailySeconds: number;
    userRemainingSeconds: number;
    globalRemainingSeconds: number;
    sessionSeconds: number;
    cleanupPending: number;
    workerReady: boolean;
    providerCredits: "unknown";
    resetsAt: string;
  };
};

const identityKey = ["/api/live-avatar/identity"];

export function LiveAvatarIdentityPanel() {
  const { t } = useTranslation();
  const statusQuery = useQuery<IdentityStatus>({
    queryKey: identityKey,
    queryFn: async () => (await apiRequest("GET", "/api/live-avatar/identity")).json(),
  });
  const checkMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/live-avatar/identity/check", {})).json() as Promise<IdentityCheckResult>,
  });
  const status = statusQuery.data;
  const configured = status?.state === "configured";
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : t("liveAvatar.errors.unknown", { defaultValue: "알 수 없는 오류가 발생했습니다." });
  const number = (value: number) => new Intl.NumberFormat().format(value);

  return (
    <section className="space-y-4 rounded-lg border bg-muted/10 p-4 sm:p-5" aria-labelledby="live-avatar-identity-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md border bg-background p-2 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <h3 id="live-avatar-identity-title" className="font-medium">
              {t("liveAvatar.identity.title", { defaultValue: "서버 위임 신원" })}
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("liveAvatar.identity.description", { defaultValue: "서버가 현재 로그인한 관리자의 위임 신원을 사용해 읽기 전용 인증을 확인합니다. 보호된 확인은 버튼을 눌렀을 때만 실행됩니다." })}
            </p>
          </div>
        </div>
        {status && (
          <Badge variant={configured ? "default" : status.state === "invalid" ? "destructive" : "secondary"}>
            {status.state === "configured"
              ? t("liveAvatar.identity.configured", { defaultValue: "구성됨 · 미검증" })
              : status.state === "invalid"
                ? t("liveAvatar.identity.invalid", { defaultValue: "구성 오류" })
                : t("liveAvatar.identity.unconfigured", { defaultValue: "미구성" })}
          </Badge>
        )}
      </div>

      {statusQuery.isLoading ? (
        <div className="space-y-3" aria-label={t("common.loading", { defaultValue: "불러오는 중" })}>
          <div className="h-10 animate-pulse rounded-md bg-muted/70" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted/70" />
        </div>
      ) : statusQuery.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span>
            {t("liveAvatar.identity.statusLoadError", { defaultValue: "위임 상태를 불러오지 못했습니다." })} {errorText(statusQuery.error)}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
            {statusQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {t("common.retry", { defaultValue: "다시 시도" })}
          </Button>
        </div>
      ) : status ? (
        <>
          {configured ? (
            <>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <PublicValue label={t("liveAvatar.identity.issuer", { defaultValue: "Issuer" })} value={status.issuer} />
                <PublicValue label={t("liveAvatar.identity.jwks", { defaultValue: "JWKS URL" })} value={status.jwksUrl} />
                <PublicValue label={t("liveAvatar.identity.kid", { defaultValue: "Key ID (kid)" })} value={status.kid} />
                <PublicValue label={t("liveAvatar.identity.audience", { defaultValue: "Audience" })} value={status.audience} />
                <PublicValue label={t("liveAvatar.identity.clientId", { defaultValue: "Client ID" })} value={status.clientId} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("liveAvatar.identity.registrationHint", { defaultValue: "위 공개 정보를 제공자 측 애플리케이션 등록에 사용하세요. 개인 키는 브라우저에 표시되지 않습니다." })}
              </p>
            </>
          ) : (
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-medium">
                  {status.state === "invalid"
                    ? t("liveAvatar.identity.invalidSetup", { defaultValue: "서버 위임 설정을 확인해야 합니다." })
                    : t("liveAvatar.identity.setup", { defaultValue: "서버 위임 신원을 구성해야 합니다." })}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {t("liveAvatar.identity.setupHint", { defaultValue: "전용 개인 키를 서버 Secrets에 안전하게 저장하고, 유효한 HTTPS issuer를 설정하세요. 이 화면에 비밀 값을 입력하지 마세요." })}
                </p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("liveAvatar.identity.notLiveReady", { defaultValue: "구성됨은 등록·검증 완료 또는 실시간 사용 가능을 뜻하지 않습니다. 기존 실시간 세션 차단 상태는 변경되지 않습니다." })}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => checkMutation.mutate()}
              disabled={!configured || checkMutation.isPending}
            >
              {checkMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {checkMutation.isPending
                ? t("liveAvatar.identity.checking", { defaultValue: "확인 중…" })
                : t("liveAvatar.identity.check", { defaultValue: "위임 인증 확인" })}
            </Button>
          </div>
        </>
      ) : null}

      {checkMutation.isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span>
            {t("liveAvatar.identity.checkError", { defaultValue: "위임 인증 확인에 실패했습니다." })} {errorText(checkMutation.error)}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => checkMutation.mutate()} disabled={!configured || checkMutation.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.retry", { defaultValue: "다시 시도" })}
          </Button>
        </div>
      )}

      {checkMutation.data && (
        <div className="space-y-4 rounded-md border border-emerald-700/20 bg-emerald-700/[0.035] p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            <div>
              <p className="text-sm font-medium">{t("liveAvatar.identity.accepted", { defaultValue: "현재 계정의 위임 인증이 수락되었습니다." })}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("liveAvatar.identity.acceptedCaveat", { defaultValue: "이는 현재 계정의 인증 수락만 증명합니다. 테넌트 격리나 실시간 미디어 경로를 검증하지 않으며 세션 허용 상태를 변경하지 않습니다." })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("liveAvatar.identity.checkedAt", { defaultValue: "확인 시각" })}: {new Date(checkMutation.data.checkedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Limit label={t("liveAvatar.identity.userDaily", { defaultValue: "사용자 한도 표기" })} value={`${number(checkMutation.data.limits.userDailySeconds)} ${t("liveAvatar.identity.seconds", { defaultValue: "초" })}`} />
            <Limit label={t("liveAvatar.identity.userRemaining", { defaultValue: "사용자 잔여 표기" })} value={`${number(checkMutation.data.limits.userRemainingSeconds)} ${t("liveAvatar.identity.seconds", { defaultValue: "초" })}`} />
            <Limit label={t("liveAvatar.identity.globalDaily", { defaultValue: "전역 일일 한도" })} value={`${number(checkMutation.data.limits.globalDailySeconds)} ${t("liveAvatar.identity.seconds", { defaultValue: "초" })}`} />
            <Limit label={t("liveAvatar.identity.globalRemaining", { defaultValue: "전역 잔여량" })} value={`${number(checkMutation.data.limits.globalRemainingSeconds)} ${t("liveAvatar.identity.seconds", { defaultValue: "초" })}`} />
            <Limit label={t("liveAvatar.identity.sessionLimit", { defaultValue: "세션 제한" })} value={`${number(checkMutation.data.limits.sessionSeconds)} ${t("liveAvatar.identity.seconds", { defaultValue: "초" })}`} />
            <Limit label={t("liveAvatar.identity.cleanupPending", { defaultValue: "정리 대기" })} value={number(checkMutation.data.limits.cleanupPending)} />
            <Limit label={t("liveAvatar.identity.worker", { defaultValue: "작업자 상태" })} value={checkMutation.data.limits.workerReady ? t("liveAvatar.identity.ready", { defaultValue: "준비됨" }) : t("liveAvatar.identity.notReady", { defaultValue: "준비되지 않음" })} />
            <Limit label={t("liveAvatar.identity.providerCredits", { defaultValue: "제공자 크레딧" })} value={t("liveAvatar.identity.unknown", { defaultValue: "알 수 없음" })} />
            <Limit label={t("liveAvatar.identity.resetsAt", { defaultValue: "초기화 시각" })} value={new Date(checkMutation.data.limits.resetsAt).toLocaleString()} />
          </div>
          <p className="text-xs text-muted-foreground">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
            {t("liveAvatar.identity.tenantSharedLimits", { defaultValue: "사용자 한도·잔여 표기는 사용자별 예산이 아닙니다. 테넌트가 공유하는 예약 가능 시간(초)이며 금액이나 비용 정보가 아닙니다." })}
          </p>
        </div>
      )}
    </section>
  );
}

function PublicValue({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-medium">{value || "—"}</p>
    </div>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/70 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium tabular-nums">{value}</p>
    </div>
  );
}
