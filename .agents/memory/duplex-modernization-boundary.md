---
name: Duplex 개선의 보존 범위
description: 실시간 Duplex·캐릭터 동기화 고도화에서 유지해야 할 기존 제품 기능
---

기존 RoleplayBot의 음성 대화, 감정 분석, 시나리오 시뮬레이션, 평가 기능을 유지하면서 실시간 Duplex 대화와 캐릭터 표정·감정 동기화를 고도화한다.

**Why:** 사용자가 고도화의 목적과 기존 기능 보존 범위를 명시했다.

**How to apply:** 새 음성/캐릭터 기술을 검토할 때 기존 엔진 교체를 전제로 삼지 말고 네 기능의 연속성과 회귀 검증을 개발 범위에 포함한다.

CharacterEmotion의 권위는 서버에 두고 클라이언트는 재생 상태에 따른 표정 표현 시점을 결정한다. UserAffect, CharacterEmotion, ScenarioState, ExpressionPresentation, AudioPlayback을 분리하며 기존 Simulation Engine 상태를 복제하거나 변경하지 않는다.

**Why:** 사용자가 상태 권위와 책임 분리를 추가 완료 기준으로 명시했다.

**How to apply:** 감정 revision·Persona generation과 출력 세대를 검사하고, 재생 관측을 물리적 청취나 외부 경로의 확인되지 않은 완료로 해석하지 않는다.

평가 작업 생성 시 Ledger 버전 또는 watermark에 고정된 불변 입력을 사용한다. 기능 플래그 의존성을 검증하고 세션 시작 시 동작 모드를 고정하며 기존/신규 경로를 유지해 단계별 롤백을 지원한다.

**Why:** 사용자가 평가 확정 시점, 세션 동작 고정, 롤백을 요구했으며 구현만으로 모델 품질이나 교육 효과 개선을 주장하지 않도록 명시했다.

**How to apply:** 작업 재시도·늦은 이벤트·재연결에서도 고정된 입력과 세션 모드를 유지하고, 기준선 대비 실측과 모델 품질·교육 효과 검증을 분리한다.
