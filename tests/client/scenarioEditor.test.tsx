// @vitest-environment happy-dom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/components/ui/dialog';
import { ScenarioEditor, ScenarioEditorRegion, revealScenarioEditorTarget } from '@/components/admin/scenarioEditor/ScenarioEditor';
import { FlowGraphBuilder } from '@/components/admin/StateMachineBuilders';
import { AutoResizeTextarea, AutoResizeTextareaHeightProvider } from '@/components/ui/auto-resize-textarea';
import { ConversationLengthGroup, recommendedLength } from '@/components/admin/scenarioEditor/ConversationLengthGroup';
import { AiGenerateButton, aiBlockedReason } from '@/components/admin/scenarioEditor/EditorPrimitives';
import type { FlowGraph } from '@shared/schema/scenarios';

const submit = vi.fn();
const close = vi.fn();
function LocalField() {
  const [value, setValue] = useState('기존 목표');
  return <input aria-label="단계별 로컬 상태" value={value} onChange={e => setValue(e.target.value)} />;
}
function Fixture({ pending = false }: { pending?: boolean }) {
  const [title, setTitle] = useState('시나리오');
  return <Dialog open><ScenarioEditor title={title} revision={title} pending={pending} onClose={close} onSubmit={e => { e.preventDefault(); submit(title); }} isNew={false}>
    <ScenarioEditorRegion sections="basic">
      <input id="test-editor-title" aria-label="시나리오 제목" required value={title} onChange={e => setTitle(e.target.value)} />
    </ScenarioEditorRegion>
    <ScenarioEditorRegion sections="flow">
      <LocalField />
      <details><summary>고급 규칙</summary><input id="test-editor-advanced" aria-label="고급 규칙 값" /></details>
    </ScenarioEditorRegion>
  </ScenarioEditor></Dialog>;
}
const navigate = (name: string) => fireEvent.click(screen.getAllByRole('button', { name, exact: true })[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('production scenario editor shell', () => {
  it('preserves mounted builder state across sections and submits the actual form', () => {
    render(<Fixture />);
    navigate('대화 흐름');
    fireEvent.change(screen.getByLabelText('단계별 로컬 상태'), { target: { value: '유지할 목표' } });
    navigate('기본 정보');
    fireEvent.change(screen.getByLabelText('시나리오 제목'), { target: { value: '저장할 제목' } });
    navigate('대화 흐름');
    expect((screen.getByLabelText('단계별 로컬 상태') as HTMLInputElement).value).toBe('유지할 목표');
    fireEvent.click(screen.getByTestId('button-save-scenario'));
    expect(submit).toHaveBeenCalledWith('저장할 제목');
    expect(screen.getByRole('status').textContent).toContain('저장하지 않은');
  });

  it('opens the section and disclosure containing a validation or quality target', () => {
    render(<Fixture />);
    act(() => revealScenarioEditorTarget('test-editor-advanced'));
    expect(screen.getByRole('heading', { name: '대화 흐름' })).toBeTruthy();
    expect(screen.getByLabelText('고급 규칙 값').closest('details')?.open).toBe(true);
    fireEvent.invalid(screen.getByLabelText('시나리오 제목'));
    expect(screen.getByRole('heading', { name: '기본 정보' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBeTruthy();
  });

  it('confirms before discarding edits but does not invent a successful save', () => {
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText('시나리오 제목'), { target: { value: '미저장 변경' } });
    fireEvent.click(screen.getByRole('button', { name: '편집 닫기' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '저장하지 않고 닫기' }));
    expect(close).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it('prevents close and duplicate submission while saving', () => {
    render(<Fixture pending />);
    expect((screen.getByTestId('button-save-scenario') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '편집 닫기' }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(close).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

const original: FlowGraph = { stages: [
  { id: 'intro', goal: '우려를 확인한다', exitConditions: [{ type: 'turn_count', operator: 'gte', value: 3 }], exitConditionsLogic: 'all', nextStage: 'negotiation' },
  { id: 'negotiation', goal: '대안을 합의한다', exitConditions: [{ type: 'turn_score', metric: 'clarity', operator: 'gt', value: 70, windowTurns: 2 }], exitConditionsLogic: 'any', nextStage: 'resolution' },
] };
describe('focused scenario workflow', () => {
  it('edits one stage at a time and retains other rules and graph references', () => {
    const onChange = vi.fn();
    render(<FlowGraphBuilder defaultValue={original} focused onChange={onChange} />);
    const stageNavigation = screen.getByRole('navigation', { name: '대화 단계' });
    fireEvent.change(screen.getByLabelText('1단계 목표'), { target: { value: '수정한 우려 확인' } });
    fireEvent.click(within(stageNavigation).getByRole('button', { name: /대안을 합의한다/ }));
    expect((screen.getByLabelText('2단계 목표') as HTMLTextAreaElement).value).toBe('대안을 합의한다');
    fireEvent.click(screen.getByRole('button', { name: '2단계 앞으로 이동' }));
    const graph = onChange.mock.lastCall![0] as FlowGraph;
    expect(graph.stages.map(s => s.id)).toEqual(['negotiation', 'intro']);
    expect(graph.stages[1].goal).toBe('수정한 우려 확인');
    expect(graph.stages[1].nextStage).toBe('negotiation');
    expect(graph.stages[0].exitConditions).toEqual(original.stages[1].exitConditions);
    expect(graph.stages[0].exitConditionsLogic).toBe('any');
  });

  it('can add and remove a stage without changing the existing payload', () => {
    const onChange = vi.fn();
    render(<FlowGraphBuilder defaultValue={original} focused onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '단계 추가', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '3단계 삭제' }));
    expect(onChange.mock.lastCall![0]).toEqual(original);
  });
});

describe('editor textarea scroll ownership', () => {
  it('keeps the default cap elsewhere but grows without inner scrolling inside the editor', () => {
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200);
    render(<><AutoResizeTextarea aria-label="일반 입력" value="긴 내용" readOnly />
      <AutoResizeTextareaHeightProvider value={Infinity}><AutoResizeTextarea aria-label="편집기 입력" value="긴 내용" readOnly /></AutoResizeTextareaHeightProvider></>);
    expect(screen.getByLabelText('일반 입력').style.height).toBe('400px');
    expect(screen.getByLabelText('일반 입력').style.overflowY).toBe('auto');
    expect(screen.getByLabelText('편집기 입력').style.height).toBe('1200px');
    expect(screen.getByLabelText('편집기 입력').style.overflowY).toBe('hidden');
    height.mockRestore();
  });
});

describe('organized section controls', () => {
  it.each([
    [1, 5, 8, 6, 8, 3], [2, 7, 10, 8, 12, 4],
    [3, 10, 15, 12, 16, 5], [4, 12, 20, 14, 20, 6],
  ])('retains recommended conversation limits for difficulty %s', (level, durationMin, durationMax, turnsMin, turnsMax, minValid) => {
    expect(recommendedLength(level)).toEqual({ durationMin, durationMax, turnsMin, turnsMax, minValid });
  });

  it('retains numeric limits and defaults in the extracted conversation-length controls', () => {
    const onChange = vi.fn();
    render(<ConversationLengthGroup difficulty={2} targetTurns={10} onChange={onChange} />);
    const duration = screen.getByRole('spinbutton', { name: '목표 시간' });
    fireEvent.change(duration, { target: { value: '80' } });
    expect(onChange).toHaveBeenLastCalledWith({ targetDurationMinutes: 60 });
    fireEvent.change(duration, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ targetDurationMinutes: 7 });
    fireEvent.change(screen.getByRole('spinbutton', { name: '목표 턴 수' }), { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith({ targetTurns: 2 });
    fireEvent.change(screen.getByRole('spinbutton', { name: /최소 유효 턴/ }), { target: { value: '20' } });
    expect(onChange).toHaveBeenLastCalledWith({ minValidTurns: 10 });
  });

  it('explains unavailable AI generation without allowing the action', async () => {
    const generate = vi.fn();
    const reason = aiBlockedReason({ needsContext: true });
    render(<AiGenerateButton loading={false} disabled blockedReason={reason} onClick={generate} />);
    const button = screen.getByRole('button', { name: 'AI 초안' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(generate).not.toHaveBeenCalled();
    const wrapper = button.parentElement!;
    expect(wrapper.tabIndex).toBe(0);
    fireEvent.focus(wrapper);
    expect((await screen.findByRole('tooltip')).textContent).toBe(reason);
  });
});
