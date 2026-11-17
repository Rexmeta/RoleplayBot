// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

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
  categories: [{ id: 'sales', name: '영업', isActive: true }],
  validation: {},
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'admin' } }) }));
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
