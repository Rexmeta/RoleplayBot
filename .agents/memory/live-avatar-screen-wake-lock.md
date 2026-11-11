---
name: Live avatar screen wake lock
description: Keep the mobile display awake during an active foreground live-avatar session.
---

Request the Screen Wake Lock synchronously from the user's live-session start action,
retry when the page returns to the foreground, and release it on session end or exit.
Treat the API as optional: browsers without support must still allow the session to run.

**Why:** Mobile browsers dim and lock the display during low-interaction video calls,
forcing users to touch the screen to continue watching.

**How to apply:** Keep the lock scoped to the active live-avatar session; do not use
background polling or fake media playback as a fallback. Screen Wake Lock availability
varies by browser and operating-system version.
