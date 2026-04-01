import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrganizationCategoryTree } from "@/components/admin/OrganizationCategoryTree";
import { ScenarioManager } from "@/components/admin/ScenarioManager";
import { PersonaManager } from "@/components/admin/PersonaManager";
import { DifficultySettingsTab } from "@/components/admin/DifficultySettingsTab";
import { EvaluationCriteriaManager } from "@/components/admin/EvaluationCriteriaManager";
import { AppHeader } from "@/components/AppHeader";

export default function AdminManagement() {
  const { t } = useTranslation();
  const search = useSearch();
  const urlTab = new URLSearchParams(search).get("tab");
  const [activeTab, setActiveTab] = useState(urlTab || "manage-scenarios");
  const [personaCreateTrigger, setPersonaCreateTrigger] = useState(0);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader 
        title={t('admin.contentManagement.title')}
        subtitle={t('admin.contentManagement.subtitle')}
        showBackButton
      />
      <div className="container mx-auto p-3 md:p-6 space-y-6" data-testid="admin-management">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 h-auto p-1 gap-1">
            <TabsTrigger value="manage-scenarios" data-testid="tab-manage-scenarios">시나리오</TabsTrigger>
            <TabsTrigger value="manage-personas" data-testid="tab-manage-personas">페르소나</TabsTrigger>
            <TabsTrigger value="evaluation-criteria" data-testid="tab-evaluation-criteria">평가기준</TabsTrigger>
            <TabsTrigger value="manage-structure" data-testid="tab-manage-structure">조직/카테고리</TabsTrigger>
            <TabsTrigger value="difficulty-settings" data-testid="tab-difficulty-settings">대화 난이도</TabsTrigger>
          </TabsList>

          <TabsContent value="manage-scenarios" className="space-y-6">
            <ScenarioManager onGoToPersonas={() => {
              setActiveTab('manage-personas');
              setPersonaCreateTrigger(prev => prev + 1);
            }} />
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
        </Tabs>
      </div>
    </div>
  );
}
