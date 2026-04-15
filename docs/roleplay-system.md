# 롤플레이 대화 시스템 설계 문서

> **최초 작성**: 2026-04-15  
> **이 문서의 역할**: 롤플레이 대화 시스템의 모든 설계 결정과 로직 흐름을 기록한다. 이 문서를 먼저 읽으면 코드를 처음 보는 사람도 전체 맥락을 빠르게 복원할 수 있다.

---

## 1. 전체 대화 흐름

```
사용자 메시지 수신
        │
        ▼
시나리오 객체 파싱 (scenario.context, scenario.difficulty 등)
        │
        ▼
페르소나 Enrichment ──────────────── (병렬)
  - GlobalMBTICache에서 MBTI 데이터 조회
  - enrichPersonaWithMBTI() 호출
  - 결과는 enrichedPersonaCache에 저장
        │                                  대화 히스토리 준비
        │                            (prepareConversationHistory)
        │                            - 전체 대화 히스토리 사용 (제한 없음)
        │                            - 완료 마커(✓) 삽입
        ├──────────────────────────────────┘
        ▼
buildCompactPrompt() 호출
  ├─ MBTI 컨텍스트 조립: buildMBTIContextGuides(mbtiData)
  │    motivation + fears → psychologicalGuide
  │    communication_style → communicationBehaviorGuide
  │    speech_style → speechStyleGuide
  │    reaction_phrases → reactionGuide
  ├─ 계층 감지: detectRoleHierarchy(aiRole, userRole)
  ├─ 말투 지시 생성: buildHierarchySpeechGuide(role, playerRole, hierarchy)
  └─ 난이도 지침: buildDifficultyGuidelines(scenario.difficulty)
        │
        ▼
Gemini / OpenAI API 호출
  - conversationSemaphore (동시 실행 제한)
  - retryWithBackoff (최대 2회 재시도)
        │
        ▼
JSON 응답 파싱 { content, emotion, emotionReason }
        │
        ▼
토큰 사용량 추적 (trackUsage) → aiUsageLogs 테이블
```

---

## 2. 핵심 파일과 함수 참조 맵

| 역할 | 파일 | 함수/상수 |
|------|------|-----------|
| 공유 상수·순수 함수 | `server/services/conversationContextBuilder.ts` | `prepareConversationHistory`, `detectRoleHierarchy`, `buildHierarchySpeechGuide`, `buildDifficultyGuidelines`, `buildMBTIContextGuides` |
| Gemini 프로바이더 | `server/services/providers/optimizedGeminiProvider.ts` | `OptimizedGeminiProvider` |
| OpenAI 프로바이더 | `server/services/providers/openaiProvider.ts` | `OpenAIProvider` |
| 난이도 정책 | `server/services/conversationDifficultyPolicy.ts` | `getTextModeGuidelines`, `validateDifficultyLevel`, `getDifficultyGuidelines` |
| MBTI 데이터 로더 | `server/utils/mbtiLoader.ts` | `loadMBTIPersona`, `enrichPersonaWithMBTI` |
| MBTI 글로벌 캐시 | `server/utils/globalMBTICache.ts` | `GlobalMBTICache.getInstance()` |
| 평가 엔진 (별도) | `server/services/evaluationEngine.ts` | _(평가 시스템은 이 파일 참조)_ |
| AI 서비스 진입점 | `server/services/aiService.ts` | `AIServiceInterface`, `RoleplayScenario`, `ScenarioPersona` |

---

## 3. 대화 히스토리 준비 (prepareConversationHistory)

**위치**: `server/services/conversationContextBuilder.ts`

전체 대화 히스토리를 그대로 사용한다. 턴 수 제한 없음.

**완료 마커 규칙**:  
직전 메시지가 AI 발언인 상태에서 사용자 메시지가 오면 해당 메시지 앞에 `【사용자 답변 ✓】`를 붙이고, `← 위 질문은 이미 답변받은 사안` 주석을 추가한다. Gemini/OpenAI 프롬프트에 이 표시가 포함되면 AI가 동일 질문을 반복하지 않도록 유도한다.

```
출력 형식 예시:
【김팀장 - 당신의 발언】 일정이 너무 빡빡하지 않나요?
【사용자 답변 ✓】 2주 더 여유를 주시면 됩니다.  ← 위 질문은 이미 답변받은 사안
【김팀장 - 당신의 발언】 알겠습니다. 그러면 예산은 어떻게 생각하세요?
```

**호출 위치**:
- `OptimizedGeminiProvider.generateResponse()` → `prepareConversationHistory(messages, persona.name, playerPosition)`

---

## 4. 계층 감지 (detectRoleHierarchy)

