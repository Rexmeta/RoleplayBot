---
name: Published runtime snapshots
description: Published scenario runs must remain tied to the exact scenario, persona, harness, and rubric version selected at start.
---

Published runs use their bound scenario snapshot as the runtime source of truth, including persona behavior, simulation/evaluation harnesses, and rubric context. Imported published content must include its evaluation criteria inside the immutable content snapshot.

**Why:** Falling back to live scenario, MBTI persona, or criteria records lets later authoring/import changes alter active and historical conversations and reports.

**How to apply:** For snapshot-bound runs, never enrich runtime behavior from mutable live records. Legacy native/unpublished runs may use the live registry. If an imported snapshot lacks historical rubric context, fail closed rather than substituting the current rubric.