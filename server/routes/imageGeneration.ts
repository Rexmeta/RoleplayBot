import { Router } from 'express';
import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { trackImageUsage } from '../services/aiUsageTracker';

// 이미지 최적화 설정
const IMAGE_CONFIG = {
  scenario: {
    original: { width: 1200, height: 800, quality: 85 },
    thumbnail: { width: 400, height: 300, quality: 80 }
  },
  persona: {
    original: { width: 800, height: 800, quality: 90 },
    thumbnail: { width: 200, height: 200, quality: 80 }
  }
};

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
      model: "gemini-2.5-flash-image",
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

    // AI 사용량 추적
    trackImageUsage({
      model: 'gemini-2.5-flash-image',
      provider: 'gemini',
      metadata: { type: 'scenario', scenarioTitle }
    });

    res.json({
      success: true,
      imageUrl: localImagePath, // 로컬 파일 경로 반환
      originalImageUrl: imageUrl, // 원본 base64 URL도 포함
      prompt: imagePrompt,
      metadata: {
        model: "gemini-2.5-flash-image",
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

// base64 이미지를 최적화하여 로컬 파일로 저장하는 함수
async function saveImageToLocal(base64ImageUrl: string, scenarioTitle: string): Promise<string> {
  try {
    // base64 데이터에서 이미지 정보 추출
    const matches = base64ImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('유효하지 않은 base64 이미지 형식입니다.');
    }

    const imageData = matches[2];
    
    // 파일명 생성 (안전한 파일명으로 변환)
    const safeTitle = scenarioTitle
      .replace(/[^a-zA-Z0-9가-힣\s]/g, '') // 특수문자 제거
      .replace(/\s+/g, '-') // 공백을 하이픈으로
      .substring(0, 50); // 길이 제한
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseFilename = `${safeTitle}-${timestamp}`;
    
    // 저장 경로 설정
    const imageDir = path.join(process.cwd(), 'scenarios', 'images');
    
    // 디렉토리가 없으면 생성
    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true });
    }
    
    // base64 데이터를 버퍼로 변환
    const buffer = Buffer.from(imageData, 'base64');
    const originalSize = buffer.length;
    
    // 🖼️ 원본 이미지 최적화 (WebP 포맷, 리사이징)
    const originalFilename = `${baseFilename}.webp`;
    const originalPath = path.join(imageDir, originalFilename);
    
    await sharp(buffer)
      .resize(IMAGE_CONFIG.scenario.original.width, IMAGE_CONFIG.scenario.original.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: IMAGE_CONFIG.scenario.original.quality })
      .toFile(originalPath);
    
    // 📸 썸네일 생성 (리스트용 작은 이미지)
    const thumbnailFilename = `${baseFilename}-thumb.webp`;
    const thumbnailPath = path.join(imageDir, thumbnailFilename);
    
    await sharp(buffer)
      .resize(IMAGE_CONFIG.scenario.thumbnail.width, IMAGE_CONFIG.scenario.thumbnail.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: IMAGE_CONFIG.scenario.thumbnail.quality })
      .toFile(thumbnailPath);
    
    // 파일 크기 확인
    const originalStats = fs.statSync(originalPath);
    const thumbnailStats = fs.statSync(thumbnailPath);
    
    console.log(`📁 이미지 최적화 완료:`);
    console.log(`   원본: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(originalStats.size / 1024).toFixed(0)}KB (${((1 - originalStats.size / originalSize) * 100).toFixed(0)}% 감소)`);
    console.log(`   썸네일: ${(thumbnailStats.size / 1024).toFixed(0)}KB`);
    
    // 웹에서 접근 가능한 상대 경로 반환 (원본 경로)
    const webPath = `/scenarios/images/${originalFilename}`;
    
    return webPath;
    
  } catch (error) {
    console.error('이미지 로컬 저장 실패:', error);
    throw error;
  }
}

