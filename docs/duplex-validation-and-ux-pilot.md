# Duplex validation and UX pilot

## Evidence categories

Do not merge synthetic PCM/hook tests, authenticated component tests, real
browser/device observations, live provider sessions, subjective UX, model
quality, or educational outcomes into one “validated” claim.

### Implementation verification — 2026-11-09

* `npm run check`: passed.
* `npm run build`: passed. Existing large-bundle/static-vs-dynamic-import
  warnings remain; this is a production build, not a production deployment.
* Recorded `npx vitest run`: 163 files passed, one skipped; 2,837 tests passed,
  four skipped. The suite still prints existing localhost:3000 connection
  diagnostics; they did not cause failed assertions in this run.
  A subsequent completion rerun exposed an intermittent five-second timeout in
  existing model-selection tests passing synthetic bytes to native FFmpeg.
  Those unit tests now isolate the native-process boundary; production media
  processing and the native-media test coverage are unchanged. Their passing
  assertions validate model selection, not playable output or physical audio.
* The final diagnostics-only additions were checked with eight related
  client/contract test files: 132 tests passed.
* Close admission was additionally checked across six server/provider/Ledger
  test files: 273 tests passed. The new cases hold finalization pending, send
  response/text/new-evidence commands immediately after the close packet, and
  verify rejection in both closing and frozen states while existing playback
  observations remain permitted.
* Isolated, temporary PostgreSQL integration: 14 tests passed, including mode
  pin/restore, stale epoch/persona rejection, cancelled-output vs persistent
  scenario emotion, immutable close snapshots and late-event/job-token safety.
  A close-then-reconnect regression explicitly leaves the parent run active:
  the closed Ledger/frozen runtime rejects reopening, preserves the snapshot
  and job token, and admits late evidence only to the live record.
  The temporary cluster was removed afterward; no production data was tested.
* Development application startup/migrations succeeded on port 5000.
  Browser capture of `/system-admin` rendered the existing login guard.
  The authenticated administrator/conversation UI was **not** verified in a
  real signed-in browser. The new settings component's load/save/dependency/
  malformed-data/error behavior was verified in the component harness.
* Live Gemini/OpenAI/AvatarRouter calls, physical speaker audibility, real-device
  latency, Bluetooth/iPhone checks and participant UX sessions were not
  performed. No real p95 target attainment, model-quality improvement or
  educational-effect improvement is claimed.

The labelled test envelopes in `tests/fixtures/duplexVadCases.ts` contain eight
synthetic cases: two intended interruptions, two acknowledgements, two noise
bursts, two residual echoes. Labels are stipulated ground truth, not inferred
from duration. All cases use the same 0.1 RMS, 4096-sample synthetic input,
50-ms delivery cadence, threshold and local-output mock. The provider-labelled
test iterations use the same client algorithm, not paid Gemini/OpenAI sessions.

Expected comparison on this deliberately limited set:

| Policy | Valid decisions / valid cases | False interruptions / non-interrupting cases |
| --- | --- | --- |
| baseline, 300 ms | 2 / 2 | 2 / 6 |
| candidate, 0 ms | 2 / 2 | 6 / 6 |
| sustained confirmation, 500 ms | 2 / 2 | 1 / 6 |

This illustrates the tradeoff, not production accuracy. Long echo still
resembles speech acoustically. No policy is declared universally superior.

## Technical measurement protocol

Record provider/model configuration, run/scenario/persona snapshot IDs,
language/difficulty, browser/OS/device, mic/output route (built-in/wired/
Bluetooth), sample rate, network condition, policy, cache state and feature mode.
Match these between baseline and enhanced runs. Keep original audio/transcripts
out of new diagnostic logs; use labelled case IDs, transition IDs and timing/
buffer metadata.

* **Detection latency**: candidate detector time minus labelled acoustic onset.
  Denominator: all valid interruption opportunities; record misses separately.
* **Decision → local cancel command**: time from the selected policy's decision
  to invoking local stop. Denominator: valid decisions with a local player.
  Report N, median/p95 and missed measurements. Target p95 ≤200 ms is proposed,
  **not measured on real devices**. Do not hide the separate detection delay.
* **False interruption rate**: non-interrupting labelled opportunities that
  caused local stop / all acknowledgement, noise and echo opportunities.
* **Cancellation success**: decided local interruptions with generation
  invalidated and no subsequent old-generation scheduling/callback mutation
  within 2 seconds / all decided local interruptions.
* **Normal response resumption**: valid subsequent provider responses admitted
  and locally scheduled before a 10-second observation window ends / valid
  subsequent responses received after interruption. Separate provider no-
  response from client rejection. Report external playback as not observable.
