import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";
import { useToast } from "@/hooks/use-toast";
import { Mic, MicOff, Volume2, PhoneOff } from "lucide-react";

interface VoiceChatWindowProps {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  onChatComplete: () => void;
  onExit: () => void;
}

export default function VoiceChatWindow({
  scenario,
  persona,
  conversationId,
  onChatComplete,
  onExit,
}: VoiceChatWindowProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const { toast } = useToast();

  const realtimeVoice = useRealtimeVoice({
    conversationId,
    scenarioId: scenario.id,
    personaId: persona.id,
    enabled: true,
    onMessage: (message) => {
      console.log('🎙️ Received realtime voice message:', message);
    },
    onError: (error) => {
      toast({
        title: "음성 연결 오류",
        description: error,
        variant: "destructive"
      });
    },
    onSessionTerminated: (reason) => {
      toast({
        title: "음성 세션 종료",
        description: reason,
      });
      onExit();
    },
  });

  // 시간 추적
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 자동 연결
  useEffect(() => {
    if (realtimeVoice.status === 'disconnected') {
      realtimeVoice.connect();
    }
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-corporate-50 via-white to-blue-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <img 
              src={persona.image} 
              alt={persona.name} 
              className="w-12 h-12 rounded-full border-2 border-corporate-500" 
            />
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {persona.name}와의 실시간 음성 대화
              </h3>
              <p className="text-sm text-slate-600">{scenario.title}</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-slate-600">
              ⏱️ {formatTime(elapsedTime)}
            </div>
            <Button
              variant="outline"
              onClick={onExit}
              data-testid="button-exit"
            >
              <PhoneOff className="w-4 h-4 mr-2" />
              종료
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <Card className="w-full max-w-2xl p-8">
          <div className="flex flex-col items-center space-y-8">
            {/* Persona Avatar */}
            <div className="relative">
              <img 
                src={persona.image} 
                alt={persona.name} 
                className="w-48 h-48 rounded-full border-4 border-corporate-500 shadow-lg" 
              />
              {realtimeVoice.isAISpeaking && (
                <div className="absolute inset-0 rounded-full border-4 border-blue-500 animate-ping"></div>
              )}
            </div>

            {/* Status */}
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">{persona.name}</h2>
              <p className="text-slate-600">
                {realtimeVoice.status === 'connecting' && '🔄 연결 중...'}
                {realtimeVoice.status === 'connected' && !realtimeVoice.isAISpeaking && !realtimeVoice.isRecording && '✅ 대화 준비 완료'}
                {realtimeVoice.isAISpeaking && (
                  <span className="flex items-center justify-center space-x-2 text-blue-600 font-medium animate-pulse">
                    <Volume2 className="w-5 h-5" />
                    <span>AI가 말하고 있습니다...</span>
                  </span>
                )}
                {realtimeVoice.isRecording && (
                  <span className="flex items-center justify-center space-x-2 text-red-600 font-medium">
                    <span className="inline-block w-2 h-2 bg-red-600 rounded-full animate-ping"></span>
                    <span>녹음 중...</span>
                  </span>
                )}
                {realtimeVoice.status === 'disconnected' && '❌ 연결 끊김'}
                {realtimeVoice.status === 'error' && `⚠️ ${realtimeVoice.error || '오류 발생'}`}
              </p>
            </div>

            {/* Voice Control Button */}
            <div className="relative">
              {realtimeVoice.isAISpeaking && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-40 h-40 rounded-full border-4 border-blue-400 animate-ping opacity-75"></div>
                </div>
              )}
              {realtimeVoice.isRecording && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-40 h-40 rounded-full border-4 border-red-400 animate-pulse"></div>
                </div>
              )}
              
              <button
                onClick={() => {
                  if (realtimeVoice.isRecording) {
                    realtimeVoice.stopRecording();
                  } else {
                    realtimeVoice.startRecording();
                  }
                }}
                disabled={realtimeVoice.status !== 'connected'}
                className={`
                  w-32 h-32 rounded-full flex items-center justify-center
                  transition-all duration-300 shadow-2xl
                  ${realtimeVoice.status !== 'connected' 
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                    : realtimeVoice.isRecording
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : realtimeVoice.isAISpeaking
                    ? 'bg-blue-500 text-white'
                    : 'bg-corporate-600 hover:bg-corporate-700 text-white'}
                `}
                data-testid="button-voice-control"
              >
                {realtimeVoice.isRecording ? (
                  <MicOff className="w-12 h-12" />
                ) : realtimeVoice.isAISpeaking ? (
                  <Volume2 className="w-12 h-12" />
                ) : (
                  <Mic className="w-12 h-12" />
                )}
              </button>
            </div>

            {/* Instructions */}
            <div className="text-center space-y-1 text-sm text-slate-600">
              <p>🎤 버튼을 눌러 말씀하세요</p>
              <p>다시 눌러 녹음을 중지하세요</p>
            </div>

            {/* Connection Info */}
            {realtimeVoice.status === 'error' && (
              <div className="w-full p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800 text-center">
                  {realtimeVoice.error}
                </p>
                <Button
                  onClick={() => realtimeVoice.connect()}
                  className="w-full mt-2"
                  variant="outline"
                  data-testid="button-reconnect"
                >
                  재연결
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Scenario Info */}
        <div className="mt-8 max-w-2xl w-full grid md:grid-cols-2 gap-4">
          <Card className="p-4">
            <h4 className="font-semibold text-slate-900 mb-2">🎯 대화 목표</h4>
            <ul className="text-sm text-slate-700 space-y-1">
              {scenario.objectives?.slice(0, 3).map((obj, idx) => (
                <li key={idx} className="flex items-start">
                  <span className="text-corporate-600 mr-2">•</span>
                  <span>{obj}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-4">
            <h4 className="font-semibold text-slate-900 mb-2">👤 상대방 정보</h4>
            <div className="text-sm text-slate-700 space-y-1">
              <p><strong>이름:</strong> {persona.name}</p>
              <p><strong>역할:</strong> {persona.role}</p>
              <p><strong>부서:</strong> {persona.department}</p>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
