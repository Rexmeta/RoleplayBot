import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

// MBTI 페르소나 타입 정의
interface MBTIPersona {
  id: string;
  mbti: string;
  gender: 'male' | 'female'; // 성별 필드 추가
  personality_traits: string[];
  communication_style: string;
  motivation: string;
  fears: string[];
  background: {
    personal_values: string[];
    hobbies: string[];
    social: {
      preference: string;
      behavior: string;
    };
  };
  communication_patterns: {
    opening_style: string;
    key_phrases: string[];
    response_to_arguments: Record<string, string>;
    win_conditions: string[];
  };
  voice: {
    tone: string;
    pace: string;
    emotion: string;
  };
  image: {
    profile: string;
    style: string;
  };
}

// 시나리오별 페르소나 정보
interface ScenarioPersonaInfo {
  scenarioId: string;
  scenarioTitle: string;
  name: string;
  department: string;
  position: string;
  experience: string;
  stance: string;
  goal: string;
  tradeoff: string;
}

interface MBTIPersonaFormData {
  id: string;
  mbti: string;
  gender: 'male' | 'female'; // 성별 필드 추가
  personality_traits: string[];
  communication_style: string;
  motivation: string;
  fears: string[];
  background: {
    personal_values: string[];
    hobbies: string[];
    social: {
      preference: string;
      behavior: string;
    };
  };
  communication_patterns: {
    opening_style: string;
    key_phrases: string[];
    response_to_arguments: Record<string, string>;
    win_conditions: string[];
  };
  voice: {
    tone: string;
    pace: string;
    emotion: string;
  };
  image: {
    profile: string;
    style: string;
  };
}