// 이미지 경로에서 썸네일 경로 생성
function getThumbnailPath(imagePath: string): string {
  if (!imagePath) return imagePath;
  
  // WebP 이미지인 경우 썸네일 경로로 변환
  if (imagePath.endsWith('.webp') && !imagePath.includes('-thumb')) {
    return imagePath.replace('.webp', '-thumb.webp');
  }
  
  // 기존 PNG/JPG 이미지는 그대로 반환 (하위 호환성)
  return imagePath;
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
      model: "gemini-2.5-flash-image",
      contents: [{ role: 'user', parts: [{ text: simplePrompt }] }]
    });
    
    // 응답에서 이미지 데이터 추출
    let imageUrl = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
          const imageData = part.inlineData;
          imageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
          break;
        }
      }
    }

    if (!imageUrl) {
      console.error('미리보기 이미지 API 응답:', JSON.stringify(result, null, 2));
      throw new Error('미리보기 이미지가 생성되지 않았습니다. Gemini API가 이미지를 반환하지 않았습니다.');
    }

    // 미리보기 이미지도 로컬에 저장
    const localImagePath = await saveImageToLocal(imageUrl, scenarioTitle);
    
    // AI 사용량 추적
    trackImageUsage({
      model: 'gemini-2.5-flash-image',
      provider: 'gemini',
      metadata: { type: 'preview', scenarioTitle }
    });

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
      model: "gemini-2.5-flash-image",
      contents: [{ role: 'user', parts: [{ text: imagePrompt }] }]
    });
    
    console.log('📊 Gemini API 응답:', JSON.stringify({
      candidates: result.candidates?.length,
      firstCandidate: result.candidates?.[0]?.content?.parts?.map((p: any) => ({
        hasInlineData: !!p.inlineData,
        hasMimeType: !!p.inlineData?.mimeType,
        hasData: !!p.inlineData?.data,
        dataLength: p.inlineData?.data?.length,
        textLength: p.text?.length
      }))
    }));
    
    // 응답에서 이미지 데이터 추출
    let imageUrl = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
      for (const part of result.candidates[0].content.parts) {
        const inlineData = part.inlineData;
        if (inlineData && inlineData.data && inlineData.mimeType) {
          imageUrl = `data:${inlineData.mimeType};base64,${inlineData.data}`;
          console.log(`✅ 이미지 데이터 발견: ${inlineData.mimeType}, 크기: ${inlineData.data.length} bytes`);
          break;
        }
      }
    }
    
    if (!imageUrl) {
      console.error('❌ 이미지 데이터를 찾을 수 없음');
      console.error('🔍 전체 응답:', JSON.stringify(result, null, 2));
      throw new Error('이미지가 생성되지 않았습니다. Gemini API가 이미지를 반환하지 않았습니다.');
    }

    // base64 이미지를 로컬 파일로 저장 (성별별 폴더)
    const localImagePath = await savePersonaImageToLocal(imageUrl, personaId, 'neutral', gender);
    
    console.log(`✅ 페르소나 기본 이미지 생성 성공: ${localImagePath}`);

    // AI 사용량 추적
    trackImageUsage({
      model: 'gemini-2.5-flash-image',
      provider: 'gemini',
      metadata: { type: 'persona-base', personaId, mbti, gender }
    });

    res.json({
      success: true,
      imageUrl: localImagePath,
      originalImageUrl: imageUrl,
      prompt: imagePrompt,
      metadata: {
        model: "gemini-2.5-flash-image",
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

  // 최종 프롬프트 구성 (사무실/회의실 배경 명시)
  let prompt = `Photorealistic professional portrait photograph of a ${genderEn}, ${visualTrait}${traitDescription}. `;
  prompt += `${styleDesc}. `;
  prompt += `Head and shoulders portrait in modern office or meeting room background, `;
  prompt += `professional corporate environment with neutral office setting, `;
  prompt += `natural professional lighting, high quality photography, `;
  prompt += `business casual attire, looking at camera, `;
  prompt += `neutral expression for base portrait, sharp focus, professional headshot. `;
  prompt += `NO text, NO speech bubbles, NO captions, NO graphic overlays, NO watermarks.`;

  return prompt;
}

// 페르소나 이미지를 로컬 파일로 저장하는 함수 (성별별 폴더 분리, WebP 최적화)
async function savePersonaImageToLocal(
  base64ImageUrl: string, 
  personaId: string, 
  emotion: string,
  gender: 'male' | 'female' = 'male'
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

    const imageData = matches[2];
    
    // 저장 경로 설정 (attached_assets/personas/{personaId}/{gender}/)
    const imageDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId, gender);
    
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
      '단호': 'determined',
      '실망': 'disappointed',
      '당혹': 'confused'
    };

    const emotionEn = emotionEnglishMap[emotion] || emotion;
    
    // base64 데이터를 버퍼로 변환
    const buffer = Buffer.from(imageData, 'base64');
    const originalSize = buffer.length;
    
    // 🚀 Sharp를 사용한 이미지 최적화 (WebP 변환)
    const { original: origConfig, thumbnail: thumbConfig } = IMAGE_CONFIG.persona;
    
    // 원본 최적화 (400x400 WebP)
    const optimizedFilename = `${emotionEn}.webp`;
    const optimizedPath = path.join(imageDir, optimizedFilename);
    await sharp(buffer)
      .resize(origConfig.width, origConfig.height, { fit: 'cover', position: 'center' })
      .webp({ quality: origConfig.quality })
      .toFile(optimizedPath);
    
    // 썸네일 생성 (150x150 WebP) - 대화창 등 작은 영역용
    const thumbnailFilename = `${emotionEn}-thumb.webp`;
    const thumbnailPath = path.join(imageDir, thumbnailFilename);
    await sharp(buffer)
      .resize(thumbConfig.width, thumbConfig.height, { fit: 'cover', position: 'center' })
      .webp({ quality: thumbConfig.quality })
      .toFile(thumbnailPath);
    
    // 최적화 결과 로깅
    const optimizedSize = fs.statSync(optimizedPath).size;
    const thumbSize = fs.statSync(thumbnailPath).size;
    const savedBytes = originalSize - optimizedSize;
    const savedPercent = ((savedBytes / originalSize) * 100).toFixed(1);
    
    console.log(`📁 페르소나 이미지 최적화 저장: ${emotionEn}`);
    console.log(`   원본: ${(originalSize/1024).toFixed(0)}KB → 최적화: ${(optimizedSize/1024).toFixed(0)}KB (${savedPercent}% 감소)`);
    console.log(`   썸네일: ${(thumbSize/1024).toFixed(0)}KB`);
    
    // 웹에서 접근 가능한 경로 반환 (성별별 폴더 포함)
    const webPath = `/personas/${personaId}/${gender}/${optimizedFilename}`;
    
    return webPath;
    
  } catch (error) {
    console.error('페르소나 이미지 로컬 저장 실패:', error);
    throw error;
  }
}

