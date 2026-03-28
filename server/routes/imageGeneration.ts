import { Router } from 'express';
import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { trackImageUsage } from '../services/aiUsageTracker';
import { fileManager } from '../services/fileManager';
import { mediaStorage } from '../services/mediaStorage';
import { transformToSignedUrl } from '../services/gcsStorage';
import { asyncHandler, createHttpError } from './routerHelpers';

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

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey });

const router = Router();

router.post('/generate-scenario-image', asyncHandler(async (req, res) => {
  const { scenarioId, scenarioTitle, description, theme, industry, customPrompt } = req.body;

  if (!scenarioTitle) {
    throw createHttpError(400, '시나리오 제목이 필요합니다.');
  }

  let oldImagePath: string | null = null;
  if (scenarioId) {
    try {
      const existingScenario = await fileManager.getScenarioById(scenarioId);
      oldImagePath = existingScenario?.image || null;
    } catch (e) {
      // 기존 시나리오를 찾지 못해도 진행
    }
  }

  let imagePrompt: string;
  if (customPrompt && customPrompt.trim()) {
    imagePrompt = `Photorealistic professional business photograph: ${customPrompt}. `;
    imagePrompt += `High quality corporate photography, natural lighting, sharp focus, professional setting, modern business environment. `;
    imagePrompt += `NO text, NO speech bubbles, NO captions, NO graphic overlays.`;
  } else {
    imagePrompt = generateImagePrompt(scenarioTitle, description, theme, industry);
  }

  console.log(`🎨 Gemini 이미지 생성 요청: ${scenarioTitle}`);
  console.log(`프롬프트: ${imagePrompt}`);

  let result: any;
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
    result = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: 'user', parts: [{ text: imagePrompt }] }]
    });
  } catch (apiError: any) {
    console.error('Gemini 이미지 생성 오류:', apiError);
    if (apiError.message?.includes('quota') || apiError.status === 429) {
      let retryAfter: string | null = null;
      let isFreeTierLimit = false;
      try {
        const parsed = JSON.parse(apiError.message);
        const violations = parsed?.error?.details?.find((d: any) => d['@type']?.includes('QuotaFailure'))?.violations || [];
        isFreeTierLimit = violations.some((v: any) => v.quotaId?.includes('FreeTier'));
        const retryInfo = parsed?.error?.details?.find((d: any) => d['@type']?.includes('RetryInfo'));
        if (retryInfo?.retryDelay) retryAfter = retryInfo.retryDelay;
      } catch {}
      throw Object.assign(createHttpError(429, '요청 한도 초과'), {
        error: '요청 한도 초과',
        details: isFreeTierLimit
          ? 'Gemini 이미지 생성 모델은 유료 API 키가 필요합니다. Google AI Studio에서 결제를 활성화해주세요.'
          : `API 요청 한도를 초과했습니다. ${retryAfter ? retryAfter + ' 후 다시' : '잠시 후'} 시도해주세요.`,
        retryAfter,
        isFreeTierLimit,
        fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
      });
    }
    if (apiError.message?.includes('safety') || apiError.message?.includes('policy')) {
      throw Object.assign(createHttpError(400, '콘텐츠 정책 위반'), {
        error: '콘텐츠 정책 위반',
        details: '생성하려는 이미지가 콘텐츠 정책에 위반됩니다. 다른 내용으로 시도해주세요.',
        fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
      });
    }
    throw apiError;
  }

  console.log('📋 Gemini API 응답:', JSON.stringify(result, null, 2));

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

  const { imagePath: localImagePath } = await mediaStorage.saveScenarioImage(imageUrl, scenarioTitle);

  console.log(`✅ Gemini 이미지 생성 성공, Object Storage 저장 완료: ${localImagePath}`);

  trackImageUsage({
    model: 'gemini-2.5-flash-image',
    provider: 'gemini',
    metadata: { type: 'scenario', scenarioTitle }
  });

  if (scenarioId) {
    try {
      await fileManager.updateScenario(scenarioId, {
        image: localImagePath,
        imagePrompt: customPrompt || null
      } as any);
      console.log(`✅ 시나리오 이미지 URL 데이터베이스 저장 완료: ${scenarioId}`);

      if (oldImagePath && oldImagePath !== localImagePath) {
        const oldThumbPath = oldImagePath.replace('.webp', '-thumb.webp');
        const deleted = await mediaStorage.deleteMultipleFromStorage([oldImagePath, oldThumbPath]);
        if (deleted > 0) {
          console.log(`🗑️ 기존 시나리오 이미지 삭제 완료: ${deleted}개 파일`);
        }
      }
    } catch (dbError) {
      console.error('❌ 시나리오 이미지 URL 데이터베이스 저장 실패:', dbError);
    }
  }

  const signedImageUrl = await transformToSignedUrl(localImagePath) || localImagePath;

  res.json({
    success: true,
    imageUrl: signedImageUrl,
    storagePath: localImagePath,
    originalImageUrl: imageUrl,
    prompt: imagePrompt,
    metadata: {
      model: "gemini-2.5-flash-image",
      provider: "gemini",
      savedLocally: true,
      savedToDatabase: !!scenarioId
    }
  });
}));

