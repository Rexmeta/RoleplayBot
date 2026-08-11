---
name: Gemini Live valid models
description: Correct model IDs for @google/genai SDK Live API bidiGenerateContent, confirmed via SDK source
---

## Rule
Use `gemini-3.1-flash-live-preview` with API version `v1beta`.

**Why:** `gemini-3.1-flash-live-preview` is the current supported Google AI model for `bidiGenerateContent` on `v1beta`. All previous Gemini Live names, including `gemini-live-2.5-flash-preview` and `gemini-live-2.5-flash-native-audio`, fail. v1alpha is never used per product requirement.

**How to apply:**
- `DEFAULT_REALTIME_MODEL` in `server/services/realtimeVoiceService.ts` → `'gemini-3.1-flash-live-preview'`
- `geminiLiveApiVersion()` always returns `'v1beta'` — v1alpha is excluded entirely
- `server/migrate.ts` migration uses `NOT IN ('gemini-3.1-flash-live-preview', 'gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview')` to auto-correct any stale DB values
- `shared/realtimeModels.ts` REALTIME_MODELS shows this model + OpenAI options