**위치**: `server/services/conversationContextBuilder.ts`

**반환값 세 가지**:

| 값 | 의미 |
|----|------|
| `ai_superior` | AI 페르소나가 유저보다 직위가 높음 → 반말/지시 어체 사용 |
| `ai_subordinate` | AI 페르소나가 유저보다 직위가 낮음 → 존댓말/겸양 표현 사용 |
| `peer` | 동등 관계 → 협력적 동료 어체 사용 |

**키워드 목록** (`conversationContextBuilder.ts` 상단 상수):

- **SUPERIOR_KEYWORDS**: 팀장, 부장, 차장, 과장, 선임, 시니어, 수석, 리드, 매니저, manager, lead, senior, director, 대리, 주임, 본부장, 실장, cto, ceo, 임원, 이사, 상무, 전무, 대표, 사장
- **SUBORDINATE_KEYWORDS**: 신입, 인턴, 주니어, junior, 신규, 초보, 수습, 신입사원, 신입 개발자, 신입개발자, 입문, 초급
- **EXTERNAL_CLIENT_KEYWORDS**: 고객, 클라이언트, customer, client, 의뢰인, 소비자, 구매자, 방문객, 투자자, 파트너

**판별 우선순위**:
1. 유저가 `EXTERNAL_CLIENT_KEYWORDS`에 속하면 → 항상 `ai_subordinate`
2. AI=상위 & 유저=하위 → `ai_superior`
3. 유저=상위 & AI=하위 → `ai_subordinate`
4. 양쪽 모두 상위 또는 양쪽 모두 하위 → `peer`
5. AI=상위이나 유저 불명확 → `peer` (안전한 기본값)
6. 유저=상위이나 AI 불명확 → `ai_subordinate`
7. AI=하위 & 유저 미분류 → `ai_subordinate`
8. 유저=하위 & AI 미분류 → `ai_superior`
9. 나머지 → `peer`

---

## 5. 말투 위계 지시 (buildHierarchySpeechGuide)

**위치**: `server/services/conversationContextBuilder.ts`

`detectRoleHierarchy`의 결과를 받아 프롬프트에 삽입할 말투 지시 문자열을 생성한다.

| hierarchy | 지시 내용 |
|-----------|-----------|
| `ai_superior` | "~해", "~하게", "~하도록" 등 반말/지시 어체. "찾아뵙겠습니다" 같은 겸양 표현 금지 |
| `ai_subordinate` | "~습니다", "~드리겠습니다" 등 존댓말. 반말/지시 어투 금지 |
| `peer` | "~요", "~죠" 등 협력적 동료 어체 |

이 지시는 `**【말투 위계 지시 - 최우선 적용】**` 블록으로 삽입되며 다른 지시보다 우선된다.

---

## 6. 난이도 4단계 지침 (buildDifficultyGuidelines)

**위치**: `server/services/conversationContextBuilder.ts`  
**실제 지침 데이터**: `server/services/conversationDifficultyPolicy.ts`

`buildDifficultyGuidelines(level)` → `validateDifficultyLevel(level)` → `getTextModeGuidelines(level)` 순서로 호출.

| Level | 이름 | 특징 |
|-------|------|------|
| 1 | 입문 | 매우 친절, 거의 갈등 없음, 모범 답안 직접 제시 |
| 2 | 기본 (기본값) | 친절하나 현실적, 가벼운 압박 존재 |
| 3 | 도전 | 명확한 갈등·압박, 논리적 근거 요구 |
| 4 | 극한 | 최고 압박, 화난 고객/상사, 계약 해지/해고 언급 |

각 레벨은 `responseLength`, `tone`, `pressure`, `feedback`, `constraints` 5가지 필드로 구성.  
DB에서 오버라이드 가능 (`system_settings` 테이블, `conversation` 카테고리).

---

## 7. MBTI 컨텍스트 조립 (buildMBTIContextGuides)

**위치**: `server/services/conversationContextBuilder.ts`

`mbtiData`(MBTI JSON 파일에서 로드된 객체)를 받아 4종 가이드 문자열을 반환한다.

**조립 순서**:

1. **psychologicalGuide** (motivation + fears)  
   "당신이 원하는 것"과 "당신이 두려워하는 것"을 명시. 두려움 관련 상황에서 방어적/회피적 반응, 동기와 충돌하는 제안에는 저항 반응 유도.

2. **communicationBehaviorGuide** (communication_style)  
   스타일 텍스트를 행동 지침으로 변환. 명령조/직설적/두괄식/침묵 압박 등 스타일 키워드별 구체적 표현 예시 포함.

3. **speechStyleGuide** (speech_style)  
   formality, sentence_endings, filler_words, characteristic_expressions 4개 필드 사용.

