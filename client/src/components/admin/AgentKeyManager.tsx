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
} from "lucide-react";
import { format } from "date-fns";
import { AGENT_API_SCOPES } from "@shared/schema";

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
}

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

  const { data: keys = [], isLoading } = useQuery<AgentApiKey[]>({
    queryKey: ["/api/admin/agent-keys"],
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t("agentKeys.title", "Agent API 키 관리")}
          </CardTitle>
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            {t("agentKeys.createKey", "새 키 생성")}
          </Button>
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
                          <div className="flex items-center justify-end gap-2">
                            {!isRevoked && (
                              <>
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
    </div>
  );
}
