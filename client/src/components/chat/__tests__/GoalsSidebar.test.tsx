// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';

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
  const [desktopSection, setDesktopSection] = useState<'role' | 'goals' | 'npc' | null>('goals');
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
      desktopSection={desktopSection}
      onToggleDesktopSection={setDesktopSection}
    />
  );
}

describe('GoalsSidebar desktop information accordion', () => {
  it('opens achievement goals by default and keeps role and NPC details closed', () => {
    render(<SidebarHarness />);

    expect(screen.getByTestId('desktop-info-section-goals-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('desktop-info-section-role-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('desktop-info-section-npc-toggle').getAttribute('aria-expanded')).toBe('false');
    const goalsContent = screen.getByTestId('desktop-info-section-goals-body').firstElementChild;
    expect(goalsContent?.className).toContain('max-h-64');
    expect(goalsContent?.className).toContain('overflow-y-auto');
    expect(screen.getByText('8 goals')).toBeTruthy();
  });

  it('opens only the requested section and exposes native button controls', () => {
    render(<SidebarHarness />);
    const roleToggle = screen.getByTestId('desktop-info-section-role-toggle');

    expect(roleToggle.tagName).toBe('BUTTON');
    fireEvent.click(roleToggle);

    expect(roleToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('desktop-info-section-goals-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('desktop-info-section-npc-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('desktop-info-section-role-body').getAttribute('id')).toBe('desktop-info-role-body');
    expect(roleToggle.getAttribute('aria-controls')).toBe('desktop-info-role-body');
  });

  it('shows NPC stage, dominant state, and active incident in the collapsed header', () => {
    render(<SidebarHarness hasActiveIncident />);

    expect(screen.getByText('Conflict')).toBeTruthy();
    expect(screen.getByText('Trust')).toBeTruthy();
    expect(screen.getByLabelText('NPC incident needs attention')).toBeTruthy();
  });

  it('opens the NPC detail while closing goals', () => {
    render(<SidebarHarness />);
    fireEvent.click(screen.getByTestId('desktop-info-section-npc-toggle'));

    expect(screen.getByTestId('desktop-info-section-npc-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('desktop-info-section-goals-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('desktop-info-section-npc-body')).toBeTruthy();
    expect(screen.getByTestId('simulation-panel')).toBeTruthy();
  });
});