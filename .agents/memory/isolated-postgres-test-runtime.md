---
name: Isolated PostgreSQL test runtime
description: Run isolated PostgreSQL integration tests reliably in this workspace.
---

Run a temporary local PostgreSQL cluster and the integration test in the same shell invocation. A server detached by one shell command may not remain available to a later tool call. Use an explicitly named test database and remove the temporary cluster after testing.
Set the local socket directory explicitly under the temporary cluster and pass the cluster owner's username explicitly to database client commands.

**Why:** Shell-launched background processes may be cleaned up between tool calls, and the application's PostgreSQL pool enables SSL unless the connection URL explicitly disables it; a local server does not support that SSL request.
Managed PostgreSQL defaults may select a different role, and the package's default socket directory may not exist. These are test-runtime issues, not application database failures.

**How to apply:** For local integration tests, start PostgreSQL, run Vitest with a dedicated `*_TEST_DATABASE_URL` containing `sslmode=disable`, and stop/remove the cluster in the same command.
