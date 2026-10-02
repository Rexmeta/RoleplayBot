# 음성 근거의 적격성

한국어 실시간 음성의 평가에는 서버 소유 canonical revision만 사용한다. 미확인·미완료·변경된 전사는 감점 대신 평가 확정 보류로 표시하며 이전 보고서는 자동 교정하지 않는다. [상태 및 동시성 계약](./korean-voice-recognition.md)을 참조한다.

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

### 1. AI Raw Scores (1–10 per dimension)
The AI model assigns a score to each dimension based on the conversation transcript and rubrics.

### 2. Evidence Score Cap
If a dimension has no supporting evidence (empty `evidence` array), its score is capped at `NO_EVIDENCE_SCORE_CAP` (imported from `@shared/schema/types` → `EVIDENCE_SCORE_CAP`).

### 3. Score Cap (conversation completeness check)
If the conversation is too short, individual dimension scores are capped:

| Effective Ratio | Max Allowed Score |
|-----------------|-------------------|
| < 30% | 3 |
| 30%–49% | 5 |
| 50%–69% | 7 |
| 70%–79% | 8 |
| ≥ 80% | no cap |

### 4. Weighted Overall Score
`calculateWeightedOverallScore(scores, evaluationCriteria)` converts 1–10 dimension scores to a 0–100 overall score using each dimension's weight.

Formula: `round((Σ (score/maxScore × weight)) / totalWeight × 100)`

### 5. Automatic Adjustments (Gemini provider)

| Adjustment | Condition | Amount |
|-----------|-----------|--------|
| Non-verbal penalty | Short/meaningless utterances in text mode | Up to −20 pts |
| Barge-in adjustment | User interrupting AI: positive (active) or negative (poor listening) | −15 to +10 pts |
| Completion penalty | Conversation below expected turns | Up to −25 pts (text) / −15 pts (voice) |

**Final score**: `clamp(baseOverallScore + adjustments, 0, 100)`

---

## Completion Ratio Logic (`calcEffectiveRatio`)

Signature: `calcEffectiveRatio(userMessages, voiceMode, scenarioTargetTurns?, actualDurationSeconds?, scenarioTargetDurationMinutes?)`

Expected turns: **10 for text mode**, **7 for voice mode** (`EXPECTED_TURNS_TEXT`, `EXPECTED_TURNS_VOICE`). `scenarioTargetTurns` overrides the global default when provided.

`effectiveRatio = max(turnRatio, contentRatio, timeRatio)` — takes whichever is most favorable.

- `turnRatio = userMessages.length / expectedTurns`
- `contentRatio = totalChars / (expectedTurns × 40)` (capped at 1.0; baseline 40 chars/turn)
- `timeRatio = actualDurationSeconds / (scenarioTargetDurationMinutes × 60)` (only when both params provided)

---

## Completion Penalty Tiers (`calculateCompletionPenalty`)

| Effective Ratio | Text Penalty | Voice Penalty |
|-----------------|-------------|---------------|
| < 30% | −25 pts | −15 pts |
| 30%–49% | −15 pts | −10 pts |
| 50%–69% | −8 pts | −5 pts |
| 70%–79% | −4 pts | −2 pts |
| ≥ 80% | 0 pts | 0 pts |

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
| User interrupts with defensive/negative phrase | Negative | −3 pts/occurrence |
| User interrupts AI wrap-up/summary | Negative | −3 pts/occurrence |
| User interrupts with substantive response (>30 chars) | Positive (active engagement) | +2 pts/occurrence |
| Other | Neutral | 0 pts |

Net adjustment range: **−15 to +10 pts**.

---

## Voice Mode Detection (`isVoiceMode`)

A conversation is considered voice mode when `conversation.mode === 'realtime_voice'` or `conversation.mode === 'tts'`.

---

## 10-Point Rubric (`DEFAULT_10PT_RUBRICS`)

Used in the Gemini feedback prompt when no custom `scoringRubric` is provided for the evaluation dimensions. Contains detailed band descriptors (1–2, 3–4, 5–6, 7–8, 9–10) for each of the five default dimensions.

---

## Key Functions Reference

All of the following are exported from `server/services/evaluationEngine.ts`.

### Constants

