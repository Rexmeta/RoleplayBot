import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Users, MessageCircle, Target, Clock, BarChart, Lightbulb, AlertCircle, TrendingUp, ArrowLeft, Loader2 } from "lucide-react";
import { type ScenarioPersona, type ComplexScenario } from "@/lib/scenario-system";

interface SimplePersonaSelectorProps {
  personas: ScenarioPersona[];
  completedPersonaIds: string[];
  onPersonaSelect: (persona: ScenarioPersona, selectedDifficulty: number) => void;
  scenarioTitle: string;
  scenarioSituation?: string;
  scenario?: ComplexScenario;
  onBack?: () => void;
  isLoading?: boolean;
  loadingPersonaId?: string | null;
  selectedDifficulty: number;
  onDifficultyChange: (difficulty: number) => void;
}

export function SimplePersonaSelector({
  personas,
  completedPersonaIds,
  onPersonaSelect,
  scenarioTitle,
  scenarioSituation,
  scenario,
  onBack,
  isLoading = false,
  loadingPersonaId = null,
  selectedDifficulty,
  onDifficultyChange
}: SimplePersonaSelectorProps) {
  const availablePersonas = personas.filter(p => !completedPersonaIds.includes(p.id));
  const completedCount = completedPersonaIds.length;
  const totalCount = personas.length;
  const progressPercentage = Math.round((completedCount / totalCount) * 100);
  
  const difficultyLabels: Record<number, { name: string; color: string; description: string }> = {
    1: { name: "매우 쉬움", color: "bg-green-100 text-green-800 border-green-300", description: "초보자를 위한 친절하고 교육적인 대화" },
    2: { name: "기본", color: "bg-blue-100 text-blue-800 border-blue-300", description: "친절하지만 현실적인 대화" },
    3: { name: "도전형", color: "bg-orange-100 text-orange-800 border-orange-300", description: "논리적 근거를 요구하는 도전적 대화" },
    4: { name: "고난도", color: "bg-red-100 text-red-800 border-red-300", description: "실전과 같은 압박감 있는 대화" },
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* 상단 네비게이션 */}
      {onBack && (
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={onBack}
            className="gap-2 hover:bg-slate-100"
            data-testid="back-to-scenarios"
          >
            <ArrowLeft className="w-4 h-4" />
            시나리오 목록
          </Button>
        </div>
      )}
      
      {/* 헤더 */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">{scenarioTitle}</h1>
        {scenarioSituation && (
          <p className="text-lg text-gray-600 mb-4">{scenarioSituation}</p>
        )}
        {scenario?.estimatedTime && (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-4">
            <Clock className="w-4 h-4" />
            <span>예상 소요 시간: {scenario.estimatedTime}</span>
          </div>
        )}
        
        {/* 난이도 선택 */}
        <div className="mt-6 max-w-3xl mx-auto">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">대화 난이도 선택</h3>
          <p className="text-sm text-gray-600 mb-4">{difficultyLabels[selectedDifficulty].description}</p>
          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((level) => (
              <button
                key={level}
                onClick={() => onDifficultyChange(level)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  selectedDifficulty === level
                    ? difficultyLabels[level].color + " border-current shadow-md scale-105"
                    : "bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
                data-testid={`difficulty-${level}`}
              >
                <div className="text-center">
                  <div className="text-2xl font-bold mb-1">{level}</div>
                  <div className={`text-sm font-medium ${
                    selectedDifficulty === level ? "" : "text-gray-600"
                  }`}>
                    {difficultyLabels[level].name}
                  </div>
                  {level === 4 && selectedDifficulty === level && (
                    <div className="mt-1">⭐</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 시나리오 상세 정보 */}
      {scenario && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* 상황 설명 */}
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-6">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">상황</h3>
                  <p className="text-sm text-gray-700 leading-relaxed">{scenario.context.situation}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-orange-200 space-y-2">
                <div className="flex items-start gap-2 text-sm">
                  <Clock className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700"><strong>타임라인:</strong> {scenario.context.timeline}</span>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <TrendingUp className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700"><strong>핵심 이슈:</strong> {scenario.context.stakes}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 나의 역할 */}
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <Users className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">나의 역할</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">직책:</span>
                      <span className="font-medium text-gray-900">{scenario.context.playerRole.position}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">부서:</span>
                      <span className="font-medium text-gray-900">{scenario.context.playerRole.department}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">경력:</span>
                      <span className="font-medium text-gray-900">{scenario.context.playerRole.experience}</span>
                    </div>
                    <div className="mt-4 pt-4 border-t border-blue-200">
                      <p className="text-gray-700 leading-relaxed">
                        <strong>책임:</strong> {scenario.context.playerRole.responsibility}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 목표 */}
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <Target className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">목표</h3>
                  <ul className="space-y-2">
                    {scenario.objectives.map((obj, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="text-green-600 mt-0.5 flex-shrink-0">✓</span>
                        <span>{obj}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 성공 기준 */}
          <Card className="border-purple-200 bg-purple-50">
            <CardContent className="p-6">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                <div className="w-full">
                  <h3 className="font-semibold text-gray-900 mb-3">성공 기준</h3>
                  <div className="space-y-2 text-sm">
                    <div className="bg-white rounded p-2 border border-purple-200">
                      <div className="font-medium text-green-700 mb-1">🏆 최적</div>
                      <div className="text-gray-700">{scenario.successCriteria.optimal}</div>
                    </div>
                    <div className="bg-white rounded p-2 border border-purple-200">
                      <div className="font-medium text-blue-700 mb-1">👍 양호</div>
                      <div className="text-gray-700">{scenario.successCriteria.good}</div>
                    </div>
                    <div className="bg-white rounded p-2 border border-purple-200">
                      <div className="font-medium text-yellow-700 mb-1">⚠️ 수용 가능</div>
                      <div className="text-gray-700">{scenario.successCriteria.acceptable}</div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 진행 상황 */}
      {completedCount > 0 && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-green-900 mb-2">
                  진행 상황: {completedCount}/{totalCount} 대화 완료
                </h3>
                <p className="text-green-700">
                  {availablePersonas.length > 0 
                    ? `${availablePersonas.length}명의 대화 상대가 남아있습니다.`
                    : '모든 대화가 완료되었습니다!'
                  }
                </p>
              </div>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <div className="text-2xl font-bold text-green-800">
                  {progressPercentage}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 안내 메시지 */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <MessageCircle className="w-6 h-6 text-blue-600 mt-1" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {completedCount === 0 
                  ? '대화 상대를 선택하세요'
                  : '다음 대화 상대를 선택하세요'
                }
              </h3>
              <p className="text-gray-700">
                아래 인물들 중 대화하고 싶은 상대를 선택하세요. 
                {totalCount >= 2 && ' 모든 대화가 끝나면 대화 순서에 대한 전략적 평가를 받을 수 있습니다.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 페르소나 목록 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {personas.map((persona) => {
          const isCompleted = completedPersonaIds.includes(persona.id);
          const isCurrentlyLoading = loadingPersonaId === persona.id;
          const isAvailable = !isCompleted && !isLoading;

          return (
            <Card 
              key={persona.id}
              className={`relative transition-all ${
                isCompleted 
                  ? 'border-green-300 bg-green-50 opacity-60' 
                  : isCurrentlyLoading
                  ? 'border-blue-400 bg-blue-50 shadow-lg'
                  : 'border-blue-200 hover:border-blue-400 hover:shadow-lg cursor-pointer'
              } ${isLoading && !isCurrentlyLoading ? 'opacity-50 pointer-events-none' : ''}`}
              onClick={() => isAvailable && !isCurrentlyLoading && onPersonaSelect(persona, selectedDifficulty)}
              data-testid={`persona-card-${persona.id}`}
            >
              <CardContent className="p-6">
                {isCompleted && (
                  <div className="absolute top-4 right-4">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                )}

                <div className="flex items-start gap-4 mb-4">
                  {/* 아바타 */}
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                    {persona.name.charAt(0)}
                  </div>

                  {/* 정보 */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg text-gray-900 mb-1">
                      {persona.name}
                    </h3>
                    <p className="text-sm text-gray-600 mb-2">
                      {persona.role}
                    </p>
                    {persona.department && (
                      <Badge variant="outline" className="text-xs mb-2">
                        {persona.department}
                      </Badge>
                    )}
                    {persona.mbti && (
                      <Badge variant="secondary" className="text-xs">
                        {persona.mbti}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* 페르소나 상세 정보 */}
                {(persona.stance || persona.goal || persona.tradeoff) && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm space-y-2">
                    {persona.stance && (
                      <div>
                        <span className="font-semibold text-gray-700">입장:</span>
                        <p className="text-gray-600 mt-1">{persona.stance}</p>
                      </div>
                    )}
                    {persona.goal && (
                      <div>
                        <span className="font-semibold text-gray-700">목표:</span>
                        <p className="text-gray-600 mt-1">{persona.goal}</p>
                      </div>
                    )}
                    {persona.tradeoff && (
                      <div>
                        <span className="font-semibold text-gray-700">트레이드오프:</span>
                        <p className="text-gray-600 mt-1">{persona.tradeoff}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 상태 표시 */}
                <div className="mt-4">
                  {isCompleted ? (
                    <Badge className="bg-green-100 text-green-800 w-full justify-center py-2">
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      대화 완료
                    </Badge>
                  ) : (
                    <Button 
                      className="w-full"
                      variant="default"
                      disabled={isLoading}
                      data-testid={`select-persona-${persona.id}`}
                    >
                      {isCurrentlyLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          대화 준비 중...
                        </>
                      ) : (
                        '대화 시작하기'
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
