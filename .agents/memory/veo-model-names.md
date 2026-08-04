---
name: Veo model names
description: Correct Veo video generation model names available on the Gemini API (v1beta)
---

Valid Veo model names (confirmed working):
- `veo-3.1-lite-generate-preview` — Lite/720p, cheapest
- `veo-3.1-fast-generate-preview` — Fast variant
- `veo-3.1-generate-preview` — Full quality

**Why:** Task #1203 introduced `veo-3.1-generate-lite-preview` (wrong word order — "generate-lite" instead of "lite-generate"), causing 404 errors. The correct pattern is `veo-{version}-{variant}-generate-preview`.

**How to apply:** When setting `FEATURE_DEFAULTS.video` or seeding `model_video` in DB, use `veo-3.1-lite-generate-preview` as the default.

Also: `generateAudio` must NOT be passed to `generateVideos()` config — SDK v1.15+ throws "generateAudio parameter is not supported in Gemini API" immediately, even for `false`.
