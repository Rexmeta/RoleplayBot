import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import { Input } from "@/components/ui/input";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import {
  Home, Plus, User, Users, Search, MessageSquare,
  PanelLeftClose, PanelLeft, Clock,
  Menu, X
} from "lucide-react";

interface RecentChat {
  id: string;
  scenarioId: string;
  scenarioName: string;
  personaSnapshot?: { name?: string; avatarUrl?: string } | null;
  createdAt: string;
  status: string;
}

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "홈", icon: Home, href: "/persona" },
  { key: "create", label: "만들기", icon: Plus, href: "/persona/create" },
  { key: "mine", label: "내 캐릭터", icon: User, href: "/persona?tab=mine" },
  { key: "mbti", label: "MBTI", icon: Users, href: "/persona?tab=mbti" },
];

function getActiveNav(location: string): string {
  if (location === "/persona/create") return "create";
  if (location.includes("tab=mine")) return "mine";
  if (location.includes("tab=mbti")) return "mbti";
  if (location === "/persona" || location.startsWith("/persona/")) return "home";
  return "home";
}

function chatDisplayName(c: RecentChat): string {
  if (c.personaSnapshot?.name) return c.personaSnapshot.name;
  const title = c.scenarioName || "";
  return title.replace(/와의 대화$|와의 자유 대화$/, "") || "캐릭터";
}

function chatPersonaId(c: RecentChat): string {
  if (c.scenarioId.startsWith("__user_persona__:")) return c.scenarioId.replace("__user_persona__:", "");
  if (c.scenarioId.startsWith("__mbti_persona__:")) return c.scenarioId.replace("__mbti_persona__:", "");
  return c.id;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return `${Math.floor(days / 7)}주 전`;
}

