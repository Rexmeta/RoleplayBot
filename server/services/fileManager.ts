import * as fs from 'fs/promises';
import * as path from 'path';
import { ComplexScenario, ScenarioPersona } from '@/lib/scenario-system';
import { enrichPersonaWithMBTI, enrichPersonaWithBasicMBTI } from '../utils/mbtiLoader';

const SCENARIOS_DIR = 'scenarios';
const PERSONAS_DIR = 'personas';

export class FileManagerService {
  
  // 시나리오 관리
  async getAllScenarios(): Promise<ComplexScenario[]> {
    try {
      const files = await fs.readdir(SCENARIOS_DIR);
      const scenarios: ComplexScenario[] = [];
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenario = JSON.parse(content);
          
          // 🚀 성능 최적화: 시나리오 목록 조회 시 base64 이미지 제거
          // base64 이미지는 수 MB에 달해 로딩 속도 저하 원인
          if (scenario.image && scenario.image.length > 200) {
            // 긴 base64 이미지는 placeholder로 대체
            scenario.image = 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=400&fit=crop&auto=format';
          }
          
          // 시나리오 목록 조회 시에는 가벼운 MBTI 정보만 포함 (mbti만)
          // 실제 대화 시작 시점에 선택된 페르소나의 전체 MBTI 데이터를 로드
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
          
          scenarios.push(scenario);
        } catch (error) {
          console.warn(`Failed to load scenario file ${file}:`, error);
        }
      }
      
      return scenarios;
    } catch (error) {
      console.error('Failed to read scenarios directory:', error);
      return [];
    }
  }

  // 시나리오의 원본 페르소나 정보 가져오기 (MBTI 참조 포함)
  async getScenarioPersonas(scenarioId: string): Promise<any[]> {
    try {
      const files = await fs.readdir(SCENARIOS_DIR);
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        try {
          const content = await fs.readFile(path.join(SCENARIOS_DIR, file), 'utf-8');
          const scenario = JSON.parse(content);
          
          if (scenario.id === scenarioId && scenario.personas && Array.isArray(scenario.personas)) {
            // 새 구조의 페르소나 정보 반환
            if (typeof scenario.personas[0] === 'object') {
              return scenario.personas;
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
    
    const fileName = `${id}.json`;
    const filePath = path.join(SCENARIOS_DIR, fileName);
    
    await fs.writeFile(filePath, JSON.stringify(newScenario, null, 2), 'utf-8');
    return newScenario;
  }

  async updateScenario(id: string, scenario: Partial<ComplexScenario>): Promise<ComplexScenario> {
    try {
      // 모든 시나리오 파일을 검색해서 ID가 일치하는 파일 찾기
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
      return updatedScenario;
    } catch (error) {
      throw new Error(`Scenario ${id} not found: ${error}`);
    }
  }

  async deleteScenario(id: string): Promise<void> {
    try {
      // 모든 시나리오 파일을 검색해서 ID가 일치하는 파일 찾기
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

  // MBTI 페르소나 관리 (관리자용)
  async getAllMBTIPersonas(): Promise<any[]> {
    try {
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
      console.error('Failed to read personas directory:', error);
      return [];
    }
  }

  // MBTI 페르소나 생성
  async createMBTIPersona(personaData: any): Promise<any> {
    try {
      const fileName = `${personaData.id}.json`;
      const filePath = path.join(PERSONAS_DIR, fileName);
      
      // 이미 존재하는지 확인
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
      const fileName = `${id}.json`;
      const filePath = path.join(PERSONAS_DIR, fileName);
      
      // 파일이 존재하는지 확인
      await fs.access(filePath);
      
      // ID가 변경된 경우 파일 이름도 변경
      const newFileName = `${personaData.id}.json`;
      const newFilePath = path.join(PERSONAS_DIR, newFileName);
      
      await fs.writeFile(newFilePath, JSON.stringify(personaData, null, 2));
      
      // ID가 변경된 경우 기존 파일 삭제
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
      const fileName = `${id}.json`;
      const filePath = path.join(PERSONAS_DIR, fileName);
      
      await fs.unlink(filePath);
    } catch (error) {
      throw new Error(`Failed to delete MBTI persona: ${error}`);
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