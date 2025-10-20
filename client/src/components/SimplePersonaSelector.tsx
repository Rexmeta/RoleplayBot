import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Users, MessageCircle } from "lucide-react";
import { type ScenarioPersona } from "@/lib/scenario-system";

interface SimplePersonaSelectorProps {
  personas: ScenarioPersona[];
  completedPersonaIds: string[];
  onPersonaSelect: (persona: ScenarioPersona) => void;
  scenarioTitle: string;
  scenarioSituation?: string;
}

export function SimplePersonaSelector({
  personas,
  completedPersonaIds,
  onPersonaSelect,
  scenarioTitle,
  scenarioSituation
}: SimplePersonaSelectorProps) {
  const availablePersonas = personas.filter(p => !completedPersonaIds.includes(p.id));
  const completedCount = completedPersonaIds.length;
  const totalCount = personas.length;
  const progressPercentage = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{scenarioTitle}</h1>
        {scenarioSituation && (
          <p className="text-lg text-gray-600 mb-4">{scenarioSituation}</p>
        )}
      </div>

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
          const isAvailable = !isCompleted;

          return (
            <Card 
              key={persona.id}
              className={`relative transition-all ${
                isCompleted 
                  ? 'border-green-300 bg-green-50 opacity-60' 
                  : 'border-blue-200 hover:border-blue-400 hover:shadow-lg cursor-pointer'
              }`}
              onClick={() => isAvailable && onPersonaSelect(persona)}
              data-testid={`persona-card-${persona.id}`}
            >
              <CardContent className="p-6">
                {isCompleted && (
                  <div className="absolute top-4 right-4">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                )}

                <div className="flex items-start gap-4">
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
                  </div>
                </div>

                {/* 상태 표시 */}
                <div className="mt-4">
                  {isCompleted ? (
                    <Badge className="bg-green-100 text-green-800 w-full justify-center">
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      대화 완료
                    </Badge>
                  ) : (
                    <Button 
                      className="w-full"
                      variant="default"
                      data-testid={`select-persona-${persona.id}`}
                    >
                      대화 시작하기
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
