import * as fs from 'fs/promises';
import * as path from 'path';
import { storage } from '../storage';

const SCENARIOS_DIR = 'scenarios';
const PERSONAS_DIR = 'personas';

async function migrateScenarios() {
  console.log('🔄 시나리오 마이그레이션 시작...');
  
  try {
    const files = await fs.readdir(SCENARIOS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    let migrated = 0;
    let skipped = 0;
    
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(SCENARIOS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const scenario = JSON.parse(content);
        
        const existingScenario = await storage.getScenario(scenario.id);
        if (existingScenario) {
          console.log(`⏭️ 이미 존재: ${scenario.id}`);
          skipped++;
          continue;
        }
        
        await storage.createScenario({
          id: scenario.id,
          title: scenario.title,
          description: scenario.description,
          difficulty: scenario.difficulty || 2,
          estimatedTime: scenario.estimatedTime || null,
          skills: scenario.skills || [],
          categoryId: scenario.categoryId || null,
          image: scenario.image || null,
          imagePrompt: scenario.imagePrompt || null,
          introVideoUrl: scenario.introVideoUrl || null,
          videoPrompt: scenario.videoPrompt || null,
          objectiveType: scenario.objectiveType || null,
          context: scenario.context || null,
          objectives: scenario.objectives || [],
          successCriteria: scenario.successCriteria || null,
          personas: scenario.personas || [],
          recommendedFlow: scenario.recommendedFlow || [],
        });
        
        console.log(`✅ 마이그레이션 완료: ${scenario.id}`);
        migrated++;
      } catch (err) {
        console.error(`❌ 파일 처리 실패 ${file}:`, err);
      }
    }
    
    console.log(`📊 시나리오 마이그레이션 결과: ${migrated}개 완료, ${skipped}개 스킵`);
  } catch (err) {
    console.error('❌ 시나리오 마이그레이션 실패:', err);
  }
}

async function migratePersonas() {
  console.log('🔄 페르소나 마이그레이션 시작...');
  
  try {
    const files = await fs.readdir(PERSONAS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    let migrated = 0;
    let skipped = 0;
    
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(PERSONAS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const persona = JSON.parse(content);
        
        const personaId = persona.id || file.replace('.json', '');
        
        const existingPersona = await storage.getMbtiPersona(personaId);
        if (existingPersona) {
          console.log(`⏭️ 이미 존재: ${personaId}`);
          skipped++;
          continue;
        }
        
        await storage.createMbtiPersona({
          id: personaId,
          mbti: persona.mbti || personaId.toUpperCase(),
          gender: persona.gender || null,
          personalityTraits: persona.personality_traits || [],
          communicationStyle: persona.communication_style || null,
          motivation: persona.motivation || null,
          fears: persona.fears || [],
          background: persona.background || null,
          communicationPatterns: persona.communication_patterns || null,
          voice: persona.voice || null,
        });
        
        console.log(`✅ 마이그레이션 완료: ${personaId}`);
        migrated++;
      } catch (err) {
        console.error(`❌ 파일 처리 실패 ${file}:`, err);
      }
    }
    
    console.log(`📊 페르소나 마이그레이션 결과: ${migrated}개 완료, ${skipped}개 스킵`);
  } catch (err) {
    console.error('❌ 페르소나 마이그레이션 실패:', err);
  }
}

async function main() {
  console.log('🚀 JSON → DB 마이그레이션 시작');
  console.log('================================');
  
  await migratePersonas();
  console.log('');
  await migrateScenarios();
  
  console.log('');
  console.log('================================');
  console.log('✅ 마이그레이션 완료!');
}

main().catch(console.error);
