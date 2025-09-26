// Landing page for non-authenticated users - from javascript_log_in_with_replit blueprint
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Users, Target, Lightbulb } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-4xl mx-auto text-center space-y-8">
        {/* 헤더 섹션 */}
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3 mb-6">
            <Brain className="w-12 h-12 text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-900">
              AI 롤플레이 커뮤니케이션 트레이닝
            </h1>
          </div>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            현실적인 직장 시나리오에서 AI와 대화하며 커뮤니케이션 스킬을 개발하세요. 
            실시간 피드백과 전략적 분석으로 더 나은 소통 능력을 기르실 수 있습니다.
          </p>
        </div>

        {/* 특징 카드들 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-blue-200 bg-white/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-800">
                <Users className="w-5 h-5" />
                다양한 페르소나
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                팀장, 동료, 고객, 임원 등 다양한 역할의 AI 페르소나와 
                실제와 같은 상황에서 대화 연습을 할 수 있습니다.
              </p>
            </CardContent>
          </Card>

          <Card className="border-purple-200 bg-white/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-800">
                <Target className="w-5 h-5" />
                전략적 대화 계획
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                대화 순서를 미리 계획하고 각 상대방에게 맞는 
                최적의 커뮤니케이션 전략을 수립할 수 있습니다.
              </p>
            </CardContent>
          </Card>

          <Card className="border-green-200 bg-white/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-800">
                <Lightbulb className="w-5 h-5" />
                실시간 분석
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                대화 중 실시간으로 감정 분석과 점수를 제공하며, 
                완료 후 종합적인 피드백 리포트를 받을 수 있습니다.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 로그인 버튼 */}
        <div className="space-y-4">
          <Button 
            onClick={() => window.location.href = '/api/login'}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 text-lg"
            data-testid="login-button"
          >
            시작하기
          </Button>
          <p className="text-sm text-gray-500">
            Google, GitHub, Apple 또는 이메일로 간편하게 로그인하세요
          </p>
        </div>

        {/* 데모 섹션 */}
        <div className="mt-12 p-6 bg-white/30 backdrop-blur-sm rounded-lg border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            💡 이런 상황에서 연습하세요
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
            <div>• 어려운 요청을 동료에게 전달하기</div>
            <div>• 프로젝트 지연 상황 보고하기</div>
            <div>• 팀원과의 의견 차이 조율하기</div>
            <div>• 상급자에게 아이디어 제안하기</div>
          </div>
        </div>
      </div>
    </div>
  );
}