# AI 서비스 팩토리 (AI Service Factory)

> **소스**: `server/services/aiServiceFactory.ts`  
> **최초 작성**: 2026-04-15

---

## 1. 개요

`AIServiceFactory`와 `getAIServiceForFeature()`는 기능별로 독립적인 AI 제공업체 인스턴스를 생성한다. 레이스 컨디션을 방지하기 위해 **매 요청마다 새 인스턴스를 생성**한다(싱글턴 아님).

---

## 2. 기능별 DB 설정 키 매핑

`system_settings` 테이블 (`ai` 카테고리)에서 기능별 모델을 조회한다.

| Feature | DB 설정 키 |
|---------|-----------|
| `conversation` | `model_conversation` |
| `feedback` | `model_feedback` |
| `strategy` | `model_strategy` |
| `scenario` | `model_scenario` |

DB에 값이 없으면 기본값 `'gemini-2.5-flash'`를 사용한다.

---

## 3. 프로바이더 선택 로직

모델명 prefix로 프로바이더를 결정한다:

| 모델명 패턴 | 프로바이더 | 구현 클래스 |
|------------|-----------|------------|
| `gpt-*` | OpenAI | `OpenAIProvider` |
| `claude-*` | Claude (미구현 → Gemini fallback) | `OptimizedGeminiProvider` |
| 그 외 (기본값) | Gemini | `OptimizedGeminiProvider` |

---

## 4. Fallback 순서 및 환경변수 조합

### 환경변수별 활성 프로바이더

| 요청 모델 | `OPENAI_API_KEY` | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | 실제 사용 프로바이더 |
|----------|-----------------|--------------------------------------|---------------------|
| `gpt-*` | 설정됨 | 무관 | OpenAI (`OpenAIProvider`) |
| `gpt-*` | **없음** | 설정됨 | Gemini fallback (`gemini-2.5-flash`) |
| `gpt-*` | **없음** | **없음** | Gemini fallback 시도 (빈 키로 초기화 → API 호출 시 실패) |
| `claude-*` | 무관 | 설정됨 | Gemini fallback (`gemini-2.5-flash`) |
| `gemini-*` | 무관 | 설정됨 | Gemini |
| `gemini-*` | 무관 | **없음** | 즉시 에러: `GEMINI_API_KEY or GOOGLE_API_KEY is required` |

> **참고**: `gpt-*` 모델에서 `OPENAI_API_KEY`가 없으면 팩토리는 Gemini로 fallback한다. Gemini 키가 있는 경우 정상 동작한다. Gemini 키도 없는 경우, `createServiceWithModel()`은 빈 키(`''`)로 `OptimizedGeminiProvider`를 생성하고 즉시 에러를 throw하지 않는다 — 실제 실패는 첫 번째 API 호출 시점에 지연 발생한다.

### Fallback 우선순위 다이어그램

```
요청된 모델명
      │
      ├─ gpt-* ──────→ OPENAI_API_KEY 있음? ─Yes→ OpenAI
      │                        │No
      │                        └─→ Gemini fallback (gemini-2.5-flash)
      │
      ├─ claude-* ──→ Claude 미구현 → Gemini fallback (gemini-2.5-flash)
      │
      └─ 그 외 ──────→ GEMINI_API_KEY 있음? ─Yes→ Gemini
                               │No
                               └─→ 에러 (필수 키 없음)
```

---

## 5. 주요 공개 API

### `getAIServiceForFeature(feature)` ← **권장 진입점**

```typescript
const service = await getAIServiceForFeature('conversation');
```

1. DB에서 해당 기능의 모델명 조회 (`getModelForFeature`)
2. 모델명으로 프로바이더 결정
3. 새 서비스 인스턴스 반환

### `AIServiceFactory.createServiceWithModel(model)`

특정 모델을 직접 지정해 인스턴스 생성. 단위 테스트나 특수 케이스에 사용.

### 폐기(Deprecated) 함수

| 함수 | 대체 |
|------|------|
| `AIServiceFactory.getInstance()` | `getAIServiceForFeature()` |
| `getAIService()` | `getAIServiceForFeature()` |
| `syncModelForFeature()` | `getAIServiceForFeature()` |
| `syncModelFromSettings()` | `getAIServiceForFeature()` |

---

## 6. 필수 환경변수

| 변수 | 필수 여부 | 설명 |
|------|---------|------|
| `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY` | Gemini 모델 사용 시 필수 | 없으면 에러 |
| `OPENAI_API_KEY` | `gpt-*` 모델 사용 시 선택적 | 없으면 Gemini로 자동 fallback |

---

## 7. 관련 파일

- `server/services/aiService.ts` — `AIServiceInterface`, `AIServiceConfig` 타입 정의
- `server/services/providers/optimizedGeminiProvider.ts` — Gemini 구현체
- `server/services/providers/openaiProvider.ts` — OpenAI 구현체
- `server/services/providers/customProvider.ts` — 커스텀 프로바이더 구현체
- `docs/ai-model-registry.md` — 모델별 과금 정보
