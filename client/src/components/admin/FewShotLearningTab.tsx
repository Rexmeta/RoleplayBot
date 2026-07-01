import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Plus, Trash2, Upload, ChevronDown, ChevronUp, Edit2, X, Check, FileJson } from "lucide-react";

interface FewShotExample {
  id: string;
  dimensionId: string;
  context: string | null;
  transcript: string;
  score: number;
  rationale: string;
  isActive: boolean;
  createdAt: string;
}

interface DraftCard {
  id: string;
  fileName?: string;
  context: string;
  transcript: string;
  score: string;
  rationale: string;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? "bg-green-100 text-green-700 border-green-200"
    : score >= 5 ? "bg-blue-100 text-blue-700 border-blue-200"
    : "bg-red-100 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full border text-sm font-bold ${color}`}>
      {score}
    </span>
  );
}

function DraftCardEditor({
  draft,
  onSave,
  onCancel,
  isSaving,
  onChange,
}: {
  draft: DraftCard;
  onSave: (draft: DraftCard) => void;
  onCancel: () => void;
  isSaving: boolean;
  onChange: (updated: DraftCard) => void;
}) {
  const scoreNum = parseInt(draft.score, 10);
  const isScoreValid = !isNaN(scoreNum) && scoreNum >= 1 && scoreNum <= 10;
  const canSave = draft.transcript.trim() && draft.rationale.trim() && isScoreValid;

  return (
    <Card className="p-4 space-y-3 border-slate-200 bg-white">
      {draft.fileName && (
        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <Upload className="h-3.5 w-3.5" />
          {draft.fileName}
        </div>
      )}
      <div>
        <Label className="text-xs text-slate-600">컨텍스트 (선택)</Label>
        <Input
          value={draft.context}
          onChange={(e) => onChange({ ...draft, context: e.target.value })}
          placeholder="이 예시가 적용되는 상황이나 시나리오 설명 (선택 사항)"
          className="h-8 text-sm mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-slate-600">대화 전사본 *</Label>
        <Textarea
          value={draft.transcript}
          onChange={(e) => onChange({ ...draft, transcript: e.target.value })}
          placeholder={"사용자: 안녕하세요.\nAI: 반갑습니다.\n사용자: ..."}
          className="text-xs mt-1 font-mono min-h-[140px]"
          rows={12}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-slate-600">점수 (1–10) *</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={draft.score}
            onChange={(e) => onChange({ ...draft, score: e.target.value })}
            className={`h-8 text-sm mt-1 ${!isScoreValid && draft.score ? "border-red-400" : ""}`}
            placeholder="예: 7"
          />
        </div>
        <div className="flex flex-col justify-end">
          {!isScoreValid && draft.score && (
            <p className="text-xs text-red-500">1–10 사이 정수를 입력하세요</p>
          )}
        </div>
      </div>
      <div>
        <Label className="text-xs text-slate-600">채점 근거 *</Label>
        <Textarea
          value={draft.rationale}
          onChange={(e) => onChange({ ...draft, rationale: e.target.value })}
          placeholder="이 점수를 부여한 이유를 구체적으로 설명하세요"
          className="text-xs mt-1 min-h-[64px]"
          rows={3}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">
          <X className="h-3.5 w-3.5 mr-1" />
          취소
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(draft)}
          disabled={!canSave || isSaving}
          className="h-7 text-xs"
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {isSaving ? "저장 중..." : "저장"}
        </Button>
      </div>
    </Card>
  );
}

