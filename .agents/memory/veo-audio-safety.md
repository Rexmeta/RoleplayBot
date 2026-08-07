---
name: Veo 오디오 안전 필터
description: Veo 3 아바타 클립이 "issue with the audio for your prompt"로 실패할 때의 원인과 유일한 회피 수단
---

Veo 3는 요청하지 않아도 오디오를 함께 생성한다. 프롬프트에 오디오 지시가 없으면 모델이 임의의
사운드(사람 목소리 포함)를 만들다가 안전 필터에 걸리고, **영상 전체가 반환되지 않는다**
(에러 문구: "We encountered an issue with the audio for your prompt").

규칙: 사람이 등장하는 클립 프롬프트에는 항상 오디오 내용을 명시한다.
조용한 실내 앰비언스 + "no human voices / no speech / no music" 수준이면 충분하다.
입이 움직이는 클립(speaking)은 "no audible speech or voice"를 추가로 못 박아야 모델이
음성 트랙 합성을 시도하지 않는다.

**Why:** 설치된 Gemini SDK는 `config.generateAudio`를 설정하면 즉시 throw한다. 즉 오디오를
끄거나 제어할 API 파라미터가 없고, **프롬프트 텍스트가 유일한 제어 수단**이다.

**How to apply:** 오디오 필터로 클립이 통째로 실패하면 위 문구를 프롬프트 끝에 붙여 본다.

**단, 현재 프로젝트 결정은 "오디오 문구 없음"이다.** 아바타 클립은 재생 시 항상 muted이고,
사용자가 프롬프트에 배경음 지시가 들어가는 것을 원하지 않아 관련 문구를 전부 제거했다.
따라서 오디오 힌트는 안전 필터 오류가 실제로 재발할 때만 되살릴 후보이며, 임의로 다시
넣지 않는다. 리스닝 프롬프트 문구도 사용자가 직접 지정한 것이므로 마음대로 보강하지 않는다.
