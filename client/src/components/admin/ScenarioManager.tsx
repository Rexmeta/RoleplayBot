import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
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
  gender: 'male' | 'female'; // 성별 필드 추가
  mbti: string; // MBTI 필드 추가
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
  image?: string; // 시나리오 이미지 URL 필드 추가
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
    difficulty: 4,
    estimatedTime: '',
    skills: [],
    image: '', // 이미지 초기값 추가
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
      setIsCreateOpen(false); // 다이얼로그 닫기
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
      const response = await apiRequest('DELETE', `/api/admin/scenarios/${id}`);
      return response.json();
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
      image: '', // 이미지 필드 초기화 추가
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

  const handleEdit = (scenario: ComplexScenario) => {
    setEditingScenario(scenario);
    setFormData({
      title: scenario.title,
      description: scenario.description,
      difficulty: scenario.difficulty,
      estimatedTime: scenario.estimatedTime,
      skills: scenario.skills,
      image: scenario.image || '', // 기존 시나리오의 이미지 URL 로드
      context: scenario.context,
      objectives: scenario.objectives,
      successCriteria: scenario.successCriteria,
      // personas가 객체 배열인 경우 ID만 추출, 문자열 배열인 경우 그대로 사용
      personas: Array.isArray(scenario.personas) 
        ? scenario.personas.map((p: any) => {
            if (typeof p === 'string') {
              return {
                id: p,
                name: '',
                gender: 'male' as const,
                mbti: p.toUpperCase(),
                department: '',
                position: '',
                experience: '',
                personaRef: p + '.json',
                stance: '',
                goal: '',
                tradeoff: ''
              };
            }
            // 객체인 경우 mbti 필드가 없으면 id를 대문자로 변환해서 사용 (하위 호환성)
            return {
              ...p,
              mbti: p.mbti || p.id.toUpperCase()
            } as ScenarioPersona;
          })
        : [],
      recommendedFlow: scenario.recommendedFlow
    });
    setIsCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingScenario) {
      updateMutation.mutate({ id: editingScenario.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const addSkill = (skill: string) => {
    if (skill && !formData.skills.includes(skill)) {
      setFormData(prev => ({
        ...prev,
        skills: [...prev.skills, skill]
      }));
    }
  };

  const removeSkill = (index: number) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index)
    }));
  };

  const addObjective = (objective: string) => {
    if (objective && !formData.objectives.includes(objective)) {
      setFormData(prev => ({
        ...prev,
        objectives: [...prev.objectives, objective]
      }));
    }
  };

  const removeObjective = (index: number) => {
    setFormData(prev => ({
      ...prev,
      objectives: prev.objectives.filter((_, i) => i !== index)
    }));
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
                
                {/* 시나리오 이미지 - 최상단으로 이동 */}
                <div className="space-y-3">
                  <Label htmlFor="image">시나리오 이미지 URL (선택사항)</Label>
                  <Input
                    id="image"
                    value={formData.image || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, image: e.target.value }))}
                    placeholder="이미지 URL을 입력하세요 (예: https://example.com/image.jpg)"
                    data-testid="input-scenario-image"
                  />
                  
                  {/* 이미지 미리보기 */}
                  {formData.image && (
                    <div className="mt-3">
                      <p className="text-sm text-slate-600 mb-2">이미지 미리보기:</p>
                      <div className="relative w-full h-48 bg-slate-100 rounded-lg overflow-hidden border">
                        <img
                          src={formData.image}
                          alt="시나리오 이미지 미리보기"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500 text-sm"><i class="fas fa-exclamation-triangle mr-2"></i>이미지를 불러올 수 없습니다</div>';
                            }
                          }}
                          data-testid="scenario-image-preview"
                        />
                      </div>
                    </div>
                  )}
                </div>
                
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
                      required
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
                    placeholder="시나리오에 대한 자세한 설명을 입력하세요"
                    className="min-h-[100px]"
                    required
                    data-testid="textarea-scenario-description"
                  />
                </div>

                <div>
                  <Label htmlFor="difficulty">난이도</Label>
                  <Select value={formData.difficulty.toString()} onValueChange={(value) => 
                    setFormData(prev => ({ ...prev, difficulty: parseInt(value) }))
                  }>
                    <SelectTrigger data-testid="select-difficulty">
                      <SelectValue placeholder="난이도를 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">매우 쉬움 (★☆☆☆)</SelectItem>
                      <SelectItem value="2">기본 (★★☆☆)</SelectItem>
                      <SelectItem value="3">도전형 (★★★☆)</SelectItem>
                      <SelectItem value="4">고난도 (★★★★)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 상황 설정 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">상황 설정</h3>
                
                <div>
                  <Label htmlFor="situation">상황 설명</Label>
                  <Textarea
                    id="situation"
                    value={formData.context.situation}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      context: { ...prev.context, situation: e.target.value }
                    }))}
                    placeholder="현재 상황을 자세히 설명하세요"
                    className="min-h-[80px]"
                    data-testid="textarea-situation"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="timeline">시간 제약</Label>
                    <Input
                      id="timeline"
                      value={formData.context.timeline}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { ...prev.context, timeline: e.target.value }
                      }))}
                      placeholder="예: 마케팅 발표까지 1주일 남음"
                      data-testid="input-timeline"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="stakes">이해관계</Label>
                    <Input
                      id="stakes"
                      value={formData.context.stakes}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { ...prev.context, stakes: e.target.value }
                      }))}
                      placeholder="예: 품질 vs 일정 vs 고객 만족도"
                      data-testid="input-stakes"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="position">플레이어 직급</Label>
                    <Input
                      id="position"
                      value={formData.context.playerRole.position}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { 
                          ...prev.context, 
                          playerRole: { ...prev.context.playerRole, position: e.target.value }
                        }
                      }))}
                      placeholder="예: 신입 개발자"
                      data-testid="input-position"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="playerDepartment">플레이어 부서</Label>
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
                      placeholder="예: 개발팀"
                      data-testid="input-player-department"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="playerExperience">플레이어 경력</Label>
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
                      placeholder="예: 6개월차"
                      data-testid="input-player-experience"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="responsibility">책임 사항</Label>
                    <Input
                      id="responsibility"
                      value={formData.context.playerRole.responsibility}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { 
                          ...prev.context, 
                          playerRole: { ...prev.context.playerRole, responsibility: e.target.value }
                        }
                      }))}
                      placeholder="예: 각 부서와 협의하여 최적 해결안 도출"
                      data-testid="input-responsibility"
                    />
                  </div>
                </div>
              </div>

              {/* 목표 및 성공 기준 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">목표 및 성공 기준</h3>
                
                <div>
                  <Label htmlFor="objectives">목표 (줄바꿈으로 구분)</Label>
                  <Textarea
                    id="objectives"
                    value={formData.objectives.join('\n')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      objectives: e.target.value.split('\n').filter(obj => obj.trim())
                    }))}
                    placeholder="각 부서의 이해관계와 우려사항 파악&#10;부서 간 갈등을 중재하고 합의점 도출&#10;품질과 일정을 균형있게 고려한 현실적 해결책 제시"
                    className="min-h-[100px]"
                    data-testid="textarea-objectives"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="optimal">최적 결과</Label>
                    <Textarea
                      id="optimal"
                      value={formData.successCriteria.optimal}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, optimal: e.target.value }
                      }))}
                      placeholder="모든 부서가 만족하는 타협안 도출"
                      className="min-h-[60px]"
                      data-testid="textarea-optimal"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="good">우수 결과</Label>
                    <Textarea
                      id="good"
                      value={formData.successCriteria.good}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, good: e.target.value }
                      }))}
                      placeholder="주요 이해관계자들의 핵심 요구사항 반영"
                      className="min-h-[60px]"
                      data-testid="textarea-good"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="acceptable">수용 가능 결과</Label>
                    <Textarea
                      id="acceptable"
                      value={formData.successCriteria.acceptable}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, acceptable: e.target.value }
                      }))}
                      placeholder="최소한의 품질 기준을 유지하면서 일정 준수"
                      className="min-h-[60px]"
                      data-testid="textarea-acceptable"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="failure">실패 기준</Label>
                    <Textarea
                      id="failure"
                      value={formData.successCriteria.failure}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, failure: e.target.value }
                      }))}
                      placeholder="부서 간 갈등 심화 또는 비현실적 해결책 제시"
                      className="min-h-[60px]"
                      data-testid="textarea-failure"
                    />
                  </div>
                </div>
              </div>

              {/* 역량 및 페르소나 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">역량 및 페르소나</h3>
                
                <div>
                  <Label htmlFor="skills">주요 역량 (쉼표로 구분)</Label>
                  <Input
                    id="skills"
                    value={formData.skills.join(', ')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      skills: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                    }))}
                    placeholder="갈등 중재, 이해관계자 관리, 문제 해결, 협상"
                    data-testid="input-skills"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {formData.skills.map((skill, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {skill}
                        <button 
                          type="button"
                          onClick={() => removeSkill(index)}
                          className="ml-1 hover:bg-red-200"
                          data-testid={`remove-skill-${index}`}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label>페르소나 관리</Label>
                    <Button
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          personas: [...prev.personas, {
                            id: '',
                            name: '',
                            gender: 'male', // 성별 기본값 추가
                            mbti: '', // MBTI 기본값 추가
                            department: '',
                            position: '',
                            experience: '',
                            personaRef: '',
                            stance: '',
                            goal: '',
                            tradeoff: ''
                          }]
                        }));
                      }}
                      variant="outline"
                      size="sm"
                      data-testid="add-persona"
                    >
                      <i className="fas fa-plus mr-1"></i>
                      페르소나 추가
                    </Button>
                  </div>
                  
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {formData.personas.map((persona, index) => (
                      <div key={index} className="border rounded-lg p-4 space-y-3 bg-slate-50">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-slate-700">페르소나 #{index + 1}</h4>
                          <Button
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                personas: prev.personas.filter((_, i) => i !== index)
                              }));
                            }}
                            variant="destructive"
                            size="sm"
                            data-testid={`remove-persona-${index}`}
                          >
                            <i className="fas fa-trash"></i>
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor={`persona-mbti-${index}`}>MBTI *</Label>
                            <Input
                              id={`persona-mbti-${index}`}
                              value={persona.mbti}
                              onChange={(e) => {
                                const mbtiValue = e.target.value.toUpperCase();
                                const idValue = e.target.value.toLowerCase();
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { 
                                  ...persona, 
                                  mbti: mbtiValue,
                                  id: idValue, 
                                  personaRef: idValue + '.json' 
                                };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder="ISTJ, ENFJ, INTP 등"
                              data-testid={`input-persona-mbti-${index}`}
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-name-${index}`}>이름 *</Label>
                            <Input
                              id={`persona-name-${index}`}
                              value={persona.name}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, name: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder="김민수, 이지영 등"
                              data-testid={`input-persona-name-${index}`}
                            />
                          </div>

                          <div>
                            <Label htmlFor={`persona-gender-${index}`}>성별 *</Label>
                            <Select
                              value={persona.gender}
                              onValueChange={(value: 'male' | 'female') => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, gender: value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                            >
                              <SelectTrigger data-testid={`select-persona-gender-${index}`}>
                                <SelectValue placeholder="성별 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="male">남성</SelectItem>
                                <SelectItem value="female">여성</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-department-${index}`}>부서 *</Label>
                            <Input
                              id={`persona-department-${index}`}
                              value={persona.department}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, department: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder="개발팀, 마케팅팀, QA팀 등"
                              data-testid={`input-persona-department-${index}`}
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-position-${index}`}>직책 *</Label>
                            <Input
                              id={`persona-position-${index}`}
                              value={persona.position}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, position: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder="선임 개발자, 매니저 등"
                              data-testid={`input-persona-position-${index}`}
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-experience-${index}`}>경력</Label>
                            <Input
                              id={`persona-experience-${index}`}
                              value={persona.experience}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, experience: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder="8년차, 신입, 5년차 등"
                              data-testid={`input-persona-experience-${index}`}
                            />
                          </div>
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-stance-${index}`}>입장/태도 *</Label>
                          <Textarea
                            id={`persona-stance-${index}`}
                            value={persona.stance}
                            onChange={(e) => {
                              const newPersonas = [...formData.personas];
                              newPersonas[index] = { ...persona, stance: e.target.value };
                              setFormData(prev => ({ ...prev, personas: newPersonas }));
                            }}
                            placeholder="이 상황에 대한 구체적인 입장과 의견"
                            rows={2}
                            data-testid={`input-persona-stance-${index}`}
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-goal-${index}`}>목표 *</Label>
                          <Textarea
                            id={`persona-goal-${index}`}
                            value={persona.goal}
                            onChange={(e) => {
                              const newPersonas = [...formData.personas];
                              newPersonas[index] = { ...persona, goal: e.target.value };
                              setFormData(prev => ({ ...prev, personas: newPersonas }));
                            }}
                            placeholder="개인적인 목표와 원하는 결과"
                            rows={2}
                            data-testid={`input-persona-goal-${index}`}
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-tradeoff-${index}`}>양보 조건</Label>
                          <Textarea
                            id={`persona-tradeoff-${index}`}
                            value={persona.tradeoff}
                            onChange={(e) => {
                              const newPersonas = [...formData.personas];
                              newPersonas[index] = { ...persona, tradeoff: e.target.value };
                              setFormData(prev => ({ ...prev, personas: newPersonas }));
                            }}
                            placeholder="양보할 수 있는 부분이나 조건"
                            rows={2}
                            data-testid={`input-persona-tradeoff-${index}`}
                          />
                        </div>
                      </div>
                    ))}
                    
                    {formData.personas.length === 0 && (
                      <div className="text-center py-8 text-slate-500">
                        <i className="fas fa-users text-4xl mb-2"></i>
                        <p>페르소나를 추가해주세요</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-4">
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
                  {editingScenario ? '수정하기' : '생성하기'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
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
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-scenario-${scenario.id}`}
                      >
                        <i className="fas fa-trash"></i>
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>시나리오 삭제 확인</AlertDialogTitle>
                        <AlertDialogDescription className="space-y-2">
                          <div>
                            <strong>"{scenario.title}"</strong> 시나리오를 정말 삭제하시겠습니까?
                          </div>
                          <div className="text-red-600 font-medium">
                            ⚠️ 삭제된 시나리오는 복구할 수 없습니다.
                          </div>
                          <div className="text-slate-600 text-sm">
                            이 작업은 되돌릴 수 없으니 신중하게 결정해주세요.
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteMutation.mutate(scenario.id)}
                          className="bg-red-600 hover:bg-red-700"
                          data-testid={`confirm-delete-scenario-${scenario.id}`}
                        >
                          삭제
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600 mb-4">{scenario.description}</p>
              
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium text-slate-700 mb-1">주요 역량</h4>
                  <div className="flex flex-wrap gap-1">
                    {(scenario.skills || []).map((skill, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-slate-700 mb-1">포함된 페르소나</h4>
                  <div className="flex flex-wrap gap-1">
                    {(scenario.personas || []).map((persona, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {typeof persona === 'string' ? persona : (persona as any).name || (persona as any).id || '알 수 없는 페르소나'}
                      </Badge>
                    ))}
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