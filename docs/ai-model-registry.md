# AI 모델 과금 레지스트리 (AI Model Registry)

> **소스**: `server/services/aiUsageTracker.ts`  
> **최초 작성**: 2026-04-15

---

## ⚠️ 새 모델 추가 시 필수 업데이트 파일

새로운 AI 모델을 추가할 때 **반드시 아래 파일들을 함께 수정해야 한다**:

1. **`server/services/aiUsageTracker.ts`** — `MODEL_PRICING` 또는 `VIDEO_PRICING` 테이블에 항목 추가
2. **`server/services/aiServiceFactory.ts`** — 모델명 prefix 기반 프로바이더 라우팅 확인
3. **`server/services/realtimeVoiceService.ts`** — `VALID_GEMINI_REALTIME_MODELS` 또는 `VALID_OPENAI_REALTIME_MODELS` 배열 (실시간 음성용 모델인 경우)
4. **이 문서** (`docs/ai-model-registry.md`) — 과금 표 업데이트

---

## 1. 토큰 기반 과금 (`MODEL_PRICING`)

단위: **USD per 1M tokens** (입력/출력 별도)

### 활성 Gemini 모델

| 모델 ID | 입력 ($/1M) | 출력 ($/1M) | 비고 |
|---------|------------|------------|------|
| `gemini-2.5-flash` | $0.30 | $2.50 | 대화·피드백·감정분석 기본 모델 |
| `gemini-2.5-pro` | $1.25 | $10.00 | ≤200K tokens 기준 |
| `gemini-3.1-flash-live-preview` | $0.35 | $1.50 | **실시간 음성 기본 모델** (v1beta) |
| `gemini-2.5-flash-image-preview` | $0.30 | $2.50 | 이미지 생성 |
| `veo-3.1-generate-preview` | $0.00 | $0.00 | 영상 전용 — 토큰 과금 없음, `VIDEO_PRICING` 참조 |
| `veo-3.1-lite-generate-preview` | $0.00 | $0.00 | 아바타 클립 전용 (720p Lite) — `VIDEO_PRICING` 참조 |

### 활성 OpenAI 모델

| 모델 ID | 입력 ($/1M) | 출력 ($/1M) | 비고 |
|---------|------------|------------|------|
| `gpt-4o` | $2.50 | $10.00 | |
| `gpt-4o-mini` | $0.15 | $0.60 | |
| `gpt-4o-realtime-preview` | $5.00 | $20.00 | Realtime API (텍스트 토큰 기준) |

### OpenRouter 모델

OpenRouter 모델은 `provider=openrouter` 정책으로 선택하며 모델 slug(예: `anthropic/...`,
`openai/...`)는 OpenRouter에 그대로 전달한다. 공급자별 가격은 OpenRouter upstream
가격과 다를 수 있으므로, 등록되지 않은 slug는 비용을 0으로 기록하고 경고한다.

---

## 2. 레거시 모델 (히스토리 보존용)

사용량 로그 레코드 역참조를 위해 과금 테이블에 보존되지만, 실시간 음성 세션에서는 유효하지 않음.

| 모델 ID | 비고 |
|---------|------|
| `gemini-live-2.5-flash-preview` | 이전 실시간 모델명 |
| `gemini-live-2.5-flash-native-audio` | 이전 실시간 모델명 |
| `gemini-3.1-flash-live` | 단축 이름 (미지원) |
| `gemini-2.0-flash-live-preview-04-09` | 구버전 |
| `gemini-2.0-flash-live-001` | 구버전 |
| `gemini-live-2.5-flash` | 구버전 단축 이름 |
| `gemini-2.5-flash-native-audio-preview-09-2025` | 구버전 |
| `gemini-2.0-flash-preview-image-generation` | 이미지 생성 구버전 |

---

## 3. 영상 단위 과금 (`VIDEO_PRICING`)

영상 생성 모델은 토큰이 아닌 **영상 1편당 고정 비용**으로 과금된다.  
`trackVideoUsage()`가 `VIDEO_PRICING`을 참조하며, 토큰 필드는 모두 0으로 기록된다.

| 모델 ID | 영상당 비용 | 비고 |
|---------|-----------|------|
| `veo-3.1-generate-preview` | $0.35 | 8초 영상 기준 (추정치) |
| `veo-3.1-lite-generate-preview` | $0.18 | 8초, 720p Lite (추정치) |

**기본값**: `VIDEO_PRICING`에 없는 모델은 `$0.35`를 기본 적용한다.

---

## 4. 비용 계산 공식

```typescript
inputCost  = (promptTokens / 1_000_000) * pricing.input
outputCost = (completionTokens / 1_000_000) * pricing.output
totalCost  = inputCost + outputCost
```

Gemini 모델은 캐시 할인 적용: 캐시 토큰은 정가의 25% 과금 (75% 절약).

결과는 소수점 6자리까지 반올림한다.  
알 수 없는 모델은 경고를 출력하고 비용 0으로 기록한다.

---

## 5. AIProvider 타입

```typescript
type AIProvider = 'gemini' | 'openai' | 'openrouter' | 'anthropic' | 'other';
```

모델명 prefix 기반 자동 추론:
- `gemini*` → `'gemini'`
- `gpt*` / `o1*` → `'openai'`
- `claude*` → `'anthropic'`
- 그 외 → `'other'`

---

## 6. 핵심 함수 참조

| 함수 | 설명 |
|------|------|
| `trackUsage(params)` | 비동기(fire-and-forget) 사용량 기록 |
| `trackUsageSync(params)` | 동기 사용량 기록 — 로깅 완료 보장 필요 시 사용 |
| `trackVideoUsage(params)` | 영상 단위 과금 기록 (토큰 필드 = 0) |
| `trackImageUsage(params)` | 이미지 사용량 기록 (토큰 추정: 입력 800, 출력 1500) |
| `calculateCost(model, promptTokens, completionTokens)` | 비용 계산만 수행 (기록 없음) |
| `extractGeminiTokens(response)` | Gemini 응답에서 토큰 사용량 추출 |
| `extractOpenAITokens(response)` | OpenAI 응답에서 토큰 사용량 추출 |
| `getModelPricingKey(model)` | 모델 ID → `MODEL_PRICING` 키 매핑 |
| `getProviderFromModel(model)` | 모델명 → `AIProvider` 추론 |

---

## 7. 사용량 로그 저장소

`trackUsage()`는 `storage.logUsageAndIncrementSubscription()`을 통해 `aiUsageLogs` 테이블에 원자적으로 기록한다 (사용량 로그 + 구독 카운터 증가를 단일 DB 트랜잭션으로 처리).  
스키마 정의: `shared/schema.ts` → `InsertAiUsageLog` 참조.
