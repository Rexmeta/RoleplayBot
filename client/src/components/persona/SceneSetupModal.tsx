import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  X, Wand2, Pen, Sparkles, ChevronRight, Loader2,
  Check, Edit3, MapPin, Wind,
} from "lucide-react";

export interface PersonaScene {
  title: string;
  setting: string;
  mood: string;
  openingLine: string;
  genre: string;
}

type Tab = "template" | "custom" | "ai";

interface GenreTemplate {
  genre: string;
  label: string;
  tagline: string;
  imageUrl: string;
  setting: string;
  mood: string;
  openingLineTemplate: (personaName: string) => string;
}

const GENRE_TEMPLATES: GenreTemplate[] = [
  {
    genre: "로맨스",
    label: "로맨스",
    tagline: "설레는 카페의 오후",
    imageUrl: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=600&h=400&fit=crop&auto=format",
    setting: "카페 창가 자리, 오후의 햇살이 내려앉는 조용한 공간. 두 사람은 우연히 같은 자리를 예약했다.",
    mood: "설레고 따뜻한",
    openingLineTemplate: (name) => `(당신을 보며 살짝 웃는다) 저도 여기 자주 오는데… 처음 뵙는 것 같네요.`,
  },
  {
    genre: "판타지",
    label: "판타지",
    tagline: "마법이 깃든 신비로운 숲",
    imageUrl: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&h=400&fit=crop&auto=format",
    setting: "마법의 숲 끝자락, 고대 유적의 입구 앞. 달빛이 돌기둥 사이로 흘러내린다.",
    mood: "신비롭고 긴장감 넘치는",
    openingLineTemplate: (name) => `오랜 예언대로 당신이 왔군요. 이 유적은 선택받은 자만 들어갈 수 있습니다.`,
  },
  {
    genre: "미스터리",
    label: "미스터리",
    tagline: "빗소리와 음산한 골목",
    imageUrl: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=600&h=400&fit=crop&auto=format",
    setting: "빗소리가 창을 두드리는 탐정 사무소. 누군가 문을 두드린다.",
    mood: "긴장감 있고 음산한",
    openingLineTemplate: (name) => `(낮은 목소리로) 이 사건, 아무에게도 말하지 않았겠죠? 어서 들어오세요.`,
  },
  {
    genre: "SF",
    label: "SF",
    tagline: "무한한 우주의 비상경보",
    imageUrl: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=600&h=400&fit=crop&auto=format",
    setting: "우주 정거장의 관제실. 창밖으로 무수히 많은 별이 펼쳐진다. 비상경보가 울리고 있다.",
    mood: "긴박하고 SF적인",
    openingLineTemplate: (name) => `통신 연결 확인했습니다. 당신이 구출 팀이군요—시간이 없어요, 빨리 상황을 설명하죠.`,
  },
  {
    genre: "일상",
    label: "일상",
    tagline: "따뜻한 도시의 하루",
    imageUrl: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=600&h=400&fit=crop&auto=format",
    setting: "동네 작은 카페. 따뜻한 커피 향이 가득하고, 배경에는 잔잔한 음악이 흐른다.",
    mood: "편안하고 유쾌한",
    openingLineTemplate: (name) => `오늘 하루 어땠어요? 얼굴이 좀 피곤해 보이네요—커피 한 잔 어때요?`,
  },
  {
    genre: "직장",
    label: "직장",
    tagline: "긴장감 넘치는 오피스",
    imageUrl: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=600&h=400&fit=crop&auto=format",
    setting: "회사 회의실. 내일 오전까지 제출해야 하는 프로젝트 보고서를 두고 팀이 모여 있다.",
    mood: "긴장감 있고 진지한",
    openingLineTemplate: (name) => `이 데이터 맞게 본 거 맞죠? 클라이언트 측에서 이 부분 꼭 짚어볼 것 같아서요.`,
  },
  {
    genre: "학교",
    label: "학교",
    tagline: "시험 기간의 조용한 교실",
    imageUrl: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=600&h=400&fit=crop&auto=format",
    setting: "방과 후 조용한 도서관 한 켠. 창밖으로는 해가 지고 있고, 시험 기간이 한창이다.",
    mood: "조용하고 약간 긴장된",
    openingLineTemplate: (name) => `저기…같이 공부해도 될까요? 이 단원이 너무 어려워서요.`,
  },
  {
    genre: "역사",
    label: "역사",
    tagline: "달빛 아래 고성의 밤",
    imageUrl: "https://images.unsplash.com/photo-1464817739973-0128fe77aaa1?w=600&h=400&fit=crop&auto=format",
    setting: "19세기 말 서울의 어느 한옥 사랑채. 촛불이 흔들리고, 창호지 너머 달빛이 비친다.",
    mood: "격조 있고 서정적인",
    openingLineTemplate: (name) => `이 시각에 어인 일로 방문하셨소? 어서 드십시오.`,
  },
];

