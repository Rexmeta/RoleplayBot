# 문화 행동 실험: 입력 및 자동 채움 검증

## 재현 범위와 결과

- 실제 `/admin-management?tab=culture-map` 화면을 Chromium으로 열고 실제 관리자 탭·Culture Map 하위 탭과 형제 패널을 사용했다. 인증 응답과 API는 브라우저 요청 가로채기로 모의 처리했다. 앱 인증 우회 코드나 실제 관리자 계정을 추가하지 않았다.
- 정상 대기 상태에서 다섯 텍스트 입력, 프로필 선택, 강도, 반복 횟수, Tab 키 포커스, 탭 복귀 후 값 보존을 확인했다. 보고된 정상 상태의 입력 불가는 재현되지 않았다. 특정 오버레이나 브라우저가 원인이라고 단정하지 않는다.
- 비교 요청을 응답 없이 보류하면 fieldset이 잠긴 채 유지되는 경로를 재현했다. 기존 요청에는 클라이언트 대기 기한이 없었다. 이제 180초 후 요청 대기를 중단하고 편집을 복구한다. 서버에서 이미 시작한 실행·비용이 취소됐다고 주장하지 않는다.
- 브라우저에서 명시적 자동 채움, 덮어쓰기 취소, 적용 후 직접 편집, 반복 횟수·Provider 동의 유지, Mock 비교, 생성·비교 실패 후 편집과 이전 결과 보존, 보류 요청 시간 초과 후 편집을 확인했다.
- 브라우저 검사에서는 API를 모의 처리했으므로 실제 인증 서버의 관리자 로그인이나 실제 AI 품질을 검증한 것은 아니다. 서버 권한과 실제 SDK 요청 구조는 별도 자동화 테스트로 검증한다. 실제 유료 AI 호출·운영 데이터 변경·배포는 하지 않았다.

## 자동화 검사

```sh
npx vitest run tests/client/cultureExperiment.test.tsx \
  tests/client/adminCultureExperiment.integration.test.tsx \
  tests/client/cultureMapWorkspace.test.tsx \
  tests/server/cultureExperimentRoute.test.ts \
  tests/server/cultureExperiment.test.ts \
  tests/server/cultureExperimentProviders.test.ts
npm run check
```

생성 API는 인증·관리자 보호, 빈 프로필, 잘못된 요청·JSON·길이·강도·프로필 ID·버전, 생성 후 프로필 변경, 중복 생성·비교, 제공자 실패·시간 초과 후 재시도를 검사한다. SDK는 모의 처리하되 Gemini/OpenAI/OpenRouter의 모델 및 취소 신호 전달을 확인한다. 기존 Mock 무호출·Provider 별도 동의·OFF 기준·고정 상황 경계도 유지한다.

전체 완료 검증에서는 기존 `culturePersonaIsolation.test.ts`가 현재 응답의 `liveAvatarSeed: null`을 기대하지 않아 실패했다. 완료 검증을 통과시키기 위해 seed가 없는 두 사례의 기대값에 명시적 null을 추가했다. 아바타 기능이나 데이터는 변경하지 않았다.

## 동작 제한

- 자동 채움은 45초, 브라우저 응답 대기는 50초다. 취소·시간 초과도 이미 발생한 AI 비용을 환불하거나 청구를 차단하지 않는다.
- 중복 생성·비교 제한은 기존 라우터와 같은 서버 프로세스 단위다. 여러 서버 인스턴스 사이의 전역 잠금은 제공하지 않는다.
- 자동 채움은 설정된 conversation 텍스트 정책을 strict 모드로 사용한다. 지원되지 않는 정책·제공자 오류를 다른 모델이나 고정 샘플로 대체하지 않는다.
