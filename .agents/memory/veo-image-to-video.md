---
name: Veo image-to-video constraints (Gemini API)
description: What works and what doesn't for seed images in Veo avatar clip generation on Gemini API
---

## Confirmed NOT supported on Gemini API (return 400 immediately)
- `config.referenceImages` — Vertex AI only
- `config.personGeneration: 'allow_adult'` — removed from Gemini API
- `config.lastFrame` — Vertex AI only

The official Google docs show all three, but they silently apply only to Vertex AI.

## Only confirmed working on Gemini API
```js
// All 3 Veo models (Lite / Fast / Full) support this
generateParams.image = { imageBytes: base64, mimeType: 'image/jpeg' }; // first frame
// No config overrides for the image — just image at top level
```
The video starts from the seed image face. Appearance drift across frames is possible but the first frame is locked to the seed image.

## RAI filter behavior
- Person face images are sometimes (not always) rejected by Veo's RAI filter
- When rejected: `raiMediaFilteredCount > 0`, `generatedVideos` is empty
- Do NOT silently fall back to text-only — that produces a random person
- Return a clear error; let the operator retry or change the image

## Prompt rules
- Do NOT mention faces, skin tone, hair, or appearance in the prompt — triggers RAI filters
- Keep prompts motion-only: posture, eye blinks, breathing, camera lock

## How to apply
In `generateAvatarClip()` (`server/services/gemini-video-generator.ts`):
- Set `generateParams.image = seedImage` when seed image present
- No `config` block at all when using image (no personGeneration, no referenceImages, no lastFrame)
- On RAI filter: explicit error, never silent fallback

**Why:** Each of referenceImages / personGeneration / lastFrame was tested live and returned 400 on Gemini API. Only top-level `image` passes without error.
