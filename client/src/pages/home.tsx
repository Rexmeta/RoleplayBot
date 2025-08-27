import { useState } from "react";
import { Link } from "wouter";
import ScenarioSelector from "@/components/ScenarioSelector";
import ChatWindow from "@/components/ChatWindow";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import type { Scenario } from "@/lib/scenarios";

type ViewState = "scenarios" | "chat" | "feedback";

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewState>("scenarios");
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const handleScenarioSelect = (scenario: Scenario, convId: string) => {
    setSelectedScenario(scenario);
    setConversationId(convId);
    setCurrentView("chat");
  };

  const handleChatComplete = () => {
    setCurrentView("feedback");
  };

  const handleReturnToScenarios = () => {
    setCurrentView("scenarios");
    setSelectedScenario(null);
    setConversationId(null);
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-3 hover:opacity-80 transition-opacity" data-testid="home-link">
              <div className="w-10 h-10 bg-corporate-600 rounded-lg flex items-center justify-center">
                <i className="fas fa-robot text-white text-lg"></i>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">RolePlayX</h1>
                <p className="text-sm text-slate-600">Powered by Experience</p>
              </div>
            </Link>
            <div className="flex items-center space-x-4">
              <a 
                href="/admin" 
                className="hidden md:flex items-center px-3 py-2 text-sm text-corporate-600 hover:text-corporate-700 hover:bg-corporate-50 rounded-lg transition-colors"
                data-testid="admin-dashboard-link"
              >
                <i className="fas fa-chart-bar mr-2"></i>
                관리자 대시보드
              </a>
              <div className="hidden md:flex items-center text-sm text-slate-600">
                <i className="fas fa-user-circle mr-2"></i>
                <span>김신입 사원</span>
              </div>
              <button className="text-slate-400 hover:text-slate-600">
                <i className="fas fa-cog"></i>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {currentView === "scenarios" && (
          <ScenarioSelector onScenarioSelect={handleScenarioSelect} />
        )}
        
        {currentView === "chat" && selectedScenario && conversationId && (
          <ChatWindow
            scenario={selectedScenario}
            conversationId={conversationId}
            onChatComplete={handleChatComplete}
            onExit={handleReturnToScenarios}
          />
        )}
        
        {currentView === "feedback" && selectedScenario && conversationId && (
          <PersonalDevelopmentReport
            scenario={selectedScenario}
            conversationId={conversationId}
            onRetry={() => handleScenarioSelect(selectedScenario, "")}
            onSelectNewScenario={handleReturnToScenarios}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="text-sm text-slate-600 mb-4 md:mb-0">
              © AI 롤플레잉 훈련 시스템
            </div>
            <div className="flex items-center space-x-6 text-sm text-slate-600">
              <a href="#" className="hover:text-corporate-600">도움말</a>
              <a href="#" className="hover:text-corporate-600">문의하기</a>
              <a href="#" className="hover:text-corporate-600">개인정보처리방침</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
