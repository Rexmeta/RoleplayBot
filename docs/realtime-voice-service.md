# 실시간 음성 서비스 (Realtime Voice Service)

> **소스**: `server/services/realtimeVoiceService.ts`  
> **최초 작성**: 2026-04-15

---

## 1. 개요

`RealtimeVoiceService`는 Google Gemini Live API를 이용한 실시간 양방향 음성 대화 서비스다. 클라이언트 WebSocket과 Gemini Live API 세션을 브리징하며, 멀티언어 응답 필터링, Barge-in 처리, 세션 재연결(Session Resumption)을 담당한다.

---

## 2. 기본 모델 상수

```typescript
const DEFAULT_REALTIME_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';
```

- DB의 `system_settings` 테이블 (`ai` 카테고리, `model_realtime` 키)에 유효한 모델명이 있으면 우선 사용한다.
- 유효한 모델 목록: `['gemini-2.5-flash-native-audio-preview-09-2025']`
- DB 조회 타임아웃: **2000ms** (초과 시 기본값 사용)

---

## 3. 세션 상수

| 상수 | 값 | 설명 |
|------|----|------|
| `SESSION_TIMEOUT_MS` | 30분 | 비활성 세션 자동 종료 임계값 |
| `MAX_TRANSCRIPT_LENGTH` | 50,000자 | 세션당 최대 transcript 누적 길이 |
| `CLEANUP_INTERVAL_MS` | 60초 | 비활성 세션 정리 스케줄러 주기 |
| `MAX_CONCURRENT_SESSIONS` | 100개 | 동시 세션 상한 (Gemini Tier 2 기준) |

---

## 4. WebSocket 세션 생명주기

```
클라이언트 WebSocket 연결
        │
        ▼
createSession() 호출
  ├─ 동시 세션 수 체크 (≥ MAX_CONCURRENT_SESSIONS → 에러)
  ├─ 시나리오/페르소나 데이터 로드 (또는 UserPersona 분기)
  ├─ 시스템 인스트럭션 생성 (buildSystemInstructions)
  └─ connectToGemini() 호출
        │
        ▼
Gemini Live API 세션 연결
  ├─ 음성 선택 (성별 기반, 재연결 시 동일 음성 유지)
  └─ 세션 객체 저장 (sessions Map)
        │
        ▼
client.ready 수신 → 첫 인사 트리거
        │
  [대화 루프]
  ├─ 클라이언트 오디오 수신 → Gemini로 전달
  ├─ Gemini 텍스트 응답 → filterThinkingText() → 클라이언트 전송
  ├─ Gemini 오디오 응답 → (Barge-in 중이면 폐기) → 클라이언트 전송
  ├─ turnComplete 이벤트 → turnSeq 증가
  └─ GoAway 경고 수신 → 세션 재연결 준비
        │
        ▼
closeSession() 또는 타임아웃 → 세션 정리
```

### RealtimeSession 주요 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `geminiSession` | `any \| null` | Gemini Live API 세션 객체 |
| `isConnected` | `boolean` | Gemini 연결 활성 여부 |
| `currentTranscript` | `string` | AI 응답 transcript 버퍼 |
| `userTranscriptBuffer` | `string` | 사용자 음성 transcript 버퍼 |
| `isInterrupted` | `boolean` | Barge-in 발생 시 `true` → 해당 턴의 오디오 폐기 |
| `turnSeq` | `number` | 단조 증가 턴 카운터 |
| `cancelledTurnSeq` | `number` | Barge-in이 발생한 턴 번호 (이 턴의 오디오 무시) |
| `sessionResumptionToken` | `string \| null` | Gemini 세션 재개 토큰 |
| `selectedVoice` | `string \| null` | 세션 시작 시 선택된 음성 (재연결 시 동일 유지) |
| `userLanguage` | `'ko' \| 'en' \| 'ja' \| 'zh'` | 사용자 선택 언어 |
| `pendingClientReady` | `any \| null` | Gemini 연결 전 도착한 client.ready 메시지 버퍼 |

---

## 5. Thinking Text 필터링 로직

Gemini Live API는 응답 생성 과정에서 "thinking" 메타 텍스트를 출력하는 경우가 있다. 이를 제거해 실제 대화 응답만 사용자에게 전달한다.

### isThinkingText(text)

텍스트가 AI의 내부 사고 과정인지 판별한다.

