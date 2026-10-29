# 선택형 AvatarRouter 연동

## 현재 구현 범위와 제한

기존 대화 엔진·음성 재생·이미지 및 클립 아바타는 그대로 사용한다.
새 기능은 전역 기본 OFF이며, 관리자 설정·시나리오 허용 정책·대화 메뉴의 선택 UI와 독립 어댑터를 추가한다.
**현재 실제 라이브 아바타 연결은 차단되어 있다.** 설정을 켜도 외부 세션 생성, 이미지 업로드, AI PCM 전송 또는 라이브 영상·음성 수신이 시작되지 않는다.
이는 연결 오류를 숨기는 mock이나 일반 아바타로의 가짜 성공 처리가 아니다. 화면과 API 모두 사용 불가 사유를 반환한다.

초기 공개 GET 점검 기록 (새 위임 계약의 실서비스 등록 검증은 아님):
- `https://avatar-router.replit.app/api/ready`: DB ready, live enabled. Stock Tavus echo는 로그인·사용량 확인 및 120초 제한이 있다.
- `/api/v1/providers`: Tavus available, Anam unconfigured, LemonSlice·Simli 미구현.
- 초기 공개 Docs는 browser-scoped sessions만 설명했다. 이후 API 0.3에 JWT 위임이 추가되었고 최신 API 0.4는 프로젝트 API 키를 기본으로 한다. Gemini-to-avatar E2E는 여전히 미검증이다.

이 상태는 RoleplayX 서비스 간 인증, 특정 페르소나 이미지 사용 권한, AI PCM 또는 사용자별 미디어 권한이 준비되었다는 증거가 아니다.
외부 API는 서버 환경설정에 고정된 HTTPS Base URL로만 요청한다. 공개 상태 진단은 GET 2개이며, 별도의 API 키 연결 확인은 무료 `/auth/check` GET 하나만 실행한다. 시작 시 자동 진단·인증 확인은 없다.
타임아웃·응답 크기 제한·redirect 거부·필드 검증을 적용하고, 성공과 실패 모두 짧게 캐시하여 반복 진단의 부하를 제한한다.

## 기본 연결: Base URL + 프로젝트 API 키 (API 0.4)

추가 제공된 identity contract v2, API-key quickstart와 OpenAPI 0.4 PDF에 따른 기본 경로다.
기존 RoleplayX 로그인은 그대로 사용한다. 기본 연결에는 issuer, 공개 JWKS, RSA 개인 키, Clerk 이전이 필요하지 않다.
기존 JWT 관련 환경설정은 보존하되 프로젝트 API 키 경로의 성공/실패에 관여하지 않는다. API 키 오류를 JWT나 익명 세션으로 우회하지 않는다.

1. **AvatarRouter Studio → API keys**에서 대상 환경의 프로젝트 키를 발급한다. 필요한 scope만 선택한다. 키 관리 API를 이 앱에서 호출하지 않는다.
2. 같은 화면의 정확한 Base URL(끝이 `/api/v1`)을 복사하여 이 앱 서버의 `AVATAR_ROUTER_BASE_URL`에 설정한다. 개발용 preview 주소를 운영 주소로 간주하지 않는다.
3. 한 번 표시되는 `ar_sk_…` 키는 이 앱의 **Secrets**에 `AVATAR_ROUTER_API_KEY`로 저장한다. 브라우저 입력·보관, 채팅, 로그, 저장소, URL에 넣지 않는다.
4. 개발 workflow를 재시작한다. 관리자 → 시스템 설정 → 실시간 아바타 설정의 **API 키 연결 확인**을 명시적으로 실행한다.
5. `/auth/check`가 `authenticated: true`, `authType: api-key`, 프로젝트 정보·scope·만료 정보를 반환하는지 확인한다. 이 작업은 provider 세션을 만들거나 아바타 세션 사용량을 발생시키지 않는다.

서버는 매번 현재 관리자 활성 상태와 소속을 다시 확인한다. `X-Avatar-User-ID`는 검증된 계정으로부터 파생한 안정적인 opaque subject만 사용한다. 브라우저가 보낸 사용자 헤더·tenant·목적지·키는 사용하지 않는다.
프로젝트 API 키는 **프로젝트 인증**이지 독립적인 사람/조직 인증이 아니다. 하나의 키는 외부 프로젝트/tenant 하나에 고정된다. 이 헤더만으로 여러 RoleplayX 조직을 분리했다고 간주하지 않는다. 별도 외부 tenant에는 별도 프로젝트 키와 검증된 서버 매핑이 필요하며, 아직 조직별 session/asset dispatch는 활성화하지 않았다.

