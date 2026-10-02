# 페르소나 음성 끊김 원인 검증

작성: 2026-10-02. 범위: 실시간 출력 PCM 전달·예약·중단·완료 경계. **특정 사용자 장애의 근본 원인은 미확인**이다. 운영 설정, AGC, jitter buffer, VAD/바지인 정책, 모델 선택, 배포를 변경하지 않았다. 유료 API/부하 시험과 사용자 녹음을 수행하지 않았다.

## 1. 핵심 결론과 증거 등급

|구분|확인된 코드 동작|결정론적 재현|실제 세션 관찰|미확인 사항|
|---|---|---|---|---|
|도착 지연/버퍼 고갈|`max(context.currentTime, nextPlayTime)`로 청크 예약. 초기·재버퍼링 여유 없음|200ms 청크 뒤 864ms에 다음 청크를 주면 예약 사이 664ms 공백. 선행 버퍼가 있으면 공백 없음|최근 로그에 가변 크기·burst 도착 있음. 아래 초기 근거 정정 참고|장애 브라우저의 수신·예약·청취 공백, provider/서버/네트워크 중 지연 위치|
|취소 후 잔여 오디오 재개|취소가 로컬 turnSeq를 올리고 ready 전송. 다음 수신은 로컬 번호 비교만으로 interruption 해제|취소→86ms→동일 합성 잔여 bytes가 새 로컬 턴 번호로 전달됨. top/inline 모두 재현|12:36:05.413Z 취소 뒤 .499Z에 같은 해제 경로 실행|그 bytes가 실제 잔여 provider 턴인지 진짜 새 응답인지|
|공급자 완료/재생 완료 불일치|response.done이 재생 플래그를 끄지만 source를 stop하지 않음|3×200ms burst가 예약된 상태에서 done 수신: 최대 600ms 예약 꼬리 유지, 플래그 false. ended callback 후 source 제거|provider turnComplete 로그는 있음. 브라우저 ended 증거 없음|실제 꼬리 길이, 이 구간 바지인 실패 빈도|
|소스 전환 시 청크 누락|같은 프레임 inline 우선. 한 턴에서는 먼저 사용한 소스 반대쪽을 내용 비교 없이 버림|서로 다른 합성 bytes의 top→inline / inline→top 전환에서 두 번째 청크 누락. 같은 프레임 동일 bytes는 정상 1회 전달|같은 프레임 top 건너뜀 로그 반복. 검색 표본에는 cross-frame dedup 로그 없음|SDK가 운영에서 다른 내용을 소스 전환으로 전달했는지|
|VAD 오탐|입력 RMS 임계치 초과가 300ms 유지되고 재생 플래그 true이면 취소. 소리 출처를 구분하지 않음|기존 VAD 테스트의 합성 임계치/지속시간 시험 재사용|서버 취소 관찰만으로 사용자의 의도/에코를 구별할 수 없음|스피커 에코·잡음·사용자 발화 구분, AEC·기기 조건|
|왜곡/음량 상승|AGC 후 ±1 hard clip, 그 뒤 compressor|기존 합성 결과를 인용, 재구현하지 않음|실기기 청취 없음|왜곡이 끊김으로 지각됐는지, OS/Bluetooth 영향|

이번 시험은 **현재 동작의 characterization**이다. 성공한 테스트가 결함 수정이나 실제 청취 품질 개선을 의미하지 않는다. 승인 후 수정 작업은 결함을 재현한 기대값을 정상 동작 기대값으로 바꿔야 한다.

## 2. 최신 로그 대조와 초기 근거 정정

배포 메타데이터 읽기 결과: 공개 Autoscale, 성공 build 있음. 그러나 조회에 배포 revision/소스 SHA가 없어 현재 코드와 운영 build의 동일성은 **미확인**이다. 조사 작업 트리 기준 HEAD는 `a00c614f9e70e394aa800f9a7da97d0f2df0c042`이다. 실제 운영 소스 일치 여부의 증거로 사용하지 않는다. 현재 코드와 부분 로그에 같은 분기 문구가 있다는 사실만 확인했다.

