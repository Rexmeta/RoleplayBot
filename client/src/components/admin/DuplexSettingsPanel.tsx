import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, RotateCcw, Save, Settings2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/queryClient";
import {
  BASELINE_DUPLEX_CONFIG,
  duplexConfigSchema,
  type DuplexConfig,
} from "../../../../shared/duplexMode";

const settingsQueryKey = ["/api/system-admin/settings/voice_duplex"] as const;

const booleanFields: Array<{
  key: keyof Pick<
    DuplexConfig,
    "interaction" | "playbackLifecycle" | "characterEmotion" |
      "expressionSync" | "evaluationSnapshot" | "silentReactions"
  >;
  label: string;
  description: string;
}> = [
  {
    key: "interaction",
    label: "대화형 상호작용",
    description: "듀플렉스 대화 동작을 새 실행에서 활성화합니다.",
  },
  {
    key: "playbackLifecycle",
    label: "재생 수명 주기",
    description: "음성 재생의 시작과 종료 상태를 관리합니다. 상호작용이 필요합니다.",
  },
  {
    key: "characterEmotion",
    label: "캐릭터 감정 상태",
    description: "실행 중 캐릭터 감정 상태를 반영합니다. 상호작용이 필요합니다.",
  },
  {
    key: "expressionSync",
    label: "표현 동기화",
    description: "감정 표현을 재생 상태와 동기화합니다. 캐릭터 감정과 재생 수명 주기가 필요합니다.",
  },
  {
    key: "evaluationSnapshot",
    label: "평가 스냅샷",
    description: "새로 등록된 ledger-v1 실행에 평가 스냅샷을 사용합니다.",
  },
  {
    key: "silentReactions",
    label: "무음 반응",
    description: "음성 추가 생성 없이 무음 반응을 허용합니다. 상호작용이 필요합니다.",
  },
];

const validationMessages: Record<string, string> = {
  playback_requires_interaction: "재생 수명 주기를 켜려면 대화형 상호작용을 먼저 켜야 합니다.",
  character_requires_interaction: "캐릭터 감정 상태를 켜려면 대화형 상호작용을 먼저 켜야 합니다.",
  expression_requires_character_and_playback: "표현 동기화에는 캐릭터 감정 상태와 재생 수명 주기가 모두 필요합니다.",
  evaluation_requires_interaction_and_playback: "평가 스냅샷에는 대화형 상호작용과 재생 수명 주기가 모두 필요합니다.",
  reactions_require_interaction: "무음 반응을 켜려면 대화형 상호작용을 먼저 켜야 합니다.",
  barge_in_policy_requires_playback: "기준 외 끼어들기 정책을 사용하려면 재생 수명 주기를 켜야 합니다.",
  voice_backchannel_not_verified: "음성 백채널은 지원이 확인되지 않아 사용할 수 없습니다.",
};

async function fetchDuplexConfig(): Promise<DuplexConfig> {
  const response = await fetch(settingsQueryKey[0], {
    credentials: "include",
    headers: ((): Record<string, string> => {
      const token = localStorage.getItem("authToken");
      return token ? { Authorization: `Bearer ${token}` } : {};
    })(),
  });
  if (!response.ok) {
    const body = (await response.text()) || response.statusText;
    throw new Error(`설정을 불러오지 못했습니다 (${response.status}): ${body}`);
  }

  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error("설정 응답 형식이 올바르지 않습니다. 설정 목록이 필요합니다.");
  }
  const setting = rows.find(
    (row): row is { category: unknown; key: unknown; value: unknown } =>
      typeof row === "object" &&
      row !== null &&
      "category" in row &&
      "key" in row &&
      row.category === "voice_duplex" &&
      row.key === "config",
  );

  if (!setting) return { ...BASELINE_DUPLEX_CONFIG };
  if (typeof setting.value !== "string") {
    throw new Error("듀플렉스 설정 value가 문자열이 아닙니다.");
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(setting.value);
  } catch {
    throw new Error("듀플렉스 설정 JSON을 해석할 수 없습니다. 저장된 값을 확인해주세요.");
  }
  const parsedConfig = duplexConfigSchema.safeParse(parsedValue);
  if (!parsedConfig.success) {
    throw new Error(
      `저장된 듀플렉스 설정이 유효하지 않습니다: ${parsedConfig.error.issues
        .map((issue) => issue.message)
        .join(", ")}`,
    );
  }
  return parsedConfig.data;
}

