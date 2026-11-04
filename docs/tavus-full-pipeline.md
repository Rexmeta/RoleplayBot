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
- Final transcript retrieval and automatic evaluation are **not available**.
  The UI explicitly says so and never invokes the report completion callback.
  Existing transcript adapters are retained for a future authoritative source;
  browser captions are not imported as confirmed evidence.
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
- `GET /api/tavus/conversations/:id/session` — safe state, deadline, no room token.
- `POST /api/tavus/conversations/:id/start` — strict `{ "consent": true }`.
- `GET /api/tavus/conversations/:id/connection` — owner-only private Daily details.
- `POST /api/tavus/conversations/:id/end` — requests router cleanup.
- `POST /api/tavus/conversations/:id/sync` — safe status refresh, not transcription.
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

## Recovery and verification boundaries

Existing settings storage with transaction advisory locks persists a pre-create
fence before the non-idempotent paid request. Never automatically retry session
creation. Unknown outcomes remain blocked for trusted router reconciliation.
The returned router ID is retained before later readiness checks.

End/page exit requests server-side cleanup and tears down Daily media. End
acknowledgement is not provider termination: polling/background recovery continues
until the router confirms closed with no cleanup pending. The worker never creates
sessions. No new tables or migrations are required in RoleplayX.

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
