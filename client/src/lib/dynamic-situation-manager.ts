import type { PersonaStatus, PersonaSelection, ConversationMessage } from '../../../shared/schema';
import type { ScenarioPersona } from './scenario-system';

/**
 * 동적 상황 관리 엔진
 * 대화 결과에 따라 다른 페르소나들의 상태를 업데이트합니다
 */
export class DynamicSituationManager {
  /**
   * 대화 결과를 분석하여 다른 페르소나들의 상태를 업데이트합니다
   */
  static updatePersonaStatuses(
    currentPersonaId: string,
    conversationMessages: ConversationMessage[],
    personaStatuses: PersonaStatus[],
    scenarioContext: any
  ): PersonaStatus[] {
    const conversationResult = this.analyzeConversationResult(conversationMessages);
    const updatedStatuses = [...personaStatuses];
    
    // 현재 대화한 페르소나의 상태 업데이트
    const currentPersonaIndex = updatedStatuses.findIndex(p => p.personaId === currentPersonaId);
    if (currentPersonaIndex !== -1) {
      updatedStatuses[currentPersonaIndex] = {
        ...updatedStatuses[currentPersonaIndex],
        hasBeenContacted: true,
        lastInteractionResult: conversationResult.success,
        currentMood: conversationResult.mood,
        approachability: this.calculateNewApproachability(
          updatedStatuses[currentPersonaIndex], 
          conversationResult
        )
      };
    }
    
    // 다른 페르소나들의 상태를 대화 결과에 따라 조정
    for (let i = 0; i < updatedStatuses.length; i++) {
      if (updatedStatuses[i].personaId !== currentPersonaId) {
        updatedStatuses[i] = this.updateRelatedPersonaStatus(
          updatedStatuses[i],
          currentPersonaId,
          conversationResult,
          scenarioContext
        );
      }
    }
    
    return updatedStatuses;
  }
  
  /**
   * 대화 내용을 분석하여 결과를 도출합니다
   */
  private static analyzeConversationResult(messages: ConversationMessage[]): ConversationResult {
    const userMessages = messages.filter(m => m.sender === 'user');
    const aiMessages = messages.filter(m => m.sender === 'ai');
    
    if (userMessages.length === 0 || aiMessages.length === 0) {
      return {
        success: 'neutral',
        mood: 'neutral',
        informationGained: [],
        conflictLevel: 0,
        cooperationLevel: 3,
        trustLevel: 3
      };
    }
    
    // 대화 성공도 분석
    let successScore = 3; // 기본값
    let moodScore = 3; // 기본값 (neutral)
    const informationGained: string[] = [];
    let conflictLevel = 0;
    let cooperationLevel = 3;
    let trustLevel = 3;
    
    // AI의 감정 상태 분석
    const emotions = aiMessages
      .filter(msg => msg.emotion)
      .map(msg => msg.emotion!);
    
    const positiveEmotions = emotions.filter(e => 
      ['기쁨', '만족', '긍정', 'positive'].some(pos => e.includes(pos))
    ).length;
    
    const negativeEmotions = emotions.filter(e => 
      ['분노', '실망', '부정', 'negative'].some(neg => e.includes(neg))
    ).length;
    
    // 사용자 메시지 품질 분석
    const avgUserMessageLength = userMessages.reduce((sum, msg) => sum + msg.message.length, 0) / userMessages.length;
    
    if (avgUserMessageLength > 50) successScore += 1;
    if (avgUserMessageLength < 20) successScore -= 1;
    
    // 예의와 존중 표현 체크
    const politenessKeywords = ['감사', '죄송', '부탁', '도움', '이해', '존중'];
    const politenessCount = userMessages.reduce((count, msg) => {
      return count + politenessKeywords.filter(keyword => msg.message.includes(keyword)).length;
    }, 0);
    
    if (politenessCount > 2) {
      successScore += 1;
      trustLevel += 1;
    }
    
    // 감정 기반 점수 조정
    if (positiveEmotions > negativeEmotions) {
      successScore += 1;
      moodScore += 1;
      cooperationLevel += 1;
    } else if (negativeEmotions > positiveEmotions) {
      successScore -= 1;
      moodScore -= 1;
      conflictLevel += 1;
    }
    
    // 정보 획득 분석 (키워드 기반)
    const infoKeywords = ['정보', '상황', '문제', '해결', '계획', '방법', '의견', '생각'];
    for (const msg of aiMessages) {
      for (const keyword of infoKeywords) {
        if (msg.message.includes(keyword)) {
          informationGained.push(`${keyword} 관련 정보`);
        }
      }
    }
    
    // 최종 결과 결정
    const success: 'success' | 'neutral' | 'failure' = 
      successScore >= 4 ? 'success' : 
      successScore <= 2 ? 'failure' : 'neutral';
    
    const mood: 'positive' | 'neutral' | 'negative' = 
      moodScore >= 4 ? 'positive' : 
      moodScore <= 2 ? 'negative' : 'neutral';
    
    return {
      success,
      mood,
      informationGained: [...new Set(informationGained)], // 중복 제거
      conflictLevel: Math.min(5, Math.max(0, conflictLevel)),
      cooperationLevel: Math.min(5, Math.max(1, cooperationLevel)),
      trustLevel: Math.min(5, Math.max(1, trustLevel))
    };
  }
  
