import React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, CircleHelp, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { LiveAvatarPreflightPanel } from "./LiveAvatarPreflightPanel";

type ConnectionStatus = {
  authMode: "api-key";
  state: "unconfigured" | "invalid" | "configured";
  baseUrl?: string;
};

type ConnectionCheckResult = {
  authenticated: true;
  authType: "api-key";
  projectId: string;
  projectName: string;
  scopes: string[];
  expiresAt: string;
  userContext: true;
  checkedAt: string;
};

const connectionKey = ["/api/live-avatar/connection"];

export function LiveAvatarConnectionPanel() {
  const { t } = useTranslation();
  const statusQuery = useQuery<ConnectionStatus>({
    queryKey: connectionKey,
    queryFn: async () => (await apiRequest("GET", "/api/live-avatar/connection")).json(),
    retry: false,
  });
  const checkMutation = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/live-avatar/connection/check", {})).json() as Promise<ConnectionCheckResult>,
    retry: false,
  });
  const status = statusQuery.data;
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : t("liveAvatar.errors.unknown", { defaultValue: "알 수 없는 오류가 발생했습니다." });
  const stateLabel = status?.state === "configured"
    ? t("liveAvatar.connection.configured", { defaultValue: "구성됨 · 확인 필요" })
    : status?.state === "invalid"
      ? t("liveAvatar.connection.invalid", { defaultValue: "구성 오류" })
      : t("liveAvatar.connection.unconfigured", { defaultValue: "미구성" });

  return (
    <section className="space-y-4 rounded-lg border bg-muted/10 p-4 sm:p-5" aria-labelledby="live-avatar-connection-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md border bg-background p-2 text-primary">
            <KeyRound className="h-4 w-4" />
          </div>
          <div>
            <h3 id="live-avatar-connection-title" className="font-medium">
              {t("liveAvatar.connection.title", { defaultValue: "AvatarRouter API 키 연결" })}
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("liveAvatar.connection.description", { defaultValue: "서버에 보관된 프로젝트 API 키로 AvatarRouter 연결을 확인합니다. 키는 이 화면에 입력하거나 브라우저에 저장하지 않습니다." })}
            </p>
          </div>
        </div>
        {status && (
          <Badge variant={status.state === "configured" ? "default" : status.state === "invalid" ? "destructive" : "secondary"}>
            {stateLabel}
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
            {t("liveAvatar.connection.statusLoadError", { defaultValue: "연결 설정 상태를 불러오지 못했습니다." })} {errorText(statusQuery.error)}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
            {statusQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            {t("common.retry", { defaultValue: "다시 시도" })}
          </Button>
        </div>
      ) : status ? (
        <>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="min-w-0 rounded-md border bg-background/70 p-3">
              <p className="text-xs text-muted-foreground">{t("liveAvatar.connection.authMode", { defaultValue: "인증 방식" })}</p>
              <p className="mt-1 font-medium">AvatarRouter API 키</p>
            </div>
            <div className="min-w-0 rounded-md border bg-background/70 p-3">
              <p className="text-xs text-muted-foreground">{t("liveAvatar.connection.baseUrl", { defaultValue: "서버 Base URL" })}</p>
              <p className="mt-1 break-all font-medium">{status.baseUrl || "—"}</p>
            </div>
          </div>

          {status.state !== "configured" && (
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-medium">
                  {status.state === "invalid"
                    ? t("liveAvatar.connection.invalidSetup", { defaultValue: "서버 연결 설정을 확인해야 합니다." })
                    : t("liveAvatar.connection.setup", { defaultValue: "서버 연결 설정이 필요합니다." })}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {t("liveAvatar.connection.setupHint", { defaultValue: "배포 환경의 AVATAR_ROUTER_BASE_URL과 AVATAR_ROUTER_API_KEY 서버 Secrets를 설정하세요. 비밀 키는 브라우저에서 입력하지 마세요." })}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="max-w-2xl text-sm text-muted-foreground">
              {t("liveAvatar.connection.projectKeyNotice", { defaultValue: "API 키는 사람의 로그인 신원이 아니라 프로젝트 자격 증명입니다. 외부 테넌트가 다르면 각 테넌트에 맞는 프로젝트 키를 사용해야 합니다." })}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => checkMutation.mutate()}
              disabled={status.state !== "configured" || checkMutation.isPending}
            >
              {checkMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              {checkMutation.isPending
                ? t("liveAvatar.connection.checking", { defaultValue: "확인 중…" })
                : t("liveAvatar.connection.check", { defaultValue: "API 키 연결 확인" })}
            </Button>
          </div>
        </>
      ) : null}

      <LiveAvatarPreflightPanel configured={status?.state === "configured"} />

      {checkMutation.isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span>
            {t("liveAvatar.connection.checkError", { defaultValue: "API 키 연결 확인에 실패했습니다." })} {errorText(checkMutation.error)}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => checkMutation.mutate()} disabled={status?.state !== "configured" || checkMutation.isPending}>
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
              <p className="text-sm font-medium">{t("liveAvatar.connection.authenticated", { defaultValue: "API 키 인증 확인됨" })}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("liveAvatar.connection.successCaveat", { defaultValue: "프로젝트 인증만 확인했습니다. 실시간 미디어 경로는 검증되지 않았으며 기존 세션 차단 상태와 기본값은 그대로 유지됩니다." })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("liveAvatar.connection.checkedAt", { defaultValue: "확인 시각" })}: {new Date(checkMutation.data.checkedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <ConnectionValue label={t("liveAvatar.connection.project", { defaultValue: "프로젝트" })} value={`${checkMutation.data.projectName} · ${checkMutation.data.projectId}`} />
            <ConnectionValue label={t("liveAvatar.connection.expiresAt", { defaultValue: "키 만료 시각" })} value={new Date(checkMutation.data.expiresAt).toLocaleString()} />
            <ConnectionValue label={t("liveAvatar.connection.scopes", { defaultValue: "권한 범위" })} value={checkMutation.data.scopes.length ? checkMutation.data.scopes.join(", ") : "—"} />
            <ConnectionValue label={t("liveAvatar.connection.userContext", { defaultValue: "사용자 컨텍스트" })} value={checkMutation.data.userContext ? t("liveAvatar.connection.present", { defaultValue: "포함됨" }) : t("liveAvatar.connection.absent", { defaultValue: "없음" })} />
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 rounded-md border bg-background/60 p-3 text-sm">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          {t("liveAvatar.connection.jwtNotRequired", { defaultValue: "기본 API 키 방식에는 issuer나 JWKS 설정이 필요하지 않습니다. 성공한 인증은 실시간 미디어 연결을 검증하지 않으며, 기본값은 계속 차단 상태입니다." })}
        </p>
      </div>
    </section>
  );
}

function ConnectionValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background/70 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-medium">{value}</p>
    </div>
  );
}
