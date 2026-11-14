# AvatarRouter 영상 준비·첫 보고 이후 시간

## 적용 범위

이 변경은 RoleplayX main 기반의 신규 공통 브라우저 클라이언트 경로
(`TavusChatWindow → ManagedAvatarRoom`, Tavus/Anam full pipeline)에 연결한다.
기존 로그인, 대화 소유권, 프로젝트별 서버 전용 API 키와 사용자 컨텍스트는 유지한다.
브라우저에 Gemini/Tavus/Anam 또는 AvatarRouter 프로젝트 API 키를 전달하지 않는다.
관리자 stock/Anam 테스트 및 페르소나 커스텀 검증에도 같은 관측을 연결한다.
기존 Daily 실제 대화 경로는 첫 프레임을 추정해 보고하지 않는다.

### 관리자·페르소나 진단

- stock: POST /api/live-avatar/test/sessions/:id/video-playing
- Anam: POST /api/live-avatar/stock/anam-persona-default/test/sessions/:id/video-playing
- custom: POST /api/admin/personas/live-avatar/assets/:assetId/validation/sessions/:id/video-playing

본문은 아래 실제 대화 경로와 동일한 단일 event만 허용한다.
관리자 테스트는 기존 시스템 관리자 권한, custom은 기존 운영자/관리자 권한을 유지한다.
사용자·tenant는 기존 서버 프로젝트 클라이언트가 결정하며 ID, provider/avatar 및 custom asset/purpose를 전후 검증한다.
영상 관측은 live-validation 완료 보고와 별개다. 음성 전송·생성·종료·에셋 검증을 호출하지 않는다.
보고 실패는 별도 경고만 표시하고 2초 상태 조회로 전달된 서버 timing을 표시한다.
stock/custom 영상은 실제 프레임 콜백 또는 advancing media time을 한 번 관측한다.
트랙 구독, DOM playing, ready/token만으로 보고하지 않으며 이미 보고한 동일 세션은 연결 재시도에서도 다시 시도하지 않는다.
Anam은 공통 ManagedAvatarRoom/SDK의 같은 첫 프레임 옵션을 사용한다.
과거 timing 없는 세션은 영상 보고 없음으로 남는다. 종료 시각과 예산·cleanup을 추정 변경하지 않는다.

## 인증된 프록시

브라우저는 기존 쿠키 로그인으로 다음 요청만 보낸다.

```http
POST /api/tavus/conversations/:runId/video-playing
Content-Type: application/json

{"event":"video_frame_presented"}
```

서버는 동일 출처, 로그인, 대화 소유권, 현재 프로젝트, `sessions:connect`와
서버에 보존된 세션·제공자·아바타 연결을 확인한다.
클라이언트가 세션 ID, tenant, 시각, 기간을 지정하거나 추가 필드를 보내면 거절한다.
서버만 바인딩된 ID로 AvatarRouter `POST /sessions/:id/video-playing`을 전달한다.
응답은 `private, no-store`이며 upstream 원시 오류·키·연결 토큰은 반환하지 않는다.

## 실제 영상과 실패 처리

`ManagedAvatarRoom`은 공통 SDK에 `reportVideoPlaying`/`onTimingReport`를 연결한다.
토큰 발급, `connected`, `playing` 상태 문자열만으로 보고하지 않는다.
SDK의 실제 프레임 콜백 이후 보고하며, 같은 연결의 중복 호출도 하나의 Promise로 묶는다.
보고 실패 후 자동 재시도·세션 생성·interrupt·end를 호출하지 않는다.
실패는 재생 오류와 별도로 시간 보고 안내에 표시한다.
종료/만료 등 기존 세션 수명 관리는 변경하지 않는다.

## 화면과 기록

기존 `GET /api/tavus/conversations/:runId/session`은 검증된 router `timing`을 보존해 전달한다.
대화 화면에는 다음을 구분해 표시한다.

- 라우터 경과: `routerElapsedSeconds`
- 첫 보고까지 준비: `preparationSeconds`
- 첫 영상 보고 이후: `connectedSeconds`
- `not_reported`/과거 기록/구버전 서버: `—`, 영상 보고 없음. 과거 시간을 복원하지 않는다.

수치는 서버가 인증된 클라이언트 보고를 받은 시각 기준이다.
발화·연속 재생·사용자 청취·제공자 청구 시간이 아니며 중간 멈춤을 포함한다.
로컬 시계로 연결 시간을 늘리지 않는다. 종료된 로컬 기록의 마지막 확정 값은 유지한다.
늦게 도착한 보고 응답은 대화 상태를 다시 활성화하지 않는다.
예산·예약·정리 차단·평가 및 transcript 권한에는 영향을 주지 않는다.

## 공개 전 조건 및 검증 한계

AvatarRouter API/Worker의 nullable 시간 컬럼과 `session_video_timing_v1` 계약 및 새 SDK가 먼저 필요하다.
구형 SDK는 새 옵션을 호출하지 않으므로 `not_reported`로 남을 수 있다.
설정 확인이나 API 200만으로 실제 영상 성공을 주장하지 않는다.
운영 적용은 이 소스의 검토·병합·별도 게시 후 이루어진다.
이 작업은 실제 유료 통화·제공자 생성·운영 데이터 변경·게시를 실행하지 않았다.

검증: 관리자·페르소나·실제 대화 세션 프록시/공통 클라이언트/시간 표시 관련 203개 fixture 테스트 통과.
전체 타입 검사는 기존 `server/vite.ts`의 `nanoid` 누락으로 실패했고,
전체 Vite 빌드는 기존 소개 카드 이미지 파일 누락으로 실패했다.
이 변경은 그 의존성과 이미지 파일을 수정하거나 전체 빌드 성공을 주장하지 않는다.
