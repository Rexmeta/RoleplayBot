import { describe, it, expect } from 'vitest';
import {
  isThinkingText,
  isAINarrativeLine,
  filterThinkingText,
  computeReasoningScore,
  REASONING_SCORE_THRESHOLD,
  isStageDirectionText,
  stripInternalActionMarkers,
  stripSimulationToolCallText,
  collapseDoubledTranscript,
} from '../../server/services/voice/textFilter';

// ─── isThinkingText ───────────────────────────────────────────────────────────

describe('isThinkingText', () => {
  describe('Korean text is never classified as thinking', () => {
    it('returns false for Korean text', () => {
      expect(isThinkingText('안녕하세요, 반갑습니다.')).toBe(false);
    });

    it('returns false for mixed Korean/English with Korean characters', () => {
      expect(isThinkingText('I am 테스트')).toBe(false);
    });
  });

  describe('bold meta text', () => {
    it('returns true for text starting with **bold**', () => {
      expect(isThinkingText('**System Thinking**')).toBe(true);
    });
  });

  describe('standard thinking patterns', () => {
    it('returns true for "I\'m focusing..."', () => {
      expect(isThinkingText("I'm focusing on the response")).toBe(true);
    });

    it('returns true for "I need to..."', () => {
      expect(isThinkingText('I need to respond')).toBe(true);
    });

    it('returns true for "Now I understand..."', () => {
      expect(isThinkingText('Now understand the situation')).toBe(true);
    });

    it('returns true for "Initiating..."', () => {
      expect(isThinkingText('Initiating role play')).toBe(true);
    });

    it('returns true for "Setting the scene..."', () => {
      expect(isThinkingText('Setting the scene with tension')).toBe(true);
    });

    it('returns true for "Establishing context..."', () => {
      expect(isThinkingText('Establishing a firm tone for this exchange')).toBe(true);
    });

    it('returns true for "My approach is..."', () => {
      expect(isThinkingText('My approach is to be direct and assertive')).toBe(true);
    });

    it('returns true for "This response will..."', () => {
      expect(isThinkingText('This response will reflect frustration')).toBe(true);
    });

    it('returns true for "Approach:" header', () => {
      expect(isThinkingText('Approach: use a calm but firm tone')).toBe(true);
    });

    it('returns true for "Okay, I will..."', () => {
      expect(isThinkingText('Okay, I will respond with urgency')).toBe(true);
    });

    it('returns true for "Alright, let me..."', () => {
      expect(isThinkingText('Alright, let me craft this reply')).toBe(true);
    });
  });

  describe('AI narrative/stage direction patterns', () => {
    it('returns true for "I greeted..."', () => {
      expect(isThinkingText('I greeted Rex with a smile')).toBe(true);
    });

    it('returns true for "I smiled at..."', () => {
      expect(isThinkingText('I smiled at the newcomer')).toBe(true);
    });

    it('returns true for "I walked toward..."', () => {
      expect(isThinkingText('I walked toward the meeting room')).toBe(true);
    });

    it('returns true for "I nodded..."', () => {
      expect(isThinkingText('I nodded in acknowledgment')).toBe(true);
    });

    it('returns true for "I turned..."', () => {
      expect(isThinkingText('I turned to face the user')).toBe(true);
    });

    it('returns true for "I paused..."', () => {
      expect(isThinkingText('I paused before answering')).toBe(true);
    });

    it('returns true for "I sighed..."', () => {
      expect(isThinkingText('I sighed deeply')).toBe(true);
    });
  });

  describe('possessive / comma-dash reasoning fragments', () => {
    it('catches possessive reasoning fragment: "I\',-young,\'s urgency"', () => {
      expect(isThinkingText("I',-young,'s urgency")).toBe(true);
    });

    it('catches comma-dash inline reasoning patterns', () => {
      expect(isThinkingText("urgency.,-.. The opening uses")).toBe(true);
    });
  });

  describe('meta-description openers', () => {
    it('catches "The opening uses a sense of urgency"', () => {
      expect(isThinkingText('The opening uses a sense of urgency')).toBe(true);
    });

    it('catches "The scene opens with..."', () => {
      expect(isThinkingText('The scene opens with the manager')).toBe(true);
    });

    it('catches "The dialogue begins with..."', () => {
      expect(isThinkingText('The dialogue begins with a challenge')).toBe(true);
    });

    it('catches "The persona needs to..."', () => {
      expect(isThinkingText('The persona needs to convey urgency')).toBe(true);
    });

    it('catches "The tone should be..."', () => {
      expect(isThinkingText('The tone should be firm and direct')).toBe(true);
    });
  });

  describe('legitimate dialogue must not be classified as thinking', () => {
    it('returns false for empty string', () => {
      expect(isThinkingText('')).toBe(false);
    });

    it('returns false for whitespace only', () => {
      expect(isThinkingText('   ')).toBe(false);
    });

    it('returns false for normal English greeting', () => {
      expect(isThinkingText('Good morning. How can I help you today?')).toBe(false);
    });

    it('returns false for question beginning with "The"', () => {
      expect(isThinkingText('The project deadline is next Friday.')).toBe(false);
    });
  });
});