| 조건 | 결과 |
|------|------|
| 한국어 유니코드 포함 | `false` (thinking 아님) |
| `**제목**` 형식으로 시작 | `true` |
| 영어 thinking 키워드 패턴 매칭 | `true` |

**영어 Thinking 키워드 패턴**:
```
/^I['']m\s+(focusing|thinking|considering|now|about|going)/i
/^(I|Now|Let me|First|Okay)\s+(understand|need|will|am|have)/i
/^(Initiating|Beginning|Starting|Transitioning|Highlighting)/i
/^(I've|I'm|I'll)\s+/i
/^The\s+(user|situation|context)/i
```

### filterThinkingText(text, userLanguage)

**패턴 0**: `\([^)]{1,30}\)` — 괄호로 감싼 짧은 행동/상태 묘사 제거  
**패턴 1**: `\*\*[^*]+\*\*\s*` — `**제목**` 형식의 thinking 블록 제거  
**패턴 2**: 라인 단위 필터링 — 대상 언어 문자가 없는 줄 제거  
**패턴 3**: 영문 20자 이상 연속 → 대상 언어 문자 없으면 제거

---

## 6. 언어별 필터링 규칙

`filterThinkingText()`의 언어별 동작:

| 언어 | 유지 조건 | 추가 차단 조건 |
|------|-----------|---------------|
| `ko` | 한글 유니코드 포함 | 일본어 가나, 아라비아 문자, 중국어 한자 포함 줄 제거 |
| `ja` | 히라가나/가타카나/한자 포함 | 한글 포함, 아라비아 문자 포함 줄 제거 |
| `zh` | 중국어 한자 포함 | 한글, 일본어 가나 포함, 아라비아 문자 포함 줄 제거 |
| `en` | 비라틴 문자 없는 줄 유지 | 한글·일본어·중국어·아라비아 문자 포함 줄 제거; thinking 패턴 줄 제거 |

**공통 규칙**: 대상 언어 문자 수보다 영문 단어 수가 3배 이상이면 thinking 텍스트로 간주해 제거한다.

---

## 7. Barge-in 처리 흐름

Barge-in은 사용자가 AI 발화 도중 말을 시작할 때 클라이언트가 `response.cancel` 메시지를 서버로 전송해 트리거된다. Gemini API에 취소 신호를 직접 보내는 것이 아니라, **서버 측 플래그 기반 오디오 억제** 방식으로 동작한다.

```
클라이언트 → 서버: { type: 'response.cancel' }
        │
        ▼
session.isInterrupted = true
session.cancelledTurnSeq = session.turnSeq  // 현재 턴 번호 기록
        │
        ▼
(선택적) 현재까지 누적된 AI 텍스트를 부분 전사로 클라이언트에 전송
  { type: 'ai.transcription.done', interrupted: true, text: '...' }
        │
        ▼
이후 Gemini에서 도착하는 오디오 청크:
  if (session.isInterrupted === true) → 서버에서 폐기 (클라이언트 미전달)
        │
        ▼
인터럽트 해제 경로 (둘 중 먼저 발생하는 것):

  경로 A — outputTranscription 이벤트 (새 AI 응답이 시작될 때, 즉시):
    if (session.isInterrupted && transcript.length > 0):
      session.isInterrupted = false
      클라이언트 → { type: 'response.ready', turnSeq }

  경로 B — turnComplete 이벤트 (턴 경계, 늦게 발생할 수 있음):
    session.turnSeq++
    if (session.isInterrupted && session.turnSeq > session.cancelledTurnSeq):
      session.isInterrupted = false
      클라이언트 → { type: 'response.ready', turnSeq }
```

평가 엔진(`evaluationEngine.ts`)은 `interrupted: true`로 마킹된 AI 메시지를 분석해 barge-in 점수를 산정한다. 자세한 내용은 `docs/evaluation-system.md` 참조.

---

## 8. 세션 분기

`createSession()` 호출 시 `scenarioId`가 `__user_persona__:<id>` 형식이면 **UserPersona 분기**로 처리한다.

| 분기 | 조건 | 데이터 소스 |
|------|------|-------------|
| UserPersona | `scenarioId.startsWith('__user_persona__:')` | DB `userPersonas` 테이블 |
| 시나리오 페르소나 | 기본 | 파일 시스템 시나리오 JSON + MBTI JSON |

---

## 9. 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `GOOGLE_API_KEY` 또는 `GEMINI_API_KEY` | 필수 | Gemini Live API 인증. 없으면 서비스 비활성화 |
