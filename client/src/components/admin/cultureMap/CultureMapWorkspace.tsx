import { useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CultureBehaviorExperiment } from "./CultureBehaviorExperiment";
import { CultureProfilesManager } from "./CultureProfilesManager";
import { CultureProfileCreatePage } from "./CultureProfileCreatePage";
import { CULTURE_DISCLAIMER } from "@shared/cultureMap";
import { Info, Plus } from "lucide-react";

type WorkspacePanel = "profiles" | "experiment";

export function CultureMapWorkspace() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [activePanel, setActivePanel] = useState<WorkspacePanel>("profiles");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const profilesTabRef = useRef<HTMLButtonElement>(null);
  const visiblePanel = !isAdmin && activePanel === "experiment" ? "profiles" : activePanel;
  const [createOpen, setCreateOpen] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const createdRef = useRef(false);
  const closeCreate = () => { createdRef.current = false; setCreateOpen(false); };
  const onCreated = () => {
    createdRef.current = true;
    setCreateOpen(false);
    setActivePanel("profiles");
  };
  const restoreCreateFocus = (event: Event) => {
    event.preventDefault();
    const target = createdRef.current ? profilesTabRef.current : createButtonRef.current;
    createdRef.current = false;
    target?.focus({ preventScroll: true });
  };

  return (
    <Tabs value={visiblePanel} onValueChange={(value) => setActivePanel(value as WorkspacePanel)} className="space-y-5" aria-label="Culture Map 작업 공간">
      <div className="flex items-center gap-2 border-b border-teal-200/80">
        <TabsList className="h-auto min-w-0 flex-1 flex-wrap justify-start gap-1 rounded-none bg-transparent p-0" aria-label="Culture Map 기능">
          <TabsTrigger
            ref={profilesTabRef}
            value="profiles"
            className={`rounded-none border-b-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 ${
              visiblePanel === "profiles"
                ? "border-teal-700 bg-transparent text-teal-950"
                : "border-transparent bg-transparent text-slate-600 hover:border-teal-300 hover:text-teal-900"
            }`}
          >
            <span className="font-semibold">프로필 관리</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger
              value="experiment"
              className={`rounded-none border-b-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 ${
                visiblePanel === "experiment"
                  ? "border-teal-700 bg-transparent text-teal-950"
                  : "border-transparent bg-transparent text-slate-600 hover:border-teal-300 hover:text-teal-900"
              }`}
            >
              <span className="font-semibold">행동 실험</span>
            </TabsTrigger>
          )}
        </TabsList>
        <button
          ref={createButtonRef}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setCreateOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />새 프로필 만들기
        </button>
        <TooltipProvider delayDuration={250}>
          <Tooltip>
            <Popover open={noticeOpen} onOpenChange={setNoticeOpen}>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button type="button" aria-label="문화 프로필 자료 안내" className="mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-teal-800 transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                    <Info className="h-[18px] w-[18px]" aria-hidden="true" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              {!noticeOpen && <TooltipContent side="bottom" className="max-h-[min(70dvh,24rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto whitespace-normal border-teal-200 bg-teal-50 text-left text-sm leading-relaxed text-teal-950">
                국가 프로필은 자체 추정 자료이며 공식 Erin Meyer 수치가 아닙니다. 기업 프로필도 공개 자료에 기반한 낮은 신뢰도의 자체 추정으로, 공식 측정값이 아닙니다. {CULTURE_DISCLAIMER}
              </TooltipContent>}
              <PopoverContent side="bottom" align="end" className="max-h-[min(70dvh,24rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto border-teal-200 bg-teal-50 text-sm leading-relaxed text-teal-950">
                국가 프로필은 자체 추정 자료이며 공식 Erin Meyer 수치가 아닙니다. 기업 프로필도 공개 자료에 기반한 낮은 신뢰도의 자체 추정으로, 공식 측정값이 아닙니다. {CULTURE_DISCLAIMER}
              </PopoverContent>
            </Popover>
          </Tooltip>
        </TooltipProvider>
      </div>

      <TabsContent value="profiles" forceMount className="data-[state=inactive]:hidden" hidden={visiblePanel !== "profiles"}>
        <CultureProfilesManager showCreateAction={false} />
      </TabsContent>
      {isAdmin && (
        <TabsContent value="experiment" forceMount className="data-[state=inactive]:hidden" hidden={visiblePanel !== "experiment"}>
          <CultureBehaviorExperiment />
        </TabsContent>
      )}
      {createOpen && <CultureProfileCreatePage onCreated={onCreated} onCancel={closeCreate} onCloseAutoFocus={restoreCreateFocus} />}
    </Tabs>
  );
}