인증 응답은 크기·시간·스키마를 제한하고 raw 오류·추가 필드를 제거한다. redirect·자동 재시도·인증 fallback은 하지 않는다. 성공해도 전역/시나리오 정책이나 실제 라이브 readiness를 변경하지 않는다.
공개 상태 진단 역시 설정된 Base URL 호스트를 사용한다. Base URL 미설정 시에만 기존 공개 진단 호스트를 사용하며, 잘못된 설정을 다른 호스트로 우회하지 않는다.

키 회전은 프로젝트·scope·소유권을 보존하지만 이전 키를 즉시 무효화하고 만료를 90일로 갱신한다. 신규 키 생성은 새 프로젝트이므로 회전과 다르다.
마지막 사용 가능 키를 폐기하기 전에는 활성 세션을 중지하고 terminal 상태 및 `cleanupPending: false`를 확인해야 한다. 폐기만으로 provider 과금 종료를 보장할 수 없다.
유료 생성·실제 이미지/오디오 전송·운영 변경은 별도 승인 없이 실행하지 않는다.

## 선택적 고급 연결: JWT 위임 규격과의 대조

아래는 이전 API 0.3에서 도입되어 API 0.4에도 선택적으로 유지된 JWT 위임 경로다. 관리자 화면에서 **고급 JWT 위임 · 선택 사항**을 펼칠 때만 조회한다. API 키 기본 연결의 선행 조건이 아니다.
이 계약은 이전 API 0.2의 "동일 Clerk 사용자 + owner cookie" 제한을 대체하는 서버 간 위임 경로를 명시한다.
문서 수령은 인증·실제 미디어 전송의 승인이나 계약 충족을 의미하지 않는다.

| 항목 | 공식 문서가 보장하는 범위 | 현재 앱에서 남은 조건 |
| --- | --- | --- |
| 인증 | 별도 RSA 키의 RS256 `at+jwt`, 최대 60초, pinned issuer/audience/client/JWKS 검증 | 현재 앱에 45초 위임 서명과 공개 JWKS를 구현했다. 실제 전용 키 설정·개발 issuer/JWKS 등록·remote 인증 검증은 대기 중. 기존 로그인 JWT는 공유하지 않음 |
| 소유권 | 서명된 `(iss, tenant_id, sub)`로 세션은 tenant+subject, asset은 tenant 격리 | 현재 사용자·조직·회사의 활성 상태를 DB에서 매 요청 다시 확인해 opaque 식별자를 만들며 관리 범위나 요청 body를 회원 자격으로 사용하지 않음. remote 두 사용자·두 tenant 검증은 별도 필요 |
| 라이브 대상 | `tavus` / `tavus-stock-lucy` stock 인물 | 현재 페르소나의 사용자 이미지 기반 라이브 dispatch는 미제공. stock 인물로 자동 대체하지 않음 |
| PCM | 24 kHz mono PCM16 LE, 요청당 20ms~5초, at-most-once clip 명령 | 연속 Gemini PCM 스트림이 아님. 조각화·buffering·순서·턴 및 interrupt 동기화는 별도 구현·실측 필요. timeout audio 명령 자동 재전송 금지 |
| 영상·음성 | 준비 완료 뒤 room 한정 subscribe-only LiveKit token | 브라우저 수신기와 로컬/원격 단일 출력 소유권 검증 필요. token은 메모리에서만 취급 |
| 생성·종료 | 201은 queued. active + running + stopRequested=false + cleanupPending=false를 확인해야 준비 완료. end 200은 종료 요청 접수 | workerReady·사용 한도를 확인해야 하며 실제 종료는 terminal status와 cleanupPending=false까지 확인. 생성 결과가 불명확하면 자동 재시도 금지 |
| 비용·용량 | global 동시 stock 세션 1개, 시도당 120초 예약. provider credit은 unknown | 별도 유료 사용 승인 필요. 예약량을 요금 상한으로 해석하지 않음 |

