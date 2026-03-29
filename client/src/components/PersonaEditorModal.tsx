import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import { useUpload } from "@/hooks/use-upload";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  X, Camera, ImageIcon, Plus, Sparkles,
  ChevronUp, ChevronDown, Globe, Lock, Wand2, Loader2, RefreshCw
} from "lucide-react";

export interface PersonaEditData {
  id: string;
  name: string;
  description: string;
  greeting: string;
  avatarUrl: string | null;
  expressions?: Record<string, string> | null;
  personality: { traits: string[]; communicationStyle: string; background: string; speechStyle: string } | null;
  tags: string[];
  isPublic: boolean;
  [key: string]: any;
}

interface EditorForm {
  name: string; description: string; greeting: string;
  communicationStyle: string; background: string; speechStyle: string;
  traits: string; tags: string; isPublic: boolean;
}
const EMPTY_FORM: EditorForm = {
  name: "", description: "", greeting: "", communicationStyle: "",
  background: "", speechStyle: "", traits: "", tags: "", isPublic: false,
};

export const EXPRESSION_KEYS = [
  { key: 'neutral', label: '중립', emoji: '😐' },
  { key: 'happy', label: '기쁨', emoji: '😊' },
  { key: 'sad', label: '슬픔', emoji: '😢' },
  { key: 'angry', label: '분노', emoji: '😠' },
  { key: 'surprised', label: '놀람', emoji: '😲' },
  { key: 'curious', label: '호기심', emoji: '🤔' },
  { key: 'anxious', label: '불안', emoji: '😰' },
  { key: 'tired', label: '피로', emoji: '😩' },
  { key: 'disappointed', label: '실망', emoji: '😞' },
  { key: 'confused', label: '당혹', emoji: '😕' },
];