function generateImagePrompt(title: string, description?: string, theme?: string, industry?: string): string {
  let prompt = "";
  let focusElement = "modern corporate office environment";

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

  if (industry === '제조업') {
    focusElement = "industrial factory setting";
  } else if (industry === 'IT') {
    focusElement = "modern tech office space";
  } else if (industry === '금융') {
    focusElement = "professional banking office";
  }

  prompt = `Photorealistic documentary-style photograph of ${focusElement}. `;
  prompt += "Professional corporate photography, natural lighting, real business setting, ";
  prompt += "sharp focus, high quality, authentic workplace scene. ";
  prompt += "NO text, NO speech bubbles, NO captions, NO graphic overlays.";

  return prompt;
}

async function saveImageToLocal(base64ImageUrl: string, scenarioTitle: string): Promise<string> {
  try {
    const matches = base64ImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('유효하지 않은 base64 이미지 형식입니다.');
    }

    const imageData = matches[2];

    const safeTitle = scenarioTitle
      .replace(/[^a-zA-Z0-9가-힣\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseFilename = `${safeTitle}-${timestamp}`;

    const imageDir = path.join(process.cwd(), 'scenarios', 'images');

    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true });
    }

    const buffer = Buffer.from(imageData, 'base64');
    const originalSize = buffer.length;

    const originalFilename = `${baseFilename}.webp`;
    const originalPath = path.join(imageDir, originalFilename);

    await sharp(buffer)
      .resize(IMAGE_CONFIG.scenario.original.width, IMAGE_CONFIG.scenario.original.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: IMAGE_CONFIG.scenario.original.quality })
      .toFile(originalPath);

    const thumbnailFilename = `${baseFilename}-thumb.webp`;
    const thumbnailPath = path.join(imageDir, thumbnailFilename);

    await sharp(buffer)
      .resize(IMAGE_CONFIG.scenario.thumbnail.width, IMAGE_CONFIG.scenario.thumbnail.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: IMAGE_CONFIG.scenario.thumbnail.quality })
      .toFile(thumbnailPath);

    const originalStats = fs.statSync(originalPath);
    const thumbnailStats = fs.statSync(thumbnailPath);

    console.log(`📁 이미지 최적화 완료:`);
    console.log(`   원본: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(originalStats.size / 1024).toFixed(0)}KB (${((1 - originalStats.size / originalSize) * 100).toFixed(0)}% 감소)`);
    console.log(`   썸네일: ${(thumbnailStats.size / 1024).toFixed(0)}KB`);

    const webPath = `/scenarios/images/${originalFilename}`;

    return webPath;

  } catch (error) {
    console.error('이미지 로컬 저장 실패:', error);
    throw error;
  }
}

function getThumbnailPath(imagePath: string): string {
  if (!imagePath) return imagePath;

  if (imagePath.endsWith('.webp') && !imagePath.includes('-thumb')) {
    return imagePath.replace('.webp', '-thumb.webp');
  }

  return imagePath;
}

