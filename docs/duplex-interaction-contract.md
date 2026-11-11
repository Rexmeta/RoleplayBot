# Duplex interaction contract

## Scope and baseline

This extends the existing Gemini Live/OpenAI Realtime adapters, audio queue,
avatar state machine, image/clip renderers and Ledger. It does not replace the
voice stack, introduce Shizuku, a second simulation engine, a replay product,
Tavus direct calls, or new generated media. Existing provider model selection,
language configuration (`ko/en/ja/zh`), VAD thresholds, capture, iOS audio session,
Bluetooth/default-device routing, text/TTS, harness snapshots and scoring weights
remain owned by their existing modules. No four-week schedule is adopted.

Baseline flow: microphone → local VAD and provider VAD → provider adapter →
`audio.delta` → queued PCM scheduling → avatar state machine → provider final
transcripts → Ledger → existing feedback jobs. The legacy UI used generation
completion as speaking completion and applied response emotion from a deferred
transcript callback. The enhanced path instead uses the local output observer
and independently delivered server character state.

## Ownership and clocks

* UserAffect remains an estimate about the **learner**. It is never copied into
  CharacterEmotion or converted into a score adjustment.
* ScenarioState is the existing Simulation Engine's authoritative versioned
  state. CharacterEmotion reads accepted simulation updates; it does not patch
  or copy that engine into another state machine.
* CharacterEmotion is server-owned and persisted per run in `duplex_runtime`.
  It records canonical emotion key, bounded intensity, confidence, source,
  revision, persona generation, cause kind/ID/sequence, scenario version or output
  and connection linkage. The existing response analyzer has no calibrated
  intensity/confidence output: its adapter explicitly uses 0.5, not a measured
  model probability. Simulation-derived proposals use the existing affective
  axes. Accepted updates use inertia (65% previous, 35% proposed) and a 0.85 cap.
* ExpressionPresentation is a client presentation decision. Applying an image
  or clip never writes server character state.
* AudioPlayback is an observation of Web Audio scheduling and node completion,
  not evidence that a person physically heard the speech.

Every enhanced output event carries version, run ID, session ID, logical turn
ID, provider-connection generation, persona ID/index/generation, output
generation (compatible with existing `turnSeq`), event ID, sequence and server
wall-clock time. Deferred callbacks capture this identity **before** mutable
turn counters advance. Server wall time is never compared to AudioContext time
to schedule media. Playback offsets use only that context's clock.

Browser duplicate/out-of-order packet sequences are ignored. OpenAI's provider
event IDs are deduplicated in a bounded connection-local set. Gemini supplies no
per-audio-chunk response ID in this path; identical audio bytes are not a safe
identity and are not content-deduplicated. The existing cross-source
top-level/inline-audio and transcript-source deduplication remains in place.

## Generation and cancellation

Generation start/finish, local observed start/finish, interruption, output error,
provider-final transcript, and character-state update are separate events.
An empty pending chunk queue does not mean scheduled nodes have ended.
The local player requires generation finished + no pending asynchronous chunks +
no scheduled sources + no unfinished output records before clearing speaking.

On a cancellation decision the player increments its generation **before**
stopping nodes, discards queued work, invalidates callback ownership and clears
output-owned expression timers. Cancel-induced `onended` is not normal
completion. Each queued scheduling task, post-await continuation, start
observer, end callback, expression timer and image/clip load checks its lifetime.
The old queue cannot revive even if a subsequent `response.ready` clears the
interruption flag. Shared output-device initialization still must finish before
a newly accepted output uses the same context.

Local output cancellation never waits for server ACK. Gemini residual output is
quarantined until `interrupted` or `turnComplete`; an already generation-complete
output with only local tail audio does not unnecessarily require another
provider boundary. OpenAI uses distinct response IDs to permit the new response
even before an old cancellation ACK. Late old-ID events cannot cancel it.
No new provider session or extra TTS is introduced.

Candidate detection is acoustic threshold entry; baseline interruption waits
300 ms, candidate policy waits 0 ms, and confirmed policy waits 500 ms of
sustained acoustic evidence. “Confirmed” here means sustained VAD evidence,
**not semantic proof** of intent or provider-final learner transcription.
Provider finality alone upgrades provisional speech to final. Short
acknowledgements/noise and echo are not guaranteed distinguishable without text.

## Expression causality and rendering

Persistent scenario-caused state survives cancellation of an output. Output-only
analysis is rejected if its output was cancelled. Persona generation, run epoch,
cause order, scenario version and emotion revision prevent stale overwrites.
Reconnection restores persisted authority; a new run/persona initializes it.
No historical session is reinterpreted using current settings.

