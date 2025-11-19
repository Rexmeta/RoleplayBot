# 난이도 시스템 구현 가이드

## 📌 개요

이 문서는 AI 롤플레잉 훈련 시스템의 난이도 시스템 구현을 설명합니다.

## 🎯 핵심 원칙

### 단일 진실 원천 (Single Source of Truth)
- **시나리오 난이도**가 유일한 난이도 설정입니다
- MBTI 페르소나는 난이도를 저장하지 않습니다
- 모든 대화 모드(텍스트/TTS/실시간 음성)에서 동일한 난이도 적용

```typescript
// ✅ 올바른 방식
const difficulty = scenario.difficulty || 4;

// ❌ 잘못된 방식 (제거됨)
const difficulty = scenario.difficulty || persona.conversationDifficultyLevel || 4;
```

## 📊 난이도 레벨 정의

| Level | 이름 | 대상 | 응답 길이 | 말투 | 압박감 |
|-------|------|------|-----------|------|--------|
| 1 | 매우 쉬움 | 초보자 | 1-3문장 | 매우 친절하고 격려적 | 없음 |
| 2 | 기본 난이도 | 일반 사용자 | 1-2문장 | 친절하지만 현실적 | 약함 |
| 3 | 도전형 | 중급자 | 1-2문장 | 현실적이고 비판적 | 중간 |
| 4 | 고난도 | 실전 훈련 | 1-2문장(10-15단어) | 바쁘고 직설적 | 강함 |

상세 내용은 `server/services/conversationDifficultyPolicy.ts` 참조

## 🔧 구현 구조

### 1. 난이도 정책 관리
**파일**: `server/services/conversationDifficultyPolicy.ts`

```typescript
// 핵심 함수
export function getDifficultyGuidelines(level: number = 4): DifficultyGuidelines
export function getTextModeGuidelines(level: number = 4): string
export function getRealtimeVoiceGuidelines(level: number = 4): string
export function validateDifficultyLevel(level: number | undefined): number
```

**역할**:
- 4단계 난이도 가이드라인 정의
- 텍스트/TTS 모드용 간결한 프롬프트 생성
- 실시간 음성용 상세한 프롬프트 생성
- 난이도 유효성 검증 (1-4 범위)

### 2. 텍스트/TTS 모드
**파일**: `server/services/providers/optimizedGeminiProvider.ts`

```typescript
private buildCompactPrompt(scenario: any, persona: ScenarioPersona, conversationHistory: string): string {
  // 1. 시나리오 난이도 가져오기
  const difficultyLevel = validateDifficultyLevel(scenario.difficulty);
  
  // 2. 난이도 가이드라인 생성
  const difficultyGuidelines = getTextModeGuidelines(difficultyLevel);
  
  // 3. 프롬프트에 삽입
  return `당신은 ${persona.name}입니다.
  
  ${difficultyGuidelines}
  
  역할:
  - 위 대화 난이도 설정을 정확히 따라주세요
  - 난이도가 낮으면 친절하고 격려적으로, 높으면 압박적이고 비판적으로`;
}
```

### 3. 실시간 음성 모드
**파일**: `server/services/realtimeVoiceService.ts`

```typescript
private buildSystemInstructions(scenario: any, scenarioPersona: any, mbtiPersona: any): string {
  // 1. 시나리오 난이도 가져오기
  const difficultyLevel = validateDifficultyLevel(scenario.difficulty);
  
  // 2. 실시간 음성용 상세 가이드라인 생성
  const difficultyGuidelines = getRealtimeVoiceGuidelines(difficultyLevel);
  
  // 3. 프롬프트에 삽입
  const instructions = [
    `# 당신의 정체성`,
    `당신은 "${scenarioPersona.name}"이라는 실제 사람입니다.`,
    ``,
    `# 🎭 연기 지침 (매우 중요!)`,
    difficultyGuidelines,
    ``,
    `# ⭐ 핵심 원칙`,
    `반드시 한국어로만 대화하세요.`
  ];
  
  return instructions.join('\n');
}
```

## ⚠️ 주의사항

### ❌ 하드코딩 금지
난이도와 충돌하는 고정된 지침을 프롬프트에 넣지 마세요:

```typescript
// ❌ 잘못된 예시 (제거됨)
역할:
- 상대방이 쉽게 동의할 수 없는 도전적인 입장을 취하세요
- 반대 의견이나 어려운 질문을 제기하세요
```

이런 지침은 항상 "도전적"이므로 Level 1(매우 쉬움)과 충돌합니다.

### ✅ 올바른 방식
```typescript
역할:
- 위 대화 난이도 설정을 정확히 따라주세요
- 난이도가 낮으면 친절하고 격려적으로, 높으면 압박적이고 비판적으로
```

## 🔄 코드 흐름

```
시나리오 선택
    ↓
