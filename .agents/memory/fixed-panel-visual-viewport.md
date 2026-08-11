---
name: position:fixed + visualViewport.offsetTop
description: Why adding visualViewport.offsetTop to a fixed element's `top` pushes the character panel down and leaves a black band above the avatar
---

Never set `top: visualViewport.offsetTop` unconditionally on a `position: fixed`
element.

**Why:** `position: fixed` already resolves against the layout viewport, so
adding `offsetTop` double-counts the shift. On mobile Chrome (collapsing URL
bar / pinch zoom) `offsetTop` becomes non-zero, the whole panel slides down by
that amount, and because the element keeps `height: visualViewport.height` the
content also overflows off the bottom of the screen. The symptom looks exactly
like a badly framed video clip — a black band above the avatar with the subject
pushed to the bottom — which sends you chasing `object-fit` / `object-position`
instead of the container.

**How to apply:** Anchor to `top: 0` and size with `height: visualViewport.height`.
Only honour `offsetTop` when the visual viewport is genuinely shrunk (on-screen
keyboard), e.g. `window.innerHeight - vv.height > 120`.

Diagnosing this class of bug by eye is unreliable — measure. A dev-only overlay
that prints the portrait box rect (`getBoundingClientRect`) alongside the
`<video>` intrinsic size distinguishes "container is in the wrong place" from
"clip is framed wrong" in one glance.