| Export | Purpose |
|--------|---------|
| `DEFAULT_DIMENSIONS` | Five default competency dimensions (weight 20% each) |
| `DEFAULT_10PT_RUBRICS` | 10-point band rubric text for the five default dimensions |
| `EXPECTED_TURNS_TEXT` | Expected user turns for text mode (10) |
| `EXPECTED_TURNS_VOICE` | Expected user turns for voice mode (7) |
| `BASELINE_CHARS_PER_TURN` | Chars/turn baseline for density correction (40) |
| `NON_VERBAL_PENALTY_CAP` | Maximum non-verbal deduction (20 pts) |
| `BARGE_IN_MIN_ADJUSTMENT` | Lower bound for barge-in net adjustment (−15 pts) |
| `BARGE_IN_MAX_ADJUSTMENT` | Upper bound for barge-in net adjustment (+10 pts) |
| `BARGE_IN_POSITIVE_BONUS` | Points per positive (active) barge-in (+2) |
| `BARGE_IN_NEGATIVE_PENALTY` | Points per negative (poor-listening) barge-in (−3) |
| `COMPLETION_PENALTY_TIERS` | Penalty lookup table (ratio → text/voice penalties) |
| `SCORE_CAP_TIERS` | Dimension score cap lookup table (ratio → max score) |
| `NO_EVIDENCE_SCORE_CAP` | Max score when a dimension has no supporting evidence |

### Functions

| Function | Purpose |
|----------|---------|
| `isVoiceMode(conversation)` | Returns true for `realtime_voice` or `tts` mode |
| `filterVoiceNoise(messages)` | Removes STT noise from user messages in voice mode |
| `calcEffectiveRatio(messages, voiceMode, scenarioTargetTurns?, actualDurationSeconds?, scenarioTargetDurationMinutes?)` | Computes conversation completeness ratio (0–1) |
| `checkMinValidTurns(userMessages, minValidTurns)` | Returns true if user turn count meets minimum threshold |
| `analyzeNonVerbalPatterns(messages, conversation)` | Detects non-verbal utterances; returns count, patterns, penalty |
| `analyzeBargeIn(messages)` | Detects barge-in events; returns count, contexts, net adjustment |
| `calculateCompletionPenalty(ratio, voiceMode)` | Returns point penalty for incomplete conversations |
| `getScoreCap(ratio)` | Returns max allowed dimension score, or null if no cap applies |
| `calculateWeightedOverallScore(scores, criteria)` | Converts 1–10 dimension scores to 0–100 overall score |
| `applyEvidenceScoreCap(scores, evidenceMap, dimensions)` | Caps dimension scores that lack supporting evidence |
| `NO_EVIDENCE_SCORE_CAP` | Constant — max score for dimensions with no evidence |
| `makeInsufficientEvidenceFallback(wasCapped)` | Creates a system-generated placeholder evidence item |
| `isValidEvidenceItem(ev)` | Returns true if an evidence item is real (not a system fallback) |
| `validateEvaluationDimension(dim)` | Validates score range and rubric requirements for a single dimension |
| `validateEvaluationCriteriaSet(dimensions, options?)` | Validates a full criteria set (weight sum, key uniqueness, min dimensions) |
| `calculateRubricQualityScore(dimensions)` | Scores rubric quality 0–100 across 5 sub-categories |
| `calculateEvaluationConfidence(params)` | Computes confidence 0–1 from turn count, volume, completeness, evidence, noise |
| `determineReportStatus(confidence, error?)` | Maps confidence to `ReportStatus`: `valid` / `low_confidence` / `insufficient_data` / `system_fallback` |
| `getDefaultScores(criteria?)` | Returns minimum scores for all active dimensions |
| `applyPassingRule(overallScore, dimensionScores, passingRule)` | Applies `evaluationHarness.passingRule`; returns `HarnessPassResult` |

### Interfaces & Types

| Export | Purpose |
|--------|---------|
| `RubricQualityScoreResult` | Return type of `calculateRubricQualityScore` — breakdown + recommendations |
| `ReportStatus` | `'valid' \| 'low_confidence' \| 'insufficient_data' \| 'system_fallback'` |
| `HarnessPassResult` | `{ passed, failedMinScore, failedDimensions }` — result of `applyPassingRule` |

---

## Adding or Customizing Evaluation Criteria

Evaluation criteria sets are stored in the database (`evaluationCriteriaSets` table) and can define custom dimensions with their own weights, score ranges, rubrics, and evaluation prompts.

When a custom set is provided, it replaces `DEFAULT_DIMENSIONS` throughout the pipeline. The score adjustment pipeline (non-verbal, barge-in, completion) continues to apply regardless of custom criteria.

See `server/routes/evaluationCriteria.ts` for the CRUD API, and `shared/schema.ts` for the data model.

## ContentX evaluation snapshots

Each imported ContentX scenario creates an approved criteria set and maps contract weights (total 10) to persisted dimension weights (total 100). Its published scenario version embeds the complete criteria/dimension snapshot and evaluation harness.

When a run starts, these snapshots are copied onto the run and remain authoritative for evaluation. A later ContentX version creates a new scenario/version and cannot alter the rubric used by historical runs. Imported runs never fall back to a mutable live criteria set when their published rubric snapshot is missing. See `docs/integrations/contentx-roleplayx.md`.
