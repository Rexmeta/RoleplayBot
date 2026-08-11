---
name: Android Chrome 출력 기기 열거 미지원
description: setSinkId 지원 여부와 audiooutput 열거 지원 여부는 별개 — 모바일 Chrome은 전자만 지원
---

Android Chrome은 `AudioContext.setSinkId()`를 지원하지만 `enumerateDevices()`에 `audiooutput` 항목을 제공하지 않는다(데스크톱 Chrome만 출력 열거 지원). 그래서 마이크 권한을 허용해도 출력 목록은 계속 비어 있다.

**Why:** "목록이 비어 있음 = 권한 미허용"으로 해석하면 사용자에게 권한 요청 버튼을 무한 반복 노출하는 잘못된 UX가 된다. 실제로 사용자가 "기본 출력 기기만 보인다"고 보고한 원인.

**How to apply:** 권한 허용 여부는 `enumerateDevices()` 결과에서 **아무 종류의 기기든 라벨이 보이는지**로 판별한다(마이크 라벨 포함). 라벨이 보이는데 출력 목록이 비어 있으면 "권한 필요"가 아니라 "브라우저가 출력 열거를 미지원" 상태로 처리하고, OS 미디어 출력 전환(Android 알림창 미디어 출력, iOS 제어 센터) 안내를 보여준다. iOS Safari는 setSinkId 자체가 없어 별도의 unsupported 경로.

추가: Android Chrome은 마이크 **입력 소스** 라벨에 출력 모드 이름("스피커폰"/"Speakerphone")을 붙인다. 사용자가 마이크 목록을 출력 목록으로 오인해 "마이크/출력 버튼이 뒤바뀌었다"고 보고한 실제 사례가 있음 — 이런 라벨은 휴대폰 내장 마이크로 분류하고, 입력/출력 UI에 각자 역할 설명 문구를 넣어 구분한다.