interface Props {
  personaName: string;
  personaDescription?: string;
  onConfirm: (scene: PersonaScene | null) => void;
  onClose: () => void;
}

export default function SceneSetupModal({ personaName, personaDescription, onConfirm, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("template");
  const { toast } = useToast();

  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const [aiIdea, setAiIdea] = useState("");
  const [generatedScene, setGeneratedScene] = useState<PersonaScene | null>(null);
  const [editingScene, setEditingScene] = useState<PersonaScene | null>(null);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/persona-scenes/generate", {
        idea: aiIdea,
        personaName,
        personaDescription,
      }).then((r) => r.json()),
    onSuccess: (data: PersonaScene) => {
      setGeneratedScene(data);
      setEditingScene({ ...data });
    },
    onError: (err: any) => {
      toast({ title: "시나리오 생성 실패", description: err.message, variant: "destructive" });
    },
  });

  const handleConfirm = () => {
    if (tab === "template") {
      if (!selectedGenre) {
        onConfirm(null);
        return;
      }
      const tmpl = GENRE_TEMPLATES.find((t) => t.genre === selectedGenre)!;
      onConfirm({
        title: tmpl.label,
        setting: tmpl.setting,
        mood: tmpl.mood,
        openingLine: tmpl.openingLineTemplate(personaName),
        genre: tmpl.genre,
      });
    } else if (tab === "custom") {
      if (!customText.trim()) {
        onConfirm(null);
        return;
      }
      onConfirm({
        title: "나만의 장면",
        setting: customText.trim(),
        mood: "자유로운",
        openingLine: "",
        genre: "일상",
      });
    } else {
      if (!editingScene) {
        onConfirm(null);
        return;
      }
      onConfirm(editingScene);
    }
  };

  const tabs = [
    { key: "template" as Tab, label: "빠른 템플릿", icon: <Sparkles className="w-3.5 h-3.5" /> },
    { key: "custom" as Tab, label: "직접 작성", icon: <Pen className="w-3.5 h-3.5" /> },
    { key: "ai" as Tab, label: "AI 생성", icon: <Wand2 className="w-3.5 h-3.5" /> },
  ];

  const selectedTmpl = selectedGenre ? GENRE_TEMPLATES.find((t) => t.genre === selectedGenre) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90dvh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">장면 설정</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="font-medium text-emerald-600">{personaName}</span>과의 대화 배경을 설정하세요
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 flex-shrink-0 px-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? "text-emerald-600 border-emerald-500"
                  : "text-slate-500 border-transparent hover:text-slate-700"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {tab === "template" && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-500">원하는 장르를 선택하세요. 배경과 오프닝 라인이 자동으로 설정됩니다.</p>

              {/* Image card grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {GENRE_TEMPLATES.map((tmpl) => {
                  const isSelected = selectedGenre === tmpl.genre;
                  return (
                    <button
                      key={tmpl.genre}
                      onClick={() => setSelectedGenre(isSelected ? null : tmpl.genre)}
                      className={`relative rounded-xl overflow-hidden aspect-[4/3] transition-all duration-300 focus:outline-none ${
                        isSelected
                          ? "ring-[3px] ring-emerald-400 shadow-[0_0_16px_4px_rgba(52,211,153,0.45)]"
                          : "ring-1 ring-transparent hover:ring-slate-300 hover:shadow-md"
                      }`}
                    >
                      {/* Full-bleed background image */}
                      <div
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 hover:scale-105"
                        style={{ backgroundImage: `url(${tmpl.imageUrl})` }}
                      />

                      {/* Gradient overlay */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />

                      {/* Selected check badge */}
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg z-10">
                          <Check className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}

                      {/* Bottom text overlay */}
                      <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5 pt-4 text-left z-10">
                        <p className="text-white text-xs font-bold leading-tight drop-shadow-md">{tmpl.label}</p>
                        <p className="text-white/75 text-[10px] leading-tight mt-0.5 drop-shadow">{tmpl.tagline}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Cinematic preview panel */}
              {selectedTmpl && (
                <div
                  className="relative rounded-xl overflow-hidden"
                  style={{ minHeight: "140px" }}
                >
                  {/* Background image */}
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${selectedTmpl.imageUrl})` }}
                  />
                  {/* Dark overlay */}
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />

                  {/* Glass card content */}
                  <div className="relative z-10 p-3">
                    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-3 space-y-2">
                      <p className="text-emerald-300 text-[10px] font-bold uppercase tracking-widest">{selectedTmpl.label} 장면 미리보기</p>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-white/60 mt-0.5 flex-shrink-0" />
                        <p className="text-white/90 text-xs leading-relaxed">{selectedTmpl.setting}</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <Wind className="w-3.5 h-3.5 text-white/60 mt-0.5 flex-shrink-0" />
                        <p className="text-white/80 text-xs">{selectedTmpl.mood} 분위기</p>
                      </div>
                      <div className="flex items-start gap-2 pt-1 border-t border-white/15">
                        <span className="text-white/50 text-[10px] mt-0.5 flex-shrink-0 font-semibold uppercase">첫마디</span>
                        <p className="text-emerald-300 italic text-xs leading-relaxed">"{selectedTmpl.openingLineTemplate(personaName)}"</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "custom" && (
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-500">원하는 장면을 자유롭게 설명하세요. 페르소나가 이 배경에 맞게 반응합니다.</p>
              <Textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value.slice(0, 1000))}
                placeholder={`예시: 우리는 같은 대학 동기로, 졸업 후 5년 만에 동창회에서 재회했다. ${personaName}은 해외 생활을 하다 막 귀국했고, 나는 같은 도시에서 직장을 다니고 있다. 서로 반갑지만 어색한 분위기...`}
                rows={6}
                maxLength={1000}
                className="resize-none text-sm"
              />
              <p className="text-[11px] text-slate-400">{customText.length}/1000자</p>
            </div>
          )}

          {tab === "ai" && (
            <div className="p-4 space-y-3">
              {!generatedScene ? (
                <>
                  <p className="text-xs text-slate-500">짧은 아이디어나 키워드를 입력하면 AI가 배경·분위기·오프닝 라인을 포함한 장면을 생성해줍니다.</p>
                  <Textarea
                    value={aiIdea}
                    onChange={(e) => setAiIdea(e.target.value)}
                    placeholder={`예시: "카페에서 우연히 만난 전 연인", "우주선 비상상황", "탐정이 의뢰인을 처음 만나는 장면"`}
                    rows={3}
                    className="resize-none text-sm"
                    disabled={generateMutation.isPending}
                  />
                  <Button
                    onClick={() => generateMutation.mutate()}
                    disabled={!aiIdea.trim() || generateMutation.isPending}
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {generateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        AI가 장면을 생성 중...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4" />
                        AI 장면 생성
                      </>
                    )}
                  </Button>

                  {generateMutation.isPending && (
                    <div className="space-y-2 animate-pulse">
                      <div className="h-3 bg-slate-100 rounded-full w-3/4" />
                      <div className="h-3 bg-slate-100 rounded-full w-full" />
                      <div className="h-3 bg-slate-100 rounded-full w-5/6" />
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">생성된 장면</h3>
                    <button
                      onClick={() => { setGeneratedScene(null); setEditingScene(null); }}
                      className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" />다시 생성
                    </button>
                  </div>

                  {editingScene && (
                    <div className="space-y-3">
                      <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase">제목</label>
                          <input
                            value={editingScene.title}
                            onChange={(e) => setEditingScene({ ...editingScene, title: e.target.value })}
                            className="mt-0.5 w-full text-sm text-slate-800 bg-transparent border-b border-slate-200 focus:border-emerald-400 outline-none py-1"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase">배경</label>
                          <textarea
                            value={editingScene.setting}
                            onChange={(e) => setEditingScene({ ...editingScene, setting: e.target.value })}
                            rows={3}
                            className="mt-0.5 w-full text-sm text-slate-700 bg-transparent resize-none border-b border-slate-200 focus:border-emerald-400 outline-none py-1 leading-relaxed"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase">분위기</label>
                          <input
                            value={editingScene.mood}
                            onChange={(e) => setEditingScene({ ...editingScene, mood: e.target.value })}
                            className="mt-0.5 w-full text-sm text-slate-700 bg-transparent border-b border-slate-200 focus:border-emerald-400 outline-none py-1"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-slate-400 uppercase">{personaName}의 첫 마디</label>
                          <textarea
                            value={editingScene.openingLine}
                            onChange={(e) => setEditingScene({ ...editingScene, openingLine: e.target.value })}
                            rows={2}
                            className="mt-0.5 w-full text-sm text-emerald-700 italic bg-transparent resize-none border-b border-slate-200 focus:border-emerald-400 outline-none py-1 leading-relaxed"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-slate-100 flex gap-2 flex-shrink-0">
          <Button
            variant="outline"
            className="flex-1 text-slate-600"
            onClick={() => onConfirm(null)}
          >
            시나리오 없이 자유 대화
          </Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            onClick={handleConfirm}
            disabled={
              (tab === "ai" && !editingScene) ||
              (tab === "ai" && generateMutation.isPending)
            }
          >
            대화 시작
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
