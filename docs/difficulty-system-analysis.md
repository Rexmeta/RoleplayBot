# 난이도 시스템 분석 및 상관관계

## 📊 난이도 시스템 개요

### 1. **시나리오 난이도 (Scenario Difficulty)** ⭐ 우선순위 1
- **위치**: 시나리오 생성/편집 시 설정
- **범위**: 1-4 (4단계)
- **기본값**: 4 (고난도)
- **레벨**:
  - 1: 매우 쉬움
  - 2: 기본
  - 3: 도전형
  - 4: 고난도

**역할**: 
- 시나리오의 **전반적인 대화 난이도**를 결정
- 모든 대화 모드(텍스트/TTS/실시간 음성)에 일관되게 적용
- **항상 우선 사용됨**

---

### 2. **MBTI 페르소나 난이도 (MBTI Persona Difficulty)** 🔄 Fallback
- **위치**: MBTI 페르소나 JSON 파일 (`conversationDifficultyLevel`)
- **범위**: 1-4 (4단계)
- **기본값**: 3 (도전형)
- **레벨**: 시나리오 난이도와 동일 (1-4)

**역할**:
- **Fallback 값**으로만 사용
- 시나리오 난이도가 없을 때만 적용
- MBTI 유형별 기본 대화 스타일 난이도 저장

---

## 🔗 난이도 상관관계 및 우선순위

### Priority Chain (우선순위 체인)
```
시나리오 difficulty (우선순위 1)
    ↓
    없으면 ↓
MBTI conversationDifficultyLevel (우선순위 2, fallback)
    ↓
    없으면 ↓
기본값 4 (최종 fallback)
```

### 실제 코드 동작 흐름

#### 1️⃣ **대화 시작 시** (routes.ts)
```typescript
// 시나리오 난이도 → persona 스냅샷으로 전달
const persona = {
  ...mbtiPersona,
  conversationDifficultyLevel: scenarioObj.difficulty || mbtiPersona?.conversationDifficultyLevel || 4
}
```

#### 2️⃣ **실시간 음성 대화** (realtimeVoiceService.ts)
```typescript
// 시나리오 난이도 우선, MBTI 난이도는 fallback
const difficultyLevel = validateDifficultyLevel(
  scenario.difficulty || mbtiPersona?.conversationDifficultyLevel
);
```

#### 3️⃣ **텍스트/TTS 대화** (optimizedGeminiProvider.ts)
```typescript
// 시나리오 난이도 우선, 페르소나 난이도는 fallback
const difficultyLevel = validateDifficultyLevel(
  scenario.difficulty || (persona as any).conversationDifficultyLevel
);
```

---

## 💡 설계 의도

### **왜 시나리오 난이도가 우선인가?**

1. **일관성 보장**
   - 같은 시나리오는 어떤 MBTI 페르소나를 선택하더라도 **동일한 난이도**로 진행
   - 사용자 경험의 예측 가능성 향상

2. **시나리오 중심 설계**
   - 시나리오 = 학습 목표와 상황이 정의된 단위
   - 난이도는 **상황의 복잡성**을 반영해야 함
   - MBTI는 대화 스타일만 변경, 난이도는 유지

3. **관리 편의성**
   - 관리자가 시나리오 난이도만 조정하면 전체 대화 스타일 제어 가능
   - MBTI 페르소나는 16개 파일 개별 수정 불필요

---

## 📝 실제 사용 예시

### 예시 1: 시나리오 난이도 4 + MBTI ISTJ (기본 난이도 3)
```
시나리오: "프로젝트 지연 위기 대응" (difficulty: 4)
MBTI: ISTJ (conversationDifficultyLevel: 3)

→ 실제 적용 난이도: 4 (시나리오 우선)
→ 대화 스타일: ISTJ 스타일 + 고난도 대화 행동
```

### 예시 2: 시나리오 난이도 없음 + MBTI ENFJ (기본 난이도 3)
```
시나리오: "레거시 시나리오" (difficulty: undefined)
MBTI: ENFJ (conversationDifficultyLevel: 3)

→ 실제 적용 난이도: 3 (MBTI fallback)
→ 대화 스타일: ENFJ 스타일 + 도전형 대화 행동
```

### 예시 3: 둘 다 없음
```
시나리오: "테스트 시나리오" (difficulty: undefined)
MBTI: 커스텀 페르소나 (conversationDifficultyLevel: undefined)

→ 실제 적용 난이도: 4 (최종 기본값)
→ 대화 스타일: 커스텀 스타일 + 고난도 대화 행동
```

---

## 🎯 각 난이도 레벨별 대화 행동 차이

### 레벨 1: 매우 쉬움
- 협조적이고 긍정적
- 명확하고 간단한 표현
- 즉시 이해하고 수용

### 레벨 2: 기본
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
3. AI 생성 시 기본값 4 적용

### MBTI 페르소나 관리 시
1. `conversationDifficultyLevel`은 **fallback 용도**
2. 기본값 3 권장 (중간 난이도)
3. 대부분의 경우 시나리오 난이도가 우선 적용됨

### 대화 시작 시
1. 시스템이 자동으로 우선순위 체인 적용
2. 관리자 개입 불필요
3. 모든 대화 모드에서 일관된 난이도 보장

---

## ✅ 요약

| 항목 | 시나리오 난이도 | MBTI 난이도 |
|------|----------------|-------------|
| **우선순위** | 1순위 (항상 우선) | 2순위 (fallback) |
| **범위** | 1-4 | 1-4 |
| **기본값** | 4 | 3 |
| **설정 위치** | 시나리오 생성/편집 폼 | MBTI JSON 파일 |
| **적용 범위** | 해당 시나리오 전체 | 해당 MBTI 전체 |
| **변경 빈도** | 자주 (시나리오별) | 드물게 (MBTI 설정) |
| **목적** | 학습 목표에 맞는 난이도 | 기본 대화 스타일 |

**핵심**: 시나리오 난이도가 **전체 시스템의 대화 난이도를 결정**하며, MBTI 난이도는 **보조적 fallback 역할**만 수행합니다.
