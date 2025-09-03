import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScenarioManager } from "@/components/admin/ScenarioManager";
import { PersonaManager } from "@/components/admin/PersonaManager";
import { AIScenarioGenerator } from "@/components/admin/AIScenarioGenerator";

export default function AdminManagement() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto p-6 space-y-6" data-testid="admin-management">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" className="flex items-center space-x-2 text-corporate-600 hover:text-corporate-700" data-testid="back-to-home">
              <i className="fas fa-arrow-left"></i>
              <span className="text-sm">홈으로</span>
            </Link>
            <div className="border-l border-slate-300 pl-4">
              <h1 className="text-3xl font-bold text-slate-900" data-testid="management-title">콘텐츠 관리</h1>
              <p className="text-slate-600 mt-2">시나리오와 페르소나 생성 및 관리</p>
            </div>
          </div>
          <div className="flex space-x-3">
            <Link href="/admin-dashboard">
              <Button variant="outline" data-testid="link-dashboard">
                <i className="fas fa-chart-bar mr-2"></i>
                대시보드
              </Button>
            </Link>
          </div>
        </div>

        {/* Management Tabs */}
        <Tabs defaultValue="ai-generator" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ai-generator" data-testid="tab-ai-generator">AI 생성</TabsTrigger>
            <TabsTrigger value="manage-scenarios" data-testid="tab-manage-scenarios">시나리오 관리</TabsTrigger>
            <TabsTrigger value="manage-personas" data-testid="tab-manage-personas">페르소나 관리</TabsTrigger>
          </TabsList>

          <TabsContent value="ai-generator" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-magic text-purple-600"></i>
                  AI 시나리오 생성기
                </CardTitle>
                <p className="text-slate-600">AI를 활용해 새로운 훈련 시나리오를 자동으로 생성하세요.</p>
              </CardHeader>
              <CardContent>
                <AIScenarioGenerator onGenerated={() => {}} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="manage-scenarios" className="space-y-6">
            <ScenarioManager />
          </TabsContent>

          <TabsContent value="manage-personas" className="space-y-6">
            <PersonaManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}