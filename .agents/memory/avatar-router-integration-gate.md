---
name: AvatarRouter integration gate
description: External avatar provisioning prerequisites and transfer safety
---

Keep the RoleplayX-to-AvatarRouter boundary internal until a trusted machine-to-machine tenant identity bridge and a rights-review gate are supported. Re-check the provider's current contract before beginning external image transfer work; do not infer authorization from existing persona images.

**Why:** The reviewed public contract documented image ingestion and avatar provisioning but did not establish RoleplayX tenant identity or rights-review controls. Sending images without those safeguards risks cross-tenant access or unauthorized likeness transfer.

**How to apply:** Before any provider write, verify current authentication, tenant mapping, and rights approval behavior, then gate each transfer on trusted server-side approval.

Live avatar integration must use an isolated adapter and remain an optional service without affecting existing functionality.

**Why:** The user explicitly requested adapter-based integration and optional live-avatar service selection while preserving existing features.

**How to apply:** Preserve existing defaults and separate external session, audio transport, and failure handling from the existing avatar and voice paths.

Treat the settings-page stock-avatar conversation test as an isolated administrator diagnostic, not evidence that the scenario live-avatar integration is ready. Opening settings must never create a paid session.

**Why:** The user requested actual avatar conversation testing in settings while the earlier requirement to preserve existing functionality and defaults still applies.

**How to apply:** Keep explicit cost/data-transfer consent on the test action, avoid automatic paid or media E2E during development, and preserve ordinary scenario gates until their own ownership and media paths are verified.

The user confirmed on 2026-11-02 that both administrator-page and persona-page live-avatar tests connect successfully, while learner scenario playback was still not applied.

**Why:** Success in the diagnostic path does not establish that the learner path selects, starts, and renders the same avatar.

**How to apply:** Diagnose learner configuration, discovery, ownership, and media routing separately; do not restart provisioning or treat diagnostic success as learner playback verification.

A reconciliation-required status identifies an unresolved paid-create outcome,
not the root cause of a scenario-only failure. When administrator/persona playback
works, compare actual creation payloads, renderer events, and media connection
requests before attributing the problem to a generally unavailable provider.

**Why:** The user repeatedly confirmed that administrator/persona tests work.
Presenting cleanup as the explanation for the scenario failure confuses a required
recovery action with an established diagnosis.

**How to apply:** Separate the proven failure stage from its still-unconfirmed
cause; operator cleanup may unblock another attempt but does not prove it fixes
the original scenario path.

Saved persona live configuration is a reference, not permission to auto-create a paid session. Scenario runtime must remain opt-in and preserve existing image/video and dialogue behavior until the learner explicitly selects live playback.

**Why:** The user requested both selected-avatar testing in persona editing and functioning scenario live avatars, while preserving existing behavior remains an explicit requirement.

**How to apply:** Require global/scenario permission, the run's own selected persona reference, current provider readiness, and explicit cost/audio-transfer consent. Custom provisioning/ready status is not playback validation. Keep old snapshot-bound conversations immutable.

Implementation approval is not permission to execute paid/media E2E during development or publish production changes. A client playback report is an operator observation, not independent provider certification.

**Why:** External image/audio transfer, likeness rights, provider charges and production changes have separate consent boundaries.

**How to apply:** Keep generation and validation operator-triggered, require transfer/rights/cost confirmations, and do not claim actual end-to-end media success from mocked tests or API authentication alone.

The current contract makes project API keys the default; Base URL plus API key is enough for basic connection. Dedicated RS256 per-user/tenant delegation and pinned public JWKS remain optional advanced mode, not prerequisites. Bounded PCM clips are not continuous Gemini streaming.

**Why:** A documented/locally tested bridge is not proof of deployment enrollment, tenant isolation or real media playback.

**How to apply:** Use server-only project API keys and fresh local authorization for basic connection; require signing-key trust enrollment only when JWT delegation is explicitly selected. Never forward login JWTs or cookies. Do not mark a blocked foundation or successful auth check as completed live integration.

An API key fixes one external project/tenant. A user header partitions sessions inside that project but cannot establish independent tenant isolation. Separate external tenants require separate project keys.

**Why:** The key holder can assert any user within its own project; treating a browser header or local organization hash as tenant isolation would exceed the provider's contract.

**How to apply:** Derive user context from verified login only, keep it consistent across the session lifecycle, and do not enable multi-organization dispatch without a server-verified key mapping. New-key creation changes project ownership; rotation preserves it.

For delegated tenant ownership, use the user's current organization membership; operator management assignments are not membership. Organization-less accounts remain personal tenants.

**Why:** Conflating management reach with membership can let an operator act as another organization's tenant. Stable opaque derivation also keeps names/emails out of delegated claims.

**How to apply:** Keep subject/tenant derivation stable across key rotations and verify current active user/organization/company records on each operation.

Treat the issuer as a stable identity namespace, not a key-host address. A URN issuer is compatible with the contract; only the separately pinned public JWKS URL must be HTTPS.

**Why:** Remote ownership includes the exact issuer. Replacing a valid URN merely to match a hosting URL changes ownership identity, not just key discovery.

**How to apply:** Preserve the enrolled issuer across key-host changes and configure the public key URL separately. Do not require a login migration or rewrite the issuer to obtain HTTPS keys.

Keep free-only inspection separate from lifecycle recovery, even if both are called “preflight.”

**Why:** A diagnostic preflight may reconcile an uncertain paid-create fence. Reusing it for a strictly read-only approval would silently widen the permitted action; project authentication alone also does not establish a logged-in user context.

**How to apply:** Under read-only approval, perform only official authenticated reads without recovery writes or media credentials. Report project-only and per-user verification separately, and never infer persona ownership or runtime activation from a catalog candidate.

Retry permission is operation-specific: bounded retries of free authentication reads
must not be generalized to paid creation or audio writes, or implemented by falling
back to a previously successful authorization.

**Why:** Transient connection-check delays can prevent recovery even with a valid
saved persona, but avoiding that interruption must not duplicate charges or bypass
current account, project-key, or ownership validation.

**How to apply:** Share only concurrent identical authentication reads, revalidate
each caller, and retain uncertain-create fencing when a real session request fails.

Learner live controls must appear only for an actor whose selected saved persona
has Live configured. A saved selection must not be presented as actual playback.

**Why:** The user requires persona-based activation, not a universal scenario
option, and reported that successful setup was being confused with loaded video.

**How to apply:** Gate both portrait and menu controls using the selected actor,
and report actual provider/media state independently of saved configuration.

An unknown paid provider-create outcome requires AvatarRouter's trusted operator
reconciliation, not an application-key retry or manual clearing of the warning.

**Why:** The provider may have created a billable conversation without returning
its ID. The external operator boundary exists to prevent duplicate billing and
unverified claims of completed cleanup.

**How to apply:** Preserve the original binding and fence; use provider-confirmed
conversation evidence through the operator workflow before permitting new work.
