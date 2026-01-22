import * as fs from 'fs/promises';
import * as path from 'path';
import { ComplexScenario, ScenarioPersona } from '@/lib/scenario-system';
import { enrichPersonaWithMBTI, enrichPersonaWithBasicMBTI } from '../utils/mbtiLoader';
import { storage } from '../storage';

const SCENARIOS_DIR = 'scenarios';
const PERSONAS_DIR = 'personas';

// 데이터베이스 우선 모드 - JSON 파일은 폴백/이미지용으로만 사용
const USE_DATABASE = true;

// 시나리오 카운트 캐시 (카테고리별)
interface ScenarioCountCache {
  counts: Map<string, number>;
  lastUpdated: number;
  ttl: number; // milliseconds
}

const scenarioCountCache: ScenarioCountCache = {
  counts: new Map(),
  lastUpdated: 0,
  ttl: 60 * 1000 // 1분 캐시
};

export class FileManagerService {
  
  // 🚀 경량화된 시나리오 카운트 조회 (캐시 사용) - 데이터베이스 기반
  async getScenarioCountsByCategory(): Promise<Map<string, number>> {
    const now = Date.now();
    
    // 캐시가 유효하면 바로 반환
    if (scenarioCountCache.counts.size > 0 && 
        (now - scenarioCountCache.lastUpdated) < scenarioCountCache.ttl) {
      return scenarioCountCache.counts;
    }
    
    try {
      if (USE_DATABASE) {
        // 데이터베이스에서 시나리오 목록 조회 후 카운트
        const dbScenarios = await storage.getAllScenarios();
        const counts = new Map<string, number>();
        
        for (const scenario of dbScenarios) {
          const categoryId = scenario.categoryId || 'uncategorized';
          counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
        }
        
        // 캐시 업데이트
        scenarioCountCache.counts = counts;
        scenarioCountCache.lastUpdated = now;
        
        return counts;
      }
      
      // 폴백: 파일에서 categoryId만 추출 (경량 파싱)
      const files = await fs.readdir(SCENARIOS_DIR);
      const counts = new Map<string, number>();
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const categoryMatch = content.match(/"categoryId"\s*:\s*"([^"]+)"/);
          if (categoryMatch) {
            const categoryId = categoryMatch[1];
            counts.set(categoryId, (counts.get(categoryId) || 0) + 1);
          } else {
            counts.set('uncategorized', (counts.get('uncategorized') || 0) + 1);
          }
        } catch (error) {
          // 파일 읽기 실패 시 건너뜀
        }
      }
      
      // 캐시 업데이트
      scenarioCountCache.counts = counts;
      scenarioCountCache.lastUpdated = now;
      
      return counts;
    } catch (error) {
      console.error('Failed to get scenario counts:', error);
      return new Map();
    }
  }
  
  // 캐시 무효화 (시나리오 생성/수정/삭제 시 호출)
  invalidateScenarioCountCache(): void {
    scenarioCountCache.lastUpdated = 0;
  }
  
  // 시나리오 관리 - 데이터베이스 기반
  async getAllScenarios(): Promise<ComplexScenario[]> {
    try {
      if (USE_DATABASE) {
        const dbScenarios = await storage.getAllScenarios();
        const scenarios: ComplexScenario[] = [];
        
        for (const dbScenario of dbScenarios) {
          const scenario = this.convertDbScenarioToComplex(dbScenario);
          await this.processScenarioImage(scenario);
          await this.enrichScenarioPersonas(scenario);
          scenarios.push(scenario);
        }
        
        return scenarios;
      }
      
      // 폴백: 파일 시스템에서 로드
      const files = await fs.readdir(SCENARIOS_DIR);
      const scenarios: ComplexScenario[] = [];
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenario = JSON.parse(content);
          await this.processScenarioImage(scenario);
          await this.enrichScenarioPersonas(scenario);
          scenarios.push(scenario);
        } catch (error) {
          console.warn(`Failed to load scenario file ${file}:`, error);
        }
      }
      
      return scenarios;
    } catch (error) {
      console.error('Failed to read scenarios:', error);
      return [];
    }
  }
  
  // DB 스키마를 ComplexScenario 형식으로 변환
  private convertDbScenarioToComplex(dbScenario: any): ComplexScenario {
    return {
      id: dbScenario.id,
      title: dbScenario.title,
      description: dbScenario.description,
      difficulty: dbScenario.difficulty,
      estimatedTime: dbScenario.estimatedTime || undefined,
      skills: dbScenario.skills || [],
      categoryId: dbScenario.categoryId || undefined,
      image: dbScenario.image || undefined,
      imagePrompt: dbScenario.imagePrompt || undefined,
      introVideoUrl: dbScenario.introVideoUrl || undefined,
      videoPrompt: dbScenario.videoPrompt || undefined,
      objectiveType: dbScenario.objectiveType || undefined,
      context: dbScenario.context || undefined,
      objectives: dbScenario.objectives || [],
      successCriteria: dbScenario.successCriteria || undefined,
      personas: dbScenario.personas || [],
      recommendedFlow: dbScenario.recommendedFlow || [],
      evaluationCriteriaSetId: dbScenario.evaluationCriteriaSetId || undefined,
    };
  }
  
  // 시나리오 이미지 처리 (썸네일 생성 등)
  private async processScenarioImage(scenario: any): Promise<void> {
    const defaultPlaceholder = 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=400&fit=crop&auto=format';
    
    if (scenario.image) {
      if (scenario.image.length > 200) {
        scenario.image = defaultPlaceholder;
        scenario.thumbnail = defaultPlaceholder;
      } else if (scenario.image.startsWith('/scenarios/images/')) {
        if (scenario.image.match(/\.(png|jpg|jpeg)$/i)) {
          const thumbnailPath = scenario.image.replace(/\.(png|jpg|jpeg)$/i, '-thumb.webp');
          const fullThumbPath = path.join(process.cwd(), thumbnailPath.slice(1));
          try {
            await fs.access(fullThumbPath);
            scenario.thumbnail = thumbnailPath;
          } catch {
            scenario.thumbnail = scenario.image;
          }
        } else if (scenario.image.endsWith('.webp') && !scenario.image.includes('-thumb')) {
          scenario.thumbnail = scenario.image.replace('.webp', '-thumb.webp');
        } else {
          scenario.thumbnail = scenario.image;
        }
      } else {
        scenario.thumbnail = scenario.image;
      }
    } else {
      scenario.image = defaultPlaceholder;
      scenario.thumbnail = defaultPlaceholder;
    }
  }
  
  // 시나리오 페르소나에 MBTI 정보 추가
  private async enrichScenarioPersonas(scenario: any): Promise<void> {
    if (scenario.personas && Array.isArray(scenario.personas)) {
      const enrichedPersonas = await Promise.all(
        scenario.personas.map(async (persona: any) => {
          if (typeof persona === 'object' && persona.personaRef) {
            return await enrichPersonaWithBasicMBTI(persona, persona.personaRef);
          }
          return persona;
        })
      );
      scenario.personas = enrichedPersonas;
    }
  }

  // 시나리오의 원본 페르소나 정보 가져오기 (MBTI 참조 및 성별 정보 포함)
  async getScenarioPersonas(scenarioId: string): Promise<any[]> {
    try {
      if (USE_DATABASE) {
        const dbScenario = await storage.getScenario(scenarioId);
        if (dbScenario && dbScenario.personas && Array.isArray(dbScenario.personas)) {
          return (dbScenario.personas as any[]).map((persona: any) => ({
            ...persona,
            gender: persona.gender || 'male'
          }));
        }
        return [];
      }
      
      // 폴백: 파일 시스템
      const files = await fs.readdir(SCENARIOS_DIR);
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenario = JSON.parse(content);
          
          if (scenario.id === scenarioId && scenario.personas && Array.isArray(scenario.personas)) {
            if (typeof scenario.personas[0] === 'object') {
              return scenario.personas.map((persona: any) => ({
                ...persona,
                gender: persona.gender || 'male'
              }));
            }
          }
        } catch (error) {
          console.warn(`Failed to read scenario file ${file}:`, error);
        }
      }
      
      return [];
    } catch (error) {
      console.error('Failed to get scenario personas:', error);
      return [];
    }
  }

  async createScenario(scenario: Omit<ComplexScenario, 'id'>): Promise<ComplexScenario> {
    const id = this.generateId(scenario.title);
    const newScenario: ComplexScenario = { ...scenario, id };
    
    if (USE_DATABASE) {
      await storage.createScenario({
        id,
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
        evaluationCriteriaSetId: scenario.evaluationCriteriaSetId || null,
      });
      this.invalidateScenarioCountCache();
      return newScenario;
    }
    
    // 폴백: 파일 시스템
    const fileName = `${id}.json`;
    const filePath = path.join(SCENARIOS_DIR, fileName);
    await fs.writeFile(filePath, JSON.stringify(newScenario, null, 2), 'utf-8');
    this.invalidateScenarioCountCache();
    return newScenario;
  }

  async updateScenario(id: string, scenario: Partial<ComplexScenario>): Promise<ComplexScenario> {
    try {
      if (USE_DATABASE) {
        const existingScenario = await storage.getScenario(id);
        if (!existingScenario) {
          throw new Error(`Scenario ${id} not found`);
        }
        
        const updates: any = {};
        if (scenario.title !== undefined) updates.title = scenario.title;
        if (scenario.description !== undefined) updates.description = scenario.description;
        if (scenario.difficulty !== undefined) updates.difficulty = scenario.difficulty;
        if (scenario.estimatedTime !== undefined) updates.estimatedTime = scenario.estimatedTime;
        if (scenario.skills !== undefined) updates.skills = scenario.skills;
        if (scenario.categoryId !== undefined) updates.categoryId = scenario.categoryId;
        if (scenario.image !== undefined) updates.image = scenario.image;
        if (scenario.imagePrompt !== undefined) updates.imagePrompt = scenario.imagePrompt;
        if (scenario.introVideoUrl !== undefined) updates.introVideoUrl = scenario.introVideoUrl;
        if (scenario.videoPrompt !== undefined) updates.videoPrompt = scenario.videoPrompt;
        if (scenario.objectiveType !== undefined) updates.objectiveType = scenario.objectiveType;
        if (scenario.context !== undefined) updates.context = scenario.context;
        if (scenario.objectives !== undefined) updates.objectives = scenario.objectives;
        if (scenario.successCriteria !== undefined) updates.successCriteria = scenario.successCriteria;
        if (scenario.personas !== undefined) updates.personas = scenario.personas;
        if (scenario.recommendedFlow !== undefined) updates.recommendedFlow = scenario.recommendedFlow;
        if (scenario.evaluationCriteriaSetId !== undefined) updates.evaluationCriteriaSetId = scenario.evaluationCriteriaSetId;
        
        const updated = await storage.updateScenario(id, updates);
        this.invalidateScenarioCountCache();
        return this.convertDbScenarioToComplex(updated);
      }
      
      // 폴백: 파일 시스템
      const files = await fs.readdir(SCENARIOS_DIR);
      let foundFile: string | null = null;
      let existingScenario: ComplexScenario | null = null;
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenarioData = JSON.parse(content) as ComplexScenario;
          if (scenarioData.id === id) {
            foundFile = file;
            existingScenario = scenarioData;
            break;
          }
        } catch (error) {
          console.warn(`Failed to read scenario file ${file}:`, error);
        }
      }
      
      if (!foundFile || !existingScenario) {
        throw new Error(`Scenario ${id} not found`);
      }
      
      const updatedScenario = { ...existingScenario, ...scenario, id };
      const filePath = path.join(SCENARIOS_DIR, foundFile);
      await fs.writeFile(filePath, JSON.stringify(updatedScenario, null, 2), 'utf-8');
      this.invalidateScenarioCountCache();
      return updatedScenario;
    } catch (error) {
      throw new Error(`Scenario ${id} not found: ${error}`);
    }
  }

  async deleteScenario(id: string): Promise<void> {
    try {
      if (USE_DATABASE) {
        await storage.deleteScenario(id);
        this.invalidateScenarioCountCache();
        return;
      }
      
      // 폴백: 파일 시스템
      const files = await fs.readdir(SCENARIOS_DIR);
      let foundFile: string | null = null;
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenarioData = JSON.parse(content) as ComplexScenario;
          if (scenarioData.id === id) {
            foundFile = file;
            break;
          }
        } catch (error) {
          console.warn(`Failed to read scenario file ${file}:`, error);
        }
      }
      
      if (!foundFile) {
        throw new Error(`Scenario ${id} not found`);
      }
      
      const filePath = path.join(SCENARIOS_DIR, foundFile);
      await fs.unlink(filePath);
      this.invalidateScenarioCountCache();
    } catch (error) {
      throw new Error(`Failed to delete scenario ${id}: ${error}`);
    }
  }

  // 페르소나 관리 (시나리오용)
  async getAllPersonas(): Promise<ScenarioPersona[]> {
    try {
      const files = await fs.readdir(PERSONAS_DIR);
      const personas: ScenarioPersona[] = [];
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(PERSONAS_DIR, file), 'utf-8');
          const persona = JSON.parse(content) as ScenarioPersona;
          personas.push(persona);
        } catch (error) {
          console.warn(`Failed to load persona file ${file}:`, error);
        }
      }
      
      return personas;
    } catch (error) {
      console.error('Failed to read personas directory:', error);
      return [];
    }
  }

  // ⚡ 최적화: 특정 MBTI 유형만 로드 (성능 개선)
  async getPersonaByMBTI(mbtiType: string): Promise<ScenarioPersona | null> {
    try {
      const filePath = path.join(PERSONAS_DIR, `${mbtiType.toLowerCase()}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as ScenarioPersona;
    } catch (error) {
      console.warn(`Failed to load MBTI persona ${mbtiType}:`, error);
      return null;
    }
  }

  // MBTI 페르소나 관리 (관리자용) - 데이터베이스 기반
  async getAllMBTIPersonas(): Promise<any[]> {
    try {
      if (USE_DATABASE) {
        const dbPersonas = await storage.getAllMbtiPersonas();
        return dbPersonas.map(p => this.convertDbPersonaToLegacy(p));
      }
      
      // 폴백: 파일 시스템
      const files = await fs.readdir(PERSONAS_DIR);
      const personas: any[] = [];
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(PERSONAS_DIR, file), 'utf-8');
          const persona = JSON.parse(content);
          personas.push(persona);
        } catch (error) {
          console.warn(`Failed to load MBTI persona file ${file}:`, error);
        }
      }
      
      return personas;
    } catch (error) {
      console.error('Failed to read personas:', error);
      return [];
    }
  }
  
  // DB 페르소나를 레거시 형식으로 변환
  private convertDbPersonaToLegacy(dbPersona: any): any {
    return {
      id: dbPersona.id,
      mbti: dbPersona.mbti,
      gender: dbPersona.gender,
      personality_traits: dbPersona.personalityTraits || [],
      communication_style: dbPersona.communicationStyle,
      motivation: dbPersona.motivation,
      fears: dbPersona.fears || [],
      background: dbPersona.background,
      communication_patterns: dbPersona.communicationPatterns,
      voice: dbPersona.voice,
      images: dbPersona.images || null, // 이미지 필드 추가
    };
  }

  // MBTI 페르소나 생성
  async createMBTIPersona(personaData: any): Promise<any> {
    try {
      if (USE_DATABASE) {
        const existing = await storage.getMbtiPersona(personaData.id);
        if (existing) {
          throw new Error(`Persona ${personaData.id} already exists`);
        }
        
        await storage.createMbtiPersona({
          id: personaData.id,
          mbti: personaData.mbti || personaData.id.toUpperCase(),
          gender: personaData.gender || null,
          personalityTraits: personaData.personality_traits || [],
          communicationStyle: personaData.communication_style || null,
          motivation: personaData.motivation || null,
          fears: personaData.fears || [],
          background: personaData.background || null,
          communicationPatterns: personaData.communication_patterns || null,
          voice: personaData.voice || null,
          images: personaData.images || null,
        });
        return personaData;
      }
      
      // 폴백: 파일 시스템
      const fileName = `${personaData.id}.json`;
      const filePath = path.join(PERSONAS_DIR, fileName);
      
      try {
        await fs.access(filePath);
        throw new Error(`Persona ${personaData.id} already exists`);
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      
      await fs.writeFile(filePath, JSON.stringify(personaData, null, 2));
      return personaData;
    } catch (error) {
      throw new Error(`Failed to create MBTI persona: ${error}`);
    }
  }

  // MBTI 페르소나 업데이트
  async updateMBTIPersona(id: string, personaData: any): Promise<any> {
    try {
      if (USE_DATABASE) {
        await storage.updateMbtiPersona(id, {
          mbti: personaData.mbti,
          gender: personaData.gender,
          personalityTraits: personaData.personality_traits,
          communicationStyle: personaData.communication_style,
          motivation: personaData.motivation,
          fears: personaData.fears,
          background: personaData.background,
          communicationPatterns: personaData.communication_patterns,
          voice: personaData.voice,
          images: personaData.images,
        });
        return personaData;
      }
      
      // 폴백: 파일 시스템
      const fileName = `${id}.json`;
      const filePath = path.join(PERSONAS_DIR, fileName);
      await fs.access(filePath);
      
      const newFileName = `${personaData.id}.json`;
      const newFilePath = path.join(PERSONAS_DIR, newFileName);
      await fs.writeFile(newFilePath, JSON.stringify(personaData, null, 2));
      
      if (id !== personaData.id) {
        await fs.unlink(filePath);
      }
      
      return personaData;
    } catch (error) {
      throw new Error(`Failed to update MBTI persona: ${error}`);
    }
  }

  // MBTI 페르소나 삭제
  async deleteMBTIPersona(id: string): Promise<void> {
    try {
      if (USE_DATABASE) {
        await storage.deleteMbtiPersona(id);
        return;
      }
      
      // 폴백: 파일 시스템
      const fileName = `${id}.json`;
      const filePath = path.join(PERSONAS_DIR, fileName);
      await fs.unlink(filePath);
      
      // 페르소나 이미지 디렉토리도 삭제
      await this.deletePersonaExpressionImages(id);
    } catch (error) {
      throw new Error(`Failed to delete MBTI persona: ${error}`);
    }
  }

  // 페르소나 표정 이미지 저장
  async savePersonaExpressionImage(
    personaId: string,
    emotion: string,
    base64Data: string
  ): Promise<string> {
    try {
      // 보안: personaId 및 emotion 검증 (path traversal 방지)
      if (personaId.includes('..') || personaId.includes('/') || personaId.includes('\\')) {
        throw new Error('Invalid persona ID');
      }
      
      const allowedEmotions = ['중립', '기쁨', '슬픔', '분노', '놀람', '호기심', '불안', '피로', '실망', '당혹'];
      if (!allowedEmotions.includes(emotion)) {
        throw new Error('Invalid emotion type');
      }

      // 이미지 저장 디렉토리 생성
      const personaImageDir = path.join('attached_assets', 'personas', personaId);
      await fs.mkdir(personaImageDir, { recursive: true });

      // base64 데이터에서 실제 이미지 데이터 추출
      const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 image data');
      }

      const mimeType = matches[1];
      const imageData = matches[2];
      const extension = mimeType.split('/')[1] || 'png';

      // 이미지 파일 저장
      const emotionEnglishMap: Record<string, string> = {
        '중립': 'neutral',
        '기쁨': 'joy',
        '슬픔': 'sad',
        '분노': 'angry',
        '놀람': 'surprise',
        '호기심': 'curious',
        '불안': 'anxious',
        '피로': 'tired',
        '실망': 'disappointed',
        '당혹': 'confused'
      };

      const fileName = `${emotionEnglishMap[emotion]}.${extension}`;
      const filePath = path.join(personaImageDir, fileName);

      const buffer = Buffer.from(imageData, 'base64');
      await fs.writeFile(filePath, buffer);

      // 웹 액세스 가능한 경로 반환
      const webPath = `/personas/${personaId}/${fileName}`;
      console.log(`✅ Persona expression image saved: ${webPath}`);
      
      return webPath;
    } catch (error) {
      throw new Error(`Failed to save persona expression image: ${error}`);
    }
  }

  // 페르소나의 모든 표정 이미지 경로 조회
  async getPersonaExpressionImages(personaId: string): Promise<Record<string, string>> {
    try {
      // 보안: personaId 검증
      if (personaId.includes('..') || personaId.includes('/') || personaId.includes('\\')) {
        throw new Error('Invalid persona ID');
      }

      const personaImageDir = path.join('attached_assets', 'personas', personaId);
      const expressions: Record<string, string> = {};

      const emotionEnglishMap: Record<string, string> = {
        '중립': 'neutral',
        '기쁨': 'joy',
        '슬픔': 'sad',
        '분노': 'angry',
        '놀람': 'surprise',
        '호기심': 'curious',
        '불안': 'anxious',
        '피로': 'tired',
        '실망': 'disappointed',
        '당혹': 'confused'
      };

      // 디렉토리 존재 확인
      try {
        await fs.access(personaImageDir);
      } catch {
        // 디렉토리가 없으면 빈 객체 반환
        return expressions;
      }

      // 각 표정 이미지 파일 존재 확인
      for (const [korean, english] of Object.entries(emotionEnglishMap)) {
        const extensions = ['png', 'jpg', 'jpeg', 'webp'];
        for (const ext of extensions) {
          const fileName = `${english}.${ext}`;
          const filePath = path.join(personaImageDir, fileName);
          
          try {
            await fs.access(filePath);
            expressions[korean] = `/personas/${personaId}/${fileName}`;
            break;
          } catch {
            // 파일이 없으면 다음 확장자 시도
          }
        }
      }

      return expressions;
    } catch (error) {
      console.error(`Failed to get persona expression images: ${error}`);
      return {};
    }
  }

  // 페르소나 표정 이미지 디렉토리 삭제
  async deletePersonaExpressionImages(personaId: string): Promise<void> {
    try {
      // 보안: personaId 검증
      if (personaId.includes('..') || personaId.includes('/') || personaId.includes('\\')) {
        throw new Error('Invalid persona ID');
      }

      const personaImageDir = path.join('attached_assets', 'personas', personaId);
      
      try {
        await fs.rm(personaImageDir, { recursive: true, force: true });
        console.log(`🗑️ Deleted persona images directory: ${personaImageDir}`);
      } catch (error) {
        // 디렉토리가 없어도 오류 무시
        console.log(`⚠️ No persona images directory to delete: ${personaImageDir}`);
      }
    } catch (error) {
      console.error(`Failed to delete persona expression images: ${error}`);
    }
  }

  // MBTI 기반 페르소나 로딩
  async loadMBTIPersona(mbtiFile: string): Promise<any> {
    try {
      const content = await fs.readFile(path.join(PERSONAS_DIR, mbtiFile), 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`Failed to load MBTI persona ${mbtiFile}:`, error);
      return null;
    }
  }

  // 시나리오에서 persona 정보를 바탕으로 완전한 페르소나 생성
  async createPersonaFromScenario(scenarioPersona: any): Promise<ScenarioPersona | null> {
    try {
      if (!scenarioPersona.personaRef) {
        console.warn('No personaRef found for persona:', scenarioPersona.id);
        return null;
      }

      const mbtiPersona = await this.loadMBTIPersona(scenarioPersona.personaRef);
      if (!mbtiPersona) {
        console.warn('Failed to load MBTI persona:', scenarioPersona.personaRef);
        return null;
      }

      // MBTI 페르소나와 시나리오 정보를 결합하여 완전한 페르소나 생성
      const fullPersona: ScenarioPersona = {
        id: scenarioPersona.id,
        name: scenarioPersona.name || this.generatePersonaName(scenarioPersona.department, scenarioPersona.position, mbtiPersona.mbti),
        role: scenarioPersona.position,
        department: scenarioPersona.department,
        experience: this.generateExperience(scenarioPersona.position),
        image: mbtiPersona.image?.profile || `https://ui-avatars.com/api/?name=${encodeURIComponent(scenarioPersona.id)}&background=6366f1&color=fff&size=150`,
        personality: {
          traits: mbtiPersona.personality_traits || [],
          communicationStyle: mbtiPersona.communication_style || '',
          motivation: mbtiPersona.motivation || '',
          fears: mbtiPersona.fears || []
        },
        background: {
          education: mbtiPersona.background?.education || '',
          previousExperience: mbtiPersona.background?.previous_experience || '',
          majorProjects: mbtiPersona.background?.major_projects || [],
          expertise: mbtiPersona.background?.expertise || []
        },
        currentSituation: {
          workload: scenarioPersona.stance || '',
          pressure: scenarioPersona.goal || '',
          concerns: mbtiPersona.fears || [],
          position: scenarioPersona.position
        },
        communicationPatterns: {
          openingStyle: mbtiPersona.communication_patterns?.opening_style || '',
          keyPhrases: mbtiPersona.communication_patterns?.key_phrases || [],
          responseToArguments: mbtiPersona.communication_patterns?.response_to_arguments || {},
          winConditions: mbtiPersona.communication_patterns?.win_conditions || []
        },
        voice: {
          tone: mbtiPersona.voice?.tone || '',
          pace: mbtiPersona.voice?.pace || '',
          emotion: mbtiPersona.voice?.emotion || ''
        },
        // 시나리오 전용 정보 추가
        stance: scenarioPersona.stance,
        goal: scenarioPersona.goal,
        tradeoff: scenarioPersona.tradeoff,
        mbti: mbtiPersona.mbti
      };

      return fullPersona;
    } catch (error) {
      console.error('Error creating persona from scenario:', error);
      return null;
    }
  }

  private generatePersonaName(department: string, position: string, mbti: string): string {
    const surnames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
    const names = ['민수', '지영', '성호', '예진', '도현', '수연', '준호', '유리', '태현', '소영'];
    const randomSurname = surnames[Math.floor(Math.random() * surnames.length)];
    const randomName = names[Math.floor(Math.random() * names.length)];
    return `${randomSurname}${randomName}`;
  }

  private generateExperience(position: string): string {
    const experienceMap: Record<string, string> = {
      '선임 개발자': '8년차',
      '매니저': '10년차',
      '전문가': '6년차',
      '팀장': '12년차',
      '이사': '15년 이상'
    };
    return experienceMap[position] || '5년차';
  }

  async createPersona(persona: Omit<ScenarioPersona, 'id'>): Promise<ScenarioPersona> {
    const id = this.generateId(persona.name);
    const newPersona: ScenarioPersona = { ...persona, id };
    
    const fileName = `${id}.json`;
    const filePath = path.join(PERSONAS_DIR, fileName);
    
    await fs.writeFile(filePath, JSON.stringify(newPersona, null, 2), 'utf-8');
    return newPersona;
  }

  async updatePersona(id: string, persona: Partial<ScenarioPersona>): Promise<ScenarioPersona> {
    try {
      // 모든 페르소나 파일을 검색해서 ID가 일치하는 파일 찾기
      const files = await fs.readdir(PERSONAS_DIR);
      let foundFile: string | null = null;
      let existingPersona: ScenarioPersona | null = null;
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(PERSONAS_DIR, file), 'utf-8');
          const personaData = JSON.parse(content) as ScenarioPersona;
          if (personaData.id === id) {
            foundFile = file;
            existingPersona = personaData;
            break;
          }
        } catch (error) {
          console.warn(`Failed to read persona file ${file}:`, error);
        }
      }
      
      if (!foundFile || !existingPersona) {
        throw new Error(`Persona ${id} not found`);
      }
      
      const updatedPersona = { ...existingPersona, ...persona, id };
      const filePath = path.join(PERSONAS_DIR, foundFile);
      
      await fs.writeFile(filePath, JSON.stringify(updatedPersona, null, 2), 'utf-8');
      return updatedPersona;
    } catch (error) {
      throw new Error(`Persona ${id} not found: ${error}`);
    }
  }

  async deletePersona(id: string): Promise<void> {
    try {
      // 모든 페르소나 파일을 검색해서 ID가 일치하는 파일 찾기
      const files = await fs.readdir(PERSONAS_DIR);
      let foundFile: string | null = null;
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(PERSONAS_DIR, file), 'utf-8');
          const personaData = JSON.parse(content) as ScenarioPersona;
          if (personaData.id === id) {
            foundFile = file;
            break;
          }
        } catch (error) {
          console.warn(`Failed to read persona file ${file}:`, error);
        }
      }
      
      if (!foundFile) {
        throw new Error(`Persona ${id} not found`);
      }
      
      const filePath = path.join(PERSONAS_DIR, foundFile);
      await fs.unlink(filePath);
    } catch (error) {
      throw new Error(`Failed to delete persona ${id}: ${error}`);
    }
  }

  // 유틸리티 메서드
  private generateId(name: string): string {
    // 한글-영어 키워드 맵핑
    const koreanToEnglishMap: {[key: string]: string} = {
      '프로젝트': 'project', '지연': 'delay', '갈등': 'conflict', 
      '협상': 'negotiation', '회의': 'meeting', '위기': 'crisis',
      '앱': 'app', '개발': 'dev', '마케팅': 'marketing', '품질': 'quality',
      '출시': 'launch', '일정': 'schedule', '물류': 'logistics', 
      '마비': 'paralysis', '손상': 'damage', '폭설': 'snow', 
      '제조': 'manufacturing', '생산': 'production', '납기': 'delivery',
      '신제품': 'new-product', '내부': 'internal', '이슈': 'issue',
      '출고': 'shipping', '재작업': 'rework', '검수': 'inspection',
      '구조적': 'structural', '결함': 'defect', '안전': 'safety',
      '고객': 'customer', '서비스': 'service', '팀': 'team',
      '관리': 'management', '시스템': 'system', '데이터': 'data',
      '보안': 'security', '네트워크': 'network', '서버': 'server',
      '사용자': 'user', '인터페이스': 'interface', '디자인': 'design',
      '계획': 'plan', '예산': 'budget', '비용': 'cost',
      '효율': 'efficiency', '성능': 'performance', '최적화': 'optimization',
      '신규': 'new', '런칭': 'launch', '캠페인': 'campaign', '연기': 'delay'
    };
    
    // 제목을 단어로 분리하고 변환
    const keywords = name
      .replace(/[^\w\s가-힣]/g, '') // 특수문자 제거
      .split(/\s+/) // 공백으로 분리
      .filter(word => word.length > 1) // 한 글자 단어 제거
      .slice(0, 3) // 최대 3개 키워드
      .map(word => {
        // 전체 단어를 영어로 변환하거나, 없으면 한글 그대로 사용
        const lowerWord = word.toLowerCase();
        return koreanToEnglishMap[word] || lowerWord;
      })
      .join('-');
    
    // 생성 일시 추가 (중복 방지용)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const baseId = keywords || 'scenario';
    
    return `${baseId}-${timestamp}`;
  }
}

export const fileManager = new FileManagerService();