scenario.difficulty 가져오기
    ↓
validateDifficultyLevel(difficulty) → 1-4 검증
    ↓
getDifficultyGuidelines(level) → 가이드라인 객체 반환
    ↓
┌─────────────────────┬─────────────────────┐
│  텍스트/TTS 모드     │  실시간 음성 모드    │
│  getTextMode        │  getRealtimeVoice   │
│  Guidelines()       │  Guidelines()       │
└─────────────────────┴─────────────────────┘
    ↓                        ↓
프롬프트에 가이드라인 삽입
    ↓
AI가 난이도에 맞게 응답 생성
```

## 📝 난이도 미설정 시

```typescript
if (!scenario.difficulty) {
  console.warn(`⚠️ 시나리오 "${scenario.title}"에 난이도 미설정, 기본값 4 적용`);
}
const difficultyLevel = validateDifficultyLevel(scenario.difficulty); // → 4
```

## 🎭 MBTI + 난이도 = 대화 스타일

최종 대화 스타일은 두 요소의 조합:

```
대화 스타일 = MBTI 성격 특성 + 시나리오 난이도
```

**예시**:
- **ISTJ + Level 1**: 논리적이지만 친절하고 교육적
- **ISTJ + Level 4**: 논리적이고 압박적, 직설적
- **ENFJ + Level 1**: 공감적이고 매우 친절
- **ENFJ + Level 4**: 공감적이지만 바쁘고 직설적

## 🧪 테스트 체크리스트

시나리오 생성/편집 시:
- [ ] 난이도 1-4 설정 확인
- [ ] Level 1 테스트: AI가 친절하고 격려적인가?
- [ ] Level 4 테스트: AI가 압박적이고 직설적인가?
- [ ] 응답 길이 확인 (Level 1: 3문장, Level 4: 10-15단어)
- [ ] 말투 확인 (Level 1: 격려적, Level 4: 비판적)

## 📚 관련 파일

### 핵심 구현
- `server/services/conversationDifficultyPolicy.ts` - 난이도 정책 정의
- `server/services/providers/optimizedGeminiProvider.ts` - 텍스트/TTS 프롬프트
- `server/services/realtimeVoiceService.ts` - 실시간 음성 프롬프트

### 데이터 모델
- `shared/schema.ts` - 시나리오 스키마 (difficulty 필드)
- `server/mbti/*.json` - MBTI 페르소나 (난이도 필드 제거됨)

### 문서
- `README.md` - 사용자용 난이도 설명
- `docs/difficulty-system-analysis.md` - 기술 분석
- `replit.md` - 프로젝트 개요

## 🔍 디버깅 팁

### 난이도가 적용되지 않는 경우
1. 콘솔에서 경고 확인: `⚠️ 시나리오 ... 난이도 미설정`
2. 시나리오 객체에 `difficulty` 필드 존재 확인
3. `validateDifficultyLevel()` 호출 확인
4. 프롬프트에 `${difficultyGuidelines}` 삽입 확인

### AI가 여전히 도전적으로 응답하는 경우
1. 프롬프트에 하드코딩된 지침 확인
2. "도전적", "반대 의견" 등의 키워드 검색
3. 난이도 가이드라인이 실제로 적용되는지 로그 확인

---

**마지막 업데이트**: 2025-11-19
**작성자**: AI Agent
**버전**: 2.0 (MBTI 난이도 제거 후)
