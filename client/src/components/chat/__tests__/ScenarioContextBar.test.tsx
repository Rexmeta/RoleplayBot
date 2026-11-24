// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ScenarioContextBar } from '../ScenarioContextBar';

const base: any = {
  id: 's1', title: '예산 협상', context: { situation: '분기 예산 회의', playerRole: { position: '팀장' } },
  objectives: ['합의 도출'],
  _organizationOverride: { directives: ['비공개 지침'] },
};

describe('ScenarioContextBar', () => {
  it('shows scenario context without organization override details', () => {
    render(<ScenarioContextBar scenario={base} />);
    expect(screen.getByTestId('scenario-context-title').textContent).toBe('예산 협상');
    expect(screen.getByText('분기 예산 회의')).toBeTruthy();
    expect(screen.queryByText(/비공개 지침/)).toBeNull();
  });

  it('prefers selected PersonaX scene fields', () => {
    render(<ScenarioContextBar scenario={{ ...base, _userPersonaMode: true, _personaScene: { title: '비 오는 카페', setting: '창가 자리', mood: '잔잔함', openingLine: '오랜만이네', genre: '일상' } }} />);
    expect(screen.getByTestId('scenario-context-title').textContent).toBe('비 오는 카페');
    expect(screen.getByTestId('scenario-context-setting').textContent).toBe('창가 자리');
    expect(screen.getByText('오랜만이네')).toBeTruthy();
    expect(screen.queryByText('합의 도출')).toBeNull();
  });

  it('falls back to scenario situation when no scene', () => {
    render(<ScenarioContextBar scenario={{ ...base, _personaScene: null }} />);
    expect(screen.getByTestId('scenario-context-situation')).toBeTruthy();
  });
});

describe('ScenarioContextBar close notice', () => {
  it('does not claim a live session starts on close when explicit', () => {
    render(<ScenarioContextBar scenario={base} closeNotice="explicit" />);
    expect(screen.getByTestId('scenario-context-notice').textContent).not.toMatch(/닫으면 대화가 시작/);
    expect(screen.getByTestId('scenario-context-notice').textContent).toMatch(/마이크/);
  });
});
