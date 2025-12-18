import React, { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { MoreVertical, RefreshCw } from 'lucide-react';

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
  images: {
    base: string;  // 기본 프로필 이미지
    style: string;  // 이미지 스타일 설명
    male?: {
      expressions: {
        중립: string;
        기쁨: string;
        슬픔: string;
        분노: string;
        놀람: string;
        호기심: string;
        불안: string;
        단호: string;
        실망: string;
        당혹: string;
      };
    };
    female?: {
      expressions: {
        중립: string;
        기쁨: string;
        슬픔: string;
        분노: string;
        놀람: string;
        호기심: string;
        불안: string;
        단호: string;
        실망: string;
        당혹: string;
      };
    };
    expressions?: {
      중립: string;
      기쁨: string;
      슬픔: string;
      분노: string;
      놀람: string;
      호기심: string;
      불안: string;
      단호: string;
      실망: string;
      당혹: string;
    };
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
  images: {
    base: string;  // 기본 프로필 이미지
    style: string;  // 이미지 스타일 설명
    male?: {
      expressions: {
        중립: string;
        기쁨: string;
        슬픔: string;
        분노: string;
        놀람: string;
        호기심: string;
        불안: string;
        단호: string;
        실망: string;
        당혹: string;
      };
    };
    female?: {
      expressions: {
        중립: string;
        기쁨: string;
        슬픔: string;
        분노: string;
        놀람: string;
        호기심: string;
        불안: string;
        단호: string;
        실망: string;
        당혹: string;
      };
    };
    expressions?: {
      중립: string;
      기쁨: string;
      슬픔: string;
      분노: string;
      놀람: string;
      호기심: string;
      불안: string;
      단호: string;
      실망: string;
      당혹: string;
    };
  };
}

export function PersonaManager() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<MBTIPersona | null>(null);
  const [deletingPersona, setDeletingPersona] = useState<MBTIPersona | null>(null);
  
  // 이미지 생성 상태
  const [isGeneratingBase, setIsGeneratingBase] = useState(false);
  const [isGeneratingExpressions, setIsGeneratingExpressions] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const autoSavingRef = useRef(false);
  
  // 이미지 원본 보기 모달
  const [viewingImage, setViewingImage] = useState<{ url: string; emotion: string } | null>(null);
  
  // 기본 이미지 재생성 확인 다이얼로그
  const [showBaseImageConfirm, setShowBaseImageConfirm] = useState(false);
  
  // 개별 표정 이미지 생성 상태
  const [generatingSingleEmotion, setGeneratingSingleEmotion] = useState<string | null>(null);
  
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
    images: {
      base: '',
      style: '',
      expressions: {
        중립: '',
        기쁨: '',
        슬픔: '',
        분노: '',
        놀람: '',
        호기심: '',
        불안: '',
        단호: '',
        실망: '',
        당혹: ''
      }
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
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch('/api/scenarios', { credentials: 'include', headers }).then(res => res.json());
    }
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
      
      // 이미지 자동 저장인 경우 다이얼로그 유지, 수동 저장인 경우만 닫기
      if (!autoSavingRef.current) {
        setEditingPersona(null);
        resetForm();
        toast({
          title: "성공",
          description: "MBTI 페르소나가 수정되었습니다."
        });
      } else {
        autoSavingRef.current = false;
      }
    },
    onError: () => {
      toast({
        title: "오류",
        description: "페르소나 수정에 실패했습니다.",
        variant: "destructive"
      });
      autoSavingRef.current = false;
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

  // 기본 이미지 생성 함수 (실제 생성)
  const generateBaseImage = async () => {
    setIsGeneratingBase(true);
    try {
      const response = await apiRequest("POST", "/api/image/generate-persona-base", {
        personaId: formData.id,
        mbti: formData.mbti,
        gender: formData.gender,
        personalityTraits: formData.personality_traits,
        imageStyle: formData.images.style
      });

      const result = await response.json();
      
      if (result.success) {
        // 타임스탬프를 추가하여 브라우저 캐시 우회
        const timestamp = Date.now();
        const imageUrlWithTimestamp = `${result.imageUrl}?t=${timestamp}`;
        const currentGender = formData.gender;
        
        // formData 업데이트 (편집 모드 유지, 즉시 화면 반영) - 성별별로 저장
        const updatedFormData = { ...formData };
        const updatedImages = { ...updatedFormData.images };
        const maleExpressions = { ...((updatedImages.male?.expressions as Record<string, string>) || {}) };
        const femaleExpressions = { ...((updatedImages.female?.expressions as Record<string, string>) || {}) };
        
        if (currentGender === 'male') {
          maleExpressions['중립'] = imageUrlWithTimestamp;
          updatedImages.male = { expressions: maleExpressions as any };
        } else {
          femaleExpressions['중립'] = imageUrlWithTimestamp;
          updatedImages.female = { expressions: femaleExpressions as any };
        }
        // base 필드도 함께 업데이트 (성별 폴더 포함)
        updatedImages.base = imageUrlWithTimestamp;
        updatedFormData.images = updatedImages as any;
        setFormData(updatedFormData);

        // 자동 저장
        toast({
          title: "저장 중",
          description: "기본 이미지가 생성되었습니다. 자동으로 저장 중입니다..."
        });
        
        autoSavingRef.current = true;
        updateMutation.mutate(updatedFormData);
      }
    } catch (error: any) {
      toast({
        title: "오류",
        description: error.message || "기본 이미지 생성에 실패했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingBase(false);
    }
  };

  // 기본 이미지 생성 핸들러 (확인 로직 포함)
  const handleGenerateBaseImage = () => {
    if (!formData.id || !formData.mbti || !formData.gender) {
      toast({
        title: "오류",
        description: "페르소나 ID, MBTI, 성별이 필요합니다. 먼저 페르소나를 저장해주세요.",
        variant: "destructive"
      });
      return;
    }

    // 현재 성별의 기본 이미지(중립)가 있는지 확인
    const currentGender = formData.gender;
    const genderImages = currentGender === 'male' 
      ? formData.images?.male?.expressions?.['중립']
      : formData.images?.female?.expressions?.['중립'];
    
    if (genderImages) {
      setShowBaseImageConfirm(true);
    } else {
      // 기존 이미지가 없으면 바로 생성
      generateBaseImage();
    }
  };

  // 전체 표정 이미지 생성 핸들러
  const handleGenerateExpressions = async () => {
    if (!formData.id || !formData.mbti || !formData.gender) {
      toast({
        title: "오류",
        description: "페르소나 ID, MBTI, 성별이 필요합니다. 먼저 페르소나를 저장해주세요.",
        variant: "destructive"
      });
      return;
    }

    setIsGeneratingExpressions(true);
    setGenerationProgress({ current: 0, total: 9 });
    
    try {
      const response = await apiRequest("POST", "/api/image/generate-persona-expressions", {
        personaId: formData.id,
        mbti: formData.mbti,
        gender: formData.gender,
        personalityTraits: formData.personality_traits,
        imageStyle: formData.images.style
      });

      const result = await response.json();
      
      if (result.success) {
        // 타임스탬프를 추가하여 브라우저 캐시 우회
        const timestamp = Date.now();
        const currentGender = formData.gender;
        
        const updatedFormData = { ...formData };
        const updatedImages = { ...updatedFormData.images };
        const newExpressions: any = {};
        
        result.images.forEach((img: any) => {
          if (img.success && img.emotionKorean) {
            newExpressions[img.emotionKorean] = `${img.imageUrl}?t=${timestamp}`;
          }
        });

        const maleExpressions = { ...((updatedImages.male?.expressions as Record<string, string>) || {}) };
        const femaleExpressions = { ...((updatedImages.female?.expressions as Record<string, string>) || {}) };

        if (currentGender === 'male') {
          Object.assign(maleExpressions, newExpressions);
          updatedImages.male = { expressions: maleExpressions as any };
        } else {
          Object.assign(femaleExpressions, newExpressions);
          updatedImages.female = { expressions: femaleExpressions as any };
        }

        updatedFormData.images = updatedImages as any;
        setFormData(updatedFormData);

        // 자동 저장
        toast({
          title: "저장 중",
          description: `${result.totalGenerated}개의 표정 이미지가 생성되었습니다. 자동으로 저장 중입니다...`
        });
        
        autoSavingRef.current = true;
        updateMutation.mutate(updatedFormData);
      }
    } catch (error: any) {
      toast({
        title: "오류",
        description: error.message || "표정 이미지 생성에 실패했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingExpressions(false);
      setGenerationProgress({ current: 0, total: 0 });
    }
  };

  // 개별 표정 이미지 재생성 핸들러
  const handleGenerateSingleExpression = async (emotion: string) => {
    if (!formData.id || !formData.mbti || !formData.gender) {
      toast({
        title: "오류",
        description: "페르소나 ID, MBTI, 성별이 필요합니다.",
        variant: "destructive"
      });
      return;
    }

    setGeneratingSingleEmotion(emotion);
    
    try {
      const response = await apiRequest("POST", "/api/image/generate-persona-single-expression", {
        personaId: formData.id,
        mbti: formData.mbti,
        gender: formData.gender,
        personalityTraits: formData.personality_traits,
        imageStyle: formData.images.style,
        emotion
      });

      const result = await response.json();
      
      if (result.success) {
        const timestamp = Date.now();
        const imageUrlWithTimestamp = `${result.imageUrl}?t=${timestamp}`;
        const currentGender = formData.gender;
        
        const updatedFormData = { ...formData };
        const updatedImages = { ...updatedFormData.images };
        
        if (currentGender === 'male') {
          const maleExpressions = { ...((updatedImages.male?.expressions as Record<string, string>) || {}) };
          maleExpressions[emotion] = imageUrlWithTimestamp;
          updatedImages.male = { expressions: maleExpressions as any };
        } else {
          const femaleExpressions = { ...((updatedImages.female?.expressions as Record<string, string>) || {}) };
          femaleExpressions[emotion] = imageUrlWithTimestamp;
          updatedImages.female = { expressions: femaleExpressions as any };
        }
        
        if (emotion === '중립') {
          updatedImages.base = imageUrlWithTimestamp;
        }
        
        updatedFormData.images = updatedImages as any;
        setFormData(updatedFormData);

        toast({
          title: "저장 중",
          description: `${emotion} 표정 이미지가 생성되었습니다. 자동으로 저장 중입니다...`
        });
        
        autoSavingRef.current = true;
        updateMutation.mutate(updatedFormData);
      }
    } catch (error: any) {
      toast({
        title: "오류",
        description: error.message || `${emotion} 표정 이미지 생성에 실패했습니다.`,
        variant: "destructive"
      });
    } finally {
      setGeneratingSingleEmotion(null);
    }
  };

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
      images: {
        base: '',
        style: '',
        male: { expressions: { 중립: '', 기쁨: '', 슬픔: '', 분노: '', 놀람: '', 호기심: '', 불안: '', 단호: '', 실망: '', 당혹: '' } },
        female: { expressions: { 중립: '', 기쁨: '', 슬픔: '', 분노: '', 놀람: '', 호기심: '', 불안: '', 단호: '', 실망: '', 당혹: '' } }
      }
    });
  };

  const handleEdit = (persona: MBTIPersona) => {
    setFormData({
      id: persona.id,
      mbti: persona.mbti,
      gender: persona.gender || 'male',
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
      images: {
        base: persona.gender === 'male'
          ? (persona.images?.male?.expressions?.중립 || persona.images?.base || '')
          : (persona.images?.female?.expressions?.중립 || persona.images?.base || ''),
        style: persona.images?.style || '',
        male: {
          expressions: {
            중립: persona.images?.male?.expressions?.중립 || '',
            기쁨: persona.images?.male?.expressions?.기쁨 || '',
            슬픔: persona.images?.male?.expressions?.슬픔 || '',
            분노: persona.images?.male?.expressions?.분노 || '',
            놀람: persona.images?.male?.expressions?.놀람 || '',
            호기심: persona.images?.male?.expressions?.호기심 || '',
            불안: persona.images?.male?.expressions?.불안 || '',
            단호: persona.images?.male?.expressions?.단호 || '',
            실망: persona.images?.male?.expressions?.실망 || '',
            당혹: persona.images?.male?.expressions?.당혹 || ''
          }
        },
        female: {
          expressions: {
            중립: persona.images?.female?.expressions?.중립 || '',
            기쁨: persona.images?.female?.expressions?.기쁨 || '',
            슬픔: persona.images?.female?.expressions?.슬픔 || '',
            분노: persona.images?.female?.expressions?.분노 || '',
            놀람: persona.images?.female?.expressions?.놀람 || '',
            호기심: persona.images?.female?.expressions?.호기심 || '',
            불안: persona.images?.female?.expressions?.불안 || '',
            단호: persona.images?.female?.expressions?.단호 || '',
            실망: persona.images?.female?.expressions?.실망 || '',
            당혹: persona.images?.female?.expressions?.당혹 || ''
          }
        }
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
          <h2 className="text-2xl font-bold text-slate-900">페르소나 관리</h2>
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
              페르소나 생성
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-50">
            <DialogHeader className="bg-indigo-600 -m-6 mb-4 p-6 rounded-t-lg">
              <DialogTitle className="text-white text-xl flex items-center gap-2">
                <i className="fas fa-user-edit"></i>
                {editingPersona ? '페르소나 수정' : '페르소나 생성'}
              </DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 기본 정보 섹션 */}
              <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
                <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
                  <i className="fas fa-id-card text-indigo-600"></i>
                  기본 정보
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="id" className="text-sm font-semibold text-slate-700 mb-1.5 block">MBTI ID (소문자)</Label>
                    <Input
                      id="id"
                      value={formData.id}
                      onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))}
                      placeholder="istj, enfp, intp 등"
                      required
                      className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="input-persona-id"
                    />
                  </div>
                  <div>
                    <Label htmlFor="mbti" className="text-sm font-semibold text-slate-700 mb-1.5 block">MBTI 유형 (대문자)</Label>
                    <Input
                      id="mbti"
                      value={formData.mbti}
                      onChange={(e) => setFormData(prev => ({ ...prev, mbti: e.target.value }))}
                      placeholder="ISTJ, ENFP, INTP 등"
                      required
                      className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="input-mbti"
                    />
                  </div>
                </div>
              </div>

              {/* 성격 특성 섹션 */}
              <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
                <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
                  <i className="fas fa-brain text-purple-600"></i>
                  성격 특성
                </h3>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="personality_traits" className="text-sm font-semibold text-slate-700 mb-1.5 block">성격 특성 (쉼표로 구분)</Label>
                    <Textarea
                      id="personality_traits"
                      value={formData.personality_traits.join(', ')}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        personality_traits: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                      }))}
                      placeholder="경험 기반 사고, 현실적, 해결책 지향"
                      className="min-h-[80px] border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="textarea-personality-traits"
                    />
                  </div>

                  <div>
                    <Label htmlFor="communication_style" className="text-sm font-semibold text-slate-700 mb-1.5 block">의사소통 스타일</Label>
                    <Textarea
                      id="communication_style"
                      value={formData.communication_style}
                      onChange={(e) => setFormData(prev => ({ ...prev, communication_style: e.target.value }))}
                      placeholder="차분하고 논리적이며, 구체적 사례를 중시함"
                      className="min-h-[60px] border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="textarea-communication-style"
                    />
                  </div>

                  <div>
                    <Label htmlFor="motivation" className="text-sm font-semibold text-slate-700 mb-1.5 block">동기</Label>
                    <Textarea
                      id="motivation"
                      value={formData.motivation}
                      onChange={(e) => setFormData(prev => ({ ...prev, motivation: e.target.value }))}
                      placeholder="효율적 문제 해결과 신뢰 구축"
                      className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="input-motivation"
                    />
                  </div>

                  <div>
                    <Label htmlFor="fears" className="text-sm font-semibold text-slate-700 mb-1.5 block">두려움/우려사항 (쉼표로 구분)</Label>
                    <Input
                      id="fears"
                      value={formData.fears.join(', ')}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        fears: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                      }))}
                      placeholder="통제 불가능한 상황, 과부하, 혼란"
                      className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="input-fears"
                    />
                  </div>
                </div>
              </div>

              {/* 배경 정보 섹션 */}
              <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
                <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
                  <i className="fas fa-user-circle text-green-600"></i>
                  배경 정보
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="personal_values" className="text-sm font-semibold text-slate-700 mb-1.5 block">개인 가치관 (쉼표로 구분)</Label>
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
                      className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="input-personal-values"
                    />
                  </div>

                  <div>
                    <Label htmlFor="hobbies" className="text-sm font-semibold text-slate-700 mb-1.5 block">취미 (쉼표로 구분)</Label>
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
                      className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="input-hobbies"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="social_preference" className="text-sm font-semibold text-slate-700 mb-1.5 block">사회적 선호</Label>
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
                        className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                        data-testid="input-social-preference"
                      />
                    </div>

                    <div>
                      <Label htmlFor="social_behavior" className="text-sm font-semibold text-slate-700 mb-1.5 block">사회적 행동</Label>
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
                        className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                        data-testid="input-social-behavior"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 의사소통 패턴 섹션 */}
              <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
                <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
                  <i className="fas fa-comments text-blue-600"></i>
                  의사소통 패턴
                </h3>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="opening_style" className="text-sm font-semibold text-slate-700 mb-1.5 block">대화 시작 스타일</Label>
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
                      className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="input-opening-style"
                    />
                  </div>

                  <div>
                    <Label htmlFor="key_phrases" className="text-sm font-semibold text-slate-700 mb-1.5 block">주요 표현 (쉼표로 구분)</Label>
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
                      className="min-h-[60px] border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="textarea-key-phrases"
                    />
                  </div>

                  <div>
                    <Label htmlFor="win_conditions" className="text-sm font-semibold text-slate-700 mb-1.5 block">승리 조건 (쉼표로 구분)</Label>
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
                      className="min-h-[60px] border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                      data-testid="textarea-win-conditions"
                    />
                  </div>
                </div>
              </div>

              {/* 음성 및 성별 섹션 */}
              <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
                <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
                  <i className="fas fa-microphone text-orange-600"></i>
                  음성 특성 및 성별
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="voice_tone" className="text-sm font-semibold text-slate-700 mb-1.5 block">톤</Label>
                      <Input
                        id="voice_tone"
                        value={formData.voice?.tone || ''}
                        onChange={(e) => setFormData(prev => ({ 
                          ...prev, 
                          voice: { ...prev.voice, tone: e.target.value }
                        }))}
                        placeholder="따뜻하고 설득적"
                        className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                        data-testid="input-voice-tone"
                      />
                    </div>

                    <div>
                      <Label htmlFor="voice_pace" className="text-sm font-semibold text-slate-700 mb-1.5 block">속도</Label>
                      <Input
                        id="voice_pace"
                        value={formData.voice?.pace || ''}
                        onChange={(e) => setFormData(prev => ({ 
                          ...prev, 
                          voice: { ...prev.voice, pace: e.target.value }
                        }))}
                        placeholder="중간 / 빠름"
                        className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                        data-testid="input-voice-pace"
                      />
                    </div>

                    <div>
                      <Label htmlFor="voice_emotion" className="text-sm font-semibold text-slate-700 mb-1.5 block">감정</Label>
                      <Input
                        id="voice_emotion"
                        value={formData.voice?.emotion || ''}
                        onChange={(e) => setFormData(prev => ({ 
                          ...prev, 
                          voice: { ...prev.voice, emotion: e.target.value }
                        }))}
                        placeholder="공감과 진지함"
                        className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                        data-testid="input-voice-emotion"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="gender" className="text-sm font-semibold text-slate-700 mb-1.5 block">성별</Label>
                    <Select value={formData.gender} onValueChange={(value: 'male' | 'female') => {
                      setFormData(prev => {
                        const neutralImage = value === 'male' 
                          ? prev.images?.male?.expressions?.['중립']
                          : prev.images?.female?.expressions?.['중립'];
                        
                        return {
                          ...prev, 
                          gender: value,
                          images: {
                            ...prev.images,
                            base: neutralImage || prev.images?.base || ''
                          }
                        };
                      });
                    }}>
                      <SelectTrigger data-testid="select-gender" className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white">
                        <SelectValue placeholder="성별 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">남성</SelectItem>
                        <SelectItem value="female">여성</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* 이미지 정보 섹션 */}
              <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
                <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
                  <i className="fas fa-image text-pink-600"></i>
                  이미지 정보
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="images_base" className="text-sm font-semibold text-slate-700 mb-1.5 block">기본 이미지 URL</Label>
                      <Input
                        id="images_base"
                        value={formData.images?.base || ''}
                        onChange={(e) => setFormData(prev => ({ 
                          ...prev, 
                          images: { 
                            ...prev.images, 
                            base: e.target.value, 
                            style: prev.images.style || '',
                            male: prev.images.male,
                            female: prev.images.female
                          }
                        }))}
                        placeholder="https://picsum.photos/seed/mbti/150/150"
                        className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                        data-testid="input-images-base"
                      />
                    </div>

                    <div>
                      <Label htmlFor="images_style" className="text-sm font-semibold text-slate-700 mb-1.5 block">이미지 스타일</Label>
                      <Input
                        id="images_style"
                        value={formData.images?.style || ''}
                        onChange={(e) => setFormData(prev => ({ 
                          ...prev, 
                          images: { 
                            ...prev.images, 
                            style: e.target.value, 
                            base: prev.images.base || '',
                            male: prev.images.male,
                            female: prev.images.female
                          }
                        }))}
                        placeholder="실제 인물 사진 느낌"
                        className="border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                        data-testid="input-images-style"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 표정 이미지 생성 섹션 */}
              <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-200">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <i className="fas fa-magic text-amber-600"></i>
                    표정 이미지 생성
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateBaseImage}
                      disabled={isGeneratingBase || !editingPersona}
                      data-testid="button-generate-base-image"
                    >
                      {isGeneratingBase ? '생성 중...' : '기본 이미지 생성'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateExpressions}
                      disabled={isGeneratingExpressions || !editingPersona}
                      data-testid="button-generate-expressions"
                    >
                      {isGeneratingExpressions ? `생성 중... (${generationProgress.current}/${generationProgress.total})` : '전체 표정 생성'}
                    </Button>
                  </div>
                </div>
                
                {!editingPersona && (
                  <p className="text-sm text-slate-500">
                    이미지 생성은 페르소나를 먼저 저장한 후 수정 모드에서 사용할 수 있습니다.
                  </p>
                )}

                <div className="mb-4">
                  <p className="text-sm text-slate-600 mb-3">현재 선택: <span className="font-semibold">{formData.gender === 'male' ? '남성' : '여성'} 표정 이미지</span></p>
                </div>

                <div className="grid grid-cols-5 gap-3">
                  {['중립', '기쁨', '슬픔', '분노', '놀람', '호기심', '불안', '단호', '실망', '당혹'].map((emotion) => {
                    const currentGender = formData.gender;
                    let imageUrl = '';
                    
                    // 성별에 따라 이미지 경로 결정
                    if (currentGender === 'male') {
                      imageUrl = formData.images?.male?.expressions?.[emotion as keyof typeof formData.images.male.expressions] || '';
                    } else if (currentGender === 'female') {
                      imageUrl = formData.images?.female?.expressions?.[emotion as keyof typeof formData.images.female.expressions] || '';
                    }
                    
                    const isGenerating = generatingSingleEmotion === emotion;
                    
                    return (
                      <div key={emotion} className="flex flex-col items-center gap-1">
                        <div 
                          className={`w-20 h-20 rounded-lg border-2 border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center ${imageUrl ? 'cursor-pointer hover:border-blue-400 transition-colors' : ''}`}
                          onClick={() => {
                            if (imageUrl) {
                              setViewingImage({ url: imageUrl, emotion });
                            }
                          }}
                        >
                          {isGenerating ? (
                            <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
                          ) : imageUrl ? (
                            <img 
                              src={imageUrl} 
                              alt={emotion} 
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xs text-slate-400">없음</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-600 font-medium">{emotion}</span>
                          {editingPersona && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGenerateSingleExpression(emotion);
                              }}
                              disabled={isGenerating || isGeneratingExpressions}
                              className="p-0.5 rounded hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              title={`${emotion} 이미지 재생성`}
                              data-testid={`button-regenerate-${emotion}`}
                            >
                              <RefreshCw className={`w-3 h-3 text-slate-500 ${isGenerating ? 'animate-spin' : ''}`} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center justify-center w-8 h-8 p-0"
                        data-testid={`button-persona-menu-${persona.id}`}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handleEdit(persona)}
                        data-testid={`button-edit-persona-${persona.id}`}
                      >
                        <i className="fas fa-edit mr-2 w-4 h-4 text-center"></i>
                        수정
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem
                            onSelect={(e) => e.preventDefault()}
                            onClick={() => setDeletingPersona(persona)}
                            data-testid={`button-delete-persona-${persona.id}`}
                            className="text-red-600 focus:text-red-600 focus:bg-red-50"
                          >
                            <i className="fas fa-trash mr-2 w-4 h-4 text-center"></i>
                            삭제
                          </DropdownMenuItem>
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
                    </DropdownMenuContent>
                  </DropdownMenu>
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

      {/* 이미지 원본 보기 모달 */}
      {viewingImage && (
        <Dialog open={!!viewingImage} onOpenChange={() => setViewingImage(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{viewingImage.emotion} 표정 이미지</DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center p-4 bg-slate-50 rounded-lg">
              <img 
                src={viewingImage.url} 
                alt={viewingImage.emotion}
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-lg"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setViewingImage(null)}>닫기</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 기본 이미지 재생성 확인 다이얼로그 */}
      <AlertDialog open={showBaseImageConfirm} onOpenChange={setShowBaseImageConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>기본 이미지 재생성</AlertDialogTitle>
            <AlertDialogDescription>
              이미 생성된 기본 이미지가 있습니다. 기존 이미지를 삭제하고 새로운 기본 이미지를 생성하시겠어요?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowBaseImageConfirm(false);
                generateBaseImage();
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              재생성
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}