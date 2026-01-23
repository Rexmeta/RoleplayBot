import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { scenarioTranslations, scenarios } from "../../shared/schema";
import { eq, and } from "drizzle-orm";

const databaseUrl = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});
const db = drizzle(pool);
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("No API key found");
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey });

async function translateJapaneseToKorean(text: string): Promise<string> {
  if (!text || text.trim() === "") return text;
  
  const prompt = `Translate the following Japanese text to natural Korean. 
This is content for a workplace training scenario, so use appropriate business Korean.
Only return the translated text, nothing else.

Japanese text:
${text}`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt
  });
  return (result.text || "").trim();
}

async function translateArrayToKorean(arr: unknown): Promise<string[] | null> {
  if (!arr) return null;
  
  let items: string[] = [];
  
  if (typeof arr === 'string') {
    if (arr.startsWith('{') && arr.endsWith('}')) {
      const content = arr.slice(1, -1);
      items = content.split(',').map(s => s.trim()).filter(s => s.length > 0);
    } else {
      try {
        const parsed = JSON.parse(arr);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        return null;
      }
    }
  } else if (Array.isArray(arr)) {
    items = arr as string[];
  } else {
    return null;
  }
  
  if (items.length === 0) return null;
  
  const translated = await Promise.all(
    items.map(item => translateJapaneseToKorean(String(item)))
  );
  
  return translated;
}

async function restoreScenario(scenarioId: string) {
  console.log(`\n=== Processing scenario: ${scenarioId} ===`);
  
  const jaTranslation = await db.select().from(scenarioTranslations)
    .where(and(
      eq(scenarioTranslations.scenarioId, scenarioId),
      eq(scenarioTranslations.locale, "ja")
    ));
  
  if (!jaTranslation || jaTranslation.length === 0) {
    console.log(`No Japanese translation found for ${scenarioId}`);
    return null;
  }
  
  const ja = jaTranslation[0];
  console.log(`Found Japanese translation: ${ja.title}`);
  
  console.log("Translating title...");
  const koTitle = await translateJapaneseToKorean(ja.title || "");
  console.log(`  -> ${koTitle}`);
  
  console.log("Translating description...");
  const koDescription = await translateJapaneseToKorean(ja.description || "");
  console.log(`  -> ${koDescription.substring(0, 50)}...`);
  
  console.log("Translating situation...");
  const koSituation = await translateJapaneseToKorean(ja.situation || "");
  
  console.log("Translating player role...");
  const koPlayerRole = await translateJapaneseToKorean(ja.playerRole || "");
  
  console.log("Translating objectives...");
  const koObjectivesArr = await translateArrayToKorean(ja.objectives);
  const koObjectives = koObjectivesArr || (ja.objectives as string[] | null);
  
  console.log("Translating timeline...");
  const koTimeline = await translateJapaneseToKorean(ja.timeline || "");
  
  console.log("Translating stakes...");
  const koStakes = await translateJapaneseToKorean(ja.stakes || "");
  
  console.log("Translating success criteria...");
  const koOptimal = await translateJapaneseToKorean(ja.successCriteriaOptimal || "");
  const koGood = await translateJapaneseToKorean(ja.successCriteriaGood || "");
  const koAcceptable = await translateJapaneseToKorean(ja.successCriteriaAcceptable || "");
  const koFailure = await translateJapaneseToKorean(ja.successCriteriaFailure || "");
  
  console.log("Updating Korean translation in database...");
  await db.update(scenarioTranslations)
    .set({
      title: koTitle,
      description: koDescription,
      situation: koSituation,
      playerRole: koPlayerRole,
      objectives: koObjectives,
      timeline: koTimeline,
      stakes: koStakes,
      successCriteriaOptimal: koOptimal,
      successCriteriaGood: koGood,
      successCriteriaAcceptable: koAcceptable,
      successCriteriaFailure: koFailure,
      isMachineTranslated: true,
      isReviewed: false,
      updatedAt: new Date()
    })
    .where(and(
      eq(scenarioTranslations.scenarioId, scenarioId),
      eq(scenarioTranslations.locale, "ko")
    ));
  
  console.log("Updating main scenarios table...");
  await db.update(scenarios)
    .set({
      title: koTitle,
      description: koDescription,
    })
    .where(eq(scenarios.id, scenarioId));
  
  console.log(`✅ Successfully restored Korean for: ${koTitle}`);
  return koTitle;
}

async function main() {
  const scenariosToRestore = [
    "launch-6주-대형-2025-12-17T04-51-16"
  ];
  
  console.log("Starting Korean original restoration from Japanese translations...\n");
  
  for (const scenarioId of scenariosToRestore) {
    try {
      await restoreScenario(scenarioId);
    } catch (error) {
      console.error(`Error restoring ${scenarioId}:`, error);
    }
  }
  
  console.log("\n=== Restoration complete ===");
  process.exit(0);
}

main();
