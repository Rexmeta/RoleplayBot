import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import { AppHeader } from "@/components/AppHeader";
import ChatWindow from "@/components/ChatWindow";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { MessageSquare, Mic, Volume2, Users, ChevronRight, Sparkles } from "lucide-react";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";

type ViewState = "select" | "chat" | "done";
type ChatMode = "text" | "tts" | "realtime_voice";

interface FreeChatPersona {
  id: string;
  mbti: string;
  gender: string | null;
  personalityTraits: string[] | null;
  communicationStyle: string | null;
  motivation: string | null;
  freeChatDescription: string | null;
  images: {
    male?: { expressions?: Record<string, string> };
    female?: { expressions?: Record<string, string> };
  } | null;
}

function buildSyntheticScenario(persona: FreeChatPersona, difficulty: number): ComplexScenario {
  return {
    id: "__free_chat__",
    title: `${persona.mbti} 유형과의 자유 대화`,
    description: persona.freeChatDescription || `${persona.mbti} 유형의 페르소나와 자유롭게 대화를 나눕니다`,
    context: {
      situation: "직장 내 자연스러운 대화 상황. 별도의 협상 목표 없이 편안하게 대화합니다.",
      timeline: "현재",
      stakes: "커뮤니케이션 능력 향상",
      playerRole: {
        position: "직원",
        department: "팀",
        experience: "근무 중",
        responsibility: "자유롭게 대화하기",
      },
    },
    objectives: [
      "자연스러운 대화를 통해 상대방을 이해하고 소통하기",
      "상대방의 MBTI 유형에 맞는 커뮤니케이션 스타일 연습하기",
    ],
    personas: [],
    difficulty,
    successCriteria: {
      optimal: "자연스럽고 깊이 있는 대화",
      good: "적극적인 소통",
      acceptable: "기본적인 대화 유지",
      failure: "대화 거부 또는 단답형 반복",
    },
  } as any;
}

function buildSyntheticPersona(persona: FreeChatPersona, gender?: string): ScenarioPersona {
  const effectiveGender = (gender || persona.gender || "male") as "male" | "female";
  const neutral = persona.images?.[effectiveGender]?.expressions?.["neutral"] ||
    persona.images?.[effectiveGender]?.expressions?.["중립"] || undefined;
  return {
    id: persona.id,
    name: persona.mbti,
    role: "동료",
    department: "팀",
    mbti: persona.mbti,
    gender: effectiveGender,
    image: neutral,
    personality: {
      traits: persona.personalityTraits || [],
      communicationStyle: persona.communicationStyle || "",
      motivation: persona.motivation || "",
      fears: [],
    },
  } as any;
}

const MODE_OPTIONS: { value: ChatMode; label: string; icon: any }[] = [
  { value: "text", label: "텍스트", icon: MessageSquare },
  { value: "tts", label: "음성 출력 (TTS)", icon: Volume2 },
  { value: "realtime_voice", label: "실시간 음성", icon: Mic },
];

const DIFFICULTY_OPTIONS = [
  { value: "1", label: "1단계 - 매우 쉬움" },
  { value: "2", label: "2단계 - 쉬움" },
  { value: "3", label: "3단계 - 보통" },
  { value: "4", label: "4단계 - 어려움" },
];

