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

---

## 10. 모바일 음성 출력 점검

실시간 음성 화면의 **출력** 버튼은 브라우저가 `AudioContext.setSinkId()`를 제공할 때만 앱에서 출력 기기를 바꾼다. 선택한 기기 ID는 브라우저 저장소에 보관되며, 이어폰 연결 해제·화면 복귀 시 목록을 다시 확인한다. 저장된 기기를 찾지 못하면 기본 출력으로 안전하게 전환하고 상태 메시지를 표시한다.

- 출력 메뉴를 열 때마다 기기 목록을 다시 조회한다. 브라우저는 오디오 캡처 권한이 없으면 라벨과 개별 출력 기기를 숨기므로, 이 경우 **연결된 기기 목록 불러오기**로 권한을 요청한 뒤 휴대폰 스피커와 블루투스 기기를 각각 선택할 수 있다.
- 권한 때문에 목록이 가려진 상태는 기기 연결 해제와 구분한다. 이때는 저장된 선택을 지우지 않고 안내만 표시한다.
- 권한이 이미 허용되어(다른 기기 라벨이 보임) 있는데도 출력 기기 목록이 비어 있으면, 브라우저가 출력 열거를 지원하지 않는 것으로 판단한다(예: Android Chrome은 `setSinkId`는 지원하지만 `audiooutput` 열거는 제공하지 않음). 이때는 **연결된 기기 목록 불러오기**를 반복 노출하지 않고, Android 알림창의 미디어 출력·iPhone 제어 센터로 OS에서 전환하도록 안내한다.
- 기기 라벨은 블루투스/유선/스피커로 분류해 표시하므로, 같은 이름의 기기가 여러 개여도 어떤 경로인지 구분할 수 있다.
- iOS Safari 등 선택 API를 제공하지 않는 브라우저에서는 앱이 수화음·스피커·블루투스 경로를 강제할 수 없다. 제어 센터 또는 Bluetooth 메뉴에서 OS 출력 기기를 선택한 뒤 **재생 다시 시도**를 사용한다.
- 출력 변경 또는 `AudioContext.resume()`이 실패하면 성공으로 표시하지 않고, 화면의 상태 메시지와 재시도 버튼을 제공한다.
- 출력 장치 식별자 외의 개인 정보나 오디오 데이터는 진단용으로 저장하지 않는다.

## 11. 모바일 마이크(입력 기기) 선택

실시간 음성 화면의 **마이크** 버튼은 `getUserMedia({ audio: { deviceId: { exact } } })`로 입력 기기를 선택한다. 출력 선택과 달리 마이크 열거·선택은 iOS Safari와 Android Chrome 모두 지원한다.

- 선택한 마이크 ID는 브라우저 저장소에 보관되어 다음 대화에서도 유지된다. `exact` 제약을 사용하므로 저장된 기기를 쓸 수 없으면 조용히 다른 마이크로 대체되지 않고 실패가 드러난다. 이때 앱이 명시적으로 기본 마이크로 폴백하고 상태 메시지를 표시한다.
- 대화(녹음) 중 마이크를 바꾸면 오디오 그래프를 유지한 채 MediaStream 소스 노드만 교체한다. Gemini 전송용 ScriptProcessor와 VAD 프로세서는 그대로 연결을 유지하고, 마이크마다 주변 소음이 다르므로 노이즈 플로어를 재측정한다.
- 출력과 동일하게, 캡처 권한 전에는 라벨이 숨겨지므로 **연결된 기기 목록 불러오기**로 권한을 요청한 뒤 휴대폰 마이크와 블루투스 마이크를 구분해 선택한다. 권한 때문에 목록이 가려진 상태에서는 저장된 선택을 지우지 않는다.
- `devicechange` 이벤트에서 저장된 마이크가 사라지면 기본 마이크로 전환을 알리고, 녹음 중이면 죽은 트랙에 머무르지 않도록 즉시 기본 마이크 스트림으로 교체한다.
- 참고: 대부분의 모바일 OS는 블루투스 이어폰 연결 시 마이크·스피커를 하나의 통화 프로파일(HFP)로 묶어 전환한다. 앱의 마이크 선택은 브라우저가 노출하는 장치 범위 안에서만 동작한다.
- 주의: Android Chrome은 마이크 *입력 소스*에 출력 모드 이름("스피커폰", "Speakerphone")을 붙여 노출하는 경우가 있어, 사용자가 마이크 목록을 출력 목록으로 오인할 수 있다. 앱은 이런 라벨을 휴대폰 내장 마이크로 분류하고, 각 팝오버 상단에 "내 목소리를 녹음할 기기 / 상대 음성이 재생될 기기" 설명을 표시해 두 버튼의 역할을 구분한다. `tests/client/chatInputBarDevicePopovers.test.tsx`가 마이크 버튼 → 입력 API, 출력 버튼 → 출력 API 연결이 뒤바뀌지 않는지 고정한다.

### 수동 검증 매트릭스

| 환경 | 절차 | 기대 결과 |
|------|------|-----------|
| iOS Safari + Bluetooth 이어폰 | 음성 대화 중 이어폰 연결/해제 후 제어 센터에서 출력 변경 | 앱은 제한을 안내하고, OS가 선택한 경로로 재생된다. 잘못된 앱 선택 성공 상태를 표시하지 않는다. |
| Android Chrome + Bluetooth 이어폰 | 출력 메뉴에서 이어폰을 선택하고 새 대화를 시작한 뒤 이어폰을 해제 | 지원 시 선택이 다음 대화에도 유지되고, 해제 시 기본 출력으로 전환 안내가 나온다. |
| Android Chrome, 권한 이전 상태 | 마이크 권한을 허용하기 전에 출력 메뉴를 열고 **연결된 기기 목록 불러오기**를 누름 | 권한 허용 후 휴대폰 스피커와 블루투스 기기가 각각 목록에 나타나고 선택할 수 있다. 브라우저가 출력 목록을 제공하지 않으면 OS 미디어 출력 전환 안내가 표시되고 불러오기 버튼이 반복 노출되지 않는다. |
| Android Chrome, 대화 중 이어폰 연결 | 대화 도중 블루투스 이어폰을 새로 연결하고 출력 메뉴를 다시 열기 | 새 기기가 목록에 추가되고 선택하면 해당 경로로 재생된다. |
| Android Chrome, 화면 잠금/복귀 | AI 응답 직전에 화면을 잠갔다가 복귀 | 재생 컨텍스트와 장치 목록을 다시 확인하며, 실패하면 재생 재시도 안내가 나온다. |
| iOS Safari/Android Chrome, 마이크 선택 | 마이크 메뉴에서 블루투스 마이크를 선택하고 발화 → 새 대화에서 다시 확인 | 선택한 마이크로 인식되고 선택이 다음 대화에도 유지된다. |
| Android Chrome, 대화 중 마이크 교체 | AI 응답 재생 없이 대기 중 마이크 메뉴에서 휴대폰 마이크 ↔ 블루투스 마이크 전환 | 세션 종료 없이 즉시 새 마이크로 녹음이 이어지고 상태 메시지가 표시된다. |
| 모든 조합, 마이크 연결 해제 | 선택한 블루투스 마이크의 전원을 끄기 | 기본 마이크로 전환 안내가 나오고 녹음이 계속된다. 조용한 실패로 인식이 멈추지 않는다. |
| 모든 조합, 끼어들기 | AI가 말하는 동안 300ms 이상 발화 후 다음 응답을 대기 | 현재 재생은 한 번만 중단되고, 다음 응답이 동일한 출력 경로에서 정상 재생된다. |
