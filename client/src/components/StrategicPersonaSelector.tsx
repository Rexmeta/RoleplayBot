import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { AlertCircle, Users, Target, Clock, CheckCircle2 } from 'lucide-react';
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
}

export function StrategicPersonaSelector({
  personas,
  personaStatuses,
  currentPhase,
  totalPhases,
  onPersonaSelect,
  onPhaseComplete,
  previousSelections,
  scenarioContext
}: StrategicPersonaSelectorProps) {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [selectionReason, setSelectionReason] = useState('');
  const [expectedOutcome, setExpectedOutcome] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 이미 선택된 페르소나들 ID 추출
  const selectedPersonaIds = previousSelections.map(sel => sel.personaId);
  
  // 아직 선택하지 않은 페르소나들만 필터링
  const availablePersonas = personas.filter(persona => 
    !selectedPersonaIds.includes(persona.id)
  );

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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          전략적 대화 계획 수립
        </h1>
        <p className="text-lg text-gray-600 mb-4">
          {scenarioContext?.situation || '상황을 파악하고 적절한 순서로 대화 상대를 선택하세요'}
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <Users className="w-4 h-4" />
          <span>{currentPhase}단계 / {totalPhases}단계</span>
          <span className="mx-2">•</span>
          <Clock className="w-4 h-4" />
          <span>신중한 선택이 성공의 열쇠입니다</span>
        </div>
      </div>

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
                        {persona?.name} ({persona?.position})
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

      {/* 현재 단계 안내 */}
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

      {/* 페르소나 선택 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {availablePersonas.map((persona) => {
          const status = getPersonaStatus(persona.id);
          const isSelected = selectedPersonaId === persona.id;
          
          return (
            <Card 
              key={persona.id}
              className={`cursor-pointer transition-all duration-200 ${
                isSelected 
                  ? 'ring-2 ring-blue-500 bg-blue-50' 
                  : 'hover:shadow-md hover:bg-gray-50'
              }`}
              onClick={() => handlePersonaClick(persona.id)}
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
                    <h3 className="font-semibold text-gray-900 truncate">
                      {persona.name}
                    </h3>
                    <p className="text-sm text-gray-600 truncate">
                      {persona.position}
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

      {/* 선택 상세 정보 입력 */}
      {selectedPersonaId && (
        <Card className="border-green-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-800">
              <AlertCircle className="w-5 h-5" />
              선택 사유와 기대 효과를 입력해주세요
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <div className="text-xs text-gray-500 mt-1">
                구체적이고 논리적인 근거를 제시해주세요 (최소 20자)
              </div>
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

      {/* 단계 완료 버튼 (모든 대화가 끝난 경우) */}
      {availablePersonas.length === 0 && (
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
    </div>
  );
}