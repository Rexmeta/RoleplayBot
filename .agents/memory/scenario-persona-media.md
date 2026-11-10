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

Live avatar settings belong to the saved persona selected by `personaRef`, not to the
scenario actor's ID or to the bundled standard MBTI behavior templates. User-created
persona IDs are not restricted to the sixteen MBTI types.

**Why:** The user requires a persona's configured Live avatar to carry into scenarios
that select that persona, without repeating setup. Scenario actor identity and selected
persona reference can differ; template-only reads can incorrectly report a saved avatar as absent.

**How to apply:** Resolve native runtime media from the selected persona's saved settings.
Keep immutable published/run snapshots authoritative, and do not change dialogue behavior
template resolution as a side effect of fixing media selection.

Treat convention-based scenario portraits as derived media, but preserve explicitly
chosen custom portraits when repairing stale gender/persona references.
**Why:** Editing a scenario's gender or selected persona can leave its old generated
portrait saved; the selector computes a fresh portrait while chat uses the saved one.
**How to apply:** Check the stored portrait's persona and gender against the current
selection on read. Do not rewrite historical run snapshots or use another gender as
the replacement for a known gender mismatch.
