# 실시간 음성 서비스 (Realtime Voice Service)

> **소스**: `server/services/realtimeVoiceService.ts`  
> **최초 작성**: 2026-04-15

---

## 1. 개요

`RealtimeVoiceService`는 Google Gemini Live API 또는 OpenAI Realtime API를 이용한 실시간 양방향 음성 대화 서비스다. 클라이언트 WebSocket과 Gemini Live / OpenAI Realtime 세션을 브리징하며, 멀티언어 응답 필터링, Barge-in 처리, 세션 재연결(Session Resumption), 멀티 페르소나 전환을 담당한다.

---

## 2. 기본 모델 상수

```typescript
const DEFAULT_REALTIME_MODEL = 'gemini-3.1-flash-live-preview';
```

- DB의 `system_settings` 테이블 (`ai` 카테고리, `model_realtime` 키)에 유효한 모델명이 있으면 우선 사용한다.
- DB 조회 타임아웃: **2000ms** (초과 시 기본값 사용)

### 유효한 모델 목록

| 모델명 | API 버전 | 비고 |
|--------|---------|------|
| `gemini-3.1-flash-live-preview` | v1beta | 기본값; Google AI 공식 bidiGenerateContent 지원 확인 |
| `gpt-4o-realtime-preview` | OpenAI Realtime | OpenAI Realtime API 라우팅 |
| `gpt-4o-mini-realtime-preview` | OpenAI Realtime | OpenAI 경량 모델; Gemini 키 없는 환경 기본값 |

> **참고**: `gemini-live-2.5-flash-preview`, `gemini-2.5-flash-native-audio-preview-09-2025` 등 이전 모델명은 현재 bidiGenerateContent에서 유효하지 않다. 과금 기록 레거시 항목으로만 보존된다.

모든 Gemini Live 모델은 `v1beta` API 버전을 사용한다.

---

## 3. 세션 상수

| 상수 | 값 | 설명 |
|------|----|------|
| `SESSION_TIMEOUT_MS` | 30분 | 비활성 세션 자동 종료 임계값 |
| `MAX_TRANSCRIPT_LENGTH` | 50,000자 | 세션당 최대 transcript 누적 길이 |
| `CLEANUP_INTERVAL_MS` | 60초 | 비활성 세션 정리 스케줄러 주기 |
| `MAX_CONCURRENT_SESSIONS` | 100개 | 동시 세션 상한 |

---

## 4. 음성 서브모듈 아키텍처

`server/services/voice/` 디렉터리에 기능별 서브모듈로 분리되어 있으며, `realtimeVoiceService.ts`는 이를 오케스트레이션하는 슬림 진입점이다.

| 파일 | 역할 |
|------|------|
| `types.ts` | 공유 TypeScript 타입·상수 (`RealtimeSession`, 이벤트 타입, 타임아웃 상수) |
| `textFilter.ts` | 스트리밍 텍스트에서 thinking-mode 태그 제거 |
| `prompts/languageInstructions.ts` | 다국어 언어 지시 및 금지 문자열 |
| `prompts/sectionText.ts` | 시나리오·페르소나 컨텍스트용 프롬프트 섹션 템플릿 |
| `prompts/userPersonaPrompt.ts` | 사용자 생성 페르소나(PersonaX 자유 대화) 시스템 프롬프트 빌더 |
| `systemPromptBuilder.ts` | 서브모듈을 조합해 완성된 시스템 인스트럭션 프롬프트 생성 |
| `emotionAnalyzer.ts` | Gemini를 사용하는 독립형 실시간 감정 분석 함수 |
| `openaiRealtimeAdapter.ts` | OpenAI Realtime WebSocket 이벤트 처리 (오디오 라우팅, 전사, 감정 분석, barge-in) |
| `openaiReconnector.ts` | OpenAI 세션 종료·재연결 로직 (지수 백오프, 치명적 코드 감지) |
| `clientMessageHandler.ts` | 클라이언트 WebSocket 메시지 처리 |
| `sessionManager.ts` | 세션 생명주기 헬퍼: 정리 스케줄러, 사용량 추적, 상태 보고 |
| `geminiMessageHandler.ts` | Gemini Live 메시지 핸들러 |
| `geminiReconnector.ts` | Gemini Live 세션 재연결 로직 |