// ─── isAINarrativeLine ────────────────────────────────────────────────────────

describe('isAINarrativeLine', () => {
  it('returns true for "I greeted X" pattern', () => {
    expect(isAINarrativeLine('I greeted Rex warmly')).toBe(true);
  });

  it('returns true for "I smiled at..." pattern', () => {
    expect(isAINarrativeLine('I smiled at him and said hello')).toBe(true);
  });

  it('returns true for parenthesized stage direction', () => {
    expect(isAINarrativeLine('(walks to the meeting room)')).toBe(true);
  });

  it('returns true for bracketed stage direction', () => {
    expect(isAINarrativeLine('[smiles warmly]')).toBe(true);
  });

  it('returns true for asterisk-wrapped stage direction', () => {
    expect(isAINarrativeLine('*takes a deep breath*')).toBe(true);
  });

  it('returns false for Korean text', () => {
    expect(isAINarrativeLine('안녕하세요, 반갑습니다')).toBe(false);
  });

  it('returns false for Japanese text', () => {
    expect(isAINarrativeLine('こんにちは、よろしくお願いします')).toBe(false);
  });

  it('returns false for Chinese text', () => {
    expect(isAINarrativeLine('你好，很高兴见到你')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAINarrativeLine('')).toBe(false);
  });

  it('returns false for normal English dialogue', () => {
    expect(isAINarrativeLine('Hello, how can I help you today?')).toBe(false);
  });

  it('returns false for "I think we should..." (not a narrative action)', () => {
    expect(isAINarrativeLine('I think we should discuss this further.')).toBe(false);
  });
});

// ─── computeReasoningScore ────────────────────────────────────────────────────

describe('computeReasoningScore', () => {
  it('returns 0 for empty string', () => {
    expect(computeReasoningScore('')).toBe(0);
  });

  it('gives high score to bold markdown openers', () => {
    expect(computeReasoningScore('**Thinking**')).toBeGreaterThanOrEqual(REASONING_SCORE_THRESHOLD);
  });

  it('gives high score to comma-dash artefacts', () => {
    expect(computeReasoningScore('urgency.,-.. ')).toBeGreaterThanOrEqual(REASONING_SCORE_THRESHOLD);
  });

  it('gives high score to parenthesised stage directions', () => {
    expect(computeReasoningScore('(sighs deeply)')).toBeGreaterThanOrEqual(REASONING_SCORE_THRESHOLD);
  });

  it('gives high score to bracketed stage directions', () => {
    expect(computeReasoningScore('[nods]')).toBeGreaterThanOrEqual(REASONING_SCORE_THRESHOLD);
  });

  it('gives high score to meta-vocabulary reasoning lines', () => {
    expect(computeReasoningScore('Initiating the roleplay scenario')).toBeGreaterThanOrEqual(REASONING_SCORE_THRESHOLD);
  });

  it('gives low score to normal English dialogue', () => {
    expect(computeReasoningScore('Good morning. What can I do for you today?')).toBeLessThan(REASONING_SCORE_THRESHOLD);
  });

  it('gives low score to a simple question', () => {
    expect(computeReasoningScore('How did the presentation go?')).toBeLessThan(REASONING_SCORE_THRESHOLD);
  });

  it('cumulative scoring: meta-vocab + opener together exceed threshold', () => {
    const score = computeReasoningScore('Establishing the persona narrative for the dialogue');
    expect(score).toBeGreaterThanOrEqual(REASONING_SCORE_THRESHOLD);
  });
});

// ─── filterThinkingText — Korean mode ─────────────────────────────────────────

