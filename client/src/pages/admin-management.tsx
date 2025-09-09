import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScenarioManager } from "@/components/admin/ScenarioManager";
import { PersonaManager } from "@/components/admin/PersonaManager";
import { AIScenarioGenerator } from "@/components/admin/AIScenarioGenerator";

export default function AdminManagement() {
  const [activeTab, setActiveTab] = useState("ai-generator");
  const [generatedResult, setGeneratedResult] = useState<any>(null);
  
  const handleAIGenerated = (result: any) => {
    setGeneratedResult(result);
  };
  
  const goToScenarioManagement = () => {
    setActiveTab("manage-scenarios");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto p-6 space-y-6" data-testid="admin-management">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/home" className="flex items-center space-x-2 text-corporate-600 hover:text-corporate-700" data-testid="back-to-home">
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
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
                <AIScenarioGenerator onGenerated={handleAIGenerated} />
                
                {/* 생성된 결과 표시 */}
                {generatedResult && (
                  <div className="mt-8 p-6 bg-green-50 border border-green-200 rounded-lg" data-testid="generated-result">
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="text-lg font-semibold text-green-800">✅ AI 시나리오 생성 완료!</h3>
                      <button
                        onClick={() => setGeneratedResult(null)}
                        className="text-green-600 hover:text-green-800"
                        data-testid="close-result"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-medium text-slate-900">{generatedResult.scenario?.title}</h4>
                        <p className="text-sm text-slate-600 mt-1">{generatedResult.scenario?.description}</p>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div className="bg-white p-3 rounded border">
                          <div className="text-slate-500">난이도</div>
                          <div className="font-medium">{generatedResult.scenario?.difficulty}/5</div>
                        </div>
                        <div className="bg-white p-3 rounded border">
                          <div className="text-slate-500">예상 시간</div>
                          <div className="font-medium">{generatedResult.scenario?.estimatedTime}</div>
                        </div>
                        <div className="bg-white p-3 rounded border">
                          <div className="text-slate-500">페르소나 수</div>
                          <div className="font-medium">{generatedResult.personas?.length || 0}명</div>
                        </div>
                      </div>
                      
                      {generatedResult.personas && generatedResult.personas.length > 0 && (
                        <div>
                          <h5 className="font-medium text-slate-900 mb-2">생성된 페르소나</h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {generatedResult.personas.map((persona: any, index: number) => (
                              <div key={index} className="bg-white p-2 rounded border text-sm">
                                <div className="font-medium">{persona.name}</div>
                                <div className="text-slate-600">{persona.role} · {persona.mbti}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* 시나리오 관리 버튼 */}
                    <div className="flex justify-center mt-6 pt-4 border-t border-green-200">
                      <Button 
                        onClick={goToScenarioManagement}
                        className="bg-corporate-600 hover:bg-corporate-700"
                        data-testid="go-to-scenario-management"
                      >
                        <i className="fas fa-cog mr-2"></i>
                        시나리오 관리로 이동
                      </Button>
                    </div>
                  </div>
                )}
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