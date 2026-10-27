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

The official integration guide requires the same verified Clerk user plus a strictly per-user owner cookie. It explicitly does not supply a cross-application identity bridge. Its PCM endpoint accepts bounded clips, not continuous Gemini streaming.

**Why:** Receiving an official stock-echo contract does not remove the identity incompatibility or prove end-to-end dialogue integration.

**How to apply:** Verify identity compatibility before implementing authenticated requests. Do not migrate existing login, forward unrelated JWTs, share cookie jars, or mark a blocked foundation as completed live integration.
