# 선택형 AvatarRouter 연동

## 페르소나의 기본/커스텀 아바타 초안 선택

관리자 페르소나 편집의 Live 탭에서 **아바타 목록 조회**를 누르면, 로그인한 관리자의
프로젝트·사용자 연결을 통해 두 목록을 읽는다. 자동 생성·유료 세션 시작은 하지 않는다.

- **기본 아바타**: `/avatars`의 stock 참조. 현재 `configured: true`인 Tavus
  `tavus-stock-lucy`만 초안 선택 가능하다. mock 또는 다른 configured 참조는 비활성화한다.
  저장 형태: `{ kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus", ... }`.
- **커스텀 자산**: `/avatar-assets`의 UUID 자산. 기존 준비 완료·재사용 가능 조건과
  프로젝트/사용자 소유권 검사를 유지한다.
  새 선택 저장 형태: `{ kind: "custom", assetId: "<UUID>", providerId: "tavus", ... }`.
- 기존 `kind` 없이 `assetId` UUID만 있는 저장값은 커스텀 초안으로 계속 읽는다.
  기존 값을 일괄 변환하거나 가짜 자산 UUID를 만들지 않는다. JSON 초안 컬럼을 그대로
  사용하므로 데이터베이스 마이그레이션이 필요하지 않다.
- 두 종류를 전환하면 이전 종류의 ID 필드는 제거된다. `assetId`와 `avatarId`를 함께
  보내거나 stock ID를 UUID 자산으로 보내면 서버가 거부한다.

서버는 선택 시 해당 목록을 다시 확인하며 브라우저의 검증 상태를 신뢰하지 않는다.
stock 선택은 `validationStatus: "unverified"`이며 모든 선택은 `activation: "draft"`,
`voiceMode: "roleplayx"`다. 기본 아바타에는 커스텀 자산 검증 패널을 연결하지 않는다.
목록에서 사라지거나 사용 불가가 된 기존 선택은 다른 아바타로 자동 대체하지 않는다.
기존 로그인·시나리오 선택·이미지/비디오 fallback·유료 작업의 명시적 동의·정리 방어는
바뀌지 않는다. 실제 학습자 Live 연결은 별도 단계이며 이 선택만으로 활성화되지 않는다.

## 현재 구현 범위와 제한

기존 대화 엔진·음성 재생·이미지 및 클립 아바타는 그대로 사용한다.
새 기능은 전역 기본 OFF이며, 관리자 설정·시나리오 허용 정책·대화 메뉴의 선택 UI와 독립 어댑터를 추가한다.
**일반 시나리오 대화의 라이브 아바타 연결은 계속 차단되어 있다.** 전역 설정을 켜는 것만으로 외부 세션 생성, 이미지 업로드, AI PCM 전송 또는 라이브 영상·음성 수신이 시작되지 않는다.
별도로 시스템 관리자의 명시적 동의로만 실행되는 stock Lucy 테스트 경로가 추가되어 있다. 이는 일반 대화의 gate를 해제하지 않는다.
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

### 페르소나 관리: 라이브 연결 초안과 Tavus 생성·재생 검증

`/admin-management` → 페르소나 관리 → 생성 또는 수정 → **아바타 표시 방식**.

- 이미지·비디오·Live 세 가지를 선택한다. 기존 레코드의 모드가 비어 있으면 `videos.enabled`로 표시만 추론하며 일괄 변환하지 않는다. 이미지/비디오를 명시적으로 선택하면 해당 enabled 값만 맞추고 기존 이미지·클립을 지우지 않는다.
- **Live는 원하는 설정의 초안이다. 실제 활성화가 아니다.** 저장 후에도 기존 이미지/비디오·시나리오별 표시 정책을 유지한다. 목록에 Live 초안 배지와 기존 표시 설정을 구분하며, learner 런타임이나 시나리오 관리 화면은 변경하지 않는다.
- **아바타 목록 조회** 또는 생성·보고 후의 목록 갱신 시 기존 로그인 + admin/operator 역할의 서버가 `/auth/check`와 `/avatar-assets`를 GET한다. 프로젝트 키에 **`assets:read`** scope가 필요하다. 기존 세션 진단용 7개 scope만 있는 키로는 조회할 수 없으며 이 경우 명시적인 권한 오류를 보여준다.
- Tavus·Anam 자산을 조회하며 준비 상태와 Live 검증을 구분한다. Ready + reusable + providerAvatarId가 있는 자산만 초안에 연결할 수 있다. API 0.5의 `liveValidation`이 있으면 `runtimeSupported`, `status=validated`, `method=client_playback_report`, 검증 시각과 `liveRendering`을 확인한다. 이전 capability 라벨로 새 미검증 결과를 덮어쓰지 않는다. activation은 항상 draft다.
- 서버는 자산 연결 시 소유 프로젝트와 자산·provider 일치를 재확인하고 브라우저가 주장한 validationStatus는 덮어쓴다. 자산 ID와 프로젝트 ID를 저장하며 타 프로젝트 자산으로 교체하지 않는다. 같은 초안의 변경 없는 저장은 공급자 장애 때도 가능하고 저장된 검증 값은 과거 확인 결과일 뿐이다. 조회 후 사라지거나 실패한 자산도 다른 것으로 자동 대체하지 않는다.
- API 계약에 preview URL이 없으므로 카탈로그 미리보기 이미지를 만들어 표시하지 않는다. 아래의 별도 생성·재생 검증은 관리자 명시 동작으로만 실행한다. 일반 시나리오의 라이브 차단은 해제하지 않는다.
- Base URL + 프로젝트 키를 사용하며 새로운 로그인이나 JWT 위임 설정은 요구하지 않는다. 한 프로젝트의 공용 콘텐츠 관리 연결이고, 조직별 별도 외부 tenant 격리를 구현했다는 의미는 아니다.
- 새 nullable 컬럼은 번호 SQL과 개발 시작 마이그레이션 양쪽에 추가한다. 운영 반영/배포는 별도 승인 대상이다.

