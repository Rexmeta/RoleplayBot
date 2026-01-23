import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { scenarios, scenarioTranslations } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function migrateScenarioTranslations() {
  console.log('🔄 Starting scenario translations migration...');
  
  try {
    const allScenarios = await db.select().from(scenarios);
    console.log(`📋 Found ${allScenarios.length} scenarios to migrate`);
    
    let migrated = 0;
    let skipped = 0;
    
    for (const scenario of allScenarios) {
      const sourceLocale = scenario.sourceLocale || 'ko';
      
      const existingOriginal = await db.select()
        .from(scenarioTranslations)
        .where(and(
          eq(scenarioTranslations.scenarioId, scenario.id),
          eq(scenarioTranslations.isOriginal, true)
        ));
      
      if (existingOriginal.length > 0) {
        console.log(`⏭️ Skipping ${scenario.id} - already has original translation`);
        skipped++;
        continue;
      }
      
      const existingLocaleTranslation = await db.select()
        .from(scenarioTranslations)
        .where(and(
          eq(scenarioTranslations.scenarioId, scenario.id),
          eq(scenarioTranslations.locale, sourceLocale)
        ));
      
      if (existingLocaleTranslation.length > 0) {
        await db.update(scenarioTranslations)
          .set({ isOriginal: true })
          .where(eq(scenarioTranslations.id, existingLocaleTranslation[0].id));
        console.log(`✅ Updated ${scenario.id} - marked existing ${sourceLocale} translation as original`);
        migrated++;
        continue;
      }
      
      const context = scenario.context as any;
      const successCriteria = scenario.successCriteria as any;
      
      await db.insert(scenarioTranslations).values({
        scenarioId: scenario.id,
        locale: sourceLocale,
        sourceLocale: sourceLocale,
        isOriginal: true,
        title: scenario.title,
        description: scenario.description,
        situation: context?.situation || null,
        timeline: context?.timeline || null,
        stakes: context?.stakes || null,
        playerRole: context?.playerRole ? 
          `${context.playerRole.position || ''} / ${context.playerRole.department || ''}` : null,
        objectives: scenario.objectives || null,
        skills: scenario.skills || null,
        successCriteriaOptimal: successCriteria?.optimal || null,
        successCriteriaGood: successCriteria?.good || null,
        successCriteriaAcceptable: successCriteria?.acceptable || null,
        successCriteriaFailure: successCriteria?.failure || null,
        isMachineTranslated: false,
        isReviewed: true,
      });
      
      console.log(`✅ Migrated ${scenario.id} - created original ${sourceLocale} translation`);
      migrated++;
    }
    
    console.log(`\n🎉 Migration complete!`);
    console.log(`   Migrated: ${migrated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${allScenarios.length}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

migrateScenarioTranslations()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