export default function FreeChatPage() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [view, setView] = useState<ViewState>("select");
  const [selectedPersona, setSelectedPersona] = useState<FreeChatPersona | null>(null);
  const [selectedGender, setSelectedGender] = useState<"male" | "female">("male");
  const [selectedMode, setSelectedMode] = useState<ChatMode>("text");
  const [selectedDifficulty, setSelectedDifficulty] = useState(2);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const { data: personas = [], isLoading } = useQuery<FreeChatPersona[]>({
    queryKey: ["/api/free-chat/personas"],
  });

  const startMutation = useMutation({
    mutationFn: (payload: { personaId: string; mode: string; difficulty: number; gender: string }) =>
      apiRequest("POST", "/api/free-chat/start", payload).then(r => r.json()),
    onSuccess: (data) => {
      setConversationId(data.id);
      setView("chat");
    },
  });

  const handleStart = () => {
    if (!selectedPersona) return;
    startMutation.mutate({
      personaId: selectedPersona.id,
      mode: selectedMode,
      difficulty: selectedDifficulty,
      gender: selectedGender,
    });
  };

  const getPersonaImage = (persona: FreeChatPersona, gender: "male" | "female") => {
    const expressions = persona.images?.[gender]?.expressions;
    if (!expressions) return null;
    const key = Object.keys(expressions).find(k => k === "neutral" || k === "중립") ||
      Object.keys(expressions)[0];
    return key ? toMediaUrl(expressions[key]) : null;
  };

  if (view === "chat" && conversationId && selectedPersona) {
    const syntheticScenario = buildSyntheticScenario(selectedPersona, selectedDifficulty);
    const syntheticPersona = buildSyntheticPersona(selectedPersona, selectedGender);
    return (
      <ChatWindow
        scenario={syntheticScenario}
        persona={syntheticPersona}
        conversationId={conversationId}
        onChatComplete={() => setView("done")}
        onExit={() => navigate("/home")}
      />
    );
  }

  if (view === "done") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 pb-8 text-center">
            <Sparkles className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-800 mb-2">대화 완료!</h2>
            <p className="text-slate-500 mb-6">자유 대화 연습이 완료되었습니다.</p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => { setView("select"); setConversationId(null); }}>
                다시 연습하기
              </Button>
              <Button onClick={() => navigate("/home")}>홈으로</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      <AppHeader />

      <div className="max-w-6xl mx-auto px-4 py-8">

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
          </div>
        ) : personas.length === 0 ? (
          <div className="text-center py-24">
            <Users className="w-14 h-14 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-600 mb-2">사용 가능한 페르소나가 없습니다</h3>
            <p className="text-slate-400 text-sm">
              관리자 페이지에서 페르소나의 '자유 대화 허용'을 활성화해 주세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* 좌측: 페르소나 목록 */}
            <div className="lg:col-span-2">
              <h2 className="text-lg font-bold text-slate-800 mb-4">페르소나 선택</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {personas.map(persona => {
                  const img = getPersonaImage(persona, selectedGender);
                  const isSelected = selectedPersona?.id === persona.id;
                  return (
                    <button
                      key={persona.id}
                      onClick={() => setSelectedPersona(persona)}
                      className={`text-left rounded-xl border-2 p-4 transition-all ${
                        isSelected
                          ? "border-indigo-500 bg-indigo-50 shadow-md"
                          : "border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 flex-shrink-0">
                          {img ? (
                            <img src={img} alt={persona.mbti} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl font-bold text-slate-400">
                              {persona.mbti.slice(0, 2)}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-slate-800">{persona.mbti}</span>
                            <Badge variant="secondary" className="text-xs">{persona.id.toUpperCase()}</Badge>
                          </div>
                          {persona.communicationStyle && (
                            <p className="text-xs text-slate-500 line-clamp-2">{persona.communicationStyle}</p>
                          )}
                          {persona.freeChatDescription && (
                            <p className="text-xs text-indigo-600 mt-1 font-medium line-clamp-1">
                              {persona.freeChatDescription}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <ChevronRight className="w-5 h-5 text-indigo-500 flex-shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 우측: 설정 패널 */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl border border-slate-200 p-6 sticky top-6">
                <h2 className="text-lg font-bold text-slate-800 mb-5">대화 설정</h2>

                {/* 성별 */}
                <div className="mb-5">
                  <label className="text-sm font-medium text-slate-700 block mb-2">페르소나 성별</label>
                  <div className="flex gap-2">
                    {(["male", "female"] as const).map(g => (
                      <button
                        key={g}
                        onClick={() => setSelectedGender(g)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                          selectedGender === g
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {g === "male" ? "남성" : "여성"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 대화 모드 */}
                <div className="mb-5">
                  <label className="text-sm font-medium text-slate-700 block mb-2">대화 모드</label>
                  <div className="flex flex-col gap-2">
                    {MODE_OPTIONS.map(opt => {
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setSelectedMode(opt.value)}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                            selectedMode === opt.value
                              ? "bg-indigo-50 border-2 border-indigo-500 text-indigo-700"
                              : "border-2 border-slate-200 text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 난이도 */}
                <div className="mb-6">
                  <label className="text-sm font-medium text-slate-700 block mb-2">난이도</label>
                  <Select
                    value={String(selectedDifficulty)}
                    onValueChange={v => setSelectedDifficulty(Number(v))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIFFICULTY_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 선택된 페르소나 미리보기 */}
                {selectedPersona && (
                  <div className="mb-5 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                    <p className="text-xs text-indigo-700 font-medium mb-1">선택된 페르소나</p>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-100 flex-shrink-0">
                        {getPersonaImage(selectedPersona, selectedGender) ? (
                          <img
                            src={getPersonaImage(selectedPersona, selectedGender)!}
                            alt={selectedPersona.mbti}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-sm font-bold text-indigo-400">
                            {selectedPersona.mbti.slice(0, 2)}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-indigo-800 text-sm">{selectedPersona.mbti}</p>
                        <p className="text-xs text-indigo-600">
                          {selectedGender === "male" ? "남성" : "여성"} · {selectedMode === "text" ? "텍스트" : selectedMode === "tts" ? "TTS" : "실시간 음성"} · {selectedDifficulty}단계
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  size="lg"
                  disabled={!selectedPersona || startMutation.isPending}
                  onClick={handleStart}
                >
                  {startMutation.isPending ? (
                    <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />대화 준비 중...</>
                  ) : (
                    <><MessageSquare className="w-4 h-4 mr-2" />대화 시작</>
                  )}
                </Button>
                {!selectedPersona && (
                  <p className="text-xs text-slate-400 text-center mt-2">페르소나를 먼저 선택해 주세요</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