#### 커스텀 생성 (API 0.5)

사용자는 API 0.5가 배포되었음을 확인하고 페르소나의 생성·재생 검증 구현을 승인했다. 이는 개발자가 실제 유료 호출이나 이미지·음성을 전송해도 된다는 승인은 아니다.

1. Live 영역의 **Tavus 커스텀 생성**에서 JPEG/PNG/WebP 이미지를 직접 선택한다. 기존 페르소나 이미지 URL을 임의로 가져오거나 외부 URL을 서버에 전달하지 않는다. 최대 4.5MB, 4096×4096, 단일 프레임을 서버에서도 검증한다.
2. 이름·합성/실존 인물을 지정하고 이미지 권리·외부 전송·비용의 세 동의를 확인한다. 실존 인물은 동의 증빙 참조가 필요하다. 요청은 `POST /api/admin/personas/live-avatar/creation`이며 `assets:read`와 `assets:write`가 모두 필요하다.
3. 서버가 이미지 등록 후 동의 상태를 확인한다. `pending_review` 이미지는 프로비저닝하지 않으며 실존 인물은 `verified`일 때만 진행한다. 운영자가 외부 검토를 마친 후 **작업 상태 조회**로 확인하고 같은 이미지로 명시적으로 재개한다. 합성 인물이라고 허위 신고하는 것을 독립적인 신원 검증으로 방지하는 기능은 아니다.
4. Tavus 생성은 비동기 제출이다. 결과를 ready나 재생 성공으로 표시하지 않는다. 목록 갱신 후 준비 상태를 확인하고 자산을 직접 선택한다. 저장된 초안을 자동으로 다른 자산으로 교체하지 않는다.
5. 이미지 등록·프로비저닝 전 DB에 작업 상태를 저장한다. 응답이 불확실하면 자동 재시도하지 않는다. **작업 상태 조회**는 GET만 사용해 이미지 해시/소유 자산을 대조한다. 원격 결과를 찾지 못하면 새 쓰기는 계속 차단하며 공급자 확인이 필요하다. 원본과 공급자 이미지 해시가 다르면 이미지 등록 결과도 자동 조정하지 못할 수 있다.
6. **새 이미지로 생성 준비**는 제출 완료 후에만 다음 작업을 준비한다. 원본 base64와 동의 증빙 참조는 작업 fence에 저장하지 않는다. 이 fence는 일반 시스템 설정 API로 덮어쓸 수 없다.

#### 커스텀 재생 검증

1. 목록 조회 후 선택된 Tavus 초안에 별도 **Tavus 실제 재생 점검**을 표시한다. `assets:read/write`와 7개 세션 lifecycle scope, AI 구성, worker·한도·정리 상태를 확인한다. Anam은 이 단계의 세션 대상으로 허용하지 않는다.
2. 비용 및 텍스트/녹음의 외부 AI 처리·생성 음성 전송에 동의한 뒤 세션을 명시적으로 생성한다. 서버는 현재 자산의 `providerAvatarId`를 읽어 `avatarAssetId`와 `purpose=validation`을 함께 전송한다. Stock 인물로 대체하지 않는다.
3. 기존 stock 테스트와 같은 구독 전용 LiveKit 수신 및 OpenAI 턴 테스트를 사용한다. 이 경로는 기존 시나리오·Gemini 실시간 음성·평가와 연결하지 않는다. 마이크는 동의한 진단 STT에만 보내고 아바타로 직접 게시하지 않는다.
4. 영상 트랙 구독만으로 검증하지 않는다. HTML video의 실제 프레임, 오디오 재생 준비, 해당 세션에서 성공한 테스트 턴, 운영자의 별도 영상 시청·음성 청취 확인이 모두 필요하다. 재연결·세션 전환 시 이전 증거를 폐기한다.
5. **재생 확인 보고**를 눌러야만 `/avatar-assets/{id}/live-validation`을 호출한다. 이는 **신뢰한 클라이언트의 관찰 보고이지 공급자의 독립 인증이 아니다.** 서버는 현재 자산·provider ID와 running/unexpired 세션을 확인하고, AvatarRouter는 원 소유자·동일 revision·완료된 audio command를 추가로 검증한다. 아직 오디오 작업이 완료되지 않으면 보고가 거절될 수 있다.
6. 검증 후 카탈로그만 갱신한다. Live 초안 저장과 학습자 활성화는 별개다. 상태 변경·삭제로 새 세션을 만들 수 없어도 소유 세션의 확인·종료는 유지한다. 페이지 이탈 종료는 best-effort이며 terminal 상태와 `cleanupPending=false`를 확인해야 종료 완료다.

