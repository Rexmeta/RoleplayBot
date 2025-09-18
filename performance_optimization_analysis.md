# AI API 성능 최적화 분석 및 제안

## 현재 성능 이슈
- **응답 시간**: 13-29초 (매우 느림)
- **API 호출 빈도**: 사용자 메시지마다 1회 Gemini API 호출
- **데이터 크기**: 매우 긴 시스템 프롬프트 (500+ 토큰)

## 주요 최적화 포인트

### 1. 시나리오/페르소나 캐싱 추가
```typescript
// 제안: ConversationCache 클래스 추가
class ConversationCache {
  private static scenarioCache = new Map<string, any>();
  private static personaCache = new Map<string, any>();
  
  static async getScenarioData(conversationId: string) {
    if (!this.scenarioCache.has(conversationId)) {
      // DB 조회는 한 번만
      const data = await loadScenarioData(conversationId);
      this.scenarioCache.set(conversationId, data);
    }
    return this.scenarioCache.get(conversationId);
  }
}
```

### 2. 시스템 프롬프트 압축 및 캐싱
```typescript
// 현재 (길고 복잡)
const systemPrompt = `당신은 ${enrichedPersona.name}(${enrichedPersona.role})입니다.
=== 시나리오 배경 ===
상황: ${scenario.context?.situation}
목표: ${scenario.objectives?.join(', ')}
... (500+ 토큰)`;

// 제안 (압축된 버전)
const compactPrompt = `${persona.name}(${persona.role}). 상황: ${situation}. 목표: ${objectives}. MBTI: ${mbti}. 감정포함 JSON응답.`;
```

### 3. 응답 스트리밍 도입
```typescript
// 제안: 스트리밍으로 즉시 응답 시작
async generateStreamingResponse() {
  const stream = await this.genAI.models.generateContentStream({
    model: this.model,
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  });
  
  // 실시간으로 UI에 응답 전송
  for await (const chunk of stream) {
    yield chunk.text;
  }
}
```

### 4. 병렬 처리 최적화
```typescript
// 현재: 순차 처리
const scenarios = await fileManager.getAllScenarios();
const mbtiPersona = await fileManager.getPersonaByMBTI(mbtiType);
const aiResponse = await generateAIResponse(...);

// 제안: 병렬 처리
const [scenarios, mbtiPersona] = await Promise.all([
  fileManager.getAllScenarios(),
  fileManager.getPersonaByMBTI(mbtiType)
]);
```

### 5. 경량화된 응답 모드
```typescript
// 제안: 빠른 응답을 위한 경량 모드
const lightResponse = await this.genAI.models.generateContent({
  model: 'gemini-2.5-flash', // 더 빠른 모델
  config: {
    maxOutputTokens: 100, // 토큰 수 제한
    temperature: 0.3 // 더 일관된 응답
  }
});
```

## 예상 성능 개선 효과

| 최적화 항목 | 현재 시간 | 예상 개선 시간 | 개선율 |
|------------|-----------|---------------|--------|
| 캐싱 추가 | 2-3초 | 0.1초 | 90% |
| 프롬프트 압축 | 5-8초 | 2-3초 | 50% |
| 스트리밍 | 15초 대기 | 즉시 시작 | 100% |
| 병렬 처리 | 1-2초 | 0.3초 | 70% |

**전체 예상 개선**: 13-29초 → 3-7초 (70-80% 개선)

## 구현 우선순위
1. **즉시 적용 가능**: 캐싱, 병렬 처리
2. **단기 적용**: 프롬프트 압축, 경량 모드
3. **장기 적용**: 스트리밍, 모델 최적화