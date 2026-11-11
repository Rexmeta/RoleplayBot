---
name: AvatarRouter integration gate
description: External avatar provisioning prerequisites and transfer safety
---

Tavus든 Anam이든 AvatarRouter와 하나의 통합된 구조로 작동해야 한다.
다른 구조가 필요한 경우에도 가능한 일관된 방식으로 AvatarRouter와 연동하고,
각기 다른 아바타 연동은 AvatarRouter에서 처리한다. AvatarRouter 사용자는
간단한 API 연동만으로 라이브 아바타를 사용하는 구조를 지켜야 한다.

**Why:** 사용자가 제공자별 앱 연동 분산 대신 이 통합 구조를 지키도록 명시했다.

**How to apply:** 라이브 아바타 연동과 개선에서 이 책임 경계를 유지한다.

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

The user reports that Anam was successfully tested in AvatarRouter and is available there.

**Why:** An upstream working provider and this app's local provider-selection restrictions are different facts.

**How to apply:** Do not attribute a locally disabled Anam choice to provider unavailability without evidence. Check local stock eligibility, saved provider identity, and execution dispatch separately.

Provider availability does not establish transport or dialogue ownership. Check the router's current downloadable integration contract before extending dispatch; a native full pipeline must not be attached to an external-PCM renderer.

**Why:** The working Anam catalog entry uses a saved native persona, not the Tavus rendering protocol. The router's newer managed-client contract supersedes provider-SDK setup for new app integrations.

**How to apply:** Prefer the router-hosted common client when its live advertised contract supports it. Keep native microphone/dialogue ownership exclusive, single-start handoffs non-retryable, and unsupported scenario-context/transcript capabilities explicit rather than pretending to preserve them.

Historical Anam calls started while feedback was disclosed as unavailable must
not gain transcript retention or evaluation after router capabilities change.

**Why:** A current capability does not supply creation-time consent for externally
held conversation transcripts. Tavus legacy recovery has a different existing
disclosure contract and must not be conflated with undisclosed Anam retention.

**How to apply:** Require Anam's creation-time transcript contract before import,
including the atomic import claim. Existing Anam UI sessions use their own
availability, not current project discovery. Keep new-session imports and
previously supported Tavus recovery covered by regression tests.

Anam session role/organization instructions require a ratified router contract
and an explicit deployed capability, not just native full-pipeline support.
Proposed capability names are not authorization to send new request fields.

**Why:** The public router contract can change without a top-level API version
bump. A later public read exposed the official roleplay-context guide while local
proposals still described instructions as unsupported. Neither old local proposals
nor a newly published guide alone prove the configured runtime has enabled support.

**How to apply:** Recheck both router integration documents and linked roleplay
guide before enabling session instructions, then verify the authenticated runtime
capability. The official roleplay path uses a session-only temporary persona from
the saved template; do not assume it inherits template prompts, knowledge or tools.
Use immutable run-bound instructions, never mutate the shared saved persona or run
Gemini alongside Anam. External implementation, publication and paid call verification
need separate approval.

Anam final-transcript evaluation requires the current official common router
contract and authenticated runtime capability, not an old local proposal or a
Tavus-only transcript feature.

**Why:** The official unified contract intentionally hides provider resource IDs
and does not adopt the richer local proposal envelope. Requiring speculative
fields can falsely classify supported functionality as unavailable; conversely,
native media and a locally verifiable hash cannot authenticate dialogue ownership.

**How to apply:** Follow the current official schema and authenticated capability
discovery. Keep local user/run/project ownership checks and validate returned
session, source and pinned revision; preserve Anam provenance. A project-only
auth check is not per-user isolation verification. If acceptance requires the
provider-session mapping hidden by the common API, obtain trusted router-side
evidence separately rather than claiming the public response proves it. Keep
mock checks distinct from separately approved paid-call verification.

A reconciliation-required status identifies an unresolved paid-create outcome,
not the root cause of a scenario-only failure. When administrator/persona playback
works, compare actual creation payloads, renderer events, and media connection
requests before attributing the problem to a generally unavailable provider.

**Why:** The user repeatedly confirmed that administrator/persona tests work.
Presenting cleanup as the explanation for the scenario failure confuses a required
recovery action with an established diagnosis.

**How to apply:** Separate the proven failure stage from its still-unconfirmed
cause; operator cleanup may unblock another attempt but does not prove it fixes
the original scenario path. Preserve sanitized initial-failure evidence separately
from cleanup failures; a generic cleanup-task error cannot identify the original
provider, transport, database, or lease failure.

Saved persona live configuration is a reference, not permission to auto-create a paid session. Scenario runtime must remain opt-in and preserve existing image/video and dialogue behavior until the learner explicitly selects live playback.

**Why:** The user requested both selected-avatar testing in persona editing and functioning scenario live avatars, while preserving existing behavior remains an explicit requirement.

**How to apply:** Require global/scenario permission, the run's own selected persona reference, current provider readiness, and explicit learner selection of live playback. Custom provisioning/ready status is not playback validation. Keep old snapshot-bound conversations immutable.

학습자 라이브 아바타는 진입 후 동의 체크와 다시 시작 버튼을 요구하지 않는다. 라이브 선택 한 번으로 연결하고 대화 종료 후 피드백 리포트 생성 과정으로 자동 진행한다.

**Why:** 사용자가 학습자 진입의 중복 동의·시작 단계를 제거하고 종료 후 자동 리포트 진행을 명시했다.

**How to apply:** 이용 요금·외부 전송 안내와 명시적 라이브 선택은 유지하되 별도 체크박스를 추가하지 않는다. 단순 복구 화면 진입이나 관리자 설정 열기로 유료 세션을 생성하지 않는다. 확정 기록 저장·피드백 작업 접수 조건과 불확실한 유료 생성의 재시도 차단은 유지한다. 관리자 진단의 별도 동의 정책은 이 변경의 대상이 아니다.

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
