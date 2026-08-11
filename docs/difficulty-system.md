# 난이도 시스템 (Difficulty System)

> **소스**: `server/services/conversationDifficultyPolicy.ts`

---

## 1. 개요 & 설계 의도

AI 롤플레잉 훈련 시스템의 **대화 난이도**는 시나리오에 설정된 단일 값으로 결정된다.

### 핵심 원칙

- **시나리오 난이도가 유일한 진실 원천(Single Source of Truth)**이다.
- MBTI 페르소나는 대화 *스타일*만 변경하며, 난이도 결정에 참여하지 않는다.
- 난이도 미설정 시 `validateDifficultyLevel()`의 기본값 **2**가 사용된다.
- 모든 대화 모드(텍스트 / TTS / 실시간 음성)에서 동일하게 적용된다.

### 설계 이유

| 이유 | 설명 |
|------|------|
| 일관성 | 같은 시나리오는 어떤 MBTI를 선택해도 동일한 난이도로 진행된다. |
| 시나리오 중심 설계 | 난이도는 상황의 복잡성을 반영해야 하므로 시나리오 단위로 관리한다. |
| 관리 편의성 | 관리자가 시나리오 난이도만 조정하면 전체 대화 스타일을 제어할 수 있다. |

---

## 2. 런타임 흐름 & 코드 경로

### 우선순위 체인

```
personaRun.difficulty (사용자 대화 시작 시 선택)
    OR
scenarioRun.difficulty (시나리오 설정값)
    ↓ 없으면
validateDifficultyLevel() → 기본값 2
```

### 실제 코드 경로

```typescript
// 1. 실시간 음성 세션 (routes.ts)
const userSelectedDifficulty = personaRun.difficulty || scenarioRun.difficulty || 2;

// 2. 텍스트/TTS 대화 (routes/conversations.ts)
difficulty: validatedData.difficulty || 2

// 3. 유효성 검증 (conversationDifficultyPolicy.ts)
export function validateDifficultyLevel(level: number | undefined): number {
  if (!level || level < 1 || level > 4) return 2; // 기본값
  return level;
}
```

### 대화 모드별 가이드라인 생성 흐름

```
시나리오 선택
    ↓
scenario.difficulty → validateDifficultyLevel() → 1-4 검증
    ↓
┌─────────────────────────┬───────────────────────────┐
│  텍스트 / TTS 모드      │  실시간 음성 모드           │
│  getTextModeGuidelines()│  getRealtimeVoiceGuidelines│
│  (짧은 인라인 지침)     │  (상세 지침 블록)           │
└─────────────────────────┴───────────────────────────┘
    ↓
프롬프트에 삽입 → AI가 난이도에 맞게 응답 생성
```

---

## 3. 레벨 정의

| Level | 이름 | 대상 | 응답 길이 | 말투 | 압박감 |
|-------|------|------|-----------|------|--------|
| 1 | 매우 쉬움 (입문) | 초보자 | 1-3문장 | 매우 친절하고 격려적 | 없음 |
| 2 | 기본 난이도 (**기본값**) | 일반 사용자 | 1-2문장 | 친절하지만 현실적 | 약함 |
| 3 | 도전형 | 중급자 | 1-2문장 | 현실적이고 비판적 | 중간 |
| 4 | 고난도 | 실전 훈련 | 1-2문장 (10-15단어) | 바쁘고 직설적 | 강함 |

### 레벨별 대화 행동 차이

| Level | AI 태도 | 사용자 요구 수준 |
|-------|---------|----------------|
| 1 | 협조적, 긍정적, 즉시 수용 | 기본 표현만으로 충분 |
| 2 | 균형 잡힌 태도, 보통 수준의 반론 | 합리적 설득 가능 |
| 3 | 비판적, 회의적, 구체적 근거 요구 | 논리적 주장 필요 |
| 4 | 강한 반대, 감정적 반응, 복잡한 이해관계 | 설득이 매우 어려움 |

### MBTI + 난이도 조합 예시

```
대화 스타일 = MBTI 성격 특성 + 시나리오 난이도

ISTJ + Level 1: 논리적이지만 친절하고 교육적
ISTJ + Level 4: 논리적이고 압박적, 직설적
ENFJ + Level 1: 공감적이고 매우 친절
ENFJ + Level 4: 공감적이지만 바쁘고 직설적
```

---

## 4. 구현 파일 참조

### 핵심 파일

| 파일 | 역할 |
|------|------|
| `server/services/conversationDifficultyPolicy.ts` | 난이도 정책 정의; 4단계 가이드라인, 유효성 검증, 각 모드용 프롬프트 문자열 |
| `server/services/providers/optimizedGeminiProvider.ts` | 텍스트/TTS 모드: `buildCompactPrompt()` 내부에서 `getTextModeGuidelines()` 호출 |
| `server/services/voice/systemPromptBuilder.ts` | 실시간 음성 모드: `buildSystemInstructions()` 내부에서 `getRealtimeVoiceGuidelines()` 호출 |
| `server/services/conversationContextBuilder.ts` | `buildDifficultyGuidelines()` — 두 프로바이더가 공통으로 사용하는 래퍼 |

### 핵심 함수

```typescript
// conversationDifficultyPolicy.ts
export function getDifficultyGuidelines(level: number): DifficultyGuidelines
export function getTextModeGuidelines(level: number): string
export function getRealtimeVoiceGuidelines(level: number): string
export function validateDifficultyLevel(level: number | undefined): number

// conversationContextBuilder.ts (공유 래퍼)
export function buildDifficultyGuidelines(level: number | undefined): string
```

---

## 5. 수정 가이드 & 디버깅

### ❌ 하드코딩 금지

난이도와 충돌하는 고정 지침을 프롬프트에 직접 삽입하지 않는다:

```typescript
// ❌ 잘못된 예시 — Level 1(매우 쉬움)과 충돌
역할:
- 상대방이 쉽게 동의할 수 없는 도전적인 입장을 취하세요
```

### ✅ 올바른 방식

```typescript
// ✅ 난이도 지침을 동적으로 삽입
역할:
- 위 대화 난이도 설정을 정확히 따라주세요
- ${difficultyGuidelines}
```

### 디버깅 체크리스트

**난이도가 적용되지 않는 경우:**
1. 콘솔에서 경고 확인: `⚠️ 시나리오 ... 난이도 미설정`
2. 시나리오 객체에 `difficulty` 필드 존재 확인
3. `validateDifficultyLevel()` 호출 여부 확인
4. 프롬프트에 `${difficultyGuidelines}` 삽입 확인

**AI가 여전히 도전적으로 응답하는 경우:**
1. 프롬프트에 하드코딩된 지침 검색 (`도전적`, `반대 의견` 키워드)
2. 난이도 가이드라인이 실제로 적용되는지 서버 로그 확인

**시나리오 생성/편집 시 테스트:**
- [ ] 난이도 1-4 설정 확인
- [ ] Level 1 테스트: AI가 친절하고 격려적인가?
- [ ] Level 4 테스트: AI가 압박적이고 직설적인가?
- [ ] 응답 길이 확인 (Level 1: 3문장, Level 4: 10-15단어)
