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

const SCENE_IMAGE_MAP: Record<string, string> = {
  "sample-scene-rainy-cafe": "/scenes/rainy-cafe.png",
  "sample-scene-midnight-store": "/scenes/midnight-store.png",
  "sample-scene-magic-library": "/scenes/magic-library.png",
  "sample-scene-space-observatory": "/scenes/space-observatory.png",
  "sample-scene-detective-office": "/scenes/detective-office.png",
  "sample-scene-hangang-night": "/scenes/hangang-night.png",
  "sample-scene-snowy-lodge": "/scenes/snowy-lodge.png",
  "sample-scene-deep-sea-lab": "/scenes/deep-sea-lab.png",
  "sample-scene-jazz-bar": "/scenes/jazz-bar.png",
  "sample-scene-ruined-kingdom": "/scenes/ruined-kingdom.png",
};

const GENRE_FALLBACK_MAP: Record<string, string> = {
  "로맨스": "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800&h=1400&fit=crop&auto=format",
  "판타지": "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800&h=1400&fit=crop&auto=format",
  "미스터리": "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=800&h=1400&fit=crop&auto=format",
  "SF": "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&h=1400&fit=crop&auto=format",
  "일상": "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&h=1400&fit=crop&auto=format",
  "직장": "https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=1400&fit=crop&auto=format",
  "학교": "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=800&h=1400&fit=crop&auto=format",
  "역사": "https://images.unsplash.com/photo-1464817739973-0128fe77aaa1?w=800&h=1400&fit=crop&auto=format",
};
const DEFAULT_SCENE_IMAGE = "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&h=1400&fit=crop&auto=format";

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

  const sceneImage = SCENE_IMAGE_MAP[id!] ?? (
    Object.entries(GENRE_FALLBACK_MAP).find(([k]) => scene.genre.includes(k))?.[1] ?? DEFAULT_SCENE_IMAGE
  );

  return (
    <>
      <PersonaLayout>
        {/* ── 전체화면 히어로 이미지 ─────────────────── */}
        <div className="relative w-full h-[62svh] min-h-[380px] overflow-hidden">
          <img
            src={sceneImage}
            alt={scene.title}
            className="w-full h-full object-cover"
          />
          {/* 상단 어둠 + 하단 slate-950으로 자연스럽게 연결 */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-slate-950" />

          {/* 플로팅 네비게이션 */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-5 z-10">
            <Link href="/persona/scenes">
              <button className="flex items-center gap-1.5 text-sm text-white/90 hover:text-white bg-black/35 backdrop-blur-md px-3.5 py-2 rounded-full border border-white/20 transition-colors">
                <ChevronLeft className="w-4 h-4" />장면 목록
              </button>
            </Link>
            {isMine && (
              <div className="flex items-center gap-2">
                <Link href={`/persona/scene/${id}/edit`}>
                  <button className="p-2.5 rounded-full bg-black/35 backdrop-blur-md border border-white/20 text-white/80 hover:text-white transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                </Link>
                <button
                  className="p-2.5 rounded-full bg-black/35 backdrop-blur-md border border-white/20 text-red-300 hover:text-red-200 transition-colors"
                  onClick={() => { if (confirm("이 장면을 삭제하시겠어요?")) deleteMutation.mutate(); }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* 이미지 하단 제목 오버레이 */}
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-7">
            <div className="flex items-center gap-2.5 mb-3">
              <Badge className="bg-emerald-500/90 text-white text-xs font-semibold backdrop-blur-sm px-2.5 py-1">
                {scene.genre}
              </Badge>
              {scene.isPublic
                ? <span className="flex items-center gap-1 text-xs text-white/55"><Globe className="w-3 h-3" />공개</span>
                : <span className="flex items-center gap-1 text-xs text-white/55"><Lock className="w-3 h-3" />비공개</span>
              }
              <span className="flex items-center gap-1 text-xs text-white/40 ml-auto">
                <MessageSquare className="w-3 h-3" />{scene.useCount}회 사용
              </span>
            </div>
            <h1 className="text-[28px] font-bold text-white leading-tight tracking-tight drop-shadow-lg">
              {scene.title}
            </h1>
            {scene.description && (
              <p className="text-white/65 text-sm mt-2 leading-relaxed line-clamp-2">{scene.description}</p>
            )}
          </div>
        </div>

        {/* ── 다크 컨텐츠 영역 ──────────────────────── */}
        <div className="bg-slate-950 px-5 pt-7 pb-36 space-y-8">

          {/* 분위기 */}
          {scene.mood && (
            <div className="flex items-center gap-2.5">
              <Wind className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="text-emerald-400 text-sm font-medium">{scene.mood}</span>
            </div>
          )}

          {/* 배경 상황 */}
          {scene.setting && (
            <div>
              <h3 className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.15em] mb-3 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />배경 상황
              </h3>
              <p className="text-slate-300 text-sm leading-[1.8] font-light">{scene.setting}</p>
            </div>
          )}

          {/* 첫 대사 - 시네마틱 인용구 */}
          {scene.openingLine && (
            <div className="relative pl-5 border-l-2 border-emerald-500/50 py-1">
              <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.15em] mb-2.5">첫 대사</p>
              <p className="text-white/85 text-[15px] italic leading-[1.85] font-light">
                "{scene.openingLine}"
              </p>
            </div>
          )}

          {/* 태그 */}
          {scene.tags && scene.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {scene.tags.map(tag => (
                <span
                  key={tag}
                  className="text-xs bg-white/[0.07] text-slate-400 px-3 py-1.5 rounded-full border border-white/[0.08]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </PersonaLayout>

      {/* ── 플로팅 CTA ─────────────────────────────── */}
      <div className="fixed bottom-[68px] md:bottom-6 left-0 right-0 px-5 z-30 pointer-events-none">
        <Button
          onClick={() => setCharacterModalOpen(true)}
          className="w-full h-14 bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-white text-base font-bold gap-2.5 rounded-2xl shadow-2xl shadow-emerald-500/25 transition-all pointer-events-auto"
        >
          <Play className="w-5 h-5 fill-white stroke-none" />
          이 장면으로 대화 시작
        </Button>
      </div>

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
