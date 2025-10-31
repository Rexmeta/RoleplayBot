import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mic, MessageSquare, ArrowLeft } from "lucide-react";

interface ModeSelectorProps {
  scenarioTitle: string;
  personaName: string;
  onModeSelect: (mode: "realtime_voice" | "text_tts") => void;
  onBack: () => void;
}

export function ModeSelector({
  scenarioTitle,
  personaName,
  onModeSelect,
  onBack,
}: ModeSelectorProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <Button
        onClick={onBack}
        variant="ghost"
        className="mb-6"
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        뒤로 가기
      </Button>

      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          대화 모드 선택
        </h2>
        <p className="text-slate-600">
          {scenarioTitle} - {personaName}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* 실시간 음성 모드 */}
        <Card
          className="p-8 hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-corporate-500"
          onClick={() => onModeSelect("realtime_voice")}
          data-testid="card-mode-realtime-voice"
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-corporate-500 to-corporate-600 rounded-2xl flex items-center justify-center mb-6">
              <Mic className="w-10 h-10 text-white" />
            </div>
            
            <h3 className="text-xl font-bold text-slate-900 mb-3">
              🎤 실시간 음성 대화
            </h3>
            
            <p className="text-slate-600 mb-6">
              실제 대화처럼 자연스러운 음성으로 AI와 대화합니다
            </p>
            
            <ul className="text-sm text-slate-700 space-y-2 mb-6">
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>양방향 실시간 음성 대화</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>자연스러운 목소리와 억양</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>실전 같은 몰입감</span>
              </li>
            </ul>
            
            <Button
              className="w-full bg-corporate-600 hover:bg-corporate-700"
              data-testid="button-select-realtime-voice"
            >
              실시간 음성으로 시작하기
            </Button>
          </div>
        </Card>

        {/* 텍스트/TTS 채팅 모드 */}
        <Card
          className="p-8 hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-blue-500"
          onClick={() => onModeSelect("text_tts")}
          data-testid="card-mode-text-tts"
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mb-6">
              <MessageSquare className="w-10 h-10 text-white" />
            </div>
            
            <h3 className="text-xl font-bold text-slate-900 mb-3">
              💬 텍스트/음성 채팅
            </h3>
            
            <p className="text-slate-600 mb-6">
              텍스트로 입력하고 음성 또는 텍스트로 응답받습니다
            </p>
            
            <ul className="text-sm text-slate-700 space-y-2 mb-6">
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>편안한 텍스트 입력</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>TTS 음성 응답 선택 가능</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                <span>천천히 생각하며 대화</span>
              </li>
            </ul>
            
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              data-testid="button-select-text-tts"
            >
              텍스트 채팅으로 시작하기
            </Button>
          </div>
        </Card>
      </div>

      <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-sm text-amber-800">
          <strong>💡 팁:</strong> 실시간 음성은 실전 연습에 최적이며, 텍스트 채팅은 생각을 정리하며 연습하기 좋습니다.
        </p>
      </div>
    </div>
  );
}