describe('filterThinkingText — Korean mode (default)', () => {
  it('passes through Korean text unchanged', () => {
    const text = '안녕하세요, 무슨 일이시죠?';
    expect(filterThinkingText(text, 'ko')).toBe(text);
  });

  it('removes lines that are pure English when language is Korean', () => {
    const mixed = '안녕하세요\nI greeted the user warmly\n무슨 일이시죠?';
    const result = filterThinkingText(mixed, 'ko');
    expect(result).toContain('안녕하세요');
    expect(result).not.toContain('I greeted');
  });

  it('removes parenthesized actions', () => {
    const text = '안녕하세요 (웃으며)';
    const result = filterThinkingText(text, 'ko');
    expect(result).not.toContain('웃으며');
  });

  it('Korean mode strict: passes through Korean even in strict mode', () => {
    const text = '안녕하세요. 오늘 뵙게 되어 반갑습니다.';
    const result = filterThinkingText(text, 'ko', { strictMode: true });
    expect(result).toContain('안녕하세요');
    expect(result).toContain('반갑습니다');
  });

  it('Korean mode strict: strips English reasoning that passes default mode due to loose ratio', () => {
    // Line has Korean chars but English vastly outnumbers them (default ratio=3, strict=2)
    const mixed = '안녕 I need to initiate the scenario persona roleplay establishing context';
    const result = filterThinkingText(mixed, 'ko', { strictMode: true });
    // Should be stripped because English word count >> Korean char count
    expect(result.trim()).toBe('');
  });

  it('removes Korean scenario-direction text while retaining the spoken dialogue', () => {
    const text = '생산라인 문제, 더 자세히 이야기해보세요. 지금 매우 중요한 상황이니까 확실하게 말해주셔야 됩니다.\n상대방이 내 침묵에 의문을 제기하자 상황을 모면하고, 원래 하려던 보고를 재촉함. 상황의 심각성을 강조하며 상세 보고 요구.';
    const result = filterThinkingText(text, 'ko');

    expect(result).toContain('생산라인 문제');
    expect(result).not.toContain('상황을 모면');
    expect(result).not.toContain('상세 보고 요구');
  });
});

describe('isStageDirectionText', () => {
  it('recognizes Korean scenario notes that must not be spoken', () => {
    expect(isStageDirectionText('상황을 모면하고 원래 하려던 보고를 재촉함.')).toBe(true);
    expect(isStageDirectionText('상황의 심각성을 강조하며 상세 보고 요구.')).toBe(true);
  });

  it('does not mistake real Korean dialogue for a stage direction', () => {
    expect(isStageDirectionText('생산라인 문제를 더 자세히 말씀해 주세요.')).toBe(false);
  });
});

// ─── filterThinkingText — English mode ───────────────────────────────────────

