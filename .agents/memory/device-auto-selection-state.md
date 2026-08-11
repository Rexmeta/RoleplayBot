---
name: Audio device auto-selection tri-state
description: Why auto-picked device IDs must be persisted separately from user picks
---

Persisted audio device selections need three distinguishable states, not two: (1) no selection, (2) auto-selected (e.g. Bluetooth auto-pick), (3) user-explicit selection.

**Why:** If an auto-picked device ID is stored in the same slot as a user pick, the next session sees "a saved choice exists" and refuses to upgrade to a newly connected (better) device — the auto-pick silently becomes sticky and defeats the whole point of automation. Conversely, treating every saved ID as replaceable would clobber deliberate user choices on `devicechange`.

**How to apply:** Store an explicit "user chose" flag and a separate "was auto-selected" flag alongside the device ID. Auto-selection may replace a selection only when the user flag is unset; any user-driven selection clears the auto flag and sets the user flag. On load, only honor the auto flag when the user flag is absent.
