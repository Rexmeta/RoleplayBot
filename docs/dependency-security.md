# Dependency security maintenance

The dependency upgrades retain Express 4, Tailwind 3, and Vitest 4. Zod uses
the patched v4 API, with matching Drizzle and React Hook Form adapters; do not
switch imports to the bundled legacy `zod/v3` API to avoid migration work.

## Transitive overrides

Updating direct parents alone retained vulnerable lockfile entries. The
overrides in `package.json` set compatible security floors for body-parser,
proxy-addr, DOMPurify, ip-address, nanoid 5, and qs. The selector parser override
also replaces the exact vulnerable version pinned by Tailwind Typography.

Sucrase and gaxios are advanced within their existing major versions to remove
their vulnerable glob/minimatch chains instead of forcing an incompatible glob
major into those parents. The older uuid and esbuild overrides predate these
changes.

When updating dependencies, check whether the parent requirements and lockfile
make any override unnecessary. Do not remove one without a fresh dependency
audit and a build/test run.

## Verification

- Run the dependency audit against `package-lock.json`.
- Run `npm run check` and `npm run build`.
- Run `npx vitest run --maxWorkers=2` to limit media-test resource contention.
- Check the application starts and the login screen renders.

The compatibility tests cover partial enum-keyed overrides, Drizzle schema
composition, form defaults/errors, and early rejection of oversized constrained
arrays. Validation assertions use structured issues rather than Zod's
version-dependent default English wording.
