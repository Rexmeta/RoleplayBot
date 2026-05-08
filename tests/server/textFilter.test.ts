import { describe, it, expect } from 'vitest';
import { isThinkingText, isAINarrativeLine, filterThinkingText } from '../../server/services/voice/textFilter';

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

    it('returns true for "Now I understand..." (Now + understand)', () => {
      expect(isThinkingText('Now understand the situation')).toBe(true);
    });

    it('returns true for "Initiating..."', () => {
      expect(isThinkingText('Initiating role play')).toBe(true);
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

  describe('legitimate dialogue should not be classified as thinking', () => {
    it('returns false for empty string', () => {
      expect(isThinkingText('')).toBe(false);
    });

    it('returns false for whitespace only', () => {
      expect(isThinkingText('   ')).toBe(false);
    });
  });
});

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

describe('filterThinkingText', () => {
  describe('Korean mode (default)', () => {
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
  });

  describe('English mode', () => {
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
  });

  describe('empty and edge cases', () => {
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
});

describe('filterThinkingText — new reasoning fragment patterns', () => {
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

describe('filterThinkingText — scenario metrics should not leak through', () => {
  it('English mode: removes lines that are pure AI narrative about scenario numbers', () => {
    const aiOutput = [
      "I greeted the newcomer. The situation involves a 300% increase.",
      "Hello, welcome aboard.",
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