// 페르소나 표정 이미지 일괄 생성 엔드포인트 (9개 표정)
router.post('/generate-persona-expressions', async (req, res) => {
  try {
    const { personaId, mbti, gender, personalityTraits, imageStyle } = req.body;

    if (!personaId || !mbti || !gender) {
      return res.status(400).json({ 
        error: '페르소나 ID, MBTI, 성별이 필요합니다.' 
      });
    }

    console.log(`🎨 페르소나 표정 이미지 일괄 생성 시작: ${personaId} (${mbti}, ${gender})`);

    // 기본(중립) 이미지 읽기 (참조용) - 성별별 폴더 경로 포함, WebP 우선
    const baseDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId, gender);
    const fallbackDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId);
    
    // WebP 파일 우선 확인, PNG 폴백
    let imagePathToUse = '';
    const possiblePaths = [
      path.join(baseDir, 'neutral.webp'),
      path.join(baseDir, 'neutral.png'),
      path.join(fallbackDir, 'neutral.webp'),
      path.join(fallbackDir, 'neutral.png')
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        imagePathToUse = p;
        break;
      }
    }
    
    if (!imagePathToUse) {
      return res.status(400).json({
        error: '기본 이미지가 없습니다.',
        details: `먼저 ${gender} 성별의 기본 이미지를 생성해주세요.`
      });
    }
    
    console.log(`📷 기본 이미지 경로: ${imagePathToUse}`);

    // 기본 이미지를 base64로 인코딩
    const baseImageBuffer = fs.readFileSync(imagePathToUse);
    const baseImageBase64 = baseImageBuffer.toString('base64');

    // 생성할 표정 리스트 (중립 제외)
    const emotions = [
      { korean: '기쁨', english: 'joy', description: 'joyful, happy, smiling broadly' },
      { korean: '슬픔', english: 'sad', description: 'sad, downcast, melancholic' },
      { korean: '분노', english: 'angry', description: 'angry, frustrated, upset' },
      { korean: '놀람', english: 'surprise', description: 'surprised, amazed, astonished' },
      { korean: '호기심', english: 'curious', description: 'curious, interested, intrigued' },
      { korean: '불안', english: 'anxious', description: 'anxious, worried, concerned' },
      { korean: '단호', english: 'determined', description: 'determined, firm, resolute' },
      { korean: '실망', english: 'disappointed', description: 'disappointed, let down, discouraged' },
      { korean: '당혹', english: 'confused', description: 'confused, bewildered, perplexed' }
    ];

    const generatedImages: Array<{
      emotion: string;
      emotionKorean: string;
      imageUrl: string;
      success: boolean;
      error?: string;
    }> = [];

    // 각 표정에 대해 순차적으로 이미지 생성
    for (const emotion of emotions) {
      try {
        console.log(`  → ${emotion.korean} (${emotion.english}) 이미지 생성 중...`);

        const imagePrompt = generateExpressionImagePrompt(
          mbti,
          gender,
          personalityTraits || [],
          imageStyle || '',
          emotion.description
        );

        const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
        
        // 기본 이미지를 참조로 포함하여 API 호출
        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: baseImageBase64
                }
              },
              { text: imagePrompt }
            ]
          }]
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

        if (imageUrl) {
          const localImagePath = await savePersonaImageToLocal(imageUrl, personaId, emotion.korean, gender);
          generatedImages.push({
            emotion: emotion.english,
            emotionKorean: emotion.korean,
            imageUrl: localImagePath,
            success: true
          });
          
          // AI 사용량 추적 (각 표정 이미지마다)
          trackImageUsage({
            model: 'gemini-2.5-flash-image',
            provider: 'gemini',
            metadata: { type: 'persona-expression', personaId, emotion: emotion.english, gender }
          });
          
          console.log(`  ✅ ${emotion.korean} 이미지 생성 완료`);
        } else {
          generatedImages.push({
            emotion: emotion.english,
            emotionKorean: emotion.korean,
            imageUrl: '',
            success: false,
            error: '이미지 데이터를 찾을 수 없음'
          });
          console.log(`  ❌ ${emotion.korean} 이미지 생성 실패`);
        }

        // API rate limit 방지를 위한 짧은 대기 (선택적)
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (emotionError: any) {
        console.error(`  ❌ ${emotion.korean} 이미지 생성 오류:`, emotionError.message);
        generatedImages.push({
          emotion: emotion.english,
          emotionKorean: emotion.korean,
          imageUrl: '',
          success: false,
          error: emotionError.message
        });
      }
    }

    const successCount = generatedImages.filter(img => img.success).length;
    const totalCount = emotions.length;

    console.log(`✅ 페르소나 표정 이미지 일괄 생성 완료: ${successCount}/${totalCount} 성공`);

    res.json({
      success: true,
      totalGenerated: successCount,
      totalRequested: totalCount,
      images: generatedImages,
      metadata: {
        personaId,
        mbti,
        gender,
        model: "gemini-2.5-flash-image",
        provider: "gemini"
      }
    });

  } catch (error: any) {
    console.error('페르소나 표정 이미지 일괄 생성 오류:', error);

    res.status(500).json({
      error: '페르소나 표정 이미지 일괄 생성 실패',
      details: error.message || '알 수 없는 오류가 발생했습니다.'
    });
  }
});