OpenAPI Provider의 `degraded` 상태를 진단 parser와 타입에 반영했다. 이것이 실제 연결 gate를 해제하지는 않는다.

### 현재 구현된 위임 계층과 등록 대기

- `delegationSigner.ts`: 기존 로그인과 별도인 RSA 2048~8192-bit 키만 허용. issuer는 고정 HTTPS 식별자 또는 URN이며 JWKS의 공개 HTTPS 주소와 분리한다. request Host/URL에서 추론하지 않는다. 45초 JWT에 정확한 audience/client, opaque subject/tenant, scope 하나, 무작위 jti만 넣는다. 개인 키와 위임 토큰은 HTTP 응답에 넣지 않는다.
- `delegatedIdentity.ts`: 현재 사용자 활성/익명화 상태, 소속 조직과 회사의 활성·일치 상태를 다시 확인한다. 조직 회원은 조직 tenant를 공유하고 subject는 개별적이다. 조직 없는 계정은 사용자별 개인 tenant로 격리한다. operator의 관리 범위는 소속 회원 자격이 아니다. tenant ID는 browser가 선택하거나 임의 주장할 수 없다.
- `identityService.ts`: 현재 관리자가 명시적으로 실행할 때만 `live-limits:read` 하나로 고정된 `/api/v1/live-limits` GET을 호출한다. 로그인 JWT·cookie·Origin/Sec-Fetch 헤더를 전달하지 않는다. redirect/응답 크기/시간/스키마 제한을 적용하고 raw upstream 오류·추가 필드는 반환하지 않는다.
- 공개 `/.well-known/jwks.json`: 검증용 RSA public key만 반환. 미구성/오류 시 503, 오류 응답은 no-store. 정상 키는 5분 캐시한다.
- 관리자 화면의 **서버 위임 신원**은 구성 상태와 공개 등록값을 표시하고 **위임 인증 확인**을 수동 실행한다. 한 계정의 read 성공은 실제 미디어나 tenant 격리 검증을 의미하지 않는다.

서버 설정:

| 이 앱의 이름 | 종류 | 용도 |
| --- | --- | --- |
| `AVATAR_ROUTER_DELEGATION_ISSUER` | 환경변수 | 등록할 정확한 고정 issuer 식별자(HTTPS 또는 URN). 개발/운영은 별도 등록. JWKS 호스트와 같을 필요가 없음 |
| `AVATAR_ROUTER_JWKS_URL` | 공개 환경변수 | 이 앱의 공개 검증 키 경로를 가리키는 고정 HTTPS URL. URN issuer일 때 필수. 자격증명·query·fragment는 허용하지 않음 |
| `AVATAR_ROUTER_SIGNING_PRIVATE_KEY` | Secrets의 전용 RSA PEM | 최소 2048-bit. 기존 로그인 secret을 사용하지 않는다. 키는 운영자가 안전하게 생성·저장하며 채팅·저장소·AvatarRouter로 전달하지 않는다 |
| `AVATAR_ROUTER_PREVIOUS_PUBLIC_JWKS` | 선택적 공개 환경변수 | rotation overlap용 `{ "keys": [...] }` public RSA JWK만 허용. 현재 키 포함 총 32개 이하 |

키와 issuer 설정 후 workflow를 재시작해야 한다. 이 앱은 미구성 시 임시/공용 키를 만들지 않는다.
발급용 kid는 RSA 공개키 fingerprint에서 파생한다. HTTPS issuer이며 JWKS 주소를 별도 설정하지 않았을 때만 해당 origin의 `/.well-known/jwks.json`을 사용한다. URN issuer는 반드시 JWKS 주소를 별도 지정한다. issuer는 원격 소유권 namespace이므로 키 호스트 변경만을 이유로 바꾸지 않는다.
AvatarRouter 개발 환경에는 이 **공개 정보만** 등록한다:

```
ROLEPLAYX_ISSUER=<이 앱에 설정한 정확한 issuer>
ROLEPLAYX_JWKS_URL=<관리자 화면의 공개 JWKS URL>
ROLEPLAYX_AUDIENCE=avatarrouter-api
ROLEPLAYX_CLIENT_ID=roleplayx-avatarrouter
```

