# AI API 설정 가이드

이 프로젝트는 다양한 AI 서비스 제공업체를 지원합니다. 환경 변수만 변경하면 쉽게 다른 AI API로 교체할 수 있습니다.

## 🚀 빠른 설정

### 1. 환경 변수 파일 생성
```bash
cp .env.example .env
```

### 2. AI 제공업체 선택
`.env` 파일에서 `AI_PROVIDER` 값을 설정하세요:

```env
# Gemini 사용 (기본값)
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here

# OpenAI 사용
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here

# Custom API 사용
AI_PROVIDER=custom
CUSTOM_API_KEY=your_api_key_here
CUSTOM_API_URL=https://your-api-endpoint.com/v1
CUSTOM_MODEL=your_model_name
```

## 📋 지원하는 AI 제공업체

### 🟢 Google Gemini (기본값)
```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash  # 선택사항
```

**API 키 발급**: [Google AI Studio](https://aistudio.google.com/app/apikey)

### 🔵 OpenAI
```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4  # 선택사항
```

**API 키 발급**: [OpenAI Platform](https://platform.openai.com/api-keys)

### 🟡 Custom API (모든 OpenAI 호환 API)
```env
AI_PROVIDER=custom
CUSTOM_API_KEY=your_api_key_here
CUSTOM_API_URL=https://your-api-endpoint.com/v1
CUSTOM_MODEL=your_model_name
CUSTOM_HEADERS={"Authorization": "Bearer token", "Custom-Header": "value"}
```

**지원 서비스 예시**:
- Together AI
- Groq
- Replicate
- Hugging Face Inference API
- 자체 구축 API 서버

## 🛠 Custom API 설정 예시

### Together AI
```env
AI_PROVIDER=custom
CUSTOM_API_KEY=your_together_api_key
CUSTOM_API_URL=https://api.together.xyz/v1
CUSTOM_MODEL=meta-llama/Llama-2-70b-chat-hf
```

### Groq
```env
AI_PROVIDER=custom
CUSTOM_API_KEY=your_groq_api_key
CUSTOM_API_URL=https://api.groq.com/openai/v1
CUSTOM_MODEL=mixtral-8x7b-32768
```

### Hugging Face
```env
AI_PROVIDER=custom
CUSTOM_API_KEY=your_hf_token
CUSTOM_API_URL=https://api-inference.huggingface.co/models/microsoft/DialoGPT-large
CUSTOM_MODEL=microsoft/DialoGPT-large
```

## 🔄 런타임 중 API 변경

프로젝트 실행 중에도 환경 변수를 변경하면 새로운 요청부터 변경된 API가 적용됩니다:

1. `.env` 파일 수정
2. 서버 재시작 (자동 재시작됨)
3. 새로운 대화 시작 시 변경된 API 사용

## 📊 API 응답 포맷

모든 AI 제공업체는 동일한 인터페이스를 사용합니다:

```typescript
// 대화 응답
{
  content: string;           // AI 응답 텍스트
  emotion: string;           // 감정 (기쁨, 슬픔, 분노, 놀람, 중립)
  emotionReason: string;     // 감정 이유
}

// 피드백 응답
{
  overallScore: number;      // 전체 점수 (0-100)
  scores: {
    clarity: number;         // 명확성 (1-5)
    empathy: number;         // 공감성 (1-5)
    responsiveness: number;  // 반응성 (1-5)
    structure: number;       // 구조화 (1-5)
    professionalism: number; // 전문성 (1-5)
  };
  strengths: string[];       // 강점
  improvements: string[];    // 개선점
  nextSteps: string[];       // 다음 단계
  summary: string;           // 요약
}
```

## ⚡ 성능 최적화

### API 요청 최적화
- **Temperature**: 창의성 조절 (0.0-1.0)
- **Max Tokens**: 응답 길이 제한
- **Model Selection**: 용도에 맞는 모델 선택

### 비용 최적화
```env
# 비용 효율적인 모델 사용
GEMINI_MODEL=gemini-2.5-flash    # Gemini 저비용 모델
OPENAI_MODEL=gpt-3.5-turbo       # OpenAI 저비용 모델
```

## 🔍 문제 해결

### API 키 오류
```
Error: GEMINI_API_KEY is required for Gemini provider
```
→ 환경 변수에 올바른 API 키가 설정되었는지 확인

### 네트워크 오류
```
Error: API request failed: 429 Too Many Requests
```
→ API 사용량 한도 초과, 잠시 후 재시도 또는 다른 제공업체 사용

### 모델 오류
```
Error: Model not found
```
→ 모델명이 올바른지 확인, 제공업체별 지원 모델 목록 확인

## 📝 개발자 가이드

### 새로운 AI 제공업체 추가

1. `server/services/providers/` 디렉토리에 새 파일 생성
2. `AIServiceInterface` 구현
3. `aiServiceFactory.ts`에 새 제공업체 추가
4. 환경 변수 설정 추가

```typescript
// newProvider.ts
export class NewProvider implements AIServiceInterface {
  async generateResponse(scenario, messages, persona, userMessage) {
    // 구현
  }
  
  async generateFeedback(scenario, messages, persona) {
    // 구현
  }
}
```

### 커스텀 프롬프트 수정

각 제공업체의 파일에서 시스템 프롬프트를 수정할 수 있습니다:

```typescript
const systemPrompt = `당신은 ${persona.name}입니다...`;
```

## 🔗 유용한 링크

- [Google Gemini API 문서](https://ai.google.dev/docs)
- [OpenAI API 문서](https://platform.openai.com/docs)
- [Together AI 문서](https://docs.together.ai/)
- [Groq API 문서](https://console.groq.com/docs)