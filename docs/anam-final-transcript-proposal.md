# Anam 종료 후 기록·피드백: 라우터 계약 변경안

> 과거 협의안이다. 현재 구현은 [API 0.9 공통 계약](avatarrouter-unified-integration.md)을 사용한다.
> 아래의 제안 필드·hash 알고리즘을 현재 라우터 응답에 요구하지 않는다.

상태: **협의용 제안 및 로컬 모의 계약 검증. 실제 지원·저장·평가 활성화가 아니다.**
최신 공개자료 재확인: **2026-11-10**.

## 현재 확인과 범위

2026-11-10 다음 공개 문서와 공개 진단 API를 인증정보 없이 GET으로 재확인했다.

- https://avatar-router.replit.app/roleplayx/anam-integration.md — API 0.7
- https://avatar-router.replit.app/roleplayx/managed-client-integration.md — API 0.8
- https://avatar-router.replit.app/api/v1/providers — Anam `available`, `full_pipeline`,
  native Anam WebRTC와 제공자 정리 확인. 마이크·가청 대화 검증은 대기 중.
- https://avatar-router.replit.app/api/ready — 전역 준비 상태이며 최종 전사 capability를 광고하지 않는다.

현재 Anam 계약은 저장 페르소나 연결·종료·정리를 제공하지만 인증된 최종 전사
응답을 정의하지 않는다. 관리형 클라이언트 문서는 기존 Tavus 최종 전사 API와
Anam 평가 검증을 별도라고 명시한다. 공개 제공자 상태 `available`은 미디어 연결
상태일 뿐이며 전사 capability나 인증된 `/auth/check` feature가 아니다. 공개 API만으로
프로젝트별 transcript feature를 확인할 수 없으며, 해당 인증된 feature도 현재 확인되지 않았다.
따라서 Anam의 `evaluationAvailable=false`, `transcriptState=unavailable`을 유지한다.
`anam_full_pipeline`, 영상 재생 성공, Tavus 전사 feature, 아래 제안 feature의 출현만으로
이 제한을 해제하지 않는다. 브라우저 임시 자막은 표시용이며 저장·평가 증거가 아니다.

외부 저장소 변경/PR 제출, 라우터 게시, 운영 배포, 실제 유료 통화·음성 전송은 수행하지 않았다.
계약 문서 확정과 배포된 기능 확인 전에는 Anam에 `/transcript`를 호출하지 않는다.

## 제안하는 기능 계약

모든 명칭·경로·한도는 제안이다. 라우터 담당자의 공식 합의와 구현 검증이 선행되어야 한다.

- 별도 `integration.features` 제안명: `anam_final_transcript_v1`.
  제공자 서버에서 인증한 **최종** 기록을 확보할 수 있는 배포만 광고한다.
  Native 연결 지원이나 브라우저의 전사 업로드 지원은 이 feature가 아니다.
- 제안 읽기 경로: `GET /sessions/:id/transcript`, `sessions:read`, 서버 전용
  프로젝트 키 및 생성 때와 동일한 `X-Avatar-User-ID` 사용.
  로컬 사용자/실행 소유권과 현재 프로젝트 검사를 먼저 수행한다.
  다른 프로젝트·사용자의 세션은 조회·존재 여부를 노출하지 않는다.
  위임 인증 모드는 동일한 issuer/subject/tenant 바인딩을 유지한다.
- 응답: `Cache-Control: private, no-store`. 로그·분석에 전사 원문·인증정보를 넣지 않는다.
  읽기는 무료·재시도 가능해야 하며, 유료 세션 생성·연결 재발급을 유발해서는 안 된다.
- 외부 제공자 세션 ID는 브라우저가 지정하지 않는다. 라우터가 생성 시 고정한
  `avatarrouter-anam:{routerSessionId}` 라벨과 제공자 세션을 정확히 연결하고
  인증된 제공자 서버 조회 또는 서명 검증 웹훅으로 확정한다. 누락·다중 매칭·
  불완전한 목록·검증 실패는 `ready`가 아니다.
- 공통 응답 바인딩: `version=1`, `source=anam`, `pipeline=anam_full`,
  `projectId`, `userId`(로그인 ID/이메일이 아닌 라우터의 불투명 사용자 식별자),
  `sessionId`(라우터), `providerSessionId`(제공자). 앱은 서버에 고정한 매핑과
  모든 값을 비교한다. 원문 로컬 사용자 ID를 외부로 추가 전송하지 않는다.
  제공자 세션 매핑을 신뢰 가능한 세션 조회 응답에 노출하는 확장도 함께 합의해야 한다.
