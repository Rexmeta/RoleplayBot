// @vitest-environment happy-dom
/**
 * AffectiveStatePanel — regression tests
 *
 * All values are now read directly from npcAffectiveState.
 * The legacy npcEmotions prop has been removed.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
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

function renderAndExpand() {
  render(<AffectiveStatePanel affectiveState={layeredAffective} />);
  // Panel is collapsed by default — click to expand
  const toggle = screen.getByRole('button');
  fireEvent.click(toggle);
}

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
  it('renders a collapsed toggle button by default', () => {
    render(<AffectiveStatePanel affectiveState={layeredAffective} />);
    expect(screen.getByRole('button')).toBeTruthy();
    // Affective layers content should not be visible yet
    expect(screen.queryByText('Confusion')).toBeNull();
  });

  it('shows affective layer labels after expanding', () => {
    renderAndExpand();
    expect(screen.getByText('Intensity')).toBeTruthy();
    expect(screen.getByText('Confusion')).toBeTruthy();
    expect(screen.getByText('Trust')).toBeTruthy();
    expect(screen.getByText('Interest')).toBeTruthy();
  });

  it('intensity bar reads from affective.intensity', () => {
    renderAndExpand();
    expect(getValueForLabel('Intensity')).toBe(layeredAffective.affective.intensity);
  });

  it('confusion bar reads from cognitive.confusion', () => {
    renderAndExpand();
    expect(getValueForLabel('Confusion')).toBe(layeredAffective.cognitive.confusion);
  });

  it('trust bar reads from relational.trust', () => {
    renderAndExpand();
    expect(getValueForLabel('Trust')).toBe(layeredAffective.relational.trust);
  });

  it('interest bar reads from motivational.interest', () => {
    renderAndExpand();
    expect(getValueForLabel('Interest')).toBe(layeredAffective.motivational.interest);
  });

  it('affective-only fields (load, rapport, cooperativeness) read from layered state', () => {
    renderAndExpand();
    expect(getValueForLabel('Load')).toBe(layeredAffective.cognitive.load);
    expect(getValueForLabel('Rapport')).toBe(layeredAffective.relational.rapport);
    expect(getValueForLabel('Coop.')).toBe(layeredAffective.motivational.cooperativeness);
  });
});
