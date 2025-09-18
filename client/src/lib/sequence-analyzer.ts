import type { PersonaSelection, StrategyChoice, PersonaStatus, SequenceAnalysis } from '../../../shared/schema';

/**
 * AC 인바스켓 스타일의 전략적 선택 분석기
 * 대화 순서와 선택의 논리성을 평가합니다
 */
export class SequenceLogicAnalyzer {
  /**
   * 페르소나 선택 순서의 논리성을 분석합니다
   */
  static analyzeSelectionOrder(
    selections: PersonaSelection[],
    personaStatuses: PersonaStatus[],
    scenarioContext: any
  ): SequenceAnalysis {
    const selectionOrder = selections.map((_, index) => index + 1);
    const optimalOrder = this.calculateOptimalOrder(personaStatuses, scenarioContext);
    
    // 각 평가 요소별 점수 계산
    const orderScore = this.evaluateOrderLogic(selections, personaStatuses, scenarioContext);
    const reasoningQuality = this.evaluateReasoningQuality(selections);
    const strategicThinking = this.evaluateStrategicThinking(selections, scenarioContext);
    const adaptability = this.evaluateAdaptability(selections, personaStatuses);
    
    const overallEffectiveness = Math.round(
      (orderScore + reasoningQuality + strategicThinking + adaptability) / 4
    );
    
    return {
      selectionOrder,
      optimalOrder,
      orderScore,
      reasoningQuality,
      strategicThinking,
      adaptability,
      overallEffectiveness,
      detailedAnalysis: this.generateDetailedAnalysis(selections, personaStatuses, scenarioContext),
      improvements: this.generateImprovements(orderScore, reasoningQuality, strategicThinking, adaptability),
      strengths: this.generateStrengths(orderScore, reasoningQuality, strategicThinking, adaptability)
    };
  }
  
  /**
   * 최적의 대화 순서를 계산합니다
   */
  private static calculateOptimalOrder(personaStatuses: PersonaStatus[], scenarioContext: any): number[] {
    // 시나리오 맥락에 따른 가중치 설정
    const weights = {
      influence: 0.3,      // 영향력
      approachability: 0.25, // 접근 용이성
      information: 0.25,   // 보유 정보의 중요성
      relationships: 0.2   // 인맥 관계
    };
    
    // 각 페르소나에 대한 우선순위 점수 계산
    const priorityScores = personaStatuses.map((persona, index) => ({
      index: index + 1,
      score: this.calculatePriorityScore(persona, weights, scenarioContext),
      persona
    }));
    
    // 점수순으로 정렬하여 최적 순서 반환
    return priorityScores
      .sort((a, b) => b.score - a.score)
      .map(item => item.index);
  }
  
  /**
   * 페르소나별 우선순위 점수 계산
   */
  private static calculatePriorityScore(
    persona: PersonaStatus, 
    weights: any, 
    scenarioContext: any
  ): number {
    let score = 0;
    
    // 영향력 점수
    score += persona.influence * weights.influence;
    
    // 접근 용이성 점수
    score += persona.approachability * weights.approachability;
    
    // 정보 중요성 점수 (보유 정보의 수와 관련성)
    const infoScore = Math.min(5, persona.availableInfo.length) * weights.information;
    score += infoScore;
    
    // 인맥 관계 점수
    const relationshipScore = Math.min(5, persona.keyRelationships.length) * weights.relationships;
    score += relationshipScore;
    
    // 현재 기분상태에 따른 보정
    const moodMultiplier = {
      'positive': 1.2,
      'neutral': 1.0,
      'negative': 0.8,
      'unknown': 0.9
    }[persona.currentMood];
    
    return score * moodMultiplier;
  }
  
  /**
   * 선택 순서의 논리성 평가
   */
  private static evaluateOrderLogic(
    selections: PersonaSelection[],
    personaStatuses: PersonaStatus[],
    scenarioContext: any
  ): number {
    const optimalOrder = this.calculateOptimalOrder(personaStatuses, scenarioContext);
    const actualOrder = selections.map((_, index) => index + 1);
    
    // Kendall's tau 계수를 이용한 순서 상관관계 계산
    const correlation = this.calculateOrderCorrelation(actualOrder, optimalOrder);
    
    // 1-5 스케일로 변환
    return Math.max(1, Math.min(5, Math.round(1 + (correlation + 1) * 2)));
  }
  
