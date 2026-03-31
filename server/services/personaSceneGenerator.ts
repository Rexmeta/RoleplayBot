import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const personaSceneSchema = z.object({
  title: z.string().max(200),
  setting: z.string().max(1000),
  mood: z.string().max(500),
  openingLine: z.string().max(1000),
  genre: z.string().max(100),
});

export interface PersonaScene {
  title: string;
  setting: string;
  mood: string;
  openingLine: string;
  genre: string;
}

export interface PersonaSceneGenerateRequest {
  idea: string;
  personaName: string;
  personaDescription?: string;
}

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "" });

function extractText(response: any): string {
  if (typeof response.text === "function") return response.text();
  if (typeof response.text === "string") return response.text;
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts?.[0]?.text) return candidate.content.parts[0].text;
  return "";
}

export async function generateSceneOpeningLine(
  personaName: string,
  scene: { setting: string; mood: string; genre?: string | null },
  personaDescription?: string
): Promise<string> {
  const prompt = `당신은 "${personaName}"라는 AI 캐릭터입니다.
${personaDescription ? `캐릭터 설명: ${personaDescription}` : ""}

지금 다음 장면에서 대화가 시작됩니다:
배경: ${scene.setting}
분위기: ${scene.mood}
${scene.genre ? `장르: ${scene.genre}` : ""}

이 장면에 완전히 몰입하여, 캐릭터로서 사용자에게 건네는 첫 마디(1-2문장)를 한국어로 자연스럽고 몰입감 있게 작성하세요. 장면의 배경과 분위기를 담아야 합니다.

오직 첫 마디 대사만 출력하세요. JSON, 따옴표, 설명 없이 대사 텍스트만.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    config: { maxOutputTokens: 256, temperature: 0.9 },
    contents: prompt,
  });

  const text = extractText(response).trim();
  return text || `안녕하세요. ${scene.setting.slice(0, 30)}... 어떻게 도와드릴까요?`;
}

export async function generatePersonaScene(request: PersonaSceneGenerateRequest): Promise<PersonaScene> {
  const { idea, personaName, personaDescription } = request;

  const prompt = `당신은 창의적인 스토리텔러입니다. 사용자가 AI 페르소나와 대화를 시작할 때 사용할 짧은 장면(Scene)을 생성해주세요.

페르소나 이름: ${personaName}
${personaDescription ? `페르소나 설명: ${personaDescription}` : ""}
사용자 아이디어: ${idea}

위 아이디어를 바탕으로 몰입감 있는 장면을 만들어주세요. 대화 시작 전 배경과 분위기를 설정하고, 페르소나가 자연스럽게 대화를 시작할 수 있도록 오프닝 라인을 포함하세요.

JSON 형식으로 응답:
{
  "title": "장면 제목 (간결하게, 10자 이내)",
  "setting": "배경 설명 (2-3문장, 구체적인 장소·시간·상황)",
  "mood": "분위기 키워드 (예: 긴장감, 로맨틱, 신비로운, 유쾌한, 숙연한 등)",
  "openingLine": "${personaName}의 첫 마디 (자연스럽고 몰입감 있게, 1-2문장)",
  "genre": "장르 (로맨스|판타지|미스터리|SF|일상|직장|학교|역사)"
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          setting: { type: "string" },
          mood: { type: "string" },
          openingLine: { type: "string" },
          genre: { type: "string" },
        },
        required: ["title", "setting", "mood", "openingLine", "genre"],
      },
      maxOutputTokens: 1024,
      temperature: 0.85,
    },
    contents: prompt,
  });

  const raw = extractText(response);
  if (!raw) throw new Error("AI 응답을 받을 수 없습니다.");

  const clean = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error("AI 응답 JSON 파싱 실패");
  }

  const validated = personaSceneSchema.safeParse(parsed);
  if (!validated.success) {
    const partial = parsed as Record<string, unknown>;
    return {
      title: String(partial?.title ?? "새 장면").slice(0, 200),
      setting: String(partial?.setting ?? "").slice(0, 1000),
      mood: String(partial?.mood ?? "").slice(0, 500),
      openingLine: String(partial?.openingLine ?? "").slice(0, 1000),
      genre: String(partial?.genre ?? "일상").slice(0, 100),
    };
  }

  return validated.data;
}
