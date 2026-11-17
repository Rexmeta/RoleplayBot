/** Browser-only sample data: no tokens, credentials, provider calls or writes. */
const scenario = {
  id: 'scenario-review', title: '납기 지연 고객사와의 협상',
  description: '납품 일정 변경으로 불만을 가진 고객과 대화하며, 우려를 경청하고 실행 가능한 대안을 함께 정합니다.',
  categoryId: 'negotiation', difficulty: 2, estimatedTime: '약 7분',
  skills: ['적극적 경청', '대안 제시', '협상'], sourceLocale: 'ko', autoTranslate: false,
  targetDurationMinutes: 7, targetTurns: 10, minValidTurns: 4,
  context: {
    situation: '주요 부품 수급 지연으로 납기가 일주일 늦어집니다. 고객은 다음 주 출시를 앞두고 있어 일정 준수가 중요합니다.',
    timeline: '제품 출시 일주일 전', stakes: '고객 신뢰와 장기 공급 계약',
    playerRole: { position: '영업 팀장', department: '영업팀', experience: '관련 업무 5년', responsibility: '지연 원인을 설명하고 조정 가능한 일정을 협의합니다.' },
  },
  objectives: ['상대의 핵심 우려를 확인한다.', '실행 가능한 대안을 제시한다.', '후속 일정과 담당자를 합의한다.'],
  successCriteria: { optimal: '구체적인 일정과 후속 조치까지 합의한다.', good: '고객의 우려를 이해하고 대안을 함께 검토한다.', acceptable: '지연 사유를 명확하게 설명한다.', failure: '책임을 회피하거나 확인되지 않은 일정을 약속한다.' },
  personas: [{
    id: 'estj', name: '김민서', gender: 'female', mbti: 'ESTJ', department: '구매팀',
    position: '구매 팀장', experience: '10년', stance: '출시 일정 준수가 우선이다.',
    goal: '출시에 필요한 최소 물량을 확보한다.', tradeoff: '일부 물량의 분할 납품은 협의할 수 있다.',
    image: '', videos: {}, isPrimary: true, triggerHints: [], entryLine: '일정이 늦어진다는 소식을 들었습니다.',
  }],
  recommendedFlow: ['상황과 우려 확인', '대안 검토', '일정 및 후속 조치 합의'],
  flowGraph: { stages: [
    { id: 'intro', goal: '지연에 대한 고객의 우려를 확인한다.', exitConditions: [{ type: 'turn_count', operator: 'gte', value: 3 }], exitConditionsLogic: 'all', nextStage: 'negotiation' },
    { id: 'negotiation', goal: '분할 납품과 일정 조정안을 함께 검토한다.', exitConditions: [{ type: 'turn_count', operator: 'gte', value: 6 }], exitConditionsLogic: 'all', nextStage: 'resolution' },
    { id: 'resolution', goal: '합의한 일정과 후속 담당자를 확인한다.', exitConditions: [], exitConditionsLogic: 'all', nextStage: '' },
  ] },
};
const empty: unknown[] = [];
const values: Record<string, unknown> = {
  '/api/admin/scenarios': [scenario],
  '/api/admin/categories': [{ id: 'negotiation', name: '협상과 설득', isActive: true }],
  '/api/admin/personas': [{ id: 'estj', name: '김민서', mbti: 'ESTJ' }],
  '/api/admin/scenarios/validate': {},
  '/api/scenarios/stats': empty,
  '/api/evaluation-criteria': [{ id: 'communication', name: '비즈니스 커뮤니케이션', isDefault: true }],
  '/api/languages': [{ code: 'ko', name: 'Korean', nativeName: '한국어', isDefault: true }, { code: 'en', name: 'English', nativeName: 'English' }],
};
export const useQuery = ({ queryKey }: { queryKey: unknown[] }) => ({ data: values[String(queryKey[0])], isLoading: false, refetch: async () => {} });
export const useMutation = () => ({ isPending: false, mutate: () => {}, mutateAsync: async () => { throw new Error('Visual fixture: writes are disabled'); } });
export const useQueryClient = () => queryClient;
export const queryClient = { invalidateQueries: async () => {} };
export const apiRequest = async () => { throw new Error('Visual fixture: backend access is disabled'); };
export const streamApiRequest = apiRequest;
export const useAuth = () => ({ user: { id: 'visual-review-admin', role: 'admin' } });
export const useDefaultSourceLocale = () => 'ko';
export const toast = () => {};
export const useToast = () => ({ toast });
