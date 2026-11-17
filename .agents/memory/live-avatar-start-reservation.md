---
name: Live avatar start reservation safety
description: Validate and reserve the actor atomically; distinguish preparation failure from uncertain paid creation.
---

라이브 시작의 역할 판정과 대화 모드 예약을 분리된 비동기 단계로 확정하지 않는다.
외부 유료 요청 전 준비 실패는 일반 대화를 잠그지 않아야 하며, 이전 시도의 실제·불확실한 세션 기록은 보존한다.

**Why:** 페르소나 전환을 유료 생성 전에 거절하더라도 모드 예약만 남으면, 비용은 발생하지 않았는데 텍스트·음성 대화까지 사용할 수 없게 된다.

**How to apply:** 마지막 대상 검증과 예약은 같은 잠금 경계에서 처리한다. 새 시도의 요청 전 실패와 요청 후 결과 불명을 구분하고, 이전 시도의 결과 불명 상태를 새 시도의 준비 실패로 지우지 않는다.
