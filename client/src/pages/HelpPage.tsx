import { Link } from "wouter";
import { ArrowLeft, MessageSquare, Mic, BarChart3, FileText, HelpCircle, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/home">
            <Button variant="ghost" size="icon" data-testid="button-back-home">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold text-slate-800">도움말</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-2">AI 롤플레잉 훈련 시스템 가이드</h2>
          <p className="text-slate-600">
            효과적인 커뮤니케이션 역량 향상을 위한 AI 기반 대화 훈련 시스템입니다.
          </p>
        </div>

        <div className="grid gap-6 mb-8">
          <Card data-testid="card-help-start">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-blue-600" />
                시작하기
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium shrink-0">1</div>
                <div>
                  <p className="font-medium text-slate-800">시나리오 선택</p>
                  <p className="text-sm text-slate-600">홈 화면에서 원하는 훈련 시나리오를 선택하세요. 각 시나리오는 실제 업무 상황을 기반으로 구성되어 있습니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium shrink-0">2</div>
                <div>
                  <p className="font-medium text-slate-800">대화 상대 선택</p>
                  <p className="text-sm text-slate-600">시나리오에 등장하는 AI 캐릭터를 선택하세요. 각 캐릭터는 고유한 성격과 대화 스타일을 가지고 있습니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium shrink-0">3</div>
                <div>
                  <p className="font-medium text-slate-800">난이도 선택</p>
                  <p className="text-sm text-slate-600">4단계 난이도 중 하나를 선택하세요. 난이도에 따라 AI 캐릭터의 반응 방식이 달라집니다.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-medium shrink-0">4</div>
                <div>
                  <p className="font-medium text-slate-800">대화 시작</p>
                  <p className="text-sm text-slate-600">AI 캐릭터와 10턴의 대화를 진행하세요. 텍스트 입력 또는 음성으로 대화할 수 있습니다.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-help-conversation">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5 text-green-600" />
                대화 모드
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="font-medium text-slate-800 mb-1">텍스트 모드</p>
                <p className="text-sm text-slate-600">키보드로 메시지를 입력하여 대화합니다. AI의 응답은 텍스트로 표시됩니다.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="font-medium text-slate-800 mb-1">음성 모드 (TTS)</p>
                <p className="text-sm text-slate-600">텍스트로 입력하면 AI가 음성으로 응답합니다. 캐릭터에 따라 다른 목소리가 적용됩니다.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="font-medium text-slate-800 mb-1">실시간 음성 대화</p>
                <p className="text-sm text-slate-600">마이크를 사용하여 AI와 직접 음성으로 대화합니다. 실제 대화하듯 자연스럽게 소통할 수 있습니다.</p>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-help-feedback">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-purple-600" />
                피드백 받기
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-slate-600">
                10턴의 대화가 완료되면 AI가 대화 내용을 분석하여 상세한 피드백을 제공합니다.
              </p>
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span><strong>종합 점수:</strong> 대화 품질에 대한 전반적인 평가</span>
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span><strong>카테고리별 분석:</strong> 경청, 공감, 명확성 등 항목별 평가</span>
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span><strong>개선 포인트:</strong> 더 나은 대화를 위한 구체적 제안</span>
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span><strong>잘한 점:</strong> 대화에서 효과적이었던 부분 강조</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-help-mypage">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-orange-600" />
                마이페이지
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-slate-600">
                마이페이지에서 훈련 기록과 성장 추이를 확인할 수 있습니다.
              </p>
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span>완료한 대화 히스토리 조회</span>
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span>시나리오별 점수 변화 추이</span>
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span>항목별 역량 분석</span>
                </li>
                <li className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                  <span>과거 피드백 다시 확인</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card data-testid="card-help-faq">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-slate-600" />
              자주 묻는 질문
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>대화를 중간에 그만둬도 되나요?</AccordionTrigger>
                <AccordionContent>
                  네, 가능합니다. 중단된 대화는 히스토리에 저장되어 나중에 이어서 진행하거나 확인할 수 있습니다.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>음성 대화가 잘 안 될 때는 어떻게 하나요?</AccordionTrigger>
                <AccordionContent>
                  브라우저에서 마이크 권한을 허용했는지 확인해주세요. 조용한 환경에서 마이크에 가까이 대고 말씀하시면 인식률이 높아집니다. 문제가 지속되면 텍스트 모드를 사용해주세요.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>난이도는 어떻게 다른가요?</AccordionTrigger>
                <AccordionContent>
                  난이도가 높을수록 AI 캐릭터가 더 까다롭게 반응하고, 요구사항이 많아지며, 대화 상황이 복잡해집니다. 처음에는 낮은 난이도로 시작해서 점차 높여가는 것을 권장합니다.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger>피드백 점수는 어떻게 산정되나요?</AccordionTrigger>
                <AccordionContent>
                  AI가 대화 내용을 분석하여 경청, 공감, 명확성, 문제해결력 등 여러 항목을 평가합니다. 각 항목의 점수를 종합하여 100점 만점으로 환산됩니다.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-5">
                <AccordionTrigger>같은 시나리오를 여러 번 할 수 있나요?</AccordionTrigger>
                <AccordionContent>
                  네, 횟수 제한 없이 반복할 수 있습니다. 같은 시나리오라도 매번 다른 대화가 진행되므로 다양한 접근법을 연습해볼 수 있습니다.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <Link href="/home">
            <Button variant="outline" data-testid="button-back-to-home">
              <ArrowLeft className="h-4 w-4 mr-2" />
              홈으로 돌아가기
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
