import { useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import PersonaLayout from "@/components/PersonaLayout";
import ChatWindow from "@/components/ChatWindow";
import PersonaEditorModal, { type PersonaEditData } from "@/components/PersonaEditorModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Heart, MessageSquare, Globe, Lock,
  Sparkles, MessageCircle, Pencil
} from "lucide-react";
import type { ScenarioPersona } from "@/lib/scenario-system";

interface UserPersona {
  id: string;
  creatorId: string;
  creatorName?: string;
  name: string;
  description: string;
  greeting: string;
  avatarUrl: string | null;
  expressions?: Record<string, string> | null;
  personality: { traits: string[]; communicationStyle: string; background: string; speechStyle: string } | null;
  tags: string[];
  isPublic: boolean;
  likeCount: number;
  chatCount: number;
  createdAt: string;
  liked?: boolean;
}

interface FreeChatMbtiPersonaDetail {
  id: string;
  mbti: string;
  gender: string | null;
  communicationStyle: string | null;
  freeChatDescription: string | null;
  images: { male?: { expressions?: Record<string, string> }; female?: { expressions?: Record<string, string> } } | null;
}

type FreeChatMbtiPersonaList = FreeChatMbtiPersonaDetail[];

function buildUserPersonaScenario(p: UserPersona, difficulty: number) {
  const pers = p.personality ?? { traits: [], communicationStyle: "", background: "", speechStyle: "" };
  return {
    id: `__user_persona__:${p.id}`,
    title: `${p.name}와의 대화`,
    description: p.description,
    difficulty,
    personas: [],
    context: {
      situation: p.description || "자유로운 대화",
      timeline: "현재",
      stakes: "자유 대화",
      playerRole: { position: "대화 참여자", department: "", experience: "", responsibility: "편하게 대화하기" },
    },
    objectives: ["자유롭게 대화하기"],
    successCriteria: { optimal: "자연스러운 대화", good: "적극적인 소통", acceptable: "기본 대화 유지", failure: "대화 거부" },
    _userPersonaMode: true,
    _userPersonaSystemPrompt: [
      `당신은 "${p.name}"라는 AI 캐릭터입니다.`,
      p.description && `캐릭터 설명: ${p.description}`,
      pers.background && `배경: ${pers.background}`,
      pers.traits?.length && `성격 특성: ${pers.traits.join(", ")}`,
      pers.communicationStyle && `대화 방식: ${pers.communicationStyle}`,
      pers.speechStyle && `말투: ${pers.speechStyle}`,
      `\n위 캐릭터로서 자연스럽게 대화하세요.`,
    ].filter(Boolean).join("\n"),
  } as any;
}

function buildMbtiScenario(mbtiPersona: FreeChatMbtiPersonaDetail, difficulty: number) {
  return {
    id: `__mbti_persona__:${mbtiPersona.id}`,
    title: `${mbtiPersona.mbti}와의 자유 대화`,
    description: mbtiPersona.freeChatDescription ?? `${mbtiPersona.mbti} 유형과의 자유 대화`,
    difficulty,
    personas: [],
    context: {
      situation: "자유 대화",
      timeline: "현재",
      stakes: "소통 연습",
      playerRole: { position: "직원", department: "", experience: "", responsibility: "대화" },
    },
    objectives: ["자유롭게 소통하기"],
    successCriteria: { optimal: "깊이 있는 대화", good: "적극적 소통", acceptable: "기본 대화 유지", failure: "대화 거부" },
    _userPersonaMode: true,
    _userPersonaSystemPrompt: `당신은 MBTI ${mbtiPersona.mbti} 유형의 AI 캐릭터입니다. 자연스럽게 대화하세요.`,
  } as any;
}

function getMbtiImage(persona: FreeChatMbtiPersonaDetail, gender: "male" | "female") {
  const exps = persona.images?.[gender]?.expressions;
  if (!exps) return null;
  const key = Object.keys(exps).find(k => k === "중립" || k === "neutral") ?? Object.keys(exps)[0];
  return key ? toMediaUrl(exps[key]) : null;
}

