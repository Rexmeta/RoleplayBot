# 서버 중심 대화 기록 — 구현 계약 및 전환 경계

## 현재 적용 단계

최근 반영된 마이크 승인·iOS 오디오 경로·대화내역 뷰포트 및 한국어 전사 evidence와
startup migration 보완은 그대로 유지한다. 이들은 서버 원장의 완료를 의미하지 않는다.

이번 착수 단계는 독립 서버 원장 기반이다:

- 안정적인 발화 UUID, 서버 순서와 업데이트 cursor, 발화 revision
- 발화 상태와 중요한 이벤트를 같은 PostgreSQL 트랜잭션에 기록
- event ID와 정규화된 payload hash로 멱등 처리 및 충돌 거부
- COMMIT 이후에만 반환되는 ACK, 오래된 연결/capture 세대 차단
- provider event/response ID 매핑과 responseTo의 동일 실행/화자 검증
- capture·provider completion·recognition·playback observation의 독립 상태
- 종료 snapshot의 immutable 내용·revision·hash 및 보류 사유
- 동일 실행 잠금과 트랜잭션 안에서 수행하는 snapshot publication fence
- 번호 SQL과 서버 시작 migration 양쪽에 스키마 보장
- 소유권 검사를 거친 원장 조회·명령·snapshot 조회 API

**아직 기존 세션의 기록 권위를 전환하지 않았다.** 런타임/클라이언트/평가 연결을
완료하기 전 자동 등록이나 사용자가 임의로 새 프로토콜을 켜는 endpoint를 두지 않는다.
이 단계에서 대화 원장 전체 재설계를 완료했다고 표시하거나 운영에 자동 배포하지 않는다.
기존 DB 기록은 이전 방식 그대로 남고, 원장이 없는 실행의 조회는 `version: legacy`이다.

## 기존 경로 비교 및 통합 대상

| 진입점 | 현재 역할 | 남은 전환 |
| --- | --- | --- |
| `server/storage/sessions.ts` | normalized message 및 voice transcript upsert | 새 실행에서 원장 writer/projection만 사용 |
| `server/services/voice/transcriptionIntegrity.ts` | 제공자 user turn identity 및 provisional/final | 원장 UUID와 provider ID 연결; durable ACK를 await |
| `server/services/voice/recognitionEvidence.ts` | Live/STT/사용자 확인 및 revision | 신규 실행에서 동일 원장 상태와 canonical view 사용 |
| `server/services/voice/utteranceCapture.ts` | 한국어 원음 capture, STT 및 실패 hold | 모든 언어 capture 무결성과 gap 명령; 한국어만 인식 정책 적용 |
| `server/services/voice/geminiMessageHandler.ts` | Gemini 전사·AI 응답 처리 | 사용자/AI 별도 등록·final/interruption·responseTo 통합 |
| `server/services/voice/openaiRealtimeAdapter.ts` | OpenAI 음성 이벤트 처리 | provider item/response mapping 통합 |
| `server/services/realtimeVoiceService.ts` | 세션 생성·재연결·종료·context | 신규 세션 시작에만 protocol 고정, 서버 projection으로 context 구성 |
| `server/routes/conversations.ts`의 `/messages` | 텍스트/TTS 메시지 저장·평가 | 명령 기반 user 제출과 AI 등록, snapshot 평가 |
| 동일 라우트의 `/realtime-messages` | 브라우저 전체 배열 저장·종료 | 신규 실행에 대해 거부하고 legacy 경로에만 유지 |
| `server/routes/agentApi.ts`의 `/sessions/:id/messages`, `/end` | 공개 API 저장·평가 | 같은 writer/종료 barrier 사용 |
| `client/src/hooks/chat/useChatSession.ts` | flush·완료·피드백 경로별 배열 재저장 | 하나의 종료 명령과 재전송 outbox |
| `client/src/components/ChatWindow.tsx` | pagehide beacon·로컬 발화 합성 | 명령/관측만 보내고 서버 ID/revision으로 표시 |
| `client/src/hooks/useRealtimeVoice.ts`, `useAudioPlayback.ts` | 캡처·음성 수신·재생 | stable ID, ACK 처리, 재연결 cursor, playback 관측 |
| `server/services/feedbackGenerationService.ts` | durable job 및 token-fenced publish | 원장 snapshot ID/hash/revision으로 입력·publish 고정 |

## 프로토콜

`{ eventId: UUID, generation: serverGeneration, payload: validatedTransition }`

