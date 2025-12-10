import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScenarioManager } from "@/components/admin/ScenarioManager";
import { PersonaManager } from "@/components/admin/PersonaManager";
import { DifficultySettingsTab } from "@/components/admin/DifficultySettingsTab";
import { AppHeader } from "@/components/AppHeader";

export default function AdminManagement() {
  const [activeTab, setActiveTab] = useState("manage-scenarios");

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader 
        title="콘텐츠 관리"
        subtitle="시나리오와 페르소나 생성 및 관리"
        showBackButton
      />
      <div className="container mx-auto p-6 space-y-6" data-testid="admin-management">
        {/* Management Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="manage-scenarios" data-testid="tab-manage-scenarios">시나리오 관리</TabsTrigger>
            <TabsTrigger value="difficulty-settings" data-testid="tab-difficulty-settings">난이도 설정</TabsTrigger>
            <TabsTrigger value="manage-personas" data-testid="tab-manage-personas">페르소나 관리</TabsTrigger>
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
        </Tabs>
      </div>
    </div>
  );
}