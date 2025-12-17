import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { useAuth } from "@/hooks/useAuth";
import Intro from "@/pages/intro";
import Home from "@/pages/home";
import MyPage from "@/pages/MyPage";
import Analytics from "@/pages/Analytics";
import AdminDashboard from "@/pages/admin-dashboard";
import AdminManagement from "@/pages/admin-management";
import AIGeneratorPage from "@/pages/ai-generator";
import SystemAdminPage from "@/pages/system-admin";
import ConversationView from "@/pages/ConversationView";
import FeedbackView from "@/pages/FeedbackView";
import HelpPage from "@/pages/HelpPage";
import NotFound from "@/pages/not-found";
import { AuthPage } from "@/pages/AuthPage";

function ProtectedRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  // 로딩 중일 때 스피너 표시
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">로딩 중...</p>
        </div>
      </div>
    );
  }

  // 인증되지 않은 사용자는 로그인/회원가입 페이지로
  if (!isAuthenticated) {
    return <AuthPage />;
  }

  // 인증된 사용자는 기존 라우트들로
  return (
    <Switch>
      <Route path="/" component={Intro} />
      <Route path="/home" component={Home} />
      <Route path="/mypage" component={MyPage} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/chat/:conversationId" component={ConversationView} />
      <Route path="/feedback/:conversationId" component={FeedbackView} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin-dashboard" component={AdminDashboard} />
      <Route path="/admin-management" component={AdminManagement} />
      <Route path="/ai-generator" component={AIGeneratorPage} />
      <Route path="/system-admin" component={SystemAdminPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  return (
    <AuthProvider>
      <ProtectedRouter />
    </AuthProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Switch>
          {/* 공개 라우트 - 인증 불필요, AuthProvider 바깥에서 즉시 렌더링 */}
          <Route path="/help" component={HelpPage} />
          {/* 보호된 라우트 - 인증 필요 */}
          <Route>
            <AuthenticatedApp />
          </Route>
        </Switch>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
