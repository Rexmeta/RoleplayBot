---
name: Culture experiment lease safety
description: Paid experiment concurrency needs shared fail-closed ownership, including timeout quarantine.
---

Use PostgreSQL ownership leases for culture autofill and comparison; do not reuse the Redis rate limiter's memory fallback. Preserve shared user exclusion and the two-batch capacity limit across workers.

**Why:** The existing Redis limiter intentionally falls back to process-local memory on failure, which is acceptable for best-effort rate limiting but cannot protect paid work across instances. Existing settings storage supports short serialized transactions without an operational schema change.

**How to apply:** Check ownership before every new paid call and before publishing results; renewal and release must match the owner's token. Expired owners must never renew themselves or release replacement work.

Do not immediately release ownership on timeout or lost storage access. Stop renewal, abort local work and let the lease expire.

**Why:** Provider SDK cancellation may not settle remote work immediately. Releasing at the HTTP deadline permits an immediate second paid call. A lease cannot revoke an already accepted external provider request or prove its final billing outcome.

**How to apply:** Keep bounded quarantine on uncertain completion and distinguish app-side duplicate prevention from provider-side exactly-once billing. Any real paid verification and operational changes still need separate approval.
