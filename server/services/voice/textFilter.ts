export function isThinkingText(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(text)) {
    return false;
  }

  if (/^\*\*[^*]+\*\*/.test(text.trim())) {
    return true;
  }

  const thinkingPatterns = [
    /^I['']m\s+(focusing|thinking|considering|now|about|going)/i,
    /^(I|Now|Let me|First|Okay)\s+(understand|need|will|am|have)/i,
    /^(Initiating|Beginning|Starting|Transitioning|Highlighting)/i,
    /^(I've|I'm|I'll)\s+/i,
    /^The\s+(user|situation|context)/i,
    // AI narrative/stage directions (untagged)
    /^I\s+(greeted|smiled|walked|turned|looked|noticed|approached|sat|stood|entered|bowed|nodded|paused|sighed|cleared|straightened|leaned|glanced)/i,
    /^(I greet|I smile|I walk|I nod|I pause|I hesitate|I take a|I let out|I draw|I exhale)/i,
  ];

  const trimmed = text.trim();
  return thinkingPatterns.some(pattern => pattern.test(trimmed));
}

/**
 * Removes AI internal narrative patterns from a text line.
 * Catches first-person English stage directions not wrapped in any tag.
 */
export function isAINarrativeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Must be primarily English (no CJK)
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trimmed)) {
    return false;
  }

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

export function filterThinkingText(text: string, userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'): string {
  if (!text) return '';

  let filtered = text.replace(/\([^)]{1,30}\)/g, '');
  filtered = filtered.replace(/\*\*[^*]+\*\*\s*/g, '');

  const languagePatterns: Record<string, RegExp> = {
    ko: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
    ja: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/,
    zh: /[\u4E00-\u9FFF\u3400-\u4DBF]/,
    en: /[a-zA-Z]/,
  };

  const koreanPattern = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
  const japaneseKanaPattern = /[\u3040-\u309F\u30A0-\u30FF]/;
  const chinesePattern = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F]/;

  if (userLanguage === 'en') {
    const lines = filtered.split('\n');
    const validLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      if (koreanPattern.test(trimmed) || japaneseKanaPattern.test(trimmed) || chinesePattern.test(trimmed) || arabicPattern.test(trimmed)) {
        return false;
      }

      const thinkingPatterns = [
        /^\*\*[^*]+\*\*/,
        /^I['']m\s+(focusing|thinking|considering|now|about|going)/i,
        /^(I|Now|Let me|First|Okay)\s+(understand|need|will|am|have)\s+to/i,
        /^(Initiating|Beginning|Starting|Transitioning|Highlighting)/i,
        /^The\s+(user|situation|context)\s+(is|seems|appears)/i,
        /^(considering|crafting|ensuring|maintaining|reflecting)/i,
        // AI stage-direction narration (untagged)
        /^I\s+(greeted|smiled|walked|turned|looked|noticed|approached|sat|stood|entered|bowed|nodded|paused|sighed|cleared\s+my|straightened|leaned|glanced|stared|frowned|winced|shrugged|crossed|folded|placed|reached|handed|picked|put|set\s+down)\b/i,
        /^I\s+(greeted|addressed|called|said\s+to|spoke\s+to|replied\s+to|responded\s+to)\s+\w+/i,
        // Bracketed/asterisked stage directions
        /^\(.*\)$/,
        /^\[.*\]$/,
        /^\*[^*].*[^*]\*$/,
      ];

      if (thinkingPatterns.some(pattern => pattern.test(trimmed))) {
        return false;
      }

      if (isAINarrativeLine(trimmed)) {
        return false;
      }

      return true;
    });

    filtered = validLines.join('\n').trim();
    filtered = filtered.replace(/\s+/g, ' ');
    return filtered;
  }

  const targetPattern = languagePatterns[userLanguage] || languagePatterns.ko;

  const lines = filtered.split('\n');
  const targetLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    const hasTargetLanguage = targetPattern.test(trimmed);
    if (!hasTargetLanguage) return false;

    if (userLanguage === 'ko') {
      if (!koreanPattern.test(trimmed)) {
        return false;
      }
      if (japaneseKanaPattern.test(trimmed)) {
        return false;
      }
      if (arabicPattern.test(trimmed)) {
        return false;
      }
    }

    if (userLanguage === 'zh') {
      if (koreanPattern.test(trimmed) || japaneseKanaPattern.test(trimmed)) {
        return false;
      }
      if (arabicPattern.test(trimmed)) {
        return false;
      }
    }

    if (userLanguage === 'ja') {
      if (koreanPattern.test(trimmed)) {
        return false;
      }
      if (arabicPattern.test(trimmed)) {
        return false;
      }
    }

    const targetCharCount = (trimmed.match(new RegExp(targetPattern.source, 'g')) || []).length;
    const englishWords = (trimmed.match(/\b[a-zA-Z]+\b/g) || []).length;

    if (englishWords > 0 && englishWords >= targetCharCount * 3) {
      return false;
    }

    return true;
  });

  filtered = targetLines.join('\n').trim();

  filtered = filtered.replace(/([a-zA-Z\s]{20,})/g, (match) => {
    if (!targetPattern.test(match)) {
      return '';
    }
    return match;
  });

  filtered = filtered.trim();
  filtered = filtered.replace(/\s+/g, ' ');

  return filtered;
}
