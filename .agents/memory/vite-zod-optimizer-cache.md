---
name: Vite Zod optimizer cache
description: Browser-side Zod version mismatch after a major dependency upgrade
---

After a Zod major upgrade, a browser runtime error for a new Zod API can come from Vite's stale optimized dependency bundle even when Node resolves the upgraded package.

**Why:** The development runtime resolved Zod 4 with `partialRecord`, while the browser's optimized Zod artifact still contained the Zod 3 implementation and lacked that function.

**How to apply:** Compare the installed package and the served optimized artifact before changing schema code. Refresh the Vite optimizer cache and restart the development workflow, then confirm the browser loads the matching major version.