// 단일 표정 이미지 재생성 엔드포인트
router.post('/generate-persona-single-expression', async (req, res) => {
  try {
    const { personaId, mbti, gender, personalityTraits, imageStyle, emotion } = req.body;

    if (!personaId || !mbti || !gender || !emotion) {
      return res.status(400).json({ 
        error: '페르소나 ID, MBTI, 성별, 표정이 필요합니다.' 
      });
    }

    console.log(`🎨 페르소나 단일 표정 이미지 생성: ${personaId} - ${emotion} (${gender})`);

    // 표정 매핑
    const emotionMap: Record<string, { english: string; description: string }> = {
      '중립': { english: 'neutral', description: 'neutral, calm, composed' },
      '기쁨': { english: 'joy', description: 'joyful, happy, smiling broadly' },
      '슬픔': { english: 'sad', description: 'sad, downcast, melancholic' },
      '분노': { english: 'angry', description: 'angry, frustrated, upset' },
      '놀람': { english: 'surprise', description: 'surprised, amazed, astonished' },
      '호기심': { english: 'curious', description: 'curious, interested, intrigued' },
      '불안': { english: 'anxious', description: 'anxious, worried, concerned' },
      '단호': { english: 'determined', description: 'determined, firm, resolute' },
      '실망': { english: 'disappointed', description: 'disappointed, let down, discouraged' },
      '당혹': { english: 'confused', description: 'confused, bewildered, perplexed' }
    };

    const emotionInfo = emotionMap[emotion];
    if (!emotionInfo) {
      return res.status(400).json({ 
        error: '지원하지 않는 표정입니다.',
        validEmotions: Object.keys(emotionMap)
      });
    }

    // 중립 표정인 경우 기본 이미지 생성 로직 사용
    if (emotion === '중립') {
      const imagePrompt = generatePersonaImagePrompt(
        mbti, 
        gender, 
        personalityTraits || [], 
        imageStyle || ''
      );

      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: [{ role: 'user', parts: [{ text: imagePrompt }] }]
      });

      let imageUrl = null;
      if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
        for (const part of result.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
            imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            break;
          }
        }
      }

      if (!imageUrl) {
        throw new Error('이미지가 생성되지 않았습니다.');
      }

      const localImagePath = await savePersonaImageToLocal(imageUrl, personaId, emotion, gender);
      
      trackImageUsage({
        model: 'gemini-2.5-flash-image',
        provider: 'gemini',
        metadata: { type: 'persona-single-expression', personaId, emotion, gender }
      });

      return res.json({
        success: true,
        emotion,
        emotionEnglish: emotionInfo.english,
        imageUrl: localImagePath,
        metadata: { personaId, mbti, gender, model: "gemini-2.5-flash-image" }
      });
    }

    // 다른 표정의 경우 기본 이미지를 참조로 사용
    const baseDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId, gender);
    const fallbackDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId);
    
    let imagePathToUse = '';
    const possiblePaths = [
      path.join(baseDir, 'neutral.webp'),
      path.join(baseDir, 'neutral.png'),
      path.join(fallbackDir, 'neutral.webp'),
      path.join(fallbackDir, 'neutral.png')
    ];
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        imagePathToUse = p;
        break;
      }
    }
    
    if (!imagePathToUse) {
      return res.status(400).json({
        error: '기본 이미지가 없습니다.',
        details: `먼저 ${gender} 성별의 기본(중립) 이미지를 생성해주세요.`
      });
    }

    const baseImageBuffer = fs.readFileSync(imagePathToUse);
    const baseImageBase64 = baseImageBuffer.toString('base64');

    const imagePrompt = generateExpressionImagePrompt(
      mbti,
      gender,
      personalityTraits || [],
      imageStyle || '',
      emotionInfo.description
    );

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/png', data: baseImageBase64 } },
          { text: imagePrompt }
        ]
      }]
    });

    let imageUrl = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
          imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!imageUrl) {
      throw new Error('이미지가 생성되지 않았습니다.');
    }

    const localImagePath = await savePersonaImageToLocal(imageUrl, personaId, emotion, gender);
    
    trackImageUsage({
      model: 'gemini-2.5-flash-image',
      provider: 'gemini',
      metadata: { type: 'persona-single-expression', personaId, emotion, gender }
    });

    console.log(`✅ ${emotion} 표정 이미지 생성 완료: ${localImagePath}`);

    res.json({
      success: true,
      emotion,
      emotionEnglish: emotionInfo.english,
      imageUrl: localImagePath,
      metadata: { personaId, mbti, gender, model: "gemini-2.5-flash-image" }
    });

  } catch (error: any) {
    console.error('단일 표정 이미지 생성 오류:', error);
    res.status(500).json({
      error: '표정 이미지 생성 실패',
      details: error.message || '알 수 없는 오류가 발생했습니다.'
    });
  }
});

