// ─── Tool-call text stripping ────────────────────────────────────────────────

/**
 * Removes hallucinated simulation tool-call text that Gemini sometimes emits
 * in the output transcription instead of (or alongside) a proper function call.
 *
 * Patterns handled:
 *  - update_npc_emotion{...}           complete brace-enclosed call
 *  - update_npc_emotion{...            truncated call (closing brace missing)
 *  - Call update_npc_emotion(...)      parenthetical "Call X" format
 *  - update_npc_<toolname>{...         any simulation tool with a similar shape
 *
 * When a call is truncated without a closing brace (common when Gemini embeds
 * the call mid-sentence), we strip up to the first occurrence of a newline or
 * the next sentence that starts with a CJK character / uppercase Latin letter,
 * then keep whatever comes after that separator.
 */
export function stripSimulationToolCallText(text: string): string {
  if (!text) return text;

  // 1. Remove complete calls: update_npc_emotion{...}
  let result = text.replace(/update_npc_\w+\s*\{[^}]*\}\s*/g, '');

  // 2. Remove complete parenthetical calls: Call update_npc_emotion(...)
  result = result.replace(/Call\s+update_npc_\w+\s*\([^)]*\)\s*/g, '');

  // 3. Remove "Call update_npc_..." where the format uses = instead of {
  //    e.g. "Call update_npc_=20,confusionDelta=15,..."
  result = result.replace(/Call\s+update_npc_[^\n]*/g, '');

  // 4. Handle truncated calls: update_npc_emotion{ ... (no closing brace)
  //    Strip from the call name up to the next sentence boundary.
  //    A "sentence boundary" here means: a newline, or a period/comma followed
  //    by a CJK character, or the pattern "},<speech>" (where the closing brace
  //    was accidentally appended to the speech).
  result = result.replace(/update_npc_\w+\s*\{[^}]*/g, '');

  return result.trim();
}

// ─── Script detection helpers ────────────────────────────────────────────────

const KOREAN_RE   = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const KANA_RE     = /[\u3040-\u309F\u30A0-\u30FF]/;
const CHINESE_RE  = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const CJK_RE      = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;
const ARABIC_RE   = /[\u0600-\u06FF\u0750-\u077F]/;

// ─── Meta-narrative openers (shared between isThinkingText / scoring) ─────────

/**
 * Common openers that characterise Gemini internal-reasoning or stage-direction
 * fragments.  Each pattern is tested against the trimmed line.
 */
