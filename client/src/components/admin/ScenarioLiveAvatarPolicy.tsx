import React, { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Props = { scenarioId?: string };
type Policy = { allowed: boolean };
type Config = { enabled: boolean; service: "avatar-router"; contractReady: false; blockers: string[]; origin: string };

export function ScenarioLiveAvatarPolicy({ scenarioId }: Props) {
  const { t } = useTranslation();
  const policyKey = ["/api/live-avatar/scenarios", scenarioId ?? "", "policy"];
  const configKey = ["/api/live-avatar/config"];
  const policyQuery = useQuery<Policy>({
    queryKey: policyKey,
    enabled: Boolean(scenarioId),
    queryFn: async () => (await apiRequest("GET", `/api/live-avatar/scenarios/${encodeURIComponent(scenarioId!)}/policy`)).json(),
  });
  const configQuery = useQuery<Config>({
    queryKey: configKey,
    queryFn: async () => (await apiRequest("GET", "/api/live-avatar/config")).json(),
  });
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (policyQuery.data) setAllowed(policyQuery.data.allowed);
  }, [policyQuery.data]);

  const savePolicy = useMutation({
    mutationFn: async () =>
      (await apiRequest("PUT", `/api/live-avatar/scenarios/${encodeURIComponent(scenarioId!)}/policy`, { allowed })).json() as Promise<Policy>,
    onSuccess: (policy) => {
      queryClient.setQueryData(policyKey, policy);
      queryClient.invalidateQueries({ queryKey: ["/api/live-avatar/conversations"] });
    },
  });
  const errorText = (error: unknown) => error instanceof Error ? error.message : t("liveAvatar.errors.unknown", { defaultValue: "알 수 없는 오류가 발생했습니다." });

  return (
    <Card className="border-border/70">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t("liveAvatar.policy.title", { defaultValue: "시나리오 실시간 아바타 정책" })}</CardTitle>
            <CardDescription className="mt-1.5">
              {t("liveAvatar.policy.description", { defaultValue: "이 시나리오에서 사용자가 실시간 아바타를 선택할 수 있도록 허용합니다." })}
            </CardDescription>
          </div>
          {configQuery.data && (
            <Badge variant={configQuery.data.enabled ? "default" : "secondary"}>
              {configQuery.data.enabled
                ? t("liveAvatar.policy.globalEnabled", { defaultValue: "전역 설정 켜짐" })
                : t("liveAvatar.policy.globalDisabled", { defaultValue: "전역 설정 꺼짐" })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!scenarioId ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {t("liveAvatar.policy.saveScenarioFirst", { defaultValue: "새 시나리오를 먼저 저장한 뒤 정책을 설정할 수 있습니다." })}
          </div>
        ) : policyQuery.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-muted/70" aria-label={t("common.loading", { defaultValue: "불러오는 중" })} />
        ) : policyQuery.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span>{t("liveAvatar.errors.policyLoad", { defaultValue: "시나리오 정책을 불러오지 못했습니다." })} {errorText(policyQuery.error)}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => policyQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />{t("common.retry", { defaultValue: "다시 시도" })}
            </Button>
          </div>
        ) : (
          <>
            {configQuery.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t("liveAvatar.errors.globalConfigLoad", { defaultValue: "전역 설정 상태를 불러오지 못했습니다." })} {errorText(configQuery.error)}
                <Button type="button" variant="link" size="sm" onClick={() => configQuery.refetch()}>{t("common.retry", { defaultValue: "다시 시도" })}</Button>
              </p>
            )}
            {configQuery.data && !configQuery.data.enabled && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <p>{t("liveAvatar.policy.globalOffNote", { defaultValue: "전역 설정이 꺼져 있어 실제 선택은 사용할 수 없습니다. 이 시나리오의 정책은 별도로 저장할 수 있습니다." })}</p>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 p-4">
              <div>
                <p className="font-medium">{t("liveAvatar.policy.allowToggle", { defaultValue: "이 시나리오에서 허용" })}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("liveAvatar.policy.allowHint", { defaultValue: "허용 여부만 저장합니다. 외부 계약 검증 전에는 실시간 세션이 시작되지 않습니다." })}
                </p>
              </div>
              <Switch
                checked={allowed}
                disabled={policyQuery.isLoading || policyQuery.isError || savePolicy.isPending}
                aria-label={t("liveAvatar.policy.allowToggle", { defaultValue: "이 시나리오에서 허용" })}
                onCheckedChange={setAllowed}
              />
            </div>
            {savePolicy.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t("liveAvatar.errors.policySave", { defaultValue: "정책을 저장하지 못했습니다." })} {errorText(savePolicy.error)}
              </p>
            )}
            <Button
              type="button"
              onClick={() => savePolicy.mutate()}
              disabled={!scenarioId || policyQuery.isLoading || policyQuery.isError || savePolicy.isPending || allowed === policyQuery.data?.allowed}
            >
              {savePolicy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {savePolicy.isPending
                ? t("common.saving", { defaultValue: "저장 중…" })
                : t("liveAvatar.policy.save", { defaultValue: "정책 저장" })}
            </Button>
            {savePolicy.isSuccess && (
              <p role="status" className="text-sm text-muted-foreground">{t("liveAvatar.policy.saved", { defaultValue: "정책을 저장했습니다." })}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
