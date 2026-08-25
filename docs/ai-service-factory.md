# AI 서비스 팩토리 (AI Service Factory)

> **소스**: `server/services/aiServiceFactory.ts`  
> **최초 작성**: 2026-04-15

---

## 1. 개요

`AIServiceFactory`와 `getAIServiceForFeature()`는 기능별로 독립적인 AI 제공업체 인스턴스를 생성한다. 레이스 컨디션을 방지하기 위해 **매 요청마다 새 인스턴스를 생성**한다(싱글턴 아님).

---

## 2. AIFeature 타입

```typescript
export type AIFeature =
  | 'conversation'   // 롤플레이 대화
  | 'feedback'       // 대화 피드백 생성
  | 'strategy'       // 전략 회고 평가
  | 'scenario'       // 시나리오 생성
  | 'translation'    // 다국어 번역
  | 'emotion'        // 실시간 감정 분석
  | 'image'          // 이미지 생성
  | 'video'          // 영상 생성
  | 'avatar_video'   // 아바타 클립 생성
  | 'evaluation'     // 음성 세션 중 턴별 평가
  | 'summarization'; // 긴 음성 세션 메시지 요약
```

---

## 3. 모델 결정 우선순위

`getModelForFeature(feature)` 함수는 다음 순서로 모델을 결정한다:

```
1. 기능별 환경변수 (예: AI_MODEL_CONVERSATION)
      ↓ 없으면
2. 전역 환경변수 (AI_MODEL)
      ↓ 없으면
3. DB system_settings 테이블 (ai 카테고리)
      ↓ 없으면
4. 기능별 기본값 (FEATURE_DEFAULTS) 또는 공통 기본값 'gemini-2.5-flash'
```

---

## 4. 기능별 설정 키 & 환경변수 매핑

| Feature | DB 설정 키 (`ai` 카테고리) | 환경변수 키 |
|---------|--------------------------|-------------|
| `conversation` | `model_conversation` | `AI_MODEL_CONVERSATION` |
| `feedback` | `model_feedback` | `AI_MODEL_FEEDBACK` |
| `strategy` | `model_strategy` | `AI_MODEL_STRATEGY` |
| `scenario` | `model_scenario` | `AI_MODEL_SCENARIO` |
| `translation` | `model_translation` | `AI_MODEL_TRANSLATION` |
| `emotion` | `model_emotion` | `AI_MODEL_EMOTION` |
| `image` | `model_image` | `AI_MODEL_IMAGE` |
| `video` | `model_video` | `AI_MODEL_VIDEO` |
| `avatar_video` | `model_avatar_video` | `AI_MODEL_AVATAR_VIDEO` |
| `evaluation` | `model_evaluation` | `AI_MODEL_EVALUATION` |
| `summarization` | `model_summarization` | `AI_MODEL_SUMMARIZATION` |

---

## 5. 기능별 기본값 (FEATURE_DEFAULTS)

설정이 없을 때 공통 기본값(`gemini-2.5-flash`)이 아닌 기능 전용 모델을 사용하는 기능:

| Feature | 기본값 |
|---------|--------|
| `image` | `gemini-2.5-flash-image` |
| `video` | `veo-3.1-generate-preview` |
| `avatar_video` | `veo-3.1-lite-generate-preview` |
| 나머지 | `gemini-2.5-flash` |

---

## 6. 프로바이더 선택 로직

모델명 prefix로 프로바이더를 결정한다:

| 모델명 패턴 | 프로바이더 | 구현 클래스 |
|------------|-----------|------------|
| `gpt-*` | OpenAI | `OpenAIProvider` |
| `claude-*` | Claude (미구현 → Gemini fallback) | `OptimizedGeminiProvider` |
| 그 외 (기본값) | Gemini | `OptimizedGeminiProvider` |