---

## 5. WebSocket 세션 생명주기

```
클라이언트 WebSocket 연결
        │
        ▼
createSession() 호출
  ├─ 동시 세션 수 체크 (≥ MAX_CONCURRENT_SESSIONS → 에러)
  ├─ scenarioId 분기: __user_persona__:<id> → UserPersona 경로
  ├─ 시나리오/페르소나 데이터 로드 + 시스템 인스트럭션 생성
  ├─ realtimeModel 결정 (DB → 기본값)
  └─ isOpenAIRealtimeModel(model)?
        ├─ YES → connectToOpenAI()
        └─ NO  → connectToGemini()
        │
        ▼
client.ready 수신 → 첫 인사 트리거 (또는 proactiveReconnect)
        │
  [대화 루프]
  ├─ 클라이언트 오디오 → Gemini/OpenAI 전달
  ├─ AI 텍스트 응답 → filterThinkingText() → 클라이언트 전송
  ├─ AI 오디오 응답 → Barge-in 중이면 폐기 → 클라이언트 전송
  ├─ turnComplete 이벤트 → turnSeq 증가
  ├─ 페르소나 전환(switchPersona) → personaSystemInstructions 교체
  └─ GoAway 경고 수신 → 세션 재연결 준비
        │
        ▼
closeSession() 또는 타임아웃 → 세션 정리 + 사용량 기록
```

---

## 6. RealtimeSession 인터페이스