- 상태: `pending`은 아직 미확정, `unavailable`은 확정 전사 미지원/확보 불가.
  이 상태에는 `messages`, `revision`, `final`, `authentication`이 없다.
  `ready`만 `final=true`, `authentication=provider_server`, `revision`, `messages`를 갖는다.
  401/403/네트워크 오류·제공자 오류는 빈 기록이나 `ready`로 변환하지 않는다.
- `ready`는 제공자가 종료 후 완결성을 확인한 불변 기록이다. 마지막 임시 부분 전사,
  생성했지만 실제 발화 전에 취소된 AI 답변, system/tool 지침을 섞지 않는다.
  최종 텍스트 인증은 독립 음성 인식 정확성 검증이나 재생/청취 인증을 뜻하지 않는다.

### 제안 ready 응답

```json
{
  "version": 1,
  "source": "anam",
  "pipeline": "anam_full",
  "projectId": "project",
  "userId": "opaque-user",
  "sessionId": "router-session",
  "providerSessionId": "provider-session",
  "status": "ready",
  "final": true,
  "authentication": "provider_server",
  "revision": "<아래 알고리즘의 SHA-256 소문자 64자리>",
  "messages": [
    {
      "id": "m1",
      "role": "user",
      "text": "납기를 확인하고 싶습니다.",
      "timestamp": "2026-11-09T01:00:02.000Z"
    }
  ]
}
```

제안 v1 hash 입력은 아래 배열을 공백 없는 `JSON.stringify`로 인코딩한 UTF-8이다.
객체 키 순서와 관계없이 동일하며, 메시지는 제공자가 확정한 순서를 유지한다.
타임스탬프 문자열도 revision의 일부이므로 재시도에서 재포맷하지 않는다.

```text
[1,"anam","anam_full",projectId,userId,sessionId,providerSessionId,
 [[message.id,message.role,message.text,message.timestamp],...]]
```

메시지 ID는 세션 내 고유·불변이어야 한다. 동일한 말을 두 번 해도 서로 다른 ID로 보존한다.
각 ID는 `[a-zA-Z0-9_-]{1,160}`, 프로젝트/사용자는 1~256자, 역할은 user/assistant,
본문은 공백만인 값 금지·최대 10,000자, timestamp는 offset 포함 ISO 날짜,
메시지는 최대 1,000개다. 전체 응답은 UTF-8 2 MiB로 제한한다.
초과는 명시적 오류로 반환하고 잘라내지 않는다. 알 수 없는 필드·버전은 거부한다.
앱도 본문 크기를 제한하는 전송 계층을 구현해야 한다.

SHA-256은 무결성/동일성 검사이지 서명이 아니다. 브라우저가 같은 hash와
`authentication` 문자열을 만들 수 있으므로 JSON 자체는 인증 증거가 아니다.
인증된 서버 간 경로와 라우터의 실제 제공자 검증이 반드시 필요하다.

## 실제 지원 후 연결할 기존 저장·평가 경로

아래는 **활성화 수용 조건**이며 현행 Anam의 동작 설명이 아니다.

1. 라우터 공식 문서·스키마·실제 배포 feature·인증된 최종 전사 출처를 먼저 확정한다.
   로컬의 `contracts/anamFinalTranscriptProposal.ts`는 테스트 모델일 뿐 dispatch에서
   import하지 않는다. 합의 후 스키마와 capability gate를 별도 구현·검증한다.
2. `server/services/tavus/sessions.ts`의 로컬 user/run/project/provider/session 매핑을
   유지하고 Anam 전용 검증 어댑터를 사용한다. provider 정리 완료
   (`rendererState=closed`, `cleanupPending=false`, non-active)를 확인한 뒤 가져온다.
   브라우저 ended 이벤트나 `/end` 접수만으로 실행 완료를 확정하지 않는다.
3. 실행별 전사 import lease를 획득하고 최초 검증 revision을 저장 **후** 기록을 쓴다.
   재시도는 같은 revision만 수용한다. 타 실행·사용자·프로젝트·제공자 session,
   revision 변경은 실패로 처리하고 기존 기록/평가를 덮어쓰지 않는다.
   만료 lease의 이전 worker도 publish하지 못하도록 저장 계층에서 fence한다.
