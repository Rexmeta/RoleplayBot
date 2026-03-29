import { Router } from 'express';
import { GoogleGenAI } from "@google/genai";
import { trackImageUsage } from '../services/aiUsageTracker';
import { mediaStorage } from '../services/mediaStorage';
import { transformToSignedUrl } from '../services/gcsStorage';
import { asyncHandler, createHttpError } from './routerHelpers';
import { isAuthenticated } from '../auth';
import { storage } from '../storage';

const router = Router();

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

async function callGeminiImage(prompt: string, referenceBase64?: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const parts: any[] = [];

  if (referenceBase64) {
    parts.push({ inlineData: { mimeType: 'image/webp', data: referenceBase64 } });
  }
  parts.push({ text: prompt });

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: 'user', parts }]
  });

  if (!result.candidates?.[0]?.content?.parts) {
    throw new Error('이미지가 생성되지 않았습니다. Gemini API가 이미지를 반환하지 않았습니다.');
  }

  for (const part of result.candidates[0].content.parts) {
    if (part.inlineData?.data && part.inlineData?.mimeType) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  throw new Error('이미지 데이터를 찾을 수 없습니다.');
}

function buildBasePrompt(name: string, description: string, traits: string[], background: string): string {
  let prompt = `Photorealistic professional portrait photograph of a character`;

  if (description) {
    prompt += `. Character description: ${description}`;
  }
  if (background) {
    prompt += `. Role and background: ${background}`;
  }
  if (traits.length > 0) {
    prompt += `. Key personality traits: ${traits.slice(0, 3).join(', ')}`;
  }

  prompt += `. Head and shoulders portrait, modern office or cozy room background, `;
  prompt += `natural professional lighting, looking at camera with neutral calm expression, `;
  prompt += `sharp focus, high quality photography, professional appearance. `;
  prompt += `NO text, NO speech bubbles, NO captions, NO graphic overlays, NO watermarks.`;

  return prompt;
}

function buildExpressionPrompt(emotionDescription: string): string {
  let prompt = `Generate an image of the EXACT SAME person from the reference image. `;
  prompt += `Keep IDENTICAL: face, facial features, hair, skin tone, clothing, and background environment. `;
  prompt += `ONLY CHANGE: the facial expression to show ${emotionDescription}. `;
  prompt += `The background must remain the SAME as the reference image. `;
  prompt += `Head and shoulders portrait, same background as reference, `;
  prompt += `natural professional lighting, same attire as reference, looking at camera, sharp focus. `;
  prompt += `NO text, NO speech bubbles, NO captions, NO graphic overlays, NO watermarks.`;
  return prompt;
}

const EXPRESSION_MAP: Record<string, { label: string; description: string }> = {
  neutral:      { label: '중립',   description: 'neutral, calm, composed, resting face' },
  happy:        { label: '기쁨',   description: 'joyful, happy, warm smiling broadly' },
  sad:          { label: '슬픔',   description: 'sad, downcast, melancholic, sorrowful' },
  angry:        { label: '분노',   description: 'angry, frustrated, upset, stern' },
  surprised:    { label: '놀람',   description: 'surprised, amazed, astonished, wide-eyed' },
  curious:      { label: '호기심', description: 'curious, interested, intrigued, thoughtful' },
  anxious:      { label: '불안',   description: 'anxious, worried, concerned, uneasy' },
  tired:        { label: '피로',   description: 'tired, weary, exhausted, drooping eyes' },
  disappointed: { label: '실망',   description: 'disappointed, let down, discouraged, dejected' },
  confused:     { label: '당혹',   description: 'confused, bewildered, perplexed, puzzled' },
};

function handleQuotaError(apiError: any): never {
  if (apiError.message?.includes('quota') || apiError.status === 429) {
    let isFreeTierLimit = false;
    let retryAfter: string | null = null;
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
        ? 'Gemini 이미지 생성 모델은 유료 API 키가 필요합니다.'
        : `API 요청 한도를 초과했습니다. ${retryAfter ? retryAfter + ' 후 다시' : '잠시 후'} 시도해주세요.`,
      retryAfter,
      isFreeTierLimit
    });
  }
  throw apiError;
}

