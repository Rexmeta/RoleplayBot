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
  const [isAIGeneratorOpen, setIsAIGeneratorOpen] = useState(false);
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
      context: scenario.context,
      objectives: scenario.objectives,
      successCriteria: scenario.successCriteria,
      // personas가 객체 배열인 경우 ID만 추출, 문자열 배열인 경우 그대로 사용
      personas: Array.isArray(scenario.personas) 
        ? scenario.personas.map(p => typeof p === 'string' ? {
            id: p,
            name: '',
            department: '',
            position: '',
            experience: '',
            personaRef: p + '.json',
            stance: '',
            goal: '',
            tradeoff: ''
          } : p)
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
        
        <div className="flex gap-3">
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
            
              <div>Form content here...</div>
            </DialogContent>
          </Dialog>

          <AIScenarioGenerator onGenerated={handleAIGenerated} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {scenarios?.map((scenario) => (
          <div key={scenario.id}>Scenario card content...</div>
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
