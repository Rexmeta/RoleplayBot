# AI 모델 과금 레지스트리 (AI Model Registry)

> **소스**: `server/services/aiUsageTracker.ts`  
> **최초 작성**: 2026-04-15

---

## ⚠️ 새 모델 추가 시 필수 업데이트 파일

새로운 AI 모델을 추가할 때 **반드시 아래 파일들을 함께 수정해야 한다**:

1. **`server/services/aiUsageTracker.ts`** — `MODEL_PRICING` 또는 `VIDEO_PRICING` 테이블에 항목 추가
2. **`server/services/aiServiceFactory.ts`** — 모델명 prefix 기반 프로바이더 라우팅 확인
3. **`server/services/realtimeVoiceService.ts`** — `getRealtimeModel()`의 `validModels` 배열 (실시간 음성용 모델인 경우)
4. **이 문서** (`docs/ai-model-registry.md`) — 과금 표 업데이트

---

## 1. 토큰 기반 과금 (`MODEL_PRICING`)

단위: **USD per 1M tokens** (입력/출력 별도)  
업데이트: 2025년 12월

### Gemini 모델

| 모델 ID | 입력 ($/1M) | 출력 ($/1M) | 비고 |
|---------|------------|------------|------|
| `gemini-2.5-flash` | $0.30 | $2.50 | 기본 대화/피드백 모델 |
| `gemini-2.5-pro` | $1.25 | $10.00 | ≤200K tokens 기준 |
| `gemini-2.0-flash-live-001` | $0.35 | $1.50 | Gemini Live 프리뷰 |
| `gemini-2.5-flash-native-audio-preview-09-2025` | $0.35 | $1.50 | 실시간 음성 (기본 모델) |
| `gemini-2.5-flash-image-preview` | $0.30 | $2.50 | 이미지 생성 |
| `gemini-2.0-flash-preview-image-generation` | $0.30 | $2.50 | 이미지 생성 (레거시) |
| `veo-3.1-generate-preview` | $0.00 | $0.00 | 영상 전용 — 토큰 과금 없음, `VIDEO_PRICING` 참조 |

### OpenAI 모델

| 모델 ID | 입력 ($/1M) | 출력 ($/1M) | 비고 |
|---------|------------|------------|------|
| `gpt-4o` | $2.50 | $10.00 | |
| `gpt-4o-mini` | $0.15 | $0.60 | |
| `gpt-4o-realtime-preview` | $5.00 | $20.00 | Realtime API (텍스트 토큰 기준) |

---

## 2. 영상 단위 과금 (`VIDEO_PRICING`)

영상 생성 모델은 토큰이 아닌 **영상 1편당 고정 비용**으로 과금된다.  
`trackVideoUsage()`가 `VIDEO_PRICING`을 참조하며, 토큰 필드는 모두 0으로 기록된다.

| 모델 ID | 영상당 비용 | 비고 |
|---------|-----------|------|
| `veo-3.1-generate-preview` | $0.35 | 8초 영상 기준 (추정치) |

**기본값**: `VIDEO_PRICING`에 없는 모델은 `$0.35`를 기본 적용한다.

---

## 3. 비용 계산 공식

```typescript
inputCost  = (promptTokens / 1_000_000) * pricing.input
outputCost = (completionTokens / 1_000_000) * pricing.output
totalCost  = inputCost + outputCost
```

결과는 소수점 6자리까지 반올림한다.  
알 수 없는 모델은 경고를 출력하고 비용 0으로 기록한다.

---

## 4. AIFeature 타입

```typescript
type AIFeature = 
  | 'conversation'   // 롤플레이 대화
  | 'feedback'       // 대화 피드백 생성
  | 'strategy'       // 전략 추천
  | 'scenario'       // 시나리오 생성
  | 'realtime'       // 실시간 음성
  | 'image'          // 이미지 생성
  | 'video'          // 영상 생성
  | 'other';
```

---

## 5. AIProvider 타입

```typescript
type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'other';
```

모델명 prefix 기반 자동 추론 함수:
- `gemini*` → `'gemini'`
- `gpt*` / `o1*` → `'openai'`
- `claude*` → `'anthropic'`
- 그 외 → `'other'`

---

## 6. 핵심 함수 참조

| 함수 | 설명 |
|------|------|
| `trackUsage(params)` | 비동기(fire-and-forget) 사용량 기록 — API 응답 속도에 영향 없음 |
| `trackUsageSync(params)` | 동기 사용량 기록 — 로깅 완료 보장이 필요한 경우 사용 |
| `trackVideoUsage(params)` | 영상 단위 과금 기록 (토큰 필드 = 0) |
| `trackImageUsage(params)` | 이미지 사용량 기록 (토큰 추정: 입력 800, 출력 1500) |
| `calculateCost(model, promptTokens, completionTokens)` | 비용 계산만 수행 (기록 없음) |
| `extractGeminiTokens(response)` | Gemini 응답에서 토큰 사용량 추출 |
| `extractOpenAITokens(response)` | OpenAI 응답에서 토큰 사용량 추출 |
| `getModelPricingKey(model)` | 모델 ID → `MODEL_PRICING` 키 매핑 |
| `getProviderFromModel(model)` | 모델명 → `AIProvider` 추론 |

---

## 7. 사용량 로그 저장소

`trackUsage()`는 `storage.createAiUsageLog()`를 통해 `aiUsageLogs` 테이블에 기록한다.  
스키마 정의: `shared/schema.ts` → `InsertAiUsageLog` 참조.
