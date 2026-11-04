# Tavus Full Pipeline

## Scope and isolation

The optional Tavus mode is independent of the existing text and Gemini Live modes.
It does not stream Gemini audio through Tavus or AvatarRouter. Tavus provides STT,
LLM, TTS, avatar video, lip sync and interruption handling in a hosted Daily room.
The Tavus branch unmounts the normal chat component, so its realtime hook cannot
open a Gemini WebSocket. The server also rejects native speech/text/ledger writes
for a run reserved for Tavus.

The current workspace includes GitHub `main` and additional work. No reset to
`main`, removal of existing avatar features, dependency installation or schema
migration was needed.

## Server configuration

- `TAVUS_API_KEY`: server-only secret. Never use a `VITE_` prefix.
- `TAVUS_PAL_ID`: optional existing **Full Pipeline** PAL to reuse.
- `TAVUS_DEFAULT_FACE_ID`: required when creating the initial shared PAL rather
  than selecting an existing PAL. Use a face available in the Tavus account.

With a face configured, the first explicitly consented start creates the common
PAL through `POST /v2/pals`, with `pipeline_mode: "full"`. Its ID is persisted in
the existing settings store. All subsequent runs reuse it. An administrator can
also explicitly initialize it through `POST /api/tavus/pal`.

Do not patch the shared PAL per persona or scenario. Per-run role, communication
style, goals, background, language and scenario context are included in
`conversational_context` on `POST /v2/conversations`. Published scenario/persona/
evaluation snapshots remain authoritative. Unbound runs read existing DB
scenario and persona records. Private evaluation rubrics are not sent to Tavus.
The shared PAL has no participant memory tags, so one learner's conversation is
not added to another's memory. Perception and recording are disabled by default.

**Limit:** a shared PAL uses a shared TTS voice. Dynamic context can request
different diction and behavior; it does not select a different physical voice.
Actual role consistency and speaking style still require live verification.

## Learner flow

When Tavus is configured, a fresh conversation offers a pipeline choice before
Gemini can preconnect. Select “Tavus Full Pipeline” there or in the existing chat
avatar area **before sending messages or starting a Gemini call**. Existing transcripts are never overwritten
or mixed with a new Tavus transcript; an already-used run requires a fresh run.
Accept the explicit audio/context transfer and provider-charge consent, then
start. There is no automatic paid start.

The server creates a private room (`require_auth: true`, two participants) and
returns the provider's room URL with a short-lived meeting token, not an API key.
The iframe has microphone/camera/autoplay permissions. The room handles device
selection, participant media and interruptions. The app calls the Tavus End
Conversation API when ending or leaving.

Calls have a maximum duration capped at 30 minutes (shorter scenario targets are
honored), a 60-second absent-participant timeout, and a 20-second timeout after
the last participant leaves. These provider-side limits also apply when browser
cleanup cannot be delivered.

## APIs

All application endpoints require the existing login:

- `GET /api/tavus/config`
- `POST /api/tavus/pal` — system administrator only
- `GET /api/tavus/conversations/:personaRunId/session`
- `POST /api/tavus/conversations/:personaRunId/start` — `{ "consent": true }`
- `POST /api/tavus/conversations/:personaRunId/end`
- `POST /api/tavus/conversations/:personaRunId/sync`

Only the actual run owner can start, read, stop or synchronize a room. An
administrator role does not confer ownership of another learner's room token.
Lifecycle responses are `no-store`. Upstream response bodies and room tokens
are not written to logs.

## Transcript and existing evaluation

After Tavus ends the conversation, the server reads
`GET /v2/conversations/{id}?verbose=true`. Only the
`application.transcription_ready` event is eligible. `assistant` becomes `ai`,
`user` remains `user`; system/tool entries are excluded. Original timestamps
and repeated utterances are preserved. Interim browser captions are not trusted.
If the final transcript is not ready, the UI waits and offers a synchronization
retry; the application does not fabricate a transcript or evaluate missing text.

For legacy runs, the adapter writes existing `chat_messages` with deterministic
IDs. For ledger runs, it records provider `tavus` as an **imported text
transcript**, closes an immutable ledger snapshot and submits the existing
durable feedback job. This does **not** assert independent audio/STT verification
or actual speaker playback. Provider source timestamps are retained in ledger
metadata. Tavus-only feedback inputs use the existing voice-mode rules.

Scoring providers, rubrics, weights and report generation are otherwise unchanged.
Existing native simulation tool calls, live stage transitions and automatic
multi-persona switching are not executed by Tavus: this initial PAL stays in the
selected role. The adapter supplies final conversation evidence to the existing
holistic evaluation; it does not invent native simulation scores.

## Recovery and cost safety

The existing settings table stores session bindings and a singleton PAL record.
Database advisory locks and a committed pre-create fence prevent duplicate
billable creates across repeated clicks/processes. HTTP creation is never
automatically retried. An uncertain create remains blocked; check the provider
dashboard before attempting recovery. If a timed-out provider create returned
no ID, reconcile it externally; do not clear the fence and blindly create again.
For uncertain PAL creation, identify the existing PAL and configure its
`TAVUS_PAL_ID` instead of creating another.

A background worker resumes safe end/read/transcript-import work after page exit
or a process restart. It never creates a conversation. Known provider IDs are
retained even if a room URL fails validation. Stable import/event IDs and
transcript hashes prevent duplicate or changed evidence from being published.

## Verification boundaries

Automated tests cover context isolation, API contract, private-room URL handling,
consent/ownership, singleton PAL reuse, duplicate/uncertain create fencing,
end-before-evaluation, final-transcript gating, and client Gemini-hook isolation.
They do not certify audiovisual synchronization, microphone quality,
interruptions, Korean recognition or persona adherence on the real provider.
Live tests require a configured key/face or PAL and explicit paid-test approval.
No provider resources are created merely by starting the development server.

Official contracts checked:

- https://docs.tavus.io/api-reference/pals/create-pal
- https://docs.tavus.io/api-reference/conversations/create-conversation
- https://docs.tavus.io/api-reference/conversations/get-conversation
- https://docs.tavus.io/api-reference/conversations/end-conversation
- https://docs.tavus.io/sections/onboarding-guide/pal-strategies
