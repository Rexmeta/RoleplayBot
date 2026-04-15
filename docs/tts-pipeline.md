# TTS 파이프라인 (TTS Pipeline)

> **소스**: `server/routes/tts.ts`, `server/services/elevenlabsService.ts`, `server/services/customTtsService.ts`  
> **최초 작성**: 2026-04-15

---

## 1. 개요

TTS(Text-to-Speech) 파이프라인은 AI 응답 텍스트를 음성으로 변환한다. **ElevenLabs**를 우선 사용하고, 실패 시 **Custom TTS(XTTS-v2)** 서버로 자동 폴백한다.

---

## 2. TTS 서비스 선택 기준 및 폴백 동작

```
POST /api/tts/generate
        │
        ▼
텍스트 전처리 (HTML 태그, 마크다운, 괄호 묘사 제거)
        │
        ▼
ElevenLabs generateSpeech() 시도
  ├─ 성공 → base64 오디오 반환, provider: 'elevenlabs'
  └─ 실패 (API 오류 / 키 없음 / 할당량 초과)
          │
          ▼
    customTtsService.generateSpeech() 시도
      ├─ 성공 → base64 오디오 반환, provider: 'custom'
      └─ 실패 → HTTP 500 에러
                "TTS 서비스를 사용할 수 없습니다. 브라우저 음성 합성을 사용해주세요."
```

---

## 3. ElevenLabs 서비스

**파일**: `server/services/elevenlabsService.ts`  
**엔드포인트**: `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}`  
**모델**: `eleven_flash_v2_5` (75ms 지연시간, 실시간 대화 최적화)

### 3.1 음성 ID 목록

| scenarioId | 성별 | Voice ID | 음성 설명 |
|-----------|------|----------|----------|
| `communication` | male | `onwK4e9ZLuTAKqWW03F9` | Daniel — 차분하고 전문적 |
| `negotiation` | male | `Yko7PKHZNXotIFUBG7I9` | Callum — 자신감 있고 설득력 |
| `feedback` | male | `IKne3meq5aSn9XLyUdCD` | Charlie — 친근하고 부드러운 |
| `empathy` | female | `XrExE9yKIg1WjnnlVkGX` | Matilda — 따뜻하고 공감적 |
| `presentation` | female | `pFZP5JQG7iQjIQuC4Bku` | Lily — 명확하고 전문적 |
| `crisis` | female | `XB0fDUnXU5powFXDhCwa` | Charlotte — 침착하고 안정적 |
| _(기타 / 미매핑)_ | — | `onwK4e9ZLuTAKqWW03F9` | Daniel (기본값) |

모든 음성은 한국어를 지원한다.

### 3.2 감정별 음성 파라미터 (voice_settings)

| 감정 | stability | similarity_boost | style | use_speaker_boost |
|------|-----------|-----------------|-------|-------------------|
| 기쁨 | 0.2 | 0.9 | 0.9 | true |
| 슬픔 | 0.95 | 0.5 | 0.1 | false |
| 분노 | 0.1 | 1.0 | 1.0 | true |
| 놀람 | 0.05 | 0.85 | 0.95 | true |
| 중립 (기본값) | 0.6 | 0.8 | 0.4 | true |

공통 속도 설정: `speaking_rate: 1.2`, `speed: 1.2`, `pitch: 1.15`

### 3.3 API 오류 시 동작

ElevenLabs API가 비-200 응답을 반환하면 `Error`를 throw → 상위 라우터에서 Custom TTS로 폴백.  
별도 재시도 없음.

---

## 4. Custom TTS 서비스 (XTTS-v2)

**파일**: `server/services/customTtsService.ts`  
**대상**: Google Colab에서 실행하는 XTTS-v2 서버  
**엔드포인트**: `POST {CUSTOM_TTS_URL}/tts`

### 4.1 스피커 음성 파일 매핑

| scenarioId | 성별 | 파일 경로 |
|-----------|------|----------|
| `communication` | male | `./XTTS-v2/speakers/male_professional.wav` |
| `negotiation` | male | `./XTTS-v2/speakers/male_confident.wav` |
| `feedback` | male | `./XTTS-v2/speakers/male_friendly.wav` |
| `empathy` | female | `./XTTS-v2/speakers/female_warm.wav` |
| `presentation` | female | `./XTTS-v2/speakers/female_professional.wav` |
| _(기타 / 미매핑)_ | male | `./XTTS-v2/male.wav` |
| _(기타 / 미매핑)_ | female | `./XTTS-v2/female.wav` |

### 4.2 감정별 텍스트 전처리

Custom TTS는 음성 파라미터 조정이 불가능하므로 텍스트에 감정 prefix를 삽입한다:

| 감정 | prefix |
|------|--------|
| 기쁨 | `기쁘고 밝은 톤으로: ` |
| 슬픔 | `조금 슬프고 차분한 톤으로: ` |
| 분노 | `단호하고 강한 톤으로: ` |
| 놀람 | `놀란 톤으로: ` |
| 중립 | _(prefix 없음)_ |
| 호기심 | `흥미롭고 궁금한 톤으로: ` |
| 불안 | `걱정스럽고 조심스러운 톤으로: ` |
| 피로 | `지치고 힘든 톤으로: ` |
| 실망 | `아쉽고 실망스러운 톤으로: ` |
| 당혹 | `당황스럽고 혼란스러운 톤으로: ` |

### 4.3 API 오류 시 동작

`{CUSTOM_TTS_URL}/tts`가 비-200 응답이거나 `result.success === false`이면 에러를 throw.  
상위 라우터에서 최종 에러로 처리한다.

---

## 5. 페르소나 성별 판별 로직

`POST /api/tts/generate` 처리 시 `scenarioId`로 성별을 결정한다:

1. 시나리오 JSON의 personas 배열에서 `personaId`를 찾아 `gender` 필드 사용
2. 없으면 하드코딩 규칙 적용: `['isfj','infp','isfp','infj']` → female, 나머지 → male

---

## 6. 환경변수

| 변수 | 필수 여부 | 설명 |
|------|---------|------|
| `ELEVENLABS_API_KEY` | ElevenLabs 사용 시 필수 | 없으면 ElevenLabs 단계에서 즉시 실패 → Custom TTS로 폴백 |
| `CUSTOM_TTS_URL` | Custom TTS 사용 시 필수 | XTTS-v2 서버 URL |
| `CUSTOM_TTS_API_KEY` | Custom TTS 사용 시 필수 | `TTS-API-KEY` 헤더로 전달 |

---

## 7. TTS 상태 확인

`GET /api/tts/health` 응답:

```json
{
  "customTts": { "available": true/false, "status": "online/offline" },
  "elevenlabs": { "available": true/false, "status": "configured/not_configured" },
  "webSpeech": { "available": true, "status": "browser_dependent" }
}
```
