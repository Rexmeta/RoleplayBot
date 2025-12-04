import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Loader2 } from 'lucide-react';
import { Link } from 'wouter';

export default function AIGeneratorPage() {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    theme: '',
    industry: '',
    difficulty: 3,
    personaCount: 3
  });
  const [generatedResult, setGeneratedResult] = useState<any>(null);

  const generateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest('POST', '/api/admin/generate-scenario', data);
      return response.json();
    },
    onSuccess: (result) => {
      setGeneratedResult(result);
      toast({
        title: "성공",
        description: "AI가 시나리오를 생성했습니다!",
        variant: "default"
      });
    },
    onError: () => {
      toast({
        title: "오류", 
        description: "AI 시나리오 생성에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const handleGenerate = () => {
    if (!formData.theme.trim()) {
      toast({
        title: "오류",
        description: "주제를 입력해주세요.",
        variant: "destructive"
      });
      return;
    }
    generateMutation.mutate(formData);
  };

  const saveScenario = async () => {
    if (!generatedResult) return;
    
    try {
      await apiRequest('POST', '/api/admin/scenarios', generatedResult.scenario);
      
      // 페르소나들도 저장
      for (const persona of generatedResult.personas) {
        await apiRequest('POST', '/api/admin/personas', persona);
      }
      
      toast({
        title: "성공",
        description: "시나리오와 페르소나가 저장되었습니다!",
        variant: "default"
      });
      
      setGeneratedResult(null);
      setFormData({
        theme: '',
        industry: '',
        difficulty: 3,
        personaCount: 3
      });
    } catch (error) {
      toast({
        title: "오류",
        description: "저장에 실패했습니다.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-4">
            <Link href="/admin">
              <Button variant="outline" size="sm">
                <i className="fas fa-arrow-left mr-2"></i>
                운영자 대시보드로
              </Button>
            </Link>
            <h1 className="text-3xl font-bold text-slate-900">AI 시나리오 생성기</h1>
          </div>
          <p className="text-slate-600">AI를 활용해 새로운 훈련 시나리오를 자동으로 생성하세요.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 생성 폼 */}
          <Card>
            <CardHeader>
              <CardTitle>시나리오 생성 조건</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="theme">주제 *</Label>
                <Input
                  id="theme"
                  value={formData.theme}
                  onChange={(e) => setFormData(prev => ({ ...prev, theme: e.target.value }))}
                  placeholder="예: 프로젝트 지연, 갈등 해결, 협상"
                />
              </div>
              
              <div>
                <Label htmlFor="industry">업종 (선택사항)</Label>
                <Input
                  id="industry"
                  value={formData.industry}
                  onChange={(e) => setFormData(prev => ({ ...prev, industry: e.target.value }))}
                  placeholder="예: IT, 제조업, 서비스업"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>난이도</Label>
                  <Select 
                    value={formData.difficulty.toString()} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, difficulty: Number(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 - 쉬움</SelectItem>
                      <SelectItem value="2">2 - 보통</SelectItem>
                      <SelectItem value="3">3 - 중간</SelectItem>
                      <SelectItem value="4">4 - 어려움</SelectItem>
                      <SelectItem value="5">5 - 매우 어려움</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label>페르소나 수</Label>
                  <Select 
                    value={formData.personaCount.toString()} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, personaCount: Number(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2명</SelectItem>
                      <SelectItem value="3">3명</SelectItem>
                      <SelectItem value="4">4명</SelectItem>
                      <SelectItem value="5">5명</SelectItem>
                      <SelectItem value="6">6명</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <Button 
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    AI가 생성 중...
                  </>
                ) : (
                  <>
                    <i className="fas fa-magic mr-2"></i>
                    AI로 시나리오 생성
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* 생성 결과 */}
          {generatedResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-check-circle text-green-600"></i>
                  생성 완료
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 생성된 시나리오 이미지 표시 */}
                {generatedResult.scenario.image && (
                  <div>
                    <h4 className="font-semibold text-slate-800 mb-2">생성된 시나리오 이미지</h4>
                    <div className="relative w-full h-48 bg-slate-100 rounded-lg overflow-hidden">
                      <img
                        src={generatedResult.scenario.image}
                        alt={generatedResult.scenario.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500"><i class="fas fa-image mr-2"></i>이미지를 불러올 수 없습니다</div>';
                          }
                        }}
                        data-testid="generated-scenario-image"
                      />
                    </div>
                  </div>
                )}
                
                <div>
                  <h4 className="font-semibold text-slate-800">시나리오 제목</h4>
                  <p className="text-slate-600">{generatedResult.scenario.title}</p>
                </div>
                
                <div>
                  <h4 className="font-semibold text-slate-800">설명</h4>
                  <p className="text-slate-600 text-sm">{generatedResult.scenario.description}</p>
                </div>
                
                <div>
                  <h4 className="font-semibold text-slate-800">생성된 페르소나 ({generatedResult.personas?.length || 0}명)</h4>
                  <div className="space-y-2">
                    {generatedResult.personas?.map((persona: any, index: number) => (
                      <div key={index} className="bg-slate-100 p-2 rounded">
                        <p className="font-medium">{persona.name} - {persona.role}</p>
                        <p className="text-sm text-slate-600">{persona.department}</p>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="flex gap-2 pt-4">
                  <Button 
                    onClick={saveScenario}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    <i className="fas fa-save mr-2"></i>
                    저장하기
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setGeneratedResult(null)}
                  >
                    다시 생성
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}