4. **reactionGuide** (reaction_phrases)  
   agreement, disagreement, surprise, thinking 4가지 상황별 리액션 표현 (각 최대 2개).

**MBTI 데이터 로드 경로**:
```
GlobalMBTICache (서버 시작 시 프리로드) → getMBTIPersona(personaRef)
  └── 없으면: loadMBTIPersona(personaRef) → personas/{type}.json 파일 직접 읽기
```

---

## 8. 두 프로바이더의 공유 규칙

`conversationContextBuilder.ts`의 함수들은 두 프로바이더가 동일하게 import하여 사용한다.

| 함수 | Gemini 사용 방식 | OpenAI 사용 방식 |
|------|----------------|----------------|
| `prepareConversationHistory` | 단일 문자열로 시스템 프롬프트에 삽입 | _(미사용: OpenAI는 messages 배열 형식 사용)_ |
| `detectRoleHierarchy` | buildCompactPrompt 내부에서 호출 | generateResponse 내부에서 호출 |
| `buildHierarchySpeechGuide` | buildCompactPrompt 내부에서 호출 | system message에 포함 |
| `buildDifficultyGuidelines` | buildCompactPrompt 내부에서 호출 | system message에 포함 |
| `buildMBTIContextGuides` | buildCompactPrompt 내부에서 호출 | _(MBTI 데이터 없으므로 미사용)_ |

---

## 9. 프로바이더별 구현 특이사항

### OptimizedGeminiProvider (주 사용 프로바이더)

- **모델**: 기본 `gemini-2.5-flash`, 시스템 설정에서 동적 변경 가능 (`setModel`)
- **응답 형식**: JSON Schema 강제 (`responseMimeType: "application/json"`)
- **캐시 계층**:
  - `GlobalMBTICache` - 서버 시작 시 프리로드, 싱글턴
  - `enrichedPersonaCache` - 인스턴스 레벨 캐시, 시나리오×페르소나 키
- **병렬 처리**: `Promise.all([getEnrichedPersona, prepareConversationHistory])`
- **동시 실행 제한**: `conversationSemaphore`, `feedbackSemaphore`
- **재시도**: `retryWithBackoff(maxRetries: 2, baseDelayMs: 1000)`
- **최대 출력 토큰**: 대화 1500, 피드백 16384

### OpenAIProvider (보조 프로바이더)

- **모델**: 기본 `gpt-4`
- **응답 형식**: 텍스트 (감정 분석은 별도 JSON 요청)
- **히스토리 형식**: OpenAI messages 배열 (`{role, content}`)
- **계층 감지/난이도**: 공유 함수 사용 (v64 추가)
- **최대 출력 토큰**: 대화 200

---

## 10. 설계 결정 근거

| 결정 | 근거 |
|------|------|
| 전체 히스토리 사용 (제한 없음) | 대화 맥락을 끊김 없이 유지. 토큰 한도는 모델 수준에서 관리 |
| 완료 마커(✓) | LLM이 이미 답변받은 질문을 재질문하는 현상을 프롬프트 수준에서 억제 |
| 위계 감지를 키워드 기반으로 | 역할(role) 텍스트만으로 위계를 판별해야 하는 제약. 정규 LLM 호출 없이 즉시 처리 가능 |
| `peer` 안전 기본값 | 위계가 불명확할 때 상위자 어체를 쓰면 사용자가 불쾌감을 느낄 수 있으므로 중립으로 처리 |
| MBTI JSON 파일 → GlobalMBTICache 프리로드 | 매 대화마다 파일 I/O 없이 메모리에서 즉시 조회 |
| conversationContextBuilder.ts 중앙화 | evaluationEngine.ts와 동일한 패턴. 프로바이더 추가 시 동일 규칙을 자동 상속 |

---

## 11. 수정 가이드

### 계층 감지 키워드 추가
```typescript
// server/services/conversationContextBuilder.ts
export const SUPERIOR_KEYWORDS = [
  // 여기에 추가
  '팀장', '부장', ... , '새_키워드'
];
```

### 난이도 레벨 설명 수정
DB의 `system_settings` 테이블 (`category = 'conversation'`) 또는  
`server/services/conversationDifficultyPolicy.ts`의 `getDefaultDifficultySettings()` 함수.

### 새로운 MBTI 가이드 필드 추가
`buildMBTIContextGuides(mbtiData)` 함수에 새 필드 추출 로직을 추가하고,  
`MBTIContextGuides` 인터페이스에 반환 필드를 선언한다.

### 프로바이더 추가 (예: Claude)
`conversationContextBuilder.ts`에서 필요한 함수를 import하여 시스템 프롬프트를 구성하면 된다.
