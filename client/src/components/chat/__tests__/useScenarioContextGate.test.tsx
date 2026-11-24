// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useScenarioContextGate } from '../useScenarioContextGate';

describe('useScenarioContextGate', () => {
  it('starts open and blocked', () => {
    const { result } = renderHook(() => useScenarioContextGate(vi.fn()));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.hasDismissed).toBe(false);
  });

  it('first close releases exactly once; reopen/close does not restart', () => {
    const release = vi.fn();
    const { result } = renderHook(() => useScenarioContextGate(release));
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.hasDismissed).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.close());
    act(() => result.current.open());
    act(() => result.current.toggle());
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('invokes release synchronously within the close call (user gesture)', () => {
    let called = false;
    const { result } = renderHook(() => useScenarioContextGate(() => { called = true; }));
    act(() => { result.current.close(); expect(called).toBe(true); });
  });
});

describe('ChatWindow orchestration wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../ChatWindow.tsx'), 'utf8');
  it('gates voice start on first dismissal and releases + connects once', () => {
    expect(src).toMatch(/startBlocked:\s*!hasDismissedContext/);
    expect(src).toMatch(/useScenarioContextGate\(\(\) => releaseVoiceStartRef\.current\?\.\(\)\)/);
    expect(src).toMatch(/realtimeVoice\.releaseStartGate\(\);[\s\S]{0,400}realtimeVoice\.connect\(/);
  });
  it('shows scenario in the top bar and never renders org override summary', () => {
    expect(src).toMatch(/<TopMenuPanel isOpen=\{isTopMenuOpen\} onToggle=\{toggleTopMenu\} onClose=\{closeTopMenu\}>\s*<ScenarioContextBar scenario=\{scenario\} \/>/);
    expect(src).not.toMatch(/ScenarioOverrideSummary/);
    expect(src).not.toMatch(/variant="overlay"/);
  });
});