router.post('/:id/generate-image', isAuthenticated, asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  const persona = await storage.getUserPersonaById(id);
  if (!persona) throw createHttpError(404, '페르소나를 찾을 수 없습니다.');
  if (persona.creatorId !== userId && req.user?.role !== 'admin') {
    throw createHttpError(403, '이 페르소나를 수정할 권한이 없습니다.');
  }

  const { name, description, personality, customPrompt } = req.body;
  const traits: string[] = personality?.traits || persona.personality?.traits || [];
  const background: string = personality?.background || persona.personality?.background || '';
  const personaName: string = name || persona.name;
  const personaDesc: string = description || persona.description;

  const prompt = customPrompt?.trim()
    ? `Photorealistic professional portrait: ${customPrompt}. Head and shoulders, modern background, natural lighting, neutral expression, sharp focus. NO text, NO watermarks.`
    : buildBasePrompt(personaName, personaDesc, traits, background);

  console.log(`🎨 [UserPersonaImage] 기본 이미지 생성: ${id} (${personaName})`);

  let imageDataUrl: string;
  try {
    imageDataUrl = await callGeminiImage(prompt);
  } catch (err: any) {
    handleQuotaError(err);
  }

  const objectPath = await mediaStorage.saveUserPersonaImage(imageDataUrl!, id, 'neutral');

  await storage.updateUserPersona(id, persona.creatorId, { avatarUrl: objectPath });

  trackImageUsage({
    model: 'gemini-2.5-flash-image',
    provider: 'gemini',
    metadata: { type: 'user-persona-base', personaId: id }
  });

  const signedUrl = await transformToSignedUrl(objectPath) || objectPath;
  console.log(`✅ [UserPersonaImage] 기본 이미지 저장 완료: ${objectPath}`);

  res.json({ success: true, imageUrl: signedUrl, objectPath, prompt });
}));

router.post('/:id/generate-expressions', isAuthenticated, asyncHandler(async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user?.id;

  const persona = await storage.getUserPersonaById(id);
  if (!persona) throw createHttpError(404, '페르소나를 찾을 수 없습니다.');
  if (persona.creatorId !== userId && req.user?.role !== 'admin') {
    throw createHttpError(403, '이 페르소나를 수정할 권한이 없습니다.');
  }

  if (!persona.avatarUrl) {
    throw createHttpError(400, '먼저 기본 이미지를 생성하거나 업로드해주세요.');
  }

  const neutralKey = persona.avatarUrl;
  console.log(`🎨 [UserPersonaImage] 표정 일괄 생성 시작: ${id}, 기준 이미지: ${neutralKey}`);

  let baseBuffer: Buffer | null = null;
  try {
    baseBuffer = await mediaStorage.readImageBuffer(neutralKey);
  } catch {}

  if (!baseBuffer) {
    throw createHttpError(400, '기본 이미지를 읽을 수 없습니다. 이미지를 다시 업로드하거나 생성해주세요.');
  }

  const baseBase64 = baseBuffer.toString('base64');
  const emotionEntries = Object.entries(EXPRESSION_MAP).filter(([key]) => key !== 'neutral');

  const results: Record<string, { objectPath: string; imageUrl: string; success: boolean; error?: string }> = {};

  for (const [emotionKey, emotionInfo] of emotionEntries) {
    try {
      console.log(`  → ${emotionInfo.label} (${emotionKey}) 생성 중...`);
      const prompt = buildExpressionPrompt(emotionInfo.description);
      const imageDataUrl = await callGeminiImage(prompt, baseBase64);
      const objectPath = await mediaStorage.saveUserPersonaImage(imageDataUrl, id, emotionKey);
      const imageUrl = await transformToSignedUrl(objectPath) || objectPath;

      results[emotionKey] = { objectPath, imageUrl, success: true };

      trackImageUsage({
        model: 'gemini-2.5-flash-image',
        provider: 'gemini',
        metadata: { type: 'user-persona-expression', personaId: id, emotion: emotionKey }
      });

      console.log(`  ✅ ${emotionInfo.label} 완료`);
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      console.error(`  ❌ ${emotionInfo.label} 실패:`, err.message);
      results[emotionKey] = { objectPath: '', imageUrl: '', success: false, error: err.message };
    }
  }

  const existingExpressions: Record<string, string> = (persona.expressions as any) || {};
  const neutralPath = existingExpressions.neutral || persona.avatarUrl;
  const newExpressions: Record<string, string> = { ...existingExpressions };
  if (neutralPath) newExpressions.neutral = neutralPath;

  for (const [key, result] of Object.entries(results)) {
    if (result.success && result.objectPath) {
      newExpressions[key] = result.objectPath;
    }
  }

  await storage.updateUserPersona(id, persona.creatorId, { expressions: newExpressions });

  const successCount = Object.values(results).filter(r => r.success).length;
  console.log(`✅ [UserPersonaImage] 표정 일괄 생성 완료: ${successCount}/${emotionEntries.length}`);

  if (res.headersSent) {
    console.warn('[UserPersonaImage] 응답이 이미 전송됨 (타임아웃?), DB는 정상 업데이트됨');
    return;
  }

  res.json({
    success: true,
    generated: successCount,
    total: emotionEntries.length,
    expressions: newExpressions,
    results
  });
}));