export default function PersonaEditorModal({ persona, onClose, onSaved }: {
  persona: PersonaEditData | null;
  onClose: () => void;
  onSaved: (p: PersonaEditData) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const expressionInputRef = useRef<HTMLInputElement>(null);
  const uploadingEmotionRef = useRef<string | null>(null);
  const { uploadFile, isUploading } = useUpload();

  const [avatarUrl, setAvatarUrl] = useState<string | null>(persona?.avatarUrl || null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    persona?.avatarUrl ? toMediaUrl(persona.avatarUrl) : null
  );

  const [expressions, setExpressions] = useState<Record<string, string>>(
    persona?.expressions || {}
  );
  const [expressionPreviews, setExpressionPreviews] = useState<Record<string, string>>(() => {
    if (!persona?.expressions) return {};
    const previews: Record<string, string> = {};
    for (const [k, v] of Object.entries(persona.expressions)) {
      previews[k] = toMediaUrl(v);
    }
    return previews;
  });
  const [uploadingEmotion, setUploadingEmotion] = useState<string | null>(null);
  const [showExpressions, setShowExpressions] = useState(
    !!(persona?.expressions && Object.keys(persona.expressions).length > 0)
  );

  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingExpressions, setIsGeneratingExpressions] = useState(false);
  const [expressionProgress, setExpressionProgress] = useState<{ done: number; total: number } | null>(null);
  const [generatingExpressionKey, setGeneratingExpressionKey] = useState<string | null>(null);

  const [form, setForm] = useState<EditorForm>(() => {
    if (!persona) return EMPTY_FORM;
    const pers = persona.personality || { traits: [], communicationStyle: "", background: "", speechStyle: "" };
    return {
      name: persona.name,
      description: persona.description,
      greeting: persona.greeting,
      communicationStyle: pers.communicationStyle || "",
      background: pers.background || "",
      speechStyle: pers.speechStyle || "",
      traits: (pers.traits || []).join(", "),
      tags: (persona.tags || []).join(", "),
      isPublic: persona.isPublic,
    };
  });
  const set = (k: keyof EditorForm, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    const result = await uploadFile(file);
    if (result) {
      setAvatarUrl(result.objectPath);
    } else {
      toast({ title: "이미지 업로드 실패", variant: "destructive" });
    }
    e.target.value = "";
  };

  const handleExpressionSlotClick = (emotionKey: string) => {
    uploadingEmotionRef.current = emotionKey;
    expressionInputRef.current?.click();
  };

  const handleExpressionSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const emotionKey = uploadingEmotionRef.current;
    if (!file || !emotionKey) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setExpressionPreviews(prev => ({ ...prev, [emotionKey]: ev.target?.result as string }));
    };
    reader.readAsDataURL(file);

    setUploadingEmotion(emotionKey);
    const result = await uploadFile(file);
    setUploadingEmotion(null);

    if (result) {
      setExpressions(prev => ({ ...prev, [emotionKey]: result.objectPath }));
    } else {
      toast({ title: "표정 이미지 업로드 실패", variant: "destructive" });
      setExpressionPreviews(prev => { const n = { ...prev }; delete n[emotionKey]; return n; });
    }
    e.target.value = "";
    uploadingEmotionRef.current = null;
  };

  const handleRemoveExpression = (emotionKey: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setExpressions(prev => { const n = { ...prev }; delete n[emotionKey]; return n; });
    setExpressionPreviews(prev => { const n = { ...prev }; delete n[emotionKey]; return n; });
  };

  const handleGenerateImage = async () => {
    if (!persona?.id || isGeneratingImage) return;
    setIsGeneratingImage(true);
    try {
      const traits = form.traits.split(",").map(t => t.trim()).filter(Boolean);
      const res = await apiRequest("POST", `/api/user-personas/${persona.id}/generate-image`, {
        name: form.name.trim(),
        description: form.description.trim(),
        personality: { traits, background: form.background.trim() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || "이미지 생성에 실패했습니다.");
      }
      const data = await res.json();
      setAvatarUrl(data.objectPath);
      setAvatarPreview(toMediaUrl(data.objectPath));
      toast({ title: "AI 초상화 생성 완료!" });
    } catch (err: any) {
      toast({
        title: "이미지 생성 실패",
        description: err.message || "잠시 후 다시 시도해주세요.",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleGenerateExpressions = async () => {
    if (!persona?.id || isGeneratingExpressions || !avatarUrl) return;
    setIsGeneratingExpressions(true);
    setExpressionProgress({ done: 0, total: 9 });
    if (!showExpressions) setShowExpressions(true);
    try {
      const res = await apiRequest("POST", `/api/user-personas/${persona.id}/generate-expressions`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || "표정 생성에 실패했습니다.");
      }
      const data = await res.json();

      const newPreviews: Record<string, string> = {};
      const newExpressions: Record<string, string> = {};

      for (const [key, path] of Object.entries(data.expressions as Record<string, string>)) {
        if (path) {
          newExpressions[key] = path;
          newPreviews[key] = toMediaUrl(path);
        }
      }
      

      setExpressions(prev => ({ ...prev, ...newExpressions }));
      setExpressionPreviews(prev => ({ ...prev, ...newPreviews }));
      setExpressionProgress({ done: data.generated, total: data.total });
      toast({ title: `표정 이미지 ${data.generated}개 생성 완료!` });
    } catch (err: any) {
      toast({
        title: "표정 생성 실패",
        description: err.message || "잠시 후 다시 시도해주세요.",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingExpressions(false);
      setExpressionProgress(null);
    }
  };

  const handleRegenerateExpression = async (emotionKey: string, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!persona?.id || generatingExpressionKey) return;
    setGeneratingExpressionKey(emotionKey);
    try {
      const res = await apiRequest("POST", `/api/user-personas/${persona.id}/generate-expression/${emotionKey}`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || "재생성에 실패했습니다.");
      }
      const data = await res.json();
      setExpressions(prev => ({ ...prev, [emotionKey]: data.objectPath }));
      setExpressionPreviews(prev => ({ ...prev, [emotionKey]: toMediaUrl(data.objectPath) }));
      toast({ title: "표정 이미지 재생성 완료" });
    } catch (err: any) {
      toast({
        title: "재생성 실패",
        description: err.message || "잠시 후 다시 시도해주세요.",
        variant: "destructive"
      });
    } finally {
      setGeneratingExpressionKey(null);
    }
  };

  const saveMutation = useMutation({
    mutationFn: (payload: any) => persona
      ? apiRequest("PUT", `/api/user-personas/${persona.id}`, payload).then(r => r.json())
      : apiRequest("POST", "/api/user-personas", payload).then(r => r.json()),
    onSuccess: (data: PersonaEditData) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas/discover"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas", persona?.id] });
      toast({ title: persona ? "페르소나가 수정됐어요" : "페르소나가 만들어졌어요!" });
      onSaved(data);
    },
    onError: () => toast({ title: "저장 실패", variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    saveMutation.mutate({
      name: form.name.trim(),
      description: form.description.trim(),
      greeting: form.greeting.trim() || `안녕하세요! 저는 ${form.name.trim()}입니다.`,
      avatarUrl,
      expressions: Object.keys(expressions).length > 0 ? expressions : null,
      personality: {
        traits: form.traits.split(",").map(t => t.trim()).filter(Boolean),
        communicationStyle: form.communicationStyle.trim(),
        background: form.background.trim(),
        speechStyle: form.speechStyle.trim(),
      },
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      isPublic: form.isPublic,
    });
  };

  const initials = form.name.slice(0, 2).toUpperCase() || "?";
  const expressionCount = Object.keys(expressions).length;
  const canGenerateImage = !!persona?.id && !isGeneratingImage && !isUploading;
  const canGenerateExpressions = !!persona?.id && !!avatarUrl && !isGeneratingExpressions && !isGeneratingImage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-slate-900">{persona ? "페르소나 수정" : "새 페르소나 만들기"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* 아바타 업로드 + AI 생성 */}
          <div className="flex flex-col items-center gap-2 pb-2">
            <div className="relative group cursor-pointer" onClick={() => !isGeneratingImage && fileInputRef.current?.click()}>
              {isGeneratingImage ? (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-white animate-spin" />
                </div>
              ) : avatarPreview ? (
                <img src={avatarPreview} alt="avatar" className="w-20 h-20 rounded-full object-cover border-2 border-slate-200" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-xl">
                  {initials}
                </div>
              )}
              {!isGeneratingImage && (
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {isUploading && !uploadingEmotion
                    ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Camera className="w-5 h-5 text-white" />}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading || isGeneratingImage}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 disabled:opacity-50"
              >
                <ImageIcon className="w-3 h-3" />
                {isUploading && !uploadingEmotion ? "업로드 중..." : avatarPreview ? "이미지 변경" : "이미지 추가"}
              </button>

              {persona?.id && (
                <>
                  <span className="text-slate-300 text-xs">|</span>
                  <button
                    type="button"
                    onClick={handleGenerateImage}
                    disabled={!canGenerateImage}
                    title={!persona?.id ? "저장 후 AI 생성을 사용할 수 있어요" : "AI로 캐릭터 초상화 생성"}
                    className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isGeneratingImage
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> 생성 중...</>
                      : <><Wand2 className="w-3 h-3" /> AI 초상화 생성</>}
                  </button>
                </>
              )}
            </div>

            {isGeneratingImage && (
              <p className="text-xs text-violet-500 animate-pulse">Gemini AI가 캐릭터 이미지를 생성하고 있어요...</p>
            )}

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
            <input ref={expressionInputRef} type="file" accept="image/*" className="hidden" onChange={handleExpressionSelect} />
          </div>

          <div>
            <Label>이름 *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="예: 친절한 멘토, 역사학자 김박사" className="mt-1" required />
          </div>
          <div>
            <Label>소개</Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} placeholder="이 페르소나는 어떤 캐릭터인가요?" className="mt-1" rows={2} />
          </div>
          <div>
            <Label>첫 인사말</Label>
            <Textarea value={form.greeting} onChange={e => set("greeting", e.target.value)} placeholder="대화 시작 시 AI가 먼저 하는 말" className="mt-1" rows={2} />
          </div>
          <div>
            <Label>배경 스토리</Label>
            <Textarea value={form.background} onChange={e => set("background", e.target.value)} placeholder="캐릭터의 직업, 경험, 세계관 등" className="mt-1" rows={2} />
          </div>
          <div>
            <Label>성격 특성</Label>
            <Input value={form.traits} onChange={e => set("traits", e.target.value)} placeholder="예: 유머러스, 직설적, 공감 능력 뛰어남 (쉼표로 구분)" className="mt-1" />
          </div>
          <div>
            <Label>대화 방식</Label>
            <Input value={form.communicationStyle} onChange={e => set("communicationStyle", e.target.value)} placeholder="예: 따뜻하고 격려적인 말투로 소통" className="mt-1" />
          </div>
          <div>
            <Label>말투 스타일</Label>
            <Input value={form.speechStyle} onChange={e => set("speechStyle", e.target.value)} placeholder='예: "~네요", "~죠?" 같은 편안한 존댓말 사용' className="mt-1" />
          </div>
          <div>
            <Label>태그</Label>
            <Input value={form.tags} onChange={e => set("tags", e.target.value)} placeholder="예: 멘토, 역사, 철학 (쉼표로 구분)" className="mt-1" />
          </div>

          {/* ── 표정 이미지 설정 ── */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center bg-slate-50 hover:bg-slate-100 transition-colors">
              <button
                type="button"
                onClick={() => setShowExpressions(v => !v)}
                className="flex-1 flex items-center gap-2 px-4 py-3 text-left"
              >
                <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0" />
                <span className="text-sm font-medium text-slate-700">표정 이미지 설정</span>
                {expressionCount > 0 && (
                  <span className="text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">{expressionCount}/10</span>
                )}
              </button>

              {persona?.id && (
                <button
                  type="button"
                  onClick={handleGenerateExpressions}
                  disabled={!canGenerateExpressions}
                  title={!avatarUrl ? "기본 이미지를 먼저 등록하거나 생성해주세요" : "AI로 10가지 표정 이미지 자동 생성"}
                  className="flex items-center gap-1 px-3 py-3 text-xs font-medium text-violet-600 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed border-l border-slate-200 whitespace-nowrap"
                >
                  {isGeneratingExpressions
                    ? <><Loader2 className="w-3 h-3 animate-spin" />{expressionProgress ? `${expressionProgress.done}/${expressionProgress.total}` : "생성 중..."}</>
                    : <><Wand2 className="w-3 h-3" />AI 일괄 생성</>}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowExpressions(v => !v)}
                className="px-3 py-3 border-l border-slate-200"
              >
                {showExpressions ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
            </div>

            {showExpressions && (
              <div className="p-4 space-y-3">
                {isGeneratingExpressions && (
                  <div className="flex items-center gap-2 text-xs text-violet-600 bg-violet-50 px-3 py-2 rounded-lg">
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    <span>Gemini AI가 표정 이미지를 순서대로 생성하고 있어요. 약 2~3분 소요됩니다...</span>
                  </div>
                )}
                {!persona?.id && (
                  <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                    저장 후 AI 자동 생성 기능을 사용할 수 있어요.
                  </p>
                )}
                {!avatarUrl && persona?.id && (
                  <p className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-lg">
                    기본 이미지를 업로드하거나 AI 초상화를 생성하면 표정 이미지 자동 생성을 사용할 수 있어요.
                  </p>
                )}
                <p className="text-xs text-slate-500">각 감정에 맞는 캐릭터 이미지를 업로드하면 대화 중 AI 감정에 따라 자동으로 전환됩니다.</p>
                <div className="grid grid-cols-5 gap-2">
                  {EXPRESSION_KEYS.map(({ key, label, emoji }) => {
                    const preview = expressionPreviews[key];
                    const isThisUploading = uploadingEmotion === key;
                    const isThisGenerating = generatingExpressionKey === key || (isGeneratingExpressions && !preview);
                    return (
                      <div
                        key={key}
                        onClick={() => !isThisUploading && !isGeneratingExpressions && !generatingExpressionKey && handleExpressionSlotClick(key)}
                        className="relative group cursor-pointer flex flex-col items-center gap-1"
                      >
                        <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden border-2 border-dashed border-slate-200 hover:border-violet-400 transition-colors bg-slate-50">
                          {preview ? (
                            <img src={preview} alt={label} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                              <span className="text-lg">{emoji}</span>
                              <Plus className="w-3 h-3 text-slate-300" />
                            </div>
                          )}
                          {(isThisUploading || (isGeneratingExpressions && !preview)) && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                          {generatingExpressionKey === key && (
                            <div className="absolute inset-0 bg-violet-900/50 flex items-center justify-center">
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                          {preview && !isThisUploading && !isGeneratingExpressions && !generatingExpressionKey && (
                            <>
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                <Camera className="w-3 h-3 text-white" />
                                {persona?.id && avatarUrl && (
                                  <button
                                    type="button"
                                    onClick={(ev) => handleRegenerateExpression(key, ev)}
                                    className="p-0.5 rounded hover:bg-white/20"
                                    title="AI로 재생성"
                                  >
                                    <RefreshCw className="w-3 h-3 text-white" />
                                  </button>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={(ev) => handleRemoveExpression(key, ev)}
                                className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 rounded-full text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 text-center leading-tight">{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Switch id="isPublic" checked={form.isPublic} onCheckedChange={v => set("isPublic", v)} />
            <Label htmlFor="isPublic" className="cursor-pointer">
              {form.isPublic
                ? <span className="text-emerald-600 flex items-center gap-1"><Globe className="w-3.5 h-3.5" />공개 — 누구나 대화 가능</span>
                : <span className="text-slate-500 flex items-center gap-1"><Lock className="w-3.5 h-3.5" />비공개 — 나만 사용</span>}
            </Label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>취소</Button>
            <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={saveMutation.isPending || isUploading || isGeneratingImage || isGeneratingExpressions}>
              {saveMutation.isPending ? "저장 중..." : persona ? "수정 완료" : "만들기"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
