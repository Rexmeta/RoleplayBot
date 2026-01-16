import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthContext } from "@/hooks/useAuth";
import type { User, AuthContextType } from "@/hooks/useAuth";
import i18n from "@/lib/i18n";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  // 페이지 로드 시 사용자 정보 확인 (localStorage 토큰 또는 httpOnly 쿠키 모두 지원)
  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
    queryFn: async () => {
      const token = localStorage.getItem("authToken");
      
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      // localStorage 토큰이 있으면 Authorization 헤더에 추가
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/auth/user", {
        headers,
        credentials: "include", // httpOnly 쿠키를 포함하여 요청
      });
      
      if (!response.ok) {
        // 토큰이 유효하지 않으면 localStorage에서 제거
        if (token) {
          localStorage.removeItem("authToken");
        }
        return null;
      }
      
      return response.json();
    },
  });

  // 로그인 mutation
  const loginMutation = useMutation({
    mutationFn: async ({ email, password, rememberMe }: { 
      email: string; 
      password: string; 
      rememberMe?: boolean;
    }) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, rememberMe }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "로그인에 실패했습니다");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setUser(data.user);
      if (data.token) {
        localStorage.setItem("authToken", data.token);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  // 회원가입 mutation
  const registerMutation = useMutation({
    mutationFn: async ({ email, password, name, categoryId, preferredLanguage }: {
      email: string;
      password: string;
      name: string;
      categoryId?: string;
      preferredLanguage?: string;
    }) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, name, categoryId, preferredLanguage }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "회원가입에 실패했습니다");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setUser(data.user);
      if (data.token) {
        localStorage.setItem("authToken", data.token);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  // 로그아웃 mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("authToken")}`,
        },
      });
      
      if (!response.ok) {
        throw new Error("로그아웃에 실패했습니다");
      }
      
      return response.json();
    },
    onSuccess: () => {
      setUser(null);
      localStorage.removeItem("authToken");
      queryClient.clear();
    },
  });

  // 현재 사용자 정보 업데이트 및 언어 동기화
  useEffect(() => {
    if (currentUser) {
      setUser(currentUser);
      
      // 서버의 언어 설정을 i18n에 동기화 (서버가 source of truth)
      // currentUser가 변경될 때마다 언어 설정 확인 및 동기화
      if (currentUser.preferredLanguage && currentUser.preferredLanguage !== i18n.language) {
        i18n.changeLanguage(currentUser.preferredLanguage);
        localStorage.setItem('preferredLanguage', currentUser.preferredLanguage);
      }
    } else if (!isUserLoading) {
      setUser(null);
    }
  }, [currentUser, isUserLoading]);

  const login = async (email: string, password: string, rememberMe?: boolean) => {
    await loginMutation.mutateAsync({ email, password, rememberMe });
  };

  const register = async (email: string, password: string, name: string, categoryId?: string, preferredLanguage?: string) => {
    await registerMutation.mutateAsync({ email, password, name, categoryId, preferredLanguage });
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
  };

  const contextValue: AuthContextType = {
    user,
    isLoading: isUserLoading, // 초기 사용자 로딩만 포함, mutation pending은 제외
    isAuthenticated: !!user,
    login,
    register,
    logout,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}