읽기 전용 로그 검색 범위: **2026-10-02 12:35:55–12:36:20 UTC**. audio 길이·취소·턴 증가·완료·소스 건너뜀 패턴으로 좁혀 조회했다. 기존 동시 장애 보고서의 quota/close/AGC 증거를 재사용했고 부하 도구는 다시 만들거나 실행하지 않았다. 이 시각이 사용자가 말한 장애 시각인지, 검색 사건이 모두 같은 세션인지 미확인이다.

### 정정: “다음 청크까지 864ms”는 현재 검색 결과로 성립하지 않는다

12:36:09.956Z에 base64 12,800자 청크가 있지만, 12:36:10.820Z 전에 다음 청크들도 검색된다.

|UTC|inline base64 길이|24kHz/mono/PCM16으로 환산한 길이|
|---|---:|---:|
|12:36:09.956|12,800|200ms|
|12:36:10.002|10,240 (2개 로그)|각 160ms|
|12:36:10.038|12,800|200ms|
|12:36:10.103|15,360|240ms|
|12:36:10.113|2,560|40ms|
|12:36:10.192 / .203|각 10,240|각 160ms|
|12:36:10.234|7,680|120ms|
|12:36:10.369 / .514 / .659|20,480 / 15,360 / 35,840|320 / 240 / 560ms|
|12:36:10.820|33,280|520ms|

길이 환산은 `bytes = base64Length × 3/4 − padding`, `duration = bytes / (24000 × 2)`이다. 위 표 길이는 padding 없는 수치다. 세션 식별이 없으므로 이 표를 하나의 실제 브라우저 버퍼로 합산하지 않는다. 또한 서버 수신 로그 시각은 브라우저 도착 시각이 아니다. **664ms는 아래 합성 지연 조건의 재현 수치로만 남긴다. 실제 장애 무음 길이 추정은 철회한다.**

### 취소 근처 관찰

- 12:36:05.413Z: turn 18 취소, 로컬 번호 19로 증가.
- 12:36:05.499Z: `turnSeq=19 > cancelledTurnSeq=18`만으로 inline interruption 해제. 취소 후 86ms.
- 12:36:05.499 / .500 / .612 / .695Z: inline 길이 23,040 / 10,240 / 17,920 / 15,360.
- 12:36:05.825Z: turnComplete, 로컬 번호 20. .499Z에 해제한 사건보다 뒤에 있는 완료지만 세션별 provider 경계는 확보하지 못했다.

새 provider 턴을 입증하는 응답 식별자가 없다. “잔여 오디오일 가능성이 있는 해제 경로가 실행됐다”까지 확인 가능하며, “실제로 옛 음성이 재생됐다”는 미확인이다. 검색된 같은 프레임 top/inline 건너뜀은 SDK의 중복 노출을 정상 제거했을 수 있다. 이를 오디오 유실 증거로 사용하지 않는다.

## 3. 결정론적 재현과 측정 결과

실제 `useAudioPlayback` 훅에 합성 24kHz PCM을 넣고 AudioContext 시각·source.start·ended를 모의했다. 결과: `results/output-timing.json`. 디지털 예약 수치이며 real-time OS 스케줄링이나 스피커 측정이 아니다.

|조건|청크 도착(ms)|청크 길이(ms)|예약 공백 합계|예약 대기/해석|
|---|---|---|---:|---|
|연속|0, 200, 400|200, 200, 200|0ms|기존 예약이 도착 간격을 충족|
|burst|0, 0, 0|200, 200, 200|0ms|대기 0/200/400ms, 끝 600ms|
|지연|0, 864|200, 200|664ms|두 번째 예약 시작 864ms|
|큰 첫 청크|0, 864|400, 200|464ms|청크 길이가 같은 지연의 공백을 바꿈|
|작은 청크|0, 100|20, 20|80ms|작은 공급 지연도 고갈 가능|
|선행 burst 뒤 지연|0, 0, 500|400, 400, 20|0ms|세 번째는 300ms 대기; 도착 간격만 보고 고갈로 분류하면 오판|
|짧은 말끝|0, 180|200, 20|0ms|마지막 20ms도 200–220ms에 예약|

별도 저장 출력 장치 적용을 75ms 동안 모의 지연시킨 시험에서 첫 청크 처리 대기 75ms, 다음 청크의 직렬 큐 대기 75ms가 관찰됐다. 청크 순서는 유지됐다. 이 값은 `setSinkId`의 실기기 지연 측정이 아니다.

