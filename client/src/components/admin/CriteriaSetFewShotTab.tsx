import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, ChevronDown, ChevronUp, Brain, CheckCircle, AlertCircle, Database } from "lucide-react";

interface DimensionScoreEntry {
  key: string;
  name: string;
  score: number;
  rationale: string;
}

interface CriteriaSetFewShotExample {
  id: string;
  criteriaSetId: string;
  sourceFeedbackId: string | null;
  context: string | null;
  transcript: string;
  dimensionScores: DimensionScoreEntry[];
  isActive: boolean;
  createdAt: string;
}

interface EvaluationDimension {
  id: string;
  key: string;
  name: string;
  isActive: boolean;
}

interface InferredCriteria {
  dimensionKey: string;
  dimensionName: string;
  scoringRubric: { score: number; label: string; description: string; behaviorAnchor: string }[];
  evaluationPrompt: string;
  exampleCount: number;
}

interface FeedbackItem {
  id: string;
  overallScore: number | null;
  createdAt: string;
  conversationId: string | null;
  scores: { category: string; name: string; score: number; feedback: string }[];
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? "bg-green-100 text-green-700 border-green-200"
    : score >= 5 ? "bg-blue-100 text-blue-700 border-blue-200"
    : "bg-red-100 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded-full border text-xs font-bold ${color}`}>
      {score}
    </span>
  );
}

