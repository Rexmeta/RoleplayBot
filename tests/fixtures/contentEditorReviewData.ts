import { newCultureValues } from "../../shared/cultureMap";

export const sampleCriteria = {
  id: "criteria-review", name: "협업 대화 평가", description: "경청과 명확한 의사 표현을 평가합니다.",
  isDefault: false, isActive: true, categoryId: null, status: "draft", version: 1,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", dimensions: [],
};
export const sampleCulture = {
  id: "culture-review", name: "협업 중심 문화 프로필", country: "한국", region: "팀 협업",
  description: "직접 정의한 대화 행동 맥락입니다.", dimensions: newCultureValues(),
  sources: [{ title: "참고 자료", url: "https://example.com/research", locator: "협업", note: "예시 자료" }],
  visibility: "private", ownerId: "visual-review-admin", version: 2,
  createdAt: "2026-01-01", updatedAt: "2026-01-01",
};
export const useQuery = ({ queryKey }: { queryKey: unknown[] }) => {
  const key = String(queryKey[0]);
  const data = key === "/api/admin/culture-profiles" ? [sampleCulture] :
    key === "/api/admin/evaluation-criteria" ? (queryKey.length === 2 ? [sampleCriteria] : queryKey[2] === "ko" ? sampleCriteria : []) : [];
  return { data, isLoading: false, isSuccess: true, isError: false, refetch: async () => ({ data }) };
};
export const useMutation = () => ({
  isPending: false, mutate: () => { throw new Error("Visual fixture: writes are disabled"); },
  mutateAsync: async () => { throw new Error("Visual fixture: writes are disabled"); },
});
export const queryClient = { invalidateQueries: async () => {} };
export const useQueryClient = () => queryClient;
export const apiRequest = async () => { throw new Error("Visual fixture: backend access is disabled"); };
export const streamApiRequest = apiRequest;
export const useAuth = () => ({ user: { id: "visual-review-admin", role: "admin" } });
export const useDefaultSourceLocale = () => "ko";
export const toast = () => {};
export const useToast = () => ({ toast });
