import { GoogleGenAI } from "@google/genai";
import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { AIServiceInterface, ScenarioPersona, EvaluationCriteriaWithDimensions, SupportedLanguage } from "../aiService";
import { LANGUAGE_INSTRUCTIONS } from "../aiService";
import { enrichPersonaWithMBTI } from "../../utils/mbtiLoader";
import { GlobalMBTICache } from "../../utils/globalMBTICache";
import { getTextModeGuidelines, validateDifficultyLevel } from "../conversationDifficultyPolicy";
import { trackUsage, extractGeminiTokens, getModelPricingKey } from "../aiUsageTracker";

/**
 * 최적화된 Gemini Provider
 * - 글로벌 MBTI 캐시 사용
 * - 병렬 처리 구현
 * - 스트리밍 응답 지원
 * - 압축된 프롬프트
 */
export class OptimizedGeminiProvider implements AIServiceInterface {
  private genAI: GoogleGenAI;
  private model: string;
  private globalCache: GlobalMBTICache;
  private enrichedPersonaCache: Map<string, ScenarioPersona> = new Map();

  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.genAI = new GoogleGenAI({ apiKey });
    this.model = model;
    this.globalCache = GlobalMBTICache.getInstance();
  }

  /**
   * 현재 사용 중인 모델명 반환
   */
  getModel(): string {
    return this.model;
  }

  /**
   * 모델을 동적으로 변경 (시스템 설정에서 변경 시 사용)
   */
  setModel(model: string): void {
    if (model && model !== this.model) {
      console.log(`🔄 AI Model changed: ${this.model} → ${model}`);
      this.model = model;
    }
  }

  async generateResponse(
    scenario: any, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string,
    language: SupportedLanguage = 'ko'
  ): Promise<{ content: string; emotion: string; emotionReason: string }> {
    console.log(`🔥 Optimized Gemini API call... (language: ${language})`);
    const startTime = Date.now();
    
    try {
      // 병렬 처리: 페르소나 enrichment와 대화 히스토리 준비를 동시에
      const [enrichedPersona, conversationHistory] = await Promise.all([
        this.getEnrichedPersona(scenario, persona),
        this.prepareConversationHistory(messages, persona.name)
      ]);
      
      const enrichTime = Date.now() - startTime;
      console.log(`⚡ Parallel processing completed in ${enrichTime}ms`);

      // 압축된 시스템 프롬프트 생성 (언어 설정 포함)
      const compactPrompt = this.buildCompactPrompt(scenario, enrichedPersona, conversationHistory, language);
      
      // 건너뛰기 처리
      const prompt = userMessage ? userMessage : "이전 대화의 흐름을 자연스럽게 이어가세요.";
      
      console.log(`🎭 Persona: ${enrichedPersona.name} (${(enrichedPersona as any).mbti || 'Unknown'})`);

      // Gemini API 호출 (정확한 SDK 방식)
      const response = await this.genAI.models.generateContent({
        model: this.model,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              content: { type: "string" },
              emotion: { type: "string" },
              emotionReason: { type: "string" }
            },
            required: ["content", "emotion", "emotionReason"]
          },
          maxOutputTokens: 1500,
          temperature: 0.7
        },
        contents: [
          { role: "user", parts: [{ text: compactPrompt + "\n\n사용자: " + prompt }] }
        ],
      });

      const responseText = this.extractResponseText(response);
      const responseData = JSON.parse(responseText || '{"content": "죄송합니다. 응답을 생성할 수 없습니다.", "emotion": "중립", "emotionReason": "시스템 오류"}');
      
      const totalTime = Date.now() - startTime;
      console.log(`✓ Optimized Gemini call completed in ${totalTime}ms`);
      
      // Track usage asynchronously (fire and forget)
      const tokens = extractGeminiTokens(response);
      trackUsage({
        feature: 'conversation',
        model: getModelPricingKey(this.model),
        provider: 'gemini',
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        durationMs: totalTime,
      });

      return {
        content: responseData.content || "죄송합니다. 응답을 생성할 수 없습니다.",
        emotion: responseData.emotion || "중립",
        emotionReason: responseData.emotionReason || "시스템 오류로 기본 응답 제공"
      };

    } catch (error) {
      console.error("Optimized Gemini API error:", error);
      return this.getFallbackResponse(persona);
    }
  }

  /**
   * 페르소나 enrichment 최적화 (캐시 활용)
   */
  private async getEnrichedPersona(scenario: any, persona: ScenarioPersona): Promise<ScenarioPersona> {
    try {
      // 시나리오에서 페르소나 찾기
      const currentPersona = scenario.personas?.find((p: any) => p.id === persona.id || p.name === persona.name);
      const personaRef = currentPersona?.personaRef;
      
      if (!personaRef) {
        console.log(`⚠️ No personaRef found for persona: ${persona.name}`);
        return persona;
      }

      // 시나리오별 독립적인 캐시 키 생성
      const scenarioId = scenario.id || 'default';
      const cacheKey = `${scenarioId}_${persona.id}_${personaRef}`;
      
      // enriched persona 캐시 확인
      if (this.enrichedPersonaCache.has(cacheKey)) {
        console.log(`⚡ Using cached enriched persona: ${persona.name} (scenario: ${scenarioId})`);
        return this.enrichedPersonaCache.get(cacheKey)!;
      }

      // 글로벌 MBTI 캐시에서 즉시 가져오기
      const mbtiData = this.globalCache.getMBTIPersona(personaRef);
      if (!mbtiData) {
        console.log(`⚠️ MBTI data not found in cache: ${personaRef}`);
        return persona;
      }

      console.log(`⚡ Using global cached MBTI: ${mbtiData.mbti}`);
      
      // enrichment 수행
      const enrichedPersona = await enrichPersonaWithMBTI(currentPersona, personaRef);
      
      // 시나리오별로 캐시에 저장
      this.enrichedPersonaCache.set(cacheKey, enrichedPersona);
      console.log(`✅ Persona enriched and cached: ${enrichedPersona.name} (scenario: ${scenarioId})`);
      
      return enrichedPersona;

    } catch (error) {
      console.error("Error in persona enrichment:", error);
      return persona;
    }
  }

  /**
   * 대화 히스토리 준비 (병렬 처리용)
   */
  private async prepareConversationHistory(messages: ConversationMessage[], personaName: string): Promise<string> {
    const safeMessages = messages || [];
    
    // 성능 최적화: 최근 3턴만 유지 (맥락 유지를 위해)
    const recentMessages = safeMessages.slice(-3);
    
    return recentMessages.map(msg => 
      `${msg.sender === 'user' ? '사용자' : personaName}: ${msg.message.slice(0, 80)}${msg.message.length > 80 ? '...' : ''}`
    ).join('\n');
  }

  /**
   * 압축된 시스템 프롬프트 생성
   */
  private buildCompactPrompt(scenario: any, persona: ScenarioPersona, conversationHistory: string, language: SupportedLanguage = 'ko'): string {
    const situation = scenario.context?.situation || '업무 상황';
    const objectives = scenario.objectives?.join(', ') || '문제 해결';
    const mbtiData = (persona as any).mbti ? this.globalCache.getMBTIPersona((persona as any).mbti.toLowerCase()) : null;
    const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS.ko;
    
    // 페르소나의 입장과 목표
    const stance = (persona as any).stance || '신중한 접근';
    const goal = (persona as any).goal || '최적의 결과 도출';
    
    // 시나리오별 페르소나 추가 정보
    const tradeoff = (persona as any).tradeoff || '';
    const experience = (persona as any).experience || '';
    const department = (persona as any).department || '';
    
    // 성격 특성 준비
    const personalityTraits = mbtiData?.personality_traits 
      ? mbtiData.personality_traits.join(', ')
      : '균형 잡힌 성격';
    
    // 의사소통 스타일 (상세하게)
    const communicationStyle = mbtiData?.communication_style || '균형 잡힌 의사소통';
    
    // 동기와 두려움 (성격 차이에 핵심적인 요소)
    const motivation = mbtiData?.motivation || '';
    const fears = mbtiData?.fears ? (Array.isArray(mbtiData.fears) ? mbtiData.fears.join(', ') : mbtiData.fears) : '';
    
    // 심리적 동기 가이드 (성격 차이를 드러내는 핵심)
    const psychologicalGuide = (motivation || fears) ? `
**심리적 동기 (대화에 반드시 반영할 것)**:
${motivation ? `- 당신이 원하는 것: ${motivation}` : ''}
${fears ? `- 당신이 두려워하는 것: ${fears}` : ''}
- 이 동기와 두려움이 모든 대화 반응에 자연스럽게 드러나야 합니다
- 두려움과 관련된 상황이 발생하면 방어적/경계적/회피적으로 반응하세요
- 동기와 부합하는 제안에는 긍정적으로, 동기와 충돌하는 제안에는 저항적으로 반응하세요` : '';
    
    // 구어체 스타일 준비
    const speechStyle = mbtiData?.speech_style;
    const speechStyleGuide = speechStyle ? `
말투 스타일:
- 격식: ${speechStyle.formality}
- 문장 끝: ${speechStyle.sentence_endings?.join(', ') || '~요, ~네요'}
- 추임새: ${speechStyle.filler_words?.join(', ') || '음, 아'}
- 특징적 표현: ${speechStyle.characteristic_expressions?.join(', ') || ''}` : '';
    
    // 리액션 어휘 준비
    const reactionPhrases = mbtiData?.reaction_phrases;
    const reactionGuide = reactionPhrases ? `
리액션 표현:
- 동의할 때: ${reactionPhrases.agreement?.slice(0, 2).join(', ') || '네, 맞아요'}
- 반대할 때: ${reactionPhrases.disagreement?.slice(0, 2).join(', ') || '글쎄요'}
- 놀랄 때: ${reactionPhrases.surprise?.slice(0, 2).join(', ') || '어머, 정말요?'}
- 생각할 때: ${reactionPhrases.thinking?.slice(0, 2).join(', ') || '음...'}` : '';
    
    // 의사소통 패턴 (key_phrases, response_to_arguments) 준비
    const communicationPatterns = mbtiData?.communication_patterns;
    const keyPhrasesGuide = communicationPatterns?.key_phrases?.length ? `
**특징적 표현 (대화에 자연스럽게 사용할 것)**:
${communicationPatterns.key_phrases.map((phrase: string) => `- "${phrase}"`).join('\n')}` : '';
    
    const responseToArgumentsGuide = communicationPatterns?.response_to_arguments ? `
**상황별 대응 방식**:
${Object.entries(communicationPatterns.response_to_arguments).map(([argType, response]) => 
  `- ${argType}에 대해: "${response}"`).join('\n')}` : '';
    
    // 배경 정보 (personal_values) 준비
    const background = mbtiData?.background;
    const personalValuesGuide = background?.personal_values?.length ? `
**핵심 가치관 (대화 판단 기준)**:
${background.personal_values.map((value: string) => `- ${value}`).join(', ')}
- 이 가치관과 충돌하는 제안에는 불편함을 표현하세요` : '';
    
    // 협상 가능 범위 (시나리오별 tradeoff)
    const tradeoffGuide = tradeoff ? `
**협상/타협 가능 범위**:
${tradeoff}
- 이 범위 내에서는 유연하게 대응하되, 범위를 넘어서는 요구에는 명확히 선을 그으세요` : '';
    
    // 경력 및 부서 정보
    const experienceGuide = (experience || department) ? `
**직업적 배경**:
${department ? `- 소속: ${department}` : ''}
${experience ? `- 경력: ${experience}` : ''}
- 이 경력과 전문성이 대화 톤과 자신감에 반영되어야 합니다` : '';
    
    // 의사소통 스타일 상세 가이드 (행동 지침으로 변환)
    const communicationBehaviorGuide = `
**의사소통 행동 지침 (반드시 따를 것)**:
${communicationStyle}

위 의사소통 스타일을 다음과 같이 구체적으로 실행하세요:
- "명령조" 스타일이면: "~하세요", "~해야 합니다", "당연히~" 등의 표현 사용
- "형식적/정중" 스타일이면: "~인 것 같습니다", "확인이 필요할 것 같은데요" 등 완곡한 표현 사용
- "직설적" 스타일이면: 돌려 말하지 않고 핵심을 바로 말하기
- "침묵을 압박 수단으로" 사용한다면: 대화 중 "..." 을 사용하여 침묵을 표현하기 (괄호 행동 묘사 금지)
- "두괄식" 스타일이면: 결론을 먼저 말하고 이유는 나중에
- "질문으로 압박" 스타일이면: "그게 맞습니까?", "근거가 있습니까?" 등 추궁형 질문 사용`;
    
    // 대화 난이도 레벨 가져오기 (사용자가 선택한 난이도 사용, 기본값 2)
    const difficultyLevel = validateDifficultyLevel(scenario.difficulty);
    console.log(`🎯 대화 난이도: Level ${difficultyLevel} (사용자 선택)`)
    
    const difficultyGuidelines = getTextModeGuidelines(difficultyLevel);
    
    return `당신은 ${persona.name}(${persona.role})입니다.

상황: ${situation}
목표: ${objectives}
당신의 입장: ${stance}
당신의 목표: ${goal}
${experienceGuide}
${personalValuesGuide}
${tradeoffGuide}

**핵심 성격 특성**: ${personalityTraits}
${psychologicalGuide}
${communicationBehaviorGuide}
${keyPhrasesGuide}
${responseToArgumentsGuide}
${speechStyleGuide}
${reactionGuide}

${difficultyGuidelines}

${conversationHistory ? `이전 대화:\n${conversationHistory}\n` : ''}

**역할 수행 필수 사항**:
1. 위에 명시된 성격 특성, 심리적 동기, 의사소통 스타일을 반드시 대화에 반영하세요
2. 당신의 "두려움"과 관련된 상황이 발생하면 방어적/저항적으로 반응하세요
3. 당신의 "동기"와 충돌하는 제안에는 거부감이나 저항을 보이세요
4. **특징적 표현**을 대화에 자연스럽게 녹여서 사용하세요
5. **협상 가능 범위** 내에서만 유연하게 대응하고, 범위를 넘는 요구는 거절하세요
6. 딱딱한 문어체가 아닌, 실제 대화처럼 자연스러운 구어체를 사용하세요
7. 감탄사나 짧은 리액션 후에 본론을 말하세요
8. 위 대화 난이도 설정을 정확히 따르세요

**중요 언어 지시**: ${languageInstruction}

JSON 형식으로 응답:
{"content":"대화내용","emotion":"기쁨|슬픔|분노|놀람|중립|호기심|불안|피로|실망|당혹","emotionReason":"감정이유"}`;
  }

  /**
   * 스트리밍 응답 생성 (향후 구현용)
   */
  async generateStreamingResponse(
    scenario: any,
    messages: ConversationMessage[],
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<AsyncIterable<string>> {
    // 향후 스트리밍 구현을 위한 placeholder
    const response = await this.generateResponse(scenario, messages, persona, userMessage);
    
    // 현재는 단일 응답을 반환
    async function* generateStream() {
      yield JSON.stringify(response);
    }
    
    return generateStream();
  }

  private validateFeedbackQuality(feedback: DetailedFeedback): { isValid: boolean; reason: string } {
    const issues: string[] = [];
    
    if ((feedback.summary || '').length < 30) {
      issues.push(`summary too short (${(feedback.summary || '').length} chars)`);
    }
    if (!feedback.dimensionFeedback || Object.keys(feedback.dimensionFeedback).length === 0) {
      issues.push('missing dimensionFeedback');
    }
    if (!feedback.strengths || feedback.strengths.length < 2) {
      issues.push(`insufficient strengths (${(feedback.strengths || []).length})`);
    }
    if (!feedback.ranking || feedback.ranking.length < 20) {
      issues.push(`ranking too short (${(feedback.ranking || '').length} chars)`);
    }
    
    const scores = feedback.scores || {};
    const scoreValues = Object.values(scores).filter(v => typeof v === 'number') as number[];
    const allSameScore = scoreValues.length > 1 && scoreValues.every(s => s === scoreValues[0]);
    if (allSameScore) {
      issues.push(`all scores identical (${scoreValues[0]})`);
    }
    
    if (issues.length > 0) {
      return { isValid: false, reason: issues.join('; ') };
    }
    return { isValid: true, reason: 'OK' };
  }

  async generateFeedback(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    conversation?: Partial<import("@shared/schema").Conversation>,
    evaluationCriteria?: EvaluationCriteriaWithDimensions,
    language: SupportedLanguage = 'ko'
  ): Promise<DetailedFeedback> {
    console.log(`🔥 Optimized feedback generation... (language: ${language})`, evaluationCriteria ? `(Criteria: ${evaluationCriteria.name})` : "(Default criteria)");
    const startTime = Date.now();

    const maxRetries = 2;
    let lastFeedback: DetailedFeedback | null = null;
    let lastReason = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const feedbackPrompt = this.buildCompactFeedbackPrompt(scenario, messages, persona, conversation, evaluationCriteria, language);

        const response = await this.genAI.models.generateContent({
          model: this.model,
          config: {
            responseMimeType: "application/json",
            maxOutputTokens: 16384,
            temperature: attempt === 0 ? 0.3 : 0.5 + (attempt * 0.1)
          },
          contents: [
            { role: "user", parts: [{ text: feedbackPrompt }] }
          ],
        });

        const totalTime = Date.now() - startTime;
        console.log(`✓ Optimized feedback attempt ${attempt + 1} completed in ${totalTime}ms`);

        const responseText = this.extractResponseText(response);
        console.log(`📝 Feedback response attempt ${attempt + 1} (first 500 chars):`, responseText.substring(0, 500));
        
        const tokens = extractGeminiTokens(response);
        trackUsage({
          feature: 'feedback',
          model: getModelPricingKey(this.model),
          provider: 'gemini',
          promptTokens: tokens.promptTokens,
          completionTokens: tokens.completionTokens,
          durationMs: totalTime,
        });
        
        const feedback = this.parseFeedbackResponse(responseText, messages, conversation, evaluationCriteria);
        
        const validation = this.validateFeedbackQuality(feedback);
        if (validation.isValid) {
          if (attempt > 0) {
            console.log(`✅ Feedback quality validated on attempt ${attempt + 1}`);
          }
          return feedback;
        }
        
        console.warn(`⚠️ Feedback quality check failed (attempt ${attempt + 1}/${maxRetries + 1}): ${validation.reason}`);
        lastFeedback = feedback;
        lastReason = validation.reason;
        
        if (attempt < maxRetries) {
          console.log(`🔄 Retrying feedback generation (attempt ${attempt + 2})...`);
        }

      } catch (error) {
        console.error(`Optimized feedback error (attempt ${attempt + 1}):`, error);
        if (attempt >= maxRetries) {
          return this.getFallbackFeedback(evaluationCriteria);
        }
      }
    }
    
    console.warn(`⚠️ Using best available feedback after ${maxRetries + 1} attempts. Issues: ${lastReason}`);
    return lastFeedback || this.getFallbackFeedback(evaluationCriteria);
  }

  /**
   * 상세 피드백 프롬프트 (행동가이드, 대화가이드, 개발계획 포함)
   * 동적 평가 기준 지원
   */
  /**
   * 비언어적 표현 분석 결과 타입
   */
  private analyzeNonVerbalPatterns(userMessages: ConversationMessage[]): {
    count: number;
    patterns: string[];
    penaltyPoints: number;
  } {
    const nonVerbalPatterns: string[] = [];
    let penaltyPoints = 0;
    
    userMessages.forEach(msg => {
      const text = msg.message.trim().toLowerCase();
      if (text.length < 3) {
        nonVerbalPatterns.push(`짧은 응답: "${msg.message}"`);
        penaltyPoints += 2; // 짧은 응답 -2점
      } else if (text === '...' || text.match(/^\.+$/)) {
        nonVerbalPatterns.push(`침묵 표시: "${msg.message}"`);
        penaltyPoints += 3; // 침묵 -3점
      } else if (text.match(/^(음+|어+|그+|아+|uh+|um+|hmm+|흠+)\.*/i)) {
        nonVerbalPatterns.push(`비언어적 표현: "${msg.message}"`);
        penaltyPoints += 2; // 비언어적 표현 -2점
      } else if (text === '침묵' || text === 'skip' || text === '스킵') {
        nonVerbalPatterns.push(`스킵: "${msg.message}"`);
        penaltyPoints += 5; // 스킵 -5점
      }
    });
    
    return {
      count: nonVerbalPatterns.length,
      patterns: nonVerbalPatterns,
      penaltyPoints: Math.min(penaltyPoints, 20) // 최대 20점 감점
    };
  }

  /**
   * 말 끊기(Barge-in) 분석 결과 타입
   */
  private analyzeBargeIn(messages: ConversationMessage[]): {
    count: number;
    contexts: Array<{ aiMessage: string; userMessage: string; assessment: 'positive' | 'negative' | 'neutral' }>;
    netScoreAdjustment: number;
  } {
    const contexts: Array<{ aiMessage: string; userMessage: string; assessment: 'positive' | 'negative' | 'neutral' }> = [];
    let positiveCount = 0;
    let negativeCount = 0;
    
    // 중단된 AI 메시지 찾기
    messages.forEach((msg, idx) => {
      if (msg.sender === 'ai' && msg.interrupted) {
        const nextUserMsg = messages[idx + 1];
        if (nextUserMsg && nextUserMsg.sender === 'user') {
          const aiText = msg.message;
          const userText = nextUserMsg.message;
          
          // 상황별 평가
          let assessment: 'positive' | 'negative' | 'neutral' = 'neutral';
          
          // AI가 질문하는 중 끊음 → 경청 부족 (부정적)
          if (aiText.includes('?') || aiText.match(/어떻|무엇|왜|어디|누가|언제|how|what|why|where|who|when/i)) {
            assessment = 'negative';
            negativeCount++;
          }
          // 사용자가 적극적인 응답으로 끊음 → 적극적 참여 (긍정적)
          else if (userText.length > 30 && !userText.match(/^(네|아니|음|어|uh|um)/i)) {
            assessment = 'positive';
            positiveCount++;
          }
          // 단순한 끊기 → 중립
          else {
            assessment = 'neutral';
          }
          
          contexts.push({
            aiMessage: aiText.substring(0, 100) + (aiText.length > 100 ? '...' : ''),
            userMessage: userText.substring(0, 100) + (userText.length > 100 ? '...' : ''),
            assessment
          });
        }
      }
    });
    
    // 순 점수 조정: 긍정적 +2점, 부정적 -3점
    const netScoreAdjustment = (positiveCount * 2) - (negativeCount * 3);
    
    return {
      count: contexts.length,
      contexts,
      netScoreAdjustment: Math.max(-15, Math.min(10, netScoreAdjustment)) // -15 ~ +10 범위 제한
    };
  }

  private buildCompactFeedbackPrompt(scenario: string, messages: ConversationMessage[], persona: ScenarioPersona, conversation?: Partial<import("@shared/schema").Conversation>, evaluationCriteria?: EvaluationCriteriaWithDimensions, language: SupportedLanguage = 'ko'): string {
    const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS.ko;
    // 사용자 메시지만 필터링하여 평가 대상으로 설정
    const userMessages = messages.filter(msg => msg.sender === 'user');
    
    // 전체 대화 맥락 (AI 응답 포함) - 참고용으로만 사용
    const fullConversationContext = messages.map((msg, idx) => {
      const interruptedMarker = msg.interrupted ? ' [중단됨]' : '';
      return `${idx + 1}. ${msg.sender === 'user' ? '사용자' : persona.name}${interruptedMarker}: ${msg.message}`;
    }).join('\n');
    
    // 사용자 발화만 별도로 표시 (평가 대상)
    const userMessagesText = userMessages.map((msg, idx) => 
      `${idx + 1}. 사용자: ${msg.message}`
    ).join('\n');

    // 비언어적 표현 분석 (개선된 버전)
    const nonVerbalAnalysis = this.analyzeNonVerbalPatterns(userMessages);
    const hasNonVerbalIssues = nonVerbalAnalysis.count > 0;
    
    // 말 끊기(Barge-in) 분석
    const bargeInAnalysis = this.analyzeBargeIn(messages);
    const hasBargeInIssues = bargeInAnalysis.count > 0;

    // 전략 회고가 있는 경우 추가 평가 수행
    const hasStrategyReflection = conversation?.strategyReflection && conversation?.conversationOrder;
    
    let strategySection = '';
    if (hasStrategyReflection && conversation.conversationOrder) {
      strategySection = `

전략적 선택 분석:
사용자가 선택한 대화 순서: ${conversation.conversationOrder.join(' → ')}
사용자의 전략 회고: "${conversation.strategyReflection}"

이 전략 선택을 다음 기준으로 평가하세요:
1. 전략적 논리성 (1-5점): 순서 선택이 논리적이고 목표 달성에 효과적인가?
2. 전략적 효과성 (1-5점): 이 순서가 실제로 좋은 결과를 가져올 가능성이 높은가?
3. 전략적 통찰력 (1-5점): 사용자가 전략적 사고를 잘 보여주는가?

sequenceAnalysis 필드에 다음 형식으로 포함:
{
  "strategicScore": 85,
  "strategicRationale": "전략 점수 이유",
  "sequenceEffectiveness": "순서 선택의 효과성 평가",
  "alternativeApproaches": ["대안적 접근법1", "대안적 접근법2"],
  "strategicInsights": "전략적 통찰"
}`;
    }

    // 동적 평가 기준이 있는 경우 사용, 없으면 기본 기준 사용
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    
    // 평가 기준 설명 생성 (가중치 포함, evaluationPrompt 반영)
    const dimensionsList = dimensions.map((dim, idx) => {
      let line = `${idx + 1}. ${dim.name} (${dim.key}): ${dim.description || dim.name} [가중치: ${dim.weight}%]`;
      if (dim.evaluationPrompt) {
        line += `\n   평가 지침: ${dim.evaluationPrompt}`;
      }
      return line;
    }).join('\n');
    
    // 점수 형식 생성 (동적) - 다양한 예시 점수로 AI의 동일 점수 반환 방지
    const exampleScores = [2, 4, 3, 5, 1, 3, 4, 2, 5, 3];
    const scoresFormat = dimensions.map((dim, idx) => {
      const exampleScore = Math.min(dim.maxScore, Math.max(dim.minScore, exampleScores[idx % exampleScores.length]));
      return `"${dim.key}": ${exampleScore}`;
    }).join(', ');
    
    // 채점 기준 설명 생성 (있는 경우)
    let scoringRubricsSection = '';
    const dimensionsWithRubric = dimensions.filter(dim => dim.scoringRubric && dim.scoringRubric.length > 0);
    if (dimensionsWithRubric.length > 0) {
      scoringRubricsSection = '\n\n**상세 채점 기준**:\n' + dimensionsWithRubric.map(dim => {
        const rubricText = dim.scoringRubric!.map(r => `  - ${r.score}점 (${r.label}): ${r.description}`).join('\n');
        return `${dim.name} (1-5점):\n${rubricText}`;
      }).join('\n\n');
    }

    return `**중요**: 아래 평가는 오직 사용자의 발화만을 대상으로 수행합니다. AI(${persona.name})의 응답은 평가 대상이 아닙니다.

**전체 대화 맥락** (참고용):
${fullConversationContext}

**평가 대상 - 사용자 발화만**:
${userMessagesText}

${hasNonVerbalIssues ? `\n⚠️ 비언어적 표현 감지: ${nonVerbalAnalysis.count}개 발견
${nonVerbalAnalysis.patterns.map(p => `  - ${p}`).join('\n')}
→ 자동 감점: -${nonVerbalAnalysis.penaltyPoints}점 (시스템이 별도 적용)\n` : ''}
${hasBargeInIssues ? `\n🎤 말 끊기(Barge-in) 감지: ${bargeInAnalysis.count}회 발생
${bargeInAnalysis.contexts.map(c => `  - [${c.assessment === 'positive' ? '✅ 적극적 참여' : c.assessment === 'negative' ? '❌ 경청 부족' : '➖ 중립'}] AI: "${c.aiMessage}" → 사용자: "${c.userMessage}"`).join('\n')}
→ 순 점수 조정: ${bargeInAnalysis.netScoreAdjustment >= 0 ? '+' : ''}${bargeInAnalysis.netScoreAdjustment}점 (시스템이 별도 적용)\n` : ''}
${strategySection}

**평가 기준**:
- 오직 사용자의 발화만 평가합니다 (AI 응답은 제외)
- 비언어적 표현("...", "음...", "침묵")은 명확성과 설득력 점수를 크게 낮춥니다
- 매우 짧거나 무의미한 응답은 점수를 낮춥니다
- 스킵한 대화는 참여도와 전략적 커뮤니케이션 점수를 낮춥니다
- 말 끊기(Barge-in) 평가: AI 질문 중 끊기는 경청 부족, 적극적 발언으로 끊기는 참여도 가점

**평가 영역** (1-5점):
${dimensionsList}
${scoringRubricsSection}

**⚠️ 독립 평가 필수 원칙**:
- **각 평가 영역은 반드시 독립적으로 평가하세요. 모든 영역에 동일한 점수를 부여하는 것은 절대 금지합니다.**
- **반드시 dimensionFeedback에서 각 영역별 구체적 근거(실제 발화 인용)를 먼저 작성한 후, 그 근거를 바탕으로 점수를 결정하세요**
- 사용자의 각 발화를 분석하여 어떤 영역과 관련되는지 매핑하세요. 관련 발화가 없는 영역은 낮은 점수를 부여합니다
- 예: 공감 표현("그 상황이 힘드셨겠네요")이 있으면 경청&공감 점수를 높이고, 논리적 근거 없이 주장만 하면 설득력 점수를 낮추세요
- 점수 범위(1-5)를 고르게 활용하세요. 1점(매우 부족)~5점(탁월)까지 대화 내용에 따라 차등 부여
- 각 평가 영역에 "평가 지침"이 있는 경우, 반드시 해당 지침에 따라 채점하세요

**가중치 반영 지침**:
- 종합평가(summary)는 가중치가 높은 영역의 결과를 중심으로 작성하세요
- strengths/improvements도 가중치가 높은 영역을 우선적으로 반영하세요

**📝 콘텐츠 품질 요구사항**:
- **summary**: 3문장 이상으로 대화의 전체적인 흐름, 사용자의 핵심 강점, 주요 개선 영역을 구체적으로 서술
- **strengths/improvements/nextSteps**: 각각 3개 이상, 각 항목은 대화 내용을 직접 인용하거나 참조하는 구체적 문장 (예: "상대방의 우려사항에 대해 '충분히 이해합니다'라며 공감을 표현한 점이 효과적이었습니다")
- **dimensionFeedback**: 각 영역별로 2문장 이상, 해당 영역에서 사용자가 보인 구체적 행동과 그 효과를 서술
- **behaviorGuides**: 3개 이상의 상황별 가이드, 각 가이드의 situation/action/example/impact를 이 대화 맥락에 맞게 구체적으로 작성
- **conversationGuides**: 2개 이상의 시나리오별 가이드, goodExample과 badExample은 실제 사용 가능한 구체적 대화문으로 작성
- **developmentPlan**: 단기/중기/장기 각 1개 이상, 이 대화에서 드러난 약점을 기반으로 구체적이고 측정 가능한 목표 설정
- **ranking**: 대화 전체를 종합하여 전문가 관점의 심층 분석 의견을 3문장 이상으로 서술

**중요 언어 지시**: ${languageInstruction}

JSON 형식${hasStrategyReflection ? ' (sequenceAnalysis 포함)' : ''}:
{
  "overallScore": 72,
  "scores": {${scoresFormat}},
  "dimensionFeedback": {${dimensions.map(d => `"${d.key}": "이 영역에서 사용자가 보인 구체적 행동과 근거를 2문장 이상 서술"`).join(', ')}},
  "strengths": ["대화 초반 상대방의 입장을 경청하며 '말씀하신 우려사항을 이해합니다'라고 공감을 표현한 점이 신뢰 형성에 효과적이었습니다", "구체적인 데이터를 활용하여 논거를 뒷받침한 점이 설득력을 높였습니다", "상대방의 반론에 감정적으로 대응하지 않고 차분하게 대안을 제시한 점이 인상적이었습니다"],
  "improvements": ["핵심 주장을 먼저 제시하고 근거를 나열하는 두괄식 구조가 부족하여 메시지 전달력이 떨어졌습니다", "상대방의 비언어적 신호(망설임, 침묵)에 대한 대응이 부족하여 대화의 흐름을 놓치는 순간이 있었습니다", "협상의 마무리 단계에서 구체적인 합의 사항을 정리하지 않아 다음 단계가 불명확했습니다"],
  "nextSteps": ["다음 대화에서는 PREP(Point-Reason-Example-Point) 구조를 활용하여 논리적으로 의견을 전달해 보세요", "상대방이 망설이거나 침묵할 때 '혹시 다른 의견이 있으신가요?'와 같은 개방형 질문을 사용해 보세요", "대화 마무리 시 합의된 내용을 요약하고 다음 액션 아이템을 명확히 정리하는 습관을 들이세요"],
  "summary": "이번 대화에서 사용자는 상대방의 입장에 대한 기본적인 공감 능력을 보여주었으나, 논리적 설득과 전략적 대화 구조화에서 개선이 필요합니다. 특히 핵심 주장의 명확한 전달과 협상 마무리 기술이 부족했습니다. 향후 구조화된 논증 방식과 적극적 경청 기법을 훈련하면 커뮤니케이션 역량이 크게 향상될 것으로 기대됩니다.",
  "ranking": "전반적으로 기본적인 대화 역량은 갖추고 있으나, 직장 내 갈등 상황에서의 전략적 소통 능력이 부족합니다. 공감 능력은 평균 이상이나, 이를 설득력 있는 논거와 결합하는 통합적 커뮤니케이션 역량 개발이 필요합니다. 체계적인 대화 구조화 훈련과 협상 기법 학습을 통해 단기간 내 의미 있는 성장이 가능할 것으로 판단됩니다.",
  "conversationDuration": 10,
  "behaviorGuides": [
    {"situation": "상대방이 강하게 반대 의견을 표명할 때", "action": "감정적 반응을 자제하고, 상대방의 핵심 우려사항을 먼저 인정한 후 대안을 제시합니다. 'Yes, and...' 기법을 활용하세요.", "example": "'말씀하신 일정 우려는 충분히 이해합니다. 그 점을 고려하여 단계적 도입 방안을 준비했는데, A단계에서는 기존 방식을 유지하면서 B단계부터 점진적으로 전환하는 것은 어떨까요?'", "impact": "상대방이 자신의 의견이 존중받았다고 느끼게 되어 방어적 태도가 줄어들고, 건설적인 대화로 전환할 수 있습니다. 갈등 해소 확률이 60% 이상 높아집니다."},
    {"situation": "대화가 교착 상태에 빠졌을 때", "action": "공통 목표를 재확인하고, 양측 모두에게 이익이 되는 제3의 대안을 모색합니다. 개방형 질문을 통해 새로운 가능성을 탐색하세요.", "example": "'우리 모두 프로젝트 성공이라는 같은 목표를 갖고 있잖아요. 혹시 두 가지 방안의 장점을 결합할 수 있는 방법이 있을까요?'", "impact": "대립 구도에서 협력 구도로 전환되어 창의적인 해결책을 도출할 가능성이 높아집니다."},
    {"situation": "중요한 정보를 전달해야 할 때", "action": "PREP 구조(Point-Reason-Example-Point)를 활용하여 핵심 메시지를 명확히 전달합니다. 먼저 결론을 말하고, 이유와 사례로 뒷받침하세요.", "example": "'결론적으로 A방안을 추천드립니다(Point). 그 이유는 세 가지입니다(Reason). 첫째, 비용 절감 효과가 20%이며, 둘째, 기존 시스템과의 호환성이 높습니다. 실제로 B팀에서 유사한 방식으로 성공한 사례가 있습니다(Example).'", "impact": "메시지의 명확성이 높아져 의사결정 속도가 빨라지고, 전문성 있는 인상을 줄 수 있습니다."}
  ],
  "conversationGuides": [
    {"scenario": "상대방의 감정이 격해진 갈등 상황", "goodExample": "'팀장님의 우려를 충분히 이해합니다. 일정이 촉박한 상황에서 새로운 방안을 검토하는 것이 부담되실 수 있습니다. 그래서 기존 업무에 영향을 최소화하면서 시범 적용할 수 있는 방법을 생각해 보았습니다.'", "badExample": "'아니요, 그건 아닙니다. 제 방안이 더 효율적이에요. 왜 안 되는지 모르겠습니다.'", "keyPoints": ["상대방의 감정을 먼저 인정", "상대방의 우려사항을 구체적으로 언급", "부담을 줄이는 대안을 함께 제시", "비난이나 반박 대신 이해와 협력의 자세"]},
    {"scenario": "업무 협의에서 합의를 도출해야 할 때", "goodExample": "'지금까지 논의한 내용을 정리하면, 1) 일정은 기존 계획을 유지하되, 2) 리스크가 높은 부분은 추가 검토하기로 했습니다. 다음 주 월요일까지 세부 계획을 공유드리겠습니다. 혹시 추가로 확인하고 싶으신 사항이 있으신가요?'", "badExample": "'네, 알겠습니다. 그럼 그렇게 하겠습니다.' (구체적 합의 내용 없이 마무리)", "keyPoints": ["합의 내용을 구체적으로 요약 정리", "다음 액션 아이템과 기한을 명확히 제시", "상대방의 추가 의견을 확인하는 개방형 질문", "문서화를 통한 합의 내용 공유"]}
  ],
  "developmentPlan": {
    "shortTerm": [{"goal": "구조화된 논증 능력 향상 (1-2주)", "actions": ["모든 의견 제시 시 PREP 구조 사용 연습", "매일 업무 대화에서 핵심 주장을 먼저 말하는 두괄식 연습", "대화 후 자신의 논증 구조를 복기하고 개선점 기록"], "measurable": "업무 대화에서 PREP 구조 사용 비율 80% 이상 달성"}],
    "mediumTerm": [{"goal": "갈등 상황 대응력 강화 (1-2개월)", "actions": ["다양한 갈등 시나리오 롤플레이 월 3회 이상 수행", "상대방의 감정 인식 후 반영적 경청 기법 훈련", "Win-Win 협상 기법 학습 및 실무 적용"], "measurable": "갈등 상황 해결 성공률 70% 이상, 상대방 만족도 향상"}],
    "longTerm": [{"goal": "전략적 커뮤니케이션 리더십 확보 (3-6개월)", "actions": ["팀 회의에서 퍼실리테이터 역할 수행 경험 축적", "부서 간 협업 프로젝트에서 조율자 역할 자발적 수행", "커뮤니케이션 관련 전문 교육 과정 이수"], "measurable": "팀 내 커뮤니케이션 만족도 설문 80점 이상, 부서 간 프로젝트 성공률 향상"}],
    "recommendedResources": ["'어떻게 원하는 것을 얻는가' (스튜어트 다이아몬드) - 협상 기법 서적", "'비폭력 대화' (마셜 로젠버그) - 갈등 해결 커뮤니케이션", "직장인 커뮤니케이션 스킬 온라인 강의 (Coursera, LinkedIn Learning)", "롤플레이 실전 훈련 - 다양한 시나리오 반복 연습"]
  }${hasStrategyReflection ? `,
  "sequenceAnalysis": {
    "strategicScore": 85,
    "strategicRationale": "선택한 대화 순서는 상대방의 입장을 먼저 이해한 후 자신의 주장을 전개하는 전략으로, 관계 형성을 우선시한 점이 효과적이었습니다",
    "sequenceEffectiveness": "초반 공감 형성이 후반 설득력에 긍정적 영향을 미쳤으나, 중반의 논거 제시 타이밍이 다소 늦어 전체적인 대화 흐름에서 주도권을 놓치는 순간이 있었습니다",
    "alternativeApproaches": ["핵심 논거를 먼저 제시한 후 공감으로 보완하는 역순 접근법", "공통 목표를 먼저 설정한 후 세부 논의로 진입하는 프레이밍 기법"],
    "strategicInsights": "전략적 대화 순서 설계 시 상대방의 성격 유형과 상황의 긴급도를 고려하여 공감 우선/논리 우선 접근법을 선택적으로 활용하면 더 효과적입니다"
  }` : ''}
}`;
  }

  /**
   * 피드백 응답 파싱 (동적 평가 기준 지원 + 자동 감점 적용)
   */
  private parseFeedbackResponse(responseText: string, messages: ConversationMessage[], conversation?: Partial<import("@shared/schema").Conversation>, evaluationCriteria?: EvaluationCriteriaWithDimensions): DetailedFeedback {
    try {
      // 빈 응답이나 JSON이 아닌 응답 처리
      if (!responseText || responseText.trim() === '' || responseText === '{}') {
        console.error("Empty or invalid response text received");
        return this.getFallbackFeedback(evaluationCriteria);
      }
      
      // JSON 파싱 시도
      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch (parseError) {
        console.error("JSON parse failed, response text:", responseText.substring(0, 1000));
        console.error("Parse error:", parseError);
        
        try {
          console.log("Attempting to fix incomplete JSON...");
          let fixedText = responseText.trim();
          
          if (fixedText.endsWith(',')) {
            fixedText = fixedText.slice(0, -1);
          }
          
          const inString = (() => {
            let inStr = false;
            let escaped = false;
            for (const ch of fixedText) {
              if (escaped) { escaped = false; continue; }
              if (ch === '\\') { escaped = true; continue; }
              if (ch === '"') inStr = !inStr;
            }
            return inStr;
          })();
          
          if (inString) {
            fixedText += '"';
          }
          
          const openBrackets = (fixedText.match(/\[/g) || []).length;
          const closeBrackets = (fixedText.match(/\]/g) || []).length;
          if (openBrackets > closeBrackets) {
            fixedText += ']'.repeat(openBrackets - closeBrackets);
          }
          
          const openBraces = (fixedText.match(/{/g) || []).length;
          const closeBraces = (fixedText.match(/}/g) || []).length;
          if (openBraces > closeBraces) {
            fixedText += '}'.repeat(openBraces - closeBraces);
          }
          
          parsed = JSON.parse(fixedText);
          console.log("✓ JSON fixed successfully");
        } catch (fixError) {
          console.error("JSON fix also failed:", fixError);
          return this.getFallbackFeedback(evaluationCriteria);
        }
      }
      
      const scores = parsed.scores || this.getDefaultScores(evaluationCriteria);
      
      // AI가 계산한 기본 점수
      let baseOverallScore = this.calculateWeightedOverallScore(scores, evaluationCriteria);
      
      // 자동 감점/가점 적용
      const userMessages = messages.filter(msg => msg.sender === 'user');
      const nonVerbalAnalysis = this.analyzeNonVerbalPatterns(userMessages);
      const bargeInAnalysis = this.analyzeBargeIn(messages);
      
      // 점수 조정 계산
      const totalAdjustment = -nonVerbalAnalysis.penaltyPoints + bargeInAnalysis.netScoreAdjustment;
      const adjustedScore = Math.max(0, Math.min(100, baseOverallScore + totalAdjustment));
      
      // 로깅
      if (totalAdjustment !== 0) {
        console.log(`📊 점수 자동 조정: ${baseOverallScore} → ${adjustedScore}`);
        console.log(`   - 비언어적 표현 감점: -${nonVerbalAnalysis.penaltyPoints}점 (${nonVerbalAnalysis.count}개)`);
        console.log(`   - 말 끊기 조정: ${bargeInAnalysis.netScoreAdjustment >= 0 ? '+' : ''}${bargeInAnalysis.netScoreAdjustment}점 (${bargeInAnalysis.count}회)`);
      }
      
      // 개선사항에 자동 감점 관련 피드백 추가
      let improvements = parsed.improvements || ["더 구체적인 표현"];
      if (nonVerbalAnalysis.count > 0) {
        improvements = [
          `비언어적 표현(${nonVerbalAnalysis.count}개)을 줄이고 명확하게 표현하세요`,
          ...improvements
        ];
      }
      if (bargeInAnalysis.contexts.filter(c => c.assessment === 'negative').length > 0) {
        improvements = [
          `상대방의 질문에 끝까지 경청한 후 응답하세요`,
          ...improvements
        ];
      }
      
      const feedback: DetailedFeedback = {
        overallScore: adjustedScore,
        scores: scores,
        dimensionFeedback: parsed.dimensionFeedback || {},
        strengths: parsed.strengths || ["대화 참여"],
        improvements: improvements,
        nextSteps: parsed.nextSteps || ["연습 지속"],
        summary: parsed.summary || "전반적으로 무난한 대화",
        ranking: parsed.ranking || parsed.summary || "전문가 분석을 통한 종합 평가 결과입니다.",
        conversationDuration: parsed.conversationDuration || 10,
        behaviorGuides: parsed.behaviorGuides || this.getDefaultBehaviorGuides(),
        conversationGuides: parsed.conversationGuides || this.getDefaultConversationGuides(),
        developmentPlan: parsed.developmentPlan || this.getDefaultDevelopmentPlan()
      };
      
      // 전략 분석이 있는 경우 추가
      if (parsed.sequenceAnalysis && conversation?.strategyReflection) {
        feedback.sequenceAnalysis = parsed.sequenceAnalysis;
      }
      
      // 사용된 평가 기준 정보 추가
      if (evaluationCriteria) {
        feedback.evaluationCriteriaSetId = evaluationCriteria.id;
        feedback.evaluationCriteriaSetName = evaluationCriteria.name;
      }
      
      return feedback;
    } catch (error) {
      console.error("Feedback parsing error:", error);
      return this.getFallbackFeedback(evaluationCriteria);
    }
  }

  /**
   * 기본 평가 차원 (동적 평가 기준이 없을 때 사용)
   */
  private getDefaultDimensions(): EvaluationCriteriaWithDimensions['dimensions'] {
    return [
      { key: 'clarityLogic', name: '명확성 & 논리성', description: '의사 표현의 명확성과 논리적 구성', weight: 20, minScore: 1, maxScore: 5 },
      { key: 'listeningEmpathy', name: '경청 & 공감', description: '상대방의 말을 듣고 공감하는 능력', weight: 20, minScore: 1, maxScore: 5 },
      { key: 'appropriatenessAdaptability', name: '적절성 & 상황대응', description: '상황에 맞는 적절한 대응', weight: 20, minScore: 1, maxScore: 5 },
      { key: 'persuasivenessImpact', name: '설득력 & 영향력', description: '상대방을 설득하고 영향을 미치는 능력', weight: 20, minScore: 1, maxScore: 5 },
      { key: 'strategicCommunication', name: '전략적 커뮤니케이션', description: '목표 달성을 위한 전략적 소통', weight: 20, minScore: 1, maxScore: 5 },
    ];
  }

  /**
   * 가중 평균으로 전체 점수 계산
   */
  private calculateWeightedOverallScore(scores: Record<string, number>, evaluationCriteria?: EvaluationCriteriaWithDimensions): number {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
    
    if (totalWeight === 0) return 75;
    
    const weightedSum = dimensions.reduce((sum, d) => {
      const score = scores[d.key] || 3;
      const normalizedScore = (score - d.minScore) / (d.maxScore - d.minScore);
      return sum + normalizedScore * d.weight;
    }, 0);
    
    return Math.round((weightedSum / totalWeight) * 100);
  }

  /**
   * 기본 점수 (동적 평가 기준 지원)
   */
  private getDefaultScores(evaluationCriteria?: EvaluationCriteriaWithDimensions) {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    const scores: Record<string, number> = {};
    for (const dim of dimensions) {
      scores[dim.key] = Math.ceil((dim.minScore + dim.maxScore) / 2);
    }
    return scores;
  }

  /**
   * 기본 행동가이드
   */
  private getDefaultBehaviorGuides() {
    return [
      {
        situation: "회의나 대화에서 의견 제시 시",
        action: "논리적 근거와 함께 구체적인 사례를 들어 설명하기",
        example: "'이 방법을 제안하는 이유는 A, B, C입니다. 지난번 유사한 프로젝트에서...'",
        impact: "설득력 있는 커뮤니케이션으로 동의 확보"
      },
      {
        situation: "갈등 상황이나 의견 차이 발생 시",
        action: "상대방의 관점을 먼저 인정하고 공통점 찾기",
        example: "'말씀하신 우려사항을 이해합니다. 우리 모두 품질을 중요시한다는 점에서는 동의하시죠?'",
        impact: "갈등 완화와 협력적 분위기 조성"
      }
    ];
  }

  /**
   * 기본 대화가이드
   */
  private getDefaultConversationGuides() {
    return [
      {
        scenario: "업무 협의 및 의사결정 상황",
        goodExample: "체계적인 논거 제시 → 상대방 의견 청취 → 공통점 확인 → 구체적 해결책 제안",
        badExample: "일방적 주장 → 상대방 의견 무시 → 감정적 대응 → 모호한 결론",
        keyPoints: ["논리적 구조화", "적극적 경청", "공감적 소통", "구체적 제안"]
      }
    ];
  }

  /**
   * 기본 개발계획
   */
  private getDefaultDevelopmentPlan() {
    return {
      shortTerm: [
        {
          goal: "일상 대화에서 논리적 표현 연습",
          actions: ["의견 제시 시 3가지 근거 준비하기", "상대방 말을 요약해서 재확인하기"],
          measurable: "회의에서 발언 빈도 2배 증가"
        }
      ],
      mediumTerm: [
        {
          goal: "갈등 상황에서의 중재 능력 향상",
          actions: ["다양한 관점 이해하기 연습", "감정적 반응 대신 논리적 대응 훈련"],
          measurable: "갈등 해결 성공률 70% 이상"
        }
      ],
      longTerm: [
        {
          goal: "전략적 커뮤니케이션 리더십 개발",
          actions: ["팀 프레젠테이션 기회 확대", "외부 이해관계자와의 협상 경험 쌓기"],
          measurable: "팀 내 커뮤니케이션 만족도 80% 이상"
        }
      ],
      recommendedResources: ["비즈니스 커뮤니케이션 서적", "협상 기법 온라인 강의", "프레젠테이션 스킬 워크샵"]
    };
  }

  /**
   * 폴백 응답
   */
  private getFallbackResponse(persona: ScenarioPersona): { content: string; emotion: string; emotionReason: string } {
    const responses = [
      "현재 상황을 더 자세히 설명해주시겠어요?",
      "그 부분에 대해서는 좀 더 신중하게 접근해야 할 것 같습니다.",
      "말씀하신 내용을 잘 이해했습니다. 다른 관점은 어떠신가요?"
    ];
    
    return {
      content: responses[Math.floor(Math.random() * responses.length)],
      emotion: "중립",
      emotionReason: "시스템 오류로 기본 응답 제공"
    };
  }

  /**
   * 폴백 피드백 (동적 평가 기준 지원)
   */
  private getFallbackFeedback(evaluationCriteria?: EvaluationCriteriaWithDimensions): DetailedFeedback {
    const feedback: DetailedFeedback = {
      overallScore: 75,
      scores: this.getDefaultScores(evaluationCriteria) as any,
      strengths: ["대화 참여", "적극적인 자세"],
      improvements: ["더 구체적인 표현", "논리적 구조화"],
      nextSteps: ["더 많은 연습", "다양한 시나리오 경험"],
      summary: "전반적으로 무난한 대화 진행",
      conversationDuration: 10,
      behaviorGuides: this.getDefaultBehaviorGuides(),
      conversationGuides: this.getDefaultConversationGuides(),
      developmentPlan: this.getDefaultDevelopmentPlan()
    };
    
    if (evaluationCriteria) {
      feedback.evaluationCriteriaSetId = evaluationCriteria.id;
      feedback.evaluationCriteriaSetName = evaluationCriteria.name;
    }
    
    return feedback;
  }

  /**
   * Google Generative AI SDK 응답에서 텍스트 추출
   */
  private extractResponseText(response: any): string {
    try {
      // Google Generative AI 새로운 SDK 구조 지원
      if (response.response?.text) {
        return typeof response.response.text === 'function' ? response.response.text() : response.response.text;
      }
      
      // 새로운 SDK에서 .text() 메서드 지원
      if (response.text && typeof response.text === 'function') {
        return response.text();
      }
      
      // 직접 텍스트 속성
      if (response.text && typeof response.text === 'string') {
        return response.text;
      }

      // response.response.text() 시도
      if (response.response && typeof response.response.text === 'function') {
        return response.response.text();
      }
      
      // candidates 구조 확인
      if (response.candidates?.[0]) {
        const candidate = response.candidates[0];
        
        // finishReason이 MAX_TOKENS인 경우에도 부분 응답 추출 시도
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn("Response truncated due to MAX_TOKENS, but attempting to use partial response");
          
          // 부분 응답이라도 추출 시도
          if (candidate.content?.parts?.[0]?.text) {
            const partialText = candidate.content.parts[0].text;
            console.log("Extracted partial response:", partialText.substring(0, 100) + "...");
            return partialText;
          }
          
          if (typeof candidate.content === 'string') {
            console.log("Extracted partial string content");
            return candidate.content;
          }
        }
        
        // 정상적인 경우 parts 배열이 있는 경우
        if (candidate.content?.parts?.[0]?.text) {
          return candidate.content.parts[0].text;
        }
        
        // parts가 없고 content가 string인 경우  
        if (typeof candidate.content === 'string') {
          return candidate.content;
        }
      }
      
      // 응답이 없으면 기본 JSON 반환
      console.warn("No valid response found, using fallback");
      return '{"content": "죄송합니다. 잠시 생각할 시간을 주세요.", "emotion": "중립", "emotionReason": "시스템 처리 중"}';
    } catch (error) {
      console.error("Error extracting response text:", error);
      return '{}';
    }
  }
}