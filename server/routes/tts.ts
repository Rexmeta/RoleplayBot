import { Router } from 'express';
import { customTtsService } from '../services/customTtsService.js';
import { elevenLabsService } from '../services/elevenlabsService.js';
import { FileManagerService } from '../services/fileManager.js';
import { asyncHandler, createHttpError } from './routerHelpers';

const router = Router();
const fileManager = new FileManagerService();

interface PersonaData {
  id: string;
  name: string;
  gender?: 'male' | 'female';
  [key: string]: any;
}

async function getPersonaGender(personaId: string): Promise<'male' | 'female'> {
  try {
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
    
    const femaleMBTI = ['isfj', 'infp', 'isfp', 'infj'];
    const isFemale = femaleMBTI.includes(personaId.toLowerCase());
    const gender = isFemale ? 'female' : 'male';
    
    console.log(`👤 백업 성별 판단: ${personaId} → ${gender} (하드코딩됨)`);
    return gender;
    
  } catch (error) {
    console.error('성별 조회 오류:', error);
    return 'male';
  }
}

router.post('/generate', asyncHandler(async (req, res) => {
  const { text, scenarioId, emotion = '중립' } = req.body;

  if (!text || !scenarioId) {
    throw createHttpError(400, '텍스트와 시나리오 ID가 필요합니다.');
  }

  const cleanText = text
    .replace(/<[^>]*>/g, '')
    .replace(/[*#_`]/g, '')
    .replace(/\([^)]{1,30}\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (!cleanText) {
    throw createHttpError(400, '유효한 텍스트가 없습니다.');
  }

  const gender = await getPersonaGender(scenarioId);
  
  console.log(`TTS 요청: "${cleanText.substring(0, 50)}..." (${scenarioId}, ${gender}, ${emotion})`);

  let audioBuffer: ArrayBuffer;
  let ttsProvider = 'custom';

  try {
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
      throw new Error('TTS 서비스를 사용할 수 없습니다. 브라우저 음성 합성을 사용해주세요.');
    }
  }

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
}));

router.get('/voices', asyncHandler(async (req, res) => {
  const voices = await elevenLabsService.getAvailableVoices();
  res.json(voices);
}));

router.get('/usage', asyncHandler(async (req, res) => {
  const usage = await elevenLabsService.getUsage();
  res.json(usage);
}));

router.get('/health', asyncHandler(async (req, res) => {
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
}));

export default router;