const META_NARRATIVE_OPENERS: RegExp[] = [
  // Bold markdown – always reasoning
  /^\*\*[^*]+\*\*/,
  // Classic "I'm focusing / I'm thinking …"
  /^I['']m\s+(focusing|thinking|considering|now|about|going)/i,
  // "I need / I will / I am / I have to …"
  /^(I|Now|Let me|First|Okay|Alright)\s+(understand|need|will|am|have)\s*/i,
  // Verb openers characteristic of reasoning preambles
  /^(Initiating|Beginning|Starting|Transitioning|Highlighting|Setting|Establishing|Crafting|Generating|Reflecting|Analyzing|Considering|Ensuring|Maintaining)/i,
  // First-person contractions at start
  /^(I've|I'm|I'll)\s+/i,
  // "The user/situation/context is …"
  /^The\s+(user|situation|context)\s+(is|seems|appears|requires|wants)/i,
  // Meta-description of the scene/conversation/response
  /^The\s+(opening|scene|character|conversation|response|persona|dialogue|scenario|tone|mood|setting|approach)\s+(uses|opens|starts|begins|is|shows|will|should|needs|requires|sets)/i,
  // "My approach will …" / "My goal is …"
  /^My\s+(approach|goal|aim|strategy|intention|plan|response|tone)\s+(is|will|should|needs)/i,
  // "This response …" / "This scene …"
  /^This\s+(response|scene|situation|conversation|interaction|exchange)\s+(will|should|needs|is|calls)/i,
  // "Setting the scene …" / "Setting up …"
  /^Setting\s+(the|up|a)\s+(scene|tone|context|stage)/i,
  // Possessive reasoning fragments: "I',-young,'s urgency" style
  /^I[',\-\s]+\w+[',\-\s]+'s\s/i,
  // Comma-dash inline reasoning artefacts
  /,-\.\.|\.-,|,\s*-\s*\./,
  // AI narrative / stage directions in first person (past tense)
  /^I\s+(greeted|smiled|walked|turned|looked|noticed|approached|sat|stood|entered|bowed|nodded|paused|sighed|cleared|straightened|leaned|glanced|stared|frowned|winced|shrugged|crossed|folded|placed|reached|handed|picked|put|set\s+down)\b/i,
  // AI narrative (present tense imperative-style)
  /^I\s+(greet|smile|walk|nod|pause|hesitate|take\s+a|let\s+out|draw|exhale)/i,
  // Addressing by role: "I greeted X" / "I said to X"
  /^I\s+(greeted|addressed|called|said\s+to|spoke\s+to|replied\s+to|responded\s+to)\s+\w+/i,
  // Trailing colon reasoning headers: "Approach:" / "Strategy:"
  /^(Approach|Strategy|Tone|Style|Plan|Goal|Intent|Objective|Context|Summary|Analysis)\s*:/i,
  // "Okay, I will …" / "Alright, let me …"
  /^(Okay|Alright|Right|Sure|Well),?\s+(I\s+(will|need|am|should)|let\s+me)/i,
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Returns a "reasoning suspicion" score for a single trimmed line.
 * A score ≥ FILTER_THRESHOLD means the line should be treated as AI reasoning.
 *
 * Scores are cumulative – multiple weak signals can combine to reach the
 * threshold so novel phrasing that doesn't exactly match any one pattern
 * still gets caught when several signals are present.
 */
export const REASONING_SCORE_THRESHOLD = 3;

export function computeReasoningScore(line: string): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;

  let score = 0;

  // Definitive markers (score alone is enough to exceed threshold)
  if (/^\*\*[^*]+\*\*/.test(trimmed)) score += 5;
  if (/,-\.\.|\.-,|,\s*-\s*\./.test(trimmed)) score += 4;
  if (/^I[',\-\s]+\w+[',\-\s]+'s\s/i.test(trimmed)) score += 4;

  // Meta-narrative opener: +3
  const openerPatterns = META_NARRATIVE_OPENERS.slice(3); // skip bold/comma-dash/possessive already counted
  if (openerPatterns.some(p => p.test(trimmed))) score += 3;

  // Parenthesised / bracketed / asterisked stage directions
  if (/^\(.*\)\s*$/.test(trimmed) || /^\[.*\]\s*$/.test(trimmed) || /^\*[^*].*[^*]\*\s*$/.test(trimmed)) score += 4;

  // English-only line with a high ratio of "meta" vocabulary
  const metaVocab = /\b(initiating|transitioning|depicting|portraying|conveying|embodying|establishing|crafting|maintaining|reflecting|ensuring|scenario|persona|narrative|roleplay|role-play|dialogue|monologue|character|respondent)\b/i;
  if (metaVocab.test(trimmed) && !CJK_RE.test(trimmed)) score += 2;

  return score;
}

// ─── isThinkingText ───────────────────────────────────────────────────────────

export function isThinkingText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  // Never classify a line with Korean characters as thinking
  if (KOREAN_RE.test(text)) return false;

  const trimmed = text.trim();

  // Use the shared opener list for pattern matching
  if (META_NARRATIVE_OPENERS.some(p => p.test(trimmed))) return true;

  // Scoring fallback: catches novel variants
  return computeReasoningScore(trimmed) >= REASONING_SCORE_THRESHOLD;
}

// ─── isAINarrativeLine ────────────────────────────────────────────────────────

/**
 * Removes AI internal narrative patterns from a text line.
 * Catches first-person English stage directions not wrapped in any tag.
 */
export function isAINarrativeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Must be primarily English (no CJK)
  if (CJK_RE.test(trimmed)) return false;

  const narrativePatterns = [
    // Scene-setting action verbs in first person
    /^I\s+(greeted|smiled|walked|turned|looked|noticed|approached|sat|stood|entered|bowed|nodded|paused|sighed|cleared\s+my|straightened|leaned|glanced|stared|frowned|winced|shrugged|crossed|folded|placed|reached|handed|picked|put|set\s+down)\b/i,
    // Self-introduction narrative
    /^I('m|'ve|'ll|am|have|had|will)\s+(been|just|already|now|the|a|an)\b/i,
    // "I greeted X" or "I said to X" type patterns
    /^I\s+(greeted|addressed|called|said\s+to|spoke\s+to|replied\s+to|responded\s+to)\s+\w+/i,
    // Stage directions in parens/brackets at start
    /^\(.*\)\s*$/,
    /^\[.*\]\s*$/,
    // Bracketed action at start of line
    /^\*.*\*\s*$/,
  ];

  return narrativePatterns.some(p => p.test(trimmed));
}

// ─── filterThinkingText ───────────────────────────────────────────────────────

export interface FilterOptions {
  /**
   * When true, filtering is more aggressive:
   * – For non-English target languages: any line without a target-script
   *   character is removed (already the default behaviour for ko/ja/zh, but
   *   strict mode also applies the scoring filter to mixed lines).
   * – For English: the reasoning-score threshold is lowered to 2 so that
   *   weaker signals are also caught.
   *
   * Recommended for the **first AI turn** where reasoning preambles are most
   * likely to appear.
   */
  strictMode?: boolean;
}

export function filterThinkingText(
  text: string,
  userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko',
  options: FilterOptions = {}
): string {
  if (!text) return '';

  const { strictMode = false } = options;

  // Remove inline parenthesised asides and bold markdown spans globally
  let filtered = text.replace(/\([^)]{1,30}\)/g, '');
  filtered = filtered.replace(/\*\*[^*]+\*\*\s*/g, '');

  const languagePatterns: Record<string, RegExp> = {
    ko: KOREAN_RE,
    ja: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/,
    zh: /[\u4E00-\u9FFF\u3400-\u4DBF]/,
    en: /[a-zA-Z]/,
  };

  // ── English mode ────────────────────────────────────────────────────────────
  if (userLanguage === 'en') {
    const scoreThreshold = strictMode ? 2 : REASONING_SCORE_THRESHOLD;
    const lines = filtered.split('\n');
    const validLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      // Drop lines that contain non-English scripts
      if (KOREAN_RE.test(trimmed) || KANA_RE.test(trimmed) || CHINESE_RE.test(trimmed) || ARABIC_RE.test(trimmed)) {
        return false;
      }

      // Score-based filter (catches known patterns and novel variants)
      if (computeReasoningScore(trimmed) >= scoreThreshold) return false;

      // Deterministic pattern list — single source of truth shared with isThinkingText.
      // Handles cases where a line's score alone might not reach the threshold
      // (e.g. a single low-weight signal in isolation).
      if (META_NARRATIVE_OPENERS.some(pattern => pattern.test(trimmed))) return false;

      // In strict mode, also apply the narrative line check
      if (strictMode && isAINarrativeLine(trimmed)) return false;

      return true;
    });

    filtered = validLines.join('\n').trim();
    filtered = filtered.replace(/\s+/g, ' ');
    return filtered;
  }

  // ── Non-English target language modes (ko / ja / zh) ──────────────────────
  const targetPattern = languagePatterns[userLanguage] || languagePatterns.ko;

  const lines = filtered.split('\n');
  const targetLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    const hasTargetLanguage = targetPattern.test(trimmed);
    if (!hasTargetLanguage) return false;

    if (userLanguage === 'ko') {
      if (!KOREAN_RE.test(trimmed)) return false;
      if (KANA_RE.test(trimmed)) return false;
      if (ARABIC_RE.test(trimmed)) return false;
    }

    if (userLanguage === 'zh') {
      if (KOREAN_RE.test(trimmed) || KANA_RE.test(trimmed)) return false;
      if (ARABIC_RE.test(trimmed)) return false;
    }

    if (userLanguage === 'ja') {
      if (KOREAN_RE.test(trimmed)) return false;
      if (ARABIC_RE.test(trimmed)) return false;
    }

    const targetCharCount = (trimmed.match(new RegExp(targetPattern.source, 'g')) || []).length;
    const englishWords = (trimmed.match(/\b[a-zA-Z]+\b/g) || []).length;

    // Default: English words must not vastly outnumber target-script chars
    const ratio = strictMode ? 2 : 3;
    if (englishWords > 0 && englishWords >= targetCharCount * ratio) return false;

    // In strict mode, also reject lines whose English portion scores as reasoning
    if (strictMode) {
      const englishOnly = trimmed.replace(new RegExp(targetPattern.source, 'g'), '').trim();
      if (englishOnly && computeReasoningScore(englishOnly) >= REASONING_SCORE_THRESHOLD) return false;
    }

    return true;
  });

  filtered = targetLines.join('\n').trim();

  filtered = filtered.replace(/([a-zA-Z\s]{20,})/g, (match) => {
    if (!targetPattern.test(match)) return '';
    return match;
  });

  filtered = filtered.trim();
  filtered = filtered.replace(/\s+/g, ' ');

  return filtered;
}
