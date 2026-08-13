---
name: Gemini Live cross-frame transcript dedup
description: Why the AI voice persona spoke every response twice, and how transcript sources must be deduped per turn
---

# Gemini Live cross-frame transcript source dedup

**Rule:** For a single AI turn, gemini-live can deliver BOTH `modelTurn.parts[].text` and `outputTranscription` — and they can arrive in **different frames**, not just the same message. Accumulating both doubles the whole transcript ("AI says everything twice"). `outputTranscription` is always authoritative: once it appears for a turn, any modelTurn text already accumulated for that turn must be discarded, and later modelTurn text skipped. Track the source per turn (`model` vs `output`) and reset at every turn boundary AND on barge-in/cancel.

**Why:** A same-message-only check (`preferOutputTranscription`) is insufficient — production showed doubled transcripts because the sources arrived in separate frames. This mirrors the identical cross-frame audio dedup problem (top-level `data` vs `inlineData` audio, handled with `audioSourceThisTurn`). Any "two delivery channels for the same content" pattern in gemini-live needs per-turn source tracking, not per-message checks.

**How to apply:** When touching the Gemini voice message handler's transcript accumulation, keep the per-turn source flag logic intact; reset it wherever the turn/audio-source flags are reset. A whole-transcript "collapse exact doubled halves" safety net at turn completion (min ~10 chars per half) catches residual model self-echo without harming short legit repetitions.

# Internal marker leakage

Gemini live occasionally echoes tool/function plumbing as literal spoken-transcript text, e.g. `action_result:action_result:<sentence>`. These strings are never hard-coded anywhere in the app — they come from the model side. Filtering must live in the shared text-filter path (marker names: action_result, tool_result, function_response, etc., with optional JSON payload, ASCII or fullwidth colon) and be applied in both provider paths (Gemini + OpenAI realtime adapter), on deltas and on the final transcript.
