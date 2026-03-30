import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AIGeneratorProps {
  onGenerated: (data: any) => void;
}

export function AIScenarioGenerator({ onGenerated }: AIGeneratorProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formData, setFormData] = useState({
    idea: '',
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
        title: t('admin.aiGenerator.success'),
        description: t('admin.aiGenerator.generated'),
        variant: "default"
      });
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('admin.aiGenerator.generateFailed'),
        variant: "destructive"
      });
    }
  });

  const handleGenerate = () => {
    const requiredFields = [
      { field: formData.idea, name: '시나리오 아이디어' },
      { field: formData.playerRole.position, name: t('admin.aiGenerator.position') },
      { field: formData.playerRole.department, name: t('admin.aiGenerator.department') },
      { field: formData.playerRole.experience, name: t('admin.aiGenerator.experienceLevel') },
      { field: formData.playerRole.responsibility, name: t('admin.aiGenerator.coreResponsibility') }
    ];
    
    for (const { field, name } of requiredFields) {
      if (!field.trim()) {
        toast({
          title: t('admin.aiGenerator.requiredFieldMissing'),
          description: t('admin.aiGenerator.pleaseEnter', { field: name }),
          variant: "destructive"
        });
        return;
      }
    }
    
    generateMutation.mutate(formData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                className="border-purple-600 text-purple-600 hover:bg-purple-50"
                data-testid="button-ai-generate"
              >
                <i className="fas fa-magic mr-2"></i>
                {t('admin.aiGenerator.generateWithAI')}
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">AI를 사용해 시나리오를 자동 생성합니다</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-50">
        <DialogHeader className="bg-purple-600 -m-6 mb-4 p-6 rounded-t-lg">
          <DialogTitle className="text-white text-xl flex items-center gap-2">
            <i className="fas fa-magic"></i>
            {t('admin.aiGenerator.title')}
          </DialogTitle>
          <p className="text-purple-100 text-sm mt-1">아이디어와 플레이어 역할만 입력하면 AI가 나머지를 자동으로 완성합니다</p>
        </DialogHeader>
        
        <div className="space-y-5">
          {/* 시나리오 아이디어 */}
          <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
              <i className="fas fa-lightbulb text-yellow-500"></i>
              시나리오 아이디어 <span className="text-red-500">*</span>
            </h3>
            <div>
              <Label htmlFor="idea" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                어떤 상황의 시나리오를 만들고 싶으신가요?
              </Label>
              <Textarea
                id="idea"
                value={formData.idea}
                onChange={(e) => setFormData(prev => ({ ...prev, idea: e.target.value }))}
                placeholder="예: 팀장과 연봉 협상하는 상황, 프로젝트 일정 지연으로 팀 간 갈등이 생긴 상황, 신입사원이 무리한 업무 요청을 받은 상황"
                className="min-h-[100px] border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                data-testid="textarea-idea"
              />
              <p className="text-xs text-slate-500 mt-1">AI가 업종, 상황 세부사항, 시간 제약, 이해관계 등을 자동으로 추론합니다</p>
            </div>
          </div>
          
          {/* 플레이어 역할 */}
          <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
              <i className="fas fa-user-tie text-blue-600"></i>
              플레이어 역할 <span className="text-red-500">*</span>
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="position" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  {t('admin.aiGenerator.position')} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="position"
                  value={formData.playerRole.position}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    playerRole: { ...prev.playerRole, position: e.target.value }
                  }))}
                  placeholder="예: 개발자, 매니저, 팀장"
                  className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                  data-testid="input-position"
                />
              </div>
              
              <div>
                <Label htmlFor="department" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  {t('admin.aiGenerator.department')} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="department"
                  value={formData.playerRole.department}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    playerRole: { ...prev.playerRole, department: e.target.value }
                  }))}
                  placeholder="예: 개발팀, 마케팅팀, 기획팀"
                  className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                  data-testid="input-department"
                />
              </div>
              
              <div>
                <Label htmlFor="experience" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  {t('admin.aiGenerator.experienceLevel')} <span className="text-red-500">*</span>
                </Label>
                <Select 
                  value={formData.playerRole.experience} 
                  onValueChange={(value) => setFormData(prev => ({ 
                    ...prev, 
                    playerRole: { ...prev.playerRole, experience: value }
                  }))}
                >
                  <SelectTrigger className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white">
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
                <Label htmlFor="responsibility" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                  {t('admin.aiGenerator.coreResponsibility')} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="responsibility"
                  value={formData.playerRole.responsibility}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    playerRole: { ...prev.playerRole, responsibility: e.target.value }
                  }))}
                  placeholder="예: 최적의 해결안 도출"
                  className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                  data-testid="input-responsibility"
                />
              </div>
            </div>
          </div>

          {/* 페르소나 수 */}
          <div className="bg-white rounded-lg p-5 shadow-sm border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 pb-2 border-b border-slate-200">
              <i className="fas fa-users text-green-600"></i>
              페르소나 수
            </h3>
            <div>
              <Select 
                value={formData.personaCount.toString()} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, personaCount: Number(value) }))}
              >
                <SelectTrigger className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white">
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
              <p className="text-xs text-slate-500 mt-1">
                {t('admin.aiGenerator.difficultyNote')}
              </p>
            </div>
          </div>

          {/* 고급 설정 토글 */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(prev => !prev)}
              className="w-full p-5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
            >
              <span className="text-base font-bold text-slate-700 flex items-center gap-2">
                <i className="fas fa-sliders-h text-slate-500"></i>
                고급 설정 <span className="text-sm font-normal text-slate-400">(선택사항 — 미입력 시 AI가 자동 추론)</span>
              </span>
              {showAdvanced ? (
                <ChevronUp className="h-5 w-5 text-slate-400" />
              ) : (
                <ChevronDown className="h-5 w-5 text-slate-400" />
              )}
            </button>

            {showAdvanced && (
              <div className="px-5 pb-5 space-y-4 border-t border-slate-200">
                <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="industry" className="text-sm font-semibold text-slate-700 mb-1.5 block">{t('admin.aiGenerator.industry')}</Label>
                    <Input
                      id="industry"
                      value={formData.industry}
                      onChange={(e) => setFormData(prev => ({ ...prev, industry: e.target.value }))}
                      placeholder="예: IT, 제조업, 서비스업"
                      className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                      data-testid="input-ai-industry"
                    />
                  </div>

                  <div>
                    <Label htmlFor="estimatedTime" className="text-sm font-semibold text-slate-700 mb-1.5 block">{t('admin.aiGenerator.estimatedTime')}</Label>
                    <Select 
                      value={formData.estimatedTime} 
                      onValueChange={(value) => setFormData(prev => ({ ...prev, estimatedTime: value }))}
                    >
                      <SelectTrigger className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white">
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
                  <Label htmlFor="situation" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                    {t('admin.aiGenerator.situationDescription')}
                  </Label>
                  <Textarea
                    id="situation"
                    value={formData.situation}
                    onChange={(e) => setFormData(prev => ({ ...prev, situation: e.target.value }))}
                    placeholder="예: 신규 제품 출시 일정이 지연되면서 부서 간 갈등이 심화되고 있습니다."
                    className="min-h-[80px] border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                    data-testid="textarea-situation"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="timeline" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                      {t('admin.aiGenerator.timeConstraint')}
                    </Label>
                    <Input
                      id="timeline"
                      value={formData.timeline}
                      onChange={(e) => setFormData(prev => ({ ...prev, timeline: e.target.value }))}
                      placeholder="예: 마케팅 행사까지 1주일 남음"
                      className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                      data-testid="input-timeline"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="stakes" className="text-sm font-semibold text-slate-700 mb-1.5 block">
                      {t('admin.aiGenerator.stakeholdersAndConflicts')}
                    </Label>
                    <Input
                      id="stakes"
                      value={formData.stakes}
                      onChange={(e) => setFormData(prev => ({ ...prev, stakes: e.target.value }))}
                      placeholder="예: 품질 vs 일정 vs 고객 만족도"
                      className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                      data-testid="input-stakes"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="conflictType" className="text-sm font-semibold text-slate-700 mb-1.5 block">{t('admin.aiGenerator.conflictType')}</Label>
                    <Select 
                      value={formData.conflictType} 
                      onValueChange={(value) => setFormData(prev => ({ ...prev, conflictType: value }))}
                    >
                      <SelectTrigger className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white">
                        <SelectValue placeholder="갈등 유형 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="역할불명확">역할 불명확</SelectItem>
                        <SelectItem value="업무우선순위충돌">업무 우선순위 충돌</SelectItem>
                        <SelectItem value="성과불균형인식">성과 불균형 인식</SelectItem>
                        <SelectItem value="세대차이">세대 차이</SelectItem>
                        <SelectItem value="소통오류">소통 오류</SelectItem>
                        <SelectItem value="의사결정방식차이">의사결정 방식 차이</SelectItem>
                        <SelectItem value="리더십스타일차이">리더십 스타일 차이</SelectItem>
                        <SelectItem value="성과독점">성과 독점</SelectItem>
                        <SelectItem value="정보독점">정보 독점</SelectItem>
                        <SelectItem value="책임떠넘기기">책임 떠넘기기</SelectItem>
                        <SelectItem value="업무방식차이">업무 방식 차이</SelectItem>
                        <SelectItem value="개인목표조직목표불일치">개인 목표와 조직 목표 불일치</SelectItem>
                        <SelectItem value="지식경험차이">지식/경험의 차이</SelectItem>
                        <SelectItem value="업무범위침범">업무 범위 침범</SelectItem>
                        <SelectItem value="정치적갈등">정치적 갈등</SelectItem>
                        <SelectItem value="감정누적">감정의 누적</SelectItem>
                        <SelectItem value="인정욕구미충족">인정 욕구 미충족</SelectItem>
                        <SelectItem value="신뢰부족">신뢰 부족</SelectItem>
                        <SelectItem value="리소스경쟁">리소스 경쟁</SelectItem>
                        <SelectItem value="다양성가치관차이">다양성·가치관 차이</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="objectiveType" className="text-sm font-semibold text-slate-700 mb-1.5 block">{t('admin.aiGenerator.goalType')}</Label>
                    <Select 
                      value={formData.objectiveType} 
                      onValueChange={(value) => setFormData(prev => ({ ...prev, objectiveType: value }))}
                    >
                      <SelectTrigger className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white">
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
                </div>

                <div>
                  <Label htmlFor="skills" className="text-sm font-semibold text-slate-700 mb-1.5 block">필요 역량 (쉼표로 구분)</Label>
                  <Input
                    id="skills"
                    value={formData.skills}
                    onChange={(e) => setFormData(prev => ({ ...prev, skills: e.target.value }))}
                    placeholder="예: 갈등 중재, 협상, 의사소통"
                    className="border-slate-300 focus:border-purple-500 focus:ring-purple-500 bg-white"
                    data-testid="input-skills"
                  />
                </div>
              </div>
            )}
          </div>
          
          <div className="flex gap-2 pt-2">
            <Button 
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('admin.common.loading')}
                </>
              ) : (
                <>
                  <i className="fas fa-magic mr-2"></i>
                  {t('admin.aiGenerator.generateButton')}
                </>
              )}
            </Button>
            <Button 
              type="button" 
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