- ID는 문장 내용·배열 index·messages.length에서 만들지 않는다.
- 연결 세대는 서버의 `connection.open`이 발급한다. 이전 세대의 신규 이벤트는 거부한다.
- 이미 commit된 동일 이벤트는 연결 세대가 바뀐 뒤 재전송해도 기존 ACK를 반환한다.
- 같은 event ID에 다른 payload가 오면 충돌이다. 다른 발화 ID의 동일 문장은 보존한다.
- 클라이언트는 text submit/capture commit 또는 gap/명시적 인식 확인/playback observation/
  session close만 보낸다. 등록·제공자 final·STT 결과·연결 발급은 서버 전용이다.
- 모든 중요 전이는 DB 이벤트로 남긴다. 토큰 delta, PCM, arbitrary metadata는 저장하지 않는다.
- capture sequence 건너뛰기와 미완료 capture의 연결 종료/겹침은 명시적인 gap이다.
- 사용자 확인은 canonical text를 확정할 수 있지만 누락된 capture를 복원했다고 간주하지 않는다.
- provider final만으로 한국어 인식 정확성을 확정하지 않는다. 독립 STT의 공백 이외 차이는
  확인 대상이며 STT 실패/비활성 등의 hold는 늦은 provider final로 해제하지 않는다.
- `playback.observed: completed`는 브라우저의 재생 관측이지 사용자가 실제 청취했다는 증명이 아니다.

## 조회 및 ACK

소유권 검사는 기존 인증을 유지한다. 관리자/운영자 읽기 권한을 타 사용자 쓰기로 확장하지 않는다.

- `GET /api/conversations/:runId/ledger?after=cursor`
  최신 cursor와 그 이후 변경된 발화를 원래 server sequence 순서로 반환한다.
  클라이언트는 발화 ID/revision으로 병합하며 내용 기반 dedup을 하지 않는다.
- `POST /api/conversations/:runId/ledger/commands`
  등록된 원장 실행만 처리한다. legacy 실행을 자동 전환하지 않는다.
- `GET /api/conversations/:runId/ledger/snapshots/:snapshotId`
  해당 실행에 속한 snapshot만 반환한다.
- 응답 ACK는 durable event의 sequence, 발화 revision 및 종료 snapshot ID를 포함한다.
  응답 전 트랜잭션 COMMIT 실패가 발생하면 ACK를 반환하지 않는다.

## 종료 및 평가

호출자는 같은 논리적 종료의 event ID를 보존해서 재시도한다. 아직 provider/STT 처리를
기다리는 bounded drain과 모든 종료 진입점의 연결은 후속 전환 범위다. 현재 원장 close는
미완료 capture를 gap으로 기록하고, 해결되지 않은 recognition/provider/playback 때문에
평가를 보류할 사유를 snapshot에 남긴다. 늦은 evidence/사용자 확인은 기존 snapshot을
수정하지 않고 새 revision의 snapshot을 생성한다.

`withCurrentLedgerSnapshot`은 소유 실행, hash, 최신 revision, closed 상태, 보류 사유를
검사하고 **동일 트랜잭션 안에서** publish callback을 실행한다. 향후 feedback job
adapter는 이 잠금 안에서 보고서 저장과 job 완료를 함께 해야 한다. 검사 이후 잠금을
풀고 점수를 게시하면 안 된다. 이 기반은 아직 기존 feedback job에 연결되지 않았으므로
현재 평가가 원장 snapshot을 사용한다고 주장하지 않는다.

## 안전한 활성화에 남은 작업

1. 신규 세션에서만 protocol을 고정하고 서버가 runtime scenario/persona/harness/rubric
   snapshot을 캡처한 뒤, 기존 기록이 없는 실행을 enroll한다. imported content의
   snapshot 완전성 검사를 유지하며 mutable registry로 대체하지 않는다.
2. 텍스트/TTS/Agent API 및 양쪽 실시간 provider를 공통 writer에 연결한다.
3. 브라우저의 전체 배열 저장·문장 dedup·sessionStorage 병합을 신규 경로에서 제거하고
   ACK/retry/cursor projection 및 상태별 표시를 연결한다. 적용된 아이폰 기능은 유지한다.
4. 모든 종료 경로의 bounded drain과 feedback job enqueue/publish를 snapshot barrier에 연결한다.
5. 연결/DB 장애·재시작·종료 경합 회귀를 통과한 신규 실행부터 활성화한다.

## 검증 경계

정책 검사는 인식 순서 역전·확정 보존·provider final 불변·capture gap·playback 관측을
검사한다. PostgreSQL 계약 검사는 실제 DB의 연결 전용 TEMP 테이블에서 트랜잭션을
실행하므로 애플리케이션 public 기록을 생성/수정하지 않는다.

실제 한국어 음원 정확성, 물리적 아이폰/Bluetooth 경로, ACK 전 브라우저 소실과
실시간 provider 자동 이전은 이 단계에서 검증하거나 복구를 보장하지 않는다.
원음 복구 저장은 동의·접근 제어·암호화·보존·삭제 정책 승인 없이는 비활성이다.
