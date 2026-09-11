---
name: Realtime voice turn finalization
description: Rules for ending a user turn promptly when local VAD gates microphone audio, and for safe noise-floor recalibration.
---

로컬 VAD가 비활성 구간의 PCM 전송을 중단하는 구조에서는 provider VAD가 충분한 후행 무음을 받지 못할 수 있다. 짧은 debounce 동안 발화가 재개되지 않으면 명시적으로 end-of-turn을 보내고, provider가 먼저 final 또는 응답 오디오를 보냈다면 예약된 end-of-turn을 취소한다.

**Why:** 무음 전송만 멈추고 턴 종료를 보내지 않으면 provider가 사용자의 발화가 끝났음을 확정하지 못해 페르소나 응답이 수십 초 멈출 수 있다. 반대로 provider 완료 뒤 늦은 end-of-turn은 중복 응답을 만들 수 있다.

**How to apply:** VAD end마다 현재 speech sequence를 캡처해 debounce하고, 같은 sequence가 유지될 때 한 번만 commit한다. 재보정은 발화·재생 중 시작하지 말고, 측정 중 activity epoch나 capture generation이 바뀌면 결과를 폐기해 실제 목소리를 noise floor로 저장하지 않는다.