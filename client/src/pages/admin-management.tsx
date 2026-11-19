import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import { Building2, ClipboardCheck, FileText, Gauge, Globe2, SlidersHorizontal, UserRound } from "lucide-react";
import { AdminWorkspace, WorkspacePanel, type WorkspaceSectionDef } from "@/components/admin/contentEditor";
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
    if (urlTab) setActiveTab(urlTab);
  }, [urlTab]);

  useEffect(() => {
    const onDirty = (event: Event) => setOverrideDirty(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("scenario-override-dirty", onDirty);
    return () => window.removeEventListener("scenario-override-dirty", onDirty);
  }, []);

  const sections: WorkspaceSectionDef[] = [
    { id: "manage-scenarios", label: "시나리오", description: "역할극 시나리오를 만들고 수정합니다. 각 시나리오는 편집 화면에서 개별 저장됩니다.", group: "훈련 콘텐츠", icon: FileText },
    { id: "culture-map", label: "Culture Map", description: "문화 프로필과 문화 차원 지도를 관리합니다.", group: "훈련 콘텐츠", icon: Globe2 },
    { id: "manage-personas", label: "페르소나", description: "대화 상대 페르소나를 만들고 수정합니다.", group: "훈련 콘텐츠", icon: UserRound },
    { id: "evaluation-criteria", label: "평가기준", description: "대화 평가에 쓰이는 루브릭과 기준을 관리합니다.", group: "평가와 난이도", icon: ClipboardCheck },
    { id: "difficulty-settings", label: "대화 난이도", description: "레벨별 AI 응답 지침을 편집합니다. 레벨마다 편집 화면에서 저장합니다.", group: "평가와 난이도", icon: Gauge },
    { id: "manage-structure", label: "조직/카테고리", description: "조직과 카테고리 구조를 관리합니다.", group: "조직 운영", icon: Building2 },
    { id: "scenario-overrides", label: "조직 Override", description: "조직별로 시나리오 설정을 덮어씁니다. 변경 내용은 이 화면의 저장 버튼으로 저장합니다.", group: "조직 운영", icon: SlidersHorizontal, kind: "form" },
  ];
  const overrideGuardActive = activeTab === "scenario-overrides" && overrideDirty;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        title={t('admin.contentManagement.title')}
        subtitle={t('admin.contentManagement.subtitle')}
      />
      <AdminWorkspace
        testId="admin-management"
        idPrefix="admin-management"
        title={t('admin.contentManagement.title')}
        breadcrumb="콘텐츠 관리"
        sections={sections}
        active={activeTab}
        onActiveChange={setActiveTab}
        hideSectionHeading={
          activeTab === "manage-scenarios" ||
          activeTab === "manage-personas" ||
          activeTab === "evaluation-criteria"
        }
        keepVisited
        dirty={overrideGuardActive}
        dirtyLabel="저장하지 않은 조직 Override"
        onDiscard={(id) => { if (id === "scenario-overrides") setOverrideDirty(false); }}
      >
        <WorkspacePanel id="manage-scenarios">
          <ScenarioManager onGoToPersonas={() => {
            setActiveTab('manage-personas');
            setPersonaCreateTrigger(prev => prev + 1);
          }} />
        </WorkspacePanel>

        <WorkspacePanel id="culture-map">
          <CultureMapWorkspace />
        </WorkspacePanel>

        <WorkspacePanel id="manage-personas">
          <PersonaManager openCreateTrigger={personaCreateTrigger} />
        </WorkspacePanel>

        <WorkspacePanel id="evaluation-criteria">
          <EvaluationCriteriaManager />
        </WorkspacePanel>

        <WorkspacePanel id="manage-structure">
          <OrganizationCategoryTree />
        </WorkspacePanel>

        <WorkspacePanel id="difficulty-settings">
          <DifficultySettingsTab />
        </WorkspacePanel>

        <WorkspacePanel id="scenario-overrides">
          {(isAdmin || currentUser?.role === "operator") && <ScenarioOverrideManager />}
          {!isAdmin && currentUser?.role !== "operator" && <p className="text-muted-foreground text-sm">관리자 또는 권한이 위임된 운영자만 접근할 수 있습니다.</p>}
        </WorkspacePanel>
      </AdminWorkspace>
    </div>
  );
}
