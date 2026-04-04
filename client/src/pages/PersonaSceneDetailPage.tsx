import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import PersonaLayout from "@/components/PersonaLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft, MapPin, Wind, MessageSquare, Globe, Lock,
  Play, Pencil, Trash2, X, Search, Loader2, User, Heart
} from "lucide-react";

interface PersonaUserScene {
  id: string;
  creatorId: string;
  title: string;
  description: string;
  setting: string;
  mood: string;
  openingLine: string;
  genre: string;
  tags: string[];
  isPublic: boolean;
  useCount: number;
  createdAt: string;
}

interface UserPersona {
  id: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  tags: string[];
  likeCount: number;
  chatCount: number;
}

function PersonaAvatar({ url, name, size = 12 }: { url?: string | null; name: string; size?: number }) {
  const px = size * 4;
  if (url) {
    return <img src={toMediaUrl(url)} alt={name} className="rounded-full object-cover" style={{ width: px, height: px }} />;
  }
  return (
    <div className="rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold" style={{ width: px, height: px, fontSize: px * 0.35 }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function PersonaSceneDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [characterModalOpen, setCharacterModalOpen] = useState(false);

  const { data: scene, isLoading } = useQuery<PersonaUserScene>({
    queryKey: ["/api/persona-user-scenes", id],
    queryFn: () => apiRequest("GET", `/api/persona-user-scenes/${id}`).then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/persona-user-scenes/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/persona-user-scenes"] });
      toast({ title: "장면이 삭제됐어요." });
      navigate("/persona/scenes");
    },
    onError: (err: any) => {
      toast({ title: "삭제 실패", description: err.message, variant: "destructive" });
    },
  });

  const isMine = scene?.creatorId === user?.id;

  if (isLoading) {
    return (
      <PersonaLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      </PersonaLayout>
    );
  }

  if (!scene) {
    return (
      <PersonaLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-slate-500 mb-4">장면을 찾을 수 없어요.</p>
          <Link href="/persona/scenes">
            <Button variant="outline">장면 목록으로</Button>
          </Link>
        </div>
      </PersonaLayout>
    );
  }

  return (
    <>
      <PersonaLayout>
        <div className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
          {/* Back */}
          <div className="flex items-center justify-between">
            <Link href="/persona/scenes">
              <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
                <ChevronLeft className="w-4 h-4" />
                장면 목록
              </button>
            </Link>
            {isMine && (
              <div className="flex items-center gap-2">
                <Link href={`/persona/scene/${id}/edit`}>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Pencil className="w-3.5 h-3.5" />수정
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => {
                    if (confirm("이 장면을 삭제하시겠어요?")) deleteMutation.mutate();
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />삭제
                </Button>
              </div>
            )}
          </div>

          {/* Scene Info Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Scene header */}
            <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white">
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-white/20 text-white text-xs">{scene.genre}</Badge>
                {scene.isPublic
                  ? <span className="flex items-center gap-1 text-xs text-white/70"><Globe className="w-3 h-3" />공개</span>
                  : <span className="flex items-center gap-1 text-xs text-white/70"><Lock className="w-3 h-3" />비공개</span>
                }
              </div>
              <h1 className="text-2xl font-bold mb-1">{scene.title}</h1>
              {scene.description && (
                <p className="text-white/80 text-sm">{scene.description}</p>
              )}
              <div className="flex items-center gap-3 mt-3 text-white/60 text-xs">
                <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{scene.useCount}회 사용됨</span>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {scene.setting && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />배경 상황
                  </h3>
                  <p className="text-sm text-slate-700 leading-relaxed">{scene.setting}</p>
                </div>
              )}

              {scene.mood && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Wind className="w-3.5 h-3.5" />분위기
                  </h3>
                  <p className="text-sm text-slate-700">{scene.mood}</p>
                </div>
              )}

              {scene.openingLine && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />첫 대사
                  </h3>
                  <p className="text-sm text-emerald-700 italic bg-emerald-50 rounded-xl px-4 py-3 leading-relaxed">
                    "{scene.openingLine}"
                  </p>
                </div>
              )}

              {scene.tags && scene.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  {scene.tags.map(tag => (
                    <span key={tag} className="text-xs bg-slate-50 text-slate-500 px-2.5 py-1 rounded-full">#{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* CTA */}
          <Button
            onClick={() => setCharacterModalOpen(true)}
            className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-semibold gap-2"
          >
            <Play className="w-5 h-5" />
            이 장면으로 대화 시작
          </Button>
        </div>
      </PersonaLayout>

      {/* Character selection modal */}
      {characterModalOpen && (
        <CharacterSelectModal
          sceneId={id!}
          scene={scene}
          onClose={() => setCharacterModalOpen(false)}
        />
      )}
    </>
  );
}

function CharacterSelectModal({ sceneId, scene, onClose }: { sceneId: string; scene: PersonaUserScene; onClose: () => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: publicPersonas = [], isLoading: loadingPublic } = useQuery<UserPersona[]>({
    queryKey: ["/api/user-personas/discover"],
    queryFn: () => apiRequest("GET", "/api/user-personas/discover?sort=likes").then(r => r.json()),
  });

  const { data: myPersonas = [] } = useQuery<UserPersona[]>({
    queryKey: ["/api/user-personas"],
    queryFn: () => apiRequest("GET", "/api/user-personas").then(r => r.json()),
  });

  const handleSelectCharacter = (persona: UserPersona) => {
    onClose();
    navigate(`/free-chat?sceneId=${sceneId}&personaId=${persona.id}`);
  };

  const allPersonas = [...myPersonas, ...publicPersonas.filter(p => !myPersonas.some(m => m.id === p.id))];
  const filtered = allPersonas.filter(p =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85dvh] flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">캐릭터 선택</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="font-medium text-emerald-600">"{scene.title}"</span> 장면에서 대화할 캐릭터를 선택하세요
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="캐릭터 검색..."
              className="pl-9 h-9"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loadingPublic ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <User className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">캐릭터가 없어요</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(persona => (
                <button
                  key={persona.id}
                  onClick={() => handleSelectCharacter(persona)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-emerald-50 transition-colors text-left group"
                >
                  <PersonaAvatar url={persona.avatarUrl} name={persona.name} size={10} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm truncate group-hover:text-emerald-700">{persona.name}</p>
                    <p className="text-xs text-slate-500 truncate">{persona.description || "설명 없음"}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
                      <span className="flex items-center gap-0.5"><Heart className="w-2.5 h-2.5" />{persona.likeCount}</span>
                      <span className="flex items-center gap-0.5"><MessageSquare className="w-2.5 h-2.5" />{persona.chatCount}</span>
                    </div>
                  </div>
                  <Play className="w-4 h-4 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
