---
name: Gemini Live valid models
description: Which model IDs actually work for Gemini Live bidiGenerateContent API, and what API version each requires.
---

## Rule
Three valid models per Google Gemini Live API docs (June 2026):

| Model ID | Status | API Version |
|---|---|---|
| `gemini-live-2.5-flash-native-audio` | **GA (default)** | `v1beta` |
| `gemini-3.1-flash-live` | Preview | `v1alpha` |
| `gemini-3.5-live-translate` | Preview (translation only) | `v1alpha` |

**Why:** All previous names (`gemini-2.0-flash-live-001`, `gemini-2.5-flash-live-preview`, `gemini-2.0-flash-live-preview-04-09`, `gemini-3.1-flash-live-preview`, `gemini-live-2.5-flash-preview`, etc.) fail at connection time with code 1008 "model not found for API version". GA models use `v1beta`; preview models use `v1alpha` for bidiGenerateContent.

**How to apply:**
- `DEFAULT_REALTIME_MODEL` = `'gemini-live-2.5-flash-native-audio'` in `server/services/realtimeVoiceService.ts`
- `geminiLiveApiVersion()` returns `'v1beta'` for GA models, `'v1alpha'` for preview models
- `server/migrate.ts` migration uses `NOT IN (valid models list)` to catch all new deprecated names automatically
- `shared/realtimeModels.ts` REALTIME_MODELS list shows these three + OpenAI options