  /**
   * 선택 사유의 논리성 평가
   */
  private static evaluateReasoningQuality(selections: PersonaSelection[]): number {
    let totalScore = 0;
    let validSelections = 0;
    
    for (const selection of selections) {
      if (selection.selectionReason && selection.selectionReason.trim().length > 0) {
        const reasoning = selection.selectionReason.toLowerCase();
        let score = 1; // 기본 점수
        
        // 구체적인 논리가 포함된 경우 가점
        if (reasoning.includes('때문에') || reasoning.includes('위해') || reasoning.includes('통해')) {
          score += 1;
        }
        
        // 상황 분석이 포함된 경우 가점
        if (reasoning.includes('상황') || reasoning.includes('문제') || reasoning.includes('해결')) {
          score += 1;
        }
        
        // 기대 효과가 명시된 경우 가점
        if (selection.expectedOutcome && selection.expectedOutcome.trim().length > 10) {
          score += 1;
        }
        
        // 충분한 길이의 설명인 경우 가점
        if (selection.selectionReason.length > 20) {
          score += 1;
        }
        
        totalScore += Math.min(5, score);
        validSelections++;
      }
    }
    
    return validSelections > 0 ? Math.round(totalScore / validSelections) : 1;
  }
  
  /**
   * 전략적 사고력 평가
   */
  private static evaluateStrategicThinking(
    selections: PersonaSelection[],
    scenarioContext: any
  ): number {
    let strategicElements = 0;
    const maxElements = 5;
    
    // 단계별 접근 전략이 있는지 확인
    if (selections.length > 1) {
      const hasProgression = selections.some((sel, idx) => 
        idx > 0 && sel.selectionReason.includes('이전') || sel.selectionReason.includes('다음')
      );
      if (hasProgression) strategicElements++;
    }
    
    // 정보 수집 전략
    const hasInfoGathering = selections.some(sel => 
      sel.selectionReason.includes('정보') || sel.selectionReason.includes('파악') || sel.expectedOutcome.includes('확인')
    );
    if (hasInfoGathering) strategicElements++;
    
    // 영향력 고려
    const hasInfluenceConsideration = selections.some(sel => 
      sel.selectionReason.includes('영향') || sel.selectionReason.includes('결정권') || sel.selectionReason.includes('권한')
    );
    if (hasInfluenceConsideration) strategicElements++;
    
    // 시간 효율성 고려
    const hasTimeConsideration = selections.some(sel => 
      sel.selectionReason.includes('시간') || sel.selectionReason.includes('빠르게') || sel.selectionReason.includes('즉시')
    );
    if (hasTimeConsideration) strategicElements++;
    
    // 리스크 관리
    const hasRiskManagement = selections.some(sel => 
      sel.selectionReason.includes('위험') || sel.selectionReason.includes('안전') || sel.selectionReason.includes('신중')
    );
    if (hasRiskManagement) strategicElements++;
    
    return Math.max(1, Math.min(5, Math.round(1 + (strategicElements / maxElements) * 4)));
  }
  
  /**
   * 상황 적응력 평가
   */
  private static evaluateAdaptability(
    selections: PersonaSelection[],
    personaStatuses: PersonaStatus[]
  ): number {
    let adaptabilityScore = 3; // 기본 점수
    
    // 상대방의 기분/상태를 고려한 선택인지 확인
    for (let i = 0; i < selections.length; i++) {
      const selection = selections[i];
      const personaStatus = personaStatuses.find(p => p.personaId === selection.personaId);
      
      if (personaStatus) {
        // 접근하기 어려운 상대를 피한 경우 가점
        if (personaStatus.approachability < 3 && i > 0) {
          adaptabilityScore += 0.5;
        }
        
        // 부정적인 기분의 상대방에 대한 신중한 접근
        if (personaStatus.currentMood === 'negative' && 
            selection.selectionReason.includes('신중') || selection.selectionReason.includes('조심')) {
          adaptabilityScore += 0.5;
        }
      }
    }
    
    return Math.max(1, Math.min(5, Math.round(adaptabilityScore)));
  }
  
