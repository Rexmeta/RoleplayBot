import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { ScenarioPersona } from '@/lib/scenario-system';

interface PersonaFormData {
  name: string;
  role: string;
  department: string;
  experience: string;
  image: string;
  personality: {
    traits: string[];
    communicationStyle: string;
    motivation: string;
    fears: string[];
  };
  background: {
    education: string;
    previousExperience: string;
    majorProjects: string[];
    expertise: string[];
  };
  currentSituation: {
    workload: string;
    pressure: string;
    concerns: string[];
    position: string;
  };
  communicationPatterns: {
    openingStyle: string;
    keyPhrases: string[];
    responseToArguments: Record<string, string>;
    winConditions: string[];
  };
  voice: {
    tone: string;
    pace: string;
    emotion: string;
  };
}

export function PersonaManager() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<ScenarioPersona | null>(null);
  const [formData, setFormData] = useState<PersonaFormData>({
    name: '',
    role: '',
    department: '',
    experience: '',
    image: '',
    personality: {
      traits: '',
      motivation: '',
      concerns: ''
    },
    communicationStyle: {
      tone: '',
      approach: '',
      keyPhrases: []
    },
    goals: [],
    background: '',
    expertise: []
  });

  const { data: personas, isLoading } = useQuery<ScenarioPersona[]>({
    queryKey: ['/api/admin/personas'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: PersonaFormData) => {
      const response = await apiRequest('POST', '/api/admin/personas', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/personas'] });
      setIsCreateOpen(false);
      resetForm();
      toast({
        title: "페르소나 생성 완료",
        description: "새로운 페르소나가 성공적으로 생성되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "생성 실패",
        description: "페르소나 생성 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PersonaFormData }) => {
      const response = await apiRequest('PUT', `/api/admin/personas/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/personas'] });
      setEditingPersona(null);
      resetForm();
      toast({
        title: "페르소나 수정 완료",
        description: "페르소나가 성공적으로 수정되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "수정 실패",
        description: "페르소나 수정 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/admin/personas/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/personas'] });
      toast({
        title: "페르소나 삭제 완료",
        description: "페르소나가 성공적으로 삭제되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "삭제 실패",
        description: "페르소나 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const resetForm = () => {
    setFormData({
      name: '',
      role: '',
      department: '',
      experience: '',
      image: '',
      personality: {
        traits: [],
        communicationStyle: '',
        motivation: '',
        fears: []
      },
      background: {
        education: '',
        previousExperience: '',
        majorProjects: [],
        expertise: []
      },
      currentSituation: {
        workload: '',
        pressure: '',
        concerns: [],
        position: ''
      },
      communicationPatterns: {
        openingStyle: '',
        keyPhrases: [],
        responseToArguments: {},
        winConditions: []
      },
      voice: {
        tone: '',
        pace: '',
        emotion: ''
      }
    });
  };

  const handleEdit = (persona: ScenarioPersona) => {
    setEditingPersona(persona);
    setFormData({
      name: persona.name,
      role: persona.role,
      department: persona.department,
      experience: persona.experience,
      image: persona.image,
      personality: persona.personality,
      background: persona.background,
      currentSituation: persona.currentSituation,
      communicationPatterns: persona.communicationPatterns,
      voice: persona.voice
    });
    setIsCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPersona) {
      updateMutation.mutate({ id: editingPersona.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
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
          <h2 className="text-2xl font-bold text-slate-900">페르소나 관리</h2>
          <p className="text-slate-600 mt-1">AI 페르소나를 생성하고 관리할 수 있습니다.</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button 
              className="bg-corporate-600 hover:bg-corporate-700"
              onClick={() => {
                resetForm();
                setEditingPersona(null);
              }}
              data-testid="button-create-persona"
            >
              <i className="fas fa-user-plus mr-2"></i>
              새 페르소나 생성
            </Button>
          </DialogTrigger>
          
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingPersona ? '페르소나 편집' : '새 페르소나 생성'}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 기본 정보 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">기본 정보</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="name">이름</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="페르소나 이름"
                      required
                      data-testid="input-persona-name"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="department">부서</Label>
                    <Input
                      id="department"
                      value={formData.department}
                      onChange={(e) => setFormData(prev => ({ ...prev, department: e.target.value }))}
                      placeholder="예: 개발팀, 마케팅팀"
                      required
                      data-testid="input-persona-department"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="role">직급/역할</Label>
                    <Input
                      id="role"
                      value={formData.role}
                      onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
                      placeholder="예: 선임 개발자, 팀장"
                      required
                      data-testid="input-persona-role"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="experience">경력</Label>
                    <Input
                      id="experience"
                      value={formData.experience}
                      onChange={(e) => setFormData(prev => ({ ...prev, experience: e.target.value }))}
                      placeholder="예: 5년차, 10년 이상"
                      required
                      data-testid="input-persona-experience"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="image">프로필 이미지 URL</Label>
                  <Input
                    id="image"
                    value={formData.image}
                    onChange={(e) => setFormData(prev => ({ ...prev, image: e.target.value }))}
                    placeholder="https://example.com/image.jpg"
                    data-testid="input-persona-image"
                  />
                </div>
              </div>

              {/* 성격 및 소통 스타일 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">성격 및 소통 스타일</h3>
                
                <div>
                  <Label htmlFor="traits">성격 특성</Label>
                  <Textarea
                    id="traits"
                    value={formData.personality.traits}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      personality: { ...prev.personality, traits: e.target.value }
                    }))}
                    placeholder="기술적 완벽주의자로 품질을 중시하며, 스케줄 압박 상황에서도 기술적 타협을 거부하는 경향"
                    className="min-h-[80px]"
                    data-testid="textarea-traits"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="motivation">동기 요인</Label>
                    <Textarea
                      id="motivation"
                      value={formData.personality.motivation}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        personality: { ...prev.personality, motivation: e.target.value }
                      }))}
                      placeholder="높은 품질의 제품 출시와 기술적 완성도 추구"
                      className="min-h-[60px]"
                      data-testid="textarea-motivation"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="concerns">주요 우려사항</Label>
                    <Textarea
                      id="concerns"
                      value={formData.personality.concerns}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        personality: { ...prev.personality, concerns: e.target.value }
                      }))}
                      placeholder="품질 저하로 인한 서비스 장애, 기술적 문제 발생"
                      className="min-h-[60px]"
                      data-testid="textarea-concerns"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="tone">대화 톤</Label>
                    <Input
                      id="tone"
                      value={formData.communicationStyle.tone}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        communicationStyle: { ...prev.communicationStyle, tone: e.target.value }
                      }))}
                      placeholder="예: 신중하고 분석적, 직설적이고 실용적"
                      data-testid="input-tone"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="approach">접근 방식</Label>
                    <Input
                      id="approach"
                      value={formData.communicationStyle.approach}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        communicationStyle: { ...prev.communicationStyle, approach: e.target.value }
                      }))}
                      placeholder="예: 데이터 기반 논리적 접근, 경험 중심 조언"
                      data-testid="input-approach"
                    />
                  </div>
                </div>
              </div>

              {/* 배경 및 전문성 */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">배경 및 전문성</h3>
                
                <div>
                  <Label htmlFor="background">배경 스토리</Label>
                  <Textarea
                    id="background"
                    value={formData.background}
                    onChange={(e) => setFormData(prev => ({ ...prev, background: e.target.value }))}
                    placeholder="5년간 모바일 앱 개발을 해오며 다양한 기술적 이슈를 경험함. 품질 저하로 인한 서비스 장애를 여러 번 겪어 신중한 접근을 선호함."
                    className="min-h-[100px]"
                    data-testid="textarea-background"
                  />
                </div>

                <div>
                  <Label htmlFor="expertise">전문 분야 (쉼표로 구분)</Label>
                  <Input
                    id="expertise"
                    value={formData.expertise.join(', ')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      expertise: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                    }))}
                    placeholder="모바일 개발, 코드 리뷰, 아키텍처 설계, 성능 최적화"
                    data-testid="input-expertise"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {formData.expertise.map((skill, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {skill}
                        <button 
                          type="button"
                          onClick={() => setFormData(prev => ({ 
                            ...prev, 
                            expertise: prev.expertise.filter((_, i) => i !== index)
                          }))}
                          className="ml-1 hover:bg-red-200"
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="goals">훈련 목표 (줄바꿈으로 구분)</Label>
                  <Textarea
                    id="goals"
                    value={formData.goals.join('\n')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      goals: e.target.value.split('\n').filter(goal => goal.trim())
                    }))}
                    placeholder="기술적 설득 능력&#10;논리적 문제 해결&#10;품질과 일정의 균형 조율"
                    className="min-h-[100px]"
                    data-testid="textarea-goals"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setEditingPersona(null);
                    resetForm();
                  }}
                  data-testid="button-cancel-persona"
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  className="bg-corporate-600 hover:bg-corporate-700"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-persona"
                >
                  {editingPersona ? '수정하기' : '생성하기'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* 페르소나 목록 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {personas?.map((persona) => (
          <Card key={persona.id} className="card-enhanced">
            <CardHeader>
              <div className="flex items-center space-x-4">
                <img 
                  src={persona.image} 
                  alt={persona.name}
                  className="w-12 h-12 rounded-full"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=48`;
                  }}
                />
                <div className="flex-1">
                  <CardTitle className="text-lg">{persona.name}</CardTitle>
                  <p className="text-sm text-slate-600">{persona.role}</p>
                  <Badge variant="outline" className="text-xs mt-1">
                    {persona.department}
                  </Badge>
                </div>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(persona)}
                    data-testid={`button-edit-persona-${persona.id}`}
                  >
                    <i className="fas fa-edit"></i>
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteMutation.mutate(persona.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-persona-${persona.id}`}
                  >
                    <i className="fas fa-trash"></i>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <h4 className="font-medium text-slate-700 mb-1">성격 특성</h4>
                  <p className="text-sm text-slate-600">{persona.personality.traits.join(', ')}</p>
                </div>
                
                <div>
                  <h4 className="font-medium text-slate-700 mb-1">전문 분야</h4>
                  <div className="flex flex-wrap gap-1">
                    {persona.background.expertise.map((skill, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <div>
                  <h4 className="font-medium text-slate-700 mb-1">성격 특성</h4>
                  <div className="space-y-1">
                    {persona.personality.traits.slice(0, 2).map((trait, index) => (
                      <p key={index} className="text-xs text-slate-600">• {trait}</p>
                    ))}
                    {persona.personality.traits.length > 2 && (
                      <p className="text-xs text-slate-500">+{persona.personality.traits.length - 2}개 더</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {personas?.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">👤</div>
          <h3 className="text-xl font-medium text-slate-600 mb-2">페르소나가 없습니다</h3>
          <p className="text-slate-500 mb-4">새로운 AI 페르소나를 생성해보세요</p>
          <Button
            onClick={() => {
              resetForm();
              setEditingPersona(null);
              setIsCreateOpen(true);
            }}
            className="bg-corporate-600 hover:bg-corporate-700"
          >
            첫 번째 페르소나 생성
          </Button>
        </div>
      )}
    </div>
  );
}