  /**
   * 새로운 접근성 점수를 계산합니다
   */
  private static calculateNewApproachability(
    persona: PersonaStatus, 
    result: ConversationResult
  ): number {
    let newApproachability = persona.approachability;
    
    switch (result.success) {
      case 'success':
        newApproachability = Math.min(5, newApproachability + 0.5);
        break;
      case 'failure':
        newApproachability = Math.max(1, newApproachability - 1);
        break;
    }
    
    return Math.round(newApproachability * 2) / 2; // 0.5 단위로 반올림
  }
  
  /**
   * 관련 페르소나들의 상태를 업데이트합니다
   */
  private static updateRelatedPersonaStatus(
    persona: PersonaStatus,
    talkedPersonaId: string,
    result: ConversationResult,
    scenarioContext: any
  ): PersonaStatus {
    const updatedPersona = { ...persona };
    
    // 인맥 관계가 있는 경우 영향 받음
    const isRelated = persona.keyRelationships.some(rel => 
      rel.includes(this.getPersonaNameById(talkedPersonaId, scenarioContext))
    );
    
    if (isRelated) {
      // 관련된 사람의 대화 결과에 따라 기분과 접근성 조정
      switch (result.success) {
        case 'success':
          if (updatedPersona.currentMood === 'negative') {
            updatedPersona.currentMood = 'neutral';
          } else if (updatedPersona.currentMood === 'neutral') {
            updatedPersona.currentMood = 'positive';
          }
          updatedPersona.approachability = Math.min(5, updatedPersona.approachability + 0.3);
          break;
        case 'failure':
          if (updatedPersona.currentMood === 'positive') {
            updatedPersona.currentMood = 'neutral';
          } else if (updatedPersona.currentMood === 'neutral') {
            updatedPersona.currentMood = 'negative';
          }
          updatedPersona.approachability = Math.max(1, updatedPersona.approachability - 0.5);
          break;
      }
    }
    
    // 갈등 상황에서의 상태 변화
    if (result.conflictLevel > 3) {
      updatedPersona.approachability = Math.max(1, updatedPersona.approachability - 0.2);
    }
    
    // 협력적인 상황에서의 상태 변화
    if (result.cooperationLevel > 4) {
      updatedPersona.approachability = Math.min(5, updatedPersona.approachability + 0.2);
    }
    
    // 반올림 처리
    updatedPersona.approachability = Math.round(updatedPersona.approachability * 2) / 2;
    
    return updatedPersona;
  }
  