function ExampleCard({
  example,
  onToggleActive,
  onDelete,
}: {
  example: CriteriaSetFewShotExample;
  onToggleActive: (isActive: boolean) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={`p-3 space-y-2 border ${example.isActive ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1 mb-1">
            {example.dimensionScores.map((ds) => (
              <div key={ds.key} className="flex items-center gap-1">
                <span className="text-[10px] text-slate-500">{ds.name}</span>
                <ScoreBadge score={ds.score} />
              </div>
            ))}
          </div>
          {example.context && (
            <p className="text-xs text-slate-500 truncate">{example.context}</p>
          )}
          <p className="text-[10px] text-slate-400 mt-0.5">
            {new Date(example.createdAt).toLocaleDateString("ko-KR")}
            {example.sourceFeedbackId && <span className="ml-1 text-blue-400">[피드백에서 가져옴]</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch
            checked={example.isActive}
            onCheckedChange={onToggleActive}
            className="scale-75"
          />
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="space-y-2 pt-1 border-t border-slate-100">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">대화 전사본</p>
            <pre className="text-xs bg-slate-50 border border-slate-100 rounded p-2 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">{example.transcript}</pre>
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">차원별 점수 및 근거</p>
            {example.dimensionScores.map((ds) => (
              <div key={ds.key} className="bg-slate-50 border border-slate-100 rounded p-2 space-y-0.5">
                <div className="flex items-center gap-2">
                  <ScoreBadge score={ds.score} />
                  <span className="text-xs font-medium text-slate-700">{ds.name}</span>
                </div>
                {ds.rationale && (
                  <p className="text-xs text-slate-500 ml-0.5">{ds.rationale}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

interface DimensionScoreFormField {
  key: string;
  name: string;
  score: string;
  rationale: string;
}

function AddExampleForm({
  dimensions,
  criteriaSetId,
  onSuccess,
  onCancel,
}: {
  dimensions: EvaluationDimension[];
  criteriaSetId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const activeDims = dimensions.filter((d) => d.isActive);

  const [transcript, setTranscript] = useState("");
  const [context, setContext] = useState("");
  const [dimScores, setDimScores] = useState<DimensionScoreFormField[]>(
    activeDims.map((d) => ({ key: d.key, name: d.name, score: "", rationale: "" }))
  );

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/admin/evaluation-criteria/${criteriaSetId}/set-few-shot-examples`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/evaluation-criteria", criteriaSetId, "set-few-shot-examples"] });
      toast({ title: "채점 예시가 저장되었습니다" });
      onSuccess();
    },
    onError: (err: any) => {
      toast({ title: "저장 실패", description: err.message, variant: "destructive" });
    },
  });

  function updateDimScore(key: string, field: 'score' | 'rationale', value: string) {
    setDimScores((prev) => prev.map((d) => d.key === key ? { ...d, [field]: value } : d));
  }

  const allScoresValid = dimScores.every((d) => {
    const n = parseInt(d.score, 10);
    return !isNaN(n) && n >= 1 && n <= 10;
  });
  const canSave = transcript.trim() && allScoresValid;

  function handleSave() {
    const dimensionScores = dimScores.map((d) => ({
      key: d.key,
      name: d.name,
      score: parseInt(d.score, 10),
      rationale: d.rationale.trim(),
    }));
    createMutation.mutate({
      transcript: transcript.trim(),
      context: context.trim() || null,
      dimensionScores,
    });
  }

  return (
    <Card className="p-4 space-y-3 border-blue-200 bg-blue-50/30">
      <p className="text-xs font-semibold text-slate-700">직접 입력</p>
      <div>
        <Label className="text-xs text-slate-600">시나리오 컨텍스트 (선택)</Label>
        <Input
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="시나리오 상황이나 제목 (선택)"
          className="h-8 text-sm mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-slate-600">대화 전사본 *</Label>
        <Textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={"사용자: 안녕하세요.\nAI: 반갑습니다.\n사용자: ..."}
          className="text-xs mt-1 font-mono min-h-[120px]"
          rows={8}
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-slate-600">차원별 점수 및 근거 *</Label>
        {dimScores.map((d) => {
          const scoreNum = parseInt(d.score, 10);
          const isValid = d.score === "" || (!isNaN(scoreNum) && scoreNum >= 1 && scoreNum <= 10);
          return (
            <div key={d.key} className="bg-white border border-slate-200 rounded-md p-2.5 space-y-1.5">
              <span className="text-xs font-medium text-slate-700">{d.name}</span>
              <div className="flex gap-2">
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={d.score}
                    onChange={(e) => updateDimScore(d.key, 'score', e.target.value)}
                    placeholder="1-10"
                    className={`h-7 text-sm ${!isValid && d.score ? 'border-red-400' : ''}`}
                  />
                </div>
                <Textarea
                  value={d.rationale}
                  onChange={(e) => updateDimScore(d.key, 'rationale', e.target.value)}
                  placeholder="채점 근거 (선택)"
                  className="text-xs min-h-[28px] resize-none"
                  rows={1}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          취소
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSave}
          disabled={!canSave || createMutation.isPending}
        >
          {createMutation.isPending ? "저장 중..." : "저장"}
        </Button>
      </div>
    </Card>
  );
}

function FeedbackPickerDialog({
  open,
  onClose,
  dimensions,
  criteriaSetId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  dimensions: EvaluationDimension[];
  criteriaSetId: string;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: feedbacks = [], isLoading } = useQuery<FeedbackItem[]>({
    queryKey: ["/api/admin/feedbacks", criteriaSetId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/feedbacks?criteriaSetId=${encodeURIComponent(criteriaSetId)}`);
      return res.json();
    },
    enabled: open,
    staleTime: 30000,
  });

  const importMutation = useMutation({
    mutationFn: async (feedbackId: string) => {
      const res = await apiRequest("POST", `/api/admin/evaluation-criteria/${criteriaSetId}/set-few-shot-examples/from-feedback`, { feedbackId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/evaluation-criteria", criteriaSetId, "set-few-shot-examples"] });
      toast({ title: "피드백에서 예시가 가져와졌습니다" });
      onImported();
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "가져오기 실패", description: err.message, variant: "destructive" });
    },
  });

  // Backend scopes by rubricSnapshot.id — all returned feedbacks are already compatible
  const compatibleFeedbacks = feedbacks;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-full max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>피드백에서 예시 가져오기</DialogTitle>
          <DialogDescription className="text-xs">
            완료된 롤플레이 피드백을 선택하면 대화 내역과 차원별 점수가 자동으로 채워집니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-2 mt-2">
          {isLoading ? (
            <p className="text-xs text-slate-400 py-4 text-center">불러오는 중...</p>
          ) : compatibleFeedbacks.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-sm">
              <AlertCircle className="h-5 w-5 mx-auto mb-2 text-slate-300" />
              현재 세트의 차원과 일치하는 피드백이 없습니다.
            </div>
          ) : (
            compatibleFeedbacks.map((f) => {
              const matchingScores = f.scores || [];
              return (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-white hover:bg-slate-50 cursor-pointer"
                  onClick={() => !importMutation.isPending && importMutation.mutate(f.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {f.overallScore != null && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          총점 {f.overallScore}
                        </Badge>
                      )}
                      <span className="text-[10px] text-slate-400">
                        {new Date(f.createdAt).toLocaleDateString("ko-KR")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {matchingScores.slice(0, 5).map((s) => (
                        <span key={s.category} className="text-[10px] text-slate-500">
                          {s.name || s.category}: <strong>{Math.round(s.score)}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    disabled={importMutation.isPending}
                    onClick={(e) => { e.stopPropagation(); importMutation.mutate(f.id); }}
                  >
                    가져오기
                  </Button>
                </div>
              );
            })
          )}
        </div>
        <DialogFooter className="mt-2">
          <Button variant="outline" size="sm" onClick={onClose}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InferPreviewDialog({
  open,
  results,
  onClose,
  onApply,
  isApplying,
}: {
  open: boolean;
  results: InferredCriteria[];
  onClose: () => void;
  onApply: () => void;
  isApplying: boolean;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="w-full max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600" />
            역산된 차원 기준 미리보기
          </DialogTitle>
          <DialogDescription className="text-xs">
            AI가 채점 예시를 분석해 생성한 루브릭과 평가 프롬프트입니다. 검토 후 적용하면 차원의 기준이 업데이트됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 mt-2">
          {results.map((r) => (
            <Card key={r.dimensionKey} className="p-3 border-slate-200">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedKey(expandedKey === r.dimensionKey ? null : r.dimensionKey)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-slate-800">{r.dimensionName}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-slate-500">
                    예시 {r.exampleCount}개 기반
                  </Badge>
                </div>
                {expandedKey === r.dimensionKey
                  ? <ChevronUp className="h-4 w-4 text-slate-400" />
                  : <ChevronDown className="h-4 w-4 text-slate-400" />
                }
              </div>
              {expandedKey === r.dimensionKey && (
                <div className="mt-3 space-y-2">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">루브릭 앵커</p>
                    <div className="space-y-1.5">
                      {r.scoringRubric.map((rub) => (
                        <div key={rub.score} className="flex gap-2 text-xs bg-slate-50 border border-slate-100 rounded p-2">
                          <span className="font-mono text-slate-500 shrink-0 w-5">{rub.score}점</span>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-slate-700">{rub.label}</span>
                            {rub.behaviorAnchor && (
                              <p className="text-slate-500 mt-0.5">{rub.behaviorAnchor}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {r.evaluationPrompt && (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">평가 판단 프롬프트</p>
                      <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded p-2">{r.evaluationPrompt}</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
        <DialogFooter className="mt-3 gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>취소</Button>
          <Button
            size="sm"
            onClick={onApply}
            disabled={isApplying}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
            {isApplying ? "적용 중..." : "차원 기준에 적용"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CriteriaSetFewShotTab({
  criteriaSetId,
  dimensions,
}: {
  criteriaSetId: string;
  dimensions: EvaluationDimension[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showFeedbackPicker, setShowFeedbackPicker] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [inferResults, setInferResults] = useState<InferredCriteria[] | null>(null);
  const [isInferring, setIsInferring] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const queryKey = ["/api/admin/evaluation-criteria", criteriaSetId, "set-few-shot-examples"];

  const { data: examples = [], isLoading } = useQuery<CriteriaSetFewShotExample[]>({
    queryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/evaluation-criteria/${criteriaSetId}/set-few-shot-examples`);
      return res.json();
    },
    enabled: !!criteriaSetId,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/evaluation-criteria/set-few-shot-examples/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: any) => {
      toast({ title: "업데이트 실패", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/evaluation-criteria/set-few-shot-examples/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "예시가 삭제되었습니다" });
      setDeleteTargetId(null);
    },
    onError: (err: any) => {
      toast({ title: "삭제 실패", description: err.message, variant: "destructive" });
    },
  });

  const activeCount = examples.filter((e) => e.isActive).length;

  async function handleInfer() {
    setIsInferring(true);
    try {
      const res = await apiRequest("POST", `/api/admin/evaluation-criteria/${criteriaSetId}/infer-dimension-criteria`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || res.statusText);
      }
      const results = await res.json();
      setInferResults(results);
    } catch (err: any) {
      toast({ title: "분석 실패", description: err.message, variant: "destructive" });
    } finally {
      setIsInferring(false);
    }
  }

  async function handleApply() {
    if (!inferResults) return;
    setIsApplying(true);
    try {
      const res = await apiRequest("POST", `/api/admin/evaluation-criteria/${criteriaSetId}/apply-inferred-criteria`, { criteria: inferResults });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || res.statusText);
      }
      await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/evaluation-criteria"] });
      toast({ title: "차원 기준이 업데이트되었습니다", description: "생성된 루브릭과 평가 프롬프트가 각 차원에 적용되었습니다." });
      setInferResults(null);
    } catch (err: any) {
      toast({ title: "적용 실패", description: err.message, variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-500">
            (대화 내역, 차원별 점수) 예시를 등록하면 AI가 패턴을 역산해 루브릭·평가 기준을 자동 생성합니다.
            예시를 추가할수록 정밀도가 높아집니다.
          </p>
          {activeCount > 0 && (
            <p className="text-[11px] text-green-600 mt-0.5">
              활성 예시 {activeCount}개 등록됨
            </p>
          )}
        </div>
        <Button
          size="sm"
          className="h-7 text-xs shrink-0 bg-purple-600 hover:bg-purple-700 text-white"
          onClick={handleInfer}
          disabled={isInferring || activeCount === 0}
        >
          <Brain className="h-3.5 w-3.5 mr-1.5" />
          {isInferring ? "분석 중..." : "채점 로직 분석 → 차원 기준 생성"}
        </Button>
      </div>

      {activeCount === 0 && !isLoading && examples.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          아직 등록된 예시가 없습니다. 예시를 등록하면 "채점 로직 분석" 버튼을 사용할 수 있습니다.
        </div>
      )}

      {/* Add buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => { setShowAddForm((v) => !v); }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          직접 입력 추가
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setShowFeedbackPicker(true)}
        >
          <Database className="h-3.5 w-3.5 mr-1" />
          기존 피드백에서 가져오기
        </Button>
      </div>

      {/* Inline add form */}
      {showAddForm && (
        <AddExampleForm
          dimensions={dimensions}
          criteriaSetId={criteriaSetId}
          onSuccess={() => setShowAddForm(false)}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Example list */}
      {isLoading ? (
        <p className="text-xs text-slate-400 py-4 text-center">불러오는 중...</p>
      ) : examples.length === 0 ? null : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">
            저장된 예시 ({examples.length}개)
            {activeCount > 0 && (
              <span className="ml-1.5 text-green-600">({activeCount}개 활성)</span>
            )}
          </p>
          {examples.map((ex) => (
            <ExampleCard
              key={ex.id}
              example={ex}
              onToggleActive={(isActive) => toggleMutation.mutate({ id: ex.id, isActive })}
              onDelete={() => setDeleteTargetId(ex.id)}
            />
          ))}
        </div>
      )}

      {/* Feedback picker dialog */}
      <FeedbackPickerDialog
        open={showFeedbackPicker}
        onClose={() => setShowFeedbackPicker(false)}
        dimensions={dimensions}
        criteriaSetId={criteriaSetId}
        onImported={() => {}}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>예시 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 채점 예시를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTargetId && deleteMutation.mutate(deleteTargetId)}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Infer preview dialog */}
      {inferResults && (
        <InferPreviewDialog
          open={true}
          results={inferResults}
          onClose={() => setInferResults(null)}
          onApply={handleApply}
          isApplying={isApplying}
        />
      )}
    </div>
  );
}
