import { db } from '../storage';
import { userPersonas } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { GoogleGenAI, type Part } from '@google/genai';
import { mediaStorage } from '../services/mediaStorage';

const SYSTEM_CREATOR_ID = 'system';

const IMAGE_PROMPTS: Record<string, string> = {
  'sample-alex': 'Photorealistic portrait of a friendly American college student in his early 20s, wearing a casual hoodie and backpack, warm smile, energetic and approachable expression, campus background, natural lighting, high quality photography, sharp focus',
  'sample-emma': 'Professional photorealistic portrait of a confident female career coach in her 30s, wearing a smart blazer, warm encouraging smile, modern office background, professional lighting, polished appearance, high quality photography',
  'sample-kai': 'Photorealistic sci-fi illustration portrait of a futuristic space explorer in his 30s, wearing a sleek spacesuit, curious wonder-filled expression, galaxy and stars in background, dramatic cinematic lighting, high quality digital art',
  'sample-sophia': 'Photorealistic portrait of an elegant female philosopher and professor in her 40s, wearing academic attire, thoughtful and intellectual expression, library background with books, warm studio lighting, high quality photography',
  'sample-jake': 'Photorealistic portrait of an energetic male sports commentator in his late 20s, wearing a sports jersey, excited passionate expression, stadium lights background, dynamic lighting, high quality photography',
  'sample-luna': 'Fantasy illustration portrait of a mystical female archmage wizard in her 30s, wearing flowing magical robes and silver crown, enigmatic ethereal expression, magical glowing background with arcane symbols, dramatic fantasy lighting, high quality digital art',
  'sample-dr-chen': 'Photorealistic portrait of a distinguished male physics professor in his 40s wearing academic attire and glasses, enthusiastic intellectual expression, laboratory or chalkboard background, professional warm lighting, high quality photography',
  'sample-marco': 'Photorealistic portrait of a ruggedly handsome Italian male travel photographer in his 30s, wearing adventure gear, warm adventurous expression, exotic travel destination background, natural golden hour lighting, high quality photography',
  'sample-aria': 'Photorealistic portrait of a glamorous young female pop star in her mid-20s, stylish modern outfit, bubbly enthusiastic expression, colorful stage lights background, dramatic celebrity lighting, high quality photography',
  'sample-captain-blackwood': 'Photorealistic portrait of a charismatic male pirate captain in 18th century attire, tricorn hat, weathered distinguished appearance, bold adventurous expression, wooden ship deck background, dramatic golden sunset lighting, high quality digital art',
};

const EXPRESSION_DESCRIPTIONS: Record<string, string> = {
  happy:        'joyful, happy, warm smiling broadly',
  sad:          'sad, downcast, melancholic, sorrowful',
  angry:        'angry, frustrated, upset, stern',
  surprised:    'surprised, amazed, astonished, wide-eyed',
  curious:      'curious, interested, intrigued, thoughtful',
  anxious:      'anxious, worried, concerned, uneasy',
  tired:        'tired, weary, exhausted, drooping eyes',
  disappointed: 'disappointed, let down, discouraged, dejected',
  confused:     'confused, bewildered, perplexed, puzzled',
  determined:   'determined, resolute, focused, strong-willed',
};

async function callGeminiImage(prompt: string, referenceBase64?: string, referenceMimeType?: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('No Gemini API key found');
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const parts: Part[] = [];
    if (referenceBase64) {
      parts.push({ inlineData: { mimeType: (referenceMimeType || 'image/webp') as any, data: referenceBase64 } });
    }
    parts.push({ text: prompt + '. Head and shoulders portrait, looking at camera. NO text, NO speech bubbles, NO captions, NO watermarks.' });

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts }],
    });

    if (!result.candidates?.[0]?.content?.parts) return null;

    for (const part of result.candidates[0].content.parts) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (err: any) {
    console.error('Gemini image generation failed:', err.message);
    return null;
  }
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

