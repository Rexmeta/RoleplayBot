# 한국어 음성 전사: 무결성, 평가 적격성과 운영 기준

## 실제 계약과 확인한 최초 오류 계층

설치된 `@google/genai` 1.15.0의 실제 `Live.connect`와 setup 직렬화기를 실행하고 소켓 전송 직전 메시지를 검사했다. 네트워크를 대체한 것은 소켓뿐이며 SDK 자체를 mock하지 않았다.

* `inputAudioTranscription.languageCode`, `outputAudioTranscription.languageCode`는 setup에서 사라지고 각각 `{}`가 된다. 연결 직전 객체에 한국어 코드가 있다는 기존 검사는 한국어 강제의 증거가 아니다.
* Gemini 공식 Live 가이드는 전사의 언어가 자동 감지되며 명시적인 전사 언어 설정을 지원하지 않는다고 설명한다. 대화 생성용 system instruction은 STT 언어 강제 계약이 아니다.
* 실제 비교에 사용한 모델은 `gemini-3.1-flash-live-preview`, API `v1beta`이다. 설치 SDK 버전만으로 서버의 모델 지원 여부를 추정하지 않는다.
* 앱 내부 `event: END_OF_TURN`도 SDK가 직렬화하지 않는다. 현재 전송 어댑터는 이를 지원되는 `audioStreamEnd: true`로 바꾼다.
* 독립 STT는 OpenAI `audio.transcriptions.create`에 WAV PCM16 mono 16kHz 및 `language: ko`를 전달한다. 번역 API, 문맥 기반 복원 또는 Live fallback을 사용하지 않는다.

공식 자료:

- https://ai.google.dev/gemini-api/docs/live-guide (audio transcriptions)
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-live-preview
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/pricing

**확정 사실:** 한국어 설정이 Gemini 전사 요청에 전달된다는 기존 가정은 틀렸다. 독립 STT도 짧은 한국어를 외국어로 인식할 수 있다.

**아직 가설:** 실제 사용자 사례의 잡음, 스피커 에코, Bluetooth 입력, iPhone 라우팅, 끊어진 연결 또는 바지인이 오인식의 원인인지 여부. 기존 발화의 원음이 없으므로 그 원인을 소급하여 확정하지 않는다.

## 분리한 상태 계약

`voice_utterances`는 서버 소유 전사 근거다.

- providerText/providerFinal: Live 제공자의 원문과 completion 여부. provider-final 원문은 나중에 수정하지 않는다.
- candidateText: 동일 발화의 독립 STT 결과. 분할 발화는 구간 순서대로 원문을 연결하며 확인을 요구한다.
- canonicalText: 평가에 사용할 내용. STT와 완료된 Live 원문이 공백만 제외하고 일치하거나, 사용자가 명시적으로 확인해야 채워진다.
- source: 독립 STT 및 실제 모델 또는 사용자 확인.
- status/reason/revision: 처리 중, 확인 필요, verified 또는 confirmed. confidence를 제공하지 않는 모델의 confidence를 만들어 넣지 않는다.
- captureGeneration/speechSeq/논리 턴: 물리적 capture와 provider 이벤트를 연결한다. 기록은 페르소나 실행에 바인딩된다.

확인 endpoint는 대화 소유권을 검사하고 revision CAS를 적용한다. 클라이언트가 보낸 `verified`, canonical 값 또는 `voiceTranscriptFinal`은 평가 적격성을 승격할 수 없다. 숫자, 이름, 짧은 답변, 약어, 정상적인 혼합 언어는 문자 종류나 한글 비율로 거부하지 않는다.

과거 레코드는 자동 수정하지 않는다. 한국어 실시간 세션 이후의 음성 기록에는 새로운 적격성 검사를 적용한다.

## 원음 수명과 장애 정책

원음은 서버 메모리에만 존재한다. 별도 진단 녹음을 보관하거나 원음·전사 본문을 일반 로그에 쓰지 않는다.

