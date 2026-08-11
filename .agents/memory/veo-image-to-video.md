---
name: Veo image-to-video constraints
description: referenceImages and personGeneration are both unsupported by the Gemini API; human face images are frequently blocked by RAI filters.
---

# Veo image-to-video constraints

## Rule
The Gemini API (as of August 2026) does not support `referenceImages` or `personGeneration` parameters for Veo image-to-video generation. Passing them results in an immediate API error. Additionally, prompts that include images of human faces are frequently rejected by the Responsible AI (RAI) content filter.

**Why:** These features are present in the Veo documentation for some API surfaces but not yet available through the Gemini REST/SDK path used by this project. Silent fallbacks that return no clip when the API rejects the request hide the failure from operators.

**How to apply:**
- Do not pass `referenceImages` or `personGeneration` to the Gemini Veo API.
- When the RAI filter rejects a face image, surface a clear error to the caller — do not silently return null or an empty result.
- Test image-to-video flows with non-face images to avoid intermittent RAI failures.
