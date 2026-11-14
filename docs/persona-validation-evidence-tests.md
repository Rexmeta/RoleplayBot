# 페르소나 검증과 첫 영상 시간 관측의 분리 검사

`tests/client/personaValidationEvidence.integration.test.tsx`는 실제
PersonaAvatarValidationPanel, AvatarTestSessionView, useAdminAvatarTest,
useAvatarTestRoom, useAvatarTestConversation, firstVideoFrame, AvatarSessionTiming을 함께 실행한다.
이 컴포넌트와 훅을 mock하지 않는다. 인증 사용자, API 응답, LiveKit transport와 미디어 프레임만 fixture다.

## 검증한 경계

1. 오디오 없이도 첫 프레임 시간 관측은 한 번 전송되지만 에셋 검증은 열리거나 자동 완료되지 않는다.
2. 트랙 준비, 처리 동의와 성공한 턴만으로 실제 영상 프레임을 대체할 수 없다.
3. 영상 프레임과 두 수동 확인만으로 새 성공 턴을 대체할 수 없다.
4. 성공한 턴과 프레임 후에도 두 수동 확인이 필요하다. 별도 보고 버튼을 누르기 전에는
   validation/report 호출, onReported 콜백, fixture 에셋의 validated 전환이 없다.
5. 시간 보고 실패와 에셋 검증 실패는 별도 문구로 동시에 표시될 수 있다.
   이 실패만으로 미디어를 종료하거나 유료 세션을 재생성하지 않는다.
6. 에셋 검증만 실패했을 때 시간 보고 실패로 잘못 표시하지 않는다.
7. 오디오 재생 준비를 잃으면 이전 확인을 해제하고 재개 후 새 프레임과 성공 턴이 필요하다.

## 재현

다음 파일을 함께 실행한 결과 **5개 파일, 47개 검사 통과**:

```sh
vitest run \
  tests/client/personaValidationEvidence.integration.test.tsx \
  tests/client/personaAvatarValidation.test.tsx \
  tests/client/firstVideoFrame.test.ts \
  tests/server/adminVideoTimingContract.test.ts \
  tests/server/personaAvatarOperations.test.ts
```

실행 환경에서는 fetch를 fail-closed로 감싸 외부 HTTP를 차단하고 loopback만 허용했다.
직접 브라우저 fetch도 fixture로 처리하며 새 유료 생성·실제 통화·운영 변경은 수행하지 않았다.
이 검사는 프레임·음성의 실제 제공자 수신이나 독립 청구/재생 인증을 증명하지 않는다.
실제 통화 검증은 별도 승인 범위다.

제품 소스는 변경하지 않았다. 전체 앱 타입 검사와 빌드를 다시 성공으로 주장하지 않는다.
상위 변경에서 확인한 nanoid 및 소개 이미지 누락 문제는 별도 수정 과제에 남아 있다.
