---
name: Scenario persona media (image/videos)
description: Why scenario personas arrive without image/videos and which record is the source of truth for avatar media.
---

Scenario personas are persisted to the `scenarios.personas` jsonb column through a normalizer
that keeps only a whitelist of fields. Avatar media does **not** survive that round trip in
general — a persona stored from the editor typically comes back with no `videos` and often no
`image`, even though the scenario JSON that created it had them.

The MBTI persona record (`mbti_personas`, with `images` and `videos` jsonb columns) is the real
source of truth for avatar media. Scenario personas point at it via `personaRef` ("cp.json" →
`cp`), and read-side enrichment re-attaches the media before the scenario is returned to clients.

**Why:** a persona with neither `image` nor `videos.clips` renders a completely blank chat
portrait — the video renderer has nothing to load and there is no static layer behind the video
buffers, so a failed or slow clip leaves an empty box with no visible error.

**How to apply:**
- Never assume a persona read back from the scenarios table carries media. Enrich on read.
- When adding a new persona media field, add it to the read-side enrichment as well; adding it
  only to the write path silently drops it.
- Expression maps in `mbti_personas.images` are keyed by the **Korean** emotion label and store
  `""` placeholders for portraits that were never generated. Treat empty strings as absent, and
  do not hand those Korean-keyed maps to the client renderers, which key expressions in English.
- Avatar clips are stored as storage keys (`videos/...`), not URLs; the client converts them to
  `/objects?key=...`. Byte-range requests must be supported or browsers will not play them.
