import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2,
  Plus,
  Copy,
  ShieldOff,
  Key,
  CheckCircle,
  XCircle,
  List,
  BarChart2,
  ExternalLink,
  AlertTriangle,
  X,
  Settings2,
  Webhook,
  Bell,
  BellOff,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import { AGENT_API_SCOPES } from "@shared/schema";
import { AgentKeyUsageDashboard } from "./AgentKeyUsageDashboard";

interface AgentApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  environment: "live" | "test";
  organizationId: string;
  scopes: string[];
  allowedIps: string[];
  rateLimitPerMinute: number;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
  monthlyRequestCount: number;
  monthlyTotalTokens: number;
  monthlyEstimatedRequestCount: number;
}

interface AgentKeyAlert {
  id: string;
  agentKeyId: string;
  agentKeyName: string;
  organizationId: string;
  period: string;
  realTokenRate: number;
  threshold: number;
  notificationMethod: "in_app" | "webhook" | "both";
  deliveredVia: string[];
  acknowledgedAt: string | null;
  createdAt: string;
}

interface AgentWebhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string | null;
}

interface AgentWebhookDelivery {
  id: string;
  deliveryId: string;
  event: string;
  statusCode: number | null;
  latencyMs: number | null;
  attempt: number;
  payload: Record<string, unknown> | null;
  succeededAt: string | null;
  nextRetryAt: string | null;
  createdAt: string | null;
}

interface WebhookCoverageItem {
  keyId: string;
  keyName: string;
  keyPrefix: string;
  isActive: boolean;
  hasSubscription: boolean;
}

const LOW_TOKEN_RATE_EVENT = "agent_key.low_token_rate";

interface Scenario {
  id: string;
  title: string;
}

const DEFAULT_SCOPES = [
  "scenarios:read",
  "personas:read",
  "sessions:create",
  "sessions:read",
  "sessions:message",
  "sessions:end",
];

const EMPTY_FORM = {
  name: "",
  environment: "live" as "live" | "test",
  organizationId: "",
  expiresInDays: 90,
  rateLimitPerMinute: 60,
  scopes: DEFAULT_SCOPES as string[],
  allowedScenarioIds: [] as string[],
};