내부 API prefix는 `/api/admin/personas/live-avatar/assets/:assetId/validation`이다. 기존 로그인 + admin/operator 권한과 no-store를 사용한다. `/preflight`, `/sessions`, `/sessions/:id`, `/sessions/:id/connection`, `/sessions/:id/turn`, `/sessions/:id/interrupt`, `/sessions/:id/end`, `/report`가 있다. 브라우저가 보낸 프로젝트 키·tenant·user ID·provider ID는 받지 않는다.

실제 커스텀 영상·음성 E2E와 시나리오 실행의 최종 수용 조건은 아직 미충족이다. 이 구현에서는 유료 세션이나 실제 미디어 전송을 실행하지 않았고, 일반 대화 라이브 연결도 계속 차단한다.

### 설정 화면의 실제 관리자 테스트

`/system-admin` → 설정 → 실시간 아바타 설정 → **라이브 아바타 관리자 테스트**.

- 패널을 열면 무료 인증·사용 한도·본인 세션 목록만 읽는다. 페이지 열기나 전역 스위치 변경으로 유료 세션을 생성하지 않는다.
- 기본 제공 **Tavus / Lucy**만 명시적으로 테스트한다. 개인 페르소나 이미지 업로드·학습·대체는 하지 않는다.
- `OPENAI_API_KEY`가 있는 경우에만 진단 AI가 준비된다. 마이크는 최대 15초 녹음 후 OpenAI `whisper-1`, 응답은 `gpt-4o-mini`, 음성은 `tts-1`의 24 kHz PCM을 사용한다. 기존 시나리오 엔진·모델·평가·실시간 음성 경로는 변경하지 않는다.
- 비용 동의와 텍스트/마이크의 OpenAI 처리 및 응답 음성의 AvatarRouter/Tavus/LiveKit 전송 동의를 확인한 뒤 **확인 후 테스트 세션 생성**을 누른다. 아바타 외에 AI 사용료가 발생할 수 있다. 개발자가 자동으로 유료 검증을 실행하지 않는다.
- 서버는 worker 준비, 정리 대기 0건, 프로젝트/전체 잔여 시간 각 120초 이상, 7개 lifecycle scope를 검사한다. 120초 예약은 달러 비용 상한이 아니다.
- HTTP 201은 queued일 뿐이다. `active/running`, `stopRequested=false`, `cleanupPending=false`를 확인한 후에만 짧은 subscribe-only LiveKit token을 받는다. 브라우저는 원격 영상·오디오를 구독하며 마이크를 LiveKit으로 게시하지 않는다.
- 영상과 오디오 트랙 및 오디오 재생 가능 상태가 확인되어야 대화 입력이 활성화된다. 자동 재생이 차단되면 **오디오 재생 허용**을 누른다. 텍스트 또는 녹음 후 전송 방식의 턴 기반 테스트이며 연속 Gemini 스트림은 아니다.
- 응답은 최대 15초, 요청당 5초 미만 PCM으로 나누어 at-most-once 전송한다. 타임아웃 audio/create를 자동 재전송하지 않는다. 세션당 최대 12턴이다. 대화와 토큰은 브라우저 메모리에만 두고 시나리오 대화 기록에 저장하지 않는다.
- 유료 생성 전 `live_avatar_test_attempt`에 pending fence를 저장한다. 응답이 불확실하면 새 세션을 막고 기존 본인 세션 목록과 대조한다. fence는 앱 재시작 뒤에도 남으며 일반 설정 API로 지울 수 없다. 새 원격 세션이 나타나지 않는 불확실 상태는 제공자 확인 없이 수동 해제하지 않는다.
- **테스트 중지**는 AI 작업을 취소하고 로컬 미디어를 먼저 해제한 후 interrupt/end를 요청한다. terminal 상태와 `cleanupPending=false`까지 확인하며, 확인 실패 시 경고와 재확인/종료 재시도를 남긴다.
- 새로고침·설정 탭 이탈은 인증된 best-effort end를 전송하지만 종료 보장은 아니다. 다시 열면 본인 활성/정리 대기 세션을 복구한다. 사용자 컨텍스트는 모든 요청에서 동일한 fresh 서버 파생 subject다.
- 모든 `/api/live-avatar/test/*` API는 기존 로그인 + 시스템 관리자 권한 + no-store를 요구한다. 일반 시나리오 flag와 독립된 관리자 진단이며 학습자에게 제공되지 않는다.

실제 유료 세션·마이크·제공자 미디어 E2E는 별도 실행 승인 없이는 검증하지 않는다. 단위·컴포넌트 테스트 통과를 실제 재생 성공으로 표현하지 않는다.

### 일반 시나리오 경로

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
