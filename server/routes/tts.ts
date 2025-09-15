import { Router } from 'express';
import { customTtsService } from '../services/customTtsService.js';
import { elevenLabsService } from '../services/elevenlabsService.js';
import { FileManagerService } from '../services/fileManager.js';

const router = Router();
const fileManager = new FileManagerService();

// 페르소나 타입 정의
interface PersonaData {
  id: string;
  name: string;
  gender?: 'male' | 'female';
  [key: string]: any;
}

// 페르소나 ID로부터 성별 정보 조회 (시나리오 JSON 파일에서 실제 데이터 활용)
async function getPersonaGender(personaId: string): Promise<'male' | 'female'> {
  try {
    // 모든 시나리오에서 해당 persona 찾기
    const scenarios = await fileManager.getAllScenarios();
    
    for (const scenario of scenarios) {
      if (scenario.personas && Array.isArray(scenario.personas)) {
        const personas = scenario.personas as unknown as PersonaData[];
        const persona = personas.find((p: PersonaData) => p.id === personaId);
        if (persona && persona.gender) {
          console.log(`👤 성별 찾음: ${personaId} (${persona.name}) → ${persona.gender}`);
          return persona.gender;
        }
      }
    }
    
    // 백업: MBTI 기반 하드코딩된 성별 판단
    const femaleMBTI = ['isfj', 'infp', 'isfp', 'infj'];
    const isFemale = femaleMBTI.includes(personaId.toLowerCase());
    const gender = isFemale ? 'female' : 'male';
    
    console.log(`👤 백업 성별 판단: ${personaId} → ${gender} (하드코딩됨)`);
    return gender;
    
  } catch (error) {
    console.error('성별 조회 오류:', error);
    // 최종 백업: 기본값
    return 'male';
  }
}

// TTS 음성 생성 API
router.post('/generate', async (req, res) => {
  try {
    const { text, scenarioId, emotion = '중립' } = req.body;

    if (!text || !scenarioId) {
      return res.status(400).json({ 
        error: '텍스트와 시나리오 ID가 필요합니다.' 
      });
    }

    // 텍스트 정리 (HTML 태그, 특수 문자 제거)
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/[*#_`]/g, '').trim();
    
    if (!cleanText) {
      return res.status(400).json({ 
        error: '유효한 텍스트가 없습니다.' 
      });
    }

    const gender = await getPersonaGender(scenarioId);
    
    console.log(`TTS 요청: "${cleanText.substring(0, 50)}..." (${scenarioId}, ${gender}, ${emotion})`);

    let audioBuffer: ArrayBuffer;
    let ttsProvider = 'custom';

    try {
      // 먼저 ElevenLabs API 시도 (안정성 우선)
      audioBuffer = await elevenLabsService.generateSpeech(
        cleanText, 
        scenarioId, 
        gender, 
        emotion
      );
      ttsProvider = 'elevenlabs';
      console.log('✅ ElevenLabs TTS 사용');
    } catch (elevenLabsError) {
      console.warn('⚠️ ElevenLabs TTS 실패, 커스텀 TTS로 폴백:', elevenLabsError);
      
      try {
        // 백업: 커스텀 TTS 서버 시도
        audioBuffer = await customTtsService.generateSpeech(
          cleanText, 
          scenarioId, 
          gender, 
          emotion
        );
        ttsProvider = 'custom';
        console.log('✅ 커스텀 TTS 사용 (백업)');
      } catch (customError) {
        console.error('⚠️ 모든 TTS 서비스 실패:', { elevenLabsError, customError });
        
        // 최종 백업: 텍스트만 반환 (클라이언트에서 Web Speech API 사용)
        throw new Error('TTS 서비스를 사용할 수 없습니다. 브라우저 음성 합성을 사용해주세요.');
      }
    }

    // 오디오 데이터를 Base64로 인코딩해서 반환
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    res.json({
      success: true,
      audio: base64Audio,
      metadata: {
        scenarioId,
        gender,
        emotion,
        textLength: cleanText.length,
        provider: ttsProvider
      }
    });

  } catch (error) {
    console.error('TTS 생성 오류:', error);
    
    // ElevenLabs API 에러인 경우 구체적인 에러 메시지 전달
    if (error instanceof Error) {
      res.status(500).json({ 
        error: 'TTS 생성 실패', 
        details: error.message 
      });
    } else {
      res.status(500).json({ 
        error: 'TTS 생성 중 알 수 없는 오류가 발생했습니다.' 
      });
    }
  }
});

// 사용 가능한 음성 목록 조회
router.get('/voices', async (req, res) => {
  try {
    const voices = await elevenLabsService.getAvailableVoices();
    res.json(voices);
  } catch (error) {
    console.error('음성 목록 조회 오류:', error);
    res.status(500).json({ 
      error: '음성 목록 조회 실패',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    });
  }
});

// 사용량 정보 조회
router.get('/usage', async (req, res) => {
  try {
    const usage = await elevenLabsService.getUsage();
    res.json(usage);
  } catch (error) {
    console.error('사용량 조회 오료:', error);
    res.status(500).json({ 
      error: '사용량 조회 실패',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    });
  }
});

// 커스텀 TTS 서버 상태 확인
router.get('/health', async (req, res) => {
  try {
    const customHealth = await customTtsService.checkHealth();
    
    res.json({
      customTts: {
        available: customHealth,
        status: customHealth ? 'online' : 'offline'
      },
      elevenlabs: {
        available: !!process.env.ELEVENLABS_API_KEY,
        status: process.env.ELEVENLABS_API_KEY ? 'configured' : 'not_configured'
      },
      webSpeech: {
        available: true,
        status: 'browser_dependent'
      }
    });
  } catch (error) {
    console.error('TTS 서비스 상태 확인 오류:', error);
    res.status(500).json({ 
      error: 'TTS 서비스 상태 확인 실패',
      details: error instanceof Error ? error.message : '알 수 없는 오류'
    });
  }
});

export default router;