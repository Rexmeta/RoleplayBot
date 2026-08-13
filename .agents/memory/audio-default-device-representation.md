---
name: Audio default-device representation
description: Why the browser 'default' pseudo-ID must stay out of persisted/UI selection state
---

The audio device hooks represent "use the browser/system default" as the empty string `''` everywhere (ref, localStorage, getUserMedia/setSinkId call sites — where it means "omit deviceId"). The browser's enumerated `'default'` pseudo-device-ID must never leak into that state.

**Why:** Two failed attempts stored the enumerated default ID (`'default'`) into React selection state so the picker would highlight the default row. That diverged UI state from the API/ref state (`''`), broke Bluetooth auto-selection guards (`hasPersistedChoice` checks the ref), and contradicted tests asserting `''` after explicit "use default" choices.

**How to apply:** Keep selection state as `''` for default. Solve "default row looks unselected" purely at render time: treat an empty selection as matching the `kind === 'default'` row, and normalise clicks on that row back to `''` before persisting. Do not write the pseudo-ID into hook state or storage.
