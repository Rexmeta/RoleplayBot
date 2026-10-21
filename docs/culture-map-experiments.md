# Controlled Culture Map behavior comparisons

## Operation

Open `/admin-management?tab=culture-map` as a system admin and use **문화 행동 실험**
below profile management. Operators can continue using the existing profile UI
but cannot see or invoke this experiment.

1. Set the common name, personality, organization, Actor role and learner role.
   These define a standalone test persona; no saved Persona is changed.
2. Choose 1–3 accessible profile versions and an intensity for each. The same
   country/profile can be selected at different intensities. Dimension overrides
   are intentionally disallowed in this experiment.
3. Select one or two repetitions. OFF is always prepended by the server.
   Four situations × up to four conditions × two repetitions gives at most
   **32 logical cases**, not a hard cap on provider requests or spend.
4. **Mock 비교 실행** tests binding, wiring and presentation only. Its fixed
   response explicitly says it is not behavioral evidence; it invokes no provider.
5. To use the actual provider, tick the initially unchecked cost acknowledgement
   and click **확인 후 Provider 실행**. No provider call is started by page loading,
   changing inputs, selecting profiles, or reading model configuration.
6. Read the paired raw responses for each situation/repetition. Record qualitative
   observations and short quotations for explicitness, negative feedback,
   hierarchy, disagreement, consensus and schedule flexibility. An absent behavior
   or failed response is not evidence of a cultural tendency. There is no automated
   cultural success score or learner grade.
7. Download JSON to retain the result, frozen request, profile/provenance snapshots,
   situations and manual observations. Results and notes otherwise live only in the
   current page state; they are not automatically saved on the server. A failed
   later request preserves and labels the previous result.

## Controls and integration

- Authenticated system-admin-only GET `/api/simulation/culture-experiment/config`
  and POST `/api/simulation/culture-experiment`, mounted through the existing
  simulation router. Input schema rejects extra keys, unbound snapshots, out-of-range
  values and oversized batches. All versioned selections are bound on the server
  before any paid call; inaccessible/deleted or nonexistent versions fail first.
- Fixed situations: negative feedback, schedule negotiation, disagreement with a
  superior, and team decision-making. Each case is a fresh one-turn response with
  the same empty history, Korean language, fixed task/safety goal, identity,
  organization and role inputs. The situation and learner message do not vary
  across cultural conditions.
- Only bound Actor culture differs across conditions. Original Persona CRUD,
  scenario authoring, learner runs, simulation state, feedback/report generation
  and scoring are not written or invoked.
- One conversation policy is resolved at batch start and one provider instance is
  used for the whole batch. The existing Gemini, OpenAI and OpenRouter text streaming
  methods apply `buildScenarioCultureLayer`. Their existing generation settings stay
  constant within that provider/batch. Unsupported/misconfigured providers fail
  explicitly; strict factory creation prohibits model/provider substitution.
- Streaming avoids the ordinary non-streaming path's default-response fallback and
  extra emotion-analysis call. Partial stream failures retain partial text, show
  an error on the case, and allow the remaining cases to finish. Empty body is failure.
  SDK error messages are not echoed to the client.
- Repetition two rotates condition order by one position. This is not randomized
  experimental counterbalancing, a controlled seed, or statistical inference.
- A process-local guard allows one batch per user and two concurrent batches per
  router process. This is not distributed idempotency or durable job execution.

## Cost and reliability boundaries

Existing provider usage logging remains in place. Returned `[USAGE]` token metadata
is separated from dialogue; local direct-provider token prices produce **estimates**,
not invoices. Unknown model prices, missing token metadata and OpenRouter routing
prices are marked unknown rather than zero. Mock costs are zero.

Known estimated cost is only the sum of known case estimates, shown alongside the
number of unknown-cost cases. Cache discounts, SDK/native retries, interrupted
streams and failed requests may incur unreported charges. Providers retain their
existing retry behavior; there is no spend cap, automatic model switch, batch
retry, or cancel/resume mechanism. The UI warns of these limits before consent.
Closing the page, process restart, or connection loss can lose the response while
in-flight calls may still incur costs. Export results before leaving.

## Interpretation boundaries

This compares prompt behavior under controlled inputs; it does **not** measure
national populations, validate the source baselines, or establish how an individual
of any nationality will behave. Provenance retains the unvalidated editorial-estimate
and draft-review labels. Roles, individual biography, organizational constraints and
safety still take precedence.

The prompt currently maps scores below 40, 40–60 and above 60 to broad behavioral
directions, with light/moderate/strong instruction-emphasis bands. Adjacent numbers
may share the same direction; numeric changes in the prompt do not imply measurable,
proportional or statistically significant response differences. Intensity is not a
probability. At intensity zero the culture layer is identical to OFF.

One or two unseeded responses are exploratory examples, not causal evidence. No
significance, country ranking or automatic pass/fail cultural verdict is computed.
This text tool does not validate real-time voice output. Existing voice regressions
only verify prompt continuity/OFF compatibility, not live spoken behavior.

## Verification evidence

- New server tests use mocked streaming dependencies to verify four-situation
  coverage, fixed inputs, OFF/zero semantics, adjacent-score limits, explicit
  consent, snapshot validation, partial failure and unknown-cost handling.
- Mock SDK payload tests cover Gemini, OpenAI and OpenRouter: model and non-cultural
  prompt content stay fixed, the bound culture layer reaches the request, and OFF
  and intensity-zero requests match.
- HTTP tests cover anonymous/operator denial, bounded/strict input, version binding,
  no provider setup in mock mode/config reads, strict provider selection and
  process-local duplicate batch protection.
- Client tests cover no automatic execution, paid consent, same-country intensity
  comparisons, operator hiding, partial failures, frozen previous results, manual
  evidence and JSON export.
- These tests are **mock tests, not actual provider results**. Actual paid-provider
  comparisons were not executed during implementation. The preview capture reaches
  the unauthenticated sign-in page, so signed-in UI appearance was not visually
  verified; signed-in behaviors are covered by component/HTTP tests.
