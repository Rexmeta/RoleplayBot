import { useContext, createContext } from "react";

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'user'; // admin=시스템관리자, operator=운영자, user=일반유저
  profileImage?: string | null; // 프로필 이미지 URL
  tier?: string; // 회원 등급: bronze, silver, gold, platinum, diamond
  assignedCategoryId?: string | null; // 운영자가 담당하는 카테고리 ID
}

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (email: string, password: string, name: string, categoryId?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}