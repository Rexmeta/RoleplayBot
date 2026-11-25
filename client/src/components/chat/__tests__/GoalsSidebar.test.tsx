// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'chat.yourRole': 'Your role',
        'chat.roleDetails': 'Role details',
        'chat.achievementGoals': 'Goals',
        'chat.npcStatusPanel': 'NPC status',
        'chat.activeIncident': 'NPC incident needs attention',
        'chat.waiting': 'Waiting',
        'chat.goalCount': `${options?.count ?? 0} goals`,
        'common.unknown': 'Unknown',
        'simulation.stages.conflict': 'Conflict',
        'simulation.affectiveState.trust': 'Trust',
      };
      return translations[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('@/components/SimulationPanel', () => ({
  default: () => <div data-testid="simulation-panel">Simulation detail</div>,
  STAGE_COLORS: { conflict: 'bg-yellow-500' },
  EMOTION_COLORS: { trust: 'bg-blue-400' },
}));

import { GoalsSidebar } from '../GoalsSidebar';
import type { ComplexScenario } from '@/lib/scenario-system';
import type { SimulationState } from '@/hooks/useSimulationState';

const scenario: ComplexScenario = {
  id: 'sidebar-test',
  title: 'Sidebar test',
  description: '',
  context: {
    situation: '',
    timeline: '',
    stakes: '',
    playerRole: {
      position: 'Account manager',
      department: 'Sales',
      experience: 'Senior',
      responsibility: 'Recover the customer relationship.',
    },
  },
  objectives: Array.from({ length: 8 }, (_, index) => `Complete objective ${index + 1}`),
  successCriteria: { optimal: '', good: '', acceptable: '', failure: '' },
  personas: [],
  recommendedFlow: [],
  difficulty: 1,
  estimatedTime: '10m',
  skills: [],
};

const simulationState: SimulationState = {
  version: 1,
  stage: 'conflict',
  pressureLevel: 3,
  currentScore: 0,
  summary: { averageScore: 0, totalTurns: 0, totalIncidents: 1, maxAnger: 0, minTrust: 0 },
  timer: { enabled: false, elapsedSec: 0, timeLimitSec: 0, startedAt: null, pausedAt: null },
  recentIncidents: [],
  recentTurnScores: [],
  npcAffectiveState: {
    affective: { intensity: 20, valence: 0 },
    cognitive: { confusion: 10, load: 0 },
    relational: { trust: 70, rapport: 0 },
    motivational: { interest: 30, cooperativeness: 0 },
  },
};

function SidebarHarness({ hasActiveIncident = false }: { hasActiveIncident?: boolean }) {
  return (
    <GoalsSidebar
      scenario={scenario}
      personaName="Taylor"
      personaDept="Support"
      personaRole="Director"
      elapsedTime={0}
      isGoalsExpanded={false}
      onToggleGoals={() => undefined}
      variant="sidebar"
      isSimulationEnabled
      simulationState={simulationState}
      hasActiveIncident={hasActiveIncident}
    />
  );
}

describe('GoalsSidebar desktop information accordion', () => {
  it('shows role and achievement goals without the persona/emotion card', () => {
    render(<SidebarHarness />);

    const getSectionClass = (id: string) =>
      screen.getByTestId(`desktop-info-section-${id}-toggle`).closest('section')?.className;

    expect(getSectionClass('role')).toContain('order-2');
    expect(getSectionClass('goals')).toContain('order-3');
    expect(screen.queryByTestId('desktop-info-section-npc-toggle')).toBeNull();
    expect(screen.queryByTestId('simulation-panel')).toBeNull();
  });

  it('opens cards by default and scrolls the sidebar rather than individual cards', () => {
    render(<SidebarHarness />);

    expect(screen.getByTestId('desktop-info-section-goals-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('desktop-info-section-role-toggle').getAttribute('aria-expanded')).toBe('true');
    const scroll = screen.getByTestId('desktop-info-scroll');
    expect(scroll.className).toContain('overflow-y-auto');
    expect(scroll.className).toContain('min-h-0');
    expect(scroll.className).toContain('overscroll-contain');
    expect(scroll.tabIndex).toBe(0);
    for (const id of ['role', 'goals']) {
      const body = screen.getByTestId(`desktop-info-section-${id}-body`);
      expect(scroll.contains(body)).toBe(true);
      expect(body.closest('section')?.className).toContain('shrink-0');
    }
    expect(screen.getByText('Complete objective 8')).toBeTruthy();
    expect(screen.getByText('8 goals')).toBeTruthy();
  });

  it('allows individual cards to close and reopen without collapsing other cards', () => {
    render(<SidebarHarness />);
    const roleToggle = screen.getByTestId('desktop-info-section-role-toggle');

    fireEvent.click(roleToggle);
    expect(roleToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('desktop-info-section-role-body')).toBeNull();
    expect(screen.getByTestId('desktop-info-section-goals-toggle').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(roleToggle);

    expect(roleToggle.getAttribute('aria-expanded')).toBe('true');
    expect(roleToggle.getAttribute('aria-controls')).toBe('desktop-info-role-body');
  });

  it('opens role and goals without requiring a parent accordion controller in live-avatar mode', () => {
    render(<GoalsSidebar scenario={scenario} personaName="Taylor" elapsedTime={0}
      isGoalsExpanded={false} onToggleGoals={vi.fn()} variant="sidebar" />);
    expect(screen.getByTestId('desktop-info-section-role-body')).toBeTruthy();
    expect(screen.getByTestId('desktop-info-section-goals-body')).toBeTruthy();
    expect(screen.queryByTestId('desktop-info-section-npc-toggle')).toBeNull();
  });

  it('keeps the mobile overlay collapsed until its existing toggle is used', () => {
    const toggle = vi.fn();
    const { rerender } = render(<GoalsSidebar scenario={scenario} personaName="Taylor" elapsedTime={0}
      isGoalsExpanded={false} onToggleGoals={toggle} variant="overlay" />);
    expect(screen.queryByText('Complete objective 8')).toBeNull();
    fireEvent.click(screen.getByTestId('button-toggle-goals'));
    expect(toggle).toHaveBeenCalledOnce();
    rerender(<GoalsSidebar scenario={scenario} personaName="Taylor" elapsedTime={0}
      isGoalsExpanded onToggleGoals={toggle} variant="overlay" />);
    expect(screen.getByText('Complete objective 8')).toBeTruthy();
    expect(screen.queryByTestId('desktop-info-scroll')).toBeNull();
  });
});