OpenRouter는 모델명만으로 선택하지 않는다. 다음처럼 `AI_PROVIDER=openrouter`
와 모델을 별도로 지정하거나, 기능별 DB 설정에 명시적 정책 JSON을 저장한다:

```text
AI_PROVIDER=openrouter
AI_MODEL_CONVERSATION=anthropic/claude-3.5-sonnet
OPENROUTER_API_KEY=...
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

DB 설정은 `{"provider":"openrouter","model":"openai/gpt-4o-mini","baseUrl":"https://..."}` 형식이며,
간단한 `openrouter|anthropic/claude-3.5-sonnet` 형식도 지원한다. `anthropic/...` 또는
`openai/...` 모델 slug만 단독으로 설정하면 기존 호환성을 위해 Gemini 모델로 취급한다.

---

## 7. Fallback 순서 및 환경변수 조합

| 요청 모델 | `OPENAI_API_KEY` | Gemini 키 | 실제 사용 프로바이더 |
|----------|-----------------|-----------|---------------------|
| `gpt-*` | 설정됨 | 무관 | OpenAI |
| `gpt-*` | **없음** | 설정됨 | Gemini fallback (`gemini-2.5-flash`) |
| `gpt-*` | **없음** | **없음** | 빈 키로 Gemini 초기화 — 첫 API 호출 시 실패 |
| `claude-*` | 무관 | 설정됨 | Gemini fallback (`gemini-2.5-flash`) |
| `gemini-*` | 무관 | 설정됨 | Gemini |
| `gemini-*` | 무관 | **없음** | 즉시 에러 |

---

## 8. 주요 공개 API

### `getAIServiceForFeature(feature)` ← **권장 진입점**

```typescript
const service = await getAIServiceForFeature('conversation');
```

1. DB에서 해당 기능의 모델명 조회 (`getModelForFeature`)
2. 모델명으로 프로바이더 결정
3. 새 서비스 인스턴스 반환

### `getModelForFeature(feature)`

모델명만 반환 (인스턴스 생성 없음). 로깅·디버깅에 활용.

### `AIServiceFactory.createServiceWithModel(model)`

특정 모델을 직접 지정해 인스턴스 생성. 단위 테스트나 특수 케이스에 사용.

---

## 9. OpenRouter 지원 범위 및 오류

OpenRouter는 OpenAI-compatible 텍스트 호출(대화, 피드백, 번역, 요약 등)에만 사용한다.
이미지·영상 생성은 Gemini 전용 경로를 유지하고, OpenRouter를 해당 기능에 지정하면
명확한 설정 오류를 반환한다. Realtime 음성도 직접 Gemini/OpenAI 경로를 사용한다.
API 키가 없거나 base URL이 HTTP(S)가 아니면 요청 전에 오류가 발생하며, upstream 오류는
키를 포함하지 않은 정규화된 오류로 전달된다. 스트리밍 응답의 토큰 사용량도 기존
사용량 추적기에 `provider=openrouter`로 기록된다.

## 10. 필수 환경변수

| 변수 | 필수 여부 | 설명 |
|------|---------|------|
| `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY` | Gemini 모델 사용 시 필수 | 없으면 에러 |
| `OPENAI_API_KEY` | `gpt-*` 모델 사용 시 선택적 | 없으면 Gemini로 자동 fallback |
| `OPENROUTER_API_KEY` | OpenRouter 사용 시 필수 | 배포 Secret으로만 설정 |
| `OPENROUTER_BASE_URL` | 선택적 | 기본값 `https://openrouter.ai/api/v1` |

---

## 11. 관련 파일

- `server/services/aiService.ts` — `AIServiceInterface`, `AIServiceConfig` 타입 정의
- `server/services/providers/optimizedGeminiProvider.ts` — Gemini 구현체
- `server/services/providers/openaiProvider.ts` — OpenAI 구현체
- `server/services/providers/customProvider.ts` — 커스텀 프로바이더 구현체
- `docs/ai-model-registry.md` — 모델별 과금 정보
