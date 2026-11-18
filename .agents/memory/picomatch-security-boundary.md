---
name: Picomatch unpublished security fix
description: Why picomatch uses an install-time mitigation instead of claiming a clean dependency audit.
---

All published picomatch releases were vulnerable to the repeated-extglob advisory
GHSA-fc5q-39xc-vjpf when checked on 2026-11-18; the registry's latest was 4.0.7
and the advisory had no first patched version.

**Why:** Upgrading to the latest version would still leave this issue exploitable.
A local parser mitigation was chosen instead of falsifying a patched version or
suppressing the advisory. Version-based audits will continue to flag the package.

**How to apply:** Check the registry and advisory again before choosing an upgrade.
Until an official fix replaces the local mitigation, preserve install-time patching
in both normal and production-only installs, including Docker's dependency layers.
Do not describe a passing exploit regression test as a clean dependency audit.

Security guards that classify glob syntax must account for the parser's options
and malformed-input behavior, not just balanced-looking delimiters.

**Why:** An unmatched `[` is literal in picomatch, and `nobracket` disables classes.
Treating either as a class can hide an active wildcard from a safety check.

**How to apply:** Include malformed bracket and option-dependent cases in
hard-timeout child-process exploit tests, not just the advisory's two examples.