이 프로젝트가 외부 AvatarRouter 설정을 자동으로 변경하지 않는다. 등록 후 실제 개발 계정으로 읽기 전용 인증을 확인하고, 두 사용자·두 tenant의 소유권 격리를 검증해야 한다.
키 교체 시 기존/새 공개키를 함께 노출하고 provider 캐시 5분 + 최대 토큰 수명 60초 이상을 고려한다. 새 키 공개 후 서명 키 전환을 단계적으로 수행하고 검증한다.
개인 키를 외부에 공유하거나 브라우저에 위임 JWT를 반환하거나 한 사용자의 권한을 다른 사용자에게 재사용해서는 안 된다.
원래 요청한 실제 라이브 연동은 여전히 **미완료**이며, 차단 UI를 실제 연결 완료로 간주하지 않는다.

## 개발 화면 사용법

1. 시스템 관리자 → 시스템 설정 → **실시간 아바타 설정**에서 전역 허용 여부를 저장한다. 기본 OFF이며 권한은 관리자만 가진다.
2. 같은 영역의 **진단**을 직접 실행하면 현재 provider 상태를 읽을 수 있다. 이는 세션 시작이나 유료 provider 호출이 아니다.
3. 관리자/운영자 → 기존 시나리오 편집 → **시나리오 실시간 아바타 정책**에서 별도 저장한다. 운영자는 자신의 기존 category 범위에서만 가능하다.
4. 새 시나리오는 먼저 저장한 후 정책을 설정한다. 복사·가져온 시나리오에는 정책이 자동으로 복제되지 않는다.
5. 대화 화면 상단 메뉴를 열고 **실시간 아바타 옵션 보기**를 선택한다. 현재 방식과 차단 사유, 외부 AI 출력 오디오 전송·가능한 비용에 대한 동의 항목이 표시된다.
6. 현재 **실시간 아바타 시작**은 비활성화된다. **기존 방식 유지**를 누르거나 메뉴를 닫으면 기존 대화를 계속한다.

전역 설정과 시나리오 허용 정책은 기존 `system_settings`의 별도 category에 저장되는 **운영상 접근 정책**이다.
시나리오 콘텐츠·published runtime snapshot·`useVideoAvatar`·persona `videos`를 수정하지 않는다.
정책은 live 권한이므로 전역 OFF가 콘텐츠 재발행 없이 적용되어야 한다. 현재 원격 세션 자체가 없어 중간 세션 종료는 발생하지 않는다.
향후 실제 연결을 활성화할 때는 실행 중 세션의 권한 철회·종료까지 구현해야 한다.
이 작업에서 DB 스키마 변경, 운영 설정 변경 또는 배포는 하지 않는다.

## 내부 API

모두 기존 앱 인증을 사용하며 응답은 `Cache-Control: no-store`이다.

| API | 권한/동작 |
| --- | --- |
| GET `/api/live-avatar/config` | 로그인 사용자, 전역 flag와 고정 origin·계약 차단 사유. 외부 요청 없음 |
| PUT `/api/live-avatar/config` | 시스템 관리자, strict `{enabled: boolean}` |
| POST `/api/live-avatar/diagnostics` | 시스템 관리자 수동 공개 상태 진단. session/asset/PCM 호출 없음 |
| GET `/api/live-avatar/connection` | 시스템 관리자, API 키 기본 연결의 공개 구성 상태. 비밀 값과 외부 요청 없음 |
| POST `/api/live-avatar/connection/check` | 시스템 관리자, 빈 body만 허용. 현재 관리자 검증 후 `/auth/check` GET 하나. 키·사용자 헤더는 서버 전용이며 세션 생성 없음 |
| GET `/api/live-avatar/identity` | 시스템 관리자, 위임 서명 구성 상태와 공개 등록값. 외부 요청 없음 |
| POST `/api/live-avatar/identity/check` | 시스템 관리자, body는 비어 있어야 함. 현재 관리자의 fresh membership으로 `live-limits:read`만 수행. 유료 session/PCM 호출 없음 |
| GET/PUT `/api/live-avatar/scenarios/:scenarioId/policy` | 해당 시나리오 관리 권한, strict `{allowed: boolean}` |
| GET `/api/live-avatar/conversations/:conversationId/availability` | 해당 persona run의 scenario run 소유자. 관리자의 타 사용자 소유권 우회 없음 |
| POST `/api/live-avatar/conversations/:conversationId/sessions` | 소유권·완료 상태·strict 서비스 선택과 동의를 검증. flag/정책 검사 후에도 계약 미검증으로 409 반환, 원격 세션 생성 없음 |

