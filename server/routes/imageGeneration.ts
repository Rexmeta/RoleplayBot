import { Router } from 'express';
import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import * as path from 'path';

// Gemini 클라이언트 초기화
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey });

const router = Router();

// 시나리오 이미지 생성 엔드포인트
router.post('/generate-scenario-image', async (req, res) => {
  try {
    const { scenarioTitle, description, theme, industry, customPrompt } = req.body;

    if (!scenarioTitle) {
      return res.status(400).json({ 
        error: '시나리오 제목이 필요합니다.' 
      });
    }

    // 커스텀 프롬프트 처리: 짧은 한국어 프롬프트를 영어로 변환하고 상세화
    let imagePrompt: string;
    if (customPrompt && customPrompt.trim()) {
      // 커스텀 프롬프트가 있으면 영어로 확장하고 이미지 생성에 최적화
      imagePrompt = `Photorealistic professional business photograph: ${customPrompt}. `;
      imagePrompt += `High quality corporate photography, natural lighting, sharp focus, professional setting, modern business environment. `;
      imagePrompt += `NO text, NO speech bubbles, NO captions, NO graphic overlays.`;
    } else {
      // 기본 프롬프트 생성
      imagePrompt = generateImagePrompt(scenarioTitle, description, theme, industry);
    }

    console.log(`🎨 Gemini 이미지 생성 요청: ${scenarioTitle}`);
    console.log(`프롬프트: ${imagePrompt}`);

    // Gemini 2.5 Flash Image를 사용한 이미지 생성 (올바른 API 사용법)
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: [{ role: 'user', parts: [{ text: imagePrompt }] }]
    });
    
    // 디버깅: 응답 구조 로깅
    console.log('📋 Gemini API 응답:', JSON.stringify(result, null, 2));
    
    // 응답에서 이미지 데이터 추출
    let imageUrl = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData) {
          const imageData = part.inlineData;
          imageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
          break;
        }
      }
    }
    
    if (!imageUrl) {
      console.error('❌ 이미지 데이터를 찾을 수 없음. candidates:', result.candidates);
      throw new Error('이미지가 생성되지 않았습니다. Gemini API 응답에서 이미지 데이터를 찾을 수 없습니다.');
    }

    // base64 이미지를 로컬 파일로 저장
    const localImagePath = await saveImageToLocal(imageUrl, scenarioTitle);
    
    console.log(`✅ Gemini 이미지 생성 성공, 로컬 저장 완료: ${localImagePath}`);

    res.json({
      success: true,
      imageUrl: localImagePath, // 로컬 파일 경로 반환
      originalImageUrl: imageUrl, // 원본 base64 URL도 포함
      prompt: imagePrompt,
      metadata: {
        model: "gemini-2.5-flash-image-preview",
        provider: "gemini",
        savedLocally: true
      }
    });

  } catch (error: any) {
    console.error('Gemini 이미지 생성 오류:', error);
    
    // Gemini API 오류 처리
    if (error.message?.includes('quota') || error.status === 429) {
      return res.status(429).json({
        error: '요청 한도 초과',
        details: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
        fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
      });
    }

    if (error.message?.includes('safety') || error.message?.includes('policy')) {
      return res.status(400).json({
        error: '콘텐츠 정책 위반',
        details: '생성하려는 이미지가 콘텐츠 정책에 위반됩니다. 다른 내용으로 시도해주세요.',
        fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
      });
    }

    // 일반적인 오류에 대한 폴백
    res.status(500).json({
      error: '이미지 생성 실패',
      details: error.message || '알 수 없는 오류가 발생했습니다.',
      fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
    });
  }
});

// 이미지 생성 프롬프트 구성 함수
function generateImagePrompt(title: string, description?: string, theme?: string, industry?: string): string {
  let prompt = "";
  let focusElement = "modern corporate office environment"; // 기본값 설정

  // 시나리오 제목 기반 핵심 요소 1-2개 추출 (간결하게)
  if (title.includes('파업') || title.includes('노사')) {
    focusElement = "business professionals in tense negotiation meeting";
  } else if (title.includes('앱') || title.includes('개발')) {
    focusElement = "modern tech office with developers at work";
  } else if (title.includes('협상') || title.includes('갈등')) {
    focusElement = "corporate meeting room with business professionals";
  } else if (title.includes('제조') || title.includes('공장')) {
    focusElement = "industrial factory floor with equipment";
  } else if (title.includes('프로젝트') || title.includes('일정')) {
    focusElement = "project team meeting around a table";
  }

  // 업종별 요소 (선택적, 간단하게) - title보다 우선순위 높음
  if (industry === '제조업') {
    focusElement = "industrial factory setting";
  } else if (industry === 'IT') {
    focusElement = "modern tech office space";
  } else if (industry === '금융') {
    focusElement = "professional banking office";
  }

  // 실사 사진 중심의 간결한 프롬프트 구성
  prompt = `Photorealistic documentary-style photograph of ${focusElement}. `;
  prompt += "Professional corporate photography, natural lighting, real business setting, ";
  prompt += "sharp focus, high quality, authentic workplace scene. ";
  prompt += "NO text, NO speech bubbles, NO captions, NO graphic overlays.";

  return prompt;
}

// base64 이미지를 로컬 파일로 저장하는 함수
async function saveImageToLocal(base64ImageUrl: string, scenarioTitle: string): Promise<string> {
  try {
    // base64 데이터에서 이미지 정보 추출
    const matches = base64ImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('유효하지 않은 base64 이미지 형식입니다.');
    }

    const mimeType = matches[1];
    const imageData = matches[2];
    
    // 파일 확장자 결정
    const extension = mimeType.includes('png') ? 'png' : 
                     mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 
                     'png'; // 기본값
    
    // 파일명 생성 (안전한 파일명으로 변환)
    const safeTitle = scenarioTitle
      .replace(/[^a-zA-Z0-9가-힣\s]/g, '') // 특수문자 제거
      .replace(/\s+/g, '-') // 공백을 하이픈으로
      .substring(0, 50); // 길이 제한
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${safeTitle}-${timestamp}.${extension}`;
    
    // 저장 경로 설정
    const imageDir = path.join(process.cwd(), 'scenarios', 'images');
    
    // 디렉토리가 없으면 생성
    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true });
    }
    
    const filePath = path.join(imageDir, filename);
    
    // base64 데이터를 파일로 저장
    const buffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(filePath, buffer);
    
    // 웹에서 접근 가능한 상대 경로 반환
    const webPath = `/scenarios/images/${filename}`;
    
    console.log(`📁 이미지 로컬 저장 완료: ${webPath}`);
    return webPath;
    
  } catch (error) {
    console.error('이미지 로컬 저장 실패:', error);
    throw error;
  }
}

// 미리보기 이미지 생성 (더 빠른 응답을 위한 간단한 버전)
router.post('/generate-preview', async (req, res) => {
  try {
    const { scenarioTitle } = req.body;

    if (!scenarioTitle) {
      return res.status(400).json({ 
        error: '시나리오 제목이 필요합니다.' 
      });
    }

    // 간단한 프롬프트로 빠른 생성
    const simplePrompt = `A minimal, professional illustration representing "${scenarioTitle}", modern business style, clean composition, corporate colors, vector-like appearance`;

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: [{ role: 'user', parts: [{ text: simplePrompt }] }]
    });
    
    // 응답에서 이미지 데이터 추출
    let imageUrl = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData) {
          const imageData = part.inlineData;
          imageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
          break;
        }
      }
    }

    if (!imageUrl) {
      throw new Error('미리보기 이미지가 생성되지 않았습니다.');
    }

    // 미리보기 이미지도 로컬에 저장
    const localImagePath = await saveImageToLocal(imageUrl, scenarioTitle);
    
    res.json({
      success: true,
      imageUrl: localImagePath, // 로컬 파일 경로 반환
      originalImageUrl: imageUrl, // 원본 base64 URL도 포함
      prompt: simplePrompt,
      isPreview: true,
      metadata: {
        savedLocally: true
      }
    });

  } catch (error: any) {
    console.error('미리보기 이미지 생성 오류:', error);
    res.status(500).json({
      error: '미리보기 이미지 생성 실패',
      details: error.message,
      fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
    });
  }
});

// 페르소나 기본 이미지 생성 엔드포인트
router.post('/generate-persona-base', async (req, res) => {
  try {
    const { personaId, mbti, gender, personalityTraits, imageStyle } = req.body;

    if (!personaId || !mbti || !gender) {
      return res.status(400).json({ 
        error: '페르소나 ID, MBTI, 성별이 필요합니다.' 
      });
    }

    // 페르소나 기본 이미지 생성 프롬프트 구성
    const imagePrompt = generatePersonaImagePrompt(
      mbti, 
      gender, 
      personalityTraits || [], 
      imageStyle || ''
    );

    console.log(`🎨 페르소나 기본 이미지 생성 요청: ${personaId} (${mbti}, ${gender})`);
    console.log(`프롬프트: ${imagePrompt}`);

    // Gemini 2.5 Flash Image를 사용한 이미지 생성
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: [{ role: 'user', parts: [{ text: imagePrompt }] }]
    });
    
    // 응답에서 이미지 데이터 추출
    let imageUrl = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData) {
          const imageData = part.inlineData;
          imageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
          break;
        }
      }
    }
    
    if (!imageUrl) {
      console.error('❌ 이미지 데이터를 찾을 수 없음');
      throw new Error('이미지가 생성되지 않았습니다.');
    }

    // base64 이미지를 로컬 파일로 저장
    const localImagePath = await savePersonaImageToLocal(imageUrl, personaId, 'neutral');
    
    console.log(`✅ 페르소나 기본 이미지 생성 성공: ${localImagePath}`);

    res.json({
      success: true,
      imageUrl: localImagePath,
      originalImageUrl: imageUrl,
      prompt: imagePrompt,
      metadata: {
        model: "gemini-2.5-flash-image-preview",
        provider: "gemini",
        personaId,
        mbti,
        gender,
        savedLocally: true
      }
    });

  } catch (error: any) {
    console.error('페르소나 기본 이미지 생성 오류:', error);
    
    if (error.message?.includes('quota') || error.status === 429) {
      return res.status(429).json({
        error: '요청 한도 초과',
        details: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'
      });
    }

    res.status(500).json({
      error: '페르소나 이미지 생성 실패',
      details: error.message || '알 수 없는 오류가 발생했습니다.'
    });
  }
});

// 페르소나 이미지 생성 프롬프트 구성 함수
function generatePersonaImagePrompt(
  mbti: string, 
  gender: string, 
  personalityTraits: string[], 
  imageStyle: string
): string {
  // 성별 영어 변환
  const genderEn = gender === 'male' ? 'man' : 'woman';
  
  // MBTI 특성 기반 외모 특징 매핑
  const mbtiVisualTraits: Record<string, string> = {
    'ENFJ': 'warm smile, friendly eyes, approachable expression',
    'ENFP': 'bright eyes, enthusiastic expression, creative vibe',
    'ENTJ': 'confident gaze, strong presence, professional demeanor',
    'ENTP': 'sharp eyes, curious expression, innovative look',
    'ESFJ': 'gentle smile, caring expression, welcoming presence',
    'ESFP': 'lively expression, energetic vibe, fun personality',
    'ESTJ': 'serious expression, organized demeanor, professional look',
    'ESTP': 'confident smile, active vibe, dynamic presence',
    'INFJ': 'thoughtful eyes, calm expression, deep presence',
    'INFP': 'gentle expression, creative aura, dreamy look',
    'INTJ': 'analytical gaze, focused expression, strategic presence',
    'INTP': 'curious eyes, thoughtful expression, intellectual vibe',
    'ISFJ': 'kind smile, warm presence, reliable demeanor',
    'ISFP': 'soft expression, artistic vibe, gentle presence',
    'ISTJ': 'composed expression, practical demeanor, steady presence',
    'ISTP': 'calm eyes, practical look, independent vibe'
  };

  const visualTrait = mbtiVisualTraits[mbti] || 'neutral expression, professional demeanor';
  
  // 성격 특성을 시각적 표현으로 변환 (선택적)
  let traitDescription = '';
  if (personalityTraits && personalityTraits.length > 0) {
    const traitsEn = personalityTraits.slice(0, 2).join(', '); // 최대 2개만
    traitDescription = `, showing ${traitsEn}`;
  }

  // 스타일 설명 (기본값: 전문적인 비즈니스 초상화)
  const styleDesc = imageStyle || 'professional business portrait photography';

  // 최종 프롬프트 구성
  let prompt = `Photorealistic professional portrait photograph of a ${genderEn}, ${visualTrait}${traitDescription}. `;
  prompt += `${styleDesc}. `;
  prompt += `Head and shoulders portrait, neutral background, natural professional lighting, `;
  prompt += `high quality photography, business casual attire, looking at camera, `;
  prompt += `neutral expression for base portrait, sharp focus, professional headshot. `;
  prompt += `NO text, NO speech bubbles, NO captions, NO graphic overlays, NO watermarks.`;

  return prompt;
}

// 페르소나 이미지를 로컬 파일로 저장하는 함수
async function savePersonaImageToLocal(
  base64ImageUrl: string, 
  personaId: string, 
  emotion: string
): Promise<string> {
  try {
    // 보안: personaId 검증
    if (personaId.includes('..') || personaId.includes('/') || personaId.includes('\\')) {
      throw new Error('Invalid persona ID');
    }

    // base64 데이터에서 이미지 정보 추출
    const matches = base64ImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('유효하지 않은 base64 이미지 형식입니다.');
    }

    const mimeType = matches[1];
    const imageData = matches[2];
    const extension = mimeType.split('/')[1] || 'png';
    
    // 저장 경로 설정 (attached_assets/personas/{personaId}/)
    const imageDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId);
    
    // 디렉토리가 없으면 생성
    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true });
    }
    
    // 한글 표정명을 영어로 변환
    const emotionEnglishMap: Record<string, string> = {
      '중립': 'neutral',
      '기쁨': 'joy',
      '슬픔': 'sad',
      '분노': 'angry',
      '놀람': 'surprise',
      '호기심': 'curious',
      '불안': 'anxious',
      '피로': 'tired',
      '실망': 'disappointed',
      '당혹': 'confused'
    };

    const emotionEn = emotionEnglishMap[emotion] || emotion;
    const filename = `${emotionEn}.${extension}`;
    const filePath = path.join(imageDir, filename);
    
    // base64 데이터를 파일로 저장
    const buffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(filePath, buffer);
    
    // 웹에서 접근 가능한 경로 반환
    const webPath = `/personas/${personaId}/${filename}`;
    
    console.log(`📁 페르소나 이미지 로컬 저장 완료: ${webPath}`);
    return webPath;
    
  } catch (error) {
    console.error('페르소나 이미지 로컬 저장 실패:', error);
    throw error;
  }
}

// saveImageToLocal 함수도 export
export { saveImageToLocal, savePersonaImageToLocal };

export default router;