  /**
   * 페르소나 ID로 이름 찾기 (헬퍼 메서드)
   */
  private static getPersonaNameById(personaId: string, scenarioContext: any): string {
    // 시나리오 컨텍스트에서 페르소나 이름 찾기
    const persona = scenarioContext?.personas?.find((p: any) => p.id === personaId);
    return persona?.name || '';
  }
  
  /**
   * 시나리오 기반으로 초기 페르소나 상태를 생성합니다
   */
  static generateInitialPersonaStatuses(
    personas: ScenarioPersona[],
    scenarioContext: any
  ): PersonaStatus[] {
    return personas.map((persona, index) => {
      // 시나리오 특성에 따른 초기 상태 설정
      const baseApproachability = this.calculateBaseApproachability(persona, scenarioContext);
      const baseInfluence = this.calculateBaseInfluence(persona, scenarioContext);
      const initialMood = this.determineInitialMood(persona, scenarioContext);
      const availableInfo = this.generateAvailableInfo(persona, scenarioContext);
      const relationships = this.generateKeyRelationships(persona, personas, scenarioContext);
      
      return {
        personaId: persona.id,
        name: persona.name,
        currentMood: initialMood,
        approachability: baseApproachability,
        influence: baseInfluence,
        hasBeenContacted: false,
        availableInfo,
        keyRelationships: relationships
      };
    });
  }
  
  /**
   * 기본 접근성 점수 계산
   */
  private static calculateBaseApproachability(persona: ScenarioPersona, scenarioContext: any): number {
    let score = 3; // 기본값
    
    // 직급에 따른 조정
    if (persona.position?.includes('부장') || persona.position?.includes('이사')) {
      score -= 1;
    } else if (persona.position?.includes('과장') || persona.position?.includes('팀장')) {
      score -= 0.5;
    } else if (persona.position?.includes('사원') || persona.position?.includes('주임')) {
      score += 0.5;
    }
    
    // 성격에 따른 조정 (MBTI 기반)
    if (persona.personality?.includes('외향') || persona.personality?.includes('E')) {
      score += 0.5;
    }
    if (persona.personality?.includes('내향') || persona.personality?.includes('I')) {
      score -= 0.5;
    }
    
    return Math.min(5, Math.max(1, Math.round(score * 2) / 2));
  }
  
  /**
   * 기본 영향력 점수 계산
   */
  private static calculateBaseInfluence(persona: ScenarioPersona, scenarioContext: any): number {
    let score = 3; // 기본값
    
    // 직급에 따른 영향력
    if (persona.position?.includes('이사') || persona.position?.includes('본부장')) {
      score = 5;
    } else if (persona.position?.includes('부장') || persona.position?.includes('팀장')) {
      score = 4;
    } else if (persona.position?.includes('과장') || persona.position?.includes('선임')) {
      score = 3;
    } else {
      score = 2;
    }
    
    // 부서에 따른 조정
    if (persona.department?.includes('경영') || persona.department?.includes('전략')) {
      score += 0.5;
    }
    
    return Math.min(5, Math.max(1, Math.round(score * 2) / 2));
  }
  
  /**
   * 초기 기분 상태 결정
   */
  private static determineInitialMood(
    persona: ScenarioPersona, 
    scenarioContext: any
  ): 'positive' | 'neutral' | 'negative' | 'unknown' {
    // 시나리오 상황의 심각성에 따라 초기 기분 결정
    const situation = scenarioContext?.situation?.toLowerCase() || '';
    
    if (situation.includes('위기') || situation.includes('문제') || situation.includes('갈등')) {
      return Math.random() < 0.6 ? 'negative' : 'neutral';
    } else if (situation.includes('성공') || situation.includes('좋은') || situation.includes('기회')) {
      return Math.random() < 0.6 ? 'positive' : 'neutral';
    } else {
      // 무작위로 다양한 초기 상태 설정
      const rand = Math.random();
      if (rand < 0.2) return 'positive';
      if (rand < 0.7) return 'neutral';
      if (rand < 0.9) return 'negative';
      return 'unknown';
    }
  }
  