function SwitchingHeader() {
  const [, navigate] = useLocation();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="px-4 py-3 flex items-center justify-between">
        <div
          className="flex items-center"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className={`flex items-center rounded-xl p-1 gap-0.5 transition-all duration-200 ${isHovered ? "bg-slate-100" : "bg-transparent"}`}>
            <button
              onClick={() => navigate("/home")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-200 ${
                isHovered ? "text-slate-500 hover:bg-slate-200 hover:text-slate-700" : "hidden"
              }`}
            >
              <span className="text-base">🎭</span>
              <span>RoleplayX</span>
            </button>
            <button
              onClick={() => navigate("/persona")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-emerald-600 text-white shadow-sm transition-all duration-200"
            >
              <span className="text-base">💬</span>
              <span>PersonaX</span>
            </button>
          </div>
        </div>
        <UserProfileMenu />
      </div>
    </header>
  );
}

export default function PersonaLayout({ children, chatMode = false }: { children: React.ReactNode; chatMode?: boolean }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  const activeNav = getActiveNav(location + window.location.search);

  useEffect(() => {
    if (!drawerOpen) return;
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [drawerOpen]);

  const { data: allConversations = [] } = useQuery<RecentChat[]>({
    queryKey: ["/api/conversations"],
  });

  const recentChats = allConversations
    .filter(c => c.scenarioId.startsWith("__user_persona__:") || c.scenarioId.startsWith("__mbti_persona__:"))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15);

  const filteredChats = searchQuery
    ? recentChats.filter(c => {
        const name = chatDisplayName(c);
        return name.toLowerCase().includes(searchQuery.toLowerCase());
      })
    : recentChats;

  const sidebarContent = (isOverlay: boolean) => (
    <>
      {/* Toggle + Brand */}
      <div className={`flex items-center h-12 px-3 border-b border-white/10 ${!isOverlay && collapsed ? "justify-center" : "justify-between"}`}>
        {(isOverlay || !collapsed) && (
          <Link href="/persona">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => isOverlay && setDrawerOpen(false)}>
              <span className="text-lg">💬</span>
              <span className="text-base font-bold tracking-tight">PersonaX</span>
            </div>
          </Link>
        )}
        {isOverlay ? (
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
          >
            {collapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
        )}
      </div>

      {/* Search */}
      {(isOverlay || !collapsed) && (
        <div className="px-3 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="채팅 검색..."
              className="pl-9 h-9 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
            />
          </div>
        </div>
      )}
      {!isOverlay && collapsed && (
        <div className="flex justify-center py-3">
          <button className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <Search className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="px-2 space-y-0.5">
        {NAV_ITEMS.map(item => {
          const isActive = activeNav === item.key;
          return (
            <Link key={item.key} href={item.href}>
              <div
                onClick={() => isOverlay && setDrawerOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 group ${
                  isActive
                    ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                    : "text-slate-400 hover:bg-white/8 hover:text-white"
                } ${!isOverlay && collapsed ? "justify-center px-0" : ""}`}
                title={!isOverlay && collapsed ? item.label : undefined}
              >
                <item.icon className={`w-5 h-5 flex-shrink-0 ${isActive ? "text-white" : "text-slate-400 group-hover:text-white"}`} />
                {(isOverlay || !collapsed) && <span className="text-sm font-medium">{item.label}</span>}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="mx-3 my-3 border-t border-white/10" />

      {/* Recent Chats */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1 scrollbar-thin">
        {(isOverlay || !collapsed) && (
          <>
            <p className="px-3 pt-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">최근 채팅</p>
            {filteredChats.length > 0 ? (
              filteredChats.map(c => {
                const name = chatDisplayName(c);
                const pId = chatPersonaId(c);
                const avatarUrl = c.personaSnapshot?.avatarUrl || null;
                const isMbti = c.scenarioId.startsWith("__mbti_persona__:");
                const href = isMbti ? `/persona/mbti-${pId}` : `/persona/${pId}`;
                return (
                  <Link key={c.id} href={href}>
                    <div
                      onClick={() => isOverlay && setDrawerOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/8 cursor-pointer group transition-colors"
                    >
                      <SidebarAvatar url={avatarUrl} name={name} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-300 group-hover:text-white truncate font-medium">{name}</p>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          <span>{timeAgo(c.createdAt)}</span>
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })
            ) : (
              <p className="px-3 py-4 text-xs text-slate-600 text-center">아직 채팅 기록이 없어요</p>
            )}
          </>
        )}

        {!isOverlay && collapsed && (
          <div className="flex flex-col items-center gap-1">
            {recentChats.slice(0, 4).map(c => {
              const name = chatDisplayName(c);
              const pId = chatPersonaId(c);
              const avatarUrl = c.personaSnapshot?.avatarUrl || null;
              const isMbti = c.scenarioId.startsWith("__mbti_persona__:");
              const href = isMbti ? `/persona/mbti-${pId}` : `/persona/${pId}`;
              return (
                <Link key={c.id} href={href}>
                  <div className="p-1.5 rounded-xl hover:bg-white/10 cursor-pointer" title={name}>
                    <SidebarAvatar url={avatarUrl} name={name} size={8} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  if (chatMode) {
    return (
      <div className="relative h-screen overflow-hidden bg-slate-50">
        {/* Floating menu handle */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="fixed top-3 left-3 z-40 p-2 rounded-xl bg-slate-900/80 backdrop-blur-sm text-white shadow-lg hover:bg-slate-800 transition-all duration-200"
          title="메뉴 열기"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Overlay backdrop */}
        {drawerOpen && (
          <div className="fixed inset-0 bg-black/40 z-40 transition-opacity duration-300" />
        )}

        {/* Overlay drawer */}
        <div
          ref={drawerRef}
          className={`fixed top-0 left-0 h-full z-50 flex flex-col bg-slate-900 text-white shadow-2xl transition-transform duration-300 ease-in-out w-[280px] ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Header inside drawer */}
          <div className="px-3 py-2 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setDrawerOpen(false); window.location.href = "/home"; }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-white transition-all"
                >
                  <span>🎭</span>
                  <span>RoleplayX</span>
                </button>
                <button
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white"
                >
                  <span>💬</span>
                  <span>PersonaX</span>
                </button>
              </div>
              <UserProfileMenu />
            </div>
          </div>
          {sidebarContent(true)}
        </div>

        {/* Main content (full screen chat) */}
        <div className="h-full overflow-hidden">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
      <SwitchingHeader />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        <aside
          className={`flex flex-col bg-slate-900 text-white transition-all duration-300 ease-in-out flex-shrink-0 ${
            collapsed ? "w-[68px]" : "w-[260px]"
          }`}
        >
          {sidebarContent(false)}
        </aside>

        {/* ── Main Content ── */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarAvatar({ url, name, size = 8 }: { url?: string | null; name: string; size?: number }) {
  const px = size * 4;
  if (url) {
    return (
      <img
        src={toMediaUrl(url)}
        alt={name}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: px, height: px }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ width: px, height: px, fontSize: px * 0.35 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
