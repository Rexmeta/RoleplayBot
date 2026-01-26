import { useContext, createContext } from "react";

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'user'; // admin=시스템관리자, operator=운영자, user=일반유저
  profileImage?: string | null; // 프로필 이미지 URL
  tier?: string; // 회원 등급: bronze, silver, gold, platinum, diamond
  assignedCategoryId?: string | null; // 운영자가 담당하는 카테고리 ID
  preferredLanguage?: string; // 선호 언어: ko, en, ja, zh
  isGuest?: boolean; // 게스트 계정 여부 (guest@mothle.com)
  hasCompletedDemo?: boolean; // 게스트가 데모 시나리오를 완료했는지 여부
}

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (email: string, password: string, name: string, categoryId?: string, companyId?: string, organizationId?: string, preferredLanguage?: string) => Promise<void>;
  logout: () => Promise<void>;
  guestLogin: () => Promise<{ success: boolean; demoCompleted?: boolean; message?: string }>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}