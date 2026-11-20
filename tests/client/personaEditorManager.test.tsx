// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { samplePersona } from '../fixtures/personaEditorReviewData';

const controls = vi.hoisted(() => ({ role: 'admin', videoAllowed: false, pending: false, failSave: false, mode: 'image' }));
const api = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ json: async () => ({}) })));
const saveMocks = vi.hoisted(() => ({ invalidateQueries: vi.fn(async () => {}) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'editor-admin', role: controls.role } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: api, queryClient: saveMocks }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === '/api/admin/personas' ? [{ ...samplePersona, avatarMode: controls.mode }] :
      queryKey[0] === '/api/settings/video-avatar-access' ? { operatorEnabled: controls.videoAllowed } : [],
    isLoading: false, refetch: vi.fn(),
  }),
  useMutation: (options: any) => ({
    isPending: controls.pending,
    mutate: async (value: unknown) => {
      try {
        if (controls.failSave) throw new Error('Save failed');
        const result = await options.mutationFn(value);
        await options.onSuccess?.(result);
      } catch (error) { options.onError?.(error); }
    },
  }),
}));
vi.mock('@/components/admin/PersonaAvatarSettings', () => ({
  PersonaAvatarSettings: ({ mode, videoManagementAllowed }: any) =>
    <div data-testid="avatar-settings-contract" data-mode={mode} data-video-allowed={String(videoManagementAllowed)}>
      <input aria-label="아바타 패널 내부 상태" defaultValue="유지할 설정" />
    </div>,
}));
vi.mock('@/components/admin/PersonaTranslationEditor', () => ({ PersonaTranslationEditor: () => null }));
import { PersonaManager } from '@/components/admin/PersonaManager';

beforeEach(() => {
  vi.clearAllMocks();
  controls.role = 'admin'; controls.videoAllowed = false; controls.pending = false; controls.failSave = false; controls.mode = 'image';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openEditor() {
  render(<PersonaManager />);
  fireEvent.pointerDown(screen.getByTestId('button-persona-menu-persona-review'), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId('button-edit-persona-persona-review'));
  await screen.findByTestId('input-persona-id');
}
function navigate(index: number) {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.scenario-editor-nav button');
  expect(buttons.length).toBeGreaterThan(index);
  fireEvent.click(buttons[index]);
}
function change(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

it('keeps edits across every section and saves the real update payload including unblurred array inputs', async () => {
  await openEditor();
  navigate(1);
  change('textarea-personality-traits', '체계적, 경청, 새로운 특성');
  change('input-motivation', '양쪽이 실행할 수 있는 해결책을 찾는다.');
  navigate(2);
  change('input-personal-values', '신뢰, 공정성');
  navigate(3);
  change('textarea-key-phrases', '다시 확인하겠습니다, 대안을 검토합시다');
  const count = document.querySelectorAll('.scenario-editor-nav button').length;
  for (let index = 0; index < count; index++) navigate(index);
  expect((screen.getByTestId('textarea-personality-traits') as HTMLTextAreaElement).value).toContain('새로운 특성');
  fireEvent.click(screen.getByTestId('button-save-persona'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/api/admin/personas/persona-review', expect.objectContaining({
    id: 'persona-review', mbti: 'ESTJ', personality_traits: ['체계적', '경청', '새로운 특성'],
    motivation: '양쪽이 실행할 수 있는 해결책을 찾는다.',
    background: expect.objectContaining({ personal_values: ['신뢰', '공정성'] }),
    communication_patterns: expect.objectContaining({ key_phrases: ['다시 확인하겠습니다', '대안을 검토합시다'] }),
    avatarMode: 'image',
  })));
});

it('preserves mounted avatar-panel state across section navigation', async () => {
  await openEditor();
  fireEvent.change(screen.getByLabelText('아바타 패널 내부 상태'), { target: { value: '편집한 아바타 설정' } });
  navigate(0);
  navigate(document.querySelectorAll('.scenario-editor-nav button').length - 1);
  expect((screen.getByLabelText('아바타 패널 내부 상태') as HTMLInputElement).value).toBe('편집한 아바타 설정');
});

it('asks before discarding unblurred edits and can resume editing', async () => {
  await openEditor();
  change('textarea-key-phrases', '저장하지 않은 입력');
  fireEvent.click(screen.getByRole('button', { name: '편집 닫기' }));
  expect(await screen.findByRole('alertdialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '계속 편집' }));
  expect((screen.getByTestId('textarea-key-phrases') as HTMLTextAreaElement).value).toBe('저장하지 않은 입력');
});

it('reveals the section containing an invalid required field', async () => {
  await openEditor();
  navigate(document.querySelectorAll('.scenario-editor-nav button').length - 1);
  const field = screen.getByTestId('input-mbti');
  fireEvent.invalid(field);
  expect(field.closest('[hidden]')).toBeNull();
});

it('does not grant operator video management through the new layout', async () => {
  controls.role = 'operator';
  await openEditor();
  expect(screen.getByTestId('avatar-settings-contract').dataset.videoAllowed).toBe('false');
});

it('labels a saved live mode without an avatar as unassigned in the persona list', () => {
  controls.mode = 'live';
  render(<PersonaManager />);
  expect(screen.getByText('라이브 아바타 미연결')).toBeTruthy();
  expect(screen.queryByText('라이브 아바타 지정됨')).toBeNull();
});

it('creates a persona using the same editor shell and the existing create endpoint', async () => {
  render(<PersonaManager />);
  fireEvent.click(screen.getByTestId('button-create-persona'));
  change('input-persona-id', 'newpersona');
  change('input-mbti', 'ENFP');
  change('textarea-personality-traits', '활발함, 공감');
  fireEvent.click(screen.getByTestId('button-save-persona'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/api/admin/personas',
    expect.objectContaining({ id: 'newpersona', mbti: 'ENFP', personality_traits: ['활발함', '공감'] })));
});

it('keeps the editor open with its edits after a failed save', async () => {
  controls.failSave = true;
  await openEditor();
  change('input-motivation', '실패해도 보존할 변경 내용');
  fireEvent.click(screen.getByTestId('button-save-persona'));
  await waitFor(() => expect(screen.getByTestId('input-motivation')).toBeTruthy());
  expect((screen.getByTestId('input-motivation') as HTMLTextAreaElement).value).toBe('실패해도 보존할 변경 내용');
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('disables saving and closing while a save is pending', async () => {
  controls.pending = true;
  await openEditor();
  expect((screen.getByTestId('button-save-persona') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '편집 닫기' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId('button-save-persona'));
  expect(api).not.toHaveBeenCalled();
});

it('closes an unchanged editor without a discard warning and reopens on the first section', async () => {
  await openEditor();
  navigate(3);
  fireEvent.click(screen.getByRole('button', { name: '편집 닫기' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByTestId('persona-editor')).toBeNull();
  fireEvent.pointerDown(screen.getByTestId('button-persona-menu-persona-review'), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId('button-edit-persona-persona-review'));
  expect(screen.getByRole('heading', { name: '기본 정보' })).toBeTruthy();
});

it('keeps real video clip controls available to permitted users in video mode', async () => {
  controls.mode = 'video';
  await openEditor();
  navigate(7);
  expect(screen.queryByTestId('persona-video-inactive')).toBeNull();
  expect(screen.queryByTestId('persona-video-unavailable')).toBeNull();
  expect(screen.getByLabelText('Avatar ID')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '여성 (Female)' }));
  expect(screen.getAllByText('Veo 생성').length).toBe(6);
  expect(api).not.toHaveBeenCalled();
});
