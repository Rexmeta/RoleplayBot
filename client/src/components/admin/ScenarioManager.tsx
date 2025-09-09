import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { ComplexScenario } from '@/lib/scenario-system';
import { Loader2 } from 'lucide-react';
import { AIScenarioGenerator } from './AIScenarioGenerator';

interface ScenarioPersona {
  id: string;
  name: string;
  department: string;
  position: string;
  experience: string;
  personaRef: string;
  stance: string;
  goal: string;
  tradeoff: string;
}

interface ScenarioFormData {
  title: string;
  description: string;
  difficulty: number;
  estimatedTime: string;
  skills: string[];
  context: {
    situation: string;
    timeline: string;
    stakes: string;
    playerRole: {
      position: string;
      department: string;
      experience: string;
      responsibility: string;
    };
  };
  objectives: string[];
  successCriteria: {
    optimal: string;
    good: string;
    acceptable: string;
    failure: string;
  };
  personas: ScenarioPersona[];
  recommendedFlow: string[];
}

export function ScenarioManager() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<ComplexScenario | null>(null);
  const [formData, setFormData] = useState<ScenarioFormData>({
    title: '',
    description: '',
    difficulty: 1,
    estimatedTime: '',
    skills: [],
    context: {
      situation: '',
      timeline: '',
      stakes: '',
      playerRole: {
        position: '',
        department: '',
        experience: '',
        responsibility: ''
      }
    },
    objectives: [],
    successCriteria: {
      optimal: '',
      good: '',
      acceptable: '',
      failure: ''
    },
    personas: [],
    recommendedFlow: []
  });

  const { data: scenarios, isLoading } = useQuery<ComplexScenario[]>({
    queryKey: ['/api/admin/scenarios'],
  });

  const handleAIGenerated = (result: any) => {
    // AI 생성 결과를 폼에 자동 입력
    setFormData({
      ...result.scenario,
      skills: result.scenario.skills || [],
      objectives: result.scenario.objectives || [],
      personas: result.scenario.personas || [],
      recommendedFlow: result.scenario.recommendedFlow || []
    });
    
    setIsCreateOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async (data: ScenarioFormData) => {
      const response = await apiRequest('POST', '/api/admin/scenarios', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      setIsCreateOpen(false);
      resetForm();
      toast({
        title: "시나리오 생성 완료",
        description: "새로운 시나리오가 성공적으로 생성되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "생성 실패",
        description: "시나리오 생성 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ScenarioFormData }) => {
      const response = await apiRequest('PUT', `/api/admin/scenarios/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      setEditingScenario(null);
      resetForm();
      setIsCreateOpen(false);
      toast({
        title: "시나리오 수정 완료",
        description: "시나리오가 성공적으로 수정되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "수정 실패",
        description: "시나리오 수정 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/admin/scenarios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      toast({
        title: "시나리오 삭제 완료",
        description: "시나리오가 성공적으로 삭제되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "삭제 실패",
        description: "시나리오 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      difficulty: 1,
      estimatedTime: '',
      skills: [],
      context: {
        situation: '',
        timeline: '',
        stakes: '',
        playerRole: {
          position: '',
          department: '',
          experience: '',
          responsibility: ''
        }
      },
      objectives: [],
      successCriteria: {
        optimal: '',
        good: '',
        acceptable: '',
        failure: ''
      },
      personas: [],
      recommendedFlow: []
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingScenario) {
      updateMutation.mutate({ id: editingScenario.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (scenario: ComplexScenario) => {
    setEditingScenario(scenario);
    setFormData({
      title: scenario.title || '',
      description: scenario.description || '',
      difficulty: scenario.difficulty || 1,
      estimatedTime: scenario.estimatedTime || '',
      skills: scenario.skills || [],
      context: scenario.context || {
        situation: '',
        timeline: '',
        stakes: '',
        playerRole: {
          position: '',
          department: '',
          experience: '',
          responsibility: ''
        }
      },
      objectives: scenario.objectives || [],
      successCriteria: scenario.successCriteria || {
        optimal: '',
        good: '',
        acceptable: '',
        failure: ''
      },
      personas: (scenario.personas as any) || [],
      recommendedFlow: scenario.recommendedFlow || []
    });
    setIsCreateOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-corporate-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">시나리오 관리</h2>
          <p className="text-slate-600 mt-1">훈련 시나리오를 생성하고 관리할 수 있습니다.</p>
        </div>
        
        <div className="flex items-center space-x-3">
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button 
                className="bg-corporate-600 hover:bg-corporate-700"
                onClick={() => {
                  resetForm();
                  setEditingScenario(null);
                }}
                data-testid="button-create-scenario"
              >
                <i className="fas fa-plus mr-2"></i>
                새 시나리오 생성
              </Button>
            </DialogTrigger>
          
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingScenario ? '시나리오 편집' : '새 시나리오 생성'}
                </DialogTitle>
              </DialogHeader>
            
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* 기본 정보 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">기본 정보</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="title">시나리오 제목</Label>
                      <Input
                        id="title"
                        value={formData.title}
                        onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="시나리오 제목을 입력하세요"
                        required
                        data-testid="input-scenario-title"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="estimatedTime">예상 소요 시간</Label>
                      <Input
                        id="estimatedTime"
                        value={formData.estimatedTime}
                        onChange={(e) => setFormData(prev => ({ ...prev, estimatedTime: e.target.value }))}
                        placeholder="예: 30-45분"
                        data-testid="input-estimated-time"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="description">시나리오 설명</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="시나리오에 대한 상세한 설명을 입력하세요"
                      className="min-h-[100px]"
                      data-testid="textarea-description"
                    />
                  </div>

                  <div>
                    <Label htmlFor="difficulty">난이도</Label>
                    <Select value={formData.difficulty.toString()} onValueChange={(value) => setFormData(prev => ({ ...prev, difficulty: parseInt(value) }))}>
                      <SelectTrigger data-testid="select-difficulty">
                        <SelectValue placeholder="난이도 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">★ 쉬움</SelectItem>
                        <SelectItem value="2">★★ 보통</SelectItem>
                        <SelectItem value="3">★★★ 어려움</SelectItem>
                        <SelectItem value="4">★★★★ 매우 어려움</SelectItem>
                        <SelectItem value="5">★★★★★ 전문가</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 상황 컨텍스트 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">상황 컨텍스트</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="situation">상황 설명</Label>
                      <Textarea
                        id="situation"
                        value={formData.context.situation}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          context: { ...prev.context, situation: e.target.value }
                        }))}
                        placeholder="시나리오가 벌어지는 상황을 설명하세요"
                        className="min-h-[100px]"
                        data-testid="textarea-situation"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="timeline">타임라인</Label>
                        <Input
                          id="timeline"
                          value={formData.context.timeline}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            context: { ...prev.context, timeline: e.target.value }
                          }))}
                          placeholder="예: 3일 내, 다음 주까지"
                          data-testid="input-timeline"
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="stakes">중요도/위험도</Label>
                        <Input
                          id="stakes"
                          value={formData.context.stakes}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            context: { ...prev.context, stakes: e.target.value }
                          }))}
                          placeholder="예: 높음, 프로젝트 성패에 중요"
                          data-testid="input-stakes"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 플레이어 역할 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">플레이어 역할</h3>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="playerPosition">직책</Label>
                      <Input
                        id="playerPosition"
                        value={formData.context.playerRole.position}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            playerRole: { ...prev.context.playerRole, position: e.target.value }
                          }
                        }))}
                        placeholder="예: 주니어 개발자, 팀장"
                        data-testid="input-player-position"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="playerDepartment">부서</Label>
                      <Input
                        id="playerDepartment"
                        value={formData.context.playerRole.department}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            playerRole: { ...prev.context.playerRole, department: e.target.value }
                          }
                        }))}
                        placeholder="예: 개발팀, 마케팅팀"
                        data-testid="input-player-department"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="playerExperience">경력</Label>
                      <Input
                        id="playerExperience"
                        value={formData.context.playerRole.experience}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            playerRole: { ...prev.context.playerRole, experience: e.target.value }
                          }
                        }))}
                        placeholder="예: 2년차, 신입사원"
                        data-testid="input-player-experience"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="playerResponsibility">담당 업무</Label>
                      <Input
                        id="playerResponsibility"
                        value={formData.context.playerRole.responsibility}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          context: {
                            ...prev.context,
                            playerRole: { ...prev.context.playerRole, responsibility: e.target.value }
                          }
                        }))}
                        placeholder="예: 프론트엔드 개발, 고객 관리"
                        data-testid="input-player-responsibility"
                      />
                    </div>
                  </div>
                </div>

                {/* 목표 설정 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">목표 설정</h3>
                  
                  <div className="space-y-2">
                    <div className="flex space-x-2">
                      <Input
                        placeholder="새 목표를 입력하세요"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const value = (e.target as HTMLInputElement).value.trim();
                            if (value) {
                              setFormData(prev => ({
                                ...prev,
                                objectives: [...prev.objectives, value]
                              }));
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }}
                        data-testid="input-new-objective"
                      />
                      <Button
                        type="button"
                        onClick={(e) => {
                          const input = (e.target as HTMLElement).parentElement?.querySelector('input') as HTMLInputElement;
                          const value = input?.value.trim();
                          if (value) {
                            setFormData(prev => ({
                              ...prev,
                              objectives: [...prev.objectives, value]
                            }));
                            input.value = '';
                          }
                        }}
                        data-testid="button-add-objective"
                      >
                        추가
                      </Button>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                      {formData.objectives.map((objective, index) => (
                        <Badge
                          key={index}
                          variant="secondary"
                          className="cursor-pointer"
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            objectives: prev.objectives.filter((_, i) => i !== index)
                          }))}
                          data-testid={`badge-objective-${index}`}
                        >
                          {objective} ×
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 스킬 요구사항 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">필요 스킬</h3>
                  
                  <div className="space-y-2">
                    <div className="flex space-x-2">
                      <Input
                        placeholder="필요한 스킬을 입력하세요"
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const value = (e.target as HTMLInputElement).value.trim();
                            if (value && !formData.skills.includes(value)) {
                              setFormData(prev => ({
                                ...prev,
                                skills: [...prev.skills, value]
                              }));
                              (e.target as HTMLInputElement).value = '';
                            }
                          }
                        }}
                        data-testid="input-new-skill"
                      />
                      <Button
                        type="button"
                        onClick={(e) => {
                          const input = (e.target as HTMLElement).parentElement?.querySelector('input') as HTMLInputElement;
                          const value = input?.value.trim();
                          if (value && !formData.skills.includes(value)) {
                            setFormData(prev => ({
                              ...prev,
                              skills: [...prev.skills, value]
                            }));
                            input.value = '';
                          }
                        }}
                        data-testid="button-add-skill"
                      >
                        추가
                      </Button>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                      {formData.skills.map((skill, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="cursor-pointer"
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            skills: prev.skills.filter((_, i) => i !== index)
                          }))}
                          data-testid={`badge-skill-${index}`}
                        >
                          {skill} ×
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 성공 기준 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">성공 기준</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="successOptimal">최적 결과</Label>
                      <Textarea
                        id="successOptimal"
                        value={formData.successCriteria.optimal}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          successCriteria: { ...prev.successCriteria, optimal: e.target.value }
                        }))}
                        placeholder="최상의 결과는 무엇인가요?"
                        data-testid="textarea-success-optimal"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="successGood">좋은 결과</Label>
                      <Textarea
                        id="successGood"
                        value={formData.successCriteria.good}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          successCriteria: { ...prev.successCriteria, good: e.target.value }
                        }))}
                        placeholder="만족스러운 결과는 무엇인가요?"
                        data-testid="textarea-success-good"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="successAcceptable">수용 가능한 결과</Label>
                      <Textarea
                        id="successAcceptable"
                        value={formData.successCriteria.acceptable}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          successCriteria: { ...prev.successCriteria, acceptable: e.target.value }
                        }))}
                        placeholder="최소한 달성해야 할 결과는 무엇인가요?"
                        data-testid="textarea-success-acceptable"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="successFailure">실패 기준</Label>
                      <Textarea
                        id="successFailure"
                        value={formData.successCriteria.failure}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          successCriteria: { ...prev.successCriteria, failure: e.target.value }
                        }))}
                        placeholder="어떤 경우를 실패로 볼 것인가요?"
                        data-testid="textarea-success-failure"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsCreateOpen(false);
                      setEditingScenario(null);
                      resetForm();
                    }}
                    data-testid="button-cancel"
                  >
                    취소
                  </Button>
                  <Button
                    type="submit"
                    className="bg-corporate-600 hover:bg-corporate-700"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-save-scenario"
                  >
                    {createMutation.isPending || updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {editingScenario ? '수정 중...' : '생성 중...'}
                      </>
                    ) : (
                      editingScenario ? '수정하기' : '생성하기'
                    )}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        
          {/* AI 시나리오 생성기 버튼을 새 시나리오 생성 버튼 옆에 배치 */}
          <AIScenarioGenerator onGenerated={handleAIGenerated} />
        </div>
      </div>

      {/* 시나리오 목록 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {scenarios?.map((scenario) => (
          <Card key={scenario.id} className="card-enhanced">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg mb-2">{scenario.title}</CardTitle>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-blue-100 text-blue-800">
                      난이도 ★{scenario.difficulty}
                    </Badge>
                    <Badge variant="outline" className="bg-green-100 text-green-800">
                      {scenario.estimatedTime}
                    </Badge>
                    <Badge variant="outline" className="bg-purple-100 text-purple-800">
                      {(scenario.personas || []).length}개 페르소나
                    </Badge>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(scenario)}
                    data-testid={`button-edit-scenario-${scenario.id}`}
                  >
                    <i className="fas fa-edit"></i>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteMutation.mutate(scenario.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-scenario-${scenario.id}`}
                  >
                    <i className="fas fa-trash"></i>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600 text-sm mb-4 line-clamp-3">{scenario.description}</p>
              
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-1">핵심 스킬</h4>
                  <div className="flex flex-wrap gap-1">
                    {scenario.skills?.slice(0, 3).map((skill: string, index: number) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                    {(scenario.skills?.length || 0) > 3 && (
                      <Badge variant="secondary" className="text-xs">
                        +{(scenario.skills?.length || 0) - 3}개 더
                      </Badge>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-1">페르소나</h4>
                  <div className="flex flex-wrap gap-1">
                    {scenario.personas?.slice(0, 2).map((persona: any, index: number) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {persona.name || '알 수 없는 페르소나'}
                      </Badge>
                    ))}
                    {(scenario.personas?.length || 0) > 2 && (
                      <Badge variant="outline" className="text-xs">
                        +{(scenario.personas?.length || 0) - 2}개 더
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {scenarios?.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📋</div>
          <h3 className="text-xl font-medium text-slate-600 mb-2">시나리오가 없습니다</h3>
          <p className="text-slate-500 mb-4">새로운 훈련 시나리오를 생성해보세요</p>
          <Button
            onClick={() => {
              resetForm();
              setEditingScenario(null);
              setIsCreateOpen(true);
            }}
            className="bg-corporate-600 hover:bg-corporate-700"
          >
            첫 번째 시나리오 생성
          </Button>
        </div>
      )}
    </div>
  );
}