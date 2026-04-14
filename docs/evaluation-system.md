# Evaluation System Reference

## Overview

The evaluation system scores roleplay conversations across multiple competency dimensions. All shared constants and pure logic are centralized in `server/services/evaluationEngine.ts`; both AI providers (`optimizedGeminiProvider.ts`, `openaiProvider.ts`) import from this module.

---

## Source of Truth

```
server/services/evaluationEngine.ts   ← shared constants + pure logic functions
server/services/providers/optimizedGeminiProvider.ts  ← Gemini (primary)
server/services/providers/openaiProvider.ts           ← OpenAI (fallback)
```

---

## Default Evaluation Dimensions (`DEFAULT_DIMENSIONS`)

Five dimensions, each weighted 20%, scored 1–10:

| Key | Name | Description |
|-----|------|-------------|
| `clarityLogic` | 명확성 & 논리성 | Clarity and logical structure of expression |
| `listeningEmpathy` | 경청 & 공감 | Listening and empathy toward the other party |
| `appropriatenessAdaptability` | 적절성 & 상황대응 | Contextually appropriate responses |
| `persuasivenessImpact` | 설득력 & 영향력 | Persuasiveness and influence |
| `strategicCommunication` | 전략적 커뮤니케이션 | Strategic goal-oriented communication |

Custom evaluation criteria can override these dimensions via the `EvaluationCriteriaWithDimensions` type.

---

## Score Adjustment Pipeline

The final score displayed to the user is calculated in multiple stages:

### 1. AI Raw Scores (1–10 per dimension)
The AI model assigns a score to each dimension based on the conversation transcript and rubrics.

### 2. Score Cap (conversation completeness check)
If the conversation is too short, individual dimension scores are capped:

| Effective Ratio | Max Allowed Score |
|-----------------|-------------------|
| < 30% | 3 |
| 30%–49% | 5 |
| 50%–69% | 7 |
| ≥ 70% | no cap |

### 3. Weighted Overall Score
`calculateWeightedOverallScore(scores, evaluationCriteria)` converts 1–10 dimension scores to a 0–100 overall score using each dimension's weight.

Formula: `round((Σ (score/maxScore × weight)) / totalWeight × 100)`

### 4. Automatic Adjustments (Gemini provider only)

Applied after the weighted score is computed:

| Adjustment | Condition | Amount |
|-----------|-----------|--------|
| Non-verbal penalty | Short/meaningless utterances in text mode | Up to −20 pts |
| Barge-in adjustment | User interrupting AI: positive (active) or negative (poor listening) | −15 to +10 pts |
| Completion penalty | Conversation below 70% of expected turns | Up to −25 pts (text) / −15 pts (voice) |

**Final score**: `clamp(baseOverallScore + adjustments, 0, 100)`

---

## Completion Ratio Logic (`calcEffectiveRatio`)

Expected turns: **10 for text mode**, **7 for voice mode** (`EXPECTED_TURNS_TEXT`, `EXPECTED_TURNS_VOICE`).

For voice mode, a content-density correction is applied:
- Baseline: 40 chars/turn (`BASELINE_CHARS_PER_TURN`)
- `contentRatio = totalChars / (7 × 40)` (capped at 1.0)
- `effectiveRatio = max(turnRatio, contentRatio)` — takes whichever is more favorable

This prevents penalizing voice conversations where the user speaks in fewer but longer utterances.

---

## Completion Penalty Tiers (`calculateCompletionPenalty`)

| Effective Ratio | Text Penalty | Voice Penalty |
|-----------------|-------------|---------------|
| < 30% | −25 pts | −15 pts |
| 30%–49% | −15 pts | −10 pts |
| 50%–69% | −8 pts | −5 pts |
| ≥ 70% | 0 pts | 0 pts |

---

## Non-Verbal Penalty (`analyzeNonVerbalPatterns`)

Disabled in voice mode (STT transcription noise makes this unreliable).

In text mode, detected patterns and their penalties:

| Pattern | Penalty |
|---------|---------|
| Very short response (≤2 chars) | −2 pts each |
| Meaningless short fragment (3–5 chars) | −1 pt each |
| Ellipsis silence (`...`) | −3 pts each |
| Filler sounds (`음`, `어`, `uh`, `hmm`) | −2 pts each |
| Explicit skip (`침묵`, `skip`, `스킵`) | −5 pts each |

Total penalty capped at **20 pts** (`NON_VERBAL_PENALTY_CAP`).

---

