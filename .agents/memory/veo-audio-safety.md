---
name: Veo 오디오 안전 필터
description: Veo prompts without explicit audio instructions trigger random background audio that the safety filter blocks, resulting in no video output at all.
---

# Veo 오디오 안전 필터

## Rule
When a Veo prompt does not include explicit audio instructions, Veo generates random background audio. This random audio frequently triggers the content safety filter, causing the entire video generation to fail silently — no clip is returned at all.

**Why:** The Veo SDK (v1.15+) does not expose a `generateAudio` config option; any attempt to set it causes an immediate SDK error. The only way to control audio is via prompt text.

**How to apply:** All Veo prompts must include an explicit audio instruction (e.g. "with no background music", "with ambient office sounds"). Never submit a prompt that lacks an audio direction. Silent fallbacks that return an empty result must not be used — surface the error to the caller explicitly.
