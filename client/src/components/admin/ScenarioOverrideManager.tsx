import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Trash2, Plus, Save, X } from "lucide-react";

const overrideFormSchema = z.object({
  terminologyKey: z.string().optional(),
  terminologyValue: z.string().optional(),
  policyConstraint: z.string().optional(),
  forbiddenPhrase: z.string().optional(),
  customIncident: z.string().optional(),
  weightKey: z.enum(["clarity", "empathy", "logic", "ownership", "actionPlan"]).optional(),
  weightValue: z.number().min(0).max(10).optional(),
});

type OverrideFormValues = z.infer<typeof overrideFormSchema>;

interface ScenarioOverrideData {
  terminology?: Record<string, string>;
  policyConstraints?: string[];
  forbiddenPhrases?: string[];
  evaluationWeights?: Partial<Record<string, number>>;
  customIncidents?: string[];
}

export function ScenarioOverrideManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>("");
  const [localOverride, setLocalOverride] = useState<ScenarioOverrideData>({});

  const form = useForm<OverrideFormValues>({
    resolver: zodResolver(overrideFormSchema),
    defaultValues: {},
  });

  const { data: organizations = [] } = useQuery<any[]>({ queryKey: ["/api/admin/organizations"] });
  const { data: scenarios = [] } = useQuery<any[]>({ queryKey: ["/api/scenarios"] });

  const overrideKey = selectedOrgId && selectedScenarioId
    ? ["/api/admin/scenario-overrides", selectedOrgId, selectedScenarioId]
    : null;

  const { data: existingOverride } = useQuery<ScenarioOverrideData | null>({
    queryKey: overrideKey ?? ["__disabled__"],
    enabled: !!overrideKey,
    select: (data: any) => (data ? (data.override ?? data) : null),
  });

  const upsertMutation = useMutation({
    mutationFn: async (data: ScenarioOverrideData) =>
      apiRequest("PUT", `/api/admin/scenario-overrides/${selectedOrgId}/${selectedScenarioId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scenario-overrides"] });
      toast({ title: "Override 저장 완료", description: "시나리오 설정이 저장되었습니다." });
    },
    onError: (err: any) => toast({ title: "저장 실패", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () =>
      apiRequest("DELETE", `/api/admin/scenario-overrides/${selectedOrgId}/${selectedScenarioId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scenario-overrides"] });
      setLocalOverride({});
      toast({ title: "Override 삭제 완료" });
    },
    onError: (err: any) => toast({ title: "삭제 실패", description: err.message, variant: "destructive" }),
  });

  const currentOverride: ScenarioOverrideData = Object.keys(localOverride).length > 0
    ? localOverride
    : (existingOverride ?? {});

  const handleOrgScenarioChange = (orgId: string, scenarioId: string) => {
    setSelectedOrgId(orgId);
    setSelectedScenarioId(scenarioId);
    setLocalOverride({});
  };

  const addTerminology = () => {
    const key = form.getValues("terminologyKey")?.trim();
    const val = form.getValues("terminologyValue")?.trim();
    if (!key || !val) return;
    setLocalOverride(prev => ({
      ...prev,
      terminology: { ...(prev.terminology ?? {}), [key]: val },
    }));
    form.resetField("terminologyKey");
    form.resetField("terminologyValue");
  };

  const removeTerminology = (key: string) => {
    setLocalOverride(prev => {
      const next = { ...(prev.terminology ?? {}) };
      delete next[key];
      return { ...prev, terminology: next };
    });
  };

  const addListItem = (field: "policyConstraints" | "forbiddenPhrases" | "customIncidents", formField: keyof OverrideFormValues) => {
    const val = (form.getValues(formField) as string)?.trim();
    if (!val) return;
    setLocalOverride(prev => ({
      ...prev,
      [field]: [...(prev[field] ?? []), val],
    }));
    form.resetField(formField);
  };

  const removeListItem = (field: "policyConstraints" | "forbiddenPhrases" | "customIncidents", index: number) => {
    setLocalOverride(prev => ({
      ...prev,
      [field]: (prev[field] ?? []).filter((_, i) => i !== index),
    }));
  };

  const addWeight = () => {
    const key = form.getValues("weightKey");
    const val = form.getValues("weightValue");
    if (!key || val === undefined) return;
    setLocalOverride(prev => ({
      ...prev,
      evaluationWeights: { ...(prev.evaluationWeights ?? {}), [key]: val },
    }));
    form.resetField("weightKey");
    form.resetField("weightValue");
  };

  const removeWeight = (key: string) => {
    setLocalOverride(prev => {
      const next = { ...(prev.evaluationWeights ?? {}) };
      delete next[key];
      return { ...prev, evaluationWeights: next };
    });
  };

  const handleSave = () => {
    if (!selectedOrgId || !selectedScenarioId) {
      toast({ title: "조직과 시나리오를 선택해주세요", variant: "destructive" });
      return;
    }
    upsertMutation.mutate(currentOverride);
  };

  const dimensionLabels: Record<string, string> = {
    clarity: "명확성(clarity)",
    empathy: "공감(empathy)",
    logic: "논리(logic)",
    ownership: "책임감(ownership)",
    actionPlan: "실행계획(actionPlan)",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">조직별 시나리오 Override</h2>
        <p className="text-sm text-muted-foreground">
          조직마다 시나리오의 용어, 정책 제약, 금지 표현, 평가 가중치를 맞춤 설정합니다.
          설정이 없는 조직은 기본 시나리오 설정을 사용합니다.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">조직 및 시나리오 선택</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-1 block">조직</label>
            <Select value={selectedOrgId} onValueChange={v => handleOrgScenarioChange(v, selectedScenarioId)}>
              <SelectTrigger>
                <SelectValue placeholder="조직 선택..." />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((org: any) => (
                  <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-1 block">시나리오</label>
            <Select value={selectedScenarioId} onValueChange={v => handleOrgScenarioChange(selectedOrgId, v)}>
              <SelectTrigger>
                <SelectValue placeholder="시나리오 선택..." />
              </SelectTrigger>
              <SelectContent>
                {scenarios.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedOrgId && selectedScenarioId && (
        <Form {...form}>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">용어 교체 (Terminology)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(currentOverride.terminology ?? {}).map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="flex items-center gap-1 text-sm py-1">
                      <span className="font-medium">{k}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{v}</span>
                      <button onClick={() => removeTerminology(k)} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <FormField control={form.control} name="terminologyKey" render={({ field }) => (
                    <FormItem className="flex-1 min-w-[120px]">
                      <FormControl>
                        <Input placeholder="원래 용어" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="terminologyValue" render={({ field }) => (
                    <FormItem className="flex-1 min-w-[120px]">
                      <FormControl>
                        <Input placeholder="대체 용어" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="button" variant="outline" size="sm" onClick={addTerminology}>
                    <Plus className="h-4 w-4 mr-1" />추가
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">정책 제약 (Policy Constraints)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  {(currentOverride.policyConstraints ?? []).map((item, i) => (
                    <div key={i} className="flex items-start gap-2 bg-muted/40 rounded px-3 py-2">
                      <span className="flex-1 text-sm">{item}</span>
                      <button onClick={() => removeListItem("policyConstraints", i)} className="hover:text-destructive mt-0.5">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <FormField control={form.control} name="policyConstraint" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input placeholder="정책 제약 사항 입력..." {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <Button type="button" variant="outline" size="sm" onClick={() => addListItem("policyConstraints", "policyConstraint")}>
                    <Plus className="h-4 w-4 mr-1" />추가
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">금지 표현 (Forbidden Phrases)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(currentOverride.forbiddenPhrases ?? []).map((item, i) => (
                    <Badge key={i} variant="destructive" className="flex items-center gap-1">
                      <span>"{item}"</span>
                      <button onClick={() => removeListItem("forbiddenPhrases", i)} className="ml-1">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <FormField control={form.control} name="forbiddenPhrase" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input placeholder="금지 표현 입력..." {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <Button type="button" variant="outline" size="sm" onClick={() => addListItem("forbiddenPhrases", "forbiddenPhrase")}>
                    <Plus className="h-4 w-4 mr-1" />추가
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">평가 가중치 (Evaluation Weights)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(currentOverride.evaluationWeights ?? {}).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="flex items-center gap-1 text-sm py-1">
                      <span>{dimensionLabels[k] ?? k}</span>
                      <span className="font-semibold text-primary ml-1">{v}</span>
                      <button onClick={() => removeWeight(k)} className="ml-1 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap items-end">
                  <FormField control={form.control} name="weightKey" render={({ field }) => (
                    <FormItem className="flex-1 min-w-[160px]">
                      <FormLabel>평가 항목</FormLabel>
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="항목 선택..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.entries(dimensionLabels).map(([k, label]) => (
                            <SelectItem key={k} value={k}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="weightValue" render={({ field }) => (
                    <FormItem className="w-24">
                      <FormLabel>가중치 (0-10)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          step={0.5}
                          placeholder="5"
                          {...field}
                          value={field.value ?? ""}
                          onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                        />
                      </FormControl>
                    </FormItem>
                  )} />
                  <Button type="button" variant="outline" size="sm" className="mb-0.5" onClick={addWeight}>
                    <Plus className="h-4 w-4 mr-1" />추가
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">커스텀 인시던트 (Custom Incidents)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  {(currentOverride.customIncidents ?? []).map((item, i) => (
                    <div key={i} className="flex items-start gap-2 bg-muted/40 rounded px-3 py-2">
                      <span className="flex-1 text-sm">{item}</span>
                      <button onClick={() => removeListItem("customIncidents", i)} className="hover:text-destructive mt-0.5">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <FormField control={form.control} name="customIncident" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input placeholder="커스텀 인시던트 입력..." {...field} value={field.value ?? ""} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <Button type="button" variant="outline" size="sm" onClick={() => addListItem("customIncidents", "customIncident")}>
                    <Plus className="h-4 w-4 mr-1" />추가
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Separator />

            <div className="flex gap-3 justify-end">
              {existingOverride && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Override 삭제
                </Button>
              )}
              <Button
                type="button"
                onClick={handleSave}
                disabled={upsertMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {upsertMutation.isPending ? "저장 중..." : "저장"}
              </Button>
            </div>
          </div>
        </Form>
      )}
    </div>
  );
}
