// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  id: 'editor-fixture', title: '기존 협상 실습', description: '고객사와 공급 일정을 조율합니다.',
  categoryId: 'sales', difficulty: 2, estimatedTime: '7분', skills: ['협상'],
  sourceLocale: 'ko', autoTranslate: false, targetDurationMinutes: 7, targetTurns: 10, minValidTurns: 4,
  context: { situation: '납기가 늦어졌다.', timeline: '이번 주', stakes: '공급 계약', playerRole: { position: '과장', department: '영업', experience: '5년', responsibility: '협의' } },
  objectives: ['일정을 합의한다'], successCriteria: { optimal: '합의', good: '조율', acceptable: '설명', failure: '결렬' },
  personas: [], recommendedFlow: ['상황 확인', '대안 제시'],
  flowGraph: { stages: [{ id: 'intro', goal: '우려 확인', exitConditions: [{ type: 'turn_count', operator: 'gte', value: 3 }], exitConditionsLogic: 'all', nextStage: 'negotiation' }] },
  terminationRules: { timeout: { maxTimeSec: 420 } },
}));
const api = vi.hoisted(() => vi.fn(async () => ({ json: async () => ({ id: 'editor-fixture' }) })));
const queries = vi.hoisted(() => ({
  scenarios: [fixture],
  personas: [] as any[],
  categories: [{ id: 'sales', name: '영업', isActive: true }],
  validation: {},
}));
const authorization = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin', role: authorization.role } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/localeUtils', () => ({ useDefaultSourceLocale: () => 'ko' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
  i18n: { language: 'ko' },
}) }));
vi.mock('@/lib/queryClient', () => ({ apiRequest: api, streamApiRequest: vi.fn(), queryClient: { invalidateQueries: vi.fn(async () => {}) } }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: any) => ({
    data: queryKey[0] === '/api/admin/scenarios' ? queries.scenarios :
      queryKey[0] === '/api/admin/categories' ? queries.categories :
      queryKey[0] === '/api/admin/personas' ? queries.personas :
      queryKey[0] === '/api/admin/scenarios/validate' ? queries.validation : undefined,
    isLoading: false, refetch: vi.fn(),
  }),
  useMutation: (options: any) => ({
    isPending: false,
    mutate: async (value: any) => {
      try { const data = await options.mutationFn(value); await options.onSuccess?.(data); }
      catch (error) { options.onError?.(error); }
    },
  }),
}));
vi.mock('@/components/admin/AIScenarioGenerator', () => ({ AIScenarioGenerator: () => null }));
vi.mock('@/components/admin/ScenarioLiveAvatarPolicy', () => ({ ScenarioLiveAvatarPolicy: () => null }));
vi.mock('@/components/admin/ScenarioCriteriaPreview', () => ({ ScenarioCriteriaPreview: () => null }));
import { ScenarioManager } from '@/components/admin/ScenarioManager';

beforeEach(() => { vi.clearAllMocks(); authorization.role = 'admin'; queries.scenarios = [fixture]; queries.personas = []; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openEditor() {
  render(<ScenarioManager />);
  fireEvent.pointerDown(screen.getByTestId('button-scenario-menu-editor-fixture'), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId('button-edit-scenario-editor-fixture'));
  await screen.findByTestId('input-scenario-title');
}
const navigateSection = (name: string) => fireEvent.click(screen.getAllByRole('button', { name, exact: true })[0]);
const changeField = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

it('shows the referenced template image and live setting in an actor card without copying media into the actor', async () => {
  queries.personas = [{ id: 'template-live', mbti: 'ESTJ', avatarMode: 'live', images: { base: 'personas/live-base.png' } }];
  queries.scenarios = [{ ...fixture, personas: [{
    id: 'stable-actor', personaRef: 'template-live', name: '협상 상대', gender: 'female',
    mbti: 'ESTJ', department: '구매', position: '팀장', experience: '5년', stance: '', goal: '', tradeoff: '',
  }] }] as any;
  await openEditor();
  navigateSection('대화 상대');
  const summary = document.querySelector('#scenario-actor-0 > summary')!;
  expect(summary.textContent).toContain('라이브 아바타 설정');
  expect(summary.querySelector('img')?.getAttribute('src')).toBe('/objects?key=personas%2Flive-base.png');
  fireEvent.click(screen.getByTestId('button-save-scenario'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/api/admin/scenarios/editor-fixture',
    expect.objectContaining({ personas: [expect.objectContaining({ id: 'stable-actor', personaRef: 'template-live' })] })));
  const payload = api.mock.calls.find(call => call[0] === 'PUT')?.[2] as any;
  expect(payload.personas[0].avatarMode).toBeUndefined();
});

it('saves real editor fields and unchanged advanced rules after moving between sections', async () => {
  render(<ScenarioManager />);
  fireEvent.pointerDown(screen.getByTestId('button-scenario-menu-editor-fixture'), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId('button-edit-scenario-editor-fixture'));
  fireEvent.change(await screen.findByTestId('input-scenario-title'), { target: { value: '새로운 협상 실습' } });
  const navigate = (name: string) => fireEvent.click(screen.getAllByRole('button', { name, exact: true })[0]);
  navigate('대화 흐름');
  fireEvent.change(screen.getByLabelText('1단계 목표'), { target: { value: '고객의 우려를 먼저 확인' } });
  navigate('기본 정보');
  expect((screen.getByTestId('input-scenario-title') as HTMLInputElement).value).toBe('새로운 협상 실습');
  fireEvent.click(screen.getByTestId('button-save-scenario'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/api/admin/scenarios/editor-fixture', expect.objectContaining({
    title: '새로운 협상 실습',
    context: fixture.context,
    skills: ['협상'],
    recommendedFlow: fixture.recommendedFlow,
    terminationRules: fixture.terminationRules,
    flowGraph: { stages: [{ ...fixture.flowGraph.stages[0], goal: '고객의 우려를 먼저 확인' }] },
  })));
});