function SavedExampleCard({
  example,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  example: FewShotExample;
  onToggleActive: (isActive: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={`p-3 space-y-2 border ${example.isActive ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
      <div className="flex items-center gap-2">
        <ScoreBadge score={example.score} />
        <div className="flex-1 min-w-0">
          {example.context && (
            <p className="text-xs text-slate-500 truncate">{example.context}</p>
          )}
          <p className="text-xs text-slate-400 mt-0.5">
            {new Date(example.createdAt).toLocaleDateString("ko-KR")}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch
            checked={example.isActive}
            onCheckedChange={onToggleActive}
            className="scale-75"
          />
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}>
            <Edit2 className="h-3.5 w-3.5 text-slate-500" />
          </Button>
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
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">채점 근거</p>
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded p-2">{example.rationale}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

type ImportRow = { context?: string | null; transcript: string; score: string | number; rationale: string };

async function parseJsonFile(file: File): Promise<ImportRow[]> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("JSON 파일은 배열이어야 합니다");
  return parsed as ImportRow[];
}

export function FewShotLearningTab({ dimensionId }: { dimensionId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftCard | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const queryKey = ["/api/evaluation-dimensions", dimensionId, "few-shot-examples"];

  const { data: examples = [], isLoading } = useQuery<FewShotExample[]>({
    queryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/evaluation-dimensions/${dimensionId}/few-shot-examples`);
      return res.json();
    },
    enabled: !!dimensionId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { context: string | null; transcript: string; score: number; rationale: string }) => {
      const res = await apiRequest("POST", `/api/evaluation-dimensions/${dimensionId}/few-shot-examples`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "예시가 저장되었습니다" });
    },
    onError: (error: any) => {
      toast({ title: "저장 실패", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<FewShotExample> }) => {
      const res = await apiRequest("PATCH", `/api/few-shot-examples/${id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: any) => {
      toast({ title: "업데이트 실패", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/few-shot-examples/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "예시가 삭제되었습니다" });
      setDeleteTargetId(null);
    },
    onError: (error: any) => {
      toast({ title: "삭제 실패", description: error.message, variant: "destructive" });
    },
  });

  async function handleImportFile(file: File) {
    setIsImporting(true);
    try {
      const url = `/api/evaluation-dimensions/${dimensionId}/few-shot-examples/bulk`;
      let res: Response;

      if (file.name.endsWith(".csv")) {
        const formData = new FormData();
        formData.append("file", file);
        const token = localStorage.getItem("authToken");
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        res = await fetch(url, {
          method: "POST",
          headers,
          body: formData,
          credentials: "include",
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ message: res.statusText }));
          throw new Error(errBody.message ?? res.statusText);
        }
      } else if (file.name.endsWith(".json")) {
        const rows = await parseJsonFile(file);
        res = await apiRequest("POST", url, rows);
      } else {
        throw new Error("지원하지 않는 파일 형식입니다 (.json 또는 .csv)");
      }

      const data = await res.json();
      queryClient.invalidateQueries({ queryKey });
      const errorLines =
        data.errors?.length > 0
          ? data.errors
              .slice(0, 3)
              .map((e: any) => `행 ${e.row}: ${e.message}`)
              .join("\n") + (data.errors.length > 3 ? `\n외 ${data.errors.length - 3}건` : "")
          : undefined;
      toast({
        title: `${data.created}개 예시가 가져와졌습니다`,
        description: errorLines,
        variant: data.created === 0 ? "destructive" : "default",
      });
    } catch (err: any) {
      toast({ title: "가져오기 실패", description: err.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
      if (importFileInputRef.current) importFileInputRef.current.value = "";
    }
  }

  function addBlankDraft() {
    const id = Math.random().toString(36).slice(2);
    setDrafts((prev) => [...prev, { id, context: "", transcript: "", score: "", rationale: "" }]);
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files) return;
    const newDrafts: DraftCard[] = [];
    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".txt")) continue;
      const text = await file.text();
      newDrafts.push({
        id: Math.random().toString(36).slice(2),
        fileName: file.name,
        context: "",
        transcript: text,
        score: "",
        rationale: "",
      });
    }
    if (newDrafts.length > 0) {
      setDrafts((prev) => [...prev, ...newDrafts]);
    }
  }

  async function handleSaveDraft(draft: DraftCard) {
    setSavingDraftId(draft.id);
    try {
      await createMutation.mutateAsync({
        context: draft.context.trim() || null,
        transcript: draft.transcript.trim(),
        score: parseInt(draft.score, 10),
        rationale: draft.rationale.trim(),
      });
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    } finally {
      setSavingDraftId(null);
    }
  }

  function updateDraft(updated: DraftCard) {
    setDrafts((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }

  function handleStartEdit(example: FewShotExample) {
    setEditingId(example.id);
    setEditDraft({
      id: example.id,
      context: example.context || "",
      transcript: example.transcript,
      score: String(example.score),
      rationale: example.rationale,
    });
  }

  async function handleSaveEdit(draft: DraftCard) {
    if (!editingId) return;
    setSavingDraftId(editingId);
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        patch: {
          context: draft.context.trim() || null,
          transcript: draft.transcript.trim(),
          score: parseInt(draft.score, 10),
          rationale: draft.rationale.trim(),
        },
      });
      setEditingId(null);
      setEditDraft(null);
      toast({ title: "예시가 수정되었습니다" });
    } finally {
      setSavingDraftId(null);
    }
  }

  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">
            실제 채점 예시를 등록하면 AI 평가 시 참조됩니다. 활성화된 예시만 프롬프트에 주입됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => importFileInputRef.current?.click()}
            disabled={isImporting}
            className="h-7 text-xs"
          >
            <FileJson className="h-3.5 w-3.5 mr-1" />
            {isImporting ? "가져오는 중..." : "JSON/CSV 가져오기"}
          </Button>
          <Button variant="outline" size="sm" onClick={addBlankDraft} className="h-7 text-xs">
            <Plus className="h-3.5 w-3.5 mr-1" />
            직접 입력 추가
          </Button>
        </div>
      </div>
      <input
        ref={importFileInputRef}
        type="file"
        accept=".json,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
        }}
      />

      {/* Drag-and-drop upload zone */}
      <div
        className={`border-2 border-dashed rounded-lg px-4 py-5 text-center cursor-pointer transition-colors ${
          isDragOver ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleFilesSelected(e.dataTransfer.files);
        }}
      >
        <Upload className="h-5 w-5 text-slate-400 mx-auto mb-1.5" />
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-700">.txt 파일을 드래그 또는 클릭하여 업로드</span>
          <br />
          파일 내용이 대화 전사본으로 자동 입력됩니다
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt"
          multiple
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
      </div>

      {/* Draft cards */}
      {drafts.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-500">임시 저장 카드</p>
          {drafts.map((draft) => (
            <DraftCardEditor
              key={draft.id}
              draft={draft}
              onChange={updateDraft}
              onSave={handleSaveDraft}
              onCancel={() => setDrafts((prev) => prev.filter((d) => d.id !== draft.id))}
              isSaving={savingDraftId === draft.id}
            />
          ))}
        </div>
      )}

      {/* Saved examples */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-500">
          저장된 예시 ({examples.length}개)
          {examples.filter((e) => e.isActive).length > 0 && (
            <span className="ml-1.5 text-green-600">
              ({examples.filter((e) => e.isActive).length}개 활성)
            </span>
          )}
        </p>

        {isLoading && (
          <p className="text-xs text-slate-400 py-2 text-center">불러오는 중...</p>
        )}

        {!isLoading && examples.length === 0 && (
          <div className="py-6 text-center text-slate-400 text-xs border border-dashed rounded-lg">
            등록된 예시가 없습니다. 위에서 추가하세요.
          </div>
        )}

        {examples.map((example) => (
          editingId === example.id && editDraft ? (
            <DraftCardEditor
              key={example.id}
              draft={editDraft}
              onChange={setEditDraft}
              onSave={handleSaveEdit}
              onCancel={() => { setEditingId(null); setEditDraft(null); }}
              isSaving={savingDraftId === example.id}
            />
          ) : (
            <SavedExampleCard
              key={example.id}
              example={example}
              onToggleActive={(isActive) => updateMutation.mutate({ id: example.id, patch: { isActive } })}
              onEdit={() => handleStartEdit(example)}
              onDelete={() => setDeleteTargetId(example.id)}
            />
          )
        ))}
      </div>

      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>예시 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 작업은 되돌릴 수 없습니다. 정말로 삭제하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTargetId) deleteMutation.mutate(deleteTargetId); }}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending ? "삭제 중..." : "삭제"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
