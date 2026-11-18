---
name: Nested workspace publishing
description: Root-scoped pnpm filters can build diagnostic copies instead of the canonical nested workspace.
---

Run nested AvatarRouter package commands from the canonical workspace, not with an unscoped package-name filter at the RoleplayX root.

**Why:** A publishing failure showed that root-level pnpm discovery selected generated diagnostic copies with the same package name, while omitting the hidden canonical workspace. The diagnostic copy lacked build dependencies; the canonical API and web builds succeeded when explicitly scoped. Git ignore rules and the existing `.replitignore` did not prevent this discovery.

**How to apply:** Check package selection with `pnpm --filter ... list --depth -1` before changing dependencies. Scope build commands to the intended workspace and verify production output paths separately. Do not install missing dependencies into diagnostic copies or assume a successful primary-app build means all managed artifact builds passed.

Registered artifact manifests require the platform's validated replacement flow:
write a full sibling temporary TOML and call `verifyAndReplaceArtifactToml` with
absolute temporary and destination paths. Direct patching is rejected.

**Why:** These files are managed artifact configuration, not ordinary application
files; a direct patch did not apply the publishing correction.

**How to apply:** Use validated replacement for registered manifests, then read
back the result. Scope output and runtime paths consistently with the nested
workspace; a scoped build alone does not repair root-relative output paths.