describe('filterThinkingText — English mode', () => {
  it('removes thinking patterns from English text', () => {
    const text = "I'm focusing on my response. Hello, how can I help you?";
    const result = filterThinkingText(text, 'en');
    expect(result).not.toContain("I'm focusing");
  });

  it('removes AI narrative stage directions in English mode', () => {
    const lines = 'I greeted Rex with a smile.\nHello, good to see you today.';
    const result = filterThinkingText(lines, 'en');
    expect(result).not.toContain('I greeted');
    expect(result).toContain('Hello, good to see you today');
  });

  it('removes "Initiating..." type meta text in English mode', () => {
    const text = 'Initiating role play.\nGood morning, what brings you in today?';
    const result = filterThinkingText(text, 'en');
    expect(result).not.toContain('Initiating');
    expect(result).toContain('Good morning');
  });

  it('removes parenthesized stage directions from English output', () => {
    const text = 'Hello there.\n(sighs deeply)\nLet me explain.';
    const result = filterThinkingText(text, 'en');
    expect(result).not.toContain('sighs');
  });

  it('keeps normal English dialogue intact', () => {
    const text = 'Good morning. I wanted to discuss the project timeline with you.';
    const result = filterThinkingText(text, 'en');
    expect(result).toContain('Good morning');
    expect(result).toContain('project timeline');
  });

  it('removes "Setting the scene..." in English mode', () => {
    const result = filterThinkingText('Setting the scene with urgency.\nPlease sit down.', 'en');
    expect(result).not.toContain('Setting the scene');
    expect(result).toContain('Please sit down');
  });

  it('removes "My approach is..." in English mode', () => {
    const result = filterThinkingText('My approach is to be direct.\nGood morning.', 'en');
    expect(result).not.toContain('My approach');
    expect(result).toContain('Good morning');
  });

  it('removes "This response will..." in English mode', () => {
    const result = filterThinkingText('This response will be assertive.\nPlease take a seat.', 'en');
    expect(result).not.toContain('This response will');
    expect(result).toContain('Please take a seat');
  });

  it('removes "Approach:" header lines in English mode', () => {
    const result = filterThinkingText('Approach: use a firm tone.\nWelcome.', 'en');
    expect(result).not.toContain('Approach:');
    expect(result).toContain('Welcome');
  });

  it('removes "Okay, I will..." preamble in English mode', () => {
    const result = filterThinkingText('Okay, I will respond calmly.\nHello.', 'en');
    expect(result).not.toContain('Okay, I will');
    expect(result).toContain('Hello');
  });

  it('removes score-based reasoning lines not matched by explicit patterns (en mode)', () => {
    // Contains meta-vocab + opener → high score
    const text = 'Establishing the persona for this roleplay dialogue.\nHello there.';
    const result = filterThinkingText(text, 'en');
    expect(result).not.toContain('Establishing the persona');
    expect(result).toContain('Hello there');
  });

  it('strict mode: lower threshold catches weaker reasoning signals', () => {
    // "Crafting" alone might score exactly 3 in default but 2 in strict
    const text = 'Crafting a careful reply.\nGood morning.';
    const resultStrict = filterThinkingText(text, 'en', { strictMode: true });
    expect(resultStrict).not.toContain('Crafting');
    expect(resultStrict).toContain('Good morning');
  });

  it('strict mode: still keeps clean dialogue', () => {
    const text = 'Good morning. Let us go over the report together.';
    const result = filterThinkingText(text, 'en', { strictMode: true });
    expect(result).toContain('Good morning');
    expect(result).toContain('report');
  });

  it('strict mode: filters AI narrative lines missed by default mode', () => {
    const text = 'I smiled at him.\nWelcome aboard.';
    const resultStrict = filterThinkingText(text, 'en', { strictMode: true });
    expect(resultStrict).not.toContain('I smiled');
    expect(resultStrict).toContain('Welcome aboard');
  });
});

// ─── filterThinkingText — Japanese mode ──────────────────────────────────────

describe('filterThinkingText — Japanese mode', () => {
  it('passes through Japanese text', () => {
    const text = 'こんにちは、今日はどうされましたか？';
    const result = filterThinkingText(text, 'ja');
    expect(result).toContain('こんにちは');
  });

  it('does not accidentally filter legitimate Japanese dialogue in strict mode', () => {
    const text = 'こんにちは、今日はどうされましたか？';
    const result = filterThinkingText(text, 'ja', { strictMode: true });
    expect(result).toContain('こんにちは');
  });
});

// ─── filterThinkingText — Chinese mode ───────────────────────────────────────

describe('filterThinkingText — Chinese mode', () => {
  it('passes through Chinese text', () => {
    const text = '你好，请问有什么可以帮助您？';
    const result = filterThinkingText(text, 'zh');
    expect(result).toContain('你好');
  });

  it('does not accidentally filter legitimate Chinese dialogue in strict mode', () => {
    const text = '你好，请问有什么可以帮助您？';
    const result = filterThinkingText(text, 'zh', { strictMode: true });
    expect(result).toContain('你好');
  });
});

// ─── filterThinkingText — edge cases ─────────────────────────────────────────

describe('filterThinkingText — empty and edge cases', () => {
  it('returns empty string for empty input', () => {
    expect(filterThinkingText('', 'ko')).toBe('');
  });

  it('returns empty string for null-like input', () => {
    expect(filterThinkingText(null as any, 'ko')).toBe('');
  });

  it('does not crash on whitespace-only input', () => {
    expect(() => filterThinkingText('   ', 'ko')).not.toThrow();
  });
});

// ─── filterThinkingText — known leaked reasoning fragments ───────────────────