it('keeps all eight sections functional and saves edits from different groups together', async () => {
  await openEditor();
  changeField('input-skills', '협상, 경청');
  navigateSection('상황과 학습자 역할');
  expect(screen.getByTestId('textarea-situation').closest('[hidden]')).toBeNull();
  changeField('textarea-situation', '고객이 납기 변경 사유를 설명해 달라고 요청했다.');
  changeField('input-position', '영업 팀장');
  navigateSection('대화 상대');
  fireEvent.click(screen.getByTestId('add-persona'));
  changeField('input-persona-name-0', '새로운 대화 상대');
  navigateSection('학습 목표와 성공 기준');
  changeField('textarea-optimal', '일정과 후속 조치를 구체적으로 합의한다.');
  navigateSection('대화 상대');
  expect((screen.getByTestId('input-persona-name-0') as HTMLInputElement).value).toBe('새로운 대화 상대');
  fireEvent.click(screen.getByTestId('remove-persona-0'));
  navigateSection('대화 흐름');
  expect(screen.getByLabelText('1단계 목표').closest('[hidden]')).toBeNull();
  navigateSection('평가 방식');
  expect(screen.getByTestId('select-evaluation-criteria').closest('[hidden]')).toBeNull();
  expect(document.getElementById('section-turns')?.closest('[hidden]')).toBeNull();
  navigateSection('이미지·영상');
  changeField('input-scenario-image', '/objects/editor-test-image.png');
  navigateSection('공개 설정');
  expect(document.querySelectorAll('#useVideoAvatar')).toHaveLength(1);
  fireEvent.click(document.getElementById('isPublic')!);
  navigateSection('기본 정보');
  fireEvent.click(screen.getByTestId('button-save-scenario'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/api/admin/scenarios/editor-fixture', expect.objectContaining({
    skills: ['협상', '경청'],
    context: { ...fixture.context, situation: '고객이 납기 변경 사유를 설명해 달라고 요청했다.', playerRole: { ...fixture.context.playerRole, position: '영업 팀장' } },
    successCriteria: { ...fixture.successCriteria, optimal: '일정과 후속 조치를 구체적으로 합의한다.' },
    image: '/objects/editor-test-image.png',
    isPublic: true,
    targetDurationMinutes: fixture.targetDurationMinutes,
    targetTurns: fixture.targetTurns,
    minValidTurns: fixture.minValidTurns,
    flowGraph: fixture.flowGraph,
    terminationRules: fixture.terminationRules,
  })));
});

it('returns to the correct group when a hidden required field is invalid', async () => {
  await openEditor();
  changeField('input-estimated-time', '');
  navigateSection('대화 흐름');
  fireEvent.click(screen.getByTestId('button-save-scenario'));
  await waitFor(() => expect(screen.getByRole('heading', { name: '기본 정보' })).toBeTruthy());
  expect(screen.getByRole('alert').textContent).toBeTruthy();
  expect(api).not.toHaveBeenCalled();
});

it('reveals custom title validation without discarding edits in another section', async () => {
  await openEditor();
  changeField('input-scenario-title', '   ');
  navigateSection('상황과 학습자 역할');
  changeField('input-timeline', '다음 주 월요일');
  fireEvent.click(screen.getByTestId('button-save-scenario'));
  await waitFor(() => expect(screen.getByRole('heading', { name: '기본 정보' })).toBeTruthy());
  navigateSection('상황과 학습자 역할');
  expect((screen.getByTestId('input-timeline') as HTMLInputElement).value).toBe('다음 주 월요일');
  expect(api).not.toHaveBeenCalled();
});

it('does not expose the former duplicate avatar toggle to an operator without access', async () => {
  authorization.role = 'operator';
  await openEditor();
  navigateSection('공개 설정');
  expect(document.querySelectorAll('#useVideoAvatar')).toHaveLength(0);
  expect(document.getElementById('isPublic')).toBeTruthy();
});
