import type { ConversationMessage } from "@shared/schema";

// ElevenLabs TTS 서비스
export class ElevenLabsService {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // 페르소나별 음성 ID 매핑 (한국어 최적화된 음성들)
  private getVoiceId(scenarioId: string, gender: 'male' | 'female'): string {
    const voiceMap = {
      // 남성 페르소나 (한국어에 적합한 음성)
      communication: 'onwK4e9ZLuTAKqWW03F9', // Daniel - 차분하고 전문적인 남성 목소리
      negotiation: 'Yko7PKHZNXotIFUBG7I9', // Callum - 자신감 있고 설득력 있는 남성 목소리  
      feedback: 'IKne3meq5aSn9XLyUdCD', // Charlie - 친근하고 부드러운 남성 목소리
      
      // 여성 페르소나 (한국어에 적합한 음성)
      empathy: 'XrExE9yKIg1WjnnlVkGX', // Matilda - 따뜻하고 공감적인 여성 목소리
      presentation: 'pFZP5JQG7iQjIQuC4Bku', // Lily - 명확하고 전문적인 여성 목소리
      crisis: 'XB0fDUnXU5powFXDhCwa', // Charlotte - 침착하고 안정적인 여성 목소리
    };

    return voiceMap[scenarioId as keyof typeof voiceMap] || voiceMap.communication;
  }

  // 감정에 따른 음성 설정 (Flash v2.5 최적화 - 속도 우선)
  private getVoiceSettings(emotion: string = '중립') {
    const emotionSettings = {
      '기쁨': { stability: 0.5, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true },
      '슬픔': { stability: 0.8, similarity_boost: 0.7, style: 0.3, use_speaker_boost: false },
      '분노': { stability: 0.3, similarity_boost: 0.9, style: 0.8, use_speaker_boost: true },
      '놀람': { stability: 0.2, similarity_boost: 0.8, style: 0.9, use_speaker_boost: true },
      '중립': { stability: 0.5, similarity_boost: 0.8, style: 0.5, use_speaker_boost: true }
    };

    return emotionSettings[emotion as keyof typeof emotionSettings] || emotionSettings['중립'];
  }

  // 텍스트를 음성으로 변환
  async generateSpeech(
    text: string, 
    scenarioId: string, 
    gender: 'male' | 'female', 
    emotion: string = '중립'
  ): Promise<ArrayBuffer> {
    const voiceId = this.getVoiceId(scenarioId, gender);
    const voiceSettings = this.getVoiceSettings(emotion);

    console.log(`🎤 ElevenLabs Flash v2.5 TTS 요청: ${scenarioId} (${gender}) - ${emotion}`);
    console.log(`음성 ID: ${voiceId}, 모델: eleven_flash_v2_5 (초고속)`);

    const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_flash_v2_5', // Flash v2.5 - 초고속 75ms 지연시간, 실시간 대화에 최적화
        voice_settings: voiceSettings
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API 오류: ${response.status} - ${errorText}`);
    }

    return await response.arrayBuffer();
  }

  // 사용 가능한 음성 목록 조회
  async getAvailableVoices() {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`음성 목록 조회 실패: ${response.status}`);
    }

    return await response.json();
  }

  // 사용량 정보 조회
  async getUsage() {
    const response = await fetch(`${this.baseUrl}/user/subscription`, {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`사용량 조회 실패: ${response.status}`);
    }

    return await response.json();
  }
}

// ElevenLabs 서비스 인스턴스 생성
export const elevenLabsService = new ElevenLabsService(process.env.ELEVENLABS_API_KEY || '');