export async function generateSamplePersonaImages(forceRegenerate = false, forceExpressionsOnly = false): Promise<void> {
  console.log(`🎨 샘플 페르소나 AI 이미지 생성 시작... (forceRegenerate=${forceRegenerate}, forceExpressionsOnly=${forceExpressionsOnly})`);

  const personas = await db.select({
    id: userPersonas.id,
    name: userPersonas.name,
    avatarUrl: userPersonas.avatarUrl,
    expressions: userPersonas.expressions,
  }).from(userPersonas).where(eq(userPersonas.creatorId, SYSTEM_CREATOR_ID));

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const persona of personas) {
    const prompt = IMAGE_PROMPTS[persona.id];
    if (!prompt) {
      console.log(`  ⏭ 프롬프트 없음, 스킵: ${persona.name}`);
      skipped++;
      continue;
    }

    const alreadyInStorage = persona.avatarUrl &&
      persona.avatarUrl.startsWith('user-personas/');

    let neutralBuffer: Buffer | null = null;
    let neutralMimeType: string = 'image/webp';
    let neutralPath: string | null = alreadyInStorage ? persona.avatarUrl : null;

    // forceExpressionsOnly: neutral 스킵하고 표정만 재생성 (neutral은 항상 storage에서 로드)
    if (alreadyInStorage && (!forceRegenerate || forceExpressionsOnly)) {
      console.log(`  ⏭ neutral 이미 오브젝트 스토리지에 있음, 스킵: ${persona.name}`);
      if (!forceExpressionsOnly) skipped++;
      try {
        neutralBuffer = await mediaStorage.readImageBuffer(persona.avatarUrl!);
        neutralMimeType = 'image/webp'; // 스토리지에 저장된 이미지는 항상 webp
      } catch {
        neutralBuffer = null;
      }
    } else {
      try {
        console.log(`  🖼 neutral 이미지 생성 중: ${persona.name}...`);
        const imageDataUrl = await callGeminiImage(prompt);

        if (!imageDataUrl) {
          console.error(`  ❌ neutral 이미지 생성 실패: ${persona.name}`);
          failed++;
          continue;
        }

        // Gemini가 반환한 실제 mimeType을 추출 (이후 표정 생성 시 정확한 타입 전달)
        const mimeMatch = imageDataUrl.match(/^data:([^;]+);base64,/);
        neutralMimeType = mimeMatch?.[1] || 'image/webp';

        neutralPath = await mediaStorage.saveUserPersonaImage(imageDataUrl, persona.id, 'neutral');

        await db.update(userPersonas)
          .set({ avatarUrl: neutralPath, updatedAt: new Date() })
          .where(eq(userPersonas.id, persona.id));

        console.log(`  ✅ neutral 이미지 저장 완료: ${persona.name} → ${neutralPath} (${neutralMimeType})`);
        generated++;

        const base64Data = imageDataUrl.replace(/^data:[^;]+;base64,/, '');
        neutralBuffer = Buffer.from(base64Data, 'base64');

        await new Promise(r => setTimeout(r, 1500));
      } catch (err: any) {
        console.error(`  ❌ neutral 오류 발생 (${persona.name}):`, err.message);
        failed++;
        continue;
      }
    }

    if (!neutralBuffer && neutralPath) {
      try {
        neutralBuffer = await mediaStorage.readImageBuffer(neutralPath);
      } catch {
        neutralBuffer = null;
      }
    }

    if (!neutralBuffer) {
      console.log(`  ⚠ 베이스 이미지 버퍼 없음, 표정 생성 스킵: ${persona.name}`);
      continue;
    }

    const existingExpressions: Record<string, string> =
      persona.expressions !== null && typeof persona.expressions === 'object' && !Array.isArray(persona.expressions)
        ? (persona.expressions as Record<string, string>)
        : {};

    for (const [emotion, description] of Object.entries(EXPRESSION_DESCRIPTIONS)) {
      if (!forceRegenerate && !forceExpressionsOnly && existingExpressions[emotion]) {
        console.log(`  ⏭ 표정 이미 존재, 스킵: ${persona.name} / ${emotion}`);
        continue;
      }

      try {
        console.log(`  🖼 표정 이미지 생성 중: ${persona.name} / ${emotion}...`);
        const expressionPrompt = buildExpressionPrompt(description);
        const expressionDataUrl = await callGeminiImage(expressionPrompt, neutralBuffer.toString('base64'), neutralMimeType);

        if (!expressionDataUrl) {
          console.error(`  ❌ 표정 이미지 생성 실패: ${persona.name} / ${emotion}`);
          failed++;
          continue;
        }

        const expressionPath = await mediaStorage.saveUserPersonaImage(expressionDataUrl, persona.id, emotion);

        existingExpressions[emotion] = expressionPath;
        await db.update(userPersonas)
          .set({ expressions: existingExpressions, updatedAt: new Date() })
          .where(eq(userPersonas.id, persona.id));

        console.log(`  ✅ 표정 이미지 저장 완료: ${persona.name} / ${emotion} → ${expressionPath}`);
        generated++;

        await new Promise(r => setTimeout(r, 1500));
      } catch (err: any) {
        console.error(`  ❌ 표정 오류 발생 (${persona.name} / ${emotion}):`, err.message);
        failed++;
      }
    }
  }

  console.log(`📊 샘플 페르소나 이미지 생성 완료: ${generated}개 생성, ${skipped}개 스킵, ${failed}개 실패`);
}
