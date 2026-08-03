// @vitest-environment happy-dom
/**
 * AffectiveStatePanel — regression tests
 *
 * Guard: confusion, trust, and interest bars must always read from npcEmotions
 * (flat), NOT from npcAffectiveState (layered). These tests use deliberately
 * mismatched values so that any future refactor that re-introduces drift will
 * fail loudly.
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
import type { NpcAffectiveState, NpcEmotions } from '@/hooks/useSimulationState';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Flat emotions — these are the values the bars MUST show */
const flatEmotions: NpcEmotions = {
  anger: 10,
  trust: 55,    // deliberately different from layered trust (80)
  confusion: 42, // deliberately different from layered confusion (90)
  interest: 33,  // deliberately different from layered interest (70)
};

/** Layered affective state — intentionally divergent for trust/confusion/interest */
const layeredAffective: NpcAffectiveState = {
  affective: { intensity: 50, valence: 50 },
  cognitive: {
    confusion: 90, // diverges from flatEmotions.confusion (42)
    load: 60,
  },
  relational: {
    trust: 80,  // diverges from flatEmotions.trust (55)
    rapport: 65,
  },
  motivational: {
    interest: 70, // diverges from flatEmotions.interest (33)
    cooperativeness: 45,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderAndExpand() {
  render(
    <AffectiveStatePanel
      affectiveState={layeredAffective}
      npcEmotions={flatEmotions}
    />,
  );
  // Panel is collapsed by default — click to expand
  const toggle = screen.getByRole('button');
  fireEvent.click(toggle);
}

/**
 * Find all EmotionBar numeric readouts whose label matches the given label text.
 * EmotionBar renders the value as a `<span>` with font-mono class at the end.
 * We locate the label span and walk up to the row div to find the value span.
 */
function getValueForLabel(label: string): number {
  // The label span and value span are siblings inside the same row div.
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
    render(
      <AffectiveStatePanel
        affectiveState={layeredAffective}
        npcEmotions={flatEmotions}
      />,
    );
    expect(screen.getByRole('button')).toBeTruthy();
    // Affective layers content should not be visible yet
    expect(screen.queryByText('Confusion')).toBeNull();
  });

  it('shows affective layer labels after expanding', () => {
    renderAndExpand();
    expect(screen.getByText('Confusion')).toBeTruthy();
    expect(screen.getByText('Trust')).toBeTruthy();
    expect(screen.getByText('Interest')).toBeTruthy();
  });

  it('confusion bar shows flat npcEmotions value, not layered cognitive.confusion', () => {
    renderAndExpand();
    const displayed = getValueForLabel('Confusion');
    expect(displayed).toBe(flatEmotions.confusion); // 42, NOT 90
    expect(displayed).not.toBe(layeredAffective.cognitive.confusion);
  });

  it('trust bar shows flat npcEmotions value, not layered relational.trust', () => {
    renderAndExpand();
    const displayed = getValueForLabel('Trust');
    expect(displayed).toBe(flatEmotions.trust); // 55, NOT 80
    expect(displayed).not.toBe(layeredAffective.relational.trust);
  });

  it('interest bar shows flat npcEmotions value, not layered motivational.interest', () => {
    renderAndExpand();
    const displayed = getValueForLabel('Interest');
    expect(displayed).toBe(flatEmotions.interest); // 33, NOT 70
    expect(displayed).not.toBe(layeredAffective.motivational.interest);
  });

  it('affective-only fields (load, rapport, cooperativeness) still read from layered state', () => {
    renderAndExpand();
    expect(getValueForLabel('Load')).toBe(layeredAffective.cognitive.load);
    expect(getValueForLabel('Rapport')).toBe(layeredAffective.relational.rapport);
    expect(getValueForLabel('Coop.')).toBe(layeredAffective.motivational.cooperativeness);
  });
});
