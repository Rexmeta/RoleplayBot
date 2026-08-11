# AI API 설정 가이드

이 프로젝트는 다양한 AI 서비스 제공업체를 지원합니다. 기능별로 독립적인 모델을 선택할 수 있습니다.

---

## 🚀 빠른 설정

### 1. 환경 변수 파일 생성
```bash
cp .env.example .env
```

### 2. API 키 설정

`.env` 파일에 사용할 제공업체의 API 키를 설정하세요:

```env
# Gemini 사용 (기본값)
GEMINI_API_KEY=your_gemini_api_key_here

# OpenAI 사용 (기능별 또는 실시간 음성용)
OPENAI_API_KEY=your_openai_api_key_here
```

> **참고**: `AI_PROVIDER` 환경변수는 코드에서 로그 방지 목적으로 인식은 하지만, 실제 모델 라우팅은 **모델명 prefix 기반 자동 라우팅**으로 동작합니다. `AI_PROVIDER` 값이 아닌 아래 모델 결정 우선순위를 따르세요.

---

## 📋 모델 결정 우선순위

각 기능(`conversation`, `feedback`, `image`, `video` 등)의 AI 모델은 다음 순서로 결정됩니다:

```
1. 기능별 환경변수 (예: AI_MODEL_CONVERSATION)
      ↓ 없으면
2. 전역 환경변수 (AI_MODEL)
      ↓ 없으면
3. DB system_settings 테이블 (ai 카테고리, 관리자 페이지에서 설정)
      ↓ 없으면
4. 기능별 기본값
```

---

## 🎛️ 기능별 환경변수

| 기능 | 환경변수 | 기본값 |
|------|----------|--------|
| 대화 (롤플레이) | `AI_MODEL_CONVERSATION` | `gemini-2.5-flash` |
| 피드백 생성 | `AI_MODEL_FEEDBACK` | `gemini-2.5-flash` |
| 전략 회고 평가 | `AI_MODEL_STRATEGY` | `gemini-2.5-flash` |
| 시나리오 생성 | `AI_MODEL_SCENARIO` | `gemini-2.5-flash` |
| 번역 | `AI_MODEL_TRANSLATION` | `gemini-2.5-flash` |
| 실시간 감정 분석 | `AI_MODEL_EMOTION` | `gemini-2.5-flash` |
| 이미지 생성 | `AI_MODEL_IMAGE` | `gemini-2.5-flash-image` |
| 영상 생성 | `AI_MODEL_VIDEO` | `veo-3.1-generate-preview` |
| 아바타 클립 생성 | `AI_MODEL_AVATAR_VIDEO` | `veo-3.1-lite-generate-preview` |
| 턴별 평가 (음성) | `AI_MODEL_EVALUATION` | `gemini-2.5-flash` |
| 세션 요약 (음성) | `AI_MODEL_SUMMARIZATION` | `gemini-2.5-flash` |

실시간 음성 모델은 위와 별도로 `system_settings` → `ai / model_realtime`에서 설정합니다 (기본값: `gemini-3.1-flash-live-preview`).

---

## 📋 지원하는 AI 제공업체

### 🟢 Google Gemini (기본값)
```env
GEMINI_API_KEY=your_gemini_api_key_here
```
**API 키 발급**: [Google AI Studio](https://aistudio.google.com/app/apikey)

모델명이 `gemini-*` 또는 `veo-*`이면 자동으로 Gemini 프로바이더가 선택됩니다.

### 🔵 OpenAI
```env
OPENAI_API_KEY=your_openai_api_key_here
```
**API 키 발급**: [OpenAI Platform](https://platform.openai.com/api-keys)

모델명이 `gpt-*`이면 자동으로 OpenAI 프로바이더가 선택됩니다.  
OpenAI 키가 없으면 Gemini로 자동 fallback합니다.

---

## 🔄 런타임 중 모델 변경

1. 관리자 페이지 → AI 모델 설정에서 기능별 모델을 변경할 수 있습니다 (DB 설정, 서버 재시작 불필요)
2. 환경변수를 변경하려면 서버를 재시작해야 합니다

---

## 📊 API 응답 포맷

모든 AI 제공업체는 동일한 인터페이스를 사용합니다:

```typescript
// 대화 응답
{
  content: string;        // AI 응답 텍스트
  emotion: string;        // 감정 (기쁨, 슬픔, 분노, 놀람, 중립 등)
  emotionReason: string;  // 감정 이유
}

// 피드백 응답
{
  overallScore: number;   // 전체 점수 (0-100)
  scores: EvaluationScore[];
  strengths: string[];
  improvements: string[];
  summary: string;
  // ... (상세 필드는 shared/schema.ts → DetailedFeedback 참조)
}
```

---

## 🔍 문제 해결

### API 키 오류
```
Error: GEMINI_API_KEY or GOOGLE_API_KEY is required
```
→ 환경 변수에 올바른 API 키가 설정되었는지 확인

### 실시간 음성 모델 오류
```
⚠️ OpenAI Realtime model selected but OPENAI_API_KEY is not set
```
→ 관리자 페이지의 `model_realtime` 설정이 OpenAI 모델인데 `OPENAI_API_KEY`가 없는 경우. 설정을 `gemini-3.1-flash-live-preview`로 변경하거나 `OPENAI_API_KEY`를 설정하세요.

### 네트워크/속도 제한 오류
```
Error: API request failed: 429 Too Many Requests
```
→ API 사용량 한도 초과. 잠시 후 재시도 또는 관리자 페이지에서 다른 모델로 전환하세요.

---

## 📝 개발자 가이드

### 새로운 AI 제공업체 추가

1. `server/services/providers/` 디렉토리에 새 파일 생성
2. `AIServiceInterface` 구현
3. `server/services/aiServiceFactory.ts`의 `getProviderFromModel()`에 prefix 조건 추가

```typescript
// newProvider.ts
export class NewProvider implements AIServiceInterface {
  async generateResponse(scenario, messages, persona, userMessage, language, userName) {
    // 구현
  }
  async generateFeedback(scenario, messages, persona, conversation, evaluationCriteria, language) {
    // 구현
  }
}
```

### 모델별 과금 정보
`docs/ai-model-registry.md` 참조.

---

## 🔗 유용한 링크

- [Google Gemini API 문서](https://ai.google.dev/docs)
- [OpenAI API 문서](https://platform.openai.com/docs)