* **Expression boundary → apply**: client presentation callback time minus
  matching observed local output start, or matching segment boundary where
  available. Denominator: outputs with authoritative emotion available and a
  locally observable boundary. Target p95 ≤150 ms is proposed, **not a result**.
  Separate cold asset load, minimum-hold deferral and late server analysis;
  report missing alignments rather than silently excluding them.
* **Evidence integrity**: duplicate finals, omitted learner finals, wrong
  output/persona expression, and changed frozen job hashes / tested
  opportunities, grouped by reconnect/interrupt/end-race case.

Count distinct opportunities, not callbacks or PCM chunks. Report each
provider/route/device stratum separately, N and observation window included.
No actual speaker audibility, provider capacity, model response quality or
learning improvement follows from these implementation tests.

The bounded diagnostic trace has separate `vad-candidate`, `vad-confirmed`,
`vad-cancel`, `stop`, `playback-observed` and `expression-applied` entries.
Playback reason codes are 0=start, 1=complete, 2=interrupted, 3=not played,
4=failed. All entry timestamps use the same browser monotonic clock; server
timestamps remain separate metadata. Expression `durationMs` is total observed
turn-start-to-apply time, including late analysis/minimum hold, not a claim about
renderer execution cost. Its emotion/persona revisions and output generation
permit matching without logging emotion text, dialogue, audio or device IDs.

## Device/provider matrix

| Path | Chrome desktop | Android Chrome | iPhone Safari |
| --- | --- | --- | --- |
| Gemini, built-in mic/output | live session not performed | not performed | not performed |
| OpenAI, built-in mic/output | live session not performed | not performed | not performed |
| Wired headset | not performed | not performed | not performed |
| Bluetooth, device changes | not performed | not performed | not performed |
| AvatarRouter transport vs renderer ACK | live session not performed | not performed | not performed |

For each real-device run check mic remains live during AI output; repeated
interruptions; no stale tail after provider boundary; new-response resumption;
long queued audio after generation complete; background/foreground; permission
retry; output loss/Bluetooth auto-selection; iOS play-and-record/system route;
browser chrome/keyboard; persona switch/reconnect; late emotion/cold image/clip
failure; voice/text switches; turn/time limits; and end/page-exit races.
Do not make paid calls or load tests without separate approval.

## UX pilot protocol — defined, not executed

Status: **no participants recruited, no sessions conducted, no paid calls, no
results**. The following is a prospective protocol, not an outcome report.

* Recruit 12 adult volunteers who can comfortably complete the selected Korean
  workplace-roleplay task, with consent to a technical usability pilot.
  Exclude anyone involved in implementing the compared conditions.
* Each participant completes two matched three-minute roleplays using the same
  frozen scenario/persona, language, difficulty, model/version, device, input/
  output route and network condition. The script includes two instructed
  interruption opportunities and one scenario event. Do not change rubric or
  event weights between conditions.
* Assign six participants baseline→enhanced and six enhanced→baseline, with
  random assignment recorded before sessions. Use a short practice unrelated to
  the measured scenario and a two-minute break. Repeated exposure/learning is
  unavoidable; record order, prior roleplay familiarity and any changed condition.
  Do not interpret order effects as product effects.
* Record early termination, reason if volunteered, interruption/task completion,
  feature mode and condition deviations. Participants may stop immediately
  without penalty. Report all enrolled participants and missing paired responses;
  do not impute a successful experience for withdrawn participants.
* After each condition ask the same four questions on a 1–7 scale, anchored
  1=strongly disagree and 7=strongly agree:
  1. “I could interrupt the character naturally when I wanted to.”
  2. “The character's expression and voice felt consistent.”
  3. “I felt engaged in the conversation.”
  4. “The conversation responded without noticeable delay.”
  Also ask an optional open question: “What most disrupted the conversation?”
  After both conditions collect preference and reason, separately from ratings.
* Before recruitment, freeze the analysis plan: paired per-question differences,
  median/IQR, complete-pair N and descriptive order-stratified summaries.
  Report withdrawals/deviations and raw distribution counts. Treat this small
  pilot as exploratory; do not select only favourable questions or claim
  statistically established educational benefit.

### Prospective report template

1. Execution status, consent/approval and recruited/completed/withdrawn N.
2. Frozen conditions and any deviations, order distribution and participant
   eligibility summary without identifying personal data.
3. Technical KPI table: metric, provider/device/route, denominator, N,
   successful/missed/unknown observations, median/p95, baseline vs enhanced.
4. UX table: condition, question, complete-pair N, median/IQR, paired difference,
   order-stratified counts, withdrawals and optional-comment themes.
5. Separate sections for model-quality assessment and educational-effect
   assessment. If not separately studied, write “not assessed.”
6. Limitations and decisions for a separately approved next pilot/rollout.