describe('filterThinkingText — known leaked reasoning fragments', () => {
  it('filters the exact leaked reasoning text from the bug report (en mode)', () => {
    const leaked = "I',-young,'s urgency.,-.. The opening uses";
    const result = filterThinkingText(leaked, 'en');
    expect(result.trim()).toBe('');
  });

  it('filters the exact leaked reasoning text from the bug report (ko mode)', () => {
    const leaked = "I',-young,'s urgency.,-.. The opening uses";
    const result = filterThinkingText(leaked, 'ko');
    expect(result.trim()).toBe('');
  });

  it('filters "The opening uses..." meta-description in English mode', () => {
    const text = 'The opening uses a sense of urgency.\nGood morning, what can I do for you?';
    const result = filterThinkingText(text, 'en');
    expect(result).not.toContain('The opening uses');
    expect(result).toContain('Good morning');
  });

  it('filters "The scene opens with..." in English mode', () => {
    const result = filterThinkingText('The scene opens with tension.\nHello there.', 'en');
    expect(result).not.toContain('The scene opens');
    expect(result).toContain('Hello there');
  });

  it('filters "The response will..." in English mode', () => {
    const result = filterThinkingText('The response will be firm.\nPlease take a seat.', 'en');
    expect(result).not.toContain('The response will');
    expect(result).toContain('Please take a seat');
  });

  it('does not accidentally filter legitimate Korean dialogue', () => {
    const koText = '안녕하세요, 오늘 무슨 일이세요?';
    const result = filterThinkingText(koText, 'ko');
    expect(result).toContain('안녕하세요');
  });

  it('does not accidentally filter legitimate Japanese dialogue', () => {
    const jaText = 'こんにちは、今日はどうされましたか？';
    const result = filterThinkingText(jaText, 'ja');
    expect(result).toContain('こんにちは');
  });

  it('does not accidentally filter legitimate Chinese dialogue', () => {
    const zhText = '你好，请问有什么可以帮助您？';
    const result = filterThinkingText(zhText, 'zh');
    expect(result).toContain('你好');
  });
});

// ─── filterThinkingText — scenario metrics should not leak through ────────────

describe('filterThinkingText — scenario metrics should not leak through', () => {
  it('English mode: removes lines that are pure AI narrative about scenario numbers', () => {
    const aiOutput = [
      'I greeted the newcomer. The situation involves a 300% increase.',
      'Hello, welcome aboard.',
    ].join('\n');

    const result = filterThinkingText(aiOutput, 'en');
    expect(result).not.toContain('I greeted');
    expect(result).toContain('Hello, welcome aboard');
  });

  it('Korean mode: Korean response is passed through without stripping valid content', () => {
    const koText = '안녕하세요. 오늘 뵙게 되어 반갑습니다.';
    const result = filterThinkingText(koText, 'ko');
    expect(result).toContain('안녕하세요');
    expect(result).toContain('반갑습니다');
  });
});

// ─── isThinkingText — legacy new fragment patterns (kept for regression) ──────

describe('isThinkingText — new reasoning fragment patterns', () => {
  it('catches possessive reasoning fragment: "I\',-young,\'s urgency"', () => {
    expect(isThinkingText("I',-young,'s urgency")).toBe(true);
  });

  it('catches meta-description opener: "The opening uses a sense of urgency"', () => {
    expect(isThinkingText('The opening uses a sense of urgency')).toBe(true);
  });

  it('catches meta-description opener: "The scene opens with..."', () => {
    expect(isThinkingText('The scene opens with the manager')).toBe(true);
  });

  it('catches meta-description opener: "The dialogue begins with..."', () => {
    expect(isThinkingText('The dialogue begins with a challenge')).toBe(true);
  });

  it('catches comma-dash inline reasoning patterns', () => {
    expect(isThinkingText("urgency.,-.. The opening uses")).toBe(true);
  });

  it('does not catch normal English dialogue', () => {
    expect(isThinkingText('Good morning. How can I help you today?')).toBe(false);
  });
});

// ─── stripInternalActionMarkers ──────────────────────────────────────────────