### 완료 경계

`voiceOutputTimeline.test.ts`는 **실제 useRealtimeVoice + useAudioPlayback 훅**을 함께 실행하고 WebSocket/AudioContext만 모의한다. 600ms 예약 오디오를 가진 상태에서 done 수신 후:

1. UI speaking 및 VAD에 전달되는 `isActuallyPlayingRef`가 false가 됨.
2. source.stop 호출은 0회, 3개 예약 source가 남음.
3. 모의 currentTime=.6에서 ended callbacks를 실행해야 제거됨.

따라서 공급자 생성 완료와 예약 오디오 소진은 다른 상태다. WebAudio `onended`도 기기 DAC/Bluetooth까지 소리가 전달됐다는 증거가 아니다. 출력 latency와 OS routing은 별도다.

### 중단과 전달 경계

실제 서버 clientMessageHandler로 취소하고 86ms 뒤 실제 Gemini handler에 기존 합성 bytes를 넣었다. provider turnComplete나 새 사용자 입력 없이도 새 로컬 번호로 전달되고 interruption이 해제됐다. 정상 새 bytes도 같은 gate를 통과하므로 **현재 gate로는 둘을 판별하지 못함**이 확인됐다. 실제 브라우저 훅은 예전 turnSeq=18을 거절하지만 ready=19 뒤 19로 다시 표시된 잔여 bytes를 수용한다.

서로 다른 내용의 두 청크를 소스만 바꾸어 전달한 경우 둘째 청크가 버려졌다. 같은 소스의 연속 청크는 둘 다 전달됐고 같은 프레임 동일 top/inline bytes는 1회만 전달됐다. 합성 fixture에서만 내용 차이를 알고 있으며 새 진단은 오디오 원문·해시를 보관하지 않는다.

## 4. 제한된 출력 타임라인 진단 사용법

**기본 비활성. 명시적 수동 opt-in만 허용. 한 WebSocket 연결에 한정. 자동 재접속은 재활성화하지 않는다.** 새 브라우저 진단은 메모리에만 저장하고 console/DB/파일/서버 업로드를 하지 않는다. 서버는 요청된 연결에만 작은 숫자 메타데이터를 보내며 일반 로그를 추가하지 않는다. 운영에 배포하거나 실세션을 새로 실행하지 않았다.

운영자 또는 개발자가 동의받은 테스트 기기에서 개발자 도구로:

```js
// 음성 연결 시작 전에 1회 실행
window.voiceOutputDiagnostic.armNextSession()
// 테스트용 음성 연결을 시작하고 짧은 대화를 수행
window.voiceOutputDiagnostic.snapshot()
// 중단/추가 기록 방지. 저장은 명시적 수동 export만.
window.voiceOutputDiagnostic.stop()
```

페이지를 새로고침하면 메모리가 사라진다. 연결 종료는 기록을 정지하며 snapshot은 그 페이지에서만 남는다. 연결 시작 전에 취소하려면 stop을 실행한다. `armNextSession`은 이미 활성화된 trace를 정지한다. 기본 브라우저/서버 로그는 이전부터 개인정보가 있을 수 있으므로 **전체 콘솔/네트워크 dump를 보내지 말고 snapshot과 필요한 메타데이터만** 공유한다.

### 한도·비용·오류 격리

- 브라우저: 60초 또는 600개 행 중 먼저 도달한 시점에 기록 종료. 초과 행을 계속 저장하거나 원문을 보관하지 않음.
- 서버: 같은 연결에서 60초 또는 **총 200개 추가/첨부 메타데이터 이벤트** 중 먼저 도달하면 종료. 반복 ready로 갱신 불가. 오디오별 후보 frame 1개와 기존 audio.delta에 첨부 1개가 보통 2개 예산을 사용한다.
- 활성 중에도 PCM 재디코딩/샘플 순회/내용 hash/재생 timer를 추가하지 않는다. 길이, 번호, 기존 AudioContext 시각만 측정한다. 추가 전송량이 0인 진단은 아니며 유한한 소량 메타데이터 전송 비용이 있다.
- 기본 비활성 경로는 추가 네트워크 이벤트·clock 측정·로그·타이머가 없다. 작은 observer 조건문과 optional ref 검사만 남는다.
- 서버 진단 전용 전송 실패는 catch하고 원래 오디오 처리를 계속한다. malformed PCM/브라우저 resume 실패는 숫자 error reason으로 남기되 기존 처리 정책을 유지한다.
- 클라이언트에서 stop해도 이미 켠 서버 예산을 되돌리는 메시지를 추가하지 않는다. 서버는 기존 60초/200개 한도 또는 연결 종료까지만 메타데이터를 보낼 수 있다.
- browser·wire cap에 걸린 뒤 후보만 있고 accepted가 없는 마지막 행은 유실 증거가 아니다. 항상 `active`, 행 수, 예산 경계를 확인한다.