export function PersonaManager() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<MBTIPersona | null>(null);
  const [deletingPersona, setDeletingPersona] = useState<MBTIPersona | null>(null);
  const [formData, setFormData] = useState<MBTIPersonaFormData>({
    id: '',
    mbti: '',
    gender: 'male', // 성별 기본값 설정
    personality_traits: [],
    communication_style: '',
    motivation: '',
    fears: [],
    background: {
      personal_values: [],
      hobbies: [],
      social: {
        preference: '',
        behavior: ''
      }
    },
    communication_patterns: {
      opening_style: '',
      key_phrases: [],
      response_to_arguments: {},
      win_conditions: []
    },
    voice: {
      tone: '',
      pace: '',
      emotion: ''
    },
    image: {
      profile: '',
      style: ''
    }
  });

  // MBTI 페르소나 목록 조회
  const { data: personas = [], isLoading, error } = useQuery({
    queryKey: ['/api/admin/personas'],
    queryFn: () => fetch('/api/admin/personas').then(res => res.json())
  });

  // 시나리오 목록 조회 (페르소나 사용 현황 확인용)
  const { data: scenarios = [] } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => fetch('/api/scenarios').then(res => res.json())
  });

  // 특정 MBTI 페르소나가 사용된 시나리오들 찾기
  const getPersonaUsageInScenarios = (personaId: string): ScenarioPersonaInfo[] => {
    const usage: ScenarioPersonaInfo[] = [];
    
    scenarios.forEach((scenario: any) => {
      if (scenario.personas) {
        const personaInScenario = scenario.personas.find((p: any) => 
          (typeof p === 'string' ? p === personaId : p.id === personaId)
        );
        
        if (personaInScenario && typeof personaInScenario === 'object') {
          usage.push({
            scenarioId: scenario.id,
            scenarioTitle: scenario.title,
            name: personaInScenario.name,
            department: personaInScenario.department,
            position: personaInScenario.position,
            experience: personaInScenario.experience,
            stance: personaInScenario.stance,
            goal: personaInScenario.goal,
            tradeoff: personaInScenario.tradeoff
          });
        }
      }
    });
    
    return usage;
  };

  const createMutation = useMutation({
    mutationFn: async (personaData: MBTIPersonaFormData) => {
      const response = await apiRequest("POST", "/api/admin/personas", personaData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/personas'] });
      setIsCreateOpen(false);
      resetForm();
      toast({
        title: "성공",
        description: "MBTI 페르소나가 생성되었습니다."
      });
    },
    onError: () => {
      toast({
        title: "오류",
        description: "페르소나 생성에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (personaData: MBTIPersonaFormData) => {
      const response = await apiRequest("PUT", `/api/admin/personas/${personaData.id}`, personaData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/personas'] });
      setEditingPersona(null);
      resetForm();
      toast({
        title: "성공",
        description: "MBTI 페르소나가 수정되었습니다."
      });
    },
    onError: () => {
      toast({
        title: "오류",
        description: "페르소나 수정에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (personaId: string) => {
      const response = await apiRequest("DELETE", `/api/admin/personas/${personaId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/personas'] });
      setDeletingPersona(null);
      toast({
        title: "성공",
        description: "MBTI 페르소나가 삭제되었습니다."
      });
    },
    onError: () => {
      toast({
        title: "오류",
        description: "페르소나 삭제에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const resetForm = () => {
    setFormData({
      id: '',
      mbti: '',
      gender: 'male', // 성별 기본값 추가
      personality_traits: [],
      communication_style: '',
      motivation: '',
      fears: [],
      background: {
        personal_values: [],
        hobbies: [],
        social: {
          preference: '',
          behavior: ''
        }
      },
      communication_patterns: {
        opening_style: '',
        key_phrases: [],
        response_to_arguments: {},
        win_conditions: []
      },
      voice: {
        tone: '',
        pace: '',
        emotion: ''
      },
      image: {
        profile: '',
        style: ''
      }
    });
  };

  const handleEdit = (persona: MBTIPersona) => {
    setFormData({
      id: persona.id,
      mbti: persona.mbti,
      gender: persona.gender || 'male', // 성별 필드 추가
      personality_traits: persona.personality_traits || [],
      communication_style: persona.communication_style || '',
      motivation: persona.motivation || '',
      fears: persona.fears || [],
      background: {
        personal_values: persona.background?.personal_values || [],
        hobbies: persona.background?.hobbies || [],
        social: {
          preference: persona.background?.social?.preference || '',
          behavior: persona.background?.social?.behavior || ''
        }
      },
      communication_patterns: {
        opening_style: persona.communication_patterns?.opening_style || '',
        key_phrases: persona.communication_patterns?.key_phrases || [],
        response_to_arguments: persona.communication_patterns?.response_to_arguments || {},
        win_conditions: persona.communication_patterns?.win_conditions || []
      },
      voice: {
        tone: persona.voice?.tone || '',
        pace: persona.voice?.pace || '',
        emotion: persona.voice?.emotion || ''
      },
      image: {
        profile: persona.image?.profile || '',
        style: persona.image?.style || ''
      }
    });
    setEditingPersona(persona);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (editingPersona) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">로딩 중...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-600">페르소나 데이터를 불러올 수 없습니다.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">MBTI 페르소나 관리</h2>
          <p className="text-slate-600 mt-1">성격 유형별 AI 페르소나를 관리합니다</p>
        </div>
        
        <Dialog open={isCreateOpen || !!editingPersona} onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setEditingPersona(null);
            resetForm();
          }
        }}>
          <DialogTrigger asChild>
            <Button 
              onClick={() => setIsCreateOpen(true)}
              className="bg-corporate-600 hover:bg-corporate-700"
              data-testid="button-create-persona"
            >
              새 MBTI 페르소나 생성
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingPersona ? 'MBTI 페르소나 수정' : '새 MBTI 페르소나 생성'}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="id">MBTI ID (소문자)</Label>
                  <Input
                    id="id"
                    value={formData.id}
                    onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
                    placeholder="istj, enfp, intp 등"
                    required
                    data-testid="input-persona-id"
                  />
                </div>
                <div>
                  <Label htmlFor="mbti">MBTI 유형 (대문자)</Label>
                  <Input
                    id="mbti"
                    value={formData.mbti}
                    onChange={(e) => setFormData(prev => ({ ...prev, mbti: e.target.value }))}
                    placeholder="ISTJ, ENFP, INTP 등"
                    required
                    data-testid="input-mbti"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="personality_traits">성격 특성 (쉼표로 구분)</Label>
                <Textarea
                  id="personality_traits"
                  value={formData.personality_traits.join(', ')}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    personality_traits: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                  }))}
                  placeholder="경험 기반 사고, 현실적, 해결책 지향"
                  className="min-h-[80px]"
                  data-testid="textarea-personality-traits"
                />
              </div>

              <div>
                <Label htmlFor="communication_style">의사소통 스타일</Label>
                <Textarea
                  id="communication_style"
                  value={formData.communication_style}
                  onChange={(e) => setFormData(prev => ({ ...prev, communication_style: e.target.value }))}
                  placeholder="차분하고 논리적이며, 구체적 사례를 중시함"
                  className="min-h-[60px]"
                  data-testid="textarea-communication-style"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="motivation">동기</Label>
                  <Input
                    id="motivation"
                    value={formData.motivation}
                    onChange={(e) => setFormData(prev => ({ ...prev, motivation: e.target.value }))}
                    placeholder="효율적 문제 해결과 신뢰 구축"
                    data-testid="input-motivation"
                  />
                </div>
                <div>
                  <Label htmlFor="fears">우려사항 (쉼표로 구분)</Label>
                  <Input
                    id="fears"
                    value={formData.fears.join(', ')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      fears: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                    }))}
                    placeholder="통제 불가능한 상황, 과부하, 혼란"
                    data-testid="input-fears"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setIsCreateOpen(false);
                    setEditingPersona(null);
                    resetForm();
                  }}
                >
                  취소
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="bg-corporate-600 hover:bg-corporate-700"
                  data-testid="button-save-persona"
                >
                  {createMutation.isPending || updateMutation.isPending ? '저장 중...' : '저장'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {personas.map((persona: MBTIPersona) => {
          const scenarioUsage = getPersonaUsageInScenarios(persona.id);
          
          return (
            <Card key={persona.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-2 flex items-center gap-2">
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm font-bold">
                        {persona.mbti}
                      </span>
                      <span className="text-slate-700">{persona.id}</span>
                    </CardTitle>
                    <p className="text-sm text-slate-600 mb-2">{persona.communication_style}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-green-100 text-green-800">
                        {scenarioUsage.length}개 시나리오에서 사용
                      </Badge>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(persona)}
                      data-testid={`button-edit-persona-${persona.id}`}
                    >
                      편집
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeletingPersona(persona)}
                          data-testid={`button-delete-persona-${persona.id}`}
                        >
                          삭제
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>페르소나 삭제</AlertDialogTitle>
                          <AlertDialogDescription>
                            <strong>{persona.mbti} ({persona.id})</strong> 페르소나를 삭제하시겠습니까?
                            <br /><br />
                            현재 {scenarioUsage.length}개 시나리오에서 사용 중입니다.
                            삭제 시 해당 시나리오들에 영향을 줄 수 있습니다.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setDeletingPersona(null)}>취소</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              if (deletingPersona) {
                                deleteMutation.mutate(deletingPersona.id);
                              }
                            }}
                            className="bg-red-600 hover:bg-red-700"
                          >
                            삭제하기
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium text-slate-700 mb-1">성격 특성</h4>
                    <div className="flex flex-wrap gap-1">
                      {(persona.personality_traits || []).slice(0, 3).map((trait, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {trait}
                        </Badge>
                      ))}
                      {persona.personality_traits?.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{persona.personality_traits.length - 3}개 더
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-slate-700 mb-1">동기</h4>
                    <p className="text-sm text-slate-600">{persona.motivation}</p>
                  </div>

                  {scenarioUsage.length > 0 && (
                    <div>
                      <h4 className="font-medium text-slate-700 mb-1">사용 현황</h4>
                      <div className="space-y-1">
                        {scenarioUsage.slice(0, 2).map((usage, index) => (
                          <div key={index} className="text-xs text-slate-600 bg-slate-50 p-2 rounded">
                            <div className="font-medium">{usage.scenarioTitle}</div>
                            <div>{usage.name} - {usage.position}</div>
                          </div>
                        ))}
                        {scenarioUsage.length > 2 && (
                          <p className="text-xs text-slate-500">+{scenarioUsage.length - 2}개 시나리오 더</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {personas?.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">🧠</div>
          <h3 className="text-xl font-medium text-slate-600 mb-2">MBTI 페르소나가 없습니다</h3>
          <p className="text-slate-500 mb-4">새로운 MBTI 성격 유형을 추가해보세요</p>
          <Button
            onClick={() => {
              resetForm();
              setEditingPersona(null);
              setIsCreateOpen(true);
            }}
            className="bg-corporate-600 hover:bg-corporate-700"
          >
            첫 번째 MBTI 페르소나 생성
          </Button>
        </div>
      )}
    </div>
  );
}