export function AgentKeyManager() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: string; apiKey: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<AgentApiKey | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [scenarioTarget, setScenarioTarget] = useState<AgentApiKey | null>(null);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [usageTarget, setUsageTarget] = useState<AgentApiKey | null>(null);
  const [thresholdEditOpen, setThresholdEditOpen] = useState(false);
  const [thresholdInput, setThresholdInput] = useState<number>(50);
  const [notificationMethodInput, setNotificationMethodInput] = useState<"in_app" | "webhook" | "both">("in_app");
  const [webhookTarget, setWebhookTarget] = useState<AgentApiKey | null>(null);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<{ secret: string; url: string } | null>(null);
  const [deliveryWebhookId, setDeliveryWebhookId] = useState<string | null>(null);
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Set<string>>(new Set());

  const { data: keys = [], isLoading } = useQuery<AgentApiKey[]>({
    queryKey: ["/api/admin/agent-keys"],
  });

  const { data: alerts = [], refetch: refetchAlerts } = useQuery<AgentKeyAlert[]>({
    queryKey: ["/api/admin/agent-keys/alerts"],
  });

  const { data: alertSettings } = useQuery<{ threshold: number; notificationMethod: "in_app" | "webhook" | "both" }>({
    queryKey: ["/api/admin/agent-keys/alert-settings"],
  });

  const { data: keyWebhooks = [], isLoading: webhooksLoading } = useQuery<AgentWebhook[]>({
    queryKey: ["/api/admin/agent-keys", webhookTarget?.id, "webhooks"],
    enabled: !!webhookTarget,
    queryFn: async () => {
      const res = await fetch(`/api/admin/agent-keys/${webhookTarget!.id}/webhooks`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch webhooks");
      return res.json();
    },
  });

  const { data: webhookDeliveries = [], isLoading: deliveriesLoading } = useQuery<AgentWebhookDelivery[]>({
    queryKey: ["/api/admin/agent-keys", webhookTarget?.id, "webhooks", deliveryWebhookId, "deliveries"],
    enabled: !!webhookTarget && !!deliveryWebhookId,
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/agent-keys/${webhookTarget!.id}/webhooks/${deliveryWebhookId}/deliveries?limit=20`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch deliveries");
      return res.json();
    },
  });

  const { data: webhookCoverage = [], isLoading: coverageLoading } = useQuery<WebhookCoverageItem[]>({
    queryKey: ["/api/admin/agent-keys/webhook-coverage"],
    enabled: thresholdEditOpen,
    queryFn: async () => {
      const res = await fetch("/api/admin/agent-keys/webhook-coverage", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch webhook coverage");
      return res.json();
    },
  });

  const createWebhookMutation = useMutation({
    mutationFn: async ({ keyId, url }: { keyId: string; url: string }) => {
      const res = await apiRequest("POST", `/api/admin/agent-keys/${keyId}/webhooks`, {
        url,
        events: [LOW_TOKEN_RATE_EVENT],
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys", webhookTarget?.id, "webhooks"] });
      setNewWebhookUrl("");
      setRevealedWebhookSecret({ secret: data.secret, url: data.url });
    },
    onError: (err: any) => {
      toast({ title: t("agentKeys.webhooks.createFailed", "웹훅 생성 실패"), description: err.message, variant: "destructive" });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: async ({ keyId, webhookId }: { keyId: string; webhookId: string }) => {
      const res = await apiRequest("DELETE", `/api/admin/agent-keys/${keyId}/webhooks/${webhookId}`, undefined);
      if (res.status !== 204) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys", webhookTarget?.id, "webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys/webhook-coverage"] });
      toast({ title: t("agentKeys.webhooks.deleted", "웹훅이 삭제되었습니다") });
    },
    onError: (err: any) => {
      toast({ title: t("agentKeys.webhooks.deleteFailed", "삭제 실패"), description: err.message, variant: "destructive" });
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: async ({ keyId, webhookId }: { keyId: string; webhookId: string }) => {
      const res = await apiRequest("POST", `/api/admin/agent-keys/${keyId}/webhooks/${webhookId}/test`, {});
      return res.json() as Promise<{ ok: boolean; statusCode: number | null }>;
    },
    onSuccess: (data, { keyId, webhookId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys", webhookTarget?.id, "webhooks", webhookId, "deliveries"] });
      if (data.ok) {
        toast({ title: t("agentKeys.webhooks.testSuccess", "테스트 전송 성공"), description: t("agentKeys.webhooks.testSuccessDesc", "엔드포인트가 {{code}} 응답을 반환했습니다.", { code: data.statusCode }) });
      } else {
        toast({
          title: t("agentKeys.webhooks.testFailed", "테스트 전송 실패"),
          description: t("agentKeys.webhooks.testFailedDesc", "엔드포인트가 {{code}} 응답을 반환했습니다.", { code: data.statusCode ?? 0 }),
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: t("agentKeys.webhooks.testError", "테스트 전송 오류"), description: err.message, variant: "destructive" });
    },
  });

  const retryDeliveryMutation = useMutation({
    mutationFn: async ({ keyId, webhookId, deliveryId }: { keyId: string; webhookId: string; deliveryId: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/agent-keys/${keyId}/webhooks/${webhookId}/deliveries/${deliveryId}/retry`,
        {}
      );
      return res.json() as Promise<{ ok: boolean; statusCode: number | null }>;
    },
    onSuccess: (data, { keyId, webhookId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys", keyId, "webhooks", webhookId, "deliveries"] });
      if (data.ok) {
        toast({ title: t("agentKeys.webhooks.deliveries.retrySuccess", "재전송 성공"), description: `HTTP ${data.statusCode}` });
      } else {
        toast({
          title: t("agentKeys.webhooks.deliveries.retryFailed", "재전송 실패"),
          description: data.statusCode ? `HTTP ${data.statusCode}` : t("agentKeys.webhooks.deliveries.retryTimeout", "연결 실패"),
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: t("agentKeys.webhooks.deliveries.retryError", "재전송 오류"), description: err.message, variant: "destructive" });
    },
  });

  const toggleWebhookMutation = useMutation({
    mutationFn: async ({ keyId, webhookId, isActive }: { keyId: string; webhookId: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/agent-keys/${keyId}/webhooks/${webhookId}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys", webhookTarget?.id, "webhooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys/webhook-coverage"] });
    },
    onError: (err: any) => {
      toast({ title: t("agentKeys.webhooks.toggleFailed", "상태 변경 실패"), description: err.message, variant: "destructive" });
    },
  });

  const acknowledgeAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const res = await apiRequest("POST", `/api/admin/agent-keys/alerts/${alertId}/acknowledge`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys/alerts"] });
    },
    onError: (err: any) => {
      toast({ title: t("agentKeys.toast.alertDismissFailed", "알림 해제 실패"), description: err.message, variant: "destructive" });
    },
  });

  const updateThresholdMutation = useMutation({
    mutationFn: async (payload: { threshold: number; notificationMethod: "in_app" | "webhook" | "both" }) => {
      const res = await apiRequest("PUT", "/api/admin/agent-keys/alert-settings", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys/alert-settings"] });
      setThresholdEditOpen(false);
      toast({ title: t("agentKeys.toast.thresholdSaved", "임계값이 저장되었습니다") });
    },
    onError: (err: any) => {
      toast({ title: t("agentKeys.toast.thresholdFailed", "저장 실패"), description: err.message, variant: "destructive" });
    },
  });

  const { data: scenarios = [] } = useQuery<Scenario[]>({
    queryKey: ["/api/scenarios"],
    queryFn: async () => {
      const res = await fetch("/api/scenarios", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch scenarios");
      return res.json();
    },
  });

  // Fetches allowed scenario IDs for the key being edited. Keyed by scenarioTarget.id so it
  // re-fetches whenever a different key is opened.
  const { data: keyScenarios, isLoading: keyScenariosLoading } = useQuery<string[]>({
    queryKey: ["/api/admin/agent-keys", scenarioTarget?.id, "scenarios"],
    enabled: !!scenarioTarget,
    queryFn: async () => {
      const res = await fetch(`/api/admin/agent-keys/${scenarioTarget!.id}/scenarios`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch key scenarios");
      return res.json();
    },
  });

  // Hydrate selectedScenarioIds once the async fetch for keyScenarios completes.
  // This avoids the stale-state bug where the click handler would read the previous
  // query's cached value (typically an empty array).
  useEffect(() => {
    if (scenarioTarget && keyScenarios !== undefined) {
      setSelectedScenarioIds(keyScenarios);
    }
  }, [scenarioTarget?.id, keyScenarios]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/admin/agent-keys", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys"] });
      setCreateOpen(false);
      setFormData(EMPTY_FORM);
      setRevealedKey({ id: data.id, apiKey: data.apiKey, name: data.name });
    },
    onError: (err: any) => {
      toast({
        title: t("agentKeys.toast.createFailed", "키 생성 실패"),
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/agent-keys/${id}/revoke`, { reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys"] });
      setRevokeTarget(null);
      setRevokeReason("");
      toast({ title: t("agentKeys.toast.revokeSuccess", "키가 폐기되었습니다") });
    },
    onError: (err: any) => {
      toast({
        title: t("agentKeys.toast.revokeFailed", "폐기 실패"),
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateScenariosMutation = useMutation({
    mutationFn: async ({ id, scenarioIds }: { id: string; scenarioIds: string[] }) => {
      const res = await apiRequest("PATCH", `/api/admin/agent-keys/${id}/scenarios`, { scenarioIds });
      return res.json();
    },
    onSuccess: () => {
      if (scenarioTarget) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys", scenarioTarget.id, "scenarios"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/agent-keys"] });
      setScenarioTarget(null);
      toast({ title: t("agentKeys.toast.scenariosUpdated", "시나리오 접근이 업데이트되었습니다") });
    },
    onError: (err: any) => {
      toast({
        title: t("agentKeys.toast.scenariosFailed", "업데이트 실패"),
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleScopeToggle = (scope: string) => {
    setFormData((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }));
  };

  const handleCreateScenarioToggle = (scenarioId: string) => {
    setFormData((prev) => ({
      ...prev,
      allowedScenarioIds: prev.allowedScenarioIds.includes(scenarioId)
        ? prev.allowedScenarioIds.filter((id) => id !== scenarioId)
        : [...prev.allowedScenarioIds, scenarioId],
    }));
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({ title: t("agentKeys.toast.copied", "클립보드에 복사되었습니다") });
  };

  const openInApiExplorer = (apiKey?: string) => {
    if (apiKey) {
      localStorage.setItem("agentApiKeyPrefill", apiKey);
    }
    window.open("/api/v1/agent/docs", "_blank", "noopener,noreferrer");
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return format(new Date(dateStr), "yyyy-MM-dd");
  };

  const toggleScenario = (scenarioId: string) => {
    setSelectedScenarioIds((prev) =>
      prev.includes(scenarioId) ? prev.filter((id) => id !== scenarioId) : [...prev, scenarioId]
    );
  };

  const handleScenarioDialogClose = () => {
    setScenarioTarget(null);
    setSelectedScenarioIds([]);
  };

  const currentThreshold = alertSettings?.threshold ?? 50;
  const currentNotificationMethod = alertSettings?.notificationMethod ?? "in_app";

  return (
    <div className="space-y-6">
      {/* Alert Banner */}
      {alerts.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-amber-800 dark:text-amber-200 text-base">
              <AlertTriangle className="h-5 w-5" />
              {t("agentKeys.alerts.title", "실 토큰률 경보")}
              <Badge variant="secondary" className="ml-auto bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                {alerts.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between gap-3 rounded-md bg-white dark:bg-amber-900/40 px-3 py-2 text-sm border border-amber-200 dark:border-amber-700"
              >
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-medium truncate">{alert.agentKeyName}</span>
                  <span className="text-muted-foreground shrink-0">({alert.period})</span>
                  <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 dark:bg-red-950 shrink-0">
                    {alert.realTokenRate}%
                  </Badge>
                  <span className="text-muted-foreground text-xs shrink-0">
                    {t("agentKeys.alerts.belowThreshold", { threshold: alert.threshold, defaultValue: `임계값 {{threshold}}% 미달` })}
                  </span>
                  {alert.deliveredVia && alert.deliveredVia.length > 0 && (
                    <span className="flex items-center gap-1 shrink-0">
                      {alert.deliveredVia.map((channel) => (
                        <Badge
                          key={channel}
                          variant="secondary"
                          className="text-xs px-1.5 py-0 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700"
                        >
                          {channel === "in_app"
                            ? t("agentKeys.alerts.channelInApp", "인앱")
                            : channel === "webhook"
                            ? t("agentKeys.alerts.channelWebhook", "웹훅")
                            : channel}
                        </Badge>
                      ))}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => acknowledgeAlertMutation.mutate(alert.id)}
                  disabled={acknowledgeAlertMutation.isPending}
                  title={t("agentKeys.alerts.dismiss", "알림 해제")}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t("agentKeys.title", "Agent API 키 관리")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setThresholdInput(currentThreshold); setNotificationMethodInput(currentNotificationMethod); setThresholdEditOpen(true); }}
              title={t("agentKeys.threshold.configure", "실 토큰률 경보 임계값 설정")}
            >
              <Settings2 className="h-4 w-4 mr-2" />
              {t("agentKeys.threshold.label", "경보 임계값")}: {currentThreshold}%
            </Button>
            <Button onClick={() => setCreateOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              {t("agentKeys.createKey", "새 키 생성")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              {t("agentKeys.loading", "로딩 중...")}
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {t("agentKeys.empty", "등록된 API 키가 없습니다.")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("agentKeys.col.prefix", "키 Prefix")}</TableHead>
                    <TableHead>{t("agentKeys.col.name", "이름")}</TableHead>
                    <TableHead>{t("agentKeys.col.environment", "환경")}</TableHead>
                    <TableHead>{t("agentKeys.col.status", "상태")}</TableHead>
                    <TableHead>{t("agentKeys.col.scopes", "권한")}</TableHead>
                    <TableHead>{t("agentKeys.col.expiresAt", "만료일")}</TableHead>
                    <TableHead>{t("agentKeys.col.lastUsedAt", "마지막 사용")}</TableHead>
                    <TableHead className="text-right">{t("agentKeys.col.monthlyRequests", "월 요청")}</TableHead>
                    <TableHead className="text-right">{t("agentKeys.col.monthlyTokens", "월 토큰")}</TableHead>
                    <TableHead className="text-right">{t("agentKeys.col.tokenAccuracy", "실 토큰률")}</TableHead>
                    <TableHead className="text-right">{t("agentKeys.col.actions", "액션")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => {
                    const isRevoked = !!key.revokedAt;
                    return (
                      <TableRow key={key.id} className={isRevoked ? "opacity-60" : ""}>
                        <TableCell className="font-mono text-xs">
                          <span className={isRevoked ? "line-through text-muted-foreground" : ""}>
                            {key.keyPrefix}…
                          </span>
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          <span className={isRevoked ? "line-through text-muted-foreground" : ""}>
                            {key.name}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              key.environment === "live"
                                ? "text-blue-600 border-blue-300 bg-blue-50 dark:bg-blue-950"
                                : "text-slate-600 border-slate-300 bg-slate-50 dark:bg-slate-900"
                            }
                          >
                            {key.environment}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {isRevoked ? (
                            <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 dark:bg-red-950">
                              <XCircle className="h-3 w-3 mr-1" />
                              {t("agentKeys.status.revoked", "폐기됨")}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              {t("agentKeys.status.active", "활성")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {(key.scopes ?? []).map((s) => (
                              <Badge key={s} variant="secondary" className="text-xs px-1 py-0">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(key.expiresAt)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(key.lastUsedAt)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {key.monthlyRequestCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-sm font-mono">
                          {key.monthlyTotalTokens.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {key.monthlyRequestCount > 0 ? (() => {
                            const realPct = Math.round(
                              ((key.monthlyRequestCount - key.monthlyEstimatedRequestCount) / key.monthlyRequestCount) * 100
                            );
                            const isLow = realPct < 50;
                            const isMid = realPct < 90;
                            return (
                              <Badge
                                variant="outline"
                                title={t("agentKeys.tokenAccuracy.tooltip", "이번 달 실제 토큰 수가 기록된 요청 비율")}
                                className={
                                  isLow
                                    ? "text-red-600 border-red-300 bg-red-50 dark:bg-red-950"
                                    : isMid
                                    ? "text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950"
                                    : "text-green-600 border-green-300 bg-green-50 dark:bg-green-950"
                                }
                              >
                                {realPct}%
                              </Badge>
                            );
                          })() : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setUsageTarget(key)}
                              title={t("agentKeys.action.viewUsage", "사용량 보기")}
                            >
                              <BarChart2 className="h-3.5 w-3.5" />
                            </Button>
                            {!isRevoked && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openInApiExplorer()}
                                  title={t("agentKeys.action.openInExplorer", "API Explorer에서 열기")}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setScenarioTarget(key)}
                                  title={t("agentKeys.action.editScenarios", "시나리오 접근 편집")}
                                >
                                  <List className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => { setWebhookTarget(key); setNewWebhookUrl(""); }}
                                  title={t("agentKeys.action.manageWebhooks", "웹훅 구독 관리")}
                                >
                                  <Webhook className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => {
                                    setRevokeTarget(key);
                                    setRevokeReason("");
                                  }}
                                  title={t("agentKeys.action.revoke", "폐기")}
                                >
                                  <ShieldOff className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Key Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) { setCreateOpen(false); setFormData(EMPTY_FORM); } else { setCreateOpen(true); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("agentKeys.dialog.create.title", "새 Agent API 키 생성")}</DialogTitle>
            <DialogDescription>
              {t("agentKeys.dialog.create.description", "생성 후 원문 키는 한 번만 표시됩니다. 반드시 안전한 곳에 보관하세요.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("agentKeys.dialog.create.name", "키 이름")}</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder={t("agentKeys.dialog.create.namePlaceholder", "예: Production Integration")}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("agentKeys.dialog.create.environment", "환경")}</Label>
                <Select
                  value={formData.environment}
                  onValueChange={(v) => setFormData((p) => ({ ...p, environment: v as "live" | "test" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="live">live</SelectItem>
                    <SelectItem value="test">test</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{t("agentKeys.dialog.create.expiresInDays", "만료 (일)")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={formData.expiresInDays}
                  onChange={(e) => setFormData((p) => ({ ...p, expiresInDays: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("agentKeys.dialog.create.organizationId", "Organization ID")}</Label>
              <Input
                value={formData.organizationId}
                onChange={(e) => setFormData((p) => ({ ...p, organizationId: e.target.value }))}
                placeholder="org_..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("agentKeys.dialog.create.rateLimitPerMinute", "분당 요청 제한")}</Label>
              <Input
                type="number"
                min={1}
                max={1000}
                value={formData.rateLimitPerMinute}
                onChange={(e) => setFormData((p) => ({ ...p, rateLimitPerMinute: Number(e.target.value) }))}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("agentKeys.dialog.create.scopes", "권한 (Scope)")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {AGENT_API_SCOPES.map((scope) => (
                  <div key={scope} className="flex items-center gap-2">
                    <Checkbox
                      id={`scope-${scope}`}
                      checked={formData.scopes.includes(scope)}
                      onCheckedChange={() => handleScopeToggle(scope)}
                    />
                    <label htmlFor={`scope-${scope}`} className="text-xs font-mono cursor-pointer">
                      {scope}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {scenarios.length > 0 && (
              <div className="space-y-2">
                <Label>{t("agentKeys.dialog.create.allowedScenarios", "허용 시나리오 (선택)")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("agentKeys.dialog.create.allowedScenariosHint", "선택하지 않으면 모든 시나리오에 접근 가능합니다.")}
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1.5 border rounded-md p-2">
                  {scenarios.map((scenario) => (
                    <div key={scenario.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`create-scenario-${scenario.id}`}
                        checked={formData.allowedScenarioIds.includes(scenario.id)}
                        onCheckedChange={() => handleCreateScenarioToggle(scenario.id)}
                      />
                      <label htmlFor={`create-scenario-${scenario.id}`} className="text-sm cursor-pointer flex-1 truncate">
                        {scenario.title}
                      </label>
                    </div>
                  ))}
                </div>
                {formData.allowedScenarioIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("agentKeys.dialog.create.selectedScenarios", {
                      count: formData.allowedScenarioIds.length,
                      defaultValue: `{{count}}개 시나리오 선택됨`,
                    })}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setFormData(EMPTY_FORM); }}>
              {t("common.cancel", "취소")}
            </Button>
            <Button
              onClick={() => createMutation.mutate(formData)}
              disabled={
                createMutation.isPending ||
                !formData.name.trim() ||
                !formData.organizationId.trim() ||
                formData.scopes.length === 0
              }
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("common.creating", "생성 중...")}
                </>
              ) : (
                t("agentKeys.dialog.create.submit", "생성")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revealed Key Dialog */}
      <Dialog open={!!revealedKey} onOpenChange={(open) => !open && setRevealedKey(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              {t("agentKeys.dialog.reveal.title", "API 키가 생성되었습니다")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "agentKeys.dialog.reveal.description",
                "이 키는 지금 한 번만 표시됩니다. 반드시 안전한 곳에 복사해 보관하세요."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("agentKeys.dialog.reveal.keyName", "키 이름")}
              </Label>
              <p className="font-medium">{revealedKey?.name}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("agentKeys.dialog.reveal.keyValue", "API 키 (한 번만 표시)")}
              </Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 block bg-muted px-3 py-2 rounded-md text-xs font-mono break-all">
                  {revealedKey?.apiKey}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => revealedKey && handleCopyKey(revealedKey.apiKey)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
              {t(
                "agentKeys.dialog.reveal.warning",
                "이 창을 닫으면 키 원문을 다시 확인할 수 없습니다. 반드시 지금 복사하세요."
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => revealedKey && openInApiExplorer(revealedKey.apiKey)}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {t("agentKeys.dialog.reveal.openInExplorer", "API Explorer에서 테스트")}
            </Button>
            <Button onClick={() => setRevealedKey(null)}>
              {t("agentKeys.dialog.reveal.confirm", "확인했습니다")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Key Dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {t("agentKeys.dialog.revoke.title", "API 키 폐기")}
            </DialogTitle>
            <DialogDescription>
              {t("agentKeys.dialog.revoke.description", {
                name: revokeTarget?.name,
                prefix: revokeTarget?.keyPrefix,
                defaultValue: `"{{name}}" ({{prefix}}…) 키를 폐기합니다. 이 작업은 되돌릴 수 없습니다.`,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label>{t("agentKeys.dialog.revoke.reasonLabel", "폐기 사유 (선택)")}</Label>
            <Textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder={t("agentKeys.dialog.revoke.reasonPlaceholder", "예: 보안 침해 의심, 직원 퇴사 등")}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              {t("common.cancel", "취소")}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                revokeTarget && revokeMutation.mutate({ id: revokeTarget.id, reason: revokeReason })
              }
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("agentKeys.dialog.revoke.revoking", "폐기 중...")}
                </>
              ) : (
                t("agentKeys.dialog.revoke.confirm", "폐기 확인")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scenario Access Dialog */}
      <Dialog open={!!scenarioTarget} onOpenChange={(open) => !open && handleScenarioDialogClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("agentKeys.dialog.scenarios.title", "시나리오 접근 편집")}
            </DialogTitle>
            <DialogDescription>
              {t("agentKeys.dialog.scenarios.description", {
                name: scenarioTarget?.name,
                defaultValue: `"{{name}}" 키가 접근할 수 있는 시나리오를 선택하세요. 아무것도 선택하지 않으면 모든 시나리오에 접근 가능합니다.`,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            {keyScenariosLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                {t("agentKeys.loading", "로딩 중...")}
              </div>
            ) : scenarios.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("agentKeys.dialog.scenarios.noScenarios", "시나리오가 없습니다.")}
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto space-y-2">
                {scenarios.map((scenario) => (
                  <div key={scenario.id} className="flex items-center gap-3 py-1">
                    <Checkbox
                      id={`scenario-${scenario.id}`}
                      checked={selectedScenarioIds.includes(scenario.id)}
                      onCheckedChange={() => toggleScenario(scenario.id)}
                    />
                    <label
                      htmlFor={`scenario-${scenario.id}`}
                      className="text-sm cursor-pointer flex-1"
                    >
                      {scenario.title}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            {selectedScenarioIds.length === 0
              ? t("agentKeys.dialog.scenarios.allAccess", "모든 시나리오 접근 (제한 없음)")
              : t("agentKeys.dialog.scenarios.selectedCount", {
                  count: selectedScenarioIds.length,
                  defaultValue: `{{count}}개 시나리오 선택됨`,
                })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleScenarioDialogClose}>
              {t("common.cancel", "취소")}
            </Button>
            <Button
              onClick={() => scenarioTarget && updateScenariosMutation.mutate({ id: scenarioTarget.id, scenarioIds: selectedScenarioIds })}
              disabled={updateScenariosMutation.isPending || keyScenariosLoading}
            >
              {updateScenariosMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("common.saving", "저장 중...")}
                </>
              ) : (
                t("common.save", "저장")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Usage Dashboard Dialog */}
      <AgentKeyUsageDashboard
        keyId={usageTarget?.id ?? null}
        keyName={usageTarget?.name ?? ""}
        keyPrefix={usageTarget?.keyPrefix ?? ""}
        open={!!usageTarget}
        onClose={() => setUsageTarget(null)}
      />

      {/* Webhook Subscriptions Dialog */}
      <Dialog
        open={!!webhookTarget}
        onOpenChange={(open) => {
          if (!open) {
            setWebhookTarget(null);
            setNewWebhookUrl("");
            setRevealedWebhookSecret(null);
            setDeliveryWebhookId(null);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="h-5 w-5" />
              {t("agentKeys.webhooks.dialogTitle", "웹훅 구독 관리")}
            </DialogTitle>
            <DialogDescription>
              {t("agentKeys.webhooks.dialogDescription", {
                name: webhookTarget?.name,
                defaultValue: `"{{name}}" 키에 등록된 웹훅을 관리합니다.`,
              })}
            </DialogDescription>
          </DialogHeader>

          {/* low_token_rate subscription status */}
          {!webhooksLoading && (() => {
            const isSubscribed = keyWebhooks.some(
              (w) => w.isActive && w.events.includes(LOW_TOKEN_RATE_EVENT)
            );
            return (
              <div
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 border text-sm ${
                  isSubscribed
                    ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
                    : "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
                }`}
              >
                {isSubscribed ? (
                  <Bell className="h-4 w-4 shrink-0" />
                ) : (
                  <BellOff className="h-4 w-4 shrink-0" />
                )}
                <div className="flex-1">
                  <p className="font-medium text-xs font-mono">{LOW_TOKEN_RATE_EVENT}</p>
                  <p className="text-xs mt-0.5">
                    {isSubscribed
                      ? t("agentKeys.webhooks.eventSubscribed", "이 키에 웹훅 알림이 활성화되어 있습니다.")
                      : t("agentKeys.webhooks.eventNotSubscribed", "이 키에 웹훅 알림이 등록되어 있지 않습니다. 아래에서 추가하세요.")}
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Existing webhooks list */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("agentKeys.webhooks.existingWebhooks", "등록된 웹훅")}
            </p>
            {webhooksLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {t("agentKeys.loading", "로딩 중...")}
              </div>
            ) : keyWebhooks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("agentKeys.webhooks.noWebhooks", "등록된 웹훅이 없습니다.")}
              </p>
            ) : (
              <div className="space-y-3">
                {keyWebhooks.map((wh) => {
                  const isDeliveryOpen = deliveryWebhookId === wh.id;
                  return (
                    <div key={wh.id} className="rounded-md border bg-muted/30">
                      <div className="flex items-start gap-3 px-3 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono truncate text-foreground">{wh.url}</p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {wh.events.map((ev) => (
                              <Badge
                                key={ev}
                                variant={ev === LOW_TOKEN_RATE_EVENT ? "default" : "secondary"}
                                className="text-xs px-1 py-0"
                              >
                                {ev}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {wh.isActive
                              ? t("agentKeys.webhooks.active", "활성")
                              : t("agentKeys.webhooks.inactive", "비활성")}
                            {wh.createdAt && ` · ${format(new Date(wh.createdAt), "yyyy-MM-dd")}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant={isDeliveryOpen ? "secondary" : "ghost"}
                            className="h-7 px-2 text-xs text-muted-foreground"
                            onClick={() =>
                              setDeliveryWebhookId(isDeliveryOpen ? null : wh.id)
                            }
                            title={t("agentKeys.webhooks.deliveries.toggle", "최근 전송 이력")}
                          >
                            {t("agentKeys.webhooks.deliveries.toggle", "이력")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
                            disabled={testWebhookMutation.isPending && testWebhookMutation.variables?.webhookId === wh.id}
                            onClick={() =>
                              webhookTarget &&
                              testWebhookMutation.mutate({ keyId: webhookTarget.id, webhookId: wh.id })
                            }
                            title={t("agentKeys.webhooks.test", "테스트 이벤트 전송")}
                          >
                            {testWebhookMutation.isPending && testWebhookMutation.variables?.webhookId === wh.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              t("agentKeys.webhooks.testButton", "테스트")
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className={`h-7 px-2 text-xs ${wh.isActive ? "text-green-600 border-green-300 hover:bg-green-50 dark:hover:bg-green-950" : "text-muted-foreground"}`}
                            disabled={toggleWebhookMutation.isPending}
                            onClick={() =>
                              webhookTarget &&
                              toggleWebhookMutation.mutate({ keyId: webhookTarget.id, webhookId: wh.id, isActive: !wh.isActive })
                            }
                            title={wh.isActive ? t("agentKeys.webhooks.disable", "비활성화") : t("agentKeys.webhooks.enable", "활성화")}
                          >
                            {toggleWebhookMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : wh.isActive ? (
                              <Bell className="h-3 w-3" />
                            ) : (
                              <BellOff className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            disabled={deleteWebhookMutation.isPending}
                            onClick={() =>
                              webhookTarget &&
                              deleteWebhookMutation.mutate({ keyId: webhookTarget.id, webhookId: wh.id })
                            }
                            title={t("agentKeys.webhooks.delete", "웹훅 삭제")}
                          >
                            {deleteWebhookMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Recent Deliveries panel */}
                      {isDeliveryOpen && (
                        <div className="border-t px-3 py-2.5 space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                            {t("agentKeys.webhooks.deliveries.title", "최근 전송 이력")}
                          </p>
                          {deliveriesLoading ? (
                            <div className="flex items-center gap-2 py-3 text-muted-foreground text-xs">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {t("agentKeys.loading", "로딩 중...")}
                            </div>
                          ) : webhookDeliveries.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-3 text-center">
                              {t("agentKeys.webhooks.deliveries.empty", "아직 전송 이력이 없습니다.")}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {webhookDeliveries.map((d) => {
                                const isSuccess = d.succeededAt !== null;
                                const isFailed = !isSuccess && d.statusCode !== null && d.statusCode >= 400;
                                const isPayloadExpanded = expandedPayloadIds.has(d.id);
                                const togglePayload = () =>
                                  setExpandedPayloadIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(d.id)) next.delete(d.id);
                                    else next.add(d.id);
                                    return next;
                                  });
                                const isPending = d.statusCode === null;
                                const isRetrying =
                                  retryDeliveryMutation.isPending &&
                                  retryDeliveryMutation.variables?.deliveryId === d.id;
                                const hasScheduledAutoRetry =
                                  !!d.nextRetryAt && new Date(d.nextRetryAt) > new Date();
                                return (
                                  <div
                                    key={d.id}
                                    className={`rounded border text-xs ${
                                      isFailed
                                        ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
                                        : isSuccess
                                        ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                                        : "bg-muted/50 border-border"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 px-2 py-1.5">
                                      <span
                                        className={`font-mono font-medium w-8 text-center shrink-0 ${
                                          isFailed
                                            ? "text-red-700 dark:text-red-300"
                                            : isSuccess
                                            ? "text-green-700 dark:text-green-300"
                                            : "text-muted-foreground"
                                        }`}
                                      >
                                        {d.statusCode ?? "—"}
                                      </span>
                                      <span className="font-mono text-muted-foreground flex-1 truncate">
                                        {d.event}
                                      </span>
                                      {d.attempt > 1 && (
                                        <Badge variant="outline" className="text-xs px-1 py-0 shrink-0">
                                          {t("agentKeys.webhooks.deliveries.attempt", "시도 {{n}}", { n: d.attempt })}
                                        </Badge>
                                      )}
                                      {d.latencyMs !== null && (
                                        <span className="text-muted-foreground shrink-0 tabular-nums">
                                          {d.latencyMs >= 1000
                                            ? `${(d.latencyMs / 1000).toFixed(1)}s`
                                            : `${d.latencyMs}ms`}
                                        </span>
                                      )}
                                      <span className="text-muted-foreground shrink-0">
                                        {d.createdAt
                                          ? format(new Date(d.createdAt), "MM-dd HH:mm")
                                          : "—"}
                                      </span>
                                      {d.payload && (
                                        <button
                                          onClick={togglePayload}
                                          className="shrink-0 text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                                          title={t("agentKeys.webhooks.deliveries.payloadToggle", "페이로드 보기")}
                                        >
                                          {isPayloadExpanded
                                            ? t("agentKeys.webhooks.deliveries.payloadHide", "닫기")
                                            : t("agentKeys.webhooks.deliveries.payloadShow", "Payload")}
                                        </button>
                                      )}
                                    </div>
                                    {isPayloadExpanded && d.payload && (
                                      <div className="border-t px-2 py-2">
                                        <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto bg-black/5 dark:bg-white/5 rounded p-2">
                                          {JSON.stringify(d.payload, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                    {isFailed && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="shrink-0">
                                            <button
                                              onClick={() =>
                                                retryDeliveryMutation.mutate({
                                                  keyId: webhookTarget!.id,
                                                  webhookId: deliveryWebhookId!,
                                                  deliveryId: d.id,
                                                })
                                              }
                                              disabled={isRetrying || hasScheduledAutoRetry}
                                              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                            >
                                              {isRetrying ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                              ) : (
                                                <RotateCcw className="h-3 w-3" />
                                              )}
                                              {t("agentKeys.webhooks.deliveries.retryBtn", "재시도")}
                                            </button>
                                          </span>
                                        </TooltipTrigger>
                                        {hasScheduledAutoRetry && (
                                          <TooltipContent side="top">
                                            {t(
                                              "agentKeys.webhooks.deliveries.autoRetryScheduled",
                                              "자동 재시도가 예약되어 있습니다 ({{time}})",
                                              { time: format(new Date(d.nextRetryAt!), "MM-dd HH:mm") }
                                            )}
                                          </TooltipContent>
                                        )}
                                      </Tooltip>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Revealed secret (shown once after creation) */}
          {revealedWebhookSecret && (
            <div className="space-y-2 rounded-md border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950 px-3 py-3">
              <p className="text-xs font-medium text-green-800 dark:text-green-200">
                {t("agentKeys.webhooks.secretRevealed", "웹훅 시크릿 (한 번만 표시됩니다)")}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono bg-white dark:bg-black px-2 py-1 rounded border break-all">
                  {revealedWebhookSecret.secret}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(revealedWebhookSecret.secret);
                    toast({ title: t("agentKeys.toast.copied", "클립보드에 복사되었습니다") });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-green-700 dark:text-green-300">
                {t("agentKeys.webhooks.secretHint", "이 창을 닫으면 시크릿을 다시 볼 수 없습니다. 지금 복사하세요.")}
              </p>
            </div>
          )}

          {/* Add new webhook form */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("agentKeys.webhooks.addNew", "웹훅 추가 (agent_key.low_token_rate)")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("agentKeys.webhooks.addNewHint", "URL을 입력하면 agent_key.low_token_rate 이벤트를 구독하는 웹훅이 생성됩니다.")}
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="https://your-endpoint.example.com/webhook"
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                className="flex-1 text-sm"
              />
              <Button
                size="sm"
                disabled={
                  createWebhookMutation.isPending ||
                  !newWebhookUrl.trim() ||
                  !/^https?:\/\//.test(newWebhookUrl.trim())
                }
                onClick={() =>
                  webhookTarget &&
                  createWebhookMutation.mutate({ keyId: webhookTarget.id, url: newWebhookUrl.trim() })
                }
              >
                {createWebhookMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setWebhookTarget(null);
                setNewWebhookUrl("");
                setRevealedWebhookSecret(null);
              }}
            >
              {t("common.close", "닫기")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Threshold Configuration Dialog */}
      <Dialog open={thresholdEditOpen} onOpenChange={(open) => !open && setThresholdEditOpen(false)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              {t("agentKeys.threshold.dialogTitle", "실 토큰률 경보 임계값")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "agentKeys.threshold.dialogDescription",
                "이 값(%)보다 낮은 실 토큰률이 감지되면 월 1회 알림이 생성됩니다. 최소 5건 이상의 요청이 있어야 알림이 발생합니다."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("agentKeys.threshold.inputLabel", "임계값 (%)")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">
                  {t("agentKeys.threshold.currentValue", { value: currentThreshold, defaultValue: `현재: {{value}}%` })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("agentKeys.threshold.hint", "권장값: 50% (기본값). 높이면 더 민감하게, 낮추면 덜 민감하게 동작합니다.")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("agentKeys.threshold.notificationMethod", "알림 전달 방식")}</Label>
              <Select
                value={notificationMethodInput}
                onValueChange={(v) => setNotificationMethodInput(v as "in_app" | "webhook" | "both")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_app">{t("agentKeys.threshold.method.inApp", "인앱 알림만")}</SelectItem>
                  <SelectItem value="webhook">{t("agentKeys.threshold.method.webhook", "웹훅만")}</SelectItem>
                  <SelectItem value="both">{t("agentKeys.threshold.method.both", "인앱 알림 + 웹훅")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("agentKeys.threshold.notificationHint", "웹훅 옵션은 해당 API 키에 등록된 웹훅으로 agent_key.low_token_rate 이벤트를 발송합니다.")}
              </p>
            </div>

            {(notificationMethodInput === "webhook" || notificationMethodInput === "both") && (
              <div className="space-y-2 rounded-md border p-3 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Webhook className="h-3.5 w-3.5" />
                  {t("agentKeys.threshold.webhookCoverage", "웹훅 구독 현황 (agent_key.low_token_rate)")}
                </p>
                {coverageLoading ? (
                  <div className="flex items-center gap-2 py-2 text-muted-foreground text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("agentKeys.loading", "로딩 중...")}
                  </div>
                ) : webhookCoverage.filter((item) => item.isActive).length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">
                    {t("agentKeys.threshold.noActiveKeys", "활성 API 키가 없습니다.")}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {webhookCoverage
                      .filter((item) => item.isActive)
                      .map((item) => (
                        <div key={item.keyId} className="flex items-center gap-2 text-sm">
                          <span className="font-mono text-xs text-muted-foreground shrink-0">{item.keyPrefix}…</span>
                          <span className="truncate flex-1 text-xs">{item.keyName}</span>
                          {item.hasSubscription ? (
                            <Badge
                              variant="outline"
                              className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950 shrink-0 text-xs px-1.5 py-0"
                            >
                              <Bell className="h-2.5 w-2.5 mr-1" />
                              {t("agentKeys.threshold.subscribed", "구독됨")}
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 hover:bg-amber-100 dark:hover:bg-amber-900 shrink-0"
                              onClick={() => {
                                setThresholdEditOpen(false);
                                const key = keys.find((k) => k.id === item.keyId);
                                if (key) {
                                  setWebhookTarget(key);
                                  setNewWebhookUrl("");
                                }
                              }}
                              title={t("agentKeys.threshold.goToWebhooks", "웹훅 관리로 이동")}
                            >
                              <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                              {t("agentKeys.threshold.missingSubscription", "구독 없음")}
                            </Button>
                          )}
                        </div>
                      ))}
                  </div>
                )}
                {webhookCoverage.filter((item) => item.isActive && !item.hasSubscription).length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 pt-1 border-t border-amber-200 dark:border-amber-800">
                    {t("agentKeys.threshold.coverageWarning", {
                      count: webhookCoverage.filter((item) => item.isActive && !item.hasSubscription).length,
                      defaultValue: "{{count}}개 키에 웹훅 구독이 등록되지 않아 알림이 전달되지 않을 수 있습니다.",
                    })}
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setThresholdEditOpen(false)}>
              {t("common.cancel", "취소")}
            </Button>
            <Button
              onClick={() => updateThresholdMutation.mutate({ threshold: thresholdInput, notificationMethod: notificationMethodInput })}
              disabled={updateThresholdMutation.isPending || thresholdInput < 1 || thresholdInput > 100}
            >
              {updateThresholdMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("common.saving", "저장 중...")}
                </>
              ) : (
                t("common.save", "저장")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
