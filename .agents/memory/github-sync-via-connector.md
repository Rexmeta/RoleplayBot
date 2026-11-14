---
name: GitHub sync via connector API
description: Prefer the authenticated internal Git remote when available; use the connector API for other GitHub operations or fallback sync
---

Check the current remote before choosing a sync method. The authenticated
`https://github.replit.internal/Rexmeta/RoleplayBot` origin supports ordinary
fetch/push without handling credentials. The older direct github.com origin
failed with "Invalid username or token"; that historical failure does not apply
to the internal proxy.

**Why:** Replit's authenticated internal Git proxy became available after the
earlier connector-only workaround. Standard Git preserves merge ancestry and
avoids unnecessary API object reconstruction.

**How to apply:**
- Inspect the current remote and try normal Git through the internal proxy when
  present. The local Git safety guard may require `DANGEROUSLY_ALLOW_GIT=1` for
  authorized fetch, worktree, commit and push operations; it is not an auth failure.
- For PR metadata and fallback sync, use the attached GitHub connection via
  `listConnections('github')` + `proxyFetch` inside a `"use impure"` block.
- Ref updates via `PATCH /repos/{o}/{r}/git/refs/heads/main` fail 422 "Object does not exist" until missing objects are uploaded. Recreate them in order blobs → trees (`base_tree` = parent tree) → commits, passing exact author/committer name/email/ISO date; the API reproduces byte-identical SHAs, verify each returned SHA against the local one.
- The connector proxy rate-limits at 10 RPS per repl and occasionally returns 502; serialize requests (~5 RPS) and retry 429/5xx with backoff.
- After changing a remote ref via API, update the cached tracking ref locally with `git update-ref refs/remotes/origin/main <sha>` since a real fetch is impossible.
