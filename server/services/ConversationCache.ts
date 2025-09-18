import type { ScenarioPersona } from './aiService';
import { FileManagerService } from './fileManager';

// ComplexScenario 타입 정의
interface ComplexScenario {
  id: string;
  title: string;
  context?: {
    situation: string;
  };
  objectives?: string[];
  personas: any[];
}

/**
 * 대화별 캐싱 시스템 - DB 조회 최적화
 * 시나리오와 페르소나 데이터를 메모리에 캐싱하여 반복 조회 방지
 */
export class ConversationCache {
  private static scenarioCache = new Map<string, ComplexScenario>();
  private static personaCache = new Map<string, ScenarioPersona>();
  private static mbtiCache = new Map<string, any>();
  private static fileManager = new FileManagerService();

  /**
   * 대화 ID로 필요한 모든 데이터를 한 번에 가져오기 (캐싱 적용)
   * @param conversationId 대화 ID
   * @param scenarioId 시나리오 ID  
   * @param personaId 페르소나 ID
   * @param mbtiType MBTI 타입
   */
  static async getConversationData(
    conversationId: string,
    scenarioId: string, 
    personaId: string,
    mbtiType?: string
  ): Promise<{
    scenario: ComplexScenario;
    persona: any;
    mbtiPersona: any;
  }> {
    console.log(`🔄 캐시 확인 중... 대화: ${conversationId}`);

    // 병렬로 필요한 데이터 조회 (캐시 확인 후 필요시에만 DB 접근)
    const [scenario, mbtiPersona] = await Promise.all([
      this.getScenarioData(scenarioId),
      mbtiType ? this.getMBTIData(mbtiType) : Promise.resolve(null)
    ]);

    // 시나리오에서 페르소나 찾기
    const scenarioPersona = scenario.personas.find((p: any) => p.id === personaId);
    if (!scenarioPersona) {
      throw new Error(`Persona not found: ${personaId}`);
    }

    // 페르소나 데이터 구성 (캐싱 적용)
    const persona = this.buildPersonaObject(scenarioPersona, mbtiPersona);
    
    console.log(`✅ 캐시된 데이터 반환: ${scenario.title}, ${persona.name}`);

    return { scenario, persona, mbtiPersona };
  }

  /**
   * 시나리오 데이터 캐싱 및 조회
   */
  private static async getScenarioData(scenarioId: string): Promise<ComplexScenario> {
    if (this.scenarioCache.has(scenarioId)) {
      console.log(`⚡ 시나리오 캐시 적중: ${scenarioId}`);
      return this.scenarioCache.get(scenarioId)!;
    }

    console.log(`📁 시나리오 DB 조회: ${scenarioId}`);
    const scenarios = await this.fileManager.getAllScenarios();
    const scenario = scenarios.find((s: any) => s.id === scenarioId);
    
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }

    // 캐싱
    this.scenarioCache.set(scenarioId, scenario);
    console.log(`💾 시나리오 캐시 저장: ${scenarioId}`);
    
    return scenario;
  }

  /**
   * MBTI 데이터 캐싱 및 조회
   */
  private static async getMBTIData(mbtiType: string): Promise<any> {
    if (this.mbtiCache.has(mbtiType)) {
      console.log(`⚡ MBTI 캐시 적중: ${mbtiType}`);
      return this.mbtiCache.get(mbtiType)!;
    }

    console.log(`📁 MBTI DB 조회: ${mbtiType}`);
    const mbtiPersona = await this.fileManager.getPersonaByMBTI(mbtiType);
    
    if (mbtiPersona) {
      // 캐싱
      this.mbtiCache.set(mbtiType, mbtiPersona);
      console.log(`💾 MBTI 캐시 저장: ${mbtiType}`);
    }
    
    return mbtiPersona;
  }

  /**
   * 페르소나 객체 빌드 (캐싱 적용)
   */
  private static buildPersonaObject(scenarioPersona: any, mbtiPersona: any): any {
    const personaKey = `${scenarioPersona.id}_${mbtiPersona?.mbti || 'default'}`;
    
    if (this.personaCache.has(personaKey)) {
      console.log(`⚡ 페르소나 캐시 적중: ${personaKey}`);
      return this.personaCache.get(personaKey)!;
    }

    const persona = {
      id: scenarioPersona.id,
      name: scenarioPersona.name,
      role: scenarioPersona.position,
      department: scenarioPersona.department,
      personality: mbtiPersona?.communication_style || '균형 잡힌 의사소통',
      responseStyle: mbtiPersona?.communication_patterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
      goals: mbtiPersona?.communication_patterns?.win_conditions || ['목표 달성'],
      background: mbtiPersona?.background?.personal_values?.join(', ') || '전문성',
      
      // 추가 최적화: 자주 사용되는 데이터 미리 계산
      mbti: mbtiPersona?.mbti,
      communicationStyle: mbtiPersona?.communication_style,
      stance: scenarioPersona.stance || '상황에 따른 대응',
      goal: scenarioPersona.goal || '최적의 결과 도출'
    };

    // 캐싱
    this.personaCache.set(personaKey, persona);
    console.log(`💾 페르소나 캐시 저장: ${personaKey}`);
    
    return persona;
  }

  /**
   * 압축된 시나리오 컨텍스트 생성 (토큰 수 최적화)
   */
  static getCompactScenarioContext(scenario: ComplexScenario): string {
    // 기존 500+ 토큰을 100 토큰 이하로 압축
    const situation = scenario.context?.situation || '업무 상황';
    const objectives = scenario.objectives?.slice(0, 2).join(', ') || '문제 해결'; // 최대 2개만
    
    return `상황: ${situation.substring(0, 50)}. 목표: ${objectives.substring(0, 30)}`;
  }

  /**
   * 압축된 MBTI 컨텍스트 생성
   */
  static getCompactMBTIContext(mbtiPersona: any): string {
    if (!mbtiPersona) return '';
    
    return `MBTI: ${mbtiPersona.mbti}. 스타일: ${mbtiPersona.communication_style?.substring(0, 20) || ''}`;
  }

  /**
   * 캐시 통계 조회 (디버깅용)
   */
  static getCacheStats(): {
    scenarios: number;
    personas: number;
    mbti: number;
  } {
    return {
      scenarios: this.scenarioCache.size,
      personas: this.personaCache.size,
      mbti: this.mbtiCache.size
    };
  }

  /**
   * 캐시 초기화 (메모리 관리용)
   */
  static clearCache(): void {
    this.scenarioCache.clear();
    this.personaCache.clear();
    this.mbtiCache.clear();
    console.log('🗑️ 모든 캐시가 초기화되었습니다.');
  }

  /**
   * 특정 대화의 캐시만 제거
   */
  static clearConversationCache(scenarioId: string, personaId: string): void {
    this.scenarioCache.delete(scenarioId);
    
    // 해당 페르소나와 관련된 캐시 제거
    for (const [key] of Array.from(this.personaCache)) {
      if (key.startsWith(personaId)) {
        this.personaCache.delete(key);
      }
    }
    
    console.log(`🗑️ 대화 관련 캐시 제거: ${scenarioId}, ${personaId}`);
  }
}