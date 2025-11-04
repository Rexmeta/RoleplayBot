import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ComplexScenario } from "@/lib/scenario-system";
import { 
  AlertCircle, 
  Target, 
  Users, 
  Clock, 
  TrendingUp, 
  Lightbulb, 
  ArrowLeft,
  MessageSquare 
} from "lucide-react";

interface ScenarioDetailProps {
  scenario: ComplexScenario;
  onStartConversation: () => void;
  onBack: () => void;
}

export default function ScenarioDetail({ scenario, onStartConversation, onBack }: ScenarioDetailProps) {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <Button 
          variant="ghost" 
          onClick={onBack}
          className="flex items-center gap-2"
          data-testid="back-to-scenarios"
        >
          <ArrowLeft className="w-4 h-4" />
          시나리오 목록으로
        </Button>
      </div>

      {/* 타이틀 섹션 */}
      <div className="text-center mb-8">
        <Badge className="mb-4" variant="outline">
          난이도 {scenario.difficulty} / 5 {scenario.difficulty >= 4 && '⭐'}
        </Badge>
        <h1 className="text-4xl font-bold text-gray-900 mb-4">{scenario.title}</h1>
        <p className="text-xl text-gray-600 mb-6 leading-relaxed max-w-4xl mx-auto">
          {scenario.description}
        </p>
        
        <div className="flex items-center justify-center gap-6 text-sm text-gray-600">
          {scenario.estimatedTime && (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>예상 소요 시간: {scenario.estimatedTime}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            <span>대화 상대: {scenario.personas?.length || 0}명</span>
          </div>
        </div>
      </div>

      {/* 메인 정보 그리드 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 상황 설명 */}
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-6">
            <div className="flex items-start gap-3 mb-3">
              <AlertCircle className="w-6 h-6 text-orange-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 mb-3">상황</h3>
                <p className="text-gray-700 leading-relaxed mb-4">{scenario.context.situation}</p>
              </div>
            </div>
            <div className="space-y-3 pl-9">
              <div className="flex items-start gap-2">
                <Clock className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-gray-800 mb-1">타임라인</p>
                  <p className="text-gray-700">{scenario.context.timeline}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-gray-800 mb-1">핵심 이슈</p>
                  <p className="text-gray-700">{scenario.context.stakes}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 나의 역할 */}
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <Users className="w-6 h-6 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">나의 역할</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-2 bg-white rounded">
                    <span className="text-gray-600">직책:</span>
                    <span className="font-semibold text-gray-900">{scenario.context.playerRole.position}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-white rounded">
                    <span className="text-gray-600">부서:</span>
                    <span className="font-semibold text-gray-900">{scenario.context.playerRole.department}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-white rounded">
                    <span className="text-gray-600">경력:</span>
                    <span className="font-semibold text-gray-900">{scenario.context.playerRole.experience}</span>
                  </div>
                  <div className="mt-4 pt-4 border-t border-blue-200">
                    <p className="font-semibold text-gray-800 mb-2">책임</p>
                    <p className="text-gray-700 leading-relaxed">
                      {scenario.context.playerRole.responsibility}
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
              <Target className="w-6 h-6 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">목표</h3>
                <ul className="space-y-3">
                  {scenario.objectives.map((obj, index) => (
                    <li key={index} className="flex items-start gap-3 p-3 bg-white rounded">
                      <span className="text-green-600 font-bold flex-shrink-0 mt-0.5">{index + 1}.</span>
                      <span className="text-gray-700 leading-relaxed">{obj}</span>
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
              <Lightbulb className="w-6 h-6 text-purple-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">성공 기준</h3>
                <div className="space-y-3">
                  <div className="bg-white rounded-lg p-4 border-l-4 border-green-500">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">🏆</span>
                      <span className="font-semibold text-green-700">최적</span>
                    </div>
                    <p className="text-gray-700 leading-relaxed">{scenario.successCriteria.optimal}</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 border-l-4 border-blue-500">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">👍</span>
                      <span className="font-semibold text-blue-700">양호</span>
                    </div>
                    <p className="text-gray-700 leading-relaxed">{scenario.successCriteria.good}</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 border-l-4 border-yellow-500">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">⚠️</span>
                      <span className="font-semibold text-yellow-700">수용 가능</span>
                    </div>
                    <p className="text-gray-700 leading-relaxed">{scenario.successCriteria.acceptable}</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 필요 역량 */}
      {scenario.skills && scenario.skills.length > 0 && (
        <Card className="border-indigo-200 bg-indigo-50">
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">이 시나리오에서 개발할 수 있는 역량</h3>
            <div className="flex flex-wrap gap-2">
              {scenario.skills.map((skill, index) => (
                <Badge key={index} variant="secondary" className="text-sm px-3 py-1">
                  {skill}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 대화 시작 버튼 */}
      <div className="flex justify-center pt-8 pb-4">
        <Button 
          onClick={onStartConversation}
          size="lg"
          className="text-lg px-12 py-6 bg-blue-600 hover:bg-blue-700"
          data-testid="start-conversation-button"
        >
          <MessageSquare className="w-5 h-5 mr-2" />
          대화 시작하기
        </Button>
      </div>
    </div>
  );
}
