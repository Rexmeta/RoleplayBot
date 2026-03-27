import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import { useUpload } from "@/hooks/use-upload";
import { AppHeader } from "@/components/AppHeader";
import ChatWindow from "@/components/ChatWindow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Search, Plus, MessageSquare, Compass, User, Heart,
  MoreVertical, Pencil, Trash2, Globe, Lock, X, Check,
  MessageCircle, Mic, Volume2, ChevronRight, Users, Sparkles,
  Camera, ImageIcon
} from "lucide-react";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";

// ────────── Types ──────────
interface UserPersona {
  id: string;
  creatorId: string;
  name: string;
  description: string;
  greeting: string;
  avatarUrl: string | null;
  personality: { traits: string[]; communicationStyle: string; background: string; speechStyle: string } | null;
  tags: string[];
  isPublic: boolean;
  likeCount: number;
  chatCount: number;
  createdAt: string;
  liked?: boolean;
}

interface FreeChatMbtiPersona {
  id: string;
  mbti: string;
  gender: string | null;
  communicationStyle: string | null;
  freeChatDescription: string | null;
  images: { male?: { expressions?: Record<string, string> }; female?: { expressions?: Record<string, string> } } | null;
}

type SidebarTab = "discover" | "my" | "mbti";
type MainView = "browse" | "chat";
type ChatMode = "text" | "tts" | "realtime_voice";

