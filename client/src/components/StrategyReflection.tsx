import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, MessageSquare, Lightbulb, ArrowRight } from "lucide-react";
import { type ScenarioPersona } from "@/lib/scenario-system";

interface StrategyReflectionProps {
  personas: ScenarioPersona[];
  completedPersonaIds: string[];
  onSubmit: (reflection: string) => void;
  scenarioTitle: string;
}

export function StrategyReflection({
  personas,
  completedPersonaIds,
  onSubmit,
  scenarioTitle
}: StrategyReflectionProps) {
  const [reflection, setReflection] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 대화 순서대로 페르소나 정렬
  const completedPersonas = completedPersonaIds.map(id => 
    personas.find(p => p.id === id)
  ).filter(p => p !== undefined) as ScenarioPersona[];

  const handleSubmit = async () => {
    if (!reflection.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(reflection.trim());
    } catch (error) {
      console.error('전략 회고 제출 실패:', error);
      setIsSubmitting(false);
    }
  };

  const isValid = reflection.trim().length >= 50; // 최소 50자 이상

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">대화 전략 회고</h1>
        <p className="text-lg text-gray-600">
          {scenarioTitle}에서의 대화 순서와 전략을 되돌아봅니다
        </p>
      </div>

      {/* 완료된 대화 순서 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            대화 순서
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {completedPersonas.map((persona, index) => (
              <div 
                key={persona.id} 
                className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg"
                data-testid={`completed-conversation-${index}`}
              >
                <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0">
                  {index + 1}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{persona.name}</h3>
                  <p className="text-sm text-gray-600">{persona.role}</p>
                </div>
                {index < completedPersonas.length - 1 && (
                  <ArrowRight className="w-5 h-5 text-gray-400" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 전략 이유 입력 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            대화 순서를 이렇게 정한 이유
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Textarea
              placeholder="이 순서로 대화를 진행한 이유와 전략을 자세히 작성해주세요. (최소 50자)"
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              className="min-h-[200px] text-base"
              data-testid="strategy-reflection-input"
            />
            <p className="text-sm text-gray-500 mt-2">
              {reflection.length}/50자 {isValid ? '✓' : '(최소 50자 이상 작성해주세요)'}
            </p>
          </div>

          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-900">
                  <p className="font-semibold mb-2">작성 팁:</p>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>처음에 누구와 대화한 이유는 무엇인가요?</li>
                    <li>다음 대화 상대를 선택한 기준은 무엇인가요?</li>
                    <li>이 순서가 목표 달성에 어떻게 도움이 된다고 생각하나요?</li>
                    <li>다시 한다면 어떤 순서로 진행할 것인가요?</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      {/* 제출 버튼 */}
      <div className="flex justify-end gap-3">
        <Button
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
          className="bg-blue-600 hover:bg-blue-700"
          size="lg"
          data-testid="submit-reflection-button"
        >
          {isSubmitting ? '제출 중...' : '전략 평가 받기'}
        </Button>
      </div>
    </div>
  );
}
