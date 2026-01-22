import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { mbtiPersonas } from "../../shared/schema";
import * as fs from 'fs';
import * as path from 'path';

const databaseUrl = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});
const db = drizzle(pool);

const emotionMapping: Record<string, string> = {
  'neutral': '중립',
  'joy': '기쁨',
  'sad': '슬픔',
  'angry': '분노',
  'surprise': '놀람',
  'anxious': '불안',
  'confused': '당혹',
  'disappointed': '실망',
  'determined': '단호',
  'curious': '호기심',
  'tired': '피곤'
};

async function syncPersonaImages() {
  console.log('🔄 Starting persona image sync...\n');
  
  const personasDir = path.join(process.cwd(), 'attached_assets', 'personas');
  
  const personas = await db.select().from(mbtiPersonas);
  let syncedCount = 0;
  let skippedCount = 0;
  
  for (const persona of personas) {
    const personaDir = path.join(personasDir, persona.id.toLowerCase());
    
    if (!fs.existsSync(personaDir)) {
      console.log(`⏭️ Skipping ${persona.id}: No image directory`);
      skippedCount++;
      continue;
    }
    
    const currentImages = persona.images as any;
    const gender = persona.gender?.toLowerCase() || 'male';
    
    const existingExpressions = currentImages?.[gender]?.expressions || {};
    const hasValidExpressions = Object.values(existingExpressions).some((v: any) => v && v.length > 0);
    
    if (hasValidExpressions) {
      console.log(`⏭️ Skipping ${persona.id}: Already has images in DB`);
      skippedCount++;
      continue;
    }
    
    const genderDir = path.join(personaDir, gender);
    
    if (!fs.existsSync(genderDir)) {
      console.log(`⏭️ Skipping ${persona.id}: No ${gender} directory`);
      skippedCount++;
      continue;
    }
    
    const files = fs.readdirSync(genderDir)
      .filter(f => f.endsWith('.webp') && !f.includes('-thumb'));
    
    if (files.length === 0) {
      console.log(`⏭️ Skipping ${persona.id}: No webp files`);
      skippedCount++;
      continue;
    }
    
    const expressions: Record<string, string> = {};
    const timestamp = Date.now();
    
    for (const file of files) {
      const emotionEn = file.replace('.webp', '');
      const emotionKr = emotionMapping[emotionEn];
      
      if (emotionKr) {
        expressions[emotionKr] = `/personas/${persona.id.toLowerCase()}/${gender}/${file}?t=${timestamp}`;
      }
    }
    
    const newImages = {
      base: expressions['중립'] || '',
      style: currentImages?.style || '',
      male: {
        expressions: gender === 'male' ? expressions : {}
      },
      female: {
        expressions: gender === 'female' ? expressions : {}
      }
    };
    
    await db.update(mbtiPersonas)
      .set({ images: newImages })
      .where(eq(mbtiPersonas.id, persona.id));
    
    console.log(`✅ Synced ${persona.id} (${gender}): ${Object.keys(expressions).length} expressions`);
    syncedCount++;
  }
  
  console.log(`\n🎉 Sync complete! Synced: ${syncedCount}, Skipped: ${skippedCount}`);
  await pool.end();
  process.exit(0);
}

syncPersonaImages().catch(console.error);
