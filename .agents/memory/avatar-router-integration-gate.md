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