export default function PersonaProfilePage() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();

  const isMbti = Boolean(id?.startsWith("mbti-"));
  const mbtiId = isMbti ? id!.replace("mbti-", "") : null;

  const { user } = useAuth();
  const [chatWindow, setChatWindow] = useState<React.ReactNode | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [mbtiGender, setMbtiGender] = useState<"male" | "female">("male");
  const [editorOpen, setEditorOpen] = useState(false);

  const { data: persona, isLoading: personaLoading } = useQuery<UserPersona>({
    queryKey: ["/api/user-personas", id],
    queryFn: () => apiRequest("GET", `/api/user-personas/${id}`).then(r => r.json()),
    enabled: !isMbti && !!id,
  });

  const { data: mbtiPersona, isLoading: mbtiLoading } = useQuery<FreeChatMbtiPersonaDetail | undefined>({
    queryKey: ["/api/free-chat/personas", "mbti", mbtiId],
    queryFn: () =>
      apiRequest("GET", "/api/free-chat/personas")
        .then(r => r.json())
        .then(list => list.find((p: FreeChatMbtiPersonaDetail) => p.id === mbtiId)),
    enabled: isMbti && !!mbtiId,
  });

  const likeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/user-personas/${id}/like`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas/featured"] });
    },
  });

  const startUserChatMutation = useMutation({
    mutationFn: (payload: { personaId: string; mode: string; difficulty: number }) =>
      apiRequest("POST", `/api/user-personas/${payload.personaId}/start-chat`, { mode: payload.mode, difficulty: payload.difficulty }).then(r => r.json()),
  });

  const startMbtiChatMutation = useMutation({
    mutationFn: (payload: { personaId: string; mode: string; difficulty: number; gender: string }) =>
      apiRequest("POST", "/api/free-chat/start", { personaId: payload.personaId, mode: payload.mode, difficulty: payload.difficulty, gender: payload.gender }).then(r => r.json()),
  });

  const handleStartChat = async () => {
    setIsPending(true);
    try {
      if (persona) {
        startUserChatMutation.mutate({ personaId: persona.id, mode: "text", difficulty: 2 });
      } else if (mbtiPersona) {
        startMbtiChatMutation.mutate({ personaId: mbtiPersona.id, mode: "text", difficulty: 2, gender: mbtiGender });
      }
    } catch {
      setIsPending(false);
    }
  };

  const handleExitChat = () => {
    setChatWindow(null);
    setIsPending(false);
  };

  function buildPersonaForChat(p: UserPersona) {
    let expressions: Record<string, string> | undefined = p.expressions || undefined;
    if (!expressions && p.avatarUrl) {
      expressions = { neutral: p.avatarUrl };
    } else if (expressions && !expressions.neutral && p.avatarUrl) {
      expressions = { ...expressions, neutral: p.avatarUrl };
    }
    return {
      id: p.id,
      name: p.name,
      role: "대화 상대",
      department: "",
      image: p.avatarUrl ? toMediaUrl(p.avatarUrl) : undefined,
      expressions,
      personality: {
        traits: p.personality?.traits ?? [],
        communicationStyle: p.personality?.communicationStyle ?? "",
        motivation: p.personality?.background ?? "",
        fears: [],
      },
    } as any as ScenarioPersona;
  }

  const isLoading = isMbti ? mbtiLoading : personaLoading;

  if (!chatWindow && (startUserChatMutation.isSuccess || startMbtiChatMutation.isSuccess)) {
    const convData = startUserChatMutation.data ?? startMbtiChatMutation.data;
    if (convData) {
      if (persona) {
        const scenario = buildUserPersonaScenario(persona, 2);
        const chatPersona = buildPersonaForChat(persona);
        setChatWindow(
          <ChatWindow
            conversationId={convData.id}
            scenario={scenario}
            persona={chatPersona}
            onChatComplete={handleExitChat}
            onExit={handleExitChat}
          />
        );
      } else if (mbtiPersona) {
        const scenario = buildMbtiScenario(mbtiPersona, 2);
        const img = getMbtiImage(mbtiPersona, mbtiGender);
        const chatPersona = {
          id: mbtiPersona.id,
          name: mbtiPersona.mbti,
          role: "AI 캐릭터",
          department: "",
          gender: mbtiGender,
          mbti: mbtiPersona.mbti,
          image: img ?? undefined,
          personality: {
            traits: [],
            communicationStyle: mbtiPersona.communicationStyle ?? "",
            motivation: "",
            fears: [],
          },
        } as any as ScenarioPersona;
        setChatWindow(
          <ChatWindow
            conversationId={convData.id}
            scenario={scenario}
            persona={chatPersona}
            onChatComplete={handleExitChat}
            onExit={handleExitChat}
          />
        );
      }
    }
  }

  if (chatWindow) {
    return (
      <PersonaLayout chatMode>
        {chatWindow}
      </PersonaLayout>
    );
  }

  if (isLoading) {
    return (
      <PersonaLayout>
        <div className="flex-1 flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
        </div>
      </PersonaLayout>
    );
  }

  if (!isMbti && !persona) {
    return (
      <PersonaLayout>
        <div className="flex-1 flex items-center justify-center min-h-[60vh] text-slate-500">캐릭터를 찾을 수 없어요</div>
      </PersonaLayout>
    );
  }

  if (isMbti && !mbtiPersona) {
    return (
      <PersonaLayout>
        <div className="flex-1 flex items-center justify-center min-h-[60vh] text-slate-500">MBTI 캐릭터를 찾을 수 없어요</div>
      </PersonaLayout>
    );
  }

  // ── MBTI Profile ──
  if (isMbti && mbtiPersona) {
    const img = getMbtiImage(mbtiPersona, mbtiGender);
    const avatarBgStyle: React.CSSProperties = img
      ? { backgroundImage: `url(${img})` }
      : { background: "linear-gradient(135deg, #4f46e5, #7c3aed)" };

    return (
      <PersonaLayout>
        <div className="max-w-2xl mx-auto w-full px-6 py-6">
          <div className="relative rounded-2xl overflow-hidden mb-6">
            <div className="absolute inset-0 bg-cover bg-center blur-sm scale-110 opacity-40" style={avatarBgStyle} />
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-700/60 to-indigo-900/80" />
            <div className="relative flex flex-col items-center text-white py-10 px-6">
              <div className="w-28 h-28 rounded-full overflow-hidden bg-indigo-300 mb-4 ring-4 ring-white/30">
                {img ? (
                  <img src={img} alt={mbtiPersona.mbti} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-400 to-purple-600">
                    <span className="font-bold text-2xl">{mbtiPersona.mbti}</span>
                  </div>
                )}
              </div>
              <h1 className="text-3xl font-bold">{mbtiPersona.mbti}</h1>
              <p className="text-indigo-200 mt-2 text-center max-w-xs">{mbtiPersona.freeChatDescription}</p>
              <Badge className="mt-3 bg-white/20 text-white border-white/30">MBTI 캐릭터</Badge>
              <div className="flex gap-2 mt-4">
                {(["male", "female"] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setMbtiGender(g)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${mbtiGender === g ? "bg-white text-indigo-700" : "bg-white/20 text-white hover:bg-white/30"}`}
                  >
                    {g === "male" ? "남성" : "여성"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button
            onClick={handleStartChat}
            disabled={isPending}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 text-base font-semibold gap-2 rounded-xl mb-6"
          >
            <MessageCircle className="w-5 h-5" />
            {isPending ? "대화 시작 중..." : "대화 시작하기"}
          </Button>

          <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
            <p className="text-xs text-indigo-600 font-medium mb-1">💬 인사말 미리보기</p>
            <p className="text-slate-700 text-sm italic">
              "{mbtiPersona.freeChatDescription ?? `안녕하세요! 저는 ${mbtiPersona.mbti} 유형입니다.`}"
            </p>
          </div>
        </div>
      </PersonaLayout>
    );
  }

  // ── UserPersona Profile ──
  const p = persona!;
  const avatarUrl = p.avatarUrl ? toMediaUrl(p.avatarUrl) : null;
  const heroBgStyle: React.CSSProperties = avatarUrl
    ? { backgroundImage: `url(${avatarUrl})` }
    : { background: "linear-gradient(135deg, #059669, #0d9488)" };

  return (
    <>
    <PersonaLayout>
      <div className="max-w-2xl mx-auto w-full px-6 py-6">
        <div className="relative rounded-2xl overflow-hidden mb-6">
          <div className="absolute inset-0 bg-cover bg-center blur-sm scale-110 opacity-40" style={heroBgStyle} />
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-700/60 to-emerald-900/80" />
          <div className="relative flex flex-col items-center text-white py-10 px-6">
            <div className="w-28 h-28 rounded-full overflow-hidden mb-4 ring-4 ring-white/30">
              {avatarUrl ? (
                <img src={avatarUrl} alt={p.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-teal-600">
                  <span className="font-bold text-2xl">{p.name.slice(0, 2).toUpperCase()}</span>
                </div>
              )}
            </div>
            <h1 className="text-3xl font-bold">{p.name}</h1>
            <p className="text-emerald-200 mt-2 text-center max-w-xs">{p.description}</p>
            <div className="flex items-center gap-4 mt-4 text-sm text-emerald-100">
              <span className="flex items-center gap-1"><Heart className="w-4 h-4" />{p.likeCount}</span>
              <span className="flex items-center gap-1"><MessageSquare className="w-4 h-4" />{p.chatCount}번 대화</span>
              {p.isPublic
                ? <span className="flex items-center gap-1"><Globe className="w-4 h-4" />공개</span>
                : <span className="flex items-center gap-1"><Lock className="w-4 h-4" />비공개</span>
              }
            </div>
            {p.creatorName && (
              <p className="text-xs text-emerald-200 mt-2">제작: {p.creatorName}</p>
            )}
            {user?.id === p.creatorId && (
              <button
                onClick={() => setEditorOpen(true)}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition-colors"
              >
                <Pencil className="w-3 h-3" />
                편집
              </button>
            )}
            {p.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                {p.tags.map(tag => (
                  <span key={tag} className="text-xs bg-white/20 text-white px-2.5 py-1 rounded-full">{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <Button
            onClick={handleStartChat}
            disabled={isPending}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-3 text-base font-semibold gap-2 rounded-xl"
          >
            <MessageCircle className="w-5 h-5" />
            {isPending ? "대화 시작 중..." : "대화 시작하기"}
          </Button>
          <Button
            variant="outline"
            onClick={() => likeMutation.mutate()}
            disabled={likeMutation.isPending}
            className={`px-4 rounded-xl ${p.liked ? "text-red-500 border-red-200 hover:bg-red-50" : "text-slate-500 hover:text-red-500"}`}
          >
            <Heart className={`w-5 h-5 ${p.liked ? "fill-red-500" : ""}`} />
          </Button>
        </div>

        {p.greeting && (
          <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100 mb-4">
            <p className="text-xs text-emerald-600 font-medium mb-1">💬 첫 인사말</p>
            <p className="text-slate-700 text-sm italic">"{p.greeting}"</p>
          </div>
        )}

        {p.personality && (
          (p.personality.traits?.length > 0 ||
            p.personality.communicationStyle ||
            p.personality.background ||
            p.personality.speechStyle)
        ) && (
          <div className="bg-white rounded-xl p-4 border border-slate-200 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-500" />캐릭터 정보
            </h3>
            {p.personality.traits?.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1.5">성격 특성</p>
                <div className="flex flex-wrap gap-1.5">
                  {p.personality.traits.map(trait => (
                    <span key={trait} className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-100">{trait}</span>
                  ))}
                </div>
              </div>
            )}
            {p.personality.communicationStyle && (
              <div>
                <p className="text-xs text-slate-500 mb-1">대화 방식</p>
                <p className="text-sm text-slate-700">{p.personality.communicationStyle}</p>
              </div>
            )}
            {p.personality.speechStyle && (
              <div>
                <p className="text-xs text-slate-500 mb-1">말투 스타일</p>
                <p className="text-sm text-slate-700">{p.personality.speechStyle}</p>
              </div>
            )}
            {p.personality.background && (
              <div>
                <p className="text-xs text-slate-500 mb-1">배경 스토리</p>
                <p className="text-sm text-slate-700">{p.personality.background}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </PersonaLayout>
    {editorOpen && (
      <PersonaEditorModal
        persona={p as PersonaEditData}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          queryClient.invalidateQueries({ queryKey: ["/api/user-personas", id] });
          queryClient.invalidateQueries({ queryKey: ["/api/user-personas"] });
          queryClient.invalidateQueries({ queryKey: ["/api/user-personas/discover"] });
          queryClient.invalidateQueries({ queryKey: ["/api/user-personas/featured"] });
        }}
      />
    )}
    </>
  );
}
