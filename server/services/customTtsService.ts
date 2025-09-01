// 커스텀 TTS 서비스 (Google Colab XTTS-v2 서버)
export class CustomTtsService {
  private apiUrl: string;
  private apiKey: string;

  constructor(apiUrl: string, apiKey: string) {
    this.apiUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    this.apiKey = apiKey;
  }

  // 페르소나별 스피커 음성 파일 매핑
  private getSpeakerWav(scenarioId: string, gender: 'male' | 'female'): string {
    const speakerMap = {
      // 남성 페르소나
      communication: './XTTS-v2/speakers/male_professional.wav', // 김태훈 - 전문적인 남성
      negotiation: './XTTS-v2/speakers/male_confident.wav',      // 박준호 - 자신감 있는 남성  
      feedback: './XTTS-v2/speakers/male_friendly.wav',          // 최민수 - 친근한 남성
      
      // 여성 페르소나
      empathy: './XTTS-v2/speakers/female_warm.wav',             // 이선영 - 따뜻한 여성
      presentation: './XTTS-v2/speakers/female_professional.wav' // 정미경 - 전문적인 여성
    };

    // 기본 파일로 폴백
    const defaultFiles = {
      male: './XTTS-v2/male.wav',
      female: './XTTS-v2/female.wav'
    };

    return speakerMap[scenarioId as keyof typeof speakerMap] || defaultFiles[gender];
  }

  // 감정에 따른 텍스트 전처리 (톤 조절)
  private preprocessTextForEmotion(text: string, emotion: string = '중립'): string {
    const emotionPrefixes = {
      '기쁨': '기쁘고 밝은 톤으로: ',
      '슬픔': '조금 슬프고 차분한 톤으로: ',
      '분노': '단호하고 강한 톤으로: ',
      '놀람': '놀란 톤으로: ',
      '중립': ''
    };

    const prefix = emotionPrefixes[emotion as keyof typeof emotionPrefixes] || '';
    return prefix + text;
  }

  // 텍스트를 음성으로 변환
  async generateSpeech(
    text: string, 
    scenarioId: string, 
    gender: 'male' | 'female', 
    emotion: string = '중립'
  ): Promise<ArrayBuffer> {
    const speakerWav = this.getSpeakerWav(scenarioId, gender);
    const processedText = this.preprocessTextForEmotion(text, emotion);

    console.log(`🎤 커스텀 TTS 요청: ${scenarioId} (${gender}) - ${emotion}`);
    console.log(`스피커 파일: ${speakerWav}`);
    console.log(`처리된 텍스트: ${processedText.substring(0, 50)}...`);

    try {
      const response = await fetch(`${this.apiUrl}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'TTS_API_KEY': this.apiKey,
        },
        body: JSON.stringify({
          text: processedText,
          speaker_wav: speakerWav
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`커스텀 TTS API 오류: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(`TTS 생성 실패: ${result.message || '알 수 없는 오류'}`);
      }

      // Base64 오디오 데이터를 ArrayBuffer로 변환
      const audioData = atob(result.audio);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const uint8Array = new Uint8Array(arrayBuffer);
      
      for (let i = 0; i < audioData.length; i++) {
        uint8Array[i] = audioData.charCodeAt(i);
      }

      console.log(`✅ TTS 생성 성공 (${arrayBuffer.byteLength} bytes)`);
      return arrayBuffer;

    } catch (error) {
      console.error('커스텀 TTS 요청 실패:', error);
      throw error;
    }
  }

  // 서버 상태 확인
  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${this.apiUrl}/health`, {
        method: 'GET',
        headers: {
          'TTS_API_KEY': this.apiKey,
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      return response.ok;
    } catch (error) {
      console.error('커스텀 TTS 서버 상태 확인 실패:', error);
      return false;
    }
  }

  // 사용 가능한 스피커 목록 조회 (선택사항)
  async getAvailableSpeakers() {
    try {
      const response = await fetch(`${this.apiUrl}/speakers`, {
        headers: {
          'TTS_API_KEY': this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`스피커 목록 조회 실패: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('스피커 목록 조회 오류:', error);
      return { speakers: [] };
    }
  }
}

// 커스텀 TTS 서비스 인스턴스 생성
export const customTtsService = new CustomTtsService(
  process.env.CUSTOM_TTS_URL || '',
  process.env.CUSTOM_TTS_API_KEY || ''
);