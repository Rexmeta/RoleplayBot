---
name: Gemini Live valid models
description: Which model IDs actually work for Gemini Live bidiGenerateContent API (v1alpha), and what names fail.
---

## Rule
Only two model IDs are confirmed valid for `bidiGenerateContent` on `v1alpha`:
- `gemini-2.0-flash-live-preview-04-09` (primary/default)
- `gemini-live-2.5-flash-preview` (secondary)

**Why:** Google's `@google/genai` SDK types and API validation reject anything else at connection time with code 1008 "model not found for API version v1alpha". Names that look plausible but fail: `gemini-2.0-flash-live-001`, `gemini-2.5-flash-live-preview`, `gemini-3.1-flash-live-preview`, `gemini-live-2.5-flash`, `gemini-2.5-flash-native-audio-preview-*`.

**How to apply:** `VALID_GEMINI_REALTIME_MODELS` in `server/services/realtimeVoiceService.ts` must list only these two. The `server/migrate.ts` migration must include all deprecated names in the WHERE clause to migrate them to `gemini-2.0-flash-live-preview-04-09` on every server start. All Gemini Live models use `v1alpha` (never `v1beta`).