  /**
   * 보유 정보 생성
   */
  private static generateAvailableInfo(persona: ScenarioPersona, scenarioContext: any): string[] {
    const info: string[] = [];
    
    // 직급별 정보 접근 권한
    if (persona.position?.includes('이사') || persona.position?.includes('부장')) {
      info.push('전략적 결정 정보', '예산 관련 정보', '인사 정보');
    }
    
    if (persona.position?.includes('팀장') || persona.position?.includes('과장')) {
      info.push('팀 운영 정보', '프로젝트 진행 상황', '팀원 성과');
    }
    
    // 부서별 전문 정보
    if (persona.department?.includes('개발') || persona.department?.includes('기술')) {
      info.push('기술적 문제점', '개발 일정', '시스템 현황');
    }
    
    if (persona.department?.includes('영업') || persona.department?.includes('마케팅')) {
      info.push('고객 반응', '시장 상황', '매출 현황');
    }
    
    if (persona.department?.includes('인사') || persona.department?.includes('HR')) {
      info.push('직원 만족도', '조직 문화', '채용 현황');
    }
    
    // 시나리오 특화 정보 추가
    const contextInfo = this.extractScenarioSpecificInfo(scenarioContext);
    info.push(...contextInfo);
    
    return info.slice(0, 4); // 최대 4개 정보만 유지
  }
  
  /**
   * 주요 관계 생성
   */
  private static generateKeyRelationships(
    persona: ScenarioPersona, 
    allPersonas: ScenarioPersona[],
    scenarioContext: any
  ): string[] {
    const relationships: string[] = [];
    
    // 같은 부서 사람들과의 관계
    const sameDeptPersonas = allPersonas.filter(p => 
      p.id !== persona.id && p.department === persona.department
    );
    
    sameDeptPersonas.forEach(p => {
      relationships.push(`${p.name} (같은 부서)`);
    });
    
    // 직급 관계 (상하관계)
    const seniors = allPersonas.filter(p => 
      p.id !== persona.id && this.isHigherPosition(p.position || '', persona.position || '')
    );
    
    seniors.slice(0, 2).forEach(p => {
      relationships.push(`${p.name} (상급자)`);
    });
    
    return relationships.slice(0, 3); // 최대 3개 관계만 유지
  }
  
  /**
   * 직급 비교 헬퍼 메서드
   */
  private static isHigherPosition(pos1: string, pos2: string): boolean {
    const hierarchy = ['사원', '주임', '대리', '과장', '차장', '부장', '이사', '상무', '전무'];
    
    const pos1Level = hierarchy.findIndex(level => pos1.includes(level));
    const pos2Level = hierarchy.findIndex(level => pos2.includes(level));
    
    return pos1Level > pos2Level && pos1Level !== -1 && pos2Level !== -1;
  }
  
  /**
   * 시나리오 특화 정보 추출
   */
  private static extractScenarioSpecificInfo(scenarioContext: any): string[] {
    const info: string[] = [];
    
    if (scenarioContext?.situation) {
      if (scenarioContext.situation.includes('프로젝트')) {
        info.push('프로젝트 세부사항');
      }
      if (scenarioContext.situation.includes('예산')) {
        info.push('예산 배정 현황');
      }
      if (scenarioContext.situation.includes('일정')) {
        info.push('스케줄 관련 정보');
      }
      if (scenarioContext.situation.includes('고객')) {
        info.push('고객 요구사항');
      }
    }
    
    return info;
  }
}

/**
 * 대화 결과 분석 타입
 */
interface ConversationResult {
  success: 'success' | 'neutral' | 'failure';
  mood: 'positive' | 'neutral' | 'negative';
  informationGained: string[];
  conflictLevel: number; // 0-5
  cooperationLevel: number; // 1-5  
  trustLevel: number; // 1-5
}