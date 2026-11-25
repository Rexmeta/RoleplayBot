---
name: Agent play link design rationale
description: Why hosted play links redeem via POST instead of page GET
---
A page GET must never consume a single-use link, because link prefetchers/scanners would burn it; the in-page POST redeem is the consuming step.
**Why:** prefetch burns single-use tokens before the real user opens them.
**How to apply:** keep consumption in an explicit POST; frame-ancestors derives only from sanitized key origins, empty = none.
