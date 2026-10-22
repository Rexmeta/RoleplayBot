import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CultureBehaviorExperiment } from "./CultureBehaviorExperiment";
import { CultureProfilesManager } from "./CultureProfilesManager";
import { CULTURE_DISCLAIMER } from "@shared/cultureMap";

type WorkspacePanel = "profiles" | "experiment";

export function CultureMapWorkspace() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("profiles");
  const visiblePanel = isAdmin ? activePanel : "profiles";

  return (
    <Tabs value={visiblePanel} onValueChange={(value) => setActivePanel(value as WorkspacePanel)} className="space-y-5" aria-label="Culture Map 작업 공간">
      <header className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 via-white to-cyan-50 p-4 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Culture Map · 작업 공간</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">문화 행동 컨텍스트</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
          문화 프로필은 고정된 국가 정체성이 아니라 업무 상황에서 참고할 독립적인 행동 맥락입니다. 프로필을 관리하거나 통제된 비교 실험을 확인하세요.
        </p>
        <p className="mt-2 text-xs text-amber-800">국가 기본 프로필은 자체 추정 자료이며 공식 Erin Meyer 수치가 아닙니다. {CULTURE_DISCLAIMER}</p>

        <TabsList className="mt-5 grid h-auto gap-2 bg-transparent p-0 sm:grid-cols-2" aria-label="Culture Map 기능">
          <TabsTrigger
            value="profiles"
            className={`block whitespace-normal rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 ${
              visiblePanel === "profiles"
                ? "border-teal-700 bg-white shadow-sm"
                : "border-teal-100 bg-white/60 hover:border-teal-300 hover:bg-white"
            }`}
          >
            <span className="block font-semibold text-slate-900">프로필 관리</span>
            <span className="mt-1 block text-sm text-slate-600">행동 맥락을 만들고 비교하며 출처와 변경 기록을 관리합니다.</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger
              value="experiment"
              className={`block whitespace-normal rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 ${
                visiblePanel === "experiment"
                  ? "border-teal-700 bg-white shadow-sm"
                  : "border-teal-100 bg-white/60 hover:border-teal-300 hover:bg-white"
              }`}
            >
              <span className="block font-semibold text-slate-900">문화 행동 실험</span>
              <span className="mt-1 block text-sm leading-relaxed text-slate-600">
                같은 업무 장면의 응답을 비교합니다. 실행 시 비용이 발생할 수 있습니다.
              </span>
            </TabsTrigger>
          )}
        </TabsList>
      </header>

      <TabsContent value="profiles" forceMount className="data-[state=inactive]:hidden" hidden={visiblePanel !== "profiles"}>
        <CultureProfilesManager />
      </TabsContent>
      {isAdmin && (
        <TabsContent value="experiment" forceMount className="data-[state=inactive]:hidden" hidden={visiblePanel !== "experiment"}>
          <CultureBehaviorExperiment />
        </TabsContent>
      )}
    </Tabs>
  );
}