router.post('/generate-preview', asyncHandler(async (req, res) => {
  const { scenarioTitle } = req.body;

  if (!scenarioTitle) {
    throw createHttpError(400, '시나리오 제목이 필요합니다.');
  }

  const simplePrompt = `A minimal, professional illustration representing "${scenarioTitle}", modern business style, clean composition, corporate colors, vector-like appearance`;

  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: 'user', parts: [{ text: simplePrompt }] }]
  });

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

  const { imagePath: localImagePath } = await mediaStorage.saveScenarioImage(imageUrl, scenarioTitle);

  trackImageUsage({
    model: 'gemini-2.5-flash-image',
    provider: 'gemini',
    metadata: { type: 'preview', scenarioTitle }
  });

  const signedImageUrl = await transformToSignedUrl(localImagePath) || localImagePath;

  res.json({
    success: true,
    imageUrl: signedImageUrl,
    storagePath: localImagePath,
    originalImageUrl: imageUrl,
    prompt: simplePrompt,
    isPreview: true,
    metadata: {
      savedLocally: true
    }
  });
}));

router.post('/generate-persona-base', asyncHandler(async (req, res) => {
  const { personaId, mbti, gender, personalityTraits, imageStyle } = req.body;

  if (!personaId || !mbti || !gender) {
    throw createHttpError(400, '페르소나 ID, MBTI, 성별이 필요합니다.');
  }

  const imagePrompt = generatePersonaImagePrompt(
    mbti,
    gender,
    personalityTraits || [],
    imageStyle || ''
  );

  console.log(`🎨 페르소나 기본 이미지 생성 요청: ${personaId} (${mbti}, ${gender})`);
  console.log(`프롬프트: ${imagePrompt}`);

  let result: any;
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
    result = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: 'user', parts: [{ text: imagePrompt }] }]
    });
  } catch (apiError: any) {
    console.error('페르소나 기본 이미지 생성 오류:', apiError);
    if (apiError.message?.includes('quota') || apiError.status === 429) {
      let retryAfter: string | null = null;
      let isFreeTierLimit = false;
      try {
        const parsed = JSON.parse(apiError.message);
        const violations = parsed?.error?.details?.find((d: any) => d['@type']?.includes('QuotaFailure'))?.violations || [];
        isFreeTierLimit = violations.some((v: any) => v.quotaId?.includes('FreeTier'));
        const retryInfo = parsed?.error?.details?.find((d: any) => d['@type']?.includes('RetryInfo'));
        if (retryInfo?.retryDelay) retryAfter = retryInfo.retryDelay;
      } catch {}
      throw Object.assign(createHttpError(429, '요청 한도 초과'), {
        error: '요청 한도 초과',
        details: isFreeTierLimit
          ? 'Gemini 이미지 생성 모델은 유료 API 키가 필요합니다. Google AI Studio에서 결제를 활성화해주세요.'
          : `API 요청 한도를 초과했습니다. ${retryAfter ? retryAfter + ' 후 다시' : '잠시 후'} 시도해주세요.`,
        retryAfter,
        isFreeTierLimit
      });
    }
    throw apiError;
  }

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

  const { imagePath: localImagePath } = await mediaStorage.savePersonaImage(imageUrl, personaId, 'neutral', gender);

  console.log(`✅ 페르소나 기본 이미지 생성 성공: ${localImagePath}`);

  trackImageUsage({
    model: 'gemini-2.5-flash-image',
    provider: 'gemini',
    metadata: { type: 'persona-base', personaId, mbti, gender }
  });

  const signedImageUrl = await transformToSignedUrl(localImagePath) || localImagePath;

  res.json({
    success: true,
    imageUrl: signedImageUrl,
    storagePath: localImagePath,
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
}));

