import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { liveAvatarBlockerText } from "@/lib/liveAvatarBlockers";
import { LiveAvatarConnectionPanel } from "@/components/admin/LiveAvatarConnectionPanel";
import { LiveAvatarIdentityPanel } from "@/components/admin/LiveAvatarIdentityPanel";

type LiveAvatarConfig = {
  enabled: boolean;
  service: "avatar-router";
  contractReady: false;
  blockers: string[];
  origin: string;
};

type ProviderDiagnostic = {
  id: string;
  name: string;
  status: string;
  externalAudio: boolean;
  implemented: boolean;
};

type LiveAvatarDiagnostics = {
  reachable: boolean;
  liveEnabled: boolean;
  providers: ProviderDiagnostic[];
  blockers: string[];
  checkedAt: string;
};

const configKey = ["/api/live-avatar/config"];

export function LiveAvatarSettingsPanel() {
  const { t } = useTranslation();
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [showAdvancedIdentity, setShowAdvancedIdentity] = useState(false);
  const configQuery = useQuery<LiveAvatarConfig>({
    queryKey: configKey,
    queryFn: async () => (await apiRequest("GET", "/api/live-avatar/config")).json(),
  });
  const saveConfig = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await apiRequest("PUT", "/api/live-avatar/config", { enabled })).json() as Promise<LiveAvatarConfig>,
    onSuccess: (config) => {
      queryClient.setQueryData(configKey, config);
      queryClient.invalidateQueries({ queryKey: ["/api/live-avatar/conversations"] });
      setPendingEnabled(null);
    },
    onError: () => setPendingEnabled(null),
  });
  const diagnostics = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/live-avatar/diagnostics")).json() as Promise<LiveAvatarDiagnostics>,
  });
  const config = configQuery.data;
  const currentEnabled = pendingEnabled ?? config?.enabled ?? false;
  const saving = saveConfig.isPending;
  const errorText = (error: unknown) => error instanceof Error ? error.message : t("liveAvatar.errors.unknown", { defaultValue: "알 수 없는 오류가 발생했습니다." });

  return (
    <Card className="border-border/70">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            {t("liveAvatar.settings.title", { defaultValue: "실시간 아바타 설정" })}
          </CardTitle>
          <CardDescription className="mt-1.5 max-w-2xl">
            {t("liveAvatar.settings.description", { defaultValue: "외부 아바타 서비스의 전역 사용 여부를 관리합니다. 사용자가 직접 선택하기 전에는 기존 채팅과 음성 경험이 유지됩니다." })}
          </CardDescription>
        </div>
        <Badge variant={config?.enabled ? "default" : "secondary"} className="w-fit">
          {config?.enabled
            ? t("liveAvatar.status.globalOn", { defaultValue: "전역 사용" })
            : t("liveAvatar.status.globalOff", { defaultValue: "전역 꺼짐" })}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {configQuery.isLoading ? (
          <div className="space-y-3" aria-label={t("common.loading", { defaultValue: "불러오는 중" })}>
            <div className="h-12 animate-pulse rounded-md bg-muted/70" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted/70" />
          </div>
        ) : configQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <span>{t("liveAvatar.errors.configLoad", { defaultValue: "설정을 불러오지 못했습니다." })} {errorText(configQuery.error)}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => configQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("common.retry", { defaultValue: "다시 시도" })}
            </Button>
          </div>
        ) : config ? (
          <>
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 p-4">
              <div className="space-y-1">
                <p className="font-medium">{t("liveAvatar.settings.globalToggle", { defaultValue: "실시간 아바타 전역 허용" })}</p>
                <p className="text-sm text-muted-foreground">
                  {t("liveAvatar.settings.globalToggleHint", { defaultValue: "꺼져 있어도 시나리오별 정책은 저장할 수 있습니다." })}
                </p>
              </div>
              <Switch
                checked={currentEnabled}
                disabled={saving}
                aria-label={t("liveAvatar.settings.globalToggle", { defaultValue: "실시간 아바타 전역 허용" })}
                onCheckedChange={(enabled) => {
                  setPendingEnabled(enabled);
                  saveConfig.mutate(enabled);
                }}
              />
            </div>
            {saveConfig.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t("liveAvatar.errors.configSave", { defaultValue: "설정을 저장하지 못했습니다." })} {errorText(saveConfig.error)}
              </p>
            )}
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">{t("liveAvatar.settings.service", { defaultValue: "서비스" })}</p>
                <p className="mt-1 font-medium">{config.service}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">{t("liveAvatar.settings.origin", { defaultValue: "서비스 출처" })}</p>
                <p className="mt-1 break-all font-medium">{config.origin || "—"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-medium">{t("liveAvatar.contract.title", { defaultValue: "외부 연동 계약 미검증" })}</p>
                <p className="mt-1 text-muted-foreground">
                  {t("liveAvatar.contract.description", { defaultValue: "현재 서버 간 연동 계약이 확인되지 않아 실시간 세션은 시작할 수 없습니다. 전역 허용은 기능 노출 설정이며 실제 연결 가능 상태를 의미하지 않습니다." })}
                </p>
              </div>
            </div>
            {config.blockers.length > 0 && (
              <BlockerList title={t("liveAvatar.blockers.title", { defaultValue: "차단 사유" })} blockers={config.blockers} />
            )}
          </>
        ) : null}

        <section className="space-y-3 border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">{t("liveAvatar.diagnostics.title", { defaultValue: "연결 진단" })}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("liveAvatar.diagnostics.description", { defaultValue: "외부 연결 상태를 확인합니다. 이 진단은 버튼을 눌렀을 때만 실행됩니다." })}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => diagnostics.mutate()}
              disabled={diagnostics.isPending}
            >
              {diagnostics.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {diagnostics.isPending
                ? t("liveAvatar.diagnostics.running", { defaultValue: "확인 중…" })
                : t("liveAvatar.diagnostics.run", { defaultValue: "진단 실행" })}
            </Button>
          </div>
          {diagnostics.isError && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {t("liveAvatar.errors.diagnostics", { defaultValue: "진단을 완료하지 못했습니다." })} {errorText(diagnostics.error)}
            </div>
          )}
          {diagnostics.data && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={diagnostics.data.reachable ? "default" : "destructive"}>
                  {diagnostics.data.reachable
                    ? t("liveAvatar.diagnostics.reachable", { defaultValue: "연결 확인됨" })
                    : t("liveAvatar.diagnostics.unreachable", { defaultValue: "연결 불가" })}
                </Badge>
                <Badge variant="secondary">
                  {diagnostics.data.liveEnabled
                    ? t("liveAvatar.status.globalOn", { defaultValue: "전역 사용" })
                    : t("liveAvatar.status.globalOff", { defaultValue: "전역 꺼짐" })}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t("liveAvatar.diagnostics.checkedAt", { defaultValue: "확인 시각" })}: {new Date(diagnostics.data.checkedAt).toLocaleString()}
                </span>
              </div>
              {diagnostics.data.providers.length ? (
                <ul className="divide-y rounded-md border">
                  {diagnostics.data.providers.map((provider) => (
                    <li key={provider.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm">
                      <div>
                        <p className="font-medium">{provider.name}</p>
                        <p className="text-xs text-muted-foreground">{provider.id}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{provider.status}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {provider.implemented
                            ? t("liveAvatar.diagnostics.implemented", { defaultValue: "구현됨" })
                            : t("liveAvatar.diagnostics.notImplemented", { defaultValue: "미구현" })}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {provider.externalAudio
                            ? t("liveAvatar.diagnostics.externalAudio", { defaultValue: "외부 오디오" })
                            : t("liveAvatar.diagnostics.noExternalAudio", { defaultValue: "외부 오디오 없음" })}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("liveAvatar.diagnostics.noProviders", { defaultValue: "진단 결과에 제공자가 없습니다." })}</p>
              )}
              {diagnostics.data.blockers.length > 0 && (
                <BlockerList title={t("liveAvatar.blockers.title", { defaultValue: "차단 사유" })} blockers={diagnostics.data.blockers} />
              )}
              {!diagnostics.data.reachable && (
                <p className="flex items-center gap-2 text-sm text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  {t("liveAvatar.diagnostics.unavailableNotice", { defaultValue: "진단 결과만 표시되며 실시간 세션은 활성화되지 않습니다." })}
                </p>
              )}
              {diagnostics.data.reachable && diagnostics.data.blockers.length === 0 && !diagnostics.data.liveEnabled && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("liveAvatar.diagnostics.complete", { defaultValue: "진단이 완료되었습니다." })}
                </p>
              )}
            </div>
          )}
        </section>
        <div className="border-t pt-5">
          <LiveAvatarConnectionPanel />
        </div>
        <details
          className="group border-t pt-5"
          onToggle={(event) => setShowAdvancedIdentity(event.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none font-medium marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
              {t("liveAvatar.identity.advancedLabel", { defaultValue: "고급 JWT 위임 · 선택 사항" })}
            </span>
          </summary>
          {showAdvancedIdentity && (
            <div className="pt-4">
              <LiveAvatarIdentityPanel />
            </div>
          )}
        </details>
      </CardContent>
    </Card>
  );
}

function BlockerList({ title, blockers }: { title: string; blockers: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
        {blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{liveAvatarBlockerText(blocker, t)}</li>)}
      </ul>
    </div>
  );
}