- 발화 시작, pre-roll, append, trailing silence, commit을 동일한 capture에 연결한다.
- 최대 60초/1.92MB의 발화, 프로세스 전체 32MiB, STT 동시 요청 최대 8개.
- 20초 단위로 순서대로 전사한다. 분할 경계에서 단어가 잘릴 수 있으므로 분할 결과는 자동 확정하지 않는다.
- 65초 capture timeout, 저장/설정 조회의 제한 시간, 전체 STT 20초 deadline.
- 전사 직후 원음을 0으로 덮고 메모리 예산을 반환한다. 느린 결과 저장 때문에 원음을 계속 보유하지 않는다.
- 초과 발화, 종료·재연결 중 미완료, 겹친 capture, 설정 누락, 접근 제한, provider 실패는 확인 필요 상태가 된다. 잘린 오디오를 완전한 발화로 평가하지 않는다.
- 처리 후 원음은 재전사할 수 없다. 사용자 화면에서 실제로 말한 내용을 명시적으로 확인할 수 있다. 불확실한 내용을 추측하여 확인해서는 안 된다.

## 평가와 동시성

모든 최종/페르소나 피드백은 서버 기록을 canonical 전사로 준비한다. 미완료 또는 확인 대기 근거가 하나라도 있으면 점수·합격 판정을 확정하지 않는다. 이는 외국어 사용, 이해 부족 또는 대화량 부족 판정이 아니다.

한국어 Live 원문으로 즉시 턴 점수를 생성하지 않는다. 해결된 canonical 전사의 시뮬레이션 평가만 게시하며 게시 직전 revision을 다시 검사한다. Live 도구 호출에서 파생된 점수·사건은 보고서 근거에서 제외한다. 시뮬레이션 점수 수집도 전사 revision을 검사한다.

원문을 평가용 문맥으로 다시 주입하지 않는다. 재연결 시 클라이언트의 한국어 음성 히스토리는 신뢰하지 않고 서버에 보존된 해결 전사만 사용한다.

전사 변경과 피드백 게시에는 같은 실행 단위 advisory lock을 사용한다. 기존 durable job 등록, generation/worker token fencing 및 저장+completed 트랜잭션은 유지한다. canonical fingerprint가 달라진 이전 보고서는 원본 DB를 보존하되 조회 결과에서는 점수·인용·합격 판단을 제거한 hold로 표시한다. 이미 생성된 결과의 재평가는 사용자가 요청해야 한다. 외부 API도 캐시된 metadata보다 현재 실행의 보고서와 상태를 우선한다.

## 실제 합성 원음 비교 결과

`scripts/benchmarkKoreanRecognition.ts --synthetic`는 API 호출 비용이 발생한다. 합성 TTS 입력을 메모리에서 생성하고, 같은 PCM을 실제 Live와 전용 STT에 전달한다. 결과는 `korean-recognition-synthetic-results.json`에 있으며 원음은 저장하지 않는다.

마지막 비교는 6개 사례(짧은 답변, 일반 문장, 숫자, CRM/API 혼합, 낮은 음량, 합성 에코), 44.1/48kHz 입력을 16kHz로 정규화했다. 사용자나 실제 개인에 대한 음성은 아니다.

| 경로 | 평균 문자 오류율 | 외국어-only 오인식 | 빈 전사 | p50 요청 시간 | 최대 요청 시간 | Live와 후보 불일치 |
|---|---:|---:|---:|---:|---:|---:|
| Gemini Live | 0% | 0/6 | 0/6 | 8,531ms | 12,501ms | — |
| gpt-4o-mini-transcribe | 0% | 0/6 | 0/6 | 587ms | 1,294ms | 0/6 |
| gpt-4o-transcribe | 3.70% | 0/6 | 0/6 | 759ms | 1,877ms | 1/6 |
| whisper-1 | 2.78% | 0/6 | 0/6 | 979ms | 2,054ms | 2/6 |

문자 오류율은 공백/일부 문장 부호를 제외한 Levenshtein 거리의 사례별 평균이다. 숫자 사례의 `삼십오` → `서른다섯`/`35`는 의미가 같은 표현이므로 문자 오류율만으로 사용자 오류나 언어 사용을 판정하지 않는다. foreign-only는 주석된 합성 사례에 대한 진단 지표이며 제품의 차단 정책이 아니다.

