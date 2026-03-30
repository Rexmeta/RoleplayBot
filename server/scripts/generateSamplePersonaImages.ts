import { db } from '../storage';
import { userPersonas } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
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

async function callGeminiImage(prompt: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('No Gemini API key found');
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: prompt + '. Head and shoulders portrait, looking at camera. NO text, NO speech bubbles, NO captions, NO watermarks.' }] }],
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

export async function generateSamplePersonaImages(forceRegenerate = false): Promise<void> {
  console.log('🎨 샘플 페르소나 AI 이미지 생성 시작...');

  const personas = await db.select({
    id: userPersonas.id,
    name: userPersonas.name,
    avatarUrl: userPersonas.avatarUrl,
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

    if (alreadyInStorage && !forceRegenerate) {
      console.log(`  ⏭ 이미 오브젝트 스토리지에 있음, 스킵: ${persona.name}`);
      skipped++;
      continue;
    }

    try {
      console.log(`  🖼 이미지 생성 중: ${persona.name}...`);
      const imageDataUrl = await callGeminiImage(prompt);

      if (!imageDataUrl) {
        console.error(`  ❌ 이미지 생성 실패: ${persona.name}`);
        failed++;
        continue;
      }

      const objectPath = await mediaStorage.saveUserPersonaImage(imageDataUrl, persona.id, 'neutral');

      await db.update(userPersonas)
        .set({ avatarUrl: objectPath, updatedAt: new Date() })
        .where(eq(userPersonas.id, persona.id));

      console.log(`  ✅ 이미지 저장 완료: ${persona.name} → ${objectPath}`);
      generated++;

      await new Promise(r => setTimeout(r, 1500));
    } catch (err: any) {
      console.error(`  ❌ 오류 발생 (${persona.name}):`, err.message);
      failed++;
    }
  }

  console.log(`📊 샘플 페르소나 이미지 생성 완료: ${generated}개 생성, ${skipped}개 스킵, ${failed}개 실패`);
}
