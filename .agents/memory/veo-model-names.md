---
name: Veo model names
description: The correct Veo model name order matters; generateAudio must not be set in SDK config (SDK v1.15+).
---

# Veo model names

## Rule
The correct model identifier is `veo-3.1-lite-generate-preview` — the word order is `lite-generate`, **not** `generate-lite`. Using the wrong order causes an "unknown model" error from the API.

**Why:** The model name format is not intuitive; `generate` describes the capability and `lite` is the variant qualifier, placed before `generate` in the string. This has caused confusion and silent fallbacks in the past.

**How to apply:**
- Always use `veo-3.1-lite-generate-preview` (and similarly-ordered names for other Veo variants).
- Do not set `generateAudio` in the SDK config object on SDK v1.15+; it causes an immediate runtime error. Control audio via prompt text only.
