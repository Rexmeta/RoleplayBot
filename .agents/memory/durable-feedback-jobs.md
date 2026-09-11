---
name: Durable feedback jobs
description: Feedback generation ownership, completion acknowledgement, and publication consistency rules
---

대화 완료 경로는 성공 응답을 보내거나 Agent 세션을 ended로 저장하기 전에 피드백 작업이 DB에 지속 등록됐는지 확인해야 한다. 동일 대화의 worker claim과 결과 publish는 작업 토큰으로 fence하며, 리포트 저장과 completed 상태 전환은 하나의 트랜잭션이어야 한다.

**Why:** 등록 실패 전에 완료를 확정하면 재시도가 이미 끝난 대화로 처리되어 작업 없는 성공 응답이 가능하다. 오래된 worker가 나중에 끝나면 force 재생성 결과를 덮어쓸 수도 있다.

**How to apply:** 새 대화 완료 진입점이나 피드백 재생성 경로를 추가할 때 공용 durable enqueue를 사용하고, enqueue 실패 시 완료 상태를 확정하지 않는다. 결과 저장 전 현재 작업 토큰을 다시 검증한다.