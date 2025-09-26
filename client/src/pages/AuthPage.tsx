import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { LoginForm } from "@/components/auth/LoginForm";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { useAuth } from "@/hooks/useAuth";

export function AuthPage() {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();

  // 로그인 성공 시 리다이렉트
  useEffect(() => {
    if (isAuthenticated) {
      // 저장된 이전 경로가 있으면 그곳으로, 없으면 홈으로
      const redirectTo = sessionStorage.getItem("redirectAfterAuth") || "/home";
      sessionStorage.removeItem("redirectAfterAuth");
      setLocation(redirectTo);
    }
  }, [isAuthenticated, setLocation]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-app-title">
            AI 역할극 훈련 시스템
          </h1>
          <p className="text-gray-600" data-testid="text-app-description">
            커뮤니케이션 스킬 향상을 위한 전문적인 AI 대화 훈련
          </p>
        </div>

        {isLoginMode ? (
          <LoginForm onSwitchToRegister={() => setIsLoginMode(false)} />
        ) : (
          <RegisterForm onSwitchToLogin={() => setIsLoginMode(true)} />
        )}
      </div>
    </div>
  );
}