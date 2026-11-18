/** Read-only data for rendering production administration components, never used by the app. */
export const reviewUser = {
  id: "operator-review", name: "예시 운영자", email: "operator@example.test", role: "operator",
  tier: "bronze", isActive: true, assignedCompanyId: "company-review",
  assignedOrganizationId: "organization-review", assignedCategoryId: "category-review",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};
const values: Record<string, unknown> = {
  "/api/system-admin/users": [reviewUser],
  "/api/system-admin/companies": [{ id: "company-review", name: "예시 회사", code: "DEMO" }],
  "/api/admin/organizations-with-hierarchy": [{ id: "organization-review", name: "교육 조직", companyId: "company-review" }],
  "/api/admin/categories": [{ id: "category-review", name: "협업 교육", organizationId: "organization-review" }],
  "/api/categories": [{ id: "category-review", name: "협업 교육" }],
  "/api/system-admin/settings": [
    { id: "conversation", category: "ai", key: "model_conversation", value: "gemini-2.5-flash" },
    { id: "feedback", category: "ai", key: "model_feedback", value: "gemini-2.5-flash" },
  ],
  "/api/languages": [{ id: "ko", code: "ko", name: "한국어", nativeName: "한국어", isActive: true, isDefault: true, displayOrder: 0 }],
};
export const useQuery = ({ queryKey }: { queryKey: unknown[] }) => ({
  data: values[String(queryKey[0])], isLoading: false, isFetching: false, isSuccess: true,
  isError: false, dataUpdatedAt: 1, refetch: async () => ({ data: values[String(queryKey[0])] }),
});
export const useMutation = () => ({
  isPending: false, mutate: () => { throw new Error("Visual fixture: writes are disabled"); },
  mutateAsync: async () => { throw new Error("Visual fixture: writes are disabled"); },
});
export const queryClient = { invalidateQueries: async () => {}, getQueryData: () => undefined };
export const useQueryClient = () => queryClient;
export const apiRequest = async () => { throw new Error("Visual fixture: API access is disabled"); };
export const streamApiRequest = apiRequest;
export const useAuth = () => ({
  user: { id: "admin-review", role: "admin", name: "예시 관리자" }, isLoading: false, isAuthenticated: true,
});
export const useDefaultSourceLocale = () => "ko";
export const toast = () => {};
export const useToast = () => ({ toast });
