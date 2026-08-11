---
name: Veo avatar clip rules
description: Model names, media normalisation, audio safety, and image-to-video constraints for Veo avatar clip generation
---

## Valid model names

Valid Veo model names (confirmed working):
- `veo-3.1-lite-generate-preview` — Lite/720p, cheapest
- `veo-3.1-fast-generate-preview` — Fast variant
- `veo-3.1-generate-preview` — Full quality

**Why:** The correct pattern is `veo-{version}-{variant}-generate-preview`; `generate-lite` is the wrong word order and causes 404 errors.

**How to apply:** When setting `FEATURE_DEFAULTS.video` or seeding `model_video` in DB, use `veo-3.1-lite-generate-preview` as the default.

## Container and letterbox normalisation

Veo output for avatar clips is **always H.264/AAC in an MP4 container**, never WebM,
and the frame is **sometimes a square render padded into the requested aspect ratio
with solid black bars** (letterbox when portrait was requested, pillarbox when the
render came back landscape).

Two rules follow, and both were learned the hard way:

1. **Store the clip under a key/content-type that matches the actual bytes.**
   Serving MP4 bytes as `video/webm` makes Chrome refuse to decode them: `canplay`
   never fires, so a renderer that waits for readiness reports a timeout and falls
   back to the static portrait. Every clip appears "missing" while the object itself
   downloads fine over HTTP — which makes it look like a network or CSS problem.

2. **Crop the padding before upload.** `object-fit: cover` scales the padded frame to
   fill the portrait, so a black bar lands across the top of the avatar and reads as a
   layout bug. Requesting a portrait aspect ratio does *not* guarantee Veo renders one.

**Why:** A black band above the avatar was chased through viewport offsets, fixed-panel
positioning and CSS stacking for a long time before the pixels were measured; the bars
were inside the generated video the whole time. Measure the asset before suspecting layout.

**How to apply:** When a generated clip looks mispositioned or silently fails to play,
run `ffprobe` for the real container/codec and `ffmpeg -vf cropdetect` for the content
rectangle *before* touching client code. Detection parses ffmpeg's report from **both**
stdout and stderr — a shell-level `2>&1` moves the lines off stderr and makes the crop
silently no-op.

## Audio safety filter

Veo 3는 요청하지 않아도 오디오를 함께 생성한다. 프롬프트에 오디오 지시가 없으면 모델이 임의의
사운드(사람 목소리 포함)를 만들다가 안전 필터에 걸리고, **영상 전체가 반환되지 않는다**
(에러 문구: "We encountered an issue with the audio for your prompt").

규칙: 사람이 등장하는 클립 프롬프트에는 항상 오디오 내용을 명시한다.
조용한 실내 앰비언스 + "no human voices / no speech / no music" 수준이면 충분하다.
입이 움직이는 클립(speaking)은 "no audible speech or voice"를 추가로 못 박아야 모델이
음성 트랙 합성을 시도하지 않는다.

**Why:** 설치된 Gemini SDK는 `config.generateAudio`를 설정하면 즉시 throw한다. 즉 오디오를
끄거나 제어할 API 파라미터가 없고, **프롬프트 텍스트가 유일한 제어 수단**이다.
`generateVideos()` config에는 `generateAudio`를 전달하지 않는다. SDK v1.15+는 `false`여도
"generateAudio parameter is not supported in Gemini API" 오류를 즉시 발생시킨다.

**How to apply:** 오디오 필터로 클립이 통째로 실패하면 위 문구를 프롬프트 끝에 붙여 본다.

**Current project decision:** "오디오 문구 없음"이다. 아바타 클립은 재생 시 항상 muted이고,
사용자가 프롬프트에 배경음 지시가 들어가는 것을 원하지 않아 관련 문구를 전부 제거했다.
따라서 오디오 힌트는 안전 필터 오류가 실제로 재발할 때만 되살릴 후보이며, 임의로 다시
넣지 않는다. 리스닝 프롬프트 문구도 사용자가 직접 지정한 것이므로 마음대로 보강하지 않는다.

## Image-to-video constraints

### Confirmed NOT supported on Gemini API (return 400 immediately)

- `config.referenceImages` — Vertex AI only
- `config.personGeneration: 'allow_adult'` — removed from Gemini API
- `config.lastFrame` — Vertex AI only

The official Google docs show all three, but they silently apply only to Vertex AI.

### Only confirmed working on Gemini API

```js
// All 3 Veo models (Lite / Fast / Full) support this
generateParams.image = { imageBytes: base64, mimeType: 'image/jpeg' }; // first frame
// No config overrides for the image — just image at top level
```

The video starts from the seed image face. Appearance drift across frames is possible but the first frame is locked to the seed image.

### RAI filter behavior

- Person face images are sometimes (not always) rejected by Veo's RAI filter
- When rejected: `raiMediaFilteredCount > 0`, `generatedVideos` is empty
- Do NOT silently fall back to text-only — that produces a random person
- Return a clear error; let the operator retry or change the image

### Prompt rules

- Do NOT mention faces, skin tone, hair, or appearance in the prompt — triggers RAI filters
- Keep prompts motion-only: posture, eye blinks, breathing, camera lock

### How to apply

In `generateAvatarClip()` (`server/services/gemini-video-generator.ts`):
- Set `generateParams.image = seedImage` when seed image present
- No `config` block at all when using image (no personGeneration, no referenceImages, no lastFrame)
- On RAI filter: explicit error, never silent fallback

**Why:** Each of referenceImages / personGeneration / lastFrame was tested live and returned 400 on Gemini API. Only top-level `image` passes without error.