Live 시간에는 실시간 오디오 전송과 AI 응답 완료가 포함된다. STT 시간은 완성된 오디오 제출 후 시간이다. 이 표로 실시간 지연이 몇 배 개선됐다고 주장할 수 없다.

첫 실행에서는 mini STT가 `네.`를 `me`로, 일반 문장에 없는 음절을 추가해 기록했다. 같은 원음으로 비교한 그 실행에서 Live는 해당 사례를 정확히 기록했다. 재생성한 두 번째 합성 음성에서 오류가 재현되지 않은 것은 해결의 증거가 아니다. 이 때문에 자동 운영 적용은 꺼둔다.

마지막 실행의 mini STT만의 공개 단가 기반 추정 비용은 약 **$0.000894**이다. full/whisper는 동일 길이 기준 각각 약 두 배다. 실제 청구액, TTS 생성 비용, Live 대화 토큰 비용은 이 추정에 포함하지 않았다. 결과 JSON의 provider usage는 추가 원가 분석에 사용할 수 있다.

발화 누락/중복은 API 비교의 빈 전사 및 관찰된 완료 횟수와 별도로 capture/논리 턴 회귀 테스트로 확인한다. 합성 비교에서 Live는 사례당 관찰된 completion이 하나였으나, 장시간 실제 기기의 누락·중복률을 검증한 것은 아니다.

추가로 합성 이름과 백색 잡음 사례 2개를 같은 파형으로 비교했다(`--synthetic --supplement`, `korean-recognition-synthetic-supplement.json`). 이름 사례에서 Live는 `테스트`를 `test`로 기록하여 문자 오류율 25%였고 세 전용 STT는 정답과 일치했다. 이는 정상적인 표기 변형일 수도 있어 문자 종류만으로 오류 판정하지 않는다. 잡음 사례는 네 경로 모두 문자 오류율 0%였다. 추가 mini STT 요청 시간은 911ms/896ms, 실제 제품 비교 규칙의 확인 요청률은 1/2였다. 두 사례로 실제 잡음·이름 인식의 일반 성능을 입증하지는 않는다.

## 운영 적용과 rollback

- `ai/voice_stt_enabled`: 정확히 `true`일 때만 실제 독립 STT 호출을 허용한다. 기본/누락/false는 확인 필요이다.
- `ai/model_voice_transcription`: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`만 지원한다. 다른 제공자 설정을 자동 상속하지 않는다.
- 로그 지표: 제공자, 실제 모델, ko, 오디오 길이, STT 처리 지연, 구간 수, 상태/실패 사유. 원문·오디오·사용자 식별 정보는 넣지 않는다.
- 실제 동의된 한국어 원음과 기기별 시험에서 오류율, 사용자 확인률 및 비용/지연을 측정한 뒤 제한적으로 켠다. 모의 이벤트 테스트 또는 6개 합성 음성만으로 실제 인식 문제가 해결됐다고 선언하지 않는다.
- rollout을 끄더라도 평가 적격성 차단을 끄지 않는다. canonical 확인 및 revision guard를 모르는 과거 바이너리로 되돌리는 것은 안전한 rollback이 아니다.
- 개발 DB 변경은 적용했다. 배포 전 관리형 PostgreSQL은 Publish 스키마 이행을 사용한다. 외부 DB 운영은 해당 운영자의 기존 migration 절차로 `migrations/0016_voice_utterances.sql`을 적용한다. 이 변경은 새 테이블을 서버 부팅 시 자동 생성하지 않는다.

**남은 검증 한계:** 실제 사람의 억양/작은 발화/숫자/이름, 잡음, Bluetooth, iPhone, 에코-only, 바지인 및 연결 경계의 실제 음향 성능. 원음이 없는 과거 오류 발화는 복원할 수 없다. 테스트 장비나 동의된 음성 없이 이 한계를 해결됐다고 보고하지 않는다.