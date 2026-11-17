# Live avatar early termination investigation

## Observed evidence

Read-only queries against the configured AvatarRouter returned the following
for the reported Tavus full-pipeline session on 2026-11-17 (UTC):

- Created: 05:52:47.308.
- Router connection ready: 05:52:59.877.
- First client video observation: 05:53:10.083.
- Closed: 05:53:53.496, after approximately 66 seconds.
- Scheduled expiry: 06:02:47.588 (600-second allocation).
- Final state: `failed`; public `error` and `failure`: `null`.
- Owned event sequence: `connecting`, `started`, `failed`.
- Closure event confirmed resource cleanup; it did not identify why the
  worker terminated the call.

These are upstream session/event responses, not observations from the local
router clone. They establish early failure, not provider billing or a
particular infrastructure shutdown. The historical upstream worker logs and
operator-only lease diagnostics were not accessible with this app's project
key. Do not label a scale-down, database interruption, or deployment as the
confirmed incident trigger without those records.

## Confirmed code defects

1. The router's worker shutdown called provider cleanup for an active native
   Tavus call even though its media runs directly between browser and provider.
2. Recovering an expired worker lease likewise selected cleanup instead of
   adopting supervision of an already-known, running native call.
3. Cleanup without a stop status defaulted to `failed` before expiry, and could
   leave the public error empty. This is consistent with the incident's
   evidence but does not distinguish graceful shutdown from lease recovery.
4. The app mapped an active/running native call with a transient
   `cleanupPending` lease indicator back to `creating`. That unmounted the media
   component, whose cleanup intentionally sends `/end`. Thus a transient
   supervision interruption could become an actual call termination.

## Changes and safety boundaries

- Reattach supervision only for active, known, running Tavus native calls with
  their persisted provider identity and connection metadata, no stop/error
  flags, and a future original deadline.
- Do not create another provider persona, conversation, token, or browser
  connection. Preserve the same original expiration.
- Graceful worker handoff and lease loss do not end that existing native call.
  `worker_handoff` and `worker_resumed` events distinguish supervision from
  media startup.
- Expired calls, explicit stops, incomplete/unknown creation, Anam, and external
  PCM rendering retain their cleanup behavior.
- The app keeps media mounted while the router reports the same call as active
  and running. Explicit stop, failure, expiry, or actual stopping still wins.
- Owned event reads use the existing project-key and verified-user boundary;
  operator diagnostic APIs remain inaccessible.

## Verification scope

App unit/integration tests and isolated PostgreSQL router tests exercise worker
shutdown, recovery, no duplicate paid creation, exact expiry preservation,
explicit user termination, expired-call cleanup, and active media state.
All provider requests in router tests are mocked. No new paid call or production
deployment was performed. The router correction requires a separately approved
merge and publication in the AvatarRouter project; a local fix is not evidence
that the running router has changed.

## Completion-check blocker

The relevant app tests (92), router tests (37), type checks and code review
passed. The full app `npx vitest run` did not pass: it also collected the
downloaded router's separate `node:test` suites, and reported 11 existing UI
failures (six outdated Tavus UI expectations and five missing auth-provider
fixtures). Router test discovery is now explicitly separated from the app and
that separation was verified. The UI failures were not hidden or skipped;
the outdated Tavus expectations already belong to a separate in-progress task.
This investigation/fix is therefore not marked complete pending successful
full-suite validation.
