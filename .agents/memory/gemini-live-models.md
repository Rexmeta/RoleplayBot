---
name: Gemini Live valid models
description: Correct model IDs for @google/genai SDK Live API bidiGenerateContent, confirmed via SDK source
---

## Rule
Use `gemini-live-2.5-flash-preview` with API version `v1beta`.

**Why:** `gemini-live-2.5-flash-native-audio` appears in Google marketing/docs but is NOT a valid bidiGenerateContent model ID — every attempt returns code 1008 "not found for API version". The `@google/genai` SDK v1.15.0 source (`dist/index.cjs`) shows the actual default for Google AI (non-Vertex) is `gemini-live-2.5-flash-preview`. The Vertex AI default is `gemini-2.0-flash-live-preview-04-09` (not used here). v1alpha is never used per product requirement.

**How to apply:**
- `DEFAULT_REALTIME_MODEL` in `server/services/realtimeVoiceService.ts` → `'gemini-live-2.5-flash-preview'`
- `geminiLiveApiVersion()` always returns `'v1beta'` — v1alpha is excluded entirely
- `server/migrate.ts` migration uses `NOT IN ('gemini-live-2.5-flash-preview', 'gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview')` to auto-correct any stale DB values
- `shared/realtimeModels.ts` REALTIME_MODELS shows this model + OpenAI options