### 필드와 시간 해석

|필드|해석|
|---|---|
|frameSeq / chunkSeq|서버 연결 내 provider 메시지/전달 청크 번호. 실제 provider response ID 아님|
|turnSeq / cancelledTurnSeq / expectedTurnSeq / providerGeneration|로컬 논리 턴·취소·클라이언트 예상 번호와 provider 연결 세대. 실제 새 provider 턴 여부는 이 숫자만으로 확정 금지|
|providerAtMs / serverAtMs|서버 Date.now UTC: SDK handler 진입/전송 직전. provider 생성 시각 아님|
|atMs / arrivalGapMs|브라우저 performance.now 기반 연결 내 상대 시각·수신 간격|
|contextTimeMs / startMs / endMs|AudioContext 시계로 읽은 현재/예약 시작/예정 끝. 실제 스피커 시작 이벤트 아님|
|durationMs / base64Length / topLength / inlineLength / inlineCount|PCM 길이와 후보 소스 크기. 원문/내용 hash 없음|
|bufferedMs / gapMs|처리 시점 이전 예약 끝과 currentTime 차이. 첫 청크 gap=0. underrun 수치는 같은 응답/연결의 연속 청크에서만 비교; 긴 턴 사이 정상 무음 제외|
|queueWaitMs / processingMs|브라우저 직렬 promise 큐 대기 / 초기화·resume·디코딩 포함 처리. CPU 점유시간과 동일하지 않음|
|pendingSources / actuallyPlaying|예약 node 수와 앱 플래그. 스피커 출력 검출 아님|
|source|0 미선택, 1 top, 2 inline. provider-frame에서는 처리 전 선택 상태, 전달 metadata에서는 처리 후 상태|
|contextState / outputSelected|1 running / 2 suspended / 3 그 외; 특정 sink 선택 여부만 숫자로 저장. 장치 ID·라벨 없음|
|reason|1 local stop, 2 interrupted drop, 3 초기화 후 취소/컨텍스트 없음, 4 resume 실패, 5 재생 예외, 6 명시적 disconnect, 7 old-turn drop, 8 socket close, 9 서버 interruption, 10 local VAD cancel|

서버 UTC와 브라우저 performance/AudioContext 시계는 직접 빼지 않는다. 서버 내부 `serverAtMs-providerAtMs`, 브라우저 내부 수신 간격·큐 대기와 frameSeq/chunkSeq로 상관한다. 네트워크 편도 지연을 산출하려면 별도의 시계 정렬/왕복 측정이 필요하며 이번에는 추가하지 않았다.

provider-frame 후보 크기와 대응 audio.delta chunkSeq를 비교해 전달 여부를 조사한다. 억제/생각 텍스트/소스 중복 때문에 전달되지 않은 후보를 곧바로 내용 유실이라고 부르지 않는다. 원문 없는 현재 trace는 서로 다른 bytes인지 판별하지 못하며 합성 테스트가 그 조건을 검증한다. OpenAI 경로는 브라우저 타임라인만 제공하고 **Gemini 전용 서버 observer와 같은 provider 수신 정보는 제공하지 않는다**.

## 5. 실제 기기 증거 수집·검증 절차

현재 확보하지 못한 필수 항목:

1. 장애 날짜/시각/시간대와 ±2분 범위, 실시간 음성인지 TTS인지, 선택 모델, 새 시작/재연결/페르소나 전환 여부.
2. OS·브라우저 버전, PC/Android/iPhone 구분, 스피커/유선/BT 종류, OS 음량 변경·장치 연결/해제, 통화 프로필 변화.
3. 앱 전경/백그라운드·화면 잠금, AudioContext state, 네트워크 전환, 최초 출력/말끝/사용자 무발화 때 끊김 여부.
4. 실행 서비스·인스턴스 별칭·배포 revision/build SHA·관련 로그. 모델 기본값만 보고 실제 세션 선택 모델로 기록하지 않는다.

검증 순서(유료 실 API는 별도 승인):

- 테스트 참가자 동의 후 한 세션만 진단 arm, 10–30초 동안 메타데이터 수집. 음성/전사를 녹음하지 않는다.
- 이어폰에서 사용자 무발화 응답 → 스피커에서 같은 조건 → 의도적 사용자 바지인 순서로 비교. 조건별로 새 trace를 명시적으로 켠다. 동일 사용자 발화 내용은 수집하지 않는다.
- 사용자 무발화인데 reason=10→stop이면 VAD 오탐 후보. 실제 사람이 발화했는지 관찰자가 확인해야 하며 RMS만으로 에코 확정 금지.
- 수신 간격이 늘지만 선행 bufferedMs가 충분하면 고갈 아님. 동일 턴의 gapMs>0이면 예약 고갈 후보. providerAt 간격/서버 전송 간격/브라우저 arrivalGap을 각각 비교하여 지연 위치를 좁힌다.
- done에서 pendingSources>0·bufferedMs>0이면 완료 경계 불일치. ended가 수동 stop 뒤에 발생하면 정상 소진으로 세지 않는다.
- frameSeq 후보 대비 전달 chunkSeq 누락은 cap/중단/정상 억제/내용 중복과 먼저 구분. 새 provider 턴과 잔여 구분은 재생된 음성을 저장하는 대신 동의받은 관찰자의 “이전 응답 재개/새 응답” 체크와 경계 메타데이터를 함께 기록한다.
- iOS는 기존 play-and-record 및 시스템 출력 경로를 그대로 사용한다. Android 출력 목록 공백은 권한 미허용의 증거가 아닐 수 있다. iPhone/BT 기존 실기기 검증 작업을 중복 구현하지 않는다.

**실기기 청취·인증 뒤 UI·물리 출력 장치는 이번에 검증하지 않았다.** 공개 로그인 화면 확인은 음성 품질 검증의 대체물이 아니다.

## 6. 최소 수정 방향과 승인 우선순위

아래는 수정안이지 이번에 적용한 정책이 아니다.

|우선순위|최소 방향|tradeoff|승인 후 회귀 기준|
|---|---|---|---|
|P1 취소 경계|cancel ACK와 실제 새 provider 응답 경계를 분리. 로컬 번호 증가만으로 interruption 해제하지 않도록 설계. provider가 확실한 ID를 주지 않으면 완료/입력 경계·연결 세대와 상태 머신으로 구분|옛 음성 차단을 강화하면 새 응답 시작도 지연/억제될 위험. 무조건 drain/reconnect는 금지|top/inline 잔여·정상 새 턴·중복 cancel·취소/완료 같은 프레임·빠른 다음 발화·재연결 케이스에서 잔여 0, 새 턴 손실 0|
|P1 완료/청취 경계|provider done과 source drain을 별도 상태로 관리, UI speaking/VAD를 실제 예약 소진 또는 취소에 맞춰 종료|queue에 무음이 남아 있는 것을 speaking으로 오인할 수 있음. 단순 타이머보다 node 세대·취소 원인 필요|600ms burst 꼬리와 20ms 말끝 유지; provider done 뒤 의도적 barge-in 가능; stop/재연결에서 과거 ended가 새 상태를 바꾸지 않음|
|P2 버퍼 고갈|승인된 범위에서 작은 초기/재버퍼링 여유를 가변 지연 trace로 선택. 상한을 둬 누적 대기 방지|여유 증가=첫 음성 지연 증가. 버퍼 flush와 barge-in 비용 증가. 664ms 지연을 작은 버퍼로 완전 해결한다고 보장 금지|동일 trace의 gap 합계/횟수와 최초 시작 지연·대기 p95 비교. nominal·burst·짧은 tail·중단 후 0 잔여·긴 대화 queue 상한 검증|
|P2 소스 전환|SDK 현행 계약부터 확인. 동일 프레임 복제는 유지하고 다른 프레임을 소스 이름만으로 턴 전체 폐기하지 않는 최소 dedup 검토|중복 재생과 유일 청크 유실의 상충. 길이만 같은 bytes를 동일 내용으로 취급하면 안 됨|동일 bytes 중복 1회, 서로 다른 top↔inline은 둘 다 유지, 같은 소스 연속 유지, 복수 inline parts 순서 유지|
|기기 근거 확보 후 VAD/route|기존 실기기 작업과 연결해 에코/잡음/AudioContext/BT 상태 확인 후 조정 여부 결정|바지인 민감도 완화는 사용자 의도적 중단 지연. route 강제는 iOS 경로 손상 가능|무발화 스피커 오탐률과 의도적 barge-in 지연을 이어폰 대조군과 측정|
|별도 AGC 초안 유지|기존 클리핑 개선 작업에서 처리. 끊김 수정과 합치지 않음|음량 안정화와 출력 지연은 서로 다른 축|디지털 clipping/RMS·compressor 출력과 실기기 체감 음량을 분리 검증|

