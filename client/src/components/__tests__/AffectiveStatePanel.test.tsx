// @vitest-environment happy-dom
/**
 * AffectiveStatePanel — regression tests
 *
 * New compact layout (task 1267):
 *   - Summary metrics (Intensity, Trust, Interest, Cooperativeness) are always visible.
 *   - Detail metrics (Confusion, Load, Rapport, Valence) are hidden behind a toggle button.
 *   - Full label "Cooperativeness" is used (not the old abbreviation "Coop.").
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key.split('.').pop() ?? key,
  }),
}));

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress" data-value={value} />
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => {
  const stub = ({ className }: { className?: string }) => (
    <svg className={className} />
  );
  return {
    AlertTriangle: stub,
    TrendingUp: stub,
    Heart: stub,
    Eye: stub,
    Brain: stub,
    Zap: stub,
    Timer: stub,
    ChevronDown: stub,
    SkipForward: stub,
    CheckCircle2: stub,
    XCircle: stub,
    Clock: stub,
  };
});

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { AffectiveStatePanel } from '../SimulationPanel';
import type { NpcAffectiveState } from '@/hooks/useSimulationState';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const layeredAffective: NpcAffectiveState = {
  affective: { intensity: 50, valence: 20 },
  cognitive: {
    confusion: 42,
    load: 60,
  },
  relational: {
    trust: 55,
    rapport: 65,
  },
  motivational: {
    interest: 33,
    cooperativeness: 45,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find the numeric readout for a given label in an EmotionBar row.
 */
function getValueForLabel(label: string): number {
  const labelEl = screen.getByText(label);
  const row = labelEl.closest('div.flex');
  if (!row) throw new Error(`Row for label "${label}" not found`);
  const valueSpan = row.querySelector('span.font-mono');
  if (!valueSpan) throw new Error(`Value span for label "${label}" not found`);
  return Number(valueSpan.textContent);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AffectiveStatePanel', () => {
  it('shows detail metrics by default without a "자세히 보기" toggle', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    expect(screen.queryByText('자세히 보기')).toBeNull();
    expect(screen.getByText('Confusion')).toBeTruthy();
    expect(screen.getByText('Load')).toBeTruthy();
    expect(screen.getByText('Rapport')).toBeTruthy();
    expect(screen.getByText('Valence')).toBeTruthy();
  });

  it('summary metrics are visible without expanding', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    // These four are always shown in the summary grid
    expect(screen.getByText('Intensity')).toBeTruthy();
    expect(screen.getByText('Trust')).toBeTruthy();
    expect(screen.getByText('Interest')).toBeTruthy();
    expect(screen.getByText('Cooperativeness')).toBeTruthy();
  });

  it('detail metrics remain visible by default', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    expect(screen.getByText('Confusion')).toBeTruthy();
    expect(screen.getByText('Load')).toBeTruthy();
    expect(screen.getByText('Rapport')).toBeTruthy();
    expect(screen.getByText('Valence')).toBeTruthy();
  });

  it('intensity bar reads from affective.intensity', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    expect(getValueForLabel('Intensity')).toBe(layeredAffective.affective.intensity);
  });

  it('trust bar reads from relational.trust', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    expect(getValueForLabel('Trust')).toBe(layeredAffective.relational.trust);
  });

  it('interest bar reads from motivational.interest', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    expect(getValueForLabel('Interest')).toBe(layeredAffective.motivational.interest);
  });

  it('cooperativeness bar reads from motivational.cooperativeness (full label)', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    expect(getValueForLabel('Cooperativeness')).toBe(layeredAffective.motivational.cooperativeness);
  });

  it('detail fields (confusion, load, rapport, valence) read from layered state by default', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    expect(getValueForLabel('Confusion')).toBe(layeredAffective.cognitive.confusion);
    expect(getValueForLabel('Load')).toBe(layeredAffective.cognitive.load);
    expect(getValueForLabel('Rapport')).toBe(layeredAffective.relational.rapport);
    expect(getValueForLabel('Valence')).toBe(layeredAffective.affective.valence);
  });
});
