import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Loader2 } from 'lucide-react';

interface AIGeneratorProps {
  onGenerated: (data: any) => void;
}

export function AIScenarioGenerator({ onGenerated }: AIGeneratorProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    theme: '',
    industry: '',
    situation: '',
    timeline: '',
    stakes: '',
    playerRole: {
      position: '',
      department: '',
      experience: '',
      responsibility: ''
    },
    conflictType: '',
    objectiveType: '',
    skills: '',
    estimatedTime: '60-90분',
    personaCount: 3
  });

  const generateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest('POST', '/api/admin/generate-scenario', data);
      return response.json();
    },
    onSuccess: (result) => {
      setIsOpen(false);
      onGenerated(result);
      toast({
        title: "성공",
        description: "AI가 시나리오를 생성했습니다.",
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
    // 필수 필드 검증
    const requiredFields = [
      { field: formData.theme, name: '주제' },
      { field: formData.situation, name: '상황 설명' },
      { field: formData.timeline, name: '시간적 제약' },
      { field: formData.stakes, name: '이해관계' },
      { field: formData.playerRole.position, name: '직책' },
      { field: formData.playerRole.department, name: '소속 부서' },
      { field: formData.playerRole.experience, name: '경력 수준' },
      { field: formData.playerRole.responsibility, name: '핵심 책임' }
    ];
    
    for (const { field, name } of requiredFields) {
      if (!field.trim()) {
        toast({
          title: "필수 입력 누락",
          description: `${name}을(를) 입력해주세요.`,
          variant: "destructive"
        });
        return;
      }
    }
    
    generateMutation.mutate(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          className="border-purple-600 text-purple-600 hover:bg-purple-50"
          data-testid="button-ai-generate"
        >
          <i className="fas fa-magic mr-2"></i>
          AI로 생성
        </Button>
      </DialogTrigger>
      
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI 시나리오 생성</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label htmlFor="theme">주제 *</Label>
              <Input
                id="theme"
                value={formData.theme}
                onChange={(e) => setFormData(prev => ({ ...prev, theme: e.target.value }))}
                placeholder="예: 프로젝트 지연, 갈등 해결, 협상"
                data-testid="input-ai-theme"
              />
            </div>
            
            <div>
              <Label htmlFor="industry">업종</Label>
              <Input
                id="industry"
                value={formData.industry}
                onChange={(e) => setFormData(prev => ({ ...prev, industry: e.target.value }))}
                placeholder="예: IT, 제조업, 서비스업"
                data-testid="input-ai-industry"
              />
            </div>
          </div>
          
          <div>
            <Label htmlFor="situation">구체적 상황 설명 *</Label>
            <Textarea
              id="situation"
              value={formData.situation}
              onChange={(e) => setFormData(prev => ({ ...prev, situation: e.target.value }))}
              placeholder="예: 신규 제품 출시 일정이 지연되면서 부서 간 갈등이 심화되고 있습니다."
              className="min-h-[80px]"
              data-testid="textarea-situation"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="timeline">시간적 제약 *</Label>
              <Input
                id="timeline"
                value={formData.timeline}
                onChange={(e) => setFormData(prev => ({ ...prev, timeline: e.target.value }))}
                placeholder="예: 마케팅 행사까지 1주일 남음"
                data-testid="input-timeline"
              />
            </div>
            
            <div>
              <Label htmlFor="stakes">이해관계 및 갈등 요소 *</Label>
              <Input
                id="stakes"
                value={formData.stakes}
                onChange={(e) => setFormData(prev => ({ ...prev, stakes: e.target.value }))}
                placeholder="예: 품질 vs 일정 vs 고객 만족도"
                data-testid="input-stakes"
              />
            </div>
          </div>
          
          <div>
            <h3 className="font-semibold text-lg mb-4">참가자 역할 정보</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="position">직책 *</Label>
                <Input
                  id="position"
                  value={formData.playerRole.position}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    playerRole: { ...prev.playerRole, position: e.target.value }
                  }))}
                  placeholder="예: 개발자, 매니저, 팀장"
                  data-testid="input-position"
                />
              </div>
              
              <div>
                <Label htmlFor="department">소속 부서 *</Label>
                <Input
                  id="department"
                  value={formData.playerRole.department}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    playerRole: { ...prev.playerRole, department: e.target.value }
                  }))}
                  placeholder="예: 개발팀, 마케팅팀, 기획팀"
                  data-testid="input-department"
                />
              </div>
              
              <div>
                <Label htmlFor="experience">경력 수준 *</Label>
                <Select 
                  value={formData.playerRole.experience} 
                  onValueChange={(value) => setFormData(prev => ({ 
                    ...prev, 
                    playerRole: { ...prev.playerRole, experience: value }
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="경력 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="신입">신입</SelectItem>
                    <SelectItem value="1년차">1년차</SelectItem>
                    <SelectItem value="3년차">3년차</SelectItem>
                    <SelectItem value="5년차">5년차</SelectItem>
                    <SelectItem value="10년차">10년차</SelectItem>
                    <SelectItem value="팀장급">팀장급</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="responsibility">핵심 책임 *</Label>
                <Input
                  id="responsibility"
                  value={formData.playerRole.responsibility}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    playerRole: { ...prev.playerRole, responsibility: e.target.value }
                  }))}
                  placeholder="예: 최적의 해결안 도출"
                  data-testid="input-responsibility"
                />
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="conflictType">갈등 유형</Label>
              <Select 
                value={formData.conflictType} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, conflictType: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="갈등 유형 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="부서간">부서간 갈등</SelectItem>
                  <SelectItem value="우선순위">우선순위 충돌</SelectItem>
                  <SelectItem value="자원경쟁">자원 경쟁</SelectItem>
                  <SelectItem value="의견차이">의견 차이</SelectItem>
                  <SelectItem value="리더십">리더십 갈등</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="objectiveType">목표 유형</Label>
              <Select 
                value={formData.objectiveType} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, objectiveType: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="목표 유형 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="협상">협상 및 타협</SelectItem>
                  <SelectItem value="중재">갈등 중재</SelectItem>
                  <SelectItem value="설득">이해관계자 설득</SelectItem>
                  <SelectItem value="의사결정">집단 의사결정</SelectItem>
                  <SelectItem value="팀워크">팀워크 구축</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="skills">필요 역량 (쉼표로 구분)</Label>
              <Input
                id="skills"
                value={formData.skills}
                onChange={(e) => setFormData(prev => ({ ...prev, skills: e.target.value }))}
                placeholder="예: 갈등 중재, 협상, 의사소통"
                data-testid="input-skills"
              />
            </div>
            
            <div>
              <Label htmlFor="estimatedTime">예상 소요 시간</Label>
              <Select 
                value={formData.estimatedTime} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, estimatedTime: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30-45분">30-45분</SelectItem>
                  <SelectItem value="45-60분">45-60분</SelectItem>
                  <SelectItem value="60-90분">60-90분</SelectItem>
                  <SelectItem value="90-120분">90-120분</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                <SelectItem value="1">1명</SelectItem>
                <SelectItem value="2">2명</SelectItem>
                <SelectItem value="3">3명</SelectItem>
                <SelectItem value="4">4명</SelectItem>
                <SelectItem value="5">5명</SelectItem>
                <SelectItem value="6">6명</SelectItem>
                <SelectItem value="7">7명</SelectItem>
                <SelectItem value="8">8명</SelectItem>
                <SelectItem value="9">9명</SelectItem>
                <SelectItem value="10">10명</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-2 pt-4">
            <Button 
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  생성 중...
                </>
              ) : (
                <>
                  <i className="fas fa-magic mr-2"></i>
                  생성하기
                </>
              )}
            </Button>
            <Button 
              type="button" 
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              취소
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}