현행 `server/services/voice/types.ts` 기준 전체 필드:

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | `string` | 세션 고유 ID |
| `personaRunId` | `string` | 대화 실행(personaRun) ID |
| `scenarioId` | `string` | 시나리오 ID |
| `personaId` | `string` | 초기 페르소나 ID |
| `personaName` | `string` | 현재 활성 페르소나 이름 |
| `userId` | `string` | 사용자 ID |
| `userName` | `string` | 사용자 이름 |
| `clientWs` | `WebSocket` | 클라이언트 WebSocket |
| `geminiSession` | `any \| null` | Gemini Live / OpenAI Realtime 어댑터 객체 |
| `currentTranscript` | `string` | AI 응답 transcript 버퍼 |
| `userTranscriptBuffer` | `string` | 사용자 음성 transcript 버퍼 |
| `audioBuffer` | `string[]` | 수신된 오디오 청크 버퍼 |
| `startTime` | `number` | 세션 시작 타임스탬프 (ms) |
| `lastActivityTime` | `number` | 마지막 활동 타임스탬프 (ms) |
| `totalUserTranscriptLength` | `number` | 누적 사용자 transcript 길이 |
| `totalAiTranscriptLength` | `number` | 누적 AI transcript 길이 |
| `totalCachedTokens` | `number` | 세션 누적 캐시 토큰 수 |
| `realtimeModel` | `string` | 세션에서 사용 중인 모델명 |
| `hasReceivedFirstAIResponse` | `boolean` | 첫 AI 응답 수신 여부 |
| `hasReceivedFirstAIAudio` | `boolean` | 첫 AI 오디오 수신 여부 |
| `hasTriggeredFirstGreeting` | `boolean` | 첫 인사 트리거 여부 |
| `firstGreetingRetryCount` | `number` | 인사 재시도 횟수 |
| `isInterrupted` | `boolean` | Barge-in 발생 시 `true` → 해당 턴의 오디오 폐기 |
| `turnSeq` | `number` | 단조 증가 턴 카운터 |
| `cancelledTurnSeq` | `number` | Barge-in이 발생한 턴 번호 |
| `sessionResumptionToken` | `string \| null` | Gemini 세션 재개 토큰 |
| `isReconnecting` | `boolean` | 재연결 진행 중 여부 |
| `reconnectAttempts` | `number` | 재연결 시도 횟수 |
| `systemInstructions` | `string` | 현재 활성 시스템 인스트럭션 |
| `voiceGender` | `'male' \| 'female'` | 음성 성별 설정 |
| `recentMessages` | `Array<{role, text}>` | 최근 대화 메시지 (최대 30개 프리로드) |
| `selectedVoice` | `string \| null` | 세션 시작 시 선택된 음성 (재연결 시 동일 유지) |
| `goAwayWarningTime` | `number \| null` | GoAway 수신 시각 |
| `pendingClientReady` | `any \| null` | Gemini 연결 전 도착한 client.ready 메시지 버퍼 |
| `userLanguage` | `'ko' \| 'en' \| 'ja' \| 'zh'` | 사용자 선택 언어 |
| `pendingMessages` | `PendingOutgoingMessage[]` | 순서 보장을 위한 발신 메시지 큐 |
| `outgoingMessageIndex` | `number` | 발신 메시지 인덱스 카운터 |
| `hasReceivedFirstTranscriptDelta` | `boolean` | 첫 transcript 델타 수신 여부 |
| `greetingResponseCount` | `number` | 인사 응답 수 |
| `userTurnsCompleted` | `number` | 완료된 사용자 턴 수 |
| `userSpeechStarted` | `boolean` | 사용자 발화 시작 여부 |
| `simulationState` | `SimulationState \| null` | 시뮬레이션 엔진 상태 |
| `scenarioRunId` | `string \| null` | 시나리오 실행 ID |
| `toolCallCountThisTurn` | `number` | 현재 턴 도구 호출 수 |
| `emotionCallCountThisTurn` | `number` | 현재 턴 감정 분석 호출 수 |
| `currentTurnIncidentFired` | `boolean` | 현재 턴 인시던트 발생 여부 |
| `lastEvaluatedUserTurnIndex` | `number` | 마지막 평가된 사용자 턴 인덱스 |
| `lastEvaluatedUserTurnId` | `string \| null` | 마지막 평가된 사용자 턴 ID |
| `lastFinalizedUserTranscriptHash` | `string \| null` | 마지막 확정 사용자 transcript 해시 |
| `lastClientContentSentAt` | `number` | 마지막 클라이언트 콘텐츠 전송 시각 |
| `greetingTimeoutId` | `NodeJS.Timeout \| null` | 인사 타임아웃 타이머 |
| `pendingIsResuming` | `boolean` | 재개 대기 플래그 |
| `pendingHasExistingConversation` | `boolean` | 기존 대화 전환 대기 플래그 |
| `usingReconnectInstructions` | `boolean` | 재연결용 시스템 인스트럭션 사용 여부 |
| `activePersonaIndex` | `number` | 현재 활성 페르소나 인덱스 |
| `voiceId` | `string \| null` | 현재 활성 페르소나의 voiceId |
| `scenarioPersonas` | `Array<...> \| null` | 시나리오 전체 페르소나 목록 |
| `personaSystemInstructions` | `string[] \| undefined` | 페르소나별 사전 빌드 시스템 인스트럭션 |
| `pendingPersonaSwitch` | `object \| undefined` | 진행 중인 페르소나 전환 정보 |
| `targetTurns` | `number \| undefined` | 목표 턴 수 |
| `softCloseSent` | `boolean \| undefined` | 소프트 클로즈 전송 여부 |
| `personaSwitchPending` | `boolean \| undefined` | 페르소나 전환 대기 여부 |
| `awaitingPersonaSwitch` | `boolean \| undefined` | 페르소나 전환 응답 대기 여부 |
| `personaSwitchMode` | `'replace' \| 'join' \| 'none' \| undefined` | 페르소나 전환 모드 |
| `simulationHarness` | `SimulationHarness \| null \| undefined` | 시뮬레이션 하네스 설정 |
| `terminationHandled` | `boolean \| undefined` | 세션 종료 처리 완료 여부 |
| `evaluationInProgress` | `boolean \| undefined` | 평가 진행 중 여부 |
| `suppressAIUntilUserSpeaks` | `boolean \| undefined` | 사용자 발화까지 AI 억제 여부 |
| `suppressedTurnStarted` | `boolean \| undefined` | 억제 턴 시작 여부 |
| `suppressTimeoutId` | `ReturnType<typeof setTimeout> \| undefined` | 억제 타임아웃 ID |
| `lastAudioCommitSentAt` | `number` | 마지막 오디오 커밋 전송 시각 |
| `audioSourceThisTurn` | `'top' \| 'inline' \| null` | 현재 턴의 오디오 소스 |
| `lastUserAffect` | `UserAffectState \| undefined` | 마지막 사용자 감정 분석 결과 |

