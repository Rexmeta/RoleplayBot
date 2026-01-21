import React, { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { ComplexScenario } from '@/lib/scenario-system';
import { Loader2, MoreVertical, ChevronDown, ChevronUp, Clock, Users, Target, Languages, Search } from 'lucide-react';
import { AIScenarioGenerator } from './AIScenarioGenerator';
import { ScenarioTranslationEditor } from './ScenarioTranslationEditor';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
  categoryId?: string; // 카테고리 ID 필드 추가
  evaluationCriteriaSetId?: string; // 평가 기준 세트 ID 필드 추가
  image?: string; // 시나리오 이미지 URL 필드 추가
  imagePrompt?: string; // 이미지 생성 프롬프트 필드 추가
  introVideoUrl?: string; // 인트로 비디오 URL 필드 추가
  videoPrompt?: string; // 비디오 생성 프롬프트 필드 추가
  objectiveType?: string; // 목표 유형 추가
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
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string | number>>(new Set());
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [translatingScenario, setTranslatingScenario] = useState<ComplexScenario | null>(null);
  const [formData, setFormData] = useState<ScenarioFormData>({
    title: '',
    description: '',
    difficulty: 2, // 기본값으로 고정 (유저가 시나리오 상세 화면에서 선택)
    estimatedTime: '',
    skills: [],
    categoryId: '', // 카테고리 ID 초기값 추가
    evaluationCriteriaSetId: '', // 평가 기준 세트 ID 초기값 추가
    image: '', // 이미지 초기값 추가
    imagePrompt: '', // 이미지 프롬프트 초기값 추가
    introVideoUrl: '', // 인트로 비디오 URL 초기값 추가
    videoPrompt: '', // 비디오 프롬프트 초기값 추가
    objectiveType: '', // 목표 유형 초기값 추가
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

  // 카테고리 목록 조회
  const { data: categories } = useQuery<{ id: string; name: string; description?: string }[]>({
    queryKey: ['/api/categories'],
  });

  // 평가 기준 세트 목록 조회
  const { data: evaluationCriteriaSets } = useQuery<{ id: string; name: string; description?: string; isDefault?: boolean }[]>({
    queryKey: ['/api/evaluation-criteria'],
  });

  // 등록된 페르소나 목록 조회
  const { data: availablePersonas = [] } = useQuery<{ id: string; mbti: string; personality_traits?: string[]; communication_style?: string }[]>({
    queryKey: ['/api/admin/personas'],
  });

  // 시나리오 내 이미 선택된 페르소나 ID 목록
  const selectedPersonaIds = useMemo(() => {
    return formData.personas.map(p => p.id).filter(id => id);
  }, [formData.personas]);

  // 특정 인덱스의 페르소나 슬롯에서 선택 가능한 페르소나 목록 (중복 방지)
  const getAvailablePersonasForSlot = (currentIndex: number) => {
    const currentPersonaId = formData.personas[currentIndex]?.id;
    return availablePersonas.filter(p => 
      p.id === currentPersonaId || !selectedPersonaIds.includes(p.id)
    );
  };

  // 시나리오 로드 시 모두 펼쳐진 상태로 초기화
  React.useEffect(() => {
    if (scenarios && scenarios.length > 0) {
      setExpandedScenarios(new Set(scenarios.map(s => s.id)));
    }
  }, [scenarios]);

  const handleAIGenerated = (result: any) => {
    // AI 생성 결과를 폼에 자동 입력 - 모든 필드 완전 복사
    const scenario = result.scenario || {};
    setFormData({
      title: scenario.title || '',
      description: scenario.description || '',
      difficulty: 2, // 난이도는 항상 기본값으로 고정
      estimatedTime: scenario.estimatedTime || '',
      skills: scenario.skills || [],
      categoryId: scenario.categoryId ? String(scenario.categoryId) : '',
      evaluationCriteriaSetId: scenario.evaluationCriteriaSetId || '',
      image: scenario.image || '',
      imagePrompt: scenario.imagePrompt || '',
      introVideoUrl: scenario.introVideoUrl || '',
      videoPrompt: scenario.videoPrompt || '',
      objectiveType: scenario.objectiveType || '',
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
      personas: scenario.personas || [],
      recommendedFlow: scenario.recommendedFlow || []
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
      difficulty: 2, // 기본값으로 고정
      estimatedTime: '',
      skills: [],
      categoryId: '', // 카테고리 ID 초기화
      evaluationCriteriaSetId: '', // 평가 기준 세트 ID 초기화
      image: '', // 이미지 필드 초기화 추가
      imagePrompt: '', // 이미지 프롬프트 초기화 추가
      introVideoUrl: '', // 인트로 비디오 URL 초기화 추가
      videoPrompt: '', // 비디오 프롬프트 초기화 추가
      objectiveType: '', // 목표 유형 초기화
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
      difficulty: 2, // 난이도는 항상 기본값으로 고정 (유저가 대화 시작 시 선택)
      estimatedTime: scenario.estimatedTime,
      skills: scenario.skills,
      categoryId: (scenario as any).categoryId ? String((scenario as any).categoryId) : '', // 기존 시나리오의 카테고리 ID 로드
      evaluationCriteriaSetId: (scenario as any).evaluationCriteriaSetId || '', // 기존 시나리오의 평가 기준 세트 ID 로드
      image: scenario.image || '', // 기존 시나리오의 이미지 URL 로드
      imagePrompt: (scenario as any).imagePrompt || '', // 기존 시나리오의 이미지 프롬프트 로드
      introVideoUrl: (scenario as any).introVideoUrl || '', // 기존 시나리오의 인트로 비디오 URL 로드
      videoPrompt: (scenario as any).videoPrompt || '', // 기존 시나리오의 비디오 프롬프트 로드
      objectiveType: (scenario as any).objectiveType || '', // 기존 시나리오의 목표 유형 로드
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
    
    // 필수 필드 검증
    if (!formData.title) {
      toast({
        title: "제목 필수",
        description: "시나리오 제목을 입력하세요.",
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.categoryId) {
      toast({
        title: "카테고리 필수",
        description: "카테고리를 선택하세요.",
        variant: "destructive",
      });
      return;
    }
    
    if (editingScenario) {
      updateMutation.mutate({ id: editingScenario.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleGenerateImage = async () => {
    if (!formData.title) {
      toast({
        title: "시나리오 제목 필요",
        description: "이미지를 생성하려면 시나리오 제목을 먼저 입력하세요.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingImage(true);
    try {
      const response = await apiRequest('POST', '/api/image/generate-scenario-image', {
        scenarioTitle: formData.title,
        description: formData.description,
        customPrompt: formData.imagePrompt || undefined,
      });
      
      const data = await response.json();
      
      if (data.success && data.imageUrl) {
        setFormData(prev => ({ ...prev, image: data.imageUrl }));
        toast({
          title: "이미지 생성 완료",
          description: "시나리오 이미지가 성공적으로 생성되었습니다.",
        });
      } else {
        throw new Error(data.error || '이미지 생성 실패');
      }
    } catch (error: any) {
      console.error('이미지 생성 오류:', error);
      toast({
        title: "이미지 생성 실패",
        description: error.message || "이미지 생성 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!editingScenario?.id) {
      toast({
        title: "시나리오 저장 필요",
        description: "비디오를 생성하려면 시나리오를 먼저 저장하세요.",
        variant: "destructive",
      });
      return;
    }

    if (!formData.title) {
      toast({
        title: "시나리오 제목 필요",
        description: "비디오를 생성하려면 시나리오 제목을 먼저 입력하세요.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingVideo(true);
    try {
      const response = await apiRequest('POST', `/api/admin/scenarios/${editingScenario.id}/generate-intro-video`, {
        customPrompt: formData.videoPrompt || undefined,
      });
      
      const data = await response.json();
      
      if (data.success && data.videoUrl) {
        setFormData(prev => ({ ...prev, introVideoUrl: data.videoUrl }));
        toast({
          title: "비디오 생성 완료",
          description: "인트로 비디오가 성공적으로 생성되었습니다.",
        });
        // 시나리오 목록 갱신
        queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      } else {
        throw new Error(data.error || '비디오 생성 실패');
      }
    } catch (error: any) {
      console.error('비디오 생성 오류:', error);
      toast({
        title: "비디오 생성 실패",
        description: error.message || "비디오 생성 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handleDeleteVideo = async () => {
    if (!editingScenario?.id) {
      return;
    }

    try {
      const response = await apiRequest('DELETE', `/api/admin/scenarios/${editingScenario.id}/intro-video`);
      const data = await response.json();
      
      if (data.success) {
        setFormData(prev => ({ ...prev, introVideoUrl: '' }));
        toast({
          title: "비디오 삭제 완료",
          description: "인트로 비디오가 삭제되었습니다.",
        });
        queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      } else {
        throw new Error(data.error || '비디오 삭제 실패');
      }
    } catch (error: any) {
      console.error('비디오 삭제 오류:', error);
      toast({
        title: "비디오 삭제 실패",
        description: error.message || "비디오 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
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
        
        <div className="flex items-center gap-2">
          <AIScenarioGenerator onGenerated={handleAIGenerated} />
          <Button 
            className="bg-corporate-600 hover:bg-corporate-700"
            onClick={() => {
              resetForm();
              setEditingScenario(null);
              setIsCreateOpen(true);
            }}
            data-testid="button-create-scenario"
          >
            <i className="fas fa-plus mr-2"></i>
            직접 생성
          </Button>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-50">
              <DialogHeader className="bg-white px-6 py-4 -mx-6 -mt-6 border-b border-slate-200">
                <DialogTitle className="text-xl text-slate-900">
                  {editingScenario ? (editingScenario.title || '시나리오 편집') : '새 시나리오 생성'}
                </DialogTitle>
              </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-6 pt-6">
              {/* 기본 정보 */}
              <div className="space-y-4 bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900 pb-3 border-b border-slate-200">기본 정보</h3>
                
                {/* 시나리오 이미지 - 최상단으로 이동 */}
                <div className="space-y-3">
                  <Label htmlFor="image" className="text-sm font-medium text-slate-700">시나리오 이미지 URL (선택사항)</Label>
                  <Input
                    id="image"
                    value={formData.image || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, image: e.target.value }))}
                    placeholder="이미지 URL을 입력하세요 (예: https://example.com/image.jpg)"
                    data-testid="input-scenario-image"
                    className="bg-white"
                  />
                  
                  {/* 이미지 프롬프트 입력 */}
                  <div className="space-y-2">
                    <Label htmlFor="imagePrompt" className="text-sm font-medium text-slate-700">이미지 생성 프롬프트 (선택사항)</Label>
                    <Textarea
                      id="imagePrompt"
                      value={formData.imagePrompt || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, imagePrompt: e.target.value }))}
                      placeholder="커스텀 이미지 프롬프트를 입력하세요. 비워두면 자동으로 생성됩니다."
                      className="min-h-[80px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-image-prompt"
                    />
                    <p className="text-xs text-slate-500">
                      예: "Modern corporate office with team meeting, professional photography, natural lighting"
                    </p>
                  </div>
                  
                  {/* 이미지 생성 버튼 */}
                  <Button
                    type="button"
                    onClick={handleGenerateImage}
                    disabled={isGeneratingImage || !formData.title}
                    className="w-full"
                    data-testid="button-generate-image"
                  >
                    {isGeneratingImage ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        이미지 생성 중...
                      </>
                    ) : (
                      '🎨 AI 이미지 생성하기'
                    )}
                  </Button>
                  
                  {/* 이미지 미리보기 */}
                  {formData.image && (
                    <div className="mt-3">
                      <p className="text-sm text-slate-600 mb-2">이미지 미리보기 (클릭하면 전체보기):</p>
                      <div 
                        className="relative w-full h-48 bg-slate-100 rounded-lg overflow-hidden border cursor-pointer hover:shadow-lg transition-shadow"
                        onClick={() => setImagePreviewUrl(formData.image || null)}
                        data-testid="image-preview-container"
                      >
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
                
                {/* 인트로 비디오 생성 섹션 */}
                <div className="space-y-3 mt-6 pt-6 border-t border-slate-200">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-slate-700">대화 인트로 비디오 (선택사항)</Label>
                    {formData.introVideoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleDeleteVideo}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        data-testid="button-delete-video"
                      >
                        <i className="fas fa-trash mr-1"></i>
                        비디오 삭제
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    대화 시작 시 재생될 8초 인트로 비디오를 AI로 생성합니다. 시나리오를 먼저 저장한 후 생성할 수 있습니다.
                  </p>
                  
                  {/* 비디오 URL 직접 입력 */}
                  <Input
                    id="introVideoUrl"
                    value={formData.introVideoUrl || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, introVideoUrl: e.target.value }))}
                    placeholder="비디오 URL을 입력하세요 (예: /scenarios/videos/intro.mp4)"
                    data-testid="input-intro-video-url"
                    className="bg-white"
                  />
                  
                  {/* 비디오 프롬프트 입력 */}
                  <div className="space-y-2">
                    <Label htmlFor="videoPrompt" className="text-sm font-medium text-slate-700">비디오 생성 프롬프트 (선택사항)</Label>
                    <Textarea
                      id="videoPrompt"
                      value={formData.videoPrompt || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, videoPrompt: e.target.value }))}
                      placeholder="커스텀 비디오 프롬프트를 입력하세요. 비워두면 시나리오 상황에 맞게 자동 생성됩니다."
                      className="min-h-[80px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-video-prompt"
                    />
                    <p className="text-xs text-slate-500">
                      예: "Modern tech office, employees discussing urgently around monitors showing security alerts, tense atmosphere"
                    </p>
                  </div>
                  
                  {/* 비디오 생성 버튼 */}
                  <Button
                    type="button"
                    onClick={handleGenerateVideo}
                    disabled={isGeneratingVideo || !editingScenario?.id}
                    className="w-full"
                    variant={editingScenario?.id ? "default" : "secondary"}
                    data-testid="button-generate-video"
                  >
                    {isGeneratingVideo ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        비디오 생성 중... (약 1-3분 소요)
                      </>
                    ) : editingScenario?.id ? (
                      '🎬 AI 인트로 비디오 생성하기'
                    ) : (
                      '시나리오 저장 후 비디오 생성 가능'
                    )}
                  </Button>
                  
                  {/* 비디오 미리보기 */}
                  {formData.introVideoUrl && (
                    <div className="mt-3">
                      <p className="text-sm text-slate-600 mb-2">비디오 미리보기 (클릭하면 전체보기):</p>
                      <div 
                        className="relative w-full bg-slate-900 rounded-lg overflow-hidden border cursor-pointer hover:shadow-lg transition-shadow"
                        onClick={() => setVideoPreviewUrl(formData.introVideoUrl || null)}
                        data-testid="video-preview-container"
                      >
                        <video
                          src={formData.introVideoUrl}
                          controls
                          className="w-full max-h-64 object-contain"
                          preload="metadata"
                          onError={(e) => {
                            const target = e.target as HTMLVideoElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              parent.innerHTML = '<div class="flex items-center justify-center h-32 text-slate-400 text-sm"><i class="fas fa-exclamation-triangle mr-2"></i>비디오를 불러올 수 없습니다</div>';
                            }
                          }}
                          data-testid="scenario-video-preview"
                        />
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="title" className="text-sm font-medium text-slate-700">시나리오 제목</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="시나리오 제목을 입력하세요"
                      required
                      data-testid="input-scenario-title"
                      className="bg-white"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="category" className="text-sm font-medium text-slate-700">
                      카테고리 <span className="text-red-500">*</span>
                    </Label>
                    <Select 
                      value={formData.categoryId || ''} 
                      onValueChange={(val) => setFormData(prev => ({ ...prev, categoryId: val }))}
                    >
                      <SelectTrigger 
                        className={`bg-white ${!formData.categoryId ? 'border-red-300' : ''}`}
                        data-testid="select-category"
                      >
                        <SelectValue placeholder="카테고리 선택 (필수)" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories?.map(cat => (
                          <SelectItem key={cat.id} value={String(cat.id)} data-testid={`category-option-${cat.id}`}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!formData.categoryId && (
                      <p className="text-xs text-red-500 mt-1">카테고리를 선택하세요.</p>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="estimatedTime" className="text-sm font-medium text-slate-700">예상 소요 시간</Label>
                    <Input
                      id="estimatedTime"
                      value={formData.estimatedTime}
                      onChange={(e) => setFormData(prev => ({ ...prev, estimatedTime: e.target.value }))}
                      placeholder="예: 30-45분"
                      required
                      data-testid="input-estimated-time"
                      className="bg-white"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="description" className="text-sm font-medium text-slate-700">시나리오 설명</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="시나리오에 대한 자세한 설명을 입력하세요"
                    className="min-h-[100px] bg-white whitespace-pre-wrap"
                    required
                    data-testid="textarea-scenario-description"
                  />
                </div>

                {/* 평가 기준 선택 */}
                <div>
                  <Label htmlFor="evaluationCriteria" className="text-sm font-medium text-slate-700">
                    평가 기준 (선택)
                  </Label>
                  <Select 
                    value={formData.evaluationCriteriaSetId || 'default'} 
                    onValueChange={(val) => setFormData(prev => ({ ...prev, evaluationCriteriaSetId: val === 'default' ? '' : val }))}
                  >
                    <SelectTrigger 
                      className="bg-white"
                      data-testid="select-evaluation-criteria"
                    >
                      <SelectValue placeholder="기본 평가 기준 사용" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">기본 평가 기준 사용</SelectItem>
                      {evaluationCriteriaSets?.map(criteria => (
                        <SelectItem key={criteria.id} value={criteria.id} data-testid={`criteria-option-${criteria.id}`}>
                          {criteria.name} {criteria.isDefault && '(기본값)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 mt-1">
                    특정 평가 기준을 선택하지 않으면 기본 평가 기준이 적용됩니다.
                  </p>
                </div>
              </div>

              {/* 상황 설정 */}
              <div className="space-y-4 bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900 pb-3 border-b border-slate-200">상황 설정</h3>
                
                <div>
                  <Label htmlFor="situation" className="text-sm font-medium text-slate-700">상황 설명</Label>
                  <Textarea
                    id="situation"
                    value={formData.context.situation}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      context: { ...prev.context, situation: e.target.value }
                    }))}
                    placeholder="현재 상황을 자세히 설명하세요"
                    className="min-h-[80px] bg-white whitespace-pre-wrap"
                    data-testid="textarea-situation"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="timeline" className="text-sm font-medium text-slate-700">시간 제약</Label>
                    <Input
                      id="timeline"
                      value={formData.context.timeline}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { ...prev.context, timeline: e.target.value }
                      }))}
                      placeholder="예: 마케팅 발표까지 1주일 남음"
                      data-testid="input-timeline"
                      className="bg-white"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="stakes" className="text-sm font-medium text-slate-700">이해관계</Label>
                    <Input
                      id="stakes"
                      value={formData.context.stakes}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { ...prev.context, stakes: e.target.value }
                      }))}
                      placeholder="예: 품질 vs 일정 vs 고객 만족도"
                      data-testid="input-stakes"
                      className="bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="position" className="text-sm font-medium text-slate-700">플레이어 직급</Label>
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
                      className="bg-white"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="playerDepartment" className="text-sm font-medium text-slate-700">플레이어 부서</Label>
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
                      className="bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="playerExperience" className="text-sm font-medium text-slate-700">플레이어 경력</Label>
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
                      className="bg-white"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="responsibility" className="text-sm font-medium text-slate-700">책임 사항</Label>
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
                      className="bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* 목표 및 성공 기준 */}
              <div className="space-y-4 bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900 pb-3 border-b border-slate-200">목표 및 성공 기준</h3>
                
                <div>
                  <Label htmlFor="objectiveType" className="text-sm font-medium text-slate-700">목표 유형</Label>
                  <Select 
                    value={formData.objectiveType || ''} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, objectiveType: value }))}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="목표 유형 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="역할책임명확화">역할 및 책임 명확화</SelectItem>
                      <SelectItem value="우선순위협의">우선순위 협의 및 합의</SelectItem>
                      <SelectItem value="공정평가기준수립">공정한 평가 기준 수립</SelectItem>
                      <SelectItem value="세대간이해증진">세대 간 상호 이해 증진</SelectItem>
                      <SelectItem value="효과적소통정보공유">효과적 소통 및 정보 공유</SelectItem>
                      <SelectItem value="의사결정표준화">의사결정 프로세스 표준화</SelectItem>
                      <SelectItem value="리더십스타일조정">리더십 스타일 조정</SelectItem>
                      <SelectItem value="공로분배팀워크">공로 분배 및 팀워크 강화</SelectItem>
                      <SelectItem value="정보투명성공유">정보 투명성 및 공유</SelectItem>
                      <SelectItem value="책임소재명확화">책임 소재 명확화</SelectItem>
                      <SelectItem value="업무프로세스조정">업무 프로세스 조정</SelectItem>
                      <SelectItem value="목표정렬">목표 정렬 및 방향성 통일</SelectItem>
                      <SelectItem value="전문성존중학습">전문성 존중 및 학습</SelectItem>
                      <SelectItem value="업무경계협력">업무 경계 설정 및 협력</SelectItem>
                      <SelectItem value="공정한조직문화">공정한 조직 문화 조성</SelectItem>
                      <SelectItem value="신뢰회복감정해소">신뢰 회복 및 감정 해소</SelectItem>
                      <SelectItem value="기여도인정동기부여">기여도 인정 및 동기 부여</SelectItem>
                      <SelectItem value="신뢰관계재구축">신뢰 관계 재구축</SelectItem>
                      <SelectItem value="리소스배분협의">리소스 배분 협의 및 최적화</SelectItem>
                      <SelectItem value="다양성포용성증진">다양성 이해 및 포용성 증진</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="objectives" className="text-sm font-medium text-slate-700">목표 (줄바꿈으로 구분)</Label>
                  <Textarea
                    id="objectives"
                    value={formData.objectives.join('\n')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      objectives: e.target.value.split('\n').filter(obj => obj.trim())
                    }))}
                    placeholder="각 부서의 이해관계와 우려사항 파악&#10;부서 간 갈등을 중재하고 합의점 도출&#10;품질과 일정을 균형있게 고려한 현실적 해결책 제시"
                    className="min-h-[100px] bg-white whitespace-pre-wrap"
                    data-testid="textarea-objectives"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="optimal" className="text-sm font-medium text-slate-700">최적 결과</Label>
                    <Textarea
                      id="optimal"
                      value={formData.successCriteria.optimal}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, optimal: e.target.value }
                      }))}
                      placeholder="모든 부서가 만족하는 타협안 도출"
                      className="min-h-[60px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-optimal"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="good" className="text-sm font-medium text-slate-700">우수 결과</Label>
                    <Textarea
                      id="good"
                      value={formData.successCriteria.good}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, good: e.target.value }
                      }))}
                      placeholder="주요 이해관계자들의 핵심 요구사항 반영"
                      className="min-h-[60px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-good"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="acceptable" className="text-sm font-medium text-slate-700">수용 가능 결과</Label>
                    <Textarea
                      id="acceptable"
                      value={formData.successCriteria.acceptable}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, acceptable: e.target.value }
                      }))}
                      placeholder="최소한의 품질 기준을 유지하면서 일정 준수"
                      className="min-h-[60px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-acceptable"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="failure" className="text-sm font-medium text-slate-700">실패 기준</Label>
                    <Textarea
                      id="failure"
                      value={formData.successCriteria.failure}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, failure: e.target.value }
                      }))}
                      placeholder="부서 간 갈등 심화 또는 비현실적 해결책 제시"
                      className="min-h-[60px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-failure"
                    />
                  </div>
                </div>
              </div>

              {/* 역량 및 페르소나 */}
              <div className="space-y-4 bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900 pb-3 border-b border-slate-200">역량 및 페르소나</h3>
                
                <div>
                  <Label htmlFor="skills" className="text-sm font-medium text-slate-700">주요 역량 (쉼표로 구분)</Label>
                  <Input
                    id="skills"
                    value={formData.skills.join(', ')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      skills: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                    }))}
                    placeholder="갈등 중재, 이해관계자 관리, 문제 해결, 협상"
                    data-testid="input-skills"
                    className="bg-white"
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
                    <Label className="text-sm font-medium text-slate-700">페르소나 관리</Label>
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
                      <div key={index} className="border border-slate-300 rounded-lg p-4 space-y-3 bg-white shadow-sm">
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
                            <Label htmlFor={`persona-id-${index}`} className="text-sm font-medium text-slate-700">페르소나 ID *</Label>
                            <Select
                              value={persona.id}
                              onValueChange={(selectedId) => {
                                const selectedPersona = availablePersonas.find(p => p.id === selectedId);
                                if (selectedPersona) {
                                  const newPersonas = [...formData.personas];
                                  newPersonas[index] = { 
                                    ...persona, 
                                    id: selectedId,
                                    mbti: selectedPersona.mbti.toUpperCase(),
                                    personaRef: selectedId + '.json' 
                                  };
                                  setFormData(prev => ({ ...prev, personas: newPersonas }));
                                }
                              }}
                            >
                              <SelectTrigger data-testid={`select-persona-id-${index}`} className="bg-white">
                                <SelectValue placeholder="페르소나 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                {getAvailablePersonasForSlot(index).length === 0 ? (
                                  <div className="py-2 px-3 text-sm text-slate-500">
                                    선택 가능한 페르소나가 없습니다
                                  </div>
                                ) : (
                                  getAvailablePersonasForSlot(index).map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{p.mbti}</span>
                                        <span className="text-xs text-slate-500">({p.id})</span>
                                      </div>
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-name-${index}`} className="text-sm font-medium text-slate-700">이름 *</Label>
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
                              className="bg-white"
                            />
                          </div>

                          <div>
                            <Label htmlFor={`persona-gender-${index}`} className="text-sm font-medium text-slate-700">성별 *</Label>
                            <Select
                              value={persona.gender}
                              onValueChange={(value: 'male' | 'female') => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, gender: value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                            >
                              <SelectTrigger data-testid={`select-persona-gender-${index}`} className="bg-white">
                                <SelectValue placeholder="성별 선택" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="male">남성</SelectItem>
                                <SelectItem value="female">여성</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-department-${index}`} className="text-sm font-medium text-slate-700">부서 *</Label>
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
                              className="bg-white"
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-position-${index}`} className="text-sm font-medium text-slate-700">직책 *</Label>
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
                              className="bg-white"
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-experience-${index}`} className="text-sm font-medium text-slate-700">경력</Label>
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
                              className="bg-white"
                            />
                          </div>
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-stance-${index}`} className="text-sm font-medium text-slate-700">입장/태도 *</Label>
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
                            className="bg-white whitespace-pre-wrap"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-goal-${index}`} className="text-sm font-medium text-slate-700">목표 *</Label>
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
                            className="bg-white whitespace-pre-wrap"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-tradeoff-${index}`} className="text-sm font-medium text-slate-700">양보 조건</Label>
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
                            className="bg-white whitespace-pre-wrap"
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
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        {scenarios?.map((scenario) => {
          const isExpanded = expandedScenarios.has(scenario.id);
          const toggleExpand = () => {
            setExpandedScenarios(prev => {
              const next = new Set(prev);
              if (next.has(scenario.id)) {
                next.delete(scenario.id);
              } else {
                next.add(scenario.id);
              }
              return next;
            });
          };
          
          return (
            <Card 
              key={scenario.id} 
              className="group relative overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-white to-slate-50"
            >
              <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-corporate-500 to-corporate-600" />
              
              <CardHeader className="pb-3 pl-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-semibold text-slate-800 line-clamp-2 leading-tight mb-2">
                      {scenario.title}
                    </CardTitle>
                    <div className="flex items-center flex-wrap gap-3 text-sm text-slate-500">
                      {categories && (scenario as any).categoryId && (
                        <Badge variant="outline" className="text-xs bg-slate-50 text-slate-700 border-slate-200">
                          {categories.find(c => String(c.id) === String((scenario as any).categoryId))?.name || '미분류'}
                        </Badge>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{scenario.estimatedTime}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        <span>{(scenario.personas || []).length}명</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5" />
                        <span>{(scenario.skills || []).length}개 역량</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-8 h-8 p-0 hover:bg-slate-100"
                          data-testid={`button-scenario-menu-${scenario.id}`}
                        >
                          <MoreVertical className="h-4 w-4 text-slate-500" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleEdit(scenario)}
                          data-testid={`button-edit-scenario-${scenario.id}`}
                        >
                          <i className="fas fa-edit mr-2 w-4 h-4 text-center"></i>
                          수정
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setTranslatingScenario(scenario)}
                          data-testid={`button-translate-scenario-${scenario.id}`}
                        >
                          <Languages className="mr-2 w-4 h-4" />
                          번역 관리
                        </DropdownMenuItem>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              data-testid={`button-delete-scenario-${scenario.id}`}
                              className="text-red-600 focus:text-red-600 focus:bg-red-50"
                            >
                              <i className="fas fa-trash mr-2 w-4 h-4 text-center"></i>
                              삭제
                            </DropdownMenuItem>
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>
              
              <div 
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <CardContent className="pt-0 pl-5 pb-4 space-y-4">
                  <div className="border-t border-slate-100 pt-4">
                    <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
                      {scenario.description}
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">주요 역량</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(scenario.skills || []).map((skill, index) => (
                        <Badge 
                          key={index} 
                          variant="secondary" 
                          className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border-0"
                        >
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">페르소나</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(scenario.personas || []).map((persona, index) => {
                        if (typeof persona === 'string') {
                          return (
                            <Badge 
                              key={index} 
                              variant="outline" 
                              className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                            >
                              {persona}
                            </Badge>
                          );
                        }
                        const p = persona as any;
                        const department = p.department || '';
                        const name = p.name || p.id || '알 수 없는 페르소나';
                        const mbti = p.mbti ? `(${p.mbti})` : '';
                        const displayText = [department, name, mbti].filter(Boolean).join(' ');
                        return (
                          <Badge 
                            key={index} 
                            variant="outline" 
                            className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                          >
                            {displayText}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>
          );
        })}
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

      {/* 이미지 전체보기 모달 */}
      <Dialog open={!!imagePreviewUrl} onOpenChange={(open) => !open && setImagePreviewUrl(null)}>
        <DialogContent className="max-w-4xl w-full" data-testid="image-preview-modal">
          <DialogHeader>
            <DialogTitle>이미지 전체보기</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-slate-100 rounded-lg overflow-hidden max-h-[70vh]">
            <img
              src={imagePreviewUrl || ''}
              alt="전체보기"
              className="max-w-full max-h-[70vh] object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 비디오 전체보기 모달 */}
      <Dialog open={!!videoPreviewUrl} onOpenChange={(open) => !open && setVideoPreviewUrl(null)}>
        <DialogContent className="max-w-4xl w-full" data-testid="video-preview-modal">
          <DialogHeader>
            <DialogTitle>비디오 전체보기</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-slate-900 rounded-lg overflow-hidden max-h-[70vh]">
            <video
              src={videoPreviewUrl || ''}
              controls
              className="max-w-full max-h-[70vh] object-contain"
              autoPlay
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 번역 관리 모달 */}
      <Dialog open={!!translatingScenario} onOpenChange={(open) => !open && setTranslatingScenario(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="translation-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Languages className="h-5 w-5" />
              번역 관리 - {translatingScenario?.title}
            </DialogTitle>
          </DialogHeader>
          {translatingScenario && (
            <ScenarioTranslationEditor
              scenarioId={String(translatingScenario.id)}
              scenarioTitle={translatingScenario.title}
              scenarioDescription={translatingScenario.description}
              scenarioContext={{
                situation: translatingScenario.context?.situation || '',
                timeline: translatingScenario.context?.timeline || '',
                stakes: translatingScenario.context?.stakes || '',
                playerRole: typeof translatingScenario.context?.playerRole === 'object' 
                  ? [
                      (translatingScenario.context.playerRole as any)?.position,
                      (translatingScenario.context.playerRole as any)?.department,
                      (translatingScenario.context.playerRole as any)?.experience,
                      (translatingScenario.context.playerRole as any)?.responsibility
                    ].filter(Boolean).join(' / ')
                  : (translatingScenario.context?.playerRole || ''),
              }}
              scenarioObjectives={translatingScenario.objectives || []}
              scenarioSuccessCriteria={{
                optimal: translatingScenario.successCriteria?.optimal || '',
                good: translatingScenario.successCriteria?.good || '',
                acceptable: translatingScenario.successCriteria?.acceptable || '',
                failure: translatingScenario.successCriteria?.failure || '',
              }}
              scenarioSkills={translatingScenario.skills || []}
              scenarioPersonas={(translatingScenario.personas || []).map((p: any) => ({
                id: p.id || p.personaRef || '',
                name: p.name || '',
                position: p.position || '',
                department: p.department || '',
                role: p.role || '',
                stance: p.stance || '',
                goal: p.goal || '',
                tradeoff: p.tradeoff || '',
              }))}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}