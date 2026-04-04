import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import PersonaLayout from "@/components/PersonaLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, ChevronRight, Wand2, Loader2, Plus, X,
  MapPin, Wind, MessageSquare, Globe, Lock, Sparkles, Check
} from "lucide-react";

const GENRES = ["로맨스", "판타지", "미스터리", "SF", "일상", "직장", "학교", "역사"];

interface SceneFormData {
  title: string;
  description: string;
  genre: string;
  setting: string;
  mood: string;
  openingLine: string;
  tags: string[];
  isPublic: boolean;
}

const defaultForm: SceneFormData = {
  title: "",
  description: "",
  genre: "일상",
  setting: "",
  mood: "",
  openingLine: "",
  tags: [],
  isPublic: false,
};

export default function PersonaSceneCreatePage() {
  const [, navigate] = useLocation();
  const params = useParams<{ id?: string }>();
  const editId = params.id || null;
  const isEditMode = !!editId;
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<SceneFormData>(defaultForm);
  const [tagInput, setTagInput] = useState("");
  const [aiIdea, setAiIdea] = useState("");
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [formInitialized, setFormInitialized] = useState(!isEditMode);

  const totalSteps = 3;

  const { data: existingScene } = useQuery({
    queryKey: ["/api/persona-user-scenes", editId],
    queryFn: () => apiRequest("GET", `/api/persona-user-scenes/${editId}`).then(r => r.json()),
    enabled: isEditMode && !!editId,
  });

  useEffect(() => {
    if (existingScene && !formInitialized) {
      setForm({
        title: existingScene.title || "",
        description: existingScene.description || "",
        genre: existingScene.genre || "일상",
        setting: existingScene.setting || "",
        mood: existingScene.mood || "",
        openingLine: existingScene.openingLine || "",
        tags: existingScene.tags || [],
        isPublic: existingScene.isPublic || false,
      });
      setFormInitialized(true);
    }
  }, [existingScene, formInitialized]);

  const payload = {
    title: form.title,
    description: form.description,
    genre: form.genre,
    setting: form.setting,
    mood: form.mood,
    openingLine: form.openingLine,
    tags: form.tags,
    isPublic: form.isPublic,
  };

  const createMutation = useMutation({
    mutationFn: () =>
      isEditMode
        ? apiRequest("PATCH", `/api/persona-user-scenes/${editId}`, payload).then(r => r.json())
        : apiRequest("POST", "/api/persona-user-scenes", payload).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/persona-user-scenes"] });
      toast({ title: isEditMode ? "장면이 수정됐어요!" : "장면이 생성됐어요!" });
      navigate(`/persona/scene/${isEditMode ? editId : data.id}`);
    },
    onError: (err: any) => {
      toast({ title: isEditMode ? "장면 수정 실패" : "장면 생성 실패", description: err.message, variant: "destructive" });
    },
  });

  const aiGenerateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/persona-user-scenes/generate", {
        idea: aiIdea,
        personaName: "캐릭터",
      }).then(r => r.json()),
    onSuccess: (data) => {
      setForm(prev => ({
        ...prev,
        title: data.title || prev.title,
        setting: data.setting || prev.setting,
        mood: data.mood || prev.mood,
        openingLine: data.openingLine || prev.openingLine,
        genre: data.genre || prev.genre,
      }));
      setShowAiGenerator(false);
      toast({ title: "AI가 장면을 생성했어요!", description: "내용을 확인하고 필요하면 수정하세요." });
    },
    onError: (err: any) => {
      toast({ title: "AI 생성 실패", description: err.message, variant: "destructive" });
    },
  });

  const update = (field: keyof SceneFormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const addTag = () => {
    const trimmed = tagInput.trim().replace(/^#/, "");
    if (!trimmed || form.tags.includes(trimmed) || form.tags.length >= 10) return;
    update("tags", [...form.tags, trimmed]);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    update("tags", form.tags.filter(t => t !== tag));
  };

  const canProceed = () => {
    if (step === 1) return form.title.trim().length > 0;
    if (step === 2) return true;
    return true;
  };

  const handleNext = () => {
    if (step < totalSteps) setStep(step + 1);
    else createMutation.mutate();
  };

  const stepLabels = ["기본 정보", "장면 설정", "태그 & 공개"];

  return (
    <PersonaLayout>
      <div className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => step > 1 ? setStep(step - 1) : navigate("/persona/scenes")}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-600"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{isEditMode ? "장면 수정" : "장면 만들기"}</h1>
            <p className="text-sm text-slate-500">{isEditMode ? "장면 내용을 수정해요" : "캐릭터와의 대화에 사용할 장면을 만들어요"}</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {stepLabels.map((label, i) => {
            const n = i + 1;
            const isActive = n === step;
            const isDone = n < step;
            return (
              <div key={n} className="flex items-center gap-2 flex-1">
                <div className={`flex items-center gap-1.5 ${isActive ? "text-emerald-600" : isDone ? "text-emerald-500" : "text-slate-400"}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    isActive ? "bg-emerald-600 text-white" : isDone ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500"
                  }`}>
                    {isDone ? <Check className="w-3.5 h-3.5" /> : n}
                  </div>
                  <span className="text-xs font-medium hidden sm:block">{label}</span>
                </div>
                {i < stepLabels.length - 1 && (
                  <div className={`flex-1 h-0.5 rounded-full ${n < step ? "bg-emerald-300" : "bg-slate-200"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* AI Generator Panel */}
        {showAiGenerator && (
          <div className="mb-6 bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-emerald-800">AI 장면 자동 생성</h3>
              </div>
              <button onClick={() => setShowAiGenerator(false)} className="p-1 rounded-lg hover:bg-white/50 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <Textarea
              value={aiIdea}
              onChange={e => setAiIdea(e.target.value)}
              placeholder="예: '카페에서 우연히 만난 소설 속 탐정', '우주선에서 갑작스러운 조난 상황', '첫 출근날 만난 선배'"
              rows={3}
              className="text-sm resize-none bg-white border-emerald-200 focus:border-emerald-400 mb-3"
              disabled={aiGenerateMutation.isPending}
            />
            <Button
              onClick={() => aiGenerateMutation.mutate()}
              disabled={!aiIdea.trim() || aiGenerateMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2"
            >
              {aiGenerateMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" />AI가 장면을 만드는 중...</>
              ) : (
                <><Sparkles className="w-4 h-4" />AI로 장면 생성</>
              )}
            </Button>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

          {/* Step 1: 기본 정보 */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-bold text-slate-800">기본 정보</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAiGenerator(!showAiGenerator)}
                  className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  AI로 생성
                </Button>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">장면 제목 <span className="text-red-500">*</span></label>
                <Input
                  value={form.title}
                  onChange={e => update("title", e.target.value)}
                  placeholder="예: 카페에서의 우연한 만남"
                  maxLength={100}
                />
                <p className="text-[11px] text-slate-400 mt-1">{form.title.length}/100자</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">장면 설명</label>
                <Textarea
                  value={form.description}
                  onChange={e => update("description", e.target.value)}
                  placeholder="이 장면에 대해 간략하게 설명해주세요"
                  rows={3}
                  maxLength={500}
                  className="resize-none text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1">{form.description.length}/500자</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">장르 선택</label>
                <div className="flex flex-wrap gap-2">
                  {GENRES.map(g => (
                    <button
                      key={g}
                      onClick={() => update("genre", g)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        form.genre === g
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-700"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 장면 설정 */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-slate-800 mb-2">장면 설정</h2>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />배경 상황
                </label>
                <Textarea
                  value={form.setting}
                  onChange={e => update("setting", e.target.value)}
                  placeholder="장면의 배경과 상황을 구체적으로 설명해주세요. 예: '비 오는 오후, 작은 카페의 창가 자리. 두 사람은 우연히 우산을 바꿔 가져갔다는 걸 알게 되었다.'"
                  rows={5}
                  maxLength={1000}
                  className="resize-none text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1">{form.setting.length}/1000자</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <Wind className="w-3.5 h-3.5 text-slate-400" />분위기
                </label>
                <Input
                  value={form.mood}
                  onChange={e => update("mood", e.target.value)}
                  placeholder="예: 설레고 따뜻한, 긴장감 넘치는, 신비롭고 음산한"
                  maxLength={100}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-slate-400" />AI 캐릭터 첫 대사
                </label>
                <Textarea
                  value={form.openingLine}
                  onChange={e => update("openingLine", e.target.value)}
                  placeholder="장면이 시작될 때 AI 캐릭터가 건넬 첫 마디를 작성해주세요. 비워두면 AI가 자동으로 생성합니다."
                  rows={3}
                  maxLength={500}
                  className="resize-none text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1">{form.openingLine.length}/500자</p>
              </div>
            </div>
          )}

          {/* Step 3: 태그 & 공개 */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-slate-800 mb-2">태그 & 공개 설정</h2>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">태그</label>
                <div className="flex gap-2 mb-2">
                  <Input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); }}}
                    placeholder="태그 입력 후 Enter"
                    maxLength={30}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={addTag} size="icon" className="flex-shrink-0">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.tags.map(tag => (
                      <span key={tag} className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-sm">
                        #{tag}
                        <button onClick={() => removeTag(tag)} className="hover:text-red-500">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-1">최대 10개 ({form.tags.length}/10)</p>
              </div>

              <div className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {form.isPublic ? (
                      <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <Globe className="w-5 h-5 text-emerald-600" />
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
                        <Lock className="w-5 h-5 text-slate-500" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {form.isPublic ? "공개" : "비공개"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {form.isPublic ? "다른 사용자가 이 장면을 탐색하고 사용할 수 있어요" : "나만 사용할 수 있어요"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => update("isPublic", !form.isPublic)}
                    className={`w-12 h-6 rounded-full transition-colors relative ${form.isPublic ? "bg-emerald-600" : "bg-slate-200"}`}
                  >
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.isPublic ? "translate-x-6" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>

              {/* Preview */}
              {(form.title || form.setting) && (
                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">미리보기</h4>
                  {form.title && <p className="font-bold text-slate-800">{form.title}</p>}
                  {form.genre && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">{form.genre}</Badge>}
                  {form.setting && (
                    <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">{form.setting}</p>
                  )}
                  {form.mood && (
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <Wind className="w-3 h-3" />{form.mood}
                    </p>
                  )}
                  {form.openingLine && (
                    <p className="text-sm text-emerald-700 italic">"{form.openingLine}"</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-3 mt-6">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep(step - 1)}
              className="flex-1"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />이전
            </Button>
          )}
          <Button
            onClick={handleNext}
            disabled={!canProceed() || createMutation.isPending}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
          >
            {createMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-1" />저장 중...</>
            ) : step === totalSteps ? (
              <>장면 저장하기 <Check className="w-4 h-4 ml-1" /></>
            ) : (
              <>다음 <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
        </div>
      </div>
    </PersonaLayout>
  );
}
