# AvatarRouter API 0.9 공통 연동

## 책임 경계와 활성화

제공자별 SDK·토큰·컨텍스트 변환·전사 정규화는 AvatarRouter가 처리한다.
앱은 서버 전용 프로젝트 키와 로그인에서 파생한 불투명 사용자 식별자로 공통 API를 호출한다.
새 제공자별 키·SDK는 설치하지 않는다. 기존 전역/시나리오 허용, 선택된 아바타,
명시적 유료 세션·음성·컨텍스트 전송 동의는 유지한다.

공식 계약:
- https://avatar-router.replit.app/roleplayx/managed-client-integration.md
- https://avatar-router.replit.app/roleplayx/roleplay-context.md
- https://avatar-router.replit.app/roleplayx/openapi.yaml

새 네이티브 세션은 해당 provider의 full-pipeline 기능과
`unified_roleplay_context`, `unified_client_connection`, `hosted_browser_client`를 요구한다.
기존 내부 URL·실행 mode의 Tavus 명칭은 호환성을 위해 유지하지만 새 경로는 두 제공자가 공유한다.

## 공통 실행

1. 앱의 소유 실행에 바인딩된 scenario/persona/조직 지침을 허용 목록으로 구성한다.
   루브릭·미디어 URL·자격 증명을 전송하지 않는다. Anam legacy 실행에 고정 snapshot이
   없으면 새 실행을 요구하며 현재 authoring 자료로 조용히 대체하지 않는다.
2. `POST /sessions`의 공통 `fullPipeline: {systemPrompt, context, languages}`를 두
   제공자에 동일하게 전달한다. 이는 API 0.9가 공식 지원하는 호환 형식이다.
   `roleplay`를 동시에 보내지 않는다. 공용 저장 페르소나를 수정하지 않는다.
3. 같은 세션의 실제 준비 상태를 확인한 뒤 `/client-connection`을 한 번만 POST한다.
   pipeline/session을 검증하고 고정 origin의 관리형 클라이언트에 opaque 연결 정보를 전달한다.
   새 Tavus도 앱의 Daily SDK가 아닌 이 경로를 사용한다. 기존 Daily 세션만 구형 복구를 유지한다.
4. 관리형 클라이언트의 `onMessages`는 메모리의 임시 자막 표시만 갱신한다.
   자막을 서버 기록·평가로 업로드하지 않는다.
5. 종료·화면 이탈·실패 시 서버 end를 요청한다. 로컬 ended나 HTTP 성공을 정리 완료로
   보지 않는다. 같은 세션의 non-active/closed/cleanupPending=false를 확인한다.
   상태 재조회는 생성·토큰 재발급·미디어 재시작을 하지 않는다.

## 최종 기록과 피드백

- `unified_final_transcript`를 현재 인증 응답에서 확인한다.
  과거 Tavus의 `tavus_final_transcript_v1`은 기존 기록 복구에만 계속 허용한다.
- 같은 사용자/프로젝트의 서버 간 `GET /sessions/{id}/transcript`를 사용한다.
  응답의 sessionId와 source를 로컬 매핑과 대조하고 최종 messages의 SHA-256 revision을
  최초 저장한다. 재시도에서 다른 revision을 수용하지 않는다. 응답은 최대 UTF-8 2 MiB다.
- 이 공통 API는 제공자 resource ID를 노출하지 않는다. 과거 제안의 providerSessionId,
  authentication, projectId 필드를 임의로 요구하거나 브라우저로부터 받지 않는다.
  제공자 세션의 실제 매핑 증명은 라우터 측 인증 증거로 별도 확인해야 한다.
- Ledger/legacy 이력으로 먼저 수입한다. Anam을 Tavus로 위장하지 않으며,
  Anam 메시지 ID는 provider/project/run/router-session/index로 격리한다.
  기존 Tavus 메시지 ID는 바꾸지 않는다. 반복된 같은 말도 별개 발화로 보존한다.
- Ledger metadata와 고정 feedback snapshot에 provider/project/router-session/revision 및
  원본 timestamp를 유지한다. TEXT는 수입 형식이며 독립 STT·청취 인증을 주장하지 않는다.
- 학습자 발화가 있으면 기존 durable feedback 작업 등록이 성공한 뒤 완료 상태를 반환하고
  공통 피드백 화면으로 이동한다. 작업 등록과 완성 보고서는 구분한다.
  기존 worker의 claim/publish fence 및 리포트 저장 트랜잭션은 그대로 사용한다.
- pending/unavailable는 빈 완료가 아니다. AI-only/빈 기록은 이력만 보존하고 점수를 만들지 않는다.
  보관이 꺼져 있던 과거 Anam 세션의 전사를 복원할 수 있다고 표시하지 않는다.

## 검증 범위

현재 구현 검증은 로컬/모의 검증이다. 실제 마이크 발화, 중단된 AI의 실제 제공자 기록,
두 실사용자 격리, 제공자 세션 매핑, 유료 통화에 기반한 완성 리포트는 미검증이다.
실제 통화에는 비용 상한·외부 음성 전송·두 사용자/실행 범위의 별도 승인이 필요하다.
외부 라우터 변경·운영 배포·유료 호출은 이 구현 작업에서 자동 실행하지 않는다.

설정의 Anam 연결 진단은 서버 고정 진단 배역을 사용하는 관리자 검사이며
선택한 학습 페르소나의 시나리오 기록·평가를 만드는 기능이 아니다.