---

## 7. Thinking Text 필터링 로직

Gemini Live API는 응답 생성 과정에서 "thinking" 메타 텍스트를 출력하는 경우가 있다. 이를 제거해 실제 대화 응답만 사용자에게 전달한다.

**패턴 0**: `\([^)]{1,30}\)` — 괄호로 감싼 짧은 행동/상태 묘사 제거  
**패턴 1**: `\*\*[^*]+\*\*\s*` — `**제목**` 형식의 thinking 블록 제거  
**패턴 2**: 라인 단위 필터링 — 대상 언어 문자가 없는 줄 제거  
**패턴 3**: 영문 20자 이상 연속 → 대상 언어 문자 없으면 제거

---

## 8. Barge-in 처리 흐름

Barge-in은 사용자가 AI 발화 도중 말을 시작할 때 클라이언트가 `response.cancel` 메시지를 서버로 전송해 트리거된다.

```
클라이언트 → 서버: { type: 'response.cancel' }
        │
        ▼
session.isInterrupted = true
session.cancelledTurnSeq = session.turnSeq
        │
        ▼
이후 도착하는 오디오 청크: isInterrupted === true → 서버에서 폐기
        │
인터럽트 해제 경로:
  경로 A: outputTranscription 이벤트 → session.isInterrupted = false
  경로 B: turnComplete 이벤트 → turnSeq++ → 해제 조건 확인
```

---

## 9. OpenAI Realtime 어댑터

`model_realtime` 설정이 `gpt-4o-realtime-preview` 또는 `gpt-4o-mini-realtime-preview`이면 Gemini 대신 OpenAI Realtime API로 라우팅된다.

- Gemini 키 없이 OpenAI 키만 있는 환경: 기본값 `gpt-4o-mini-realtime-preview` 사용
- 어댑터는 `session.geminiSession` 슬롯에 저장되어 동일한 인터페이스로 호출됨

---

## 10. 세션 분기

| 분기 | 조건 | 데이터 소스 |
|------|------|-------------|
| UserPersona | `scenarioId.startsWith('__user_persona__:')` | DB `userPersonas` 테이블 |
| 시나리오 페르소나 | 기본 | 파일 시스템 시나리오 JSON + MBTI JSON |

---

## 11. 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY` | Gemini 모델 사용 시 필수 | 없으면 OpenAI 전용 모드로 동작 |
| `OPENAI_API_KEY` | OpenAI Realtime 모델 사용 시 필수 | Gemini 키도 없으면 서비스 비활성화 |

---

## 12. 모바일 음성 출력 점검

실시간 음성 화면의 **출력** 버튼은 브라우저가 `AudioContext.setSinkId()`를 제공할 때만 앱에서 출력 기기를 바꾼다. 선택한 기기 ID는 브라우저 저장소에 보관되며, 이어폰 연결 해제·화면 복귀 시 목록을 다시 확인한다.

- Android Chrome은 `setSinkId`는 지원하지만 `audiooutput` 열거는 제공하지 않음 → 빈 출력 목록이어도 권한 미허용이 아님. 다른 기기 라벨이 보이면 브라우저가 열거를 지원하지 않는 것으로 판단해 OS(미디어 출력 알림창) 전환 안내를 표시함.
- iOS Safari 등 선택 API를 제공하지 않는 브라우저: 제어 센터 또는 Bluetooth 메뉴에서 OS 출력 기기를 선택한 뒤 **재생 다시 시도** 사용.

## 13. 모바일 마이크(입력 기기) 선택

`getUserMedia({ audio: { deviceId: { exact } } })`로 입력 기기를 선택한다. iOS Safari와 Android Chrome 모두 지원된다.

- 선택한 마이크 ID는 브라우저 저장소에 보관되어 다음 대화에서도 유지된다.
- 대화 중 마이크를 바꾸면 오디오 그래프를 유지한 채 MediaStream 소스 노드만 교체한다.
