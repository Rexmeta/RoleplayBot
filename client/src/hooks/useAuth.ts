// Auth hook from javascript_log_in_with_replit blueprint
// 임시로 비활성화하고 기본값 반환
export function useAuth() {
  // const { data: user, isLoading } = useQuery({
  //   queryKey: ["/api/auth/user"],
  //   retry: false,
  // });

  return {
    user: null,
    isLoading: false,
    isAuthenticated: false,
  };
}