## Barge-in Analysis (`analyzeBargeIn`)

Detects AI messages marked as `interrupted: true` and evaluates the context:

| Context | Assessment | Score Impact |
|---------|-----------|-------------|
| User interrupts while AI is asking a question | Negative (poor listening) | −3 pts/occurrence |
| User interrupts with a substantive response (>30 chars) | Positive (active engagement) | +2 pts/occurrence |
| Other | Neutral | 0 pts |

Net adjustment range: **−15 to +10 pts**.

---

## Voice Mode Detection (`isVoiceMode`)

A conversation is considered voice mode when `conversation.mode === 'realtime_voice'` or `conversation.mode === 'tts'`.

Voice mode affects:
- Expected turn count (7 instead of 10)
- Non-verbal analysis (disabled)
- Completion penalty cap (lower)
- STT noise filtering (`filterVoiceNoise`)

---

## 10-Point Rubric (`DEFAULT_10PT_RUBRICS`)

Used in the Gemini feedback prompt when no custom `scoringRubric` is provided for the evaluation dimensions. Contains detailed band descriptors (1–2, 3–4, 5–6, 7–8, 9–10) for each of the five default dimensions.

---

## Key Functions Reference

All of the following are exported from `server/services/evaluationEngine.ts`.
Line numbers reflect the state at the time this document was written; consult
the file directly if the codebase has changed significantly.

### Constants

| Export | Line | Purpose |
|--------|------|---------|
| `DEFAULT_DIMENSIONS` | L17–L63 | Five default competency dimensions (weight 20% each) |
| `DEFAULT_10PT_RUBRICS` | L64–L107 | 10-point band rubric text for the five default dimensions |
| `EXPECTED_TURNS_TEXT` | L108 | Expected user turns for text mode (10) |
| `EXPECTED_TURNS_VOICE` | L111 | Expected user turns for voice mode (7) |
| `BASELINE_CHARS_PER_TURN` | L114 | Chars/turn baseline for voice density correction (40) |
| `NON_VERBAL_PENALTY_CAP` | L117 | Maximum non-verbal deduction (20 pts) |
| `BARGE_IN_MIN_ADJUSTMENT` | L120 | Lower bound for barge-in net adjustment (−15 pts) |
| `BARGE_IN_MAX_ADJUSTMENT` | L121 | Upper bound for barge-in net adjustment (+10 pts) |
| `BARGE_IN_POSITIVE_BONUS` | L124 | Points per positive (active) barge-in (+2) |
| `BARGE_IN_NEGATIVE_PENALTY` | L127 | Points per negative (poor-listening) barge-in (−3) |
| `COMPLETION_PENALTY_TIERS` | L133–L142 | Penalty lookup table (ratio → text/voice penalties) |
| `SCORE_CAP_TIERS` | L143–L156 | Dimension score cap lookup table (ratio → max score) |

### Functions

| Function | Line | Purpose |
|----------|------|---------|
| `isVoiceMode(conversation)` | L157 | Returns true for `realtime_voice` or `tts` mode |
| `filterVoiceNoise(messages)` | L166 | Removes STT noise from user messages in voice mode |
| `calcEffectiveRatio(messages, voiceMode)` | L181 | Computes conversation completeness ratio (0–1) |
| `analyzeNonVerbalPatterns(messages, conversation)` | L200 | Detects non-verbal utterances; returns count, patterns, penalty |
| `analyzeBargeIn(messages)` | L250 | Detects barge-in events; returns count, contexts, net adjustment |
| `calculateCompletionPenalty(ratio, voiceMode)` | L317 | Returns point penalty for incomplete conversations |
| `getScoreCap(ratio)` | L331 | Returns max allowed dimension score, or null if no cap applies |
| `calculateWeightedOverallScore(scores, criteria)` | L344 | Converts 1–10 dimension scores to 0–100 overall score |
| `getDefaultScores(criteria)` | L365 | Returns minimum scores (floor) for all active dimensions |

---

## Adding or Customizing Evaluation Criteria

Evaluation criteria sets are stored in the database (`evaluationCriteriaSets` table) and can define custom dimensions with their own weights, score ranges, rubrics, and evaluation prompts.

When a custom set is provided, it replaces `DEFAULT_DIMENSIONS` throughout the pipeline. The score adjustment pipeline (non-verbal, barge-in, completion) continues to apply regardless of custom criteria.

See `server/routes/evaluationCriteria.ts` for the CRUD API, and `shared/schema.ts` for the data model.
