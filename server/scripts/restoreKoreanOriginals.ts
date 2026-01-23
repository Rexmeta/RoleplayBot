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

async function translateToKorean(text: string, sourceLang: string): Promise<string> {
  if (!text || text.trim() === "") return text;
  
  const langName = sourceLang === 'ja' ? 'Japanese' : sourceLang === 'zh' ? 'Chinese' : 'English';
  
  const prompt = `Translate the following ${langName} text to natural Korean. 
This is content for a workplace training scenario, so use appropriate business Korean.
Only return the translated text, nothing else.

${langName} text:
${text}`;

  const result = await genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: prompt
  });
  return (result.text || "").trim();
}

async function translateArrayToKorean(arr: unknown, sourceLang: string): Promise<string[] | null> {
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
    items.map(item => translateToKorean(String(item), sourceLang))
  );
  
  return translated;
}

async function restoreScenario(scenarioId: string, sourceLang: string) {
  console.log(`\n=== Processing scenario: ${scenarioId} (from ${sourceLang}) ===`);
  
  const sourceTranslation = await db.select().from(scenarioTranslations)
    .where(and(
      eq(scenarioTranslations.scenarioId, scenarioId),
      eq(scenarioTranslations.locale, sourceLang)
    ));
  
  if (!sourceTranslation || sourceTranslation.length === 0) {
    console.log(`No ${sourceLang} translation found for ${scenarioId}`);
    return null;
  }
  
  const source = sourceTranslation[0];
  console.log(`Found ${sourceLang} translation: ${source.title}`);
  
  console.log("Translating title...");
  const koTitle = await translateToKorean(source.title || "", sourceLang);
  console.log(`  -> ${koTitle}`);
  
  console.log("Translating description...");
  const koDescription = await translateToKorean(source.description || "", sourceLang);
  console.log(`  -> ${koDescription.substring(0, 50)}...`);
  
  console.log("Translating situation...");
  const koSituation = await translateToKorean(source.situation || "", sourceLang);
  
  console.log("Translating player role...");
  const koPlayerRole = await translateToKorean(source.playerRole || "", sourceLang);
  
  console.log("Translating objectives...");
  const koObjectivesArr = await translateArrayToKorean(source.objectives, sourceLang);
  const koObjectives = koObjectivesArr || (source.objectives as string[] | null);
  
  console.log("Translating timeline...");
  const koTimeline = await translateToKorean(source.timeline || "", sourceLang);
  
  console.log("Translating stakes...");
  const koStakes = await translateToKorean(source.stakes || "", sourceLang);
  
  console.log("Translating success criteria...");
  const koOptimal = await translateToKorean(source.successCriteriaOptimal || "", sourceLang);
  const koGood = await translateToKorean(source.successCriteriaGood || "", sourceLang);
  const koAcceptable = await translateToKorean(source.successCriteriaAcceptable || "", sourceLang);
  const koFailure = await translateToKorean(source.successCriteriaFailure || "", sourceLang);
  
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
  const scenariosToRestore: { id: string, sourceLang: string }[] = [
    { id: "new-product-론칭-임박-2025-11-18T04-43-28", sourceLang: "en" },
    { id: "코드-리뷰-터진-2026-01-21T04-34-21", sourceLang: "en" }
  ];
  
  console.log("Starting Korean restoration from English translations...\n");
  
  for (const { id, sourceLang } of scenariosToRestore) {
    try {
      await restoreScenario(id, sourceLang);
    } catch (error) {
      console.error(`Error restoring ${id}:`, error);
    }
  }
  
  console.log("\n=== Restoration complete ===");
  process.exit(0);
}

main();
