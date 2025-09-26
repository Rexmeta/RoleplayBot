import { useState } from 'react';
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { AlertCircle, Users, Target, Clock, CheckCircle2, Brain, TrendingUp, Lightbulb } from 'lucide-react';
import type { PersonaStatus, PersonaSelection } from '../../../shared/schema';
import type { ScenarioPersona } from '../lib/scenario-system';

interface StrategicPersonaSelectorProps {
  personas: ScenarioPersona[];
  personaStatuses: PersonaStatus[];
  currentPhase: number;
  totalPhases: number;
  onPersonaSelect: (selection: PersonaSelection) => void;
  onPhaseComplete: () => void;
  previousSelections: PersonaSelection[];
  scenarioContext: any;
  // 순차 계획 관련 props
  onSequencePlanSubmit?: (sequencePlan: PersonaSelection[]) => void;
  initialSequencePlan?: PersonaSelection[];
}

export function StrategicPersonaSelector({
  personas,
  personaStatuses,
  currentPhase,
  totalPhases,
  onPersonaSelect,
  onPhaseComplete,
  previousSelections,
  scenarioContext,
  onSequencePlanSubmit,
  initialSequencePlan
}: StrategicPersonaSelectorProps) {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectionReason, setSelectionReason] = useState('');
  const [expectedOutcome, setExpectedOutcome] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAIRecommendation, setShowAIRecommendation] = useState(true);
  const [aiAnalysisVisible, setAiAnalysisVisible] = useState(true);
  
  // 순차적 계획 모드 상태
  const [planningMode, setPlanningMode] = useState<'single' | 'sequence'>('single');
  const [sequencePlan, setSequencePlan] = useState<PersonaSelection[]>(initialSequencePlan || []);
  const [currentPlanningStep, setCurrentPlanningStep] = useState(0);

  // 초기 계획이 있으면 순차 모드로 전환
  React.useEffect(() => {
    if (initialSequencePlan && initialSequencePlan.length > 0) {
      setPlanningMode('sequence');
      setSequencePlan(initialSequencePlan);
    }
  }, [initialSequencePlan]);

  // 이미 선택된 페르소나들 ID 추출
  const selectedPersonaIds = previousSelections.map(sel => sel.personaId);
  
  // 아직 선택하지 않은 페르소나들만 필터링
  const availablePersonas = personas.filter(persona => 
    !selectedPersonaIds.includes(persona.id)
  );

  // 완료된 대화가 있는지 확인
  const hasCompletedConversations = previousSelections.length > 0;
  const totalPersonas = personas.length;
  const completedCount = previousSelections.length;
  const remainingCount = availablePersonas.length;

  const handlePersonaClick = (personaId: string) => {
    setSelectedPersonaId(personaId === selectedPersonaId ? null : personaId);
    if (personaId !== selectedPersonaId) {
      setSelectionReason('');
      setExpectedOutcome('');
    }
  };

  const handleSubmitSelection = async () => {
    if (!selectedPersonaId || !selectionReason.trim() || !expectedOutcome.trim()) {
      return;
    }

    setIsSubmitting(true);

    const selection: PersonaSelection = {
      phase: currentPhase,
      personaId: selectedPersonaId,
      selectionReason: selectionReason.trim(),
      timestamp: new Date().toISOString(),
      expectedOutcome: expectedOutcome.trim()
    };

    try {
      await onPersonaSelect(selection);
      setSelectedPersonaId(null);
      setSelectionReason('');
      setExpectedOutcome('');
    } catch (error) {
      console.error('페르소나 선택 실패:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPersonaStatus = (personaId: string): PersonaStatus | undefined => {
    return personaStatuses.find(status => status.personaId === personaId);
  };

  // AI 추천 페르소나 계산
  const getAIRecommendation = () => {
    if (availablePersonas.length === 0) return null;
    
    const scoredPersonas = availablePersonas.map(persona => {
      const status = getPersonaStatus(persona.id);
      if (!status) return { persona, score: 0, reasons: [] };
      
      let score = 0;
      const reasons: string[] = [];
      
      // 영향력 가중치 (30%)
      score += status.influence * 0.3;
      if (status.influence >= 4) reasons.push('높은 영향력 보유');
      
      // 접근성 가중치 (25%)
      score += status.approachability * 0.25;
      if (status.approachability >= 4) reasons.push('접근하기 용이함');
      
      // 정보량 가중치 (25%)
      const infoScore = Math.min(5, status.availableInfo.length);
      score += infoScore * 0.25;
      if (status.availableInfo.length >= 3) reasons.push('풍부한 정보 보유');
      
      // 인맥 관계 가중치 (20%)
      const relationshipScore = Math.min(5, status.keyRelationships.length);
      score += relationshipScore * 0.2;
      if (status.keyRelationships.length >= 2) reasons.push('넓은 인맥 네트워크');
      
      // 기분 보정
      const moodMultiplier = status.currentMood === 'positive' ? 1.2 : 
                            status.currentMood === 'negative' ? 0.8 : 1.0;
      score *= moodMultiplier;
      
      if (status.currentMood === 'positive') reasons.push('긍정적인 상태');
      
      return { persona, score, reasons };
    });
    
    return scoredPersonas.sort((a, b) => b.score - a.score);
  };
  
  const aiRecommendations = getAIRecommendation();

  const getMoodColor = (mood: string) => {
    switch (mood) {
      case 'positive': return 'bg-green-100 text-green-800';
      case 'negative': return 'bg-red-100 text-red-800';
      case 'neutral': return 'bg-gray-100 text-gray-800';
      default: return 'bg-yellow-100 text-yellow-800';
    }
  };

  const getMoodIcon = (mood: string) => {
    switch (mood) {
      case 'positive': return '😊';
      case 'negative': return '😠';
      case 'neutral': return '😐';
      default: return '❓';
    }
  };

  const getApproachabilityText = (score: number) => {
    if (score >= 4) return '매우 접근하기 쉬움';
    if (score >= 3) return '접근하기 쉬움';
    if (score >= 2) return '보통';
    return '접근하기 어려움';
  };

  const getInfluenceText = (score: number) => {
    if (score >= 4) return '높은 영향력';
    if (score >= 3) return '중간 영향력';
    if (score >= 2) return '낮은 영향력';
    return '매우 낮은 영향력';
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* 헤더 섹션 */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center justify-center gap-3">
          <Brain className="w-8 h-8 text-blue-600" />
          AI 전략적 대화 계획 수립
        </h1>
        <p className="text-lg text-gray-600 mb-4">
          {scenarioContext?.situation || '상황을 파악하고 적절한 순서로 대화 상대를 선택하세요'}
        </p>
        <div className="flex items-center justify-center gap-4 text-sm">
          <div className="flex items-center gap-2 text-blue-600">
            <Users className="w-4 h-4" />
            <span className="font-medium">{currentPhase}단계 / {totalPhases}단계</span>
          </div>
          <div className="flex items-center gap-2 text-green-600">
            <TrendingUp className="w-4 h-4" />
            <span className="font-medium">실시간 전략 분석</span>
          </div>
          <div className="flex items-center gap-2 text-purple-600">
            <Lightbulb className="w-4 h-4" />
            <span className="font-medium">AI 추천 시스템 활성화</span>
          </div>
        </div>
      </div>

      {/* 진행 상황 표시 */}
      {hasCompletedConversations && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-green-900 mb-2">
                  진행 상황: {completedCount}/{totalPersonas} 대화 완료
                </h3>
                <p className="text-green-700">
                  {remainingCount > 0 
                    ? `${remainingCount}명의 대화 상대가 남아있습니다. 다음 상대를 선택하세요.`
                    : '모든 대화가 완료되었습니다!'
                  }
                </p>
              </div>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <div className="text-2xl font-bold text-green-800">
                  {Math.round((completedCount / totalPersonas) * 100)}%
                </div>
              </div>
            </div>
            
            {/* 완료된 대화 목록 */}
            <div className="mt-4">
              <h4 className="font-medium text-green-900 mb-2">완료된 대화:</h4>
              <div className="flex flex-wrap gap-2">
                {previousSelections.map((selection, index) => {
                  const persona = personas.find(p => p.id === selection.personaId);
                  return (
                    <div key={index} className="flex items-center gap-2 px-3 py-1 bg-green-100 rounded-full border border-green-200">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-sm font-medium text-green-800">{persona?.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI 전략 추천 섹션 */}
      <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50 mb-6">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-100 rounded-full">
              <Brain className="w-6 h-6 text-purple-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                🤖 AI 전략 분석 엔진이 활성화되었습니다
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2 bg-white/50 p-3 rounded-lg">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span><strong>순서 논리성</strong> 실시간 평가</span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/50 p-3 rounded-lg">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    <span><strong>추론 품질</strong> 자동 분석</span>
                  </div>
                  <div className="flex items-center gap-2 bg-white/50 p-3 rounded-lg">
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                    <span><strong>전략적 사고</strong> 평가 시스템</span>
                  </div>
                </div>
                <p className="text-gray-700">
                  각 선택마다 AI가 <strong>영향력, 접근성, 정보량, 인맥 관계</strong>를 종합 분석하여 
                  최적의 대화 순서를 제안하고 실시간으로 전략의 효과성을 평가합니다.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI 추천 시스템 */}
      {showAIRecommendation && aiRecommendations && aiRecommendations.length > 0 && (
        <Card className="border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-3 text-green-800">
                <div className="p-2 bg-green-100 rounded-full">
                  <Brain className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <span className="text-lg">🎯 AI 전략 추천</span>
                  <div className="text-sm font-normal text-green-600">실시간 상황 분석 기반</div>
                </div>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAIRecommendation(false)}
                className="text-green-700 hover:text-green-800"
              >
                ✕
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-green-800">
                  영향력, 접근성, 정보량, 인맥을 종합 분석한 최적 추천
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {aiRecommendations.slice(0, 2).map((rec, index) => {
                  const status = getPersonaStatus(rec.persona.id);
                  return (
                    <div 
                      key={rec.persona.id}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        index === 0 
                          ? 'border-green-300 bg-green-50/50' 
                          : 'border-green-200 bg-white/50'
                      } hover:shadow-md`}
                      onClick={() => handlePersonaClick(rec.persona.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${
                          index === 0 ? 'bg-green-500' : 'bg-green-400'
                        }`}>
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <img 
                              src={rec.persona.image} 
                              alt={rec.persona.name}
                              className="w-8 h-8 rounded-full"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(rec.persona.name)}&background=10b981&color=fff&size=32`;
                              }}
                            />
                            <div>
                              <div className="font-semibold text-gray-900">{rec.persona.name}</div>
                              <div className="text-xs text-gray-600">{rec.persona.role}</div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-green-700">AI 점수:</span>
                              <div className="flex items-center gap-1">
                                <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-green-500 transition-all duration-300"
                                    style={{ width: `${Math.min(100, (rec.score / 5) * 100)}%` }}
                                  ></div>
                                </div>
                                <span className="text-xs font-bold text-green-600">
                                  {(rec.score / 5 * 100).toFixed(0)}%
                                </span>
                              </div>
                            </div>
                            
                            <div className="space-y-1">
                              {rec.reasons.slice(0, 2).map((reason, idx) => (
                                <div key={idx} className="flex items-center gap-2 text-xs">
                                  <div className="w-1 h-1 bg-green-500 rounded-full"></div>
                                  <span className="text-green-700">{reason}</span>
                                </div>
                              ))}
                            </div>
                            
                            {status && (
                              <div className="flex items-center gap-2 pt-1">
                                <Badge className={`${getMoodColor(status.currentMood)} text-xs`}>
                                  {getMoodIcon(status.currentMood)} {status.currentMood}
                                </Badge>
                                <span className="text-xs text-gray-500">
                                  영향력 {status.influence}/5 • 접근성 {status.approachability}/5
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {index === 0 && (
                        <div className="mt-3 pt-3 border-t border-green-200">
                          <div className="flex items-center gap-2 text-xs text-green-800 font-medium">
                            <TrendingUp className="w-3 h-3" />
                            <span>💡 최우선 추천: 가장 전략적으로 유리한 선택</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              <div className="text-xs text-green-600 bg-green-50 p-3 rounded-lg">
                <strong>💡 AI 분석 근거:</strong> 각 페르소나의 영향력(30%), 접근성(25%), 보유정보(25%), 인맥관계(20%)를 
                가중평균하여 현재 상황에서 가장 효과적인 대화 순서를 제안합니다.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 계획 모드 선택기 */}
      <Card className="border-orange-200 bg-gradient-to-r from-orange-50 to-yellow-50 mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-orange-900 mb-1">
                대화 계획 방식 선택
              </h3>
              <p className="text-sm text-orange-800">
                한 명씩 선택하거나, 전체 순서를 미리 정할 수 있습니다
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant={planningMode === 'single' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPlanningMode('single')}
                className={planningMode === 'single' ? 'bg-orange-600 hover:bg-orange-700' : ''}
                data-testid="button-single-mode"
              >
                단계별 선택
              </Button>
              <Button
                variant={planningMode === 'sequence' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPlanningMode('sequence')}
                className={planningMode === 'sequence' ? 'bg-orange-600 hover:bg-orange-700' : ''}
                data-testid="button-sequence-mode"
              >
                전체 순서 계획
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 이전 선택 요약 */}
      {previousSelections.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              이전 대화 선택 내역
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {previousSelections.map((selection, index) => {
                const persona = personas.find(p => p.id === selection.personaId);
                return (
                  <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="w-8 h-8 bg-green-100 text-green-800 rounded-full flex items-center justify-center font-semibold text-sm">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">
                        {persona?.name} ({persona?.role || persona?.department})
                      </div>
                      <div className="text-sm text-gray-600">
                        선택 사유: {selection.selectionReason}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 단일 모드: 현재 단계 안내 */}
      {planningMode === 'single' && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Target className="w-5 h-5 text-blue-600 mt-1" />
              <div>
                <h3 className="font-semibold text-blue-900 mb-1">
                  {currentPhase}단계: 다음 대화 상대를 선택하세요
                </h3>
                <p className="text-blue-800 text-sm">
                  누구와 먼저 대화할지, 그리고 그 이유를 신중히 고려해주세요. 
                  각 선택은 상황 해결에 중요한 영향을 미칠 수 있습니다.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 순차 모드: 전체 계획 안내 */}
      {planningMode === 'sequence' && (
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-purple-600 mt-1" />
              <div>
                <h3 className="font-semibold text-purple-900 mb-1">
                  전체 대화 순서를 계획하세요
                </h3>
                <p className="text-purple-800 text-sm">
                  모든 페르소나와의 대화 순서를 미리 정하고, 각각에 대한 전략을 수립하세요. 
                  순서가 정해지면 자동으로 순차적으로 대화가 진행됩니다.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 단일 모드: 페르소나 선택 그리드 */}
      {planningMode === 'single' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {availablePersonas.map((persona) => {
          const status = getPersonaStatus(persona.id);
          const isSelected = selectedPersonaId === persona.id;
          const isCompleted = status?.hasBeenContacted || false;
          
          return (
            <Card 
              key={persona.id}
              className={`transition-all duration-200 ${
                isCompleted 
                  ? 'opacity-50 bg-gray-100 cursor-not-allowed' 
                  : isSelected 
                    ? 'ring-2 ring-blue-500 bg-blue-50 cursor-pointer' 
                    : 'hover:shadow-md hover:bg-gray-50 cursor-pointer'
              }`}
              onClick={() => !isCompleted && handlePersonaClick(persona.id)}
              data-testid={`persona-card-${persona.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <img 
                    src={persona.image} 
                    alt={persona.name}
                    className="w-12 h-12 rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=48`;
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {persona.name}
                      </h3>
                      {isCompleted && (
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-gray-600 truncate">
                      {persona.role || persona.department}
                    </p>
                    <p className="text-xs text-gray-500">
                      {persona.department}
                    </p>
                    {isCompleted && (
                      <Badge className="bg-green-100 text-green-800 text-xs mt-1">
                        대화 완료
                      </Badge>
                    )}
                  </div>
                </div>

                {status && (
                  <div className="space-y-2">
                    {/* 현재 기분 */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">기분:</span>
                      <Badge className={getMoodColor(status.currentMood)}>
                        {getMoodIcon(status.currentMood)} {status.currentMood}
                      </Badge>
                    </div>

                    {/* 접근성과 영향력 */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">접근성:</span>
                        <div className="flex items-center gap-1 mt-1">
                          {'★'.repeat(status.approachability)}
                          {'☆'.repeat(5 - status.approachability)}
                        </div>
                        <span className="text-gray-600 text-xs">
                          {getApproachabilityText(status.approachability)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">영향력:</span>
                        <div className="flex items-center gap-1 mt-1">
                          {'★'.repeat(status.influence)}
                          {'☆'.repeat(5 - status.influence)}
                        </div>
                        <span className="text-gray-600 text-xs">
                          {getInfluenceText(status.influence)}
                        </span>
                      </div>
                    </div>

                    {/* 보유 정보 */}
                    {status.availableInfo.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500 font-medium">보유 정보:</span>
                        <div className="mt-1">
                          {status.availableInfo.slice(0, 2).map((info, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs mr-1 mb-1">
                              {info}
                            </Badge>
                          ))}
                          {status.availableInfo.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{status.availableInfo.length - 2}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 인맥 관계 */}
                    {status.keyRelationships.length > 0 && (
                      <div>
                        <span className="text-xs text-gray-500 font-medium">주요 관계:</span>
                        <div className="mt-1">
                          {status.keyRelationships.slice(0, 2).map((rel, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs mr-1 mb-1">
                              {rel}
                            </Badge>
                          ))}
                          {status.keyRelationships.length > 2 && (
                            <Badge variant="secondary" className="text-xs">
                              +{status.keyRelationships.length - 2}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 이전 상호작용 결과 */}
                    {status.lastInteractionResult && (
                      <div className="pt-2 border-t">
                        <span className="text-xs text-gray-500">이전 대화 결과:</span>
                        <Badge 
                          className={`ml-1 text-xs ${
                            status.lastInteractionResult === 'success' ? 'bg-green-100 text-green-800' :
                            status.lastInteractionResult === 'failure' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {status.lastInteractionResult === 'success' ? '성공적' :
                           status.lastInteractionResult === 'failure' ? '실패' : '중립적'}
                        </Badge>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        </div>
      )}

      {/* 단일 모드: 선택 상세 정보 입력 */}
      {planningMode === 'single' && selectedPersonaId && (
        <Card className="border-green-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-800">
              <AlertCircle className="w-5 h-5" />
              선택 사유와 기대 효과를 입력해주세요
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 선택된 페르소나 AI 분석 */}
            {selectedPersonaId && (() => {
              const selectedPersona = personas.find(p => p.id === selectedPersonaId);
              const selectedStatus = getPersonaStatus(selectedPersonaId);
              const aiRec = aiRecommendations?.find(r => r.persona.id === selectedPersonaId);
              
              return (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 mb-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-blue-100 rounded-full">
                      <Brain className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-blue-900 mb-2">
                        🤖 {selectedPersona?.name} 선택에 대한 AI 분석
                      </h4>
                      
                      {aiRec && (
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-blue-700 font-medium">전략적 점수:</span>
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-blue-500 transition-all duration-300"
                                  style={{ width: `${Math.min(100, (aiRec.score / 5) * 100)}%` }}
                                ></div>
                              </div>
                              <span className="font-bold text-blue-600">
                                {(aiRec.score / 5 * 100).toFixed(0)}%
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap gap-1">
                            {aiRec.reasons.map((reason, idx) => (
                              <Badge key={idx} className="bg-blue-100 text-blue-800 text-xs">
                                ✓ {reason}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {selectedStatus && (
                        <div className="mt-3 pt-3 border-t border-blue-200">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <span className="text-blue-700 font-medium">효과성 예측:</span>
                              <div className="flex items-center gap-1 mt-1">
                                {selectedStatus.influence >= 4 ? (
                                  <span className="text-green-600">✓ 높은 영향력으로 결과 도출 유리</span>
                                ) : selectedStatus.influence >= 3 ? (
                                  <span className="text-yellow-600">⚠ 중간 영향력, 전략적 접근 필요</span>
                                ) : (
                                  <span className="text-red-600">⚠ 낮은 영향력, 신중한 접근 권장</span>
                                )}
                              </div>
                            </div>
                            <div>
                              <span className="text-blue-700 font-medium">대화 난이도:</span>
                              <div className="flex items-center gap-1 mt-1">
                                {selectedStatus.approachability >= 4 ? (
                                  <span className="text-green-600">✓ 원활한 대화 예상</span>
                                ) : selectedStatus.approachability >= 3 ? (
                                  <span className="text-yellow-600">⚠ 보통 난이도</span>
                                ) : (
                                  <span className="text-red-600">⚠ 어려운 대화 예상</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
            
            <div>
              <Label htmlFor="selection-reason" className="text-sm font-medium">
                이 사람을 선택한 이유는 무엇인가요? *
              </Label>
              <Textarea
                id="selection-reason"
                placeholder="예: 프로젝트 상황을 가장 잘 파악하고 있고, 다른 팀원들과의 관계도 좋아서 먼저 상황을 정확히 파악하고 싶습니다."
                value={selectionReason}
                onChange={(e) => setSelectionReason(e.target.value)}
                className="min-h-[80px]"
                data-testid="selection-reason-input"
              />
              <div className="flex items-center justify-between mt-1">
                <div className="text-xs text-gray-500">
                  구체적이고 논리적인 근거를 제시해주세요 (최소 20자)
                </div>
                <div className={`text-xs font-medium ${
                  selectionReason.length >= 20 ? 'text-green-600' : 
                  selectionReason.length >= 10 ? 'text-yellow-600' : 'text-red-500'
                }`}>
                  {selectionReason.length}/20
                </div>
              </div>
              
              {/* 실시간 품질 평가 */}
              {selectionReason.length >= 10 && (
                <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <Brain className="w-3 h-3 text-purple-600" />
                    <span className="font-medium text-purple-700">AI 추론 품질 분석</span>
                  </div>
                  <div className="space-y-1">
                    {selectionReason.includes('때문에') || selectionReason.includes('위해') || selectionReason.includes('통해') ? (
                      <div className="text-green-600">✓ 명확한 인과관계 설명</div>
                    ) : (
                      <div className="text-yellow-600">⚠ 인과관계 명시 권장 ("때문에", "위해" 등 사용)</div>
                    )}
                    
                    {selectionReason.includes('상황') || selectionReason.includes('문제') || selectionReason.includes('해결') ? (
                      <div className="text-green-600">✓ 상황 인식 및 문제 해결 지향</div>
                    ) : (
                      <div className="text-yellow-600">⚠ 상황 분석 및 목표 명시 권장</div>
                    )}
                    
                    <div className={`${selectionReason.length >= 30 ? 'text-green-600' : 'text-yellow-600'}`}>
                      {selectionReason.length >= 30 ? '✓' : '⚠'} 상세한 설명 수준
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="expected-outcome" className="text-sm font-medium">
                이 대화를 통해 무엇을 얻고자 하나요? *
              </Label>
              <Textarea
                id="expected-outcome"
                placeholder="예: 프로젝트 진행 상황과 문제점을 정확히 파악하고, 해결 방안에 대한 조언을 구하고 싶습니다."
                value={expectedOutcome}
                onChange={(e) => setExpectedOutcome(e.target.value)}
                className="min-h-[80px]"
                data-testid="expected-outcome-input"
              />
              <div className="text-xs text-gray-500 mt-1">
                구체적인 목표와 기대 효과를 명시해주세요
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedPersonaId(null);
                  setSelectionReason('');
                  setExpectedOutcome('');
                }}
              >
                취소
              </Button>
              <Button
                onClick={handleSubmitSelection}
                disabled={!selectionReason.trim() || !expectedOutcome.trim() || 
                         selectionReason.length < 20 || isSubmitting}
                className="bg-green-600 hover:bg-green-700"
                data-testid="submit-selection-button"
              >
                {isSubmitting ? '처리 중...' : '선택 확정'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 순차 모드: 전체 계획 설정 */}
      {planningMode === 'sequence' && (
        <div className="space-y-6">
          <Card className="border-purple-200 bg-purple-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-900">
                <Users className="w-5 h-5" />
                대화 순서 계획 ({sequencePlan.length}/{availablePersonas.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sequencePlan.length === 0 ? (
                <div className="text-center py-8">
                  <Target className="w-12 h-12 text-purple-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-purple-900 mb-2">
                    첫 번째 대화 상대를 선택하세요
                  </h3>
                  <p className="text-purple-700">
                    아래 페르소나 중에서 첫 번째로 대화할 상대를 선택하고 전략을 세우세요
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <h4 className="font-semibold text-purple-900">계획된 대화 순서:</h4>
                  {sequencePlan.map((selection, index) => {
                    const persona = personas.find(p => p.id === selection.personaId);
                    return (
                      <div key={index} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-purple-200">
                        <div className="w-8 h-8 bg-purple-100 text-purple-800 rounded-full flex items-center justify-center font-semibold text-sm">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">
                            {persona?.name} ({persona?.role || persona?.department})
                          </div>
                          <div className="text-sm text-purple-700">
                            {selection.selectionReason}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSequencePlan(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="text-red-600 hover:text-red-700"
                        >
                          제거
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 순차 모드: 페르소나 선택 그리드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availablePersonas
              .filter(persona => !sequencePlan.some(s => s.personaId === persona.id))
              .map((persona) => {
                const status = getPersonaStatus(persona.id);
                const isSelected = selectedPersonaId === persona.id;
                
                return (
                  <Card 
                    key={persona.id}
                    className={`transition-all duration-200 ${
                      isSelected 
                        ? 'ring-2 ring-purple-500 bg-purple-50 cursor-pointer' 
                        : 'hover:shadow-md hover:bg-gray-50 cursor-pointer'
                    }`}
                    onClick={() => handlePersonaClick(persona.id)}
                    data-testid={`sequence-persona-card-${persona.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3 mb-3">
                        <img 
                          src={persona.image} 
                          alt={persona.name}
                          className="w-12 h-12 rounded-full"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=48`;
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900 truncate">
                              {persona.name}
                            </h3>
                          </div>
                          <p className="text-sm text-gray-600 truncate">
                            {persona.role || persona.department}
                          </p>
                          <p className="text-xs text-gray-500">
                            {persona.department}
                          </p>
                        </div>
                      </div>

                      {status && (
                        <div className="space-y-2">
                          {/* 현재 기분 */}
                          <div className="flex items-center gap-2">
                            <Badge className={`${getMoodColor(status.currentMood)} text-xs`}>
                              {getMoodIcon(status.currentMood)} {status.currentMood}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              영향력 {status.influence}/5 • 접근성 {status.approachability}/5
                            </span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
          </div>

          {/* 순차 모드: 선택 입력 */}
          {selectedPersonaId && (
            <Card className="border-purple-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-purple-800">
                  <AlertCircle className="w-5 h-5" />
                  {sequencePlan.length + 1}번째 대화 전략을 수립하세요
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="sequence-reason" className="text-sm font-medium">
                      이 순서에 선택하는 이유 *
                    </Label>
                    <textarea
                      id="sequence-reason"
                      value={selectionReason}
                      onChange={(e) => setSelectionReason(e.target.value)}
                      className="w-full mt-1 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      rows={3}
                      placeholder="왜 이 시점에 이 사람과 대화하는 것이 전략적으로 유리한지 설명해주세요..."
                      data-testid="sequence-reason-input"
                    />
                  </div>

                  <div>
                    <Label htmlFor="sequence-outcome" className="text-sm font-medium">
                      기대하는 결과 *
                    </Label>
                    <textarea
                      id="sequence-outcome"
                      value={expectedOutcome}
                      onChange={(e) => setExpectedOutcome(e.target.value)}
                      className="w-full mt-1 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      rows={2}
                      placeholder="이 대화를 통해 얻고자 하는 구체적인 결과를 작성해주세요..."
                      data-testid="sequence-outcome-input"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedPersonaId(null);
                      setSelectionReason('');
                      setExpectedOutcome('');
                    }}
                  >
                    취소
                  </Button>
                  <Button
                    onClick={() => {
                      if (!selectedPersonaId || !selectionReason.trim() || !expectedOutcome.trim()) {
                        return;
                      }

                      const newSelection: PersonaSelection = {
                        phase: sequencePlan.length + 1,
                        personaId: selectedPersonaId,
                        selectionReason: selectionReason.trim(),
                        timestamp: new Date().toISOString(),
                        expectedOutcome: expectedOutcome.trim()
                      };

                      setSequencePlan(prev => [...prev, newSelection]);
                      setSelectedPersonaId(null);
                      setSelectionReason('');
                      setExpectedOutcome('');
                    }}
                    disabled={!selectionReason.trim() || !expectedOutcome.trim() || 
                             selectionReason.length < 20}
                    className="bg-purple-600 hover:bg-purple-700"
                    data-testid="add-to-sequence-button"
                  >
                    순서에 추가
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 전체 계획 완료 및 시작 버튼 */}
          {sequencePlan.length === availablePersonas.length && (
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  전체 대화 계획이 완성되었습니다!
                </h3>
                <p className="text-gray-600 mb-4">
                  설정한 순서대로 순차적인 대화를 시작하시겠습니까?
                </p>
                <Button 
                  onClick={() => {
                    // 순차 계획을 Home.tsx에 전달하여 저장
                    if (onSequencePlanSubmit && sequencePlan.length > 0) {
                      onSequencePlanSubmit(sequencePlan);
                    }
                    // 첫 번째 선택을 전송하고 대화 시작
                    if (sequencePlan[0]) {
                      onPersonaSelect(sequencePlan[0]);
                    }
                  }}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="start-sequence-button"
                >
                  순차 대화 시작하기
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* 단계 완료 버튼 (모든 대화가 끝난 경우) */}
      {availablePersonas.length === 0 && hasCompletedConversations && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              모든 대화가 완료되었습니다
            </h3>
            <p className="text-gray-600 mb-4">
              선택하신 순서와 전략에 대한 종합적인 분석을 받아보세요.
            </p>
            <Button 
              onClick={onPhaseComplete}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="complete-phase-button"
            >
              전략적 선택 분석 받기
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 다음 대화 상대 선택 안내 (일부 대화 완료 시) */}
      {availablePersonas.length > 0 && hasCompletedConversations && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-6 text-center">
            <Users className="w-12 h-12 text-blue-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              다음 대화 상대를 선택하세요
            </h3>
            <p className="text-gray-600 mb-4">
              아래에서 {remainingCount}명의 남은 대화 상대 중 다음으로 대화할 인물을 선택하고 전략을 세우세요.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}