// 특정 표정 이미지 생성 프롬프트 구성 함수
function generateExpressionImagePrompt(
  mbti: string,
  gender: string,
  personalityTraits: string[],
  imageStyle: string,
  emotionDescription: string
): string {
  const genderEn = gender === 'male' ? 'man' : 'woman';

  // MBTI 특성 기반 외모 특징 (기본 이미지와 일관성 유지)
  const mbtiVisualTraits: Record<string, string> = {
    'ENFJ': 'warm appearance, friendly features',
    'ENFP': 'bright features, enthusiastic look',
    'ENTJ': 'confident features, strong presence',
    'ENTP': 'sharp features, innovative look',
    'ESFJ': 'gentle features, caring presence',
    'ESFP': 'lively features, energetic look',
    'ESTJ': 'serious features, professional look',
    'ESTP': 'confident features, dynamic presence',
    'INFJ': 'thoughtful features, calm presence',
    'INFP': 'gentle features, creative look',
    'INTJ': 'analytical features, focused presence',
    'INTP': 'curious features, intellectual look',
    'ISFJ': 'kind features, warm presence',
    'ISFP': 'soft features, artistic look',
    'ISTJ': 'composed features, steady presence',
    'ISTP': 'calm features, practical look'
  };

  const visualTrait = mbtiVisualTraits[mbti] || 'neutral features';
  const styleDesc = imageStyle || 'professional business portrait photography';

  // 표정 중심 프롬프트 구성 (배경 일관성 유지)
  let prompt = `Generate an image of the EXACT SAME person from the reference image. `;
  prompt += `Keep IDENTICAL: face, facial features, hair, skin tone, body type, clothing, and background environment. `;
  prompt += `ONLY CHANGE: facial expression to show ${emotionDescription}. `;
  prompt += `The background must remain the SAME office or meeting room environment as the reference image. `;
  prompt += `Professional business portrait with clear ${emotionDescription} expression. `;
  prompt += `Head and shoulders portrait, same office/meeting room background as reference, `;
  prompt += `natural professional lighting, high quality photography, `;
  prompt += `same business casual attire as reference, looking at camera, sharp focus. `;
  prompt += `NO text, NO speech bubbles, NO captions, NO graphic overlays, NO watermarks.`;

  return prompt;
}

