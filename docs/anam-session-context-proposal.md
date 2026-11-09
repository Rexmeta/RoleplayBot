# Anam 세션별 역할·조직 지침 계약 변경안

상태: **라우터 협의용 제안이며, 현재 구현·지원 계약이 아니다.**
외부 저장소 수정, PR 제출, 게시, 유료 세션 및 음성 전송은 실행하지 않았다.

## 현재 계약 재확인

2026-11-09 아래 공개 문서를 GET으로 다시 확인했다.

- https://avatar-router.replit.app/roleplayx/managed-client-integration.md — API 0.8
- https://avatar-router.replit.app/roleplayx/anam-integration.md — API 0.7

관리형 클라이언트는 미디어 연결을 공통화할 뿐 시나리오 컨텍스트를 전달하지 않는다.
Anam 문서는 프롬프트·음성·모델이 저장 페르소나 설정을 사용한다고 명시하고,
`POST /sessions`에서 Tavus `fullPipeline`, `avatarAssetId`, `purpose=validation`을
지원하지 않는다. `anam_full_pipeline`, `unified_client_connection`,
`hosted_browser_client`는 역할·조직 지침 지원 신호가 아니다.

따라서 `server/services/tavus/sessions.ts`의 Anam 분기는 현재처럼
선택한 저장 페르소나로만 생성한다. 로컬에서 컨텍스트를 구성할 수 있다는 사실,
Tavus의 컨텍스트 지원 또는 Anam 영상 연결 성공을 지침 적용 성공으로 해석하지 않는다.
**현재 Anam 시나리오 역할·조직 지침 적용은 미지원이다.**

## 라우터에 요청할 추가 계약

아래 이름·한도·오류 코드는 모두 제안이다. 라우터의 공식 문서 및 구현과 합의하기
전에는 앱이 이 필드를 전송하거나 제안된 feature 문자열만 보고 활성화해서는 안 된다.

### 기능 발견 및 요청

- `GET /auth/check`의 `integration.features`에 **제안명**
  `anam_session_context_v1`을 별도로 광고한다.
- 광고는 Anam 제공자 어댑터가 세션 단위 덮어쓰기를 실제 지원하고, 저장 페르소나를
  바꾸지 않고 적용할 수 있는 배포에서만 한다. 단순 필드 수용은 지원이 아니다.
- 제안된 `POST /sessions` 확장:

```json
{
  "providerId": "anam",
  "avatarId": "anam-persona-default",
  "mode": "live",
  "pipeline": "anam_full",
  "costConfirmed": true,
  "anamSessionContext": {
    "version": 1,
    "systemPrompt": "<공통 역할극 지침>",
    "context": "<고정 실행 스냅샷에서 허용 목록으로 구성한 ROLEPLAY_SESSION_DATA>",
    "language": "ko"
  }
}
```

- Tavus `fullPipeline`을 재사용하지 않는다. `anamSessionContext`는 `anam_full`에만
  허용하고 알 수 없는 필드·버전·언어를 엄격히 거부한다.
- 제안 한도: systemPrompt 4,000자, context 12,000자, 전체 요청 UTF-8 64 KiB.
  잘라내거나 요약해서 조용히 수용하지 않는다. `ko/en/ja/zh`를 명시적으로 계약한다.
- feature 미지원은 `ANAM_SESSION_CONTEXT_UNSUPPORTED`, 잘못된 입력·초과는
  `ANAM_SESSION_CONTEXT_INVALID`로 **과금 가능한 provider 생성·토큰 발급 전에**
  거부한다. 실패 시 저장 페르소나 대화로 조용히 대체하지 않는다.
- 선택적 필드로 추가해 기존 관리자 진단과 저장 페르소나 호출은 그대로 보존한다.

### 적용 의미와 확인

라우터는 소유 프로젝트·사용자 검증 후 요청을 해당 세션에 고정한다.
공용 Anam 페르소나 PATCH/재저장, 세션 사이 전역 변수 공유, 다른 사용자에게 재사용은
금지한다. 제공자에 저장 페르소나 참조와 세션별 지침을 함께 적용할 수 없다면, 지원
광고를 하지 않고 차단한다. 임시 페르소나 생성·비용·정리 범위 변경도 별도 합의 없이는
허용하지 않는다.

