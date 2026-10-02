import { describe, it, expect } from 'vitest';
import { candidateStatus, recognitionResolved, recognitionRevision } from '../../server/services/voice/recognitionPolicy';

describe('recognition is independent of provider completion', () => {
  it.each(['네', '123', '김테스트', 'CRM', 'API 제품을 사용해요', 'Yes, 알겠습니다'])(
    'does not reject short, mixed, numeric or named speech: %s', text => {
      expect(candidateStatus(text, true, text).status).toBe('verified');
      expect(recognitionResolved({ id: 'a', status: 'confirmed', revision: 1, canonicalText: text })).toBe(true);
    },
  );
  it('holds disagreements and incomplete speech without translating or repairing either text', () => {
    expect(candidateStatus('Hola', true, '안녕하세요')).toEqual({
      status: 'needs_confirmation', reason: 'candidate_disagreement',
    });
    expect(candidateStatus('네', false, '네').status).toBe('needs_confirmation');
    expect(recognitionResolved({ id: 'a', status: 'processing', revision: 1, canonicalText: '네' })).toBe(false);
  });
  it('fences revised text and verification states, independent of row order', () => {
    const a = { id: 'a', status: 'confirmed', revision: 1, canonicalText: '네' };
    const b = { id: 'b', status: 'confirmed', revision: 1, canonicalText: '아니요' };
    expect(recognitionRevision([a, b])).toBe(recognitionRevision([b, a]));
    expect(recognitionRevision([a])).not.toBe(recognitionRevision([{ ...a, revision: 2 }]));
    expect(recognitionRevision([a])).not.toBe(recognitionRevision([{ ...a, status: 'processing' }]));
  });
});