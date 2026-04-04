import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import PersonaLayout from "@/components/PersonaLayout";
import PersonaEditorModal, { type PersonaEditData } from "@/components/PersonaEditorModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import {
  Search, Heart, MessageSquare, Plus, Sparkles,
  ChevronRight, Star, Compass, User, Globe, Pencil, Film, Wind
} from "lucide-react";

interface PersonaUserScene {
  id: string;
  title: string;
  description: string;
  genre: string;
  mood: string;
  tags: string[];
  isPublic: boolean;
  useCount: number;
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
  "로맨스": "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=400&h=600&fit=crop&auto=format",
  "판타지": "https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&h=600&fit=crop&auto=format",
  "미스터리": "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=400&h=600&fit=crop&auto=format",
  "SF": "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&h=600&fit=crop&auto=format",
  "일상": "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&h=600&fit=crop&auto=format",
  "직장": "https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&h=600&fit=crop&auto=format",
  "학교": "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=400&h=600&fit=crop&auto=format",
  "역사": "https://images.unsplash.com/photo-1464817739973-0128fe77aaa1?w=400&h=600&fit=crop&auto=format",
};

function getSceneImage(scene: PersonaUserScene): string {
  if (SCENE_IMAGE_MAP[scene.id]) return SCENE_IMAGE_MAP[scene.id];
  const genreKey = Object.keys(GENRE_FALLBACK_MAP).find(k => scene.genre.includes(k));
  return genreKey ? GENRE_FALLBACK_MAP[genreKey] : GENRE_FALLBACK_MAP["일상"];
}

interface UserPersona {
  id: string;
  creatorId: string;
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

type CategoryTab = "all" | "community" | "mine";

const CATEGORY_TABS: { key: CategoryTab; label: string; icon: React.ElementType }[] = [
  { key: "all", label: "전체", icon: Compass },
  { key: "community", label: "커뮤니티", icon: Globe },
  { key: "mine", label: "내 캐릭터", icon: User },
];

export default function PersonaDiscoveryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const urlParams = new URLSearchParams(window.location.search);
  const tabFromUrl = urlParams.get("tab") as CategoryTab | null;

  const [activeTab, setActiveTab] = useState<CategoryTab>(tabFromUrl || "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [editingPersona, setEditingPersona] = useState<UserPersona | null>(null);

  useEffect(() => {
    if (tabFromUrl && ["all", "community", "mine"].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  const buildDiscoverUrl = (tagParam: string) => {
    const params = new URLSearchParams({ sort: "likes" });
    if (tagParam) params.set("tag", tagParam);
    return `/api/user-personas/discover?${params.toString()}`;
  };

  const { data: featuredPersonas = [] } = useQuery<UserPersona[]>({
    queryKey: ["/api/user-personas/featured"],
    queryFn: () => apiRequest("GET", "/api/user-personas/featured").then(r => r.json()),
  });

  const { data: discoverPersonas = [] } = useQuery<UserPersona[]>({
    queryKey: ["/api/user-personas/discover", tagFilter],
    queryFn: () => apiRequest("GET", buildDiscoverUrl(tagFilter)).then(r => r.json()),
  });

  const { data: myPersonas = [] } = useQuery<UserPersona[]>({
    queryKey: ["/api/user-personas"],
    queryFn: () => apiRequest("GET", "/api/user-personas").then(r => r.json()),
  });

  const { data: publicScenes = [] } = useQuery<PersonaUserScene[]>({
    queryKey: ["/api/persona-user-scenes", "home"],
    queryFn: () => apiRequest("GET", "/api/persona-user-scenes?public=true").then(r => r.json()),
  });

  const likeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/user-personas/${id}/like`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas/discover"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas/featured"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user-personas"] });
    },
  });

  const q = searchQuery.toLowerCase();

  const filteredCommunity = discoverPersonas.filter(p =>
    !q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q) || p.tags?.some(t => t.toLowerCase().includes(q))
  );

  const filteredMine = myPersonas.filter(p =>
    !q || p.name.toLowerCase().includes(q)
  );

  const featured = featuredPersonas[featuredIndex];

  const handleLike = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    likeMutation.mutate(id);
  };

  return (
    <>
    <PersonaLayout>
      <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 py-6 space-y-8">

        {/* ── Featured Banner ── */}
        {featuredPersonas.length > 0 && activeTab === "all" && (
          <section className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg">
            {featured && (
              <div className="flex items-center gap-6 p-6 md:p-8">
                <div className="flex-shrink-0">
                  {featured.avatarUrl ? (
                    <img
                      src={toMediaUrl(featured.avatarUrl)}
                      alt={featured.name}
                      className="w-20 h-20 rounded-full object-cover ring-4 ring-white/30"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-2xl">
                      {featured.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Star className="w-4 h-4 text-yellow-300 fill-yellow-300" />
                    <span className="text-sm font-medium text-emerald-100">Featured</span>
                  </div>
                  <h2 className="text-2xl font-bold truncate">{featured.name}</h2>
                  <p className="text-emerald-100 text-sm mt-1 line-clamp-2">{featured.description}</p>
                  <div className="flex items-center gap-4 mt-3 text-sm text-emerald-200">
                    <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{featured.likeCount}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{featured.chatCount}번 대화</span>
                  </div>
                  <div className="mt-4">
                    <Link href={`/persona/${featured.id}`}>
                      <Button size="sm" className="bg-white text-emerald-700 hover:bg-emerald-50 font-semibold">
                        프로필 보기 <ChevronRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
                {featuredPersonas.length > 1 && (
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {featuredPersonas.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setFeaturedIndex(i)}
                        className={`h-2 rounded-full transition-all ${i === featuredIndex ? "bg-white w-5" : "bg-white/40 w-2"}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── Search + CTA ── */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="캐릭터 검색..."
              className="pl-10 bg-white"
            />
          </div>
          <Link href="/persona/create">
            <Button className="bg-emerald-600 hover:bg-emerald-700 gap-2 whitespace-nowrap">
              <Plus className="w-4 h-4" />
              캐릭터 만들기
            </Button>
          </Link>
        </div>

        {/* ── Category Tabs ── */}
        <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 w-full sm:w-fit overflow-x-auto">
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Grid ── */}

        {activeTab === "all" && (
          <div className="space-y-8">
            {/* ── 장면 섹션 ── */}
            {publicScenes.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <Film className="w-4 h-4 text-emerald-500" />인기 장면
                  </h3>
                  <Link href="/persona/scenes">
                    <span className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-0.5 cursor-pointer">
                      전체 보기<ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </Link>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 scrollbar-none snap-x snap-mandatory">
                  {publicScenes.slice(0, 10).map(scene => (
                    <SceneMiniCard key={scene.id} scene={scene} />
                  ))}
                  {/* 더 보기 카드 */}
                  <Link href="/persona/scenes">
                    <div className="flex-shrink-0 w-[130px] h-[195px] rounded-2xl bg-slate-100 border border-slate-200 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-emerald-50 hover:border-emerald-300 transition-colors snap-start">
                      <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
                        <ChevronRight className="w-5 h-5 text-emerald-600" />
                      </div>
                      <span className="text-xs text-slate-500 font-medium text-center leading-snug px-2">장면<br/>더 보기</span>
                    </div>
                  </Link>
                </div>
              </div>
            )}

            {/* ── 커뮤니티 캐릭터 ── */}
            {filteredCommunity.length > 0 && (
              <div>
                <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-500" />커뮤니티 캐릭터
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filteredCommunity.map(p => (
                    <PersonaCard
                      key={p.id}
                      persona={p}
                      onLike={handleLike}
                      isMine={isAdmin && p.creatorId === 'system'}
                      onEdit={isAdmin && p.creatorId === 'system' ? (e) => { e.preventDefault(); e.stopPropagation(); setEditingPersona(p); } : undefined}
                    />
                  ))}
                </div>
              </div>
            )}
            {filteredCommunity.length === 0 && (
              <EmptyState message="검색 결과가 없어요" />
            )}
          </div>
        )}

        {activeTab === "community" && (
          <div className="space-y-4">
            {discoverPersonas.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setTagFilter("")}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${!tagFilter ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"}`}
                >
                  전체
                </button>
                {Array.from(new Set(discoverPersonas.flatMap(p => p.tags ?? []))).slice(0, 10).map(tag => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${tagFilter === tag ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"}`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
            {filteredCommunity.length === 0 ? (
              <EmptyState message="공개된 커뮤니티 캐릭터가 없어요" />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredCommunity.map(p => (
                  <PersonaCard
                    key={p.id}
                    persona={p}
                    onLike={handleLike}
                    isMine={isAdmin && p.creatorId === 'system'}
                    onEdit={isAdmin && p.creatorId === 'system' ? (e) => { e.preventDefault(); e.stopPropagation(); setEditingPersona(p); } : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "mine" && (
          filteredMine.length === 0 ? (
            <div className="text-center py-16">
              <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 mb-4">아직 만든 캐릭터가 없어요</p>
              <Link href="/persona/create">
                <Button className="bg-emerald-600 hover:bg-emerald-700 gap-2">
                  <Plus className="w-4 h-4" />첫 캐릭터 만들기
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filteredMine.map(p => (
                <PersonaCard
                  key={p.id}
                  persona={p}
                  onLike={handleLike}
                  isMine
                  onEdit={(e) => { e.preventDefault(); e.stopPropagation(); setEditingPersona(p); }}
                />
              ))}
            </div>
          )
        )}

      </div>
    </PersonaLayout>
    {editingPersona && (
      <PersonaEditorModal
        persona={editingPersona as PersonaEditData}
        onClose={() => setEditingPersona(null)}
        onSaved={() => {
          setEditingPersona(null);
          queryClient.invalidateQueries({ queryKey: ["/api/user-personas"] });
          queryClient.invalidateQueries({ queryKey: ["/api/user-personas/discover"] });
          queryClient.invalidateQueries({ queryKey: ["/api/user-personas/featured"] });
        }}
      />
    )}
    </>
  );
}

function PersonaCard({ persona, onLike, isMine, onEdit }: {
  persona: UserPersona;
  onLike: (e: React.MouseEvent, id: string) => void;
  isMine?: boolean;
  onEdit?: (e: React.MouseEvent) => void;
}) {
  const isSystem = persona.creatorId === 'system';
  return (
    <Link href={`/persona/${persona.id}`}>
      <div className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer">
        <div className="aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 relative overflow-hidden">
          {persona.avatarUrl ? (
            <img
              src={toMediaUrl(persona.avatarUrl)}
              alt={persona.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-teal-600">
              <span className="text-white font-bold text-4xl">{persona.name.slice(0, 2).toUpperCase()}</span>
            </div>
          )}
          <button
            onClick={e => onLike(e, persona.id)}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/30 backdrop-blur-sm text-white hover:bg-black/50 transition-colors"
          >
            <Heart className={`w-3.5 h-3.5 ${persona.liked ? "fill-red-400 text-red-400" : ""}`} />
          </button>
          {isMine && (
            <div className="absolute top-2 left-2 flex items-center gap-1">
              <Badge className={`${isSystem ? "bg-violet-600" : "bg-emerald-600"} text-white text-[10px] px-1.5 py-0.5`}>
                {isSystem ? "샘플" : "내 캐릭터"}
              </Badge>
              {onEdit && (
                <button
                  onClick={onEdit}
                  className="p-1 rounded-full bg-white/90 text-emerald-700 hover:bg-white shadow-sm transition-colors"
                  title="편집"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="p-3">
          <h4 className="font-semibold text-slate-800 text-sm truncate">{persona.name}</h4>
          <p className="text-xs text-slate-500 truncate mt-0.5">{persona.description || "설명 없음"}</p>
          {persona.tags?.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {persona.tags.slice(0, 2).map(tag => (
                <span key={tag} className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full">{tag}</span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 mt-2 text-slate-400 text-[11px]">
            <span className="flex items-center gap-0.5"><Heart className="w-3 h-3" />{persona.likeCount}</span>
            <span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3" />{persona.chatCount}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function SceneMiniCard({ scene }: { scene: PersonaUserScene }) {
  return (
    <Link href={`/persona/scene/${scene.id}`}>
      <div className="group flex-shrink-0 w-[130px] rounded-2xl overflow-hidden cursor-pointer relative snap-start shadow-sm hover:shadow-md transition-shadow">
        {/* 이미지 */}
        <div className="h-[195px] relative overflow-hidden">
          <img
            src={getSceneImage(scene)}
            alt={scene.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
          {/* 상단 장르 뱃지 */}
          <div className="absolute top-2 left-2 right-2">
            <Badge className="bg-emerald-500/90 text-white text-[9px] font-medium px-1.5 py-0.5 backdrop-blur-sm w-fit max-w-full truncate">
              {scene.genre.split("/")[0]}
            </Badge>
          </div>
          {/* 하단 제목 */}
          <div className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
            <p className="text-white text-xs font-semibold leading-snug line-clamp-2 drop-shadow">
              {scene.title}
            </p>
            {scene.mood && (
              <p className="text-white/60 text-[10px] mt-1 flex items-center gap-0.5 truncate">
                <Wind className="w-2.5 h-2.5 flex-shrink-0" />{scene.mood}
              </p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-16">
      <Compass className="w-12 h-12 text-slate-300 mx-auto mb-3" />
      <p className="text-slate-500">{message}</p>
    </div>
  );
}