Expressions use an output's observed local playback start or a still-playing
matching output. Minimum presentation hold is 600 ms; server confidence and
intensity are bounded before delivery. A late result can update valid persistent
authority for a subsequent output, but cannot replay the expression for an ended
or interrupted output. No word/phoneme alignment is available: this is
**turn-level synchronization**, not lip sync.

Existing image/clip assets are reused. Failed images attempt neutral/base
fallback and expose diagnostic asset status; failed clips retain the still.
Preloads, transition/fade timers and persona initialization callbacks are
generation-fenced. The listening nod is silent, at most once per sustained
speech episode with a 3-second cooldown, and never sends provider text or
increments a learner turn, tool trigger or evaluation count.

Spoken backchannels are default OFF and currently rejected even if requested:
neither configured adapter has a verified app-level concurrent backchannel
primitive. No extra paid speech is silently substituted. There is no new
autonomous silence-response timer. Existing capture-tail timers are cancelled
on output, reconnect, stop and disconnect; ending cannot schedule another prompt.

## External output paths

AvatarRouter routing stays through the existing bridge. Local browser
AudioContext observations are not fabricated for that path. The bridge's
`avatar.playback.done` is a **transport drain/activity indication**, not proof of
external renderer playback or listening. Missing external playback ACK remains
not observed/unknown in the Ledger, and may block evaluation under the existing
eligibility policy. Full Pipeline internals remain outside app control.

## Finite evaluation barrier and immutable input

Enhanced evaluation requires an already enrolled `ledger-v1` run. It does not
silently migrate legacy sessions or change recognition/scoring eligibility.
The first valid close request starts a shared 10,000-ms deadline. New capture/
response initiation is disabled while existing provider-final transcript work,
ordered Ledger writes, tracked analysis and terminal playback observations
drain. Readiness is polled at 20 ms; an independent timer bounds hung promises.
Socket admission closes synchronously before the close operation's storage
awaits. `response.create`, `conversation.item.create`, fresh text submissions and
new utterance registrations are rejected while closing/frozen. Existing capture
commits/gaps, recognition confirmation and playback observations remain eligible.
Re-entering finalization cannot recapture a newer permissible output generation.
The deadline callback wins over readiness first observed at exactly 10,000 ms.
Connection loss releases explicitly as `connection_lost`; unresolved data is
not promoted to completed/final.

After release, the existing per-run transaction lock defines the exact
watermark: events committed before that lock's snapshot are included; later
events remain later evidence. Closure atomically records barrier start,
deadline, outcome, timeout, watermark and immutable snapshot ID along with the
existing feedback job payload/token. Concurrent end/page-exit requests share the
same barrier/freeze and return the same snapshot. Late evidence may update the
current Ledger but cannot replace the job input or its eligibility/status.
Retries continue using the captured payload and snapshot.

Only an explicit learner recognition correction can request a new immutable
snapshot/job token after closure. That is a new evaluation input; previous
payloads/snapshots are not rewritten and stale workers remain token-fenced.
Reports still retain their snapshot binding.

Generated provider text and playback state/observed milliseconds are separate.
`not_played`, `started`, `interrupted` (partial), `completed`, `failed`, and
`not_observed/unknown` remain distinguishable. No proportional text truncation is
used to claim which words were heard. Existing blockers prevent unresolved/
partially played voice evidence from being scored as completed delivery.
Emotion/expression events are never automatic scoring inputs.

## Rollout and rollback

The system-admin settings page exposes `voice_duplex/config`. Defaults are
baseline (all booleans false, `bargeInPolicy=baseline`, spoken backchannels OFF).
Dependencies are validated on client, settings write and session creation:

| Feature | Required predecessors |
| --- | --- |
| playbackLifecycle | interaction |
| characterEmotion | interaction |
| expressionSync | characterEmotion + playbackLifecycle |
| evaluationSnapshot | interaction + playbackLifecycle + ledger-v1 run |
| silentReactions | interaction |
| candidate/confirmed interruption policy | playbackLifecycle |
| voiceBackchannel | rejected until provider capability is verified |

The validated configuration is persisted at the run's first voice session,
then retained through reconnects and voice/text switches. Saving another
configuration cannot re-authorize that run's state or change its history.
Stage interaction/lifecycle first, then character/presentation, then evaluation.
Use a new run for each stage. Baseline rollback applies only to new runs; do
not activate old and new output/emotion/evaluation implementations together.
The migration is additive and ensured by both numbered SQL and startup schema.

Diagnostics reuse the bounded metadata-only output trace (IDs, transitions,
buffer lengths and clock-local timings). No raw audio or transcript body is
added to this diagnostic stream.
