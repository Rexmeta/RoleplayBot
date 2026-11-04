---
name: Tavus Full Pipeline boundaries
description: 사용자가 지정한 독립 Tavus 모드와 공통 PAL 재사용 원칙
---

Tavus 라이브 아바타는 Gemini Live 음성을 중계하는 모드가 아니라 Tavus가 STT·LLM·TTS·Avatar·Lip Sync를 모두 처리하는 독립 모드로 유지한다. 기존 텍스트와 Gemini Live 모드는 보존한다.

**Why:** 사용자가 Tavus Full Pipeline을 별도 모드로 구현하도록 명시적으로 요청했다.

**How to apply:** Tavus 경로에서 Gemini Live WebSocket이나 AvatarRouter 오디오 중계를 추가하지 않는다. 기존 평가 로직은 유지하고 제공자가 확정한 전사 기록을 어댑터로 연결한다.

Tavus를 직접 연결하지 말고 이미 연결된 아바타 라우터를 통해 연결해야 한다.

**Why:** 사용자가 직접 Tavus 연결 대신 기존 아바타 라우터를 사용하라고 명시적으로 정정했다.

**How to apply:** RoleplayX에서 Tavus API 키를 요청하거나 Tavus REST API를 직접 호출하지 않는다. 기존 라우터의 서버 전용 프로젝트 키 경계를 재사용한다. PCM 렌더러와 STT·LLM·TTS 전체 파이프라인을 혼동하지 않고, 라우터의 Full Pipeline 계약이 확인되지 않으면 우회 호출 대신 지원 필요 상태를 표시한다.

페르소나별 PAL 생성 대신 고정된 공통 PAL 하나를 재사용하고, 시작할 때 페르소나 특성과 시나리오를 동적 컨텍스트로 전달한다.

**Why:** 사용자가 최초에는 공통 PAL 하나만 사용하고 불필요한 기존 스키마 변경을 피하라고 요청했다.

**How to apply:** 세션별 역할 변경을 위해 공유 PAL을 수정하지 않는다. 공통 PAL의 물리적 목소리 공유와 컨텍스트에 따른 말투·행동 차이를 구분하고, 실제 역할 유지나 미디어 품질은 모의 테스트로 검증됐다고 주장하지 않는다.
