import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScenarioManager } from "@/components/admin/ScenarioManager";
import { PersonaManager } from "@/components/admin/PersonaManager";
import { DifficultySettingsTab } from "@/components/admin/DifficultySettingsTab";
import { EvaluationCriteriaManager } from "@/components/admin/EvaluationCriteriaManager";
import { AppHeader } from "@/components/AppHeader";

export default function AdminManagement() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("manage-scenarios");

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader 
        title={t('admin.contentManagement.title')}
        subtitle={t('admin.contentManagement.subtitle')}
        showBackButton
      />
      <div className="container mx-auto p-6 space-y-6" data-testid="admin-management">
        {/* Management Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="manage-scenarios" data-testid="tab-manage-scenarios">{t('admin.contentManagement.tabs.scenarios')}</TabsTrigger>
            <TabsTrigger value="difficulty-settings" data-testid="tab-difficulty-settings">{t('admin.contentManagement.tabs.difficulty')}</TabsTrigger>
            <TabsTrigger value="manage-personas" data-testid="tab-manage-personas">{t('admin.contentManagement.tabs.personas')}</TabsTrigger>
            <TabsTrigger value="evaluation-criteria" data-testid="tab-evaluation-criteria">{t('admin.contentManagement.tabs.evaluation')}</TabsTrigger>
          </TabsList>

          <TabsContent value="manage-scenarios" className="space-y-6">
            <ScenarioManager />
          </TabsContent>

          <TabsContent value="difficulty-settings" className="space-y-6">
            <DifficultySettingsTab />
          </TabsContent>

          <TabsContent value="manage-personas" className="space-y-6">
            <PersonaManager />
          </TabsContent>

          <TabsContent value="evaluation-criteria" className="space-y-6">
            <EvaluationCriteriaManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}