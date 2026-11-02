# Optional scenario live-avatar runtime

This is an opt-in extension of the existing dialogue engine, not a replacement
for its prompts, evaluation, transcripts, or default image/video playback.

## Operator workflow

1. Configure an AvatarRouter project key with the session lifecycle scopes and
   `assets:read`; custom generation and playback reports also need `assets:write`.
2. In persona editing, select **Live**, choose the stock Lucy avatar or a ready
   custom Tavus asset, and save. The selected-avatar test button opens that exact
   target's diagnostic. Merely opening the panel never creates a paid session.
3. For custom assets, complete the video/audio test and save the playback report.
   Provisioning success alone does not authorize custom conversation playback.
4. Enable the global live-avatar setting and the scenario's live permission.
5. Start a new scenario conversation, select realtime voice, open its top menu,
   open the live-avatar options, consent to external audio transfer/cost, and start.

Live video replaces the portrait only when media is playable. Closing the menu
does not unmount the media consumer. Existing image/video remains visible while
connecting. Unsupported selections and missing permissions are reported rather
than silently substituting stock Lucy.

Published runs resolve the persona configuration from their bound snapshot;
editing a master persona does not retroactively change existing runs.
The legacy stored `activation: draft` marker represents a saved reference; actual
runtime authorization is always computed server-side from the run and current
provider metadata, not granted by a browser-supplied activation field.

## Owned conversation API

Prefix: `/api/live-avatar/conversations/:conversationId`

- `GET /availability`: policy/selected-target check, no session creation.
- `GET /session`: recover an existing owned binding; reconcile uncertain creates
  by reads, never repeat a remote create.
- `POST /sessions`: strict `{service: "avatar-router", consent: true}`.
- `GET /sessions/:id`: poll asynchronous renderer state and confirm end cleanup.
- `GET /sessions/:id/connection`: ephemeral subscribe-only LiveKit credentials.
- `POST /sessions/:id/media-ready`: strict `{}`, only after playable media.
- `POST /sessions/:id/interrupt`, `POST /sessions/:id/end`: strict `{}`.

Ownership is checked on every route. Lifecycle recovery/end remain available
when a policy or selected asset becomes unavailable. Active media is stopped if
subsequent polling detects revoked permission or a changed selection.
Remote session/asset IDs, credentials, and user context cannot be supplied as
arbitrary browser overrides.

## Audio and recovery contract

Only server-produced AI PCM reaches the avatar transport. Gemini inline MIME
metadata must identify 24 kHz PCM; top-level audio without matching metadata is
not forwarded. OpenAI's configured PCM16 output is 24 kHz. Invalid/unknown formats
fall back to the existing voice path.

The provider accepts bounded clips, not a continuous Gemini audio stream.
PCM is buffered into one-second clips, paced and sent at most once, with bounded
memory and short final-tail padding. Client playback of the same PCM is suppressed
only while the ready renderer owns audio. Transcript processing stays unchanged.
Timeouts are not retried, because the provider may already have accepted a write.
Uncertain paid creates remain durably fenced and are reconciled by session reads.

Interruption, actor changes, reconnect, transport failure, or expiry stop the live
consumer and request cleanup; subsequent dialogue uses the existing voice path.
The learner can explicitly start again after cleanup is confirmed. Sessions are
bounded by the provider's current limits (at most 120 seconds), not auto-renewed.

## Verification boundary

Mocked lifecycle/media tests and compilation do not establish actual provider
playback, device routing, latency, or lip-sync quality. No paid session or actual
image/audio transfer is authorized merely by implementing this feature. Actual
end-to-end tests require separate consent and are not a production deployment.