  /**
   * 순서 상관관계 계산 (Kendall's tau 근사)
   */
  private static calculateOrderCorrelation(order1: number[], order2: number[]): number {
    if (order1.length !== order2.length) return 0;
    
    let concordantPairs = 0;
    let discordantPairs = 0;
    
    for (let i = 0; i < order1.length - 1; i++) {
      for (let j = i + 1; j < order1.length; j++) {
        const diff1 = order1[i] - order1[j];
        const diff2 = order2[i] - order2[j];
        
        if (diff1 * diff2 > 0) {
          concordantPairs++;
        } else if (diff1 * diff2 < 0) {
          discordantPairs++;
        }
      }
    }
    
    const totalPairs = concordantPairs + discordantPairs;
    return totalPairs === 0 ? 0 : (concordantPairs - discordantPairs) / totalPairs;
  }
  
  /**
   * 상세 분석 내용 생성
   */
  private static generateDetailedAnalysis(
    selections: PersonaSelection[],
    personaStatuses: PersonaStatus[],
    scenarioContext: any
  ): string {
    const optimalOrder = this.calculateOptimalOrder(personaStatuses, scenarioContext);
    const actualOrder = selections.map((_, index) => index + 1);
    
    let analysis = `선택된 대화 순서: ${actualOrder.join(' → ')}\n`;
    analysis += `권장 순서: ${optimalOrder.join(' → ')}\n\n`;
    
    // 각 선택에 대한 분석
    selections.forEach((selection, index) => {
      const persona = personaStatuses.find(p => p.personaId === selection.personaId);
      analysis += `${index + 1}순위 선택 분석:\n`;
      analysis += `- 대상: ${persona?.name || '알 수 없음'}\n`;
      analysis += `- 선택 사유: ${selection.selectionReason}\n`;
      analysis += `- 기대 효과: ${selection.expectedOutcome}\n`;
      
      if (persona) {
        analysis += `- 대상자 특성: 영향력 ${persona.influence}/5, 접근성 ${persona.approachability}/5\n`;
      }
      analysis += '\n';
    });
    
    return analysis;
  }
  
  /**
   * 개선사항 생성
   */
  private static generateImprovements(
    orderScore: number, 
    reasoningQuality: number, 
    strategicThinking: number, 
    adaptability: number
  ): string[] {
    const improvements: string[] = [];
    
    if (orderScore < 3) {
      improvements.push('대화 순서를 더 논리적으로 계획해보세요. 영향력과 접근성을 고려한 우선순위 설정이 필요합니다.');
    }
    
    if (reasoningQuality < 3) {
      improvements.push('선택 사유를 더 구체적이고 논리적으로 설명해주세요. "왜 이 사람을 선택했는지" 명확한 근거를 제시하세요.');
    }
    
    if (strategicThinking < 3) {
      improvements.push('전체적인 해결 전략을 수립하고, 단계별 목표를 설정해보세요. 정보 수집 → 의견 조율 → 결정권자 설득 등의 순서를 고려하세요.');
    }
    
    if (adaptability < 3) {
      improvements.push('상대방의 성격, 기분, 상황을 더 섬세하게 고려한 접근이 필요합니다.');
    }
    
    return improvements;
  }
  
  /**
   * 강점 생성
   */
  private static generateStrengths(
    orderScore: number, 
    reasoningQuality: number, 
    strategicThinking: number, 
    adaptability: number
  ): string[] {
    const strengths: string[] = [];
    
    if (orderScore >= 4) {
      strengths.push('논리적이고 효율적인 대화 순서를 잘 계획했습니다.');
    }
    
    if (reasoningQuality >= 4) {
      strengths.push('선택에 대한 명확하고 설득력 있는 근거를 제시했습니다.');
    }
    
    if (strategicThinking >= 4) {
      strengths.push('전략적 사고와 단계적 접근 방식이 뛰어납니다.');
    }
    
    if (adaptability >= 4) {
      strengths.push('상황과 상대방의 특성을 잘 고려한 유연한 대응을 보였습니다.');
    }
    
    return strengths;
  }
}