우선순위는 제공자 안전 정책 → 공통 역할극 지침 → 고정된 조직 응답 지침과 배역·상황
→ 학습자 대사다. 학습자 문장으로 배역을 교체하거나 비공개 목표·평가 기준을 공개하지
않는다. 음성·외형·모델 등 저장 페르소나의 물리적 설정은 유지한다.

생성/조회 응답에는 제안된 안전한 확인값
`sessionContext: { version: 1, status: "applied" }`를 제공한다. 원문 지침이나 토큰을
응답·로그·분석에 노출하지 않는다. `applied`는 단순 저장이 아니라 제공자 토큰/세션에
설정이 적용되었음을 뜻해야 한다. 연결 시점 적용이라면 그 준비 상태를 별도 명시하고,
적용 전에 대화를 시작하지 않는다. 유실·불명확한 생성 결과에는 기존 재조정 차단과
일회성 연결 정책을 유지하며 새 유료 생성을 자동 재시도하지 않는다.

### 앱 활성화 수용 조건

1. 라우터 운영자가 공식 두 계약 문서, 요청/응답 스키마 및 지원 feature를 확정한다.
   문서와 배포된 `auth/check` 양쪽을 확인한다. 제안 문자열 단독으로는 충분하지 않다.
2. 그 후에만 앱에서 명시적 capability 분기를 구현한다. 현재 Anam 연결은 유지하되
   지원되지 않는 상태에서 지침이 적용됐다고 표시하지 않는다. 필수 지침 적용 요청은
   과금 전 명확히 차단하고 기존 방식 선택은 사용자에게 맡긴다.
3. 기존 `resolveTavusContext`의 허용 목록을 재사용하되 전송 경로는 고정 스냅샷을
   요구한다. ledger에 바인딩된 시나리오가 우선이며, 실행 시나리오 snapshot과
   actor `_runtimeProfile`, snapshot의 `_overridePromptBlock`을 사용한다.
   snapshot이 없는 legacy run은 현재 authoring/조직 설정으로 채워 보내지 않는다.
   새 고정 실행을 요구한다. 기존 Tavus의 legacy 동작은 별도로 유지한다.
4. 이름·배역·성격/말투·목표·상황·조직 응답 지침과 언어만 허용한다. rubric,
   평가 가중치, 연락처, 원본 DB 레코드, 미디어 URL, 인증정보는 직렬화하지 않는다.
   시작 뒤 시나리오·조직 설정·공유 페르소나가 바뀌어도 실행 내용은 바뀌지 않는다.
5. 지침에 조직 내부 정보가 포함될 수 있음을 기존 비용/외부 전송 동의에 명시한다.
   브라우저가 지침·조직·provider·목적지를 임의 지정하지 못하게 한다.
6. Gemini의 마이크·응답 생성·로컬 음성을 동시에 실행하지 않는다.
   `/client-connection` 일회성 전달, 라우터 공통 클라이언트, 사용자/프로젝트 소유권,
   동의·예산·불명확 생성 fence·서버 종료/정리 확인은 그대로 유지한다.
7. Anam 확정 대화록/평가는 이 capability와 무관하다. 별도 공식 지원 없이
   Tavus transcript API나 임시 브라우저 자막을 확정 평가 자료로 쓰지 않는다.

## 합의 후 검증 기준

- 광고 없음/일반 native capability만 있음: 컨텍스트 요청 없음.
- snapshot의 배역·조직 지침 전송; authoring 변경·조직 설정 변경·타 actor와 혼합 없음.
- 서로 다른 두 실행을 동시에 시작해도 지침/프로젝트/사용자 교차 오염 없음.
- 잘못된 버전·초과 크기·소유권 불일치·지원 철회는 유료 생성 전에 실패.
- 적용 확인값 누락/거부/연결 응답 유실 시 성공으로 표시하지 않고 기존 종료·재조정 유지.
- mock 요청 테스트와 실제 배역 유지/대화 품질 검증을 구분한다.
  실제 두 역할의 발화·조직 지침 준수 확인은 **별도 유료 통화 승인 후** 수행한다.

이 문서는 라우터 변경 준비 산출물이며, 외부 변경 승인을 대신하지 않는다.