기존 `results/pcm-agc.json`의 loud-after-quiet: 입력 RMS 약 .566/peak .800, AGC 후 RMS .921/peak 1, **480 samples 중 380 hard-clipped**, 관측 gain 약 3.570. `results/pcm-compressor.json`은 별도 Chromium OfflineAudioContext 결과다. clipping은 파형 왜곡이지 누락 청크/재생 무음의 증거가 아니다.

## 7. 실행과 재검증

```sh
# 외부 URL/provider/녹음 없이 합성·모의 경계만 검사
VOICE_OUTPUT_DIAGNOSTIC_WRITE=1 npx vitest run tests/client/useAudioPlayback.test.ts
npx vitest run tests/client/voiceOutputTimeline.test.ts tests/diagnostics/voiceOutputDiagnostic.test.ts \
  tests/server/geminiMessageHandler.test.ts tests/client/useVoiceActivityDetection.test.ts \
  tests/client/useRealtimeVoiceVadSensitivity.test.ts
npm run check
```

`VOICE_OUTPUT_DIAGNOSTIC_WRITE=1`은 합성 예약 결과 JSON만 갱신한다. 기존 AGC 결과 쓰기는 다른 환경 변수이므로 이번 재검증에서 원본 AGC 자료를 덮어쓰지 않는다. 테스트에는 실제 provider 요청·오디오 장치 접근·계정 비용이 없다. 일반 운영 로그의 오디오 원문·전사·토큰·resumption handle을 복사하지 않았다.

참조: `concurrent-roleplay-incident.ko.md`, `results/pcm-agc.json`, `results/pcm-compressor.json`, `results/output-timing.json`; 클라이언트의 `useAudioPlayback.ts`, `useRealtimeVoice.ts`, `useVoiceActivityDetection.ts`, `iosAudioSession.ts`; 서버의 `clientMessageHandler.ts`, `geminiMessageHandler.ts`, `outputDiagnostic.ts`.

### 이번 검증 상태

- 관련 7개 파일 **295개 테스트 통과**, `npm run check` 및 `git diff --check` 통과.
- 개발 서버 재시작 후 Application Ready 확인, 공개 로그인 화면 렌더링 확인. 로그인 이후 음성 UI/실기기 청취는 미검증. 개발 HMR WebSocket handshake 경고가 있어 자동 새로고침 경로를 정상이라고 주장하지 않는다.
- 조사 시작 전 전체 test workflow 결과는 **100개 파일 중 1개 실패, 2,100개 중 10개 실패**였다. 완료 검사에서도 같은 10개가 실패했다(신규 시험 포함 당시 총 2,117개). 기존 `tests/diagnostics/voiceConcurrency.test.ts`의 storage mock에 `updatePersonaRun`과 인식 증거 preload의 `orderBy`가 빠져 있어, **기존 mock의 IO 인터페이스만 최소 보완**했다. 해당 파일의 16개 시험이 모두 통과했다. 동시 부하 도구·기대값·운영 정책을 다시 구축하거나 이 시험 실패를 운영 음성 끊김 원인으로 연결하지 않았다. 전체 `npx vitest run`은 최종 완료 검사에서 다시 검증한다.