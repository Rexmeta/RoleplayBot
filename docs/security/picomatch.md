# Picomatch repeated-extglob ReDoS

GHSA-fc5q-39xc-vjpf / CVE-2026-112366 affects all published picomatch
versions through 4.0.7. On 2026-11-18, the registry's latest version is
4.0.7 and the advisory lists no patched release. Upgrading to that version
alone does not fix the vulnerability.

## Local mitigation

`npm install` and `npm ci` run `scripts/patch-picomatch.cjs`. It finds every
picomatch installation recorded in the root npm lockfile (currently 2.3.2,
4.0.4 and 4.0.7), verifies the original parser's SHA-256, and extends its
existing repeated-extglob safety analysis. An unexpected version or parser
fails installation instead of silently leaving it unprotected. Repeated
execution is safe. Production-only installations may omit unused copies.

An unescaped `*` wildcard inside a repeated extglob is treated as
risky even when there is only one branch. Picomatch's existing risky-pattern
handling then matches the extglob as literal text instead of compiling a
nested unbounded regex quantifier. This also applies when callers disable
the separate recursion limit. Ordinary globs, literal repeated alternatives,
escaped stars and simple character-class stars retain their existing behavior.

Only complete, simple classes containing letters, digits, `*?._ -` are skipped
when `nobracket` is not enabled. The guard does not infer complex-class or quote
state: stars inside quoted strings, nested extglob openers, POSIX classes and
uncertain classes are conservatively treated as risky. This avoids mismatches
around initial `]`, negated classes, unmatched brackets and class-member quotes.
Hard-timeout regressions cover these cases and disabled-class variants on every copy.

This deliberately changes the behavior of wildcard-bearing repeated
extglobs such as `+(*)`, `+(*a)`, `*(*a)`, `+(*(a))` and `+("*")`: they become literal, not
wildcard matches. Do not disable lifecycle scripts with `--ignore-scripts`.
If an external installer requires that flag, explicitly run
`node scripts/patch-picomatch.cjs` before building or starting the app.
Both Docker installation stages copy the patch script before `npm ci`.

The independently managed, ignored AvatarRouter checkout is not part of
this application's npm dependency tree or this committed fix.

## Verification and eventual removal

Run `npx vitest run tests/server/picomatchSecurity.test.ts` and `npm run build`.
Regression tests exercise every installed locked copy, run malicious inputs
in child processes with a hard timeout, and check normal matching behavior.

Package versions and registry integrity metadata are intentionally unchanged:
dependency scanners can still report the advisory despite the local code
mitigation. This is **not** an upstream patched-release upgrade or a claim
that the dependency audit is clean.

When an official fix is available, upgrade all affected copies, rerun the
regression tests against it, and remove the local patch, its lifecycle hook,
and Docker script copies together.
