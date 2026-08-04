---
name: Veo image-to-video constraints (Gemini API)
description: What works and what doesn't for seed images in Veo avatar clip generation on Gemini API
---

## Rules

**`config.referenceImages` is Vertex AI only.** Gemini API returns `400: referenceImages parameter is not supported`. Never use it regardless of model.

**`config.personGeneration: 'allow_adult'` is also unsupported** on Gemini API (`400: allow_adult for personGeneration is currently not supported`). Never pass this field.

**The correct Gemini API image-to-video approach** — works on all 3 Veo models (Lite, Fast, Full):
```js
generateParams.image = seedImage;           // top-level first frame
generateParams.config = { lastFrame: seedImage }; // same image = identity-preserving loop
```
Using the same image for both first and last frame forces the video to start and end with the exact same face, creating a seamless loop where identity is locked at both endpoints.

**Do NOT prompt about faces/skin/hair.** Text like "Preserve the exact face, skin tone, hair" triggers RAI content filters. Keep prompts motion-only (posture, pose, movement).

**Do NOT silently fall back to text-only generation** when the seed image is filtered. That produces a completely different person. Return a clear error instead.

## How to apply

- `generateAvatarClip()` in `server/services/gemini-video-generator.ts`
- Set `generateParams.image` AND `generateParams.config.lastFrame` to the same `{ imageBytes, mimeType }` object
- No `config.personGeneration`, no `config.referenceImages`
- No model forcing — all 3 Veo models support this
- On RAI filter: fail with explicit error, never silent fallback

**Why:** `referenceImages` and `personGeneration` both return 400 on Gemini API regardless of model. The `image` + `config.lastFrame` pattern is confirmed working from official docs and live testing.
