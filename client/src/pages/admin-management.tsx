import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrganizationCategoryTree } from "@/components/admin/OrganizationCategoryTree";
import { ScenarioManager } from "@/components/admin/ScenarioManager";
import { PersonaManager } from "@/components/admin/PersonaManager";
import { DifficultySettingsTab } from "@/components/admin/DifficultySettingsTab";
import { EvaluationCriteriaManager } from "@/components/admin/EvaluationCriteriaManager";
import { ScenarioOverrideManager } from "@/components/admin/ScenarioOverrideManager";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/useAuth";
import { CultureMapWorkspace } from "@/components/admin/cultureMap/CultureMapWorkspace";

export default function AdminManagement() {
  const { t } = useTranslation();
  const search = useSearch();
  const urlTab = new URLSearchParams(search).get("tab");
  const [activeTab, setActiveTab] = useState(urlTab || "manage-scenarios");
  const [personaCreateTrigger, setPersonaCreateTrigger] = useState(0);
  const [overrideDirty, setOverrideDirty] = useState(false);

  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  useEffect(() => {
    const onDirty = (event: Event) => setOverrideDirty(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("scenario-override-dirty", onDirty);
    return () => window.removeEventListener("scenario-override-dirty", onDirty);
  }, []);

  const changeTab = (next: string) => {
    if (activeTab === "scenario-overrides" && next !== activeTab && overrideDirty &&
      !window.confirm("저장되지 않은 조직 Override 변경 사항이 있습니다. 탭을 이동하시겠습니까?")) return;
    setActiveTab(next);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader 
        title={t('admin.contentManagement.title')}
        subtitle={t('admin.contentManagement.subtitle')}
        showBackButton
      />
      <div className="container mx-auto p-3 md:p-6 space-y-6" data-testid="admin-management">
        <Tabs value={activeTab} onValueChange={changeTab} className="space-y-6">
          <TabsList className="flex flex-wrap w-full h-auto p-1 gap-1">
            <TabsTrigger value="manage-scenarios" data-testid="tab-manage-scenarios">시나리오</TabsTrigger>
            <TabsTrigger value="culture-map" data-testid="tab-culture-map">Culture Map</TabsTrigger>
            <TabsTrigger value="manage-personas" data-testid="tab-manage-personas">페르소나</TabsTrigger>
            <TabsTrigger value="evaluation-criteria" data-testid="tab-evaluation-criteria">평가기준</TabsTrigger>
            <TabsTrigger value="manage-structure" data-testid="tab-manage-structure">조직/카테고리</TabsTrigger>
            <TabsTrigger value="difficulty-settings" data-testid="tab-difficulty-settings">대화 난이도</TabsTrigger>
            <TabsTrigger value="scenario-overrides" data-testid="tab-scenario-overrides">조직 Override</TabsTrigger>
          </TabsList>

          <TabsContent value="manage-scenarios" className="space-y-6">
            <ScenarioManager onGoToPersonas={() => {
              setActiveTab('manage-personas');
              setPersonaCreateTrigger(prev => prev + 1);
            }} />
          </TabsContent>

          <TabsContent value="culture-map" className="space-y-6">
            <CultureMapWorkspace />
          </TabsContent>

          <TabsContent value="manage-personas" className="space-y-6">
            <PersonaManager openCreateTrigger={personaCreateTrigger} />
          </TabsContent>

          <TabsContent value="evaluation-criteria" className="space-y-6">
            <EvaluationCriteriaManager />
          </TabsContent>

          <TabsContent value="manage-structure" className="space-y-6">
            <OrganizationCategoryTree />
          </TabsContent>

          <TabsContent value="difficulty-settings" className="space-y-6">
            <DifficultySettingsTab />
          </TabsContent>

          <TabsContent value="scenario-overrides" className="space-y-6">
            {(isAdmin || currentUser?.role === "operator") && <ScenarioOverrideManager />}
            {!isAdmin && currentUser?.role !== "operator" && <p className="text-muted-foreground text-sm">관리자 또는 권한이 위임된 운영자만 접근할 수 있습니다.</p>}
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