// ────────── Helpers ──────────
function buildUserPersonaScenario(p: UserPersona, difficulty: number): ComplexScenario {
  const pers = p.personality || { traits: [], communicationStyle: "", background: "", speechStyle: "" };
  return {
    id: `__user_persona__:${p.id}`,
    title: `${p.name}와의 대화`,
    description: p.description,
    context: {
      situation: p.description || "자유로운 대화",
      timeline: "현재",
      stakes: "자유 대화",
      playerRole: { position: "대화 참여자", department: "", experience: "", responsibility: "편하게 대화하기" },
    },
    objectives: ["자유롭게 대화하기"],
    personas: [],
    difficulty,
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

function buildUserPersonaForChat(p: UserPersona): ScenarioPersona {
  return {
    id: p.id,
    name: p.name,
    role: "대화 상대",
    department: "",
    mbti: "" as any,
    gender: "male" as any,
    image: p.avatarUrl ? toMediaUrl(p.avatarUrl) : undefined,
    personality: {
      traits: p.personality?.traits || [],
      communicationStyle: p.personality?.communicationStyle || "",
      motivation: p.personality?.background || "",
      fears: [],
    },
  } as any;
}

function buildMbtiScenario(mbti: string, desc: string, difficulty: number): ComplexScenario {
  return {
    id: "__free_chat__",
    title: `${mbti}와의 자유 대화`,
    description: desc,
    context: { situation: "자유 대화", timeline: "현재", stakes: "소통 연습", playerRole: { position: "직원", department: "", experience: "", responsibility: "대화" } },
    objectives: ["자유롭게 소통하기"],
    personas: [], difficulty,
    successCriteria: { optimal: "깊이 있는 대화", good: "적극적 소통", acceptable: "기본 대화 유지", failure: "대화 거부" },
  } as any;
}

function getMbtiImage(persona: FreeChatMbtiPersona, gender: "male" | "female") {
  const exps = persona.images?.[gender]?.expressions;
  if (!exps) return null;
  const key = Object.keys(exps).find(k => k === "중립" || k === "neutral") || Object.keys(exps)[0];
  return key ? toMediaUrl(exps[key]) : null;
}

// ────────── PersonaAvatar ──────────
function PersonaAvatar({ url, name, size = 10 }: { url?: string | null; name: string; size?: number }) {
  const cls = `w-${size} h-${size} rounded-full object-cover`;
  const initials = name.slice(0, 2).toUpperCase();
  if (url) return <img src={url} alt={name} className={cls + " flex-shrink-0"} />;
  return (
    <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ────────── PersonaEditorModal ──────────
interface EditorForm {
  name: string; description: string; greeting: string;
  communicationStyle: string; background: string; speechStyle: string;
  traits: string; tags: string; isPublic: boolean;
}
const EMPTY_FORM: EditorForm = {
  name: "", description: "", greeting: "", communicationStyle: "",
  background: "", speechStyle: "", traits: "", tags: "", isPublic: false,
};

function PersonaEditorModal({ persona, onClose, onSaved }: {
  persona: UserPersona | null;
  onClose: () => void;
  onSaved: (p: UserPersona) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload();

  const [avatarUrl, setAvatarUrl] = useState<string | null>(persona?.avatarUrl || null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    persona?.avatarUrl ? toMediaUrl(persona.avatarUrl) : null
  );

  const [form, setForm] = useState<EditorForm>(() => {
    if (!persona) return EMPTY_FORM;
    const pers = persona.personality || { traits: [], communicationStyle: "", background: "", speechStyle: "" };
    return {
      name: persona.name, description: persona.description, greeting: persona.greeting,
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
  };

  const saveMutation = useMutation({
    mutationFn: (payload: any) => persona
      ? apiRequest("PUT", `/api/user-personas/${persona.id}`, payload).then(r => r.json())
      : apiRequest("POST", "/api/user-personas", payload).then(r => r.json()),
    onSuccess: (data: UserPersona) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas/discover"] });
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
      avatarUrl: avatarUrl,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-slate-900">{persona ? "페르소나 수정" : "새 페르소나 만들기"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">

          {/* 이미지 업로드 */}
          <div className="flex flex-col items-center gap-2 pb-2">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {avatarPreview ? (
                <img src={avatarPreview} alt="avatar" className="w-20 h-20 rounded-full object-cover border-2 border-slate-200" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-xl">
                  {initials}
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {isUploading
                  ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Camera className="w-5 h-5 text-white" />}
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1 disabled:opacity-50"
            >
              <ImageIcon className="w-3 h-3" />
              {isUploading ? "업로드 중..." : avatarPreview ? "이미지 변경" : "이미지 추가"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageSelect}
            />
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
          <div className="flex items-center gap-3 pt-1">
            <Switch id="isPublic" checked={form.isPublic} onCheckedChange={v => set("isPublic", v)} />
            <Label htmlFor="isPublic" className="cursor-pointer">
              {form.isPublic ? <span className="text-emerald-600 flex items-center gap-1"><Globe className="w-3.5 h-3.5" />공개 — 누구나 대화 가능</span>
                : <span className="text-slate-500 flex items-center gap-1"><Lock className="w-3.5 h-3.5" />비공개 — 나만 사용</span>}
            </Label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>취소</Button>
            <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={saveMutation.isPending || isUploading}>
              {saveMutation.isPending ? "저장 중..." : persona ? "수정 완료" : "만들기"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ────────── UserPersonaCard ──────────
function UserPersonaCard({ persona, isSelected, isMine, onSelect, onEdit, onDelete, onLike }: {
  persona: UserPersona; isSelected: boolean; isMine: boolean;
  onSelect: () => void; onEdit: () => void; onDelete: () => void; onLike: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tags = persona.tags?.slice(0, 3) || [];

  return (
    <div onClick={onSelect} className={`group flex items-center gap-3 px-3 py-3 cursor-pointer rounded-xl transition-all ${isSelected ? "bg-emerald-50 border border-emerald-200" : "hover:bg-slate-50"}`}>
      <PersonaAvatar url={persona.avatarUrl} name={persona.name} size={10} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-800 text-sm truncate">{persona.name}</span>
          {persona.isPublic ? <Globe className="w-3 h-3 text-emerald-500 flex-shrink-0" /> : <Lock className="w-3 h-3 text-slate-400 flex-shrink-0" />}
        </div>
        <p className="text-xs text-slate-500 truncate mt-0.5">{persona.description || "설명 없음"}</p>
        {tags.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {tags.map(tag => <span key={tag} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{tag}</span>)}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <button onClick={onLike} className={`flex items-center gap-0.5 px-1.5 py-1 rounded-lg text-xs transition-colors ${persona.liked ? "text-red-500" : "text-slate-400 hover:text-red-400"}`}>
          <Heart className={`w-3 h-3 ${persona.liked ? "fill-red-500" : ""}`} />
          <span>{persona.likeCount}</span>
        </button>
        {isMine && (
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen(v => !v)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-6 bg-white border border-slate-200 rounded-lg shadow-lg z-20 w-32" onMouseLeave={() => setMenuOpen(false)}>
                <button onClick={() => { onEdit(); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <Pencil className="w-3.5 h-3.5" />수정
                </button>
                <button onClick={() => { onDelete(); setMenuOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" />삭제
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────── Main Page ──────────
export default function FreeChatPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("discover");
  const [mainView, setMainView] = useState<MainView>("browse");
  const [searchQuery, setSearchQuery] = useState("");
  const [discoverSort, setDiscoverSort] = useState<"likes" | "recent">("likes");

  // 선택된 페르소나 (UserPersona 또는 MbtiPersona)
  const [selectedUserPersona, setSelectedUserPersona] = useState<UserPersona | null>(null);
  const [selectedMbtiPersona, setSelectedMbtiPersona] = useState<FreeChatMbtiPersona | null>(null);
  const [selectedMbtiGender, setSelectedMbtiGender] = useState<"male" | "female">("male");

  // 채팅 설정
  const [chatMode, setChatMode] = useState<ChatMode>("text");
  const [chatDifficulty, setChatDifficulty] = useState(2);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // 에디터
  const [editorTarget, setEditorTarget] = useState<UserPersona | null | "new">(undefined as any);
  const isEditorOpen = editorTarget !== undefined && editorTarget !== null || editorTarget === null ? false : true;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<UserPersona | null>(null);

  // 채팅 화면에서 슬라이드 사이드바
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);

  // Data queries
  const { data: discoverPersonas = [] } = useQuery<UserPersona[]>({
    queryKey: ["/api/user-personas/discover", discoverSort],
    queryFn: () => apiRequest("GET", `/api/user-personas/discover?sort=${discoverSort}`).then(r => r.json()),
  });

  const { data: myPersonas = [] } = useQuery<UserPersona[]>({
    queryKey: ["/api/user-personas"],
    queryFn: () => apiRequest("GET", "/api/user-personas").then(r => r.json()),
  });

  const { data: mbtiPersonas = [] } = useQuery<FreeChatMbtiPersona[]>({
    queryKey: ["/api/free-chat/personas"],
  });

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/user-personas/${id}/like`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas/discover"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas"] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/user-personas/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas"] });
      toast({ title: "페르소나가 삭제됐어요" });
      if (selectedUserPersona) setSelectedUserPersona(null);
    },
  });

  // localStorage helpers for conversation resume
  const PERSONA_CONV_KEY = (personaId: string) => `persona_conv:${personaId}`;
  const getSavedConvId = (personaId: string): string | null => localStorage.getItem(PERSONA_CONV_KEY(personaId));
  const saveConvId = (personaId: string, convId: string) => localStorage.setItem(PERSONA_CONV_KEY(personaId), convId);
  const clearSavedConvId = (personaId: string) => localStorage.removeItem(PERSONA_CONV_KEY(personaId));

  // Start user persona chat
  const startUserChatMutation = useMutation({
    mutationFn: (payload: { personaId: string; mode: string; difficulty: number }) =>
      apiRequest("POST", `/api/user-personas/${payload.personaId}/start-chat`, { mode: payload.mode, difficulty: payload.difficulty }).then(r => r.json()),
    onSuccess: (data, variables) => {
      saveConvId(variables.personaId, data.id);
      setConversationId(data.id);
      setMainView("chat");
    },
    onError: (err: any) => toast({ title: "대화 시작 실패", description: err.message, variant: "destructive" }),
  });

  // Start MBTI free chat
  const startMbtiChatMutation = useMutation({
    mutationFn: (payload: { personaId: string; mode: string; difficulty: number; gender: string }) =>
      apiRequest("POST", "/api/free-chat/start", payload).then(r => r.json()),
    onSuccess: (data) => {
      setConversationId(data.id);
      setMainView("chat");
    },
    onError: (err: any) => toast({ title: "대화 시작 실패", description: err.message, variant: "destructive" }),
  });

  const handleStartChat = () => {
    if (selectedUserPersona) {
      // 저장된 대화가 있으면 바로 재개
      const savedId = getSavedConvId(selectedUserPersona.id);
      if (savedId) {
        setConversationId(savedId);
        setMainView("chat");
      } else {
        startUserChatMutation.mutate({ personaId: selectedUserPersona.id, mode: chatMode, difficulty: chatDifficulty });
      }
    } else if (selectedMbtiPersona) {
      startMbtiChatMutation.mutate({ personaId: selectedMbtiPersona.id, mode: chatMode, difficulty: chatDifficulty, gender: selectedMbtiGender });
    }
  };

  const handleStartNewChat = () => {
    if (selectedUserPersona) {
      clearSavedConvId(selectedUserPersona.id);
      startUserChatMutation.mutate({ personaId: selectedUserPersona.id, mode: chatMode, difficulty: chatDifficulty });
    }
  };

  const handleExitChat = () => {
    // localStorage는 유지 (재진입 시 이어하기 가능)
    setMainView("browse");
    setConversationId(null);
  };

  const selectUserPersona = (p: UserPersona) => {
    setSelectedUserPersona(p);
    setSelectedMbtiPersona(null);
    // 대화 이력이 있으면 정보 페이지를 건너뛰고 바로 채팅으로 진입
    const savedId = getSavedConvId(p.id);
    if (savedId) {
      setConversationId(savedId);
      setMainView("chat");
    }
  };

  const selectMbtiPersona = (p: FreeChatMbtiPersona) => {
    setSelectedMbtiPersona(p);
    setSelectedUserPersona(null);
  };

  const filteredDiscover = discoverPersonas.filter(p =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredMy = myPersonas.filter(p =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredMbti = mbtiPersonas.filter(p =>
    !searchQuery || p.mbti.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentPersonaName = selectedUserPersona?.name || selectedMbtiPersona?.mbti || null;
  const isPending = startUserChatMutation.isPending || startMbtiChatMutation.isPending;

  // ── Chat view ──────────────────────────────────────────────────────
  if (mainView === "chat" && conversationId) {
    let chatWindow: React.ReactNode = null;
    if (selectedUserPersona) {
      const scenario = buildUserPersonaScenario(selectedUserPersona, chatDifficulty);
      const persona = buildUserPersonaForChat(selectedUserPersona);
      chatWindow = (
        <ChatWindow
          scenario={scenario}
          persona={persona}
          conversationId={conversationId}
          onChatComplete={handleExitChat}
          onExit={handleExitChat}
          isPersonaMode={true}
        />
      );
    } else if (selectedMbtiPersona) {
      const scenario = buildMbtiScenario(
        selectedMbtiPersona.mbti,
        selectedMbtiPersona.freeChatDescription || `${selectedMbtiPersona.mbti} 유형과의 자유 대화`,
        chatDifficulty
      );
      const img = getMbtiImage(selectedMbtiPersona, selectedMbtiGender);
      const persona: ScenarioPersona = {
        id: selectedMbtiPersona.id, name: selectedMbtiPersona.mbti,
        role: "동료", department: "", mbti: selectedMbtiPersona.mbti as any,
        gender: selectedMbtiGender,
        image: img || undefined,
        personality: { traits: [], communicationStyle: selectedMbtiPersona.communicationStyle || "", motivation: "", fears: [] },
      } as any;
      chatWindow = (
        <ChatWindow
          scenario={scenario}
          persona={persona}
          conversationId={conversationId}
          onChatComplete={handleExitChat}
          onExit={handleExitChat}
        />
      );
    }

    if (chatWindow) {
      return (
        <div className="relative h-screen overflow-hidden">
          {/* Full-screen chat */}
          {chatWindow}

          {/* Sidebar trigger handle */}
          <button
            onClick={() => setChatSidebarOpen(true)}
            className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center justify-center gap-1 w-5 h-20 bg-white/90 backdrop-blur border border-l-0 border-slate-200 rounded-r-xl shadow-md hover:w-6 hover:bg-white transition-all group"
            title="메뉴 열기"
          >
            <span className="w-0.5 h-3 bg-slate-400 group-hover:bg-emerald-500 rounded-full transition-colors" />
            <span className="w-0.5 h-3 bg-slate-400 group-hover:bg-emerald-500 rounded-full transition-colors" />
            <span className="w-0.5 h-3 bg-slate-400 group-hover:bg-emerald-500 rounded-full transition-colors" />
          </button>

          {/* Backdrop */}
          {chatSidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              onClick={() => setChatSidebarOpen(false)}
            />
          )}

          {/* Sliding sidebar */}
          <aside
            className={`fixed left-0 top-0 h-full w-64 bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${chatSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-slate-100">
              <button
                onClick={() => { setEditingPersona(null); setEditorOpen(true); }}
                className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                <Plus className="w-4 h-4" />
                페르소나 만들기
              </button>
              <button
                onClick={() => setChatSidebarOpen(false)}
                className="ml-2 p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-100">
              {([
                { key: "discover", icon: Compass, label: "탐색" },
                { key: "my", icon: User, label: "내 것" },
                { key: "mbti", icon: Users, label: "MBTI" },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setSidebarTab(tab.key);
                    if (tab.key === "discover") {
                      handleExitChat();
                      setSelectedUserPersona(null);
                      setSelectedMbtiPersona(null);
                      setChatSidebarOpen(false);
                    }
                  }}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors border-b-2 ${sidebarTab === tab.key ? "text-emerald-600 border-emerald-600" : "text-slate-500 border-transparent hover:text-slate-700"}`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search */}
            {sidebarTab !== "discover" && (
              <div className="px-3 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="검색..."
                    className="pl-8 h-8 text-sm bg-slate-50 border-slate-200"
                  />
                </div>
              </div>
            )}

            {/* Persona list */}
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5 mt-1">
              {sidebarTab === "discover" && (
                <div className="text-center py-6 px-3">
                  <Compass className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">탐색 탭을 선택하면<br />홈 화면으로 돌아갑니다</p>
                </div>
              )}

              {sidebarTab === "my" && (
                filteredMy.length === 0 ? (
                  <div className="text-center py-8 px-3">
                    <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">아직 만든 페르소나가 없어요</p>
                  </div>
                ) : filteredMy.map(p => (
                  <UserPersonaCard
                    key={p.id}
                    persona={p}
                    isSelected={selectedUserPersona?.id === p.id}
                    isMine
                    onSelect={() => {
                      setChatSidebarOpen(false);
                      handleExitChat();
                      setTimeout(() => selectUserPersona(p), 50);
                    }}
                    onEdit={() => { setEditingPersona(p); setEditorOpen(true); }}
                    onDelete={() => deleteMutation.mutate(p.id)}
                    onLike={() => likeMutation.mutate(p.id)}
                  />
                ))
              )}

              {sidebarTab === "mbti" && filteredMbti.map(p => {
                const img = getMbtiImage(p, selectedMbtiGender);
                const isSelected = selectedMbtiPersona?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setChatSidebarOpen(false);
                      handleExitChat();
                      setTimeout(() => selectMbtiPersona(p), 50);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left ${isSelected ? "bg-indigo-50 border border-indigo-200" : "hover:bg-slate-50"}`}
                  >
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex-shrink-0 flex items-center justify-center">
                      {img ? <img src={img} alt={p.mbti} className="w-full h-full object-cover" />
                        : <span className="text-xs font-bold text-slate-400">{p.mbti.slice(0, 2)}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 text-sm">{p.mbti}</p>
                      {p.freeChatDescription && <p className="text-xs text-slate-500 truncate">{p.freeChatDescription}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Persona Editor Modal (accessible from chat sidebar too) */}
          {editorOpen && (
            <PersonaEditorModal
              persona={editingPersona}
              onClose={() => setEditorOpen(false)}
              onSaved={(p) => {
                setEditorOpen(false);
                setSidebarTab("my");
              }}
            />
          )}
        </div>
      );
    }
  }

  // ── Main 3-column layout ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <AppHeader />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left Sidebar ─────────────────────────────── */}
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col flex-shrink-0">
          {/* Create button */}
          <div className="p-3 border-b border-slate-100">
            <button
              onClick={() => { setEditingPersona(null); setEditorOpen(true); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" />
              페르소나 만들기
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100">
            {([
              { key: "discover", icon: Compass, label: "탐색" },
              { key: "my", icon: User, label: "내 것" },
              { key: "mbti", icon: Users, label: "MBTI" },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => {
                  setSidebarTab(tab.key);
                  if (tab.key === "discover") {
                    setSelectedUserPersona(null);
                    setSelectedMbtiPersona(null);
                  }
                }}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors border-b-2 ${sidebarTab === tab.key ? "text-emerald-600 border-emerald-600" : "text-slate-500 border-transparent hover:text-slate-700"}`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search — only for my / mbti */}
          {sidebarTab !== "discover" && (
            <div className="px-3 pt-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="검색..."
                  className="pl-8 h-8 text-sm bg-slate-50 border-slate-200"
                />
              </div>
            </div>
          )}

          {/* Persona list — only for my / mbti */}
          {sidebarTab !== "discover" && (
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
              {sidebarTab === "my" && (
                filteredMy.length === 0 ? (
                  <div className="text-center py-8 px-3">
                    <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">아직 만든 페르소나가 없어요</p>
                  </div>
                ) : filteredMy.map(p => (
                  <UserPersonaCard
                    key={p.id}
                    persona={p}
                    isSelected={selectedUserPersona?.id === p.id}
                    isMine
                    onSelect={() => selectUserPersona(p)}
                    onEdit={() => { setEditingPersona(p); setEditorOpen(true); }}
                    onDelete={() => deleteMutation.mutate(p.id)}
                    onLike={() => likeMutation.mutate(p.id)}
                  />
                ))
              )}

              {sidebarTab === "mbti" && filteredMbti.map(p => {
                const img = getMbtiImage(p, selectedMbtiGender);
                const isSelected = selectedMbtiPersona?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => selectMbtiPersona(p)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-left ${isSelected ? "bg-indigo-50 border border-indigo-200" : "hover:bg-slate-50"}`}
                  >
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex-shrink-0 flex items-center justify-center">
                      {img ? <img src={img} alt={p.mbti} className="w-full h-full object-cover" />
                        : <span className="text-xs font-bold text-slate-400">{p.mbti.slice(0, 2)}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 text-sm">{p.mbti}</p>
                      {p.freeChatDescription && <p className="text-xs text-slate-500 truncate">{p.freeChatDescription}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* ── Center: Browse / Detail ───────────────────── */}
        <main className="flex-1 overflow-y-auto">
          {(sidebarTab === "discover" && !selectedUserPersona && !selectedMbtiPersona) || (!selectedUserPersona && !selectedMbtiPersona) ? (
            /* Welcome / discovery grid */
            <div className="max-w-3xl mx-auto px-6 py-10">
              <div className="text-center mb-10">
                <MessageCircle className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
                <h1 className="text-2xl font-bold text-slate-800 mb-2">PersonaX</h1>
                <p className="text-slate-500">AI 캐릭터와 자유롭게 대화하세요. 직접 나만의 캐릭터를 만들어 공유할 수도 있어요.</p>
              </div>

              {discoverPersonas.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <Compass className="w-4 h-4 text-emerald-500" />
                      {discoverSort === "likes" ? "인기 페르소나" : "최신 페르소나"}
                    </h2>
                    <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                      {([["likes", "인기"], ["recent", "최신"]] as const).map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setDiscoverSort(val)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${discoverSort === val ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {discoverPersonas.map(p => (
                      <button
                        key={p.id}
                        onClick={() => selectUserPersona(p)}
                        className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200 hover:border-emerald-300 hover:shadow-sm transition-all text-left"
                      >
                        <PersonaAvatar url={p.avatarUrl} name={p.name} size={10} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-sm truncate">{p.name}</p>
                          <p className="text-xs text-slate-500 truncate">{p.description}</p>
                          <div className="flex items-center gap-1 mt-1 text-slate-400 text-[10px]">
                            <Heart className="w-3 h-3" />{p.likeCount}
                            <MessageSquare className="w-3 h-3 ml-1" />{p.chatCount}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mbtiPersonas.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-500" />MBTI 페르소나
                  </h2>
                  <div className="grid grid-cols-3 gap-2">
                    {mbtiPersonas.slice(0, 6).map(p => {
                      const img = getMbtiImage(p, "male");
                      return (
                        <button
                          key={p.id}
                          onClick={() => selectMbtiPersona(p)}
                          className="flex flex-col items-center gap-2 p-3 bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all"
                        >
                          <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center">
                            {img ? <img src={img} alt={p.mbti} className="w-full h-full object-cover" />
                              : <span className="text-xs font-bold text-slate-400">{p.mbti.slice(0, 2)}</span>}
                          </div>
                          <span className="text-xs font-semibold text-slate-700">{p.mbti}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Persona detail + start chat */
            <div className="max-w-lg mx-auto px-6 py-8">
              {selectedUserPersona && (
                <div>
                  <div className="flex items-start gap-4 mb-6">
                    <PersonaAvatar url={selectedUserPersona.avatarUrl} name={selectedUserPersona.name} size={20} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-2xl font-bold text-slate-900">{selectedUserPersona.name}</h2>
                        {selectedUserPersona.isPublic
                          ? <Badge variant="secondary" className="text-emerald-700 bg-emerald-50"><Globe className="w-3 h-3 mr-1" />공개</Badge>
                          : <Badge variant="secondary" className="text-slate-500"><Lock className="w-3 h-3 mr-1" />비공개</Badge>}
                      </div>
                      <p className="text-slate-500 text-sm">{selectedUserPersona.description}</p>
                      {selectedUserPersona.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {selectedUserPersona.tags.map(tag => (
                            <span key={tag} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{tag}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                        <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{selectedUserPersona.likeCount}</span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{selectedUserPersona.chatCount}번 대화</span>
                      </div>
                    </div>
                  </div>

                  {selectedUserPersona.greeting && (
                    <div className="bg-emerald-50 rounded-xl p-4 mb-6 border border-emerald-100">
                      <p className="text-xs text-emerald-600 font-medium mb-1">첫 인사</p>
                      <p className="text-slate-700 text-sm italic">"{selectedUserPersona.greeting}"</p>
                    </div>
                  )}

                  {selectedUserPersona.personality && (
                    <div className="bg-slate-50 rounded-xl p-4 mb-6">
                      <p className="text-xs text-slate-500 font-medium mb-2">페르소나 정보</p>
                      {selectedUserPersona.personality.traits?.length > 0 && (
                        <p className="text-xs text-slate-600 mb-1"><span className="font-medium">성격:</span> {selectedUserPersona.personality.traits.join(", ")}</p>
                      )}
                      {selectedUserPersona.personality.background && (
                        <p className="text-xs text-slate-600"><span className="font-medium">배경:</span> {selectedUserPersona.personality.background}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {selectedMbtiPersona && (
                <div>
                  <div className="flex items-start gap-4 mb-6">
                    <div className="w-20 h-20 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center flex-shrink-0">
                      {getMbtiImage(selectedMbtiPersona, selectedMbtiGender)
                        ? <img src={getMbtiImage(selectedMbtiPersona, selectedMbtiGender)!} alt={selectedMbtiPersona.mbti} className="w-full h-full object-cover" />
                        : <span className="text-lg font-bold text-slate-400">{selectedMbtiPersona.mbti.slice(0, 2)}</span>}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-1">{selectedMbtiPersona.mbti}</h2>
                      {selectedMbtiPersona.freeChatDescription && <p className="text-slate-500 text-sm">{selectedMbtiPersona.freeChatDescription}</p>}
                      {selectedMbtiPersona.communicationStyle && <p className="text-xs text-slate-400 mt-1">{selectedMbtiPersona.communicationStyle}</p>}
                    </div>
                  </div>

                  {/* Gender selection for MBTI */}
                  <div className="mb-4">
                    <p className="text-sm font-medium text-slate-700 mb-2">성별 선택</p>
                    <div className="flex gap-2">
                      {(["male", "female"] as const).map(g => (
                        <button key={g} onClick={() => setSelectedMbtiGender(g)}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${selectedMbtiGender === g ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                          {g === "male" ? "남성" : "여성"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Chat settings */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5">
                <p className="text-sm font-semibold text-slate-800 mb-3">대화 설정</p>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-2">모드</p>
                    <div className="flex gap-2">
                      {([
                        { v: "text", icon: MessageSquare, label: "텍스트" },
                        { v: "tts", icon: Volume2, label: "TTS" },
                        { v: "realtime_voice", icon: Mic, label: "음성" },
                      ] as const).map(opt => (
                        <button key={opt.v} onClick={() => setChatMode(opt.v)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all border ${chatMode === opt.v ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                          <opt.icon className="w-3.5 h-3.5" />{opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-2">난이도</p>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(d => (
                        <button key={d} onClick={() => setChatDifficulty(d)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${chatDifficulty === d ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                          {d}단계
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 유저 페르소나 — 이어하기/새 대화 분기 */}
              {selectedUserPersona && getSavedConvId(selectedUserPersona.id) ? (
                <div className="space-y-2">
                  <button
                    onClick={handleStartChat}
                    disabled={isPending}
                    className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors"
                  >
                    {isPending
                      ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />대화 준비 중...</>
                      : <><MessageSquare className="w-4 h-4" />이어서 대화하기</>}
                  </button>
                  <button
                    onClick={handleStartNewChat}
                    disabled={isPending}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-600 rounded-xl text-sm transition-colors"
                  >
                    <i className="fas fa-plus text-xs"></i>
                    새 대화 시작
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleStartChat}
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors"
                >
                  {isPending
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />대화 준비 중...</>
                    : <><MessageSquare className="w-4 h-4" />대화 시작</>}
                </button>
              )}

              <button onClick={() => { setSelectedUserPersona(null); setSelectedMbtiPersona(null); }}
                className="w-full mt-2 py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors">
                취소
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Persona Editor Modal */}
      {editorOpen && (
        <PersonaEditorModal
          persona={editingPersona}
          onClose={() => setEditorOpen(false)}
          onSaved={(p) => {
            setEditorOpen(false);
            selectUserPersona(p);
            setSidebarTab("my");
          }}
        />
      )}
    </div>
  );
}