function generatePersonaImagePrompt(
  mbti: string,
  gender: string,
  personalityTraits: string[],
  imageStyle: string
): string {
  const genderEn = gender === 'male' ? 'man' : 'woman';

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

  let traitDescription = '';
  if (personalityTraits && personalityTraits.length > 0) {
    const traitsEn = personalityTraits.slice(0, 2).join(', ');
    traitDescription = `, showing ${traitsEn}`;
  }

  const styleDesc = imageStyle || 'professional business portrait photography';

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

async function savePersonaImageToLocal(
  base64ImageUrl: string,
  personaId: string,
  emotion: string,
  gender: 'male' | 'female' = 'male'
): Promise<string> {
  try {
    if (personaId.includes('..') || personaId.includes('/') || personaId.includes('\\')) {
      throw new Error('Invalid persona ID');
    }

    const matches = base64ImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('유효하지 않은 base64 이미지 형식입니다.');
    }

    const imageData = matches[2];

    const imageDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId, gender);

    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true });
    }

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

    const buffer = Buffer.from(imageData, 'base64');
    const originalSize = buffer.length;

    const { original: origConfig, thumbnail: thumbConfig } = IMAGE_CONFIG.persona;

    const optimizedFilename = `${emotionEn}.webp`;
    const optimizedPath = path.join(imageDir, optimizedFilename);
    await sharp(buffer)
      .resize(origConfig.width, origConfig.height, { fit: 'cover', position: 'center' })
      .webp({ quality: origConfig.quality })
      .toFile(optimizedPath);

    const thumbnailFilename = `${emotionEn}-thumb.webp`;
    const thumbnailPath = path.join(imageDir, thumbnailFilename);
    await sharp(buffer)
      .resize(thumbConfig.width, thumbConfig.height, { fit: 'cover', position: 'center' })
      .webp({ quality: thumbConfig.quality })
      .toFile(thumbnailPath);

    const optimizedSize = fs.statSync(optimizedPath).size;
    const thumbSize = fs.statSync(thumbnailPath).size;
    const savedBytes = originalSize - optimizedSize;
    const savedPercent = ((savedBytes / originalSize) * 100).toFixed(1);

    console.log(`📁 페르소나 이미지 최적화 저장: ${emotionEn}`);
    console.log(`   원본: ${(originalSize/1024).toFixed(0)}KB → 최적화: ${(optimizedSize/1024).toFixed(0)}KB (${savedPercent}% 감소)`);
    console.log(`   썸네일: ${(thumbSize/1024).toFixed(0)}KB`);

    const webPath = `/personas/${personaId}/${gender}/${optimizedFilename}`;

    return webPath;

  } catch (error) {
    console.error('페르소나 이미지 로컬 저장 실패:', error);
    throw error;
  }
}

router.post('/generate-persona-expressions', asyncHandler(async (req, res) => {
  const { personaId, mbti, gender, personalityTraits, imageStyle } = req.body;

  if (!personaId || !mbti || !gender) {
    throw createHttpError(400, '페르소나 ID, MBTI, 성별이 필요합니다.');
  }

  console.log(`🎨 페르소나 표정 이미지 일괄 생성 시작: ${personaId} (${mbti}, ${gender})`);

  const storageKey = `personas/${personaId}/${gender}/neutral.webp`;
  console.log(`📷 기본 이미지 조회: ${storageKey}`);

  let batchBaseBuffer = await mediaStorage.readImageBuffer(storageKey);

  if (!batchBaseBuffer) {
    const baseDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId, gender);
    const fallbackDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId);
    let localPath = '';
    for (const p of [
      path.join(baseDir, 'neutral.webp'),
      path.join(baseDir, 'neutral.png'),
      path.join(fallbackDir, 'neutral.webp'),
      path.join(fallbackDir, 'neutral.png')
    ]) {
      if (fs.existsSync(p)) { localPath = p; break; }
    }

    if (!localPath) {
      throw Object.assign(createHttpError(400, '기본 이미지가 없습니다.'), {
        error: '기본 이미지가 없습니다.',
        details: `먼저 ${gender} 성별의 기본(중립) 이미지를 생성해주세요.`
      });
    }

    batchBaseBuffer = fs.readFileSync(localPath);
    console.log(`📷 로컬 폴백 기본 이미지: ${localPath}`);
  } else {
    console.log(`📷 Object Storage 기본 이미지 로드 성공: ${storageKey}`);
  }

  const baseImageBase64 = batchBaseBuffer.toString('base64');

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
        const { imagePath: localImagePath } = await mediaStorage.savePersonaImage(imageUrl, personaId, emotion.korean, gender);

        const signedImageUrl = await transformToSignedUrl(localImagePath) || localImagePath;

        generatedImages.push({
          emotion: emotion.english,
          emotionKorean: emotion.korean,
          imageUrl: signedImageUrl,
          storagePath: localImagePath,
          success: true
        } as any);

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
}));

