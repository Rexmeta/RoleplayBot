# Tavus Full Pipeline through AvatarRouter

## Current scope

The user approved enabling the currently available AvatarRouter API 0.6 behavior
first. This supersedes the earlier decision to block activation until shared PAL,
longer sessions and final-transcript support are available.

- RoleplayX calls only the existing server-side `AvatarProjectClient`. No direct
  Tavus requests or Tavus API key are used.
- AvatarRouter creates/deletes a PAL for each session. The maximum 120 seconds
  includes queue/startup time, not 120 seconds after browser connection.
- Tavus owns STT/LLM/TTS/video/interruptions. The client joins a private Daily call
  with microphone enabled and camera disabled; remote video/audio share that call.
- Final transcript and existing feedback integration require the optional router
  feature `tavus_final_transcript_v1`. When absent, live media still works and the UI
  explicitly explains that confirmed history/feedback await the router extension.
  Browser captions and unspoken full LLM responses are never used as final evidence.
- Text, Gemini Live and the external-audio avatar renderer remain separate.

## Availability and authorization

Reuse the configured AvatarRouter Base URL and server project key. Every external
request uses freshly verified local identity and the router's user context header.
`GET /auth/check` must advertise both `tavus_full_pipeline` and
`daily_private_connection` with create/read/connect/end scopes.

The existing global live-avatar setting, scenario policy and selected actor's live
avatar configuration gate availability. Start also validates the selected asset,
current project ownership and runtime budget/worker/cleanup limits. No stock face
is silently substituted for an invalid or unavailable selected custom avatar.
Published scenario/persona snapshots remain authoritative for per-session context.
Contexts above the router's 12,000-character limit fail explicitly, not truncated.

## APIs and learner flow

All routes require login and return `Cache-Control: no-store`:

- `GET /api/tavus/config?runId=...` — features, actor policy and limitations.
- Availability also performs a free `/live-limits` read under the verified user
  identity. It returns safe capacity values and separate worker, cleanup, user
  budget, project budget and router admission blockers. It is not a reservation.
  `selectable` describes feature/actor eligibility independently of transient
  runtime admission, so eligible learners can still open diagnostics when blocked.
- `GET /api/tavus/conversations/:id/session` — safe state, deadline, no room token.
- `POST /api/tavus/conversations/:id/start` — strict `{ "consent": true }`.
- `GET /api/tavus/conversations/:id/connection` — owner-only private Daily details.
- `POST /api/tavus/conversations/:id/end` — requests router cleanup.
- `POST /api/tavus/conversations/:id/sync` — after confirmed closure, imports the
  router-authenticated final transcript and durably queues existing feedback.
- `POST /api/tavus/pal` — retained admin route rejects; router manages session PALs.

Choose Tavus Full Pipeline before beginning a native text/Gemini conversation.
Accept the displayed audio/context transfer and cost consent and click start.
The router receives `POST /sessions` with `pipeline: "tavus_full"`, the validated
selected avatar, system role prompt, scenario/persona context and session language.
The mode selector does not mount/prewarm Gemini while choosing or running Tavus.
Native audio/text/ledger writes reject runs reserved for `tavus_full`.

Creation is asynchronous. Poll the bound session until active/running, no stop
request and no cleanup warning. Only then retrieve `/full-connection`. Daily
credentials remain in component memory only: not logs, localStorage, persisted
settings or query caches. Room URL hosts must be HTTPS Daily subdomains.
The UI distinguishes joining, waiting for media and browser audio playback blocks.
The optional live screen reuses the current realtime voice screen's full-viewport
stage, GoalsSidebar and TranscriptPanel, including visible-viewport bounds on mobile.
The browser displays provisional Tavus accumulated utterance events (streaming or
delayed full turns) and already-available Daily transcription events. It does not
start an additional transcription service. PAL/replica duplicates share a row;
out-of-order partials cannot overwrite a complete caption, and known interrupted
partials are not expanded by a later full LLM response.
These bounded, session-local captions are explicitly unverified, may be delayed
or unavailable, and disappear on navigation/reload. They never write canonical
messages, recognition evidence or feedback. Confirmed records replace, rather than
append to, provisional captions once imported through the router. This display
works independently of the router final-transcript feature. Existing image/text/
Gemini flows are unchanged.

## Recovery and verification boundaries

Existing settings storage with transaction advisory locks persists a pre-create
fence before the non-idempotent paid request. Never automatically retry session
creation. Unknown outcomes remain blocked for trusted router reconciliation.
The returned router ID is retained before later readiness checks.

Confirmed admission refusals before the create fence return
`creationAttempted: false`. Only this explicit server assurance lets the UI return
to idle and offer a free availability refresh, followed by a manual start.
Network errors and failures after the fence remain uncertain, never automatically
retried. Admission gates are not bypassed, budgets are not reset, and pending
cleanup is never cleared locally to permit a start.

End/page exit requests server-side cleanup and tears down Daily media. End
acknowledgement is not provider termination: polling/background recovery continues
until the router confirms closed with no cleanup pending. The worker never creates
sessions. No new tables or migrations are required in RoleplayX.

## Confirmed history and feedback

The AvatarRouter extension is maintained in Rexmeta/AvatarRouter and must be
reviewed/published there separately; changing this project does not deploy it.
It adds `GET /sessions/:id/transcript` (owner + tenant, sessions:read, no-store),
which reads Tavus's authenticated verbose end-of-call record. It returns pending,
unavailable, or ready with sessionId/source/final/revision/messages. Public API
specification and integration guide are updated in that repository.

RoleplayX only uses the endpoint when freshly advertised. It verifies the session
binding and canonical SHA256 revision before import. Stable ledger/message IDs
avoid duplicated utterances. A persisted lease serializes imports, and the worker
recovers pending/failed work after tab closure. The first accepted revision is
pinned so retrying failed feedback publication cannot silently replace evidence.
Successful import saves the existing chat history, enqueues the existing durable
feedback job with scenario/persona/rubric snapshots, and completes the run through
the existing scenario completion logic. A non-success enqueue status must not
complete the run. Only then does the UI automatically invoke the original feedback
navigation callback once per conversation, using the same generation/progress/
error/report screen as voice live. Transcript completion means durable evaluation
submission, not a finished report. Empty/no-learner transcripts do not produce scores.
The foreground waits up to five minutes for delayed final transcripts; manual
status checks and the background recovery worker remain available after that.
A freshly advertised transcript capability also allows recovery of older sessions
previously marked unavailable, without promoting browser captions into evidence.

See [duration extension plan](tavus-duration-extension.md) for the coordinated
router/provider/application changes needed beyond the current 120-second limit.

Automated mocked tests cover ownership/consent, feature/actor gating, router
payloads, uncertain-create fencing, Daily credential validation, cleanup state,
client media teardown and suppression of unsupported evaluation.
They do not certify actual paid Tavus creation, microphones, audiovisual playback,
Korean recognition or persona fidelity. Paid tests and production changes require
separate approval.

Contract sources:

- https://avatar-router.replit.app/roleplayx/openapi.yaml
- https://avatar-router.replit.app/roleplayx/tavus-full-pipeline.md
- https://avatar-router.replit.app/roleplayx/integration-guide.md
