---
name: Veo image-to-video constraints (Gemini API)
description: What works and what doesn't for seed images in Veo avatar clip generation on Gemini API
---

## Rules

**`config.referenceImages` is Vertex AI only.** Passing it on Gemini API returns `400: referenceImages parameter is not supported in Gemini API`. Do not use it.

**`config.personGeneration: 'allow_adult'` is also unsupported** on Gemini API (`400: allow_adult for personGeneration is currently not supported`). Never pass this field.

**The only image option on Gemini API is the top-level `image` parameter** — Veo treats it as the first frame of the animation. Pass `{ imageBytes: base64, mimeType: 'image/webp' }`.

**RAI filters frequently block person-face images.** When a seed image containing a real person's face is passed, Veo's safety filter often returns 0 `generatedVideos` (`raiMediaFilteredCount > 0`). There is no programmatic workaround on Gemini API.

**Do NOT silently fall back to text-only generation** when the seed image is filtered. That produces a completely different person and misleads the operator. Return a clear error instead.

**Prompt text about faces/skin triggers filters too.** Prompts containing "face", "skin tone", "hair" in combination with a person image get filtered. Keep prompts motion-only (posture, movement) — no appearance description.

## How to apply

- `generateAvatarClip()` in `server/services/gemini-video-generator.ts`
- Pass `generateParams.image = { imageBytes, mimeType }` when seed image is present
- No `config` block at all (no personGeneration, no referenceImages)
- Prompt: motion/posture only — no face/appearance language
- On RAI filter: fail with explicit error, never silent fallback

**Why:** Multiple failed attempts across a session confirmed each of these constraints via live 400 errors from the Google API.
