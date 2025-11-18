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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Edit, Trash2 } from 'lucide-react';

// MBTI 페르소나 타입 정의
interface MBTIPersona {
  id: string;
  mbti: string;
  gender: 'male' | 'female'; // 성별 필드 추가
  conversationDifficultyLevel?: number; // 난이도 필드 추가 (1-4)
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
  conversationDifficultyLevel: number; // 난이도 필드 추가 (1-4)
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
    conversationDifficultyLevel: 3, // 난이도 기본값
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
      conversationDifficultyLevel: 3, // 난이도 기본값
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
      conversationDifficultyLevel: persona.conversationDifficultyLevel || 3, // 난이도 필드 추가
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="gender">성별</Label>
                  <Select value={formData.gender} onValueChange={(value: 'male' | 'female') => 
                    setFormData(prev => ({ ...prev, gender: value }))
                  }>
                    <SelectTrigger data-testid="select-gender">
                      <SelectValue placeholder="성별 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">남성</SelectItem>
                      <SelectItem value="female">여성</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="difficulty">대화 난이도</Label>
                  <Select value={formData.conversationDifficultyLevel.toString()} onValueChange={(value) => 
                    setFormData(prev => ({ ...prev, conversationDifficultyLevel: parseInt(value) }))
                  }>
                    <SelectTrigger data-testid="select-difficulty">
                      <SelectValue placeholder="난이도 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 - 매우 쉬움 (★☆☆☆)</SelectItem>
                      <SelectItem value="2">2 - 기본 (★★☆☆)</SelectItem>
                      <SelectItem value="3">3 - 도전형 (★★★☆)</SelectItem>
                      <SelectItem value="4">4 - 고난도 (★★★★)</SelectItem>
                    </SelectContent>
                  </Select>
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

              <div>
                <Label htmlFor="motivation">동기</Label>
                <Textarea
                  id="motivation"
                  value={formData.motivation}
                  onChange={(e) => setFormData(prev => ({ ...prev, motivation: e.target.value }))}
                  placeholder="효율적 문제 해결과 신뢰 구축"
                  data-testid="input-motivation"
                />
              </div>

              <div>
                <Label htmlFor="fears">두려움/우려사항 (쉼표로 구분)</Label>
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

              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-medium text-slate-800">배경 정보</h3>
                
