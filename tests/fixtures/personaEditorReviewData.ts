/** Read-only sample persona for rendering real production UI without signing in. */
export const samplePersona = {
  id: 'persona-review', mbti: 'ESTJ', gender: 'female',
  personality_traits: ['체계적', '책임감이 강함', '명확한 의사 표현'],
  communication_style: '사실과 실행 계획을 중심으로 차분하게 설명합니다.',
  motivation: '상호 신뢰를 지키며 실행 가능한 합의를 이루고 싶습니다.',
  fears: ['불명확한 일정', '책임 회피'],
  background: {
    personal_values: ['신뢰', '책임'], hobbies: ['독서', '산책'],
    social: { preference: '목표가 분명한 소규모 협업', behavior: '의견을 듣고 역할을 명확하게 정합니다.' },
  },
  communication_patterns: {
    opening_style: '현재 상황과 우선순위를 먼저 확인합니다.',
    key_phrases: ['확인된 일정인가요?', '다음 단계를 정리해 주세요.'],
    response_to_arguments: { logical: '근거를 확인하고 실행 가능성을 검토합니다.' },
    win_conditions: ['구체적인 일정 합의', '후속 담당자 확인'],
  },
  voice: { tone: '차분하고 명확한 어조', pace: '보통' },
  avatarMode: 'image', liveAvatar: null, liveAvatarSeed: null,
  videos: { enabled: false, clips: { male: {}, female: {} } },
  images: { base: '', style: '자연스러운 인물 사진', male: { expressions: {} }, female: { expressions: {} } },
  freeChatAvailable: false, freeChatDescription: '', storeListed: false,
  storePriceUsd: null, storePackId: null, _translationLocales: [],
};
const values: Record<string, unknown> = {
  '/api/admin/personas': [{
    ...samplePersona,
    ...(typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'video'
      ? { avatarMode: 'video', videos: { ...samplePersona.videos, enabled: true } } : {}),
  }],
  '/api/scenarios': [],
  '/api/settings/video-avatar-access': { operatorEnabled: true },
  '/api/languages': [{ code: 'ko', name: 'Korean', nativeName: '한국어', isDefault: true }],
};
export const useQuery = ({ queryKey }: { queryKey: unknown[] }) => ({
  data: values[String(queryKey[0])], isLoading: false, refetch: async () => {},
});
export const useMutation = () => ({
  isPending: false, mutate: () => { throw new Error('Visual fixture: writes are disabled'); },
  mutateAsync: async () => { throw new Error('Visual fixture: writes are disabled'); },
});
export const queryClient = { invalidateQueries: async () => {} };
export const useQueryClient = () => queryClient;
export const apiRequest = async () => { throw new Error('Visual fixture: backend access is disabled'); };
export const streamApiRequest = apiRequest;
export const useAuth = () => ({ user: { id: 'visual-review-admin', role: 'admin' } });
export const useDefaultSourceLocale = () => 'ko';
export const toast = () => {};
export const useToast = () => ({ toast });