export function DuplexSettingsPanel() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: settingsQueryKey,
    queryFn: fetchDuplexConfig,
  });
  const [config, setConfig] = useState<DuplexConfig>({ ...BASELINE_DUPLEX_CONFIG });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (configQuery.data) {
      setConfig(configQuery.data);
      setSaved(false);
    }
  }, [configQuery.data]);

  const validation = useMemo(() => duplexConfigSchema.safeParse(config), [config]);
  const validationErrors = validation.success
    ? []
    : validation.error.issues.map((issue) => validationMessages[issue.message] ?? issue.message);

  const saveMutation = useMutation({
    mutationFn: async (value: DuplexConfig) => {
      await apiRequest("PUT", "/api/system-admin/settings", {
        category: "voice_duplex",
        key: "config",
        value,
      });
    },
    onSuccess: async () => {
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["/api/system-admin/settings"] }),
      ]);
    },
  });

  const setBoolean = (key: keyof DuplexConfig, checked: boolean) => {
    setSaved(false);
    saveMutation.reset();
    setConfig((current) => ({ ...current, [key]: checked }));
  };

  const resetToBaseline = () => {
    setSaved(false);
    saveMutation.reset();
    setConfig({ ...BASELINE_DUPLEX_CONFIG });
  };

  if (configQuery.isPending) {
    return (
      <Card data-testid="duplex-settings-loading" aria-busy="true">
        <CardHeader>
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-md bg-muted/70" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (configQuery.isError) {
    return (
      <Alert variant="destructive" data-testid="duplex-settings-load-error">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>듀플렉스 설정을 불러오지 못했습니다</AlertTitle>
        <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span>{configQuery.error.message}</span>
          <Button variant="outline" size="sm" onClick={() => configQuery.refetch()} data-testid="duplex-settings-retry">
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="overflow-hidden border-border/80" data-testid="duplex-settings-panel">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md border bg-background p-2 text-primary">
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>듀플렉스 실행 설정</CardTitle>
              <Badge variant="outline">신규 실행에만 적용</Badge>
            </div>
            <CardDescription className="mt-1">
              새로 시작하는 실행에 적용할 동작을 명시적으로 관리합니다.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <Alert className="border-amber-300/70 bg-amber-50/60 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>활성 실행에는 변경 사항이 적용되지 않습니다</AlertTitle>
          <AlertDescription className="space-y-1.5">
            <p>저장된 설정은 새로 시작한 실행에만 적용됩니다. 이미 활성화되었거나 재연결된 실행의 설정은 바뀌지 않습니다.</p>
            <p>평가 스냅샷은 ledger-v1 실행에만 적용됩니다. 레거시 실행은 기존 평가 방식을 유지하며 음성 연결을 계속 사용할 수 있습니다.</p>
            <p>기준값으로 되돌리면 모든 불리언 옵션이 꺼지고 끼어들기 정책이 기준으로 설정됩니다. 이 변경도 신규 실행에만 적용됩니다.</p>
          </AlertDescription>
        </Alert>

        <section aria-labelledby="duplex-feature-heading">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="duplex-feature-heading" className="text-sm font-semibold">실행 기능</h3>
            <span className="text-xs text-muted-foreground">필수 조건은 저장 전에 검사됩니다</span>
          </div>
          <div className="divide-y rounded-lg border">
            {booleanFields.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <Label htmlFor={`duplex-${key}`} className="text-sm font-medium">{label}</Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
                </div>
                <Switch
                  id={`duplex-${key}`}
                  checked={config[key] as boolean}
                  onCheckedChange={(checked) => setBoolean(key, checked)}
                  aria-label={label}
                  data-testid={`duplex-toggle-${key}`}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border p-4" aria-labelledby="duplex-barge-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 id="duplex-barge-heading" className="text-sm font-semibold">끼어들기 정책</h3>
              <p className="mt-1 text-xs text-muted-foreground">기준 외 정책은 재생 수명 주기가 필요합니다.</p>
            </div>
            <select
              id="duplex-barge-policy"
              value={config.bargeInPolicy}
              onChange={(event) => {
                setSaved(false);
                saveMutation.reset();
                setConfig((current) => ({
                  ...current,
                  bargeInPolicy: event.target.value as DuplexConfig["bargeInPolicy"],
                }));
              }}
              aria-label="끼어들기 정책"
              data-testid="duplex-barge-in-policy"
              className="h-9 min-w-44 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="baseline">기준</option>
              <option value="candidate">후보</option>
              <option value="confirmed">확정</option>
            </select>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="duplex-backchannel-heading">
          <div>
            <h3 id="duplex-backchannel-heading" className="text-sm font-semibold">음성 백채널</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              지원이 확인된 애플리케이션 음성 백채널 기능이 없어 사용할 수 없습니다. 다른 실행이나 추가 음성 생성을 대신 사용하지 않습니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">지원 안 함</span>
            <Switch
              id="duplex-voice-backchannel"
              checked={false}
              disabled
              aria-label="음성 백채널, 지원 안 함"
              data-testid="duplex-toggle-voiceBackchannel"
            />
          </div>
        </section>

        {validationErrors.length > 0 && (
          <Alert variant="destructive" role="alert" data-testid="duplex-validation-errors">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>설정 조합을 확인해주세요</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {validationErrors.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {saveMutation.isError && (
          <Alert variant="destructive" role="alert" data-testid="duplex-settings-save-error">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>설정을 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{saveMutation.error.message}</AlertDescription>
          </Alert>
        )}
        {saved && (
          <p className="flex items-center gap-2 text-sm text-emerald-700" role="status" data-testid="duplex-settings-saved">
            <Check className="h-4 w-4" aria-hidden="true" />
            설정을 저장했습니다. 새로 시작하는 실행부터 적용됩니다.
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={resetToBaseline}
            disabled={saveMutation.isPending}
            data-testid="duplex-reset-baseline"
          >
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            기준값으로 되돌리기
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (validation.success) saveMutation.mutate(validation.data);
            }}
            disabled={!validation.success || saveMutation.isPending}
            aria-busy={saveMutation.isPending}
            data-testid="duplex-save"
          >
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            {saveMutation.isPending ? "저장 중…" : "설정 저장"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default DuplexSettingsPanel;