router.post('/:id/generate-expression/:emotion', isAuthenticated, asyncHandler(async (req: any, res) => {
  const { id, emotion } = req.params;
  const userId = req.user?.id;

  const emotionInfo = EXPRESSION_MAP[emotion];
  if (!emotionInfo) {
    throw createHttpError(400, `지원하지 않는 표정입니다. 가능한 값: ${Object.keys(EXPRESSION_MAP).join(', ')}`);
  }

  const persona = await storage.getUserPersonaById(id);
  if (!persona) throw createHttpError(404, '페르소나를 찾을 수 없습니다.');
  if (persona.creatorId !== userId && req.user?.role !== 'admin') {
    throw createHttpError(403, '이 페르소나를 수정할 권한이 없습니다.');
  }

  let imageDataUrl: string;

  if (emotion === 'neutral') {
    const { personality: bodyPersonality, customPrompt } = req.body;
    const traits: string[] = bodyPersonality?.traits || persona.personality?.traits || [];
    const background: string = bodyPersonality?.background || persona.personality?.background || '';
    const prompt = customPrompt?.trim()
      ? `Photorealistic portrait: ${customPrompt}. Head and shoulders, neutral expression. NO text, NO watermarks.`
      : buildBasePrompt(persona.name, persona.description, traits, background);

    try {
      imageDataUrl = await callGeminiImage(prompt);
    } catch (err: any) {
      handleQuotaError(err);
    }
  } else {
    if (!persona.avatarUrl) {
      throw createHttpError(400, '먼저 기본 이미지를 생성하거나 업로드해주세요.');
    }

    let baseBuffer: Buffer | null = null;
    try {
      baseBuffer = await mediaStorage.readImageBuffer(persona.avatarUrl);
    } catch {}

    if (!baseBuffer) {
      throw createHttpError(400, '기본 이미지를 읽을 수 없습니다.');
    }

    const prompt = buildExpressionPrompt(emotionInfo.description);
    try {
      imageDataUrl = await callGeminiImage(prompt, baseBuffer.toString('base64'));
    } catch (err: any) {
      handleQuotaError(err);
    }
  }

  const objectPath = await mediaStorage.saveUserPersonaImage(imageDataUrl!, id, emotion);

  const existingExpressions: Record<string, string> = (persona.expressions as any) || {};
  const newExpressions = { ...existingExpressions, [emotion]: objectPath };
  const updates: any = { expressions: newExpressions };
  if (emotion === 'neutral') updates.avatarUrl = objectPath;

  await storage.updateUserPersona(id, persona.creatorId, updates);

  trackImageUsage({
    model: 'gemini-2.5-flash-image',
    provider: 'gemini',
    metadata: { type: 'user-persona-expression', personaId: id, emotion }
  });

  const imageUrl = await transformToSignedUrl(objectPath) || objectPath;
  console.log(`✅ [UserPersonaImage] ${emotionInfo.label} 이미지 생성 완료: ${objectPath}`);

  res.json({ success: true, emotion, objectPath, imageUrl });
}));

export default router;
