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

The newer identity contract supports dedicated RS256 per-user/tenant delegation and pinned public JWKS without changing existing login. It supersedes the older same-Clerk-user/cookie-only constraint. Trust enrollment and end-to-end acceptance remain separate gates; bounded PCM clips are not continuous Gemini streaming.

**Why:** A documented/locally tested bridge is not proof of deployment enrollment, tenant isolation or real media playback.

**How to apply:** Use a dedicated server signing key, fresh membership attestations and narrow scopes; never forward the login JWT or cookies. Do not mark a blocked foundation or a successful read-only auth check as completed live integration.

For delegated tenant ownership, use the user's current organization membership; operator management assignments are not membership. Organization-less accounts remain personal tenants.

**Why:** Conflating management reach with membership can let an operator act as another organization's tenant. Stable opaque derivation also keeps names/emails out of delegated claims.

**How to apply:** Keep subject/tenant derivation stable across key rotations and verify current active user/organization/company records on each operation.

Treat the issuer as a stable identity namespace, not a key-host address. A URN issuer is compatible with the contract; only the separately pinned public JWKS URL must be HTTPS.

**Why:** Remote ownership includes the exact issuer. Replacing a valid URN merely to match a hosting URL changes ownership identity, not just key discovery.

**How to apply:** Preserve the enrolled issuer across key-host changes and configure the public key URL separately. Do not require a login migration or rewrite the issuer to obtain HTTPS keys.
