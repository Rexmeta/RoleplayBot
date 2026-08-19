---
name: iOS realtime audio routing
description: WebKit 실시간 음성 세션에서 Bluetooth 입출력 경로를 안정적으로 유지하는 규칙
---

iOS의 실시간 양방향 음성 대화는 `AudioContext` 또는 `getUserMedia`를 만들기 전에 Audio Session을 `play-and-record`로 설정하고, 대화가 끝날 때까지 유지한다. 종료 후에만 `auto`로 복원한다. `setSinkId`가 없는 iOS에서는 앱 출력 장치 ID를 저장하거나 강제하지 않고 현재 iOS 시스템 경로를 사용한다.

**Why:** WebKit이 재생 컨텍스트를 먼저 만들면 본체 스피커 경로에 묶일 수 있고, 통화 중 프로필 변경은 Bluetooth 헤드셋의 마이크·스피커 경로를 분리할 수 있다. 늦게 도착한 이전 연결 이벤트가 새 통화의 세션을 해제하는 경합도 방지해야 한다.

**How to apply:** 연결, 마이크 획득, 백그라운드 복귀 전에 통화 프로필을 재확인하고, 종단 연결 해제에서만 해제한다. 비동기 연결 콜백은 현재 연결 소유권을 검사한다. iOS가 개별 입력을 노출하지 않으면 빈 장치 ID로 시스템 기본 입력을 사용한다.