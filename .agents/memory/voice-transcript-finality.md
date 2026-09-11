---
name: Voice transcript finality
description: Realtime user transcript flushes and provider completions require different persistence semantics.
---

바지인, 재연결, 세션 종료 때문에 버퍼를 강제로 비울 때의 문자열은 보존해야 하지만 provider가 확정한 원문으로 취급하면 안 된다. 강제 flush는 provisional 상태로 같은 논리적 턴에 남기고, provider completion만 그 턴을 immutable final로 승격한다.

**Why:** 강제 flush 직후 더 완전한 provider completion이 도착할 수 있다. 부분 문자열을 먼저 final로 잠그거나 provider replay로 오인하면 실제 provider 원문이 영구적으로 저장되지 않는다. 페이지 종료 beacon과 서버 orphan 저장도 동시에 경쟁할 수 있다.

**How to apply:** provider event/item ID가 있으면 stable turn ID에 연결한다. Gemini처럼 ID가 없으면 명시적인 클라이언트 발화 시퀀스가 일치할 때만 provisional을 이어 붙이고, 임의의 다음 delta에는 절대 재연결하지 않는다. provider 재연결 때는 연결 세대를 올리고 이전 세대의 콜백을 거부하며, pending raw audio는 새 연결로 replay하지 않는다. provisional은 같은 턴에서 교체 가능하게 저장하고, final 이후의 stale/replay만 억제한다. 모든 직접·API 저장 경로는 동일한 identity-aware upsert 규칙을 사용한다.