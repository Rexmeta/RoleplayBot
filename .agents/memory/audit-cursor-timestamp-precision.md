---
name: Audit cursor timestamp precision
description: PostgreSQL keyset cursors must retain the full database timestamp precision.
---

Audit cursors ordered by timestamp and ID must preserve PostgreSQL's full timestamp precision. JavaScript `Date` truncates PostgreSQL microseconds to milliseconds, which can shift a keyset boundary and repeat or skip entries when timestamps are close or tied.

**Why:** Stable audit pagination must remain exact while new records arrive between page requests.

**How to apply:** Project the cursor timestamp as a database-formatted UTC string, and compare that exact timestamp together with the ID tie-breaker. Keep the display timestamp separate.