                <div>
                  <Label htmlFor="personal_values">개인 가치관 (쉼표로 구분)</Label>
                  <Input
                    id="personal_values"
                    value={formData.background?.personal_values?.join(', ') || ''}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      background: {
                        ...prev.background,
                        personal_values: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                      }
                    }))}
                    placeholder="협력, 공감, 조화, 자유, 즐거움"
                    data-testid="input-personal-values"
                  />
                </div>

                <div>
                  <Label htmlFor="hobbies">취미 (쉼표로 구분)</Label>
                  <Input
                    id="hobbies"
                    value={formData.background?.hobbies?.join(', ') || ''}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      background: {
                        ...prev.background,
                        hobbies: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                      }
                    }))}
                    placeholder="리더십 활동, 멘토링, 파티, 여행"
                    data-testid="input-hobbies"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="social_preference">사회적 선호</Label>
                    <Input
                      id="social_preference"
                      value={formData.background?.social?.preference || ''}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        background: {
                          ...prev.background,
                          social: {
                            ...prev.background?.social,
                            preference: e.target.value
                          }
                        }
                      }))}
                      placeholder="넓은 관계 유지"
                      data-testid="input-social-preference"
                    />
                  </div>

                  <div>
                    <Label htmlFor="social_behavior">사회적 행동</Label>
                    <Input
                      id="social_behavior"
                      value={formData.background?.social?.behavior || ''}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        background: {
                          ...prev.background,
                          social: {
                            ...prev.background?.social,
                            behavior: e.target.value
                          }
                        }
                      }))}
                      placeholder="협력과 조율 강조"
                      data-testid="input-social-behavior"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-medium text-slate-800">의사소통 패턴</h3>
                
                <div>
                  <Label htmlFor="opening_style">대화 시작 스타일</Label>
                  <Input
                    id="opening_style"
                    value={formData.communication_patterns?.opening_style || ''}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      communication_patterns: {
                        ...prev.communication_patterns,
                        opening_style: e.target.value
                      }
                    }))}
                    placeholder="바로 핵심 주제로 직행 / 유머나 경험 공유로 시작"
                    data-testid="input-opening-style"
                  />
                </div>

                <div>
                  <Label htmlFor="key_phrases">주요 표현 (쉼표로 구분)</Label>
                  <Textarea
                    id="key_phrases"
                    value={formData.communication_patterns?.key_phrases?.join(', ') || ''}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      communication_patterns: {
                        ...prev.communication_patterns,
                        key_phrases: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                      }
                    }))}
                    placeholder="솔직히 말씀드리면..., 이거 재미있지 않아요?, 논리적으로 맞지 않습니다."
                    className="min-h-[60px]"
                    data-testid="textarea-key-phrases"
                  />
                </div>

                <div>
                  <Label htmlFor="win_conditions">승리 조건 (쉼표로 구분)</Label>
                  <Textarea
                    id="win_conditions"
                    value={formData.communication_patterns?.win_conditions?.join(', ') || ''}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      communication_patterns: {
                        ...prev.communication_patterns,
                        win_conditions: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                      }
                    }))}
                    placeholder="상대가 논리적 허점을 인정, 즐거움과 합리적 해결책 균형"
                    className="min-h-[60px]"
                    data-testid="textarea-win-conditions"
                  />
                </div>
              </div>

              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-medium text-slate-800">음성 특성</h3>
                
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="voice_tone">톤</Label>
                    <Input
                      id="voice_tone"
                      value={formData.voice?.tone || ''}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        voice: { ...prev.voice, tone: e.target.value }
                      }))}
                      placeholder="따뜻하고 설득적"
                      data-testid="input-voice-tone"
                    />
                  </div>

                  <div>
                    <Label htmlFor="voice_pace">속도</Label>
                    <Input
                      id="voice_pace"
                      value={formData.voice?.pace || ''}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        voice: { ...prev.voice, pace: e.target.value }
                      }))}
                      placeholder="중간 / 빠름"
                      data-testid="input-voice-pace"
                    />
                  </div>

                  <div>
                    <Label htmlFor="voice_emotion">감정</Label>
                    <Input
                      id="voice_emotion"
                      value={formData.voice?.emotion || ''}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        voice: { ...prev.voice, emotion: e.target.value }
                      }))}
                      placeholder="공감과 진지함"
                      data-testid="input-voice-emotion"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 border-t pt-4">
                <h3 className="text-lg font-medium text-slate-800">이미지 정보</h3>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="image_profile">프로필 이미지 URL</Label>
                    <Input
                      id="image_profile"
                      value={formData.image?.profile || ''}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        image: { ...prev.image, profile: e.target.value }
                      }))}
                      placeholder="https://picsum.photos/seed/mbti/150/150"
                      data-testid="input-image-profile"
                    />
                  </div>

                  <div>
                    <Label htmlFor="image_style">이미지 스타일</Label>
                    <Input
                      id="image_style"
                      value={formData.image?.style || ''}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        image: { ...prev.image, style: e.target.value }
                      }))}
                      placeholder="실제 인물 사진 느낌"
                      data-testid="input-image-style"
                    />
                  </div>
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
                      {persona.conversationDifficultyLevel && (
                        <Badge variant="outline" className="bg-orange-100 text-orange-800">
                          난이도 {persona.conversationDifficultyLevel}/4 {'★'.repeat(persona.conversationDifficultyLevel)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(persona)}
                      data-testid={`button-edit-persona-${persona.id}`}
                      className="p-2"
                      title="편집"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeletingPersona(persona)}
                          data-testid={`button-delete-persona-${persona.id}`}
                          className="p-2"
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4" />
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
                      {(persona.personality_traits || []).map((trait, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {trait}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-slate-700 mb-1">동기</h4>
                    <p className="text-sm text-slate-600">{persona.motivation}</p>
                  </div>

                  {persona.fears && persona.fears.length > 0 && (
                    <div>
                      <h4 className="font-medium text-slate-700 mb-1">두려움</h4>
                      <div className="flex flex-wrap gap-1">
                        {persona.fears.map((fear, index) => (
                          <Badge key={index} variant="outline" className="text-xs bg-red-50 text-red-700">
                            {fear}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {persona.background && (
                    <div>
                      <h4 className="font-medium text-slate-700 mb-1">배경</h4>
                      {persona.background.personal_values && persona.background.personal_values.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs text-slate-500 mb-1">가치관:</p>
                          <div className="flex flex-wrap gap-1">
                            {persona.background.personal_values.map((value, index) => (
                              <Badge key={index} variant="outline" className="text-xs bg-blue-50 text-blue-700">
                                {value}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {persona.background.hobbies && persona.background.hobbies.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs text-slate-500 mb-1">취미:</p>
                          <div className="flex flex-wrap gap-1">
                            {persona.background.hobbies.map((hobby, index) => (
                              <Badge key={index} variant="outline" className="text-xs bg-green-50 text-green-700">
                                {hobby}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {persona.background.social && (
                        <div>
                          <p className="text-xs text-slate-500 mb-1">사회적 특성:</p>
                          <p className="text-xs text-slate-600">{persona.background.social.preference} - {persona.background.social.behavior}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {persona.communication_patterns && (
                    <div>
                      <h4 className="font-medium text-slate-700 mb-1">의사소통 패턴</h4>
                      {persona.communication_patterns.opening_style && (
                        <div className="mb-2">
                          <p className="text-xs text-slate-500">대화 시작 스타일:</p>
                          <p className="text-xs text-slate-600">{persona.communication_patterns.opening_style}</p>
                        </div>
                      )}
                      {persona.communication_patterns.key_phrases && persona.communication_patterns.key_phrases.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs text-slate-500 mb-1">주요 표현:</p>
                          <div className="flex flex-wrap gap-1">
                            {persona.communication_patterns.key_phrases.slice(0, 2).map((phrase, index) => (
                              <Badge key={index} variant="outline" className="text-xs bg-purple-50 text-purple-700">
                                "{phrase}"
                              </Badge>
                            ))}
                            {persona.communication_patterns.key_phrases.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{persona.communication_patterns.key_phrases.length - 2}개 더
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                      {persona.communication_patterns.win_conditions && persona.communication_patterns.win_conditions.length > 0 && (
                        <div>
                          <p className="text-xs text-slate-500 mb-1">승리 조건:</p>
                          <div className="flex flex-wrap gap-1">
                            {persona.communication_patterns.win_conditions.map((condition, index) => (
                              <Badge key={index} variant="outline" className="text-xs bg-yellow-50 text-yellow-700">
                                {condition}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {persona.voice && (
                    <div>
                      <h4 className="font-medium text-slate-700 mb-1">음성 특성</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {persona.voice.tone && (
                          <div>
                            <p className="text-xs text-slate-500">톤:</p>
                            <p className="text-xs text-slate-600">{persona.voice.tone}</p>
                          </div>
                        )}
                        {persona.voice.pace && (
                          <div>
                            <p className="text-xs text-slate-500">속도:</p>
                            <p className="text-xs text-slate-600">{persona.voice.pace}</p>
                          </div>
                        )}
                        {persona.voice.emotion && (
                          <div>
                            <p className="text-xs text-slate-500">감정:</p>
                            <p className="text-xs text-slate-600">{persona.voice.emotion}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

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