4. `server/services/tavus/importTranscript.ts`의 재시도 가능한 구조를 공용화하되
   Anam 기록의 provider는 반드시 **anam**으로 보존한다.
   기존 Tavus UUID 의미를 변경하지 않고 새 Anam ID는
   provider/project/routerSession/providerSession/message ID를 포함해 충돌을 방지한다.
   Tavus importer나 `source=tavus`로 우회하지 않는다.
5. Ledger는 현재 `shared/conversationLedger.ts`에서 anam을 허용하지 않는다.
   실제 활성화 시 server-only `provider.final` 수입과 `provider=anam`을 명시적으로
   추가하고, `conversationLedger/feedbackBinding.ts`도 Anam의 원본 timestamp·음성 모드를
   보존하도록 확장한다. TEXT import는 운반 형식일 뿐 음성 캡처/STT/재생 검증을 위조하지 않는다.
   다른 provider의 기존 증거가 있으면 혼합을 거부한다.
6. Ledger projection/불변 최종 snapshot 또는 legacy chatMessages에 먼저 저장한다.
   기존 `resolveTavusContext`의 실행에 바인딩된 scenario/persona/rubric/harness와
   `readLedgerFeedbackInput`의 불변 평가 입력을 재사용한다.
   나중의 authoring/조직 변경이나 live rubric으로 과거 실행을 다시 구성하지 않는다.
   imported snapshot에 rubric이 없으면 live fallback하지 않는다.
7. 학습자 발화가 있으면 기존 `enqueueFeedbackJob`에 `transcriptSource.provider=anam`,
   두 세션 ID·revision 등 출처를 유지하여 durable 작업을 등록한다.
   등록 실패 시 run 완료·피드백 이동을 확정하지 않는다. 재시도는 기존 작업을 재사용하고,
   worker claim/publish token 및 보고서 저장+completed 트랜잭션을 유지한다.
   등록 확인 후에만 공통 피드백 진행 화면으로 이동한다. 등록 완료와 보고서 완료는 다르다.
8. `ready/messages=[]`와 AI-only는 이력 상태를 구분해 보존하되 학습자 점수·
   피드백 작업을 만들지 않는다. pending/unavailable는 빈 완료로 대체하지 않는다.
   페이지 이탈 후에도 기존 서버 worker가 안전하게 이어가야 한다.
9. `shared/avatar/personaAvatar.ts`의 playback/validationStatus와 전사·평가 capability는
   별개다. 준비된 아바타나 client_playback_report로 평가를 활성화하지 않는다.
   `TavusChatWindow`의 현재 Anam 차단도 실제 계약 구현 완료 후에만 해제한다.

## 검증과 승인 구분

현재 무료 로컬 검증:

- 제안 모델: 소유권 바인딩, 상태, source, final, 인증 표시, 중복 ID, hash,
  변경 revision 거부, 같은 말 반복/동일 revision 재시도.
- 실제 앱: Anam feature 없음/일반 native/Tavus/제안 문자열로 import가 열리지 않음,
  저장된 completed 상태도 Anam 평가로 표시하지 않음, 타 사용자 차단.
- 기존 Tavus: 정상 확정 전사·재시도·동시 import·AI-only/빈 기록·
  Ledger 출처와 고정 harness 전달·durable enqueue 실패 보호 회귀 검사.

합의/구현 후 무료 통합 검증:

- 인증된 라우터 모의 응답으로 Anam 이력 → Ledger snapshot → durable feedback →
  공통 진행/결과 UI 전체 경로, legacy 저장, 잘못된 프로젝트/사용자/provider/세션,
  revision 변경, lease 만료·중복 종료·재시작·enqueue 실패를 검증한다.
- 제공자 서명 검증/서버 조회 신뢰, 크기 제한, capability 철회, 권한 실패,
  생성 결과 불명확 fence를 라우터 측에서도 검증한다.

**별도 승인 후** 실제 유료 통화 검증:

- 명시적 비용·음성 외부 전송 동의로 짧은 Anam 통화를 수행한다.
- 실제 발화와 제공자 최종 기록(중단/끼어들기 포함), 소유권 매핑, 정리 완료,
  동일 revision 재조회, 앱 이력·평가 작업·완성 보고서까지 확인한다.
- 두 사용자/두 실행의 격리는 별도 승인된 통화 범위에서 확인한다.
  모의 계약 통과를 실제 음질·STT·배역 준수·유료 E2E 통과로 보고하지 않는다.

외부 라우터 변경/병합·게시 승인, 앱 운영 배포 승인, 유료 통화 승인은 서로 대체하지 않는다.
