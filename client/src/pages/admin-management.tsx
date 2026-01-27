import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryManager } from "@/components/admin/CategoryManager";
import { ScenarioManager } from "@/components/admin/ScenarioManager";
import { PersonaManager } from "@/components/admin/PersonaManager";
import { DifficultySettingsTab } from "@/components/admin/DifficultySettingsTab";
import { EvaluationCriteriaManager } from "@/components/admin/EvaluationCriteriaManager";
import { OperatorOrganizationManager } from "@/components/admin/OperatorOrganizationManager";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/useAuth";

interface UserInfo {
  id: string;
  role: string;
  assignedCompanyId?: string | null;
  assignedOrganizationId?: string | null;
  assignedCategoryId?: string | null;
}

export default function AdminManagement() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentUser = user as UserInfo | null;
  
  const isCompanyLevelOperator = currentUser?.role === 'operator' && 
    currentUser?.assignedCompanyId && 
    !currentUser?.assignedOrganizationId && 
    !currentUser?.assignedCategoryId;
  
  const showOrganizationTab = currentUser?.role === 'admin' || isCompanyLevelOperator;
  
  const [activeTab, setActiveTab] = useState("manage-categories");
  
  useEffect(() => {
    if (showOrganizationTab && activeTab === "manage-categories") {
      setActiveTab("manage-organizations");
    }
  }, [showOrganizationTab]);

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
          <TabsList className={`grid w-full ${showOrganizationTab ? 'grid-cols-6' : 'grid-cols-5'}`}>
            {showOrganizationTab && (
              <TabsTrigger value="manage-organizations" data-testid="tab-manage-organizations">
                {t('admin.contentManagement.tabs.organizations', '조직')}
              </TabsTrigger>
            )}
            <TabsTrigger value="manage-categories" data-testid="tab-manage-categories">{t('admin.contentManagement.tabs.categories', '카테고리')}</TabsTrigger>
            <TabsTrigger value="manage-scenarios" data-testid="tab-manage-scenarios">{t('admin.contentManagement.tabs.scenarios')}</TabsTrigger>
            <TabsTrigger value="difficulty-settings" data-testid="tab-difficulty-settings">{t('admin.contentManagement.tabs.difficulty')}</TabsTrigger>
            <TabsTrigger value="manage-personas" data-testid="tab-manage-personas">{t('admin.contentManagement.tabs.personas')}</TabsTrigger>
            <TabsTrigger value="evaluation-criteria" data-testid="tab-evaluation-criteria">{t('admin.contentManagement.tabs.evaluation')}</TabsTrigger>
          </TabsList>

          {showOrganizationTab && (
            <TabsContent value="manage-organizations" className="space-y-6">
              <OperatorOrganizationManager />
            </TabsContent>
          )}

          <TabsContent value="manage-categories" className="space-y-6">
            <CategoryManager />
          </TabsContent>

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