describe('stripInternalActionMarkers', () => {
  it('removes a bare action_result: prefix', () => {
    expect(stripInternalActionMarkers('action_result:안녕하세요, 반갑습니다.'))
      .toBe('안녕하세요, 반갑습니다.');
  });

  it('removes doubled action_result:action_result: prefixes (production bug shape)', () => {
    expect(stripInternalActionMarkers('action_result:action_result:제가 그랬나요? 중간점검 어떻게 할까요?'))
      .toBe('제가 그랬나요? 중간점검 어떻게 할까요?');
  });

  it('removes action_result with JSON payload', () => {
    expect(stripInternalActionMarkers('action_result: {"success": true} 네, 알겠습니다.'))
      .toBe('네, 알겠습니다.');
  });

  it('removes tool_result / function_response variants', () => {
    expect(stripInternalActionMarkers('tool_result: 확인했습니다.')).toBe('확인했습니다.');
    expect(stripInternalActionMarkers('function_response: {"ok":1} 좋습니다.')).toBe('좋습니다.');
    expect(stripInternalActionMarkers('tool_output: 진행하겠습니다.')).toBe('진행하겠습니다.');
  });

  it('removes markers with fullwidth colon', () => {
    expect(stripInternalActionMarkers('action_result：네, 확인했습니다.')).toBe('네, 확인했습니다.');
  });

  it('removes markers in the middle of a sentence', () => {
    expect(stripInternalActionMarkers('네 action_result: 알겠습니다.')).toBe('네 알겠습니다.');
  });

  it('is case-insensitive', () => {
    expect(stripInternalActionMarkers('Action_Result: 확인')).toBe('확인');
  });

  it('leaves normal text untouched', () => {
    const text = '하... Rex님, 지금 중요한 건 프로젝트 기획안 진행 상황이에요.';
    expect(stripInternalActionMarkers(text)).toBe(text);
  });

  it('does not remove words that merely contain marker-like substrings without a colon', () => {
    expect(stripInternalActionMarkers('the action resulted in success'))
      .toBe('the action resulted in success');
  });

  it('handles empty string', () => {
    expect(stripInternalActionMarkers('')).toBe('');
  });
});

// ─── stripSimulationToolCallText strips internal markers ─────────────────────

describe('stripSimulationToolCallText internal marker integration', () => {
  it('strips action_result markers alongside tool-call text', () => {
    expect(stripSimulationToolCallText('action_result:action_result:내일 오전 점검 가능하신 겁니까?'))
      .toBe('내일 오전 점검 가능하신 겁니까?');
  });
});

// ─── filterThinkingText strips internal markers ──────────────────────────────

describe('filterThinkingText internal marker integration', () => {
  it('strips action_result prefix from Korean transcript', () => {
    const result = filterThinkingText('action_result:action_result:제가 그랬나요? 확답 주세요.', 'ko');
    expect(result).not.toContain('action_result');
    expect(result).toContain('제가 그랬나요?');
  });

  it('strips action_result prefix from English transcript', () => {
    const result = filterThinkingText('action_result: Sure, tomorrow morning works for me.', 'en');
    expect(result).not.toContain('action_result');
    expect(result).toContain('tomorrow morning works');
  });
});

// ─── collapseDoubledTranscript ───────────────────────────────────────────────

describe('collapseDoubledTranscript', () => {
  it('collapses an exact back-to-back duplicated sentence', () => {
    const half = '제가 그랬나요? 업무 내용에 집중하다 보니 저도 모르게 그랬을 수도 있겠네요.';
    expect(collapseDoubledTranscript(half + half)).toBe(half);
  });

  it('collapses duplication with whitespace differences between halves', () => {
    const a = '하... Rex님, 제가 분명히 다른 말씀도 드렸는데 왜 그 부분만 계속 지적하시는지 모르겠네요.';
    const b = '하...Rex님,제가분명히다른말씀도드렸는데왜그 부분만계속지적하시는지모르겠네요.'.replace(/,/g, ',');
    // whitespace-normalized halves must match for collapse; construct that case
    const doubled = a + ' ' + a.replace(/\s+/g, '');
    const collapsed = collapseDoubledTranscript(doubled);
    expect(collapsed.replace(/\s+/g, '')).toBe(a.replace(/\s+/g, ''));
  });

  it('does not touch short repeated phrases', () => {
    expect(collapseDoubledTranscript('네, 네,')).toBe('네, 네,');
    expect(collapseDoubledTranscript('좋아요좋아요')).toBe('좋아요좋아요');
  });

  it('does not touch non-duplicated text', () => {
    const text = '내일 오전 점검 가능하신 겁니까? 확답 주세요. 지금 중요한 건 프로젝트 기획안 진행 상황이에요.';
    expect(collapseDoubledTranscript(text)).toBe(text);
  });

  it('does not touch text where only part repeats', () => {
    const text = '제가 그랬나요? 제가 그랬나요? 그런데 내일 오전은 괜찮으세요?';
    expect(collapseDoubledTranscript(text)).toBe(text);
  });

  it('handles empty string', () => {
    expect(collapseDoubledTranscript('')).toBe('');
  });

  it('collapses English duplicated transcript', () => {
    const half = 'Did I really do that? I may have done it without realizing while focusing on work.';
    expect(collapseDoubledTranscript(half + half)).toBe(half);
  });
});