router.post('/generate-persona-single-expression', asyncHandler(async (req, res) => {
  const { personaId, mbti, gender, personalityTraits, imageStyle, emotion } = req.body;

  if (!personaId || !mbti || !gender || !emotion) {
    throw createHttpError(400, '페르소나 ID, MBTI, 성별, 표정이 필요합니다.');
  }

  console.log(`🎨 페르소나 단일 표정 이미지 생성: ${personaId} - ${emotion} (${gender})`);

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
    throw Object.assign(createHttpError(400, '지원하지 않는 표정입니다.'), {
      error: '지원하지 않는 표정입니다.',
      validEmotions: Object.keys(emotionMap)
    });
  }

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

    const { imagePath: localImagePath } = await mediaStorage.savePersonaImage(imageUrl, personaId, emotion, gender);

    trackImageUsage({
      model: 'gemini-2.5-flash-image',
      provider: 'gemini',
      metadata: { type: 'persona-single-expression', personaId, emotion, gender }
    });

    const signedImageUrl = await transformToSignedUrl(localImagePath) || localImagePath;

    return res.json({
      success: true,
      emotion,
      emotionEnglish: emotionInfo.english,
      imageUrl: signedImageUrl,
      storagePath: localImagePath,
      metadata: { personaId, mbti, gender, model: "gemini-2.5-flash-image" }
    });
  }

  const singleStorageKey = `personas/${personaId}/${gender}/neutral.webp`;
  console.log(`📷 단일 표정 생성 - 기본 이미지 조회: ${singleStorageKey}`);

  let baseImageBase64 = '';
  const singleBaseBuffer = await mediaStorage.readImageBuffer(singleStorageKey);

  if (singleBaseBuffer) {
    baseImageBase64 = singleBaseBuffer.toString('base64');
    console.log(`📷 Object Storage 기본 이미지 로드 성공: ${singleStorageKey}`);
  } else {
    const baseDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId, gender);
    const fallbackDir = path.join(process.cwd(), 'attached_assets', 'personas', personaId);
    let localPath = '';
    for (const p of [
      path.join(baseDir, 'neutral.webp'),
      path.join(baseDir, 'neutral.png'),
      path.join(fallbackDir, 'neutral.webp'),
      path.join(fallbackDir, 'neutral.png')
    ]) {
      if (fs.existsSync(p)) { localPath = p; break; }
    }

    if (!localPath) {
      throw Object.assign(createHttpError(400, '기본 이미지가 없습니다.'), {
        error: '기본 이미지가 없습니다.',
        details: `먼저 ${gender} 성별의 기본(중립) 이미지를 생성해주세요.`
      });
    }

    baseImageBase64 = fs.readFileSync(localPath).toString('base64');
    console.log(`📷 로컬 폴백 기본 이미지: ${localPath}`);
  }

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

  const { imagePath: localImagePath } = await mediaStorage.savePersonaImage(imageUrl, personaId, emotion, gender);

  trackImageUsage({
    model: 'gemini-2.5-flash-image',
    provider: 'gemini',
    metadata: { type: 'persona-single-expression', personaId, emotion, gender }
  });

  console.log(`✅ ${emotion} 표정 이미지 Object Storage 저장 완료: ${localImagePath}`);

  const signedImageUrl = await transformToSignedUrl(localImagePath) || localImagePath;

  res.json({
    success: true,
    emotion,
    emotionEnglish: emotionInfo.english,
    imageUrl: signedImageUrl,
    storagePath: localImagePath,
    metadata: { personaId, mbti, gender, model: "gemini-2.5-flash-image" }
  });
}));

function generateExpressionImagePrompt(
  mbti: string,
  gender: string,
  personalityTraits: string[],
  imageStyle: string,
  emotionDescription: string
): string {
  const genderEn = gender === 'male' ? 'man' : 'woman';

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

router.post('/optimize-existing-images', asyncHandler(async (req, res) => {
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

      if (file.includes('-thumb')) continue;

      const buffer = fs.readFileSync(filePath);
      const baseFilename = file.replace(/\.(png|jpg|jpeg)$/i, '');

      const optimizedFilename = `${baseFilename}.webp`;
      const optimizedPath = path.join(imageDir, optimizedFilename);

      await sharp(buffer)
        .resize(IMAGE_CONFIG.scenario.original.width, IMAGE_CONFIG.scenario.original.height, {
          fit: 'cover',
          position: 'center'
        })
        .webp({ quality: IMAGE_CONFIG.scenario.original.quality })
        .toFile(optimizedPath);

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
}));

export { saveImageToLocal, savePersonaImageToLocal, getThumbnailPath, generateImagePrompt };
export default router;