일반 시스템 설정 쓰기 API로 새 policy category를 변경하는 것은 막는다. 전용 API만 사용해야 scenario 권한 검증을 건너뛰지 않는다.
마이크 데이터, 사용자 지정 URL, provider token, tenant ID를 요청 body로 받아 신뢰하지 않는다.

## 독립 어댑터 경계

- `AvatarRouterAdapter`: 공개 상태 검증과 session 계약 gate. `openSession`은 명시적 계약 오류로 실패한다. browser cookie, stock echo 또는 임의 endpoint로 우회하지 않는다.
- `LiveAvatarTransport`: provider 독립 인터페이스로 PCM 전송, 턴 완료, interrupt, close를 분리한다.
- `LiveAvatarAudioBridge`: 합성 transport로 검증된 라이프사이클 코어. **현재 음성 WebSocket 및 브라우저 재생에는 연결하지 않는다.**
  - AI 출력 PCM16 LE, mono, 24 kHz와 정수 turn/sequence/generation만 허용한다.
  - 임의 마이크 입력, 잘못된 프레임, 오래된 턴·세대·중복 프레임을 거부한다.
  - 버퍼·큐 길이·대기 시간·전송 시간 제한을 적용한다.
  - 초기 미디어 준비 전에는 음성 소유권을 얻지 않는다.
  - interrupt는 소유권을 즉시 반납하고 큐·진행 중 작업을 무효화하며 flush 확인과 새로운 media readiness 전에는 다시 활성화되지 않는다.
  - 장애 시 fallback callback을 호출하고 remote transport를 정리한다. 과거 오디오를 로컬로 재생하지 않는다.
  - persona 변경·재연결은 기존 bridge를 닫고 새 bridge를 생성하는 계약이다.
- 기존 렌더러 factory, `useRealtimeVoice`, `useAudioPlayback`, provider handlers는 수정하지 않는다.

**위 코어 테스트는 실제 AvatarRouter 음성 전송·미디어 재생·모바일 기기 동작을 검증하지 않는다.**
아직 설치되지 않은 미디어 수신기를 서버 상태만 보고 활성화하지 않도록 UI에서도 별도 gate를 둔다.

## 실제 연결을 활성화하기 위한 선행 조건

1. 기본 프로젝트 API 키와 정확한 Base URL을 설정하고 무료 연결 확인을 수행한다. 실제 두 사용자·두 tenant에는 일관된 user context와 별도 프로젝트 키 매핑을 검증한다. JWT 위임을 선택한 경우에만 전용 서명 키·issuer/JWKS 등록을 수행한다. 세션 lifecycle·provider capability·AI PCM framing/ack/interrupt·단기 미디어 권한도 실제 서비스에서 별도 검증한다.
2. 필요한 credential은 서버 비밀 설정으로 관리한다. 채팅이나 브라우저에는 provider 비밀정보를 넣지 않는다.
3. 기존 persona asset/binding의 올바른 tenant scope, 현재 이미지 hash/version, ready 상태와 권리 승인을 검증하는 서버 경로를 연결한다. 미검증 이미지를 전송하거나 stock 인물로 자동 대체하지 않는다.
4. 실제 session transport를 구현한 다음 기존 AI 출력 event의 **측정·확인된** 형식과 샘플레이트를 명시하여 bridge에 연결한다. 현재 브라우저의 24 kHz 가정만으로 PCM 규격을 검증했다고 간주하지 않는다.
5. 실제 미디어 수신기에서 재생 가능 상태·출력 장치·autoplay를 검증하고 로컬/원격 출력 중 하나만 소유하도록 연결한다. 장애·권한 철회·persona 전환 시 즉시 이전 미디어를 mute/detach하고 이후 음성은 기존 경로로 처리한다.
6. 별도 사용 승인을 받은 개발 세션에서만 실제 provider 검증을 수행한다. 유료 사용, 실제 이미지·음성 전송 및 운영 배포는 각각 해당 승인이 필요하다.

설정 값을 켜는 것만으로 이 gate를 제거해서는 안 된다.
