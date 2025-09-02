import type { ConversationMessage } from "@shared/schema";

// ElevenLabs TTS 서비스
export class ElevenLabsService {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // 페르소나별 음성 ID 매핑 (ElevenLabs 사전 정의된 음성들)
  private getVoiceId(scenarioId: string, gender: 'male' | 'female'): string {
    const voiceMap = {
      // 남성 페르소나
      communication: 'pNInz6obpgDQGcFmaJgB', // Adam - 성숙하고 안정적인 남성 목소리
      negotiation: '5Q0t7uMcjvnagumLfvZi', // Sam - 자신감 있는 남성 목소리  
      feedback: 'VR6AewLTigWG4xSOukaG', // Josh - 젊고 친근한 남성 목소리
      
      // 여성 페르소나
      empathy: 'EXAVITQu4vr4xnSDxMaL', // Bella - 따뜻하고 공감적인 여성 목소리
      presentation: 'ThT5KcBeYPX3keUQqHPh', // Dorothy - 전문적이고 명확한 여성 목소리
    };

    return voiceMap[scenarioId as keyof typeof voiceMap] || voiceMap.communication;
  }

  // 감정에 따른 음성 설정 (Eleven v3 최적화)
  private getVoiceSettings(emotion: string = '중립') {
    const emotionSettings = {
      '기쁨': { stability: 0.0, similarity_boost: 0.9, style: 0.7, use_speaker_boost: true },
      '슬픔': { stability: 1.0, similarity_boost: 0.6, style: 0.3, use_speaker_boost: false },
      '분노': { stability: 0.0, similarity_boost: 1.0, style: 0.9, use_speaker_boost: true },
      '놀람': { stability: 0.0, similarity_boost: 0.8, style: 1.0, use_speaker_boost: true },
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

    console.log(`🎤 ElevenLabs v3 TTS 요청: ${scenarioId} (${gender}) - ${emotion}`);
    console.log(`음성 ID: ${voiceId}, 모델: eleven_v3`);

    const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_v3', // 최신 v3 모델 - 가장 감정적으로 풍부하고 표현력 뛰어남
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