// 기존 이미지 일괄 최적화 엔드포인트
router.post('/optimize-existing-images', async (req, res) => {
  try {
    const imageDir = path.join(process.cwd(), 'scenarios', 'images');
    
    if (!fs.existsSync(imageDir)) {
      return res.json({
        success: true,
        message: '최적화할 이미지가 없습니다.',
        optimized: 0
      });
    }
    
    const files = fs.readdirSync(imageDir);
    const pngFiles = files.filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg'));
    
    console.log(`🔧 기존 이미지 최적화 시작: ${pngFiles.length}개 파일`);
    
    let optimizedCount = 0;
    let totalSavedBytes = 0;
    const results: Array<{ file: string; originalSize: number; newSize: number; thumbnailSize: number }> = [];
    
    for (const file of pngFiles) {
      try {
        const filePath = path.join(imageDir, file);
        const originalStats = fs.statSync(filePath);
        const originalSize = originalStats.size;
        
        // 이미 최적화된 파일 건너뛰기 (thumb 포함 파일)
        if (file.includes('-thumb')) continue;
        
        const buffer = fs.readFileSync(filePath);
        const baseFilename = file.replace(/\.(png|jpg|jpeg)$/i, '');
        
        // WebP로 최적화된 원본 생성
        const optimizedFilename = `${baseFilename}.webp`;
        const optimizedPath = path.join(imageDir, optimizedFilename);
        
        await sharp(buffer)
          .resize(IMAGE_CONFIG.scenario.original.width, IMAGE_CONFIG.scenario.original.height, {
            fit: 'cover',
            position: 'center'
          })
          .webp({ quality: IMAGE_CONFIG.scenario.original.quality })
          .toFile(optimizedPath);
        
        // 썸네일 생성
        const thumbnailFilename = `${baseFilename}-thumb.webp`;
        const thumbnailPath = path.join(imageDir, thumbnailFilename);
        
        await sharp(buffer)
          .resize(IMAGE_CONFIG.scenario.thumbnail.width, IMAGE_CONFIG.scenario.thumbnail.height, {
            fit: 'cover',
            position: 'center'
          })
          .webp({ quality: IMAGE_CONFIG.scenario.thumbnail.quality })
          .toFile(thumbnailPath);
        
        const optimizedStats = fs.statSync(optimizedPath);
        const thumbnailStats = fs.statSync(thumbnailPath);
        
        const savedBytes = originalSize - optimizedStats.size;
        totalSavedBytes += savedBytes;
        
        results.push({
          file,
          originalSize,
          newSize: optimizedStats.size,
          thumbnailSize: thumbnailStats.size
        });
        
        console.log(`   ✅ ${file}: ${(originalSize / 1024).toFixed(0)}KB → ${(optimizedStats.size / 1024).toFixed(0)}KB + ${(thumbnailStats.size / 1024).toFixed(0)}KB thumb`);
        optimizedCount++;
        
      } catch (fileError) {
        console.error(`   ❌ ${file} 최적화 실패:`, fileError);
      }
    }
    
    console.log(`🎉 기존 이미지 최적화 완료: ${optimizedCount}개 파일, ${(totalSavedBytes / 1024 / 1024).toFixed(2)}MB 절약`);
    
    res.json({
      success: true,
      optimized: optimizedCount,
      totalFiles: pngFiles.length,
      totalSavedMB: (totalSavedBytes / 1024 / 1024).toFixed(2),
      results
    });
    
  } catch (error: any) {
    console.error('기존 이미지 최적화 오류:', error);
    res.status(500).json({
      error: '이미지 최적화 실패',
      details: error.message
    });
  }
});

// saveImageToLocal 함수도 export
export { saveImageToLocal, savePersonaImageToLocal, getThumbnailPath };

export default router;