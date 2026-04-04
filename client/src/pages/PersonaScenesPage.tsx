import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import PersonaLayout from "@/components/PersonaLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Plus, Globe, User, Compass, MapPin, Wind,
  Pencil, Trash2, Play, Loader2, MessageSquare
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

const GENRES = ["전체", "로맨스", "판타지", "미스터리", "SF", "일상", "직장", "학교", "역사"];

type SceneTab = "all" | "mine";

export default function PersonaScenesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const urlParams = new URLSearchParams(window.location.search);
  const tabFromUrl = urlParams.get("tab") as SceneTab | null;

  const [activeTab, setActiveTab] = useState<SceneTab>(tabFromUrl || "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState("전체");

  useEffect(() => {
    if (tabFromUrl && ["all", "mine"].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: publicScenes = [], isLoading: loadingPublic } = useQuery<PersonaUserScene[]>({
    queryKey: ["/api/persona-user-scenes", genreFilter, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (genreFilter !== "전체") params.set("genre", genreFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiRequest("GET", `/api/persona-user-scenes?${params}`).then(r => r.json());
    },
  });

  const { data: myScenes = [], isLoading: loadingMine } = useQuery<PersonaUserScene[]>({
    queryKey: ["/api/persona-user-scenes", "mine", debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({ mine: "true" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiRequest("GET", `/api/persona-user-scenes?${params}`).then(r => r.json());
    },
    enabled: activeTab === "mine",
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/persona-user-scenes/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/persona-user-scenes"] });
      toast({ title: "장면이 삭제됐어요." });
    },
    onError: (err: any) => {
      toast({ title: "삭제 실패", description: err.message, variant: "destructive" });
    },
  });

  const isLoading = activeTab === "all" ? loadingPublic : loadingMine;
  const scenes = activeTab === "all" ? publicScenes : myScenes;

  return (
    <PersonaLayout>
      <div className="max-w-6xl mx-auto w-full px-3 sm:px-6 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">장면 탐색</h1>
            <p className="text-slate-500 text-sm mt-0.5">다양한 장면으로 캐릭터와 특별한 대화를 시작해보세요</p>
          </div>
          <Link href="/persona/scene/create">
            <Button className="bg-emerald-600 hover:bg-emerald-700 gap-2 whitespace-nowrap">
              <Plus className="w-4 h-4" />
              장면 만들기
            </Button>
          </Link>
        </div>

        {/* Search + Tabs */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="장면 검색..."
              className="pl-10 bg-white"
            />
          </div>
          <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1">
            <button
              onClick={() => setActiveTab("all")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "all" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Compass className="w-3.5 h-3.5" />전체
            </button>
            <button
              onClick={() => setActiveTab("mine")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === "mine" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <User className="w-3.5 h-3.5" />내 장면
            </button>
          </div>
        </div>

        {/* Genre filter */}
        {activeTab === "all" && (
          <div className="flex gap-2 flex-wrap">
            {GENRES.map(g => (
              <button
                key={g}
                onClick={() => setGenreFilter(g)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  genreFilter === g
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          </div>
        ) : scenes.length === 0 ? (
          <div className="text-center py-16">
            <Compass className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            {activeTab === "mine" ? (
              <>
                <p className="text-slate-500 mb-4">아직 만든 장면이 없어요</p>
                <Link href="/persona/scene/create">
                  <Button className="bg-emerald-600 hover:bg-emerald-700 gap-2">
                    <Plus className="w-4 h-4" />첫 장면 만들기
                  </Button>
                </Link>
              </>
            ) : (
              <p className="text-slate-500">{searchQuery ? "검색 결과가 없어요" : "공개된 장면이 없어요"}</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {scenes.map(scene => (
              <SceneCard
                key={scene.id}
                scene={scene}
                isMine={scene.creatorId === user?.id}
                onDelete={() => {
                  if (confirm("이 장면을 삭제하시겠어요?")) {
                    deleteMutation.mutate(scene.id);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </PersonaLayout>
  );
}

function SceneCard({ scene, isMine, onDelete }: {
  scene: PersonaUserScene;
  isMine: boolean;
  onDelete: () => void;
}) {
  return (
    <Link href={`/persona/scene/${scene.id}`}>
      <div className="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer h-full flex flex-col">
        <div className="p-4 flex-1">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-emerald-100 text-emerald-700 text-[10px] font-medium">{scene.genre}</Badge>
              {!scene.isPublic && (
                <Badge variant="outline" className="text-[10px] text-slate-400 border-slate-200">비공개</Badge>
              )}
            </div>
            {isMine && (
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.preventDefault()}>
                <Link href={`/persona/scene/${scene.id}/edit`}>
                  <button
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                    title="수정"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </Link>
                <button
                  onClick={onDelete}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="삭제"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <h3 className="font-bold text-slate-800 text-sm mb-1.5 line-clamp-2 group-hover:text-emerald-700 transition-colors">
            {scene.title}
          </h3>

          {scene.setting && (
            <div className="flex items-start gap-1.5 text-xs text-slate-500 mb-2">
              <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0 text-slate-400" />
              <p className="line-clamp-2 leading-relaxed">{scene.setting}</p>
            </div>
          )}

          {scene.mood && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
              <Wind className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{scene.mood}</span>
            </div>
          )}

          {scene.tags && scene.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {scene.tags.slice(0, 3).map(tag => (
                <span key={tag} className="text-[10px] bg-slate-50 text-slate-500 px-1.5 py-0.5 rounded-full">#{tag}</span>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <MessageSquare className="w-3 h-3" />
            <span>{scene.useCount}회 사용</span>
          </div>
          <div className="flex items-center gap-1 text-xs font-medium text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play className="w-3 h-3" />
            대화 시작
          </div>
        </div>
      </div>
    </Link>
  );
}
