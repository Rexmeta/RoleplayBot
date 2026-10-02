---
name: Mobile voice overlay bounds
description: Keep voice overlays within Safari's visible viewport as well as its bottom safe area.
---

Mobile voice overlays should share the voice screen's visible-viewport bounds, with bottom safe-area clearance applied to the common container for their controls and scrollable content.

**Why:** An independently fixed transcript can use the larger layout viewport even when the voice screen is already sized to the visible viewport. Safe-area insets protect the home indicator, but do not by themselves account for Safari's navigation bar.

**How to apply:** Reuse the voice screen's viewport measurements rather than adding a separate viewport listener or relying only on bottom padding. Preserve container-relative desktop positioning. Apply the offset rules in [Fixed panel + visualViewport](fixed-panel-visual-viewport.md).