---
name: GitHub sync via connector API
description: Local git cannot fetch/push to origin (no credentials); GitHub sync must go through the Replit GitHub connector REST API
---

Local `git fetch`/`git push` to `origin` (https://github.com/Rexmeta/RoleplayBot) fails with "Invalid username or token" — no credential helper is configured. All GitHub reads/writes must use the attached GitHub connection via `listConnections('github')` + `proxyFetch` inside a `"use impure"` CodeExecution block.

**Why:** The repl has no git credentials, but an authorized GitHub connection with repo scope exists.

**How to apply:**
- Ref updates via `PATCH /repos/{o}/{r}/git/refs/heads/main` fail 422 "Object does not exist" until missing objects are uploaded. Recreate them in order blobs → trees (`base_tree` = parent tree) → commits, passing exact author/committer name/email/ISO date; the API reproduces byte-identical SHAs, verify each returned SHA against the local one.
- The connector proxy rate-limits at 10 RPS per repl and occasionally returns 502; serialize requests (~5 RPS) and retry 429/5xx with backoff.
- After changing a remote ref via API, update the cached tracking ref locally with `git update-ref refs/remotes/origin/main <sha>` since a real fetch is impossible.
