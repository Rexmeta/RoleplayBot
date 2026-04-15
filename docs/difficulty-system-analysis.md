# 난이도 시스템 분석 및 상관관계

> 구현 상세 가이드 → [`docs/difficulty-implementation-guide.md`](./difficulty-implementation-guide.md)

---

## 📊 난이도 시스템 개요

### 시나리오 난이도 (Scenario Difficulty) — 유일한 난이도 설정
- **위치**: 시나리오 생성/편집 시 설정
- **범위**: 1-4 (4단계)
- **런타임 기본값**: 2 (`validateDifficultyLevel()` 미설정 시 반환값)
- **레벨**:
  - 1: 매우 쉬움
  - 2: 기본 (런타임 기본값)
  - 3: 도전형
  - 4: 고난도

**역할**:
- 시나리오의 **전반적인 대화 난이도**를 결정
- 모든 대화 모드(텍스트/TTS/실시간 음성)에 일관되게 적용

> **MBTI `conversationDifficultyLevel` 필드**: 과거 설계에서 MBTI 페르소나별 fallback 난이도로 사용되었으나, 현재 런타임 코드에서는 참조하지 않음. 시나리오 난이도가 단일 진실 원천(Single Source of Truth)이다.

---

## 🔗 난이도 결정 흐름

### 런타임 Priority Chain

```
personaRun.difficulty (페르소나 실행 설정)
    OR
scenarioRun.difficulty (시나리오 설정)
    ↓
    없으면 ↓
기본값 2 (validateDifficultyLevel() 최종 fallback)
```

### 실제 코드 동작 흐름

#### 1️⃣ **실시간 음성 세션 시작 시** (routes.ts)
```typescript
// personaRun.difficulty: 사용자가 대화 시작 시 선택한 난이도 (시나리오 난이도의 런타임 구체화)
// scenarioRun.difficulty: 시나리오에 저장된 난이도 설정값
const userSelectedDifficulty = personaRun.difficulty || scenarioRun.difficulty || 2;
```

#### 2️⃣ **텍스트/TTS 대화 세션 생성** (routes/conversations.ts)
```typescript
// 사용자 선택 난이도 → 기본값 2
difficulty: validatedData.difficulty || 2,
```

#### 3️⃣ **자유 대화(Free Chat) 시나리오** (routes/conversations.ts)
```typescript
// 페르소나/시나리오 설정 → 기본값 2
difficulty: personaRun.difficulty || scenarioRun.difficulty || 2,
```

#### 4️⃣ **난이도 유효성 검증** (conversationDifficultyPolicy.ts)
```typescript
// 1-4 범위 외 또는 미설정 → 2 반환
export function validateDifficultyLevel(level: number | undefined): number {
  if (!level || level < 1 || level > 4) return 2; // 기본값 2
  return level;
}
```

---

## 💡 설계 의도

### **왜 시나리오 난이도만 사용하는가?**

1. **일관성 보장**
   - 같은 시나리오는 어떤 MBTI 페르소나를 선택하더라도 **동일한 난이도**로 진행
   - 사용자 경험의 예측 가능성 향상

2. **시나리오 중심 설계**
   - 시나리오 = 학습 목표와 상황이 정의된 단위
   - 난이도는 **상황의 복잡성**을 반영해야 함
   - MBTI는 대화 스타일만 변경, 난이도는 시나리오에서 결정

3. **관리 편의성**
   - 관리자가 시나리오 난이도만 조정하면 전체 대화 스타일 제어 가능
   - MBTI 페르소나 파일 개별 수정 불필요

---

## 📝 실제 사용 예시

### 예시 1: 시나리오 난이도 4
```
시나리오: "프로젝트 지연 위기 대응" (difficulty: 4)
MBTI: ISTJ

→ 실제 적용 난이도: 4 (시나리오 설정값)
→ 대화 스타일: ISTJ 스타일 + 고난도 대화 행동
```

### 예시 2: 시나리오 난이도 미설정
```
시나리오: "레거시 시나리오" (difficulty: undefined)
MBTI: ENFJ

→ 실제 적용 난이도: 2 (validateDifficultyLevel() 기본값)
→ 대화 스타일: ENFJ 스타일 + 기본 난이도 대화 행동
```

---

## 🎯 각 난이도 레벨별 대화 행동 차이

### 레벨 1: 매우 쉬움
- 협조적이고 긍정적
- 명확하고 간단한 표현
- 즉시 이해하고 수용

### 레벨 2: 기본 (런타임 기본값)
- 균형 잡힌 태도
- 보통 수준의 질문과 반론
- 합리적인 설득 가능

### 레벨 3: 도전형
- 비판적이고 회의적
- 구체적인 근거 요구
- 쉽게 동의하지 않음

### 레벨 4: 고난도
- 강한 반대 입장
- 감정적 반응 포함
- 복잡한 이해관계 제시
- 설득이 매우 어려움

---

## 🔧 관리 포인트

### 시나리오 생성 시
1. **난이도를 명확히 설정** (1-4)
2. 학습 목표에 맞는 난이도 선택
3. 난이도를 설정하지 않으면 런타임 기본값 **2**가 적용됨

### 대화 시작 시
1. 시스템이 자동으로 난이도를 결정
2. 관리자 개입 불필요
3. 모든 대화 모드에서 일관된 난이도 보장

---

## ✅ 요약

**핵심**: 시나리오 난이도가 **전체 시스템의 대화 난이도를 결정**하는 단일 진실 원천이다. 런타임에서 `conversationDifficultyLevel`(MBTI 필드)은 참조하지 않는다. 난이도 미설정 시 `validateDifficultyLevel()`이 기본값 **2**를 반환한다.

| 항목 | 값 |
|------|-----|
| **설정 위치** | 시나리오 생성/편집 폼 |
| **범위** | 1-4 |
| **런타임 기본값** | 2 (`validateDifficultyLevel()`) |
| **적용 범위** | 텍스트, TTS, 실시간 음성 모든 모드 |

---

## 📎 관련 문서

- [`docs/difficulty-implementation-guide.md`](./difficulty-implementation-guide.md) — 구현 상세 가이드 (코드 흐름, 주의사항, 디버깅 팁)
