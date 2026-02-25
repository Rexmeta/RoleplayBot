import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { Filter, ExternalLink, Download } from "lucide-react";
import { Link } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import { TranslationDashboard } from "@/components/admin/TranslationDashboard";

// 마우스 오버 카드 설명 헬퍼
const CardInfo = ({ title, description }: { title: string; description: string }) => (
  <div className="flex items-center gap-1 cursor-help" title={description}>
    <span>{title}</span>
    <i className="fas fa-info-circle text-slate-400 text-xs hover:text-slate-600" title={description}></i>
  </div>
);

interface AnalyticsOverview {
  totalSessions: number;
  completedSessions: number;
  averageScore: number;
  completionRate: number;
  totalUsers: number;
  activeUsers: number;
  participationRate: number;
  scenarioStats: Record<string, { count: number; name: string; difficulty: number }>;
  mbtiUsage: Record<string, number>;
  totalScenarios: number;
  // 확장 지표
  dau: number;
  wau: number;
  mau: number;
  sessionsPerUser: number;
  newUsers: number;
  returningUsers: number;
  returningRate: number;
  scenarioAverages: Array<{ id: string; name: string; averageScore: number; sessionCount: number }>;
  mbtiAverages: Array<{ mbti: string; averageScore: number; sessionCount: number }>;
  topActiveUsers: Array<{ userId: string; sessionCount: number }>;
  topScenarios: Array<{ id: string; name: string; count: number; difficulty: number }>;
  hardestScenarios: Array<{ id: string; name: string; averageScore: number; sessionCount: number }>;
  difficultyUsage: Array<{ level: number; count: number }>;
  lastContentUpdate: string | null;
}

interface PerformanceData {
  scoreRanges: {
    excellent: number;
    good: number;
    average: number;
    needsImprovement: number;
    poor: number;
  };
  categoryPerformance: Record<string, {
    total: number;
    count: number;
    name: string;
    average: number;
  }>;
  scenarioPerformance: Record<string, {
    scores: number[];
    name: string;
    average: number;
    sessionCount: number;
    difficulty: number;
    personaCount: number;
  }>;
  mbtiPerformance: Record<string, { scores: number[]; count: number; average: number }>;
  topStrengths: Array<{ text: string; count: number }>;
  topImprovements: Array<{ text: string; count: number }>;
  highestScore: number;
  averageScore: number;
  feedbackCompletionRate: number;
  totalFeedbacks: number;
  recentSessions: Array<{
    id: number;
    score: number;
    scenarioName: string;
    mbti: string;
    userId: string;
    completedAt: string;
    difficulty: number;
  }>;
}

interface TrendsData {
  dailyUsage: Array<{
    date: string;
    sessions: number;
    completed: number;
  }>;
  performanceTrends: Array<{
    session: number;
    score: number;
    date: string;
  }>;
}

interface EmotionData {
  emotions: Array<{
    emotion: string;
    emoji: string;
    count: number;
    percentage: number;
  }>;
  totalEmotions: number;
  uniqueEmotions: number;
}

interface ScenarioEmotionData {
  scenarios: Array<{
    scenarioId: string;
    scenarioName: string;
    emotions: Array<{ emotion: string; emoji: string; count: number; percentage: number }>;
    totalCount: number;
    topEmotion: { emotion: string; emoji: string; count: number } | null;
  }>;
}

interface DifficultyEmotionData {
  difficultyStats: Array<{
    difficulty: number;
    difficultyName: string;
    emotions: Array<{ emotion: string; emoji: string; count: number; percentage: number }>;
    totalCount: number;
    topEmotion: { emotion: string; emoji: string; count: number } | null;
  }>;
}

interface Category {
  id: string;
  name: string;
}

interface Participant {
  userId: string;
  name: string;
  email: string;
  role: string;
  tier: string;
  totalSessions: number;
  completedSessions: number;
  averageScore: number | null;
  latestScore: number | null;
  lastTrainingAt: string | null;
  categories: string[];
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [showMobileTabMenu, setShowMobileTabMenu] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantDateFrom, setParticipantDateFrom] = useState('');
  const [participantDateTo, setParticipantDateTo] = useState('');
  const [participantSortKey, setParticipantSortKey] = useState<keyof Participant>('lastTrainingAt');
  const [participantSortAsc, setParticipantSortAsc] = useState(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  const scoreLabels: Record<string, string> = {
    clarityLogic: '논리적 명확성',
    listeningEmpathy: '경청과 공감',
    appropriatenessAdaptability: '적절성과 유연성',
    persuasivenessImpact: '설득력과 영향력',
    strategicCommunication: '전략적 소통',
    strategicSelection: '전략적 선택',
  };

  const handleBulkDownload = async () => {
    if (selectedParticipantIds.size === 0) return;
    setIsBulkDownloading(true);
    try {
      const token = localStorage.getItem('authToken');
      const resp = await fetch('/api/admin/bulk-feedback-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ userIds: Array.from(selectedParticipantIds) }),
      });
      if (!resp.ok) throw new Error('서버 오류');
      const { results } = await resp.json();
      if (!results || results.length === 0) {
        toast({ title: '다운로드 불가', description: '완료된 피드백 리포트가 없습니다.', variant: 'destructive' });
        return;
      }

      const now = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');
      const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>피드백 리포트 — ${now}</title>
<style>
  body { font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; background: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
  h1 { font-size: 22px; color: #1e3a5f; border-bottom: 3px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 6px; }
  .meta { font-size: 12px; color: #64748b; margin-bottom: 32px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 32px; page-break-inside: avoid; }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .user-name { font-size: 20px; font-weight: 700; color: #1e3a5f; }
  .user-email { font-size: 13px; color: #64748b; margin-top: 2px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 600; background: #e0f2fe; color: #0369a1; }
  .score-big { font-size: 40px; font-weight: 800; color: #1e3a5f; }
  .score-label { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  .section-title { font-size: 14px; font-weight: 700; color: #475569; margin: 20px 0 10px; border-left: 3px solid #3b82f6; padding-left: 8px; }
  .score-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .score-item { background: #f8fafc; border-radius: 8px; padding: 12px; }
  .score-item-label { font-size: 12px; color: #64748b; }
  .score-item-value { font-size: 20px; font-weight: 700; color: #1e3a5f; margin-top: 4px; }
  .score-bar { height: 6px; border-radius: 3px; background: #e2e8f0; margin-top: 6px; overflow: hidden; }
  .score-bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #3b82f6, #6366f1); }
  .list-section { margin-top: 8px; }
  .list-item { display: flex; gap: 8px; margin-bottom: 6px; font-size: 13px; line-height: 1.5; }
  .list-icon { flex-shrink: 0; font-size: 14px; }
  .summary-box { background: #f0f9ff; border-radius: 8px; padding: 14px; font-size: 13px; line-height: 1.7; color: #334155; border-left: 4px solid #3b82f6; }
  .info-row { display: flex; gap: 16px; font-size: 12px; color: #64748b; margin-bottom: 16px; flex-wrap: wrap; }
  .info-item span { font-weight: 600; color: #334155; }
  @media print { body { background: white; padding: 0; } .card { page-break-after: always; box-shadow: none; } }
</style>
</head>
<body>
<h1>피드백 리포트</h1>
<div class="meta">생성일: ${now} &nbsp;|&nbsp; 총 ${results.length}명</div>
${results.map((r: any) => {
  const df = r.detailedFeedback || {};
  const scoreEntries = r.scores || [];
  return `
<div class="card">
  <div class="card-header">
    <div>
      <div class="user-name">${r.user.name}</div>
      <div class="user-email">${r.user.email}</div>
    </div>
    <div style="text-align:right">
      <div class="score-big">${r.overallScore}<span style="font-size:20px;color:#94a3b8">점</span></div>
      <div class="score-label">종합 점수</div>
    </div>
  </div>
  <div class="info-row">
    <div class="info-item">시나리오: <span>${r.scenarioTitle}</span></div>
    <div class="info-item">페르소나: <span>${r.personaName}</span></div>
    <div class="info-item">완료일: <span>${r.completedAt ? new Date(r.completedAt).toLocaleDateString('ko-KR') : '-'}</span></div>
  </div>
  ${df.summary ? `<div class="summary-box">${df.summary}</div>` : ''}
  <div class="section-title">세부 평가 점수</div>
  <div class="score-grid">
    ${scoreEntries.map((s: any) => {
      const label = scoreLabels[s.criterionKey || s.key] || s.criterionName || s.criterionKey || s.key || '';
      const val = s.score ?? 0;
      const max = s.maxScore ?? 5;
      const pct = Math.round((val / max) * 100);
      return `<div class="score-item">
        <div class="score-item-label">${label}</div>
        <div class="score-item-value">${val}<span style="font-size:12px;color:#94a3b8">/${max}</span></div>
        <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('')}
  </div>
  ${df.strengths && df.strengths.length > 0 ? `
  <div class="section-title">강점</div>
  <div class="list-section">
    ${df.strengths.map((s: string) => `<div class="list-item"><span class="list-icon">✅</span><span>${s}</span></div>`).join('')}
  </div>` : ''}
  ${df.improvements && df.improvements.length > 0 ? `
  <div class="section-title">개선 필요 사항</div>
  <div class="list-section">
    ${df.improvements.map((s: string) => `<div class="list-item"><span class="list-icon">📌</span><span>${s}</span></div>`).join('')}
  </div>` : ''}
  ${df.nextSteps && df.nextSteps.length > 0 ? `
  <div class="section-title">다음 단계</div>
  <div class="list-section">
    ${df.nextSteps.map((s: string) => `<div class="list-item"><span class="list-icon">▶</span><span>${s}</span></div>`).join('')}
  </div>` : ''}
</div>`;
}).join('')}
</body>
</html>`;

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `피드백리포트_${now}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: '다운로드 완료', description: `${results.length}명의 피드백 리포트가 다운로드되었습니다.` });
    } catch (err) {
      console.error(err);
      toast({ title: '다운로드 실패', description: '피드백 리포트를 가져오는 중 오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setIsBulkDownloading(false);
    }
  };

  // 카테고리 목록 가져오기
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  // 카테고리 필터 쿼리 파라미터 생성
  const categoryParam = selectedCategoryId !== 'all' ? `?categoryId=${selectedCategoryId}` : '';

  const { data: overview, isLoading: overviewLoading } = useQuery<AnalyticsOverview>({
    queryKey: ["/api/admin/analytics/overview", selectedCategoryId],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/admin/analytics/overview${categoryParam}`, { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const { data: performance, isLoading: performanceLoading } = useQuery<PerformanceData>({
    queryKey: ["/api/admin/analytics/performance", selectedCategoryId],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/admin/analytics/performance${categoryParam}`, { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const { data: trends, isLoading: trendsLoading } = useQuery<TrendsData>({
    queryKey: ["/api/admin/analytics/trends", selectedCategoryId],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/admin/analytics/trends${categoryParam}`, { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const { data: emotions, isLoading: emotionsLoading } = useQuery<EmotionData>({
    queryKey: ["/api/admin/analytics/emotions", selectedCategoryId],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/admin/analytics/emotions${categoryParam}`, { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const { data: scenarioEmotions } = useQuery<ScenarioEmotionData>({
    queryKey: ["/api/admin/analytics/emotions/by-scenario", selectedCategoryId],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/admin/analytics/emotions/by-scenario${categoryParam}`, { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  const { data: difficultyEmotions } = useQuery<DifficultyEmotionData>({
    queryKey: ["/api/admin/analytics/emotions/by-difficulty", selectedCategoryId],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/admin/analytics/emotions/by-difficulty${categoryParam}`, { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
  });

  // 현재 시나리오 구조에 맞게 시나리오 데이터 가져오기 (카테고리 필터 적용)
  const { data: scenarios = [] } = useQuery({
    queryKey: ['/api/scenarios', selectedCategoryId],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/scenarios${categoryParam}`, { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 30, // 30분간 캐시 유지 (시나리오는 자주 변경되지 않음)
    gcTime: 1000 * 60 * 60,     // 1시간 메모리 유지
  });

  // MBTI 페르소나 데이터 가져오기
  const { data: personas = [] } = useQuery({
    queryKey: ['/api/admin/personas'],
    queryFn: () => fetch('/api/admin/personas').then(res => res.json()),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  // 참석자 목록 가져오기
  const { data: participantsData, isLoading: participantsLoading } = useQuery<{ participants: Participant[] }>({
    queryKey: ['/api/admin/analytics/participants', selectedCategoryId],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch(`/api/admin/analytics/participants${categoryParam}`, { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  });

  if (overviewLoading || performanceLoading || trendsLoading || emotionsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600"></div>
      </div>
    );
  }

  // Prepare data for charts
  const scoreDistributionData = performance ? [
    { name: "탁월 (90-100)", value: performance.scoreRanges.excellent, color: "#10b981" },
    { name: "우수 (80-89)", value: performance.scoreRanges.good, color: "#3b82f6" },
    { name: "보통 (70-79)", value: performance.scoreRanges.average, color: "#f59e0b" },
    { name: "개선 필요 (60-69)", value: performance.scoreRanges.needsImprovement, color: "#f97316" },
    { name: "미흡 (<60)", value: performance.scoreRanges.poor, color: "#ef4444" }
  ] : [];

  const categoryData = performance ? Object.entries(performance.categoryPerformance).map(([key, data]) => ({
    category: data.name,
    average: data.average,
    count: data.count
  })) : [];

  const scenarioPopularityData = overview ? Object.entries(overview.scenarioStats).map(([scenarioId, data]) => {
    return {
      name: data.name,
      sessions: data.count,
      difficulty: data.difficulty
    };
  }) : [];

  // MBTI 사용 분석 데이터
  const mbtiUsageData = overview ? Object.entries(overview.mbtiUsage).map(([mbtiId, count]) => ({
    name: mbtiId.toUpperCase(),
    count,
    percentage: Math.round((count / overview.totalSessions) * 100)
  })) : [];

  const scenarioPerformanceData = performance ? Object.entries(performance.scenarioPerformance).map(([scenarioId, data]) => {
    const scenario = scenarios.find((s: any) => s.id === scenarioId);
    return {
      name: data.name || scenario?.title || scenarioId,
      average: data.average,
      sessionCount: data.sessionCount,
      difficulty: data.difficulty || scenario?.difficulty || 1,
      personaCount: data.personaCount || 0
    };
  }) : [];

  // 난이도별 선택 인기도 계산 - 사용자가 선택한 난이도 기반
  const difficultyPopularityData = overview?.difficultyUsage ? 
    overview.difficultyUsage.map((d: any) => ({
      difficulty: `Lv${d.level}`,
      count: d.count
    })) : [];

  // 페르소나 수별 인기도 계산 - 유저가 선택한 수(세션 수) 기준
  const scenarioDifficultyData = scenarios.reduce((acc: any[], scenario: any) => {
    const personaCount = scenario.personas?.length || 0;
    if (personaCount === 0) return acc;
    
    const stats = overview?.scenarioStats?.[scenario.id];
    const sessionCount = stats?.count || 0;
    
    const existing = acc.find(d => d.personaCount === personaCount);
    if (existing) {
      existing.count += sessionCount;
    } else {
      acc.push({
        personaCount,
        count: sessionCount
      });
    }
    return acc;
  }, []).sort((a: any, b: any) => a.personaCount - b.personaCount);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader 
        title="운영자 대시보드"
        subtitle="교육 결과 분석 및 성과 현황"
        showBackButton
      />
      <div className="container mx-auto p-6 space-y-6" data-testid="admin-dashboard">
      
      {/* 관리자용 카테고리 필터 (시스템 관리자만 표시) */}
      {user?.role === 'admin' && (
        <div className="flex items-center gap-3 p-4 bg-white rounded-lg border shadow-sm">
          <Filter className="w-5 h-5 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">카테고리 필터:</span>
          <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
            <SelectTrigger className="w-[200px]" data-testid="category-filter-select">
              <SelectValue placeholder="전체 카테고리" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 카테고리</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedCategoryId !== 'all' && (
            <span className="text-xs text-slate-500">
              선택된 카테고리의 데이터만 표시됩니다
            </span>
          )}
        </div>
      )}
      
      {/* 운영자용 카테고리 표시 (운영자인 경우 자신의 카테고리만 표시) */}
      {user?.role === 'operator' && user?.assignedCategoryId && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <Filter className="w-5 h-5 text-blue-500" />
          <span className="text-sm font-medium text-blue-700">
            {categories.find(c => String(c.id) === String(user.assignedCategoryId))?.name || '할당된 카테고리'} 카테고리 데이터만 표시됩니다
          </span>
        </div>
      )}
      
      {/* Detailed Analytics */}
      <Tabs defaultValue="participants" className="space-y-6" onValueChange={(value) => setShowMobileTabMenu(false)}>
        {/* 데스크톱 탭 */}
        <TabsList className="hidden md:grid w-full grid-cols-9">
          <TabsTrigger value="participants" data-testid="tab-participants">참석자 관리</TabsTrigger>
          <TabsTrigger value="overview" data-testid="tab-overview">개요</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">성과 분석</TabsTrigger>
          <TabsTrigger value="scenarios" data-testid="tab-scenarios">시나리오 분석</TabsTrigger>
          <TabsTrigger value="mbti" data-testid="tab-mbti">MBTI 분석</TabsTrigger>
          <TabsTrigger value="emotions" data-testid="tab-emotions">감정 분석</TabsTrigger>
          <TabsTrigger value="trends" data-testid="tab-trends">트렌드 분석</TabsTrigger>
          <TabsTrigger value="content" data-testid="tab-content">컨텐츠 현황</TabsTrigger>
          <TabsTrigger value="translations" data-testid="tab-translations">번역 관리</TabsTrigger>
        </TabsList>
        
        {/* 모바일 탭 (스마트 버튼 포함) */}
        <div className="md:hidden space-y-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="participants" data-testid="mobile-tab-participants-primary">참석자</TabsTrigger>
            <TabsTrigger value="overview" data-testid="mobile-tab-overview">개요</TabsTrigger>
            <TabsTrigger value="performance" data-testid="mobile-tab-performance">성과</TabsTrigger>
            <button
              type="button"
              onClick={() => setShowMobileTabMenu(!showMobileTabMenu)}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${showMobileTabMenu ? 'bg-indigo-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
              data-testid="mobile-tab-more"
            >
              <i className={`fas ${showMobileTabMenu ? 'fa-times' : 'fa-ellipsis-h'} mr-1`}></i>
              {showMobileTabMenu ? '닫기' : '더보기'}
            </button>
          </TabsList>
          
          {/* 확장 메뉴 */}
          {showMobileTabMenu && (
            <div className="bg-slate-100 rounded-lg p-2 animate-in slide-in-from-top duration-200">
              <TabsList className="grid w-full grid-cols-6 gap-2 bg-transparent">
                <TabsTrigger value="scenarios" className="bg-white" data-testid="mobile-tab-scenarios">시나리오</TabsTrigger>
                <TabsTrigger value="mbti" className="bg-white" data-testid="mobile-tab-mbti">MBTI</TabsTrigger>
                <TabsTrigger value="emotions" className="bg-white" data-testid="mobile-tab-emotions">감정</TabsTrigger>
                <TabsTrigger value="trends" className="bg-white" data-testid="mobile-tab-trends">트렌드</TabsTrigger>
                <TabsTrigger value="content" className="bg-white" data-testid="mobile-tab-content">컨텐츠</TabsTrigger>
                <TabsTrigger value="translations" className="bg-white" data-testid="mobile-tab-translations">번역</TabsTrigger>
              </TabsList>
            </div>
          )}
        </div>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Top Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="card-enhanced" data-testid="card-session-summary">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="훈련 세션" description="완료한 세션 수 / 전체 시작한 세션 수. 사용자가 실제로 대화를 완료한 페르소나 실행 기준." /></CardTitle>
                <i className="fas fa-chart-line text-blue-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="session-summary">
                  {overview?.completedSessions || 0}/{overview?.totalSessions || 0}
                </div>
                <p className="text-xs text-slate-600">완료율 {overview?.completionRate || 0}%</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-average-score">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="평균 점수" description="모든 완료된 세션의 평가 점수 평균 (0-100점). AI가 사용자의 커뮤니케이션 능력을 평가한 종합 점수입니다." /></CardTitle>
                <i className="fas fa-star text-yellow-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="average-score">{overview?.averageScore || 0}점</div>
                <p className="text-xs text-slate-600">전체 세션 평균</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-participation">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="참여인수" description="실제 대화에 참여한 사용자 비율 (%). 시나리오를 시작한 활동 유저 기준으로 계산됩니다." /></CardTitle>
                <i className="fas fa-users text-green-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="participation-rate">{overview?.participationRate || 0}%</div>
                <p className="text-xs text-slate-600">{overview?.activeUsers || 0}/{overview?.totalUsers || 0} 사용자</p>
              </CardContent>
            </Card>
          </div>

          {/* Extended Metrics - 사용자 활동 기간 분석 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* DAU/WAU/MAU 탭 카드 */}
            <Card className="card-enhanced" data-testid="card-dau-wau-mau">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-calendar text-purple-600"></i>
                  사용자 활동 기간
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="dau" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="dau" data-testid="tab-dau">일간</TabsTrigger>
                    <TabsTrigger value="wau" data-testid="tab-wau">주간</TabsTrigger>
                    <TabsTrigger value="mau" data-testid="tab-mau">월간</TabsTrigger>
                  </TabsList>
                  <TabsContent value="dau" className="mt-4">
                    <div className="text-3xl font-bold text-purple-600" data-testid="dau-value">{overview?.dau || 0}명</div>
                    <p className="text-sm text-slate-600 mt-2">오늘 활동한 사용자</p>
                  </TabsContent>
                  <TabsContent value="wau" className="mt-4">
                    <div className="text-3xl font-bold text-indigo-600" data-testid="wau-value">{overview?.wau || 0}명</div>
                    <p className="text-sm text-slate-600 mt-2">이번 주 활동한 사용자</p>
                  </TabsContent>
                  <TabsContent value="mau" className="mt-4">
                    <div className="text-3xl font-bold text-teal-600" data-testid="mau-value">{overview?.mau || 0}명</div>
                    <p className="text-sm text-slate-600 mt-2">이번 달 활동한 사용자</p>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Sessions Per User */}
            <Card className="card-enhanced" data-testid="card-sessions-per-user">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="인당 세션" description="활동 유저당 평균 세션 수. (총 세션 수 / 활동 유저 수) 계산값입니다." /></CardTitle>
                <i className="fas fa-user-clock text-orange-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="sessions-per-user-value">{overview?.sessionsPerUser || 0}회</div>
                <p className="text-xs text-slate-600">유저당 평균 세션 수</p>
              </CardContent>
            </Card>
          </div>

          {/* User Engagement Metrics - 유저 참여 분석 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="card-enhanced" data-testid="card-new-users">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="신규 유저" description="정확히 1회의 세션을 완료한 사용자 수. 처음 참여했거나 한 번만 시도한 사용자입니다." /></CardTitle>
                <i className="fas fa-user-plus text-green-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="new-users-value">{overview?.newUsers || 0}명</div>
                <p className="text-xs text-slate-600">1회 세션 참여 유저</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-returning-users">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="재방문 유저" description="2회 이상의 세션을 완료한 사용자 수. 앱을 반복적으로 사용하는 활성 사용자입니다." /></CardTitle>
                <i className="fas fa-user-check text-blue-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="returning-users-value">{overview?.returningUsers || 0}명</div>
                <p className="text-xs text-slate-600">2회 이상 세션 참여</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-returning-rate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="재방문율" description="재방문 유저 수를 전체 활동 유저로 나눈 비율 (%). 사용자 유지율을 나타냅니다." /></CardTitle>
                <i className="fas fa-redo text-yellow-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="returning-rate-value">{overview?.returningRate || 0}%</div>
                <p className="text-xs text-slate-600">재방문 유저 비율</p>
              </CardContent>
            </Card>
          </div>

          {/* Rankings - 랭킹 분석 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Top Active Users */}
            <Card className="card-enhanced" data-testid="card-top-users">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-trophy text-yellow-500"></i>
                  활동 유저 Top 5
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {overview?.topActiveUsers?.slice(0, 5).map((user, index) => (
                    <div key={user.userId} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`top-user-${index}`}>
                      <span className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0 ? 'bg-yellow-400 text-yellow-900' :
                          index === 1 ? 'bg-gray-300 text-gray-700' :
                          index === 2 ? 'bg-orange-300 text-orange-800' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="text-sm truncate max-w-[100px]">{user.userId.slice(0, 8)}...</span>
                      </span>
                      <span className="text-sm font-semibold text-corporate-600">{user.sessionCount}회</span>
                    </div>
                  )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>

            {/* Top Scenarios */}
            <Card className="card-enhanced" data-testid="card-top-scenarios">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-fire text-red-500"></i>
                  인기 시나리오 Top 5
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {overview?.topScenarios?.map((scenario, index) => (
                    <div key={scenario.id} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`top-scenario-${index}`}>
                      <span className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0 ? 'bg-red-400 text-white' :
                          index === 1 ? 'bg-red-300 text-red-800' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="text-sm truncate max-w-[120px]">{scenario.name}</span>
                      </span>
                      <span className="text-sm font-semibold text-green-600">{scenario.count}회</span>
                    </div>
                  )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>

            {/* Hardest Scenarios */}
            <Card className="card-enhanced" data-testid="card-hardest-scenarios">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-skull text-slate-600"></i>
                  어려운 시나리오 Top 5
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {overview?.hardestScenarios?.map((scenario, index) => (
                    <div key={scenario.id} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`hardest-scenario-${index}`}>
                      <span className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0 ? 'bg-slate-700 text-white' :
                          index === 1 ? 'bg-slate-500 text-white' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="text-sm truncate max-w-[120px]">{scenario.name}</span>
                      </span>
                      <span className="text-sm font-semibold text-red-600">{scenario.averageScore}점</span>
                    </div>
                  )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          {/* 1. 핵심 성과 요약 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="card-enhanced" data-testid="card-perf-average">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="전체 평균 점수" description="모든 피드백의 평가 점수 평균 (0-100점). AI 평가 기준: 명확성, 공감력, 문제해결능력, 태도 등 다양한 지표로 평가합니다." /></CardTitle>
                <i className="fas fa-chart-bar text-blue-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600" data-testid="perf-average-value">
                  {performance?.averageScore || 0}점
                </div>
                <p className="text-xs text-slate-600 mt-1">전체 {performance?.totalFeedbacks || 0}건 평가 기준</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-perf-highest">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="최고 점수" description="시스템에서 기록된 최고 평가 점수. 사용자가 달성한 최상의 커뮤니케이션 성과입니다." /></CardTitle>
                <i className="fas fa-trophy text-yellow-500"></i>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-yellow-600" data-testid="perf-highest-value">
                  {performance?.highestScore || 0}점
                </div>
                <p className="text-xs text-slate-600 mt-1">역대 최고 기록</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-perf-completion">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="평가 완료율" description="AI 평가 피드백을 받은 세션의 비율 (%). 대화 완료 후 AI가 상세 피드백을 제공한 세션 기준입니다." /></CardTitle>
                <i className="fas fa-check-circle text-green-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600" data-testid="perf-completion-value">
                  {performance?.feedbackCompletionRate || 0}%
                </div>
                <p className="text-xs text-slate-600 mt-1">피드백 완료된 세션</p>
              </CardContent>
            </Card>
          </div>

          {/* 2. 점수 분석 섹션 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Score Distribution */}
            <Card className="card-enhanced" data-testid="card-score-distribution">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-pie-chart text-purple-600"></i>
                  <CardInfo title="점수 분포" description="모든 세션을 점수 범위별로 분류한 비율. 우수/양호/보통/개선필요/부족 5단계로 분류합니다." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={scoreDistributionData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {scoreDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Score Trend Line Chart */}
            <Card className="card-enhanced" data-testid="card-score-trend">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-chart-line text-indigo-600"></i>
                  <CardInfo title="점수 추이" description="최근 20개 세션의 점수 변화 추이. 사용자의 성과 개선 정도를 시간순으로 확인할 수 있습니다." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trends?.performanceTrends || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="session" label={{ value: "세션", position: "insideBottom", offset: -5 }} />
                    <YAxis domain={[0, 100]} label={{ value: "점수", angle: -90, position: "insideLeft" }} />
                    <Tooltip formatter={(value) => [`${value}점`, "점수"]} />
                    <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ fill: "#6366f1" }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* 3. 카테고리 분석 + 강점/개선점 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Category Performance */}
            <Card data-testid="card-category-performance">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-tags text-blue-600"></i>
                  <CardInfo title="카테고리별 성과" description="평가 카테고리(명확성, 공감력, 문제해결력, 태도)별 평균 점수. 각 역량 영역의 강점과 개선점을 파악할 수 있습니다." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 5]} />
                    <YAxis dataKey="category" type="category" width={80} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => [`${value}점`, "평균"]} />
                    <Bar dataKey="average" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top Strengths */}
            <Card className="card-enhanced" data-testid="card-top-strengths">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-thumbs-up text-green-600"></i>
                  <CardInfo title="강점 Top 5" description="AI 피드백에서 가장 많이 언급된 긍정적 강점. 사용자가 잘 수행하고 있는 커뮤니케이션 능력입니다." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {performance?.topStrengths?.length ? performance.topStrengths.map((item, index) => (
                    <div key={index} className="flex items-start gap-3 p-2 bg-green-50 rounded-lg" data-testid={`strength-${index}`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        index === 0 ? 'bg-green-500 text-white' :
                        index === 1 ? 'bg-green-400 text-white' :
                        'bg-green-200 text-green-700'
                      }`}>
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 line-clamp-2">{item.text}</p>
                        <p className="text-xs text-green-600 mt-1">{item.count}회 언급</p>
                      </div>
                    </div>
                  )) : <p className="text-slate-500 text-sm text-center py-4">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>

            {/* Top Improvements */}
            <Card className="card-enhanced" data-testid="card-top-improvements">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-arrow-up text-orange-600"></i>
                  <CardInfo title="개선점 Top 5" description="AI 피드백에서 가장 많이 언급된 개선사항. 사용자가 집중해서 개선해야 할 커뮤니케이션 역량입니다." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {performance?.topImprovements?.length ? performance.topImprovements.map((item, index) => (
                    <div key={index} className="flex items-start gap-3 p-2 bg-orange-50 rounded-lg" data-testid={`improvement-${index}`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        index === 0 ? 'bg-orange-500 text-white' :
                        index === 1 ? 'bg-orange-400 text-white' :
                        'bg-orange-200 text-orange-700'
                      }`}>
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 line-clamp-2">{item.text}</p>
                        <p className="text-xs text-orange-600 mt-1">{item.count}회 언급</p>
                      </div>
                    </div>
                  )) : <p className="text-slate-500 text-sm text-center py-4">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 4. 세부 성과 테이블 */}
          <Card className="card-enhanced" data-testid="card-recent-sessions">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <i className="fas fa-list-alt text-slate-600"></i>
                최근 세션 상세 (최근 20건)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3 text-left font-semibold">점수</th>
                      <th className="p-3 text-left font-semibold">시나리오</th>
                      <th className="p-3 text-left font-semibold">MBTI</th>
                      <th className="p-3 text-left font-semibold">난이도</th>
                      <th className="p-3 text-left font-semibold">사용자</th>
                      <th className="p-3 text-left font-semibold">완료일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance?.recentSessions?.map((session, index) => {
                      const difficultyLabels: Record<number, string> = { 1: '매우 쉬움', 2: '기본', 3: '도전형', 4: '고난도' };
                      const scoreColor = session.score >= 90 ? 'text-green-600' :
                                        session.score >= 80 ? 'text-blue-600' :
                                        session.score >= 70 ? 'text-yellow-600' :
                                        session.score >= 60 ? 'text-orange-600' : 'text-red-600';
                      return (
                        <tr key={session.id} className="border-b hover:bg-slate-50" data-testid={`session-row-${index}`}>
                          <td className={`p-3 font-bold ${scoreColor}`}>{session.score}점</td>
                          <td className="p-3 truncate max-w-[150px]">{session.scenarioName}</td>
                          <td className="p-3">
                            <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-bold">
                              {session.mbti}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded text-xs ${
                              session.difficulty === 4 ? 'bg-red-100 text-red-700' :
                              session.difficulty === 3 ? 'bg-orange-100 text-orange-700' :
                              session.difficulty === 2 ? 'bg-blue-100 text-blue-700' :
                              'bg-green-100 text-green-700'
                            }`}>
                              {difficultyLabels[session.difficulty] || '기본'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500">{session.userId}...</td>
                          <td className="p-3 text-slate-500">
                            {new Date(session.completedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      );
                    })}
                    {(!performance?.recentSessions || performance.recentSessions.length === 0) && (
                      <tr><td colSpan={6} className="p-4 text-center text-slate-500">최근 세션 데이터가 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scenarios" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Scenario Popularity */}
            <Card data-testid="card-scenario-popularity">
              <CardHeader>
                <CardTitle><CardInfo title="시나리오 인기도" description="각 시나리오별 세션 참여 수. 사용자들이 선택한 시나리오의 인기도를 나타냅니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scenarioPopularityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="sessions" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Scenario Performance */}
            <Card data-testid="card-scenario-performance">
              <CardHeader>
                <CardTitle><CardInfo title="시나리오별 성과" description="각 시나리오에서 사용자가 받은 평가 점수의 평균. 시나리오 난이도와 특성에 따른 성과를 비교할 수 있습니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scenarioPerformanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="average" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Difficulty Popularity */}
            <Card data-testid="card-difficulty-popularity">
              <CardHeader>
                <CardTitle><CardInfo title="난이도 선택 인기도" description="사용자가 선택한 난이도별 세션 수. 1=매우쉬움, 2=기본, 3=도전형, 4=고난도입니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={difficultyPopularityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="difficulty" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Persona Count Popularity */}
            <Card data-testid="card-persona-count-popularity">
              <CardHeader>
                <CardTitle><CardInfo title="페르소나 수별 인기도" description="시나리오에 포함된 페르소나 수에 따른 세션 수. 더 많은 페르소나와의 대화가 선호도에 미치는 영향을 보여줍니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scenarioDifficultyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="personaCount" label={{ value: "페르소나 수", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "세션 수", angle: -90, position: "insideLeft" }} />
                    <Tooltip formatter={(value) => [`${value}회`, "세션 수"]} labelFormatter={(label) => `${label}명의 페르소나`} />
                    <Bar dataKey="count" fill="#8b5cf6" name="세션 수" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Scenario Details Table */}
          <Card data-testid="card-scenario-details">
            <CardHeader>
              <CardTitle><CardInfo title="시나리오 상세 분석" description="전체 시나리오의 통계 정보. 평균 점수, 세션 수, 난이도, 포함 페르소나 수, 성과 상태를 한눈에 확인할 수 있습니다." /></CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">시나리오</th>
                      <th className="text-left p-2">평균 점수</th>
                      <th className="text-left p-2">세션 수</th>
                      <th className="text-left p-2">난이도</th>
                      <th className="text-left p-2">페르소나 수</th>
                      <th className="text-left p-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarioPerformanceData.map((scenario, index) => (
                      <tr key={index} className="border-b hover:bg-slate-50" data-testid={`scenario-row-${index}`}>
                        <td className="p-2 font-medium">{scenario.name}</td>
                        <td className="p-2">
                          <span className={`font-semibold ${
                            scenario.average >= 80 ? 'text-green-600' :
                            scenario.average >= 70 ? 'text-blue-600' :
                            scenario.average >= 60 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {scenario.average}점
                          </span>
                        </td>
                        <td className="p-2">{scenario.sessionCount}회</td>
                        <td className="p-2">
                          {'★'.repeat(Math.min(scenario.difficulty, 4))}{'☆'.repeat(Math.max(0, 4-scenario.difficulty))}
                        </td>
                        <td className="p-2">{scenario.personaCount || 0}명</td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            scenario.average >= 75 ? 'bg-green-100 text-green-800' :
                            scenario.average >= 65 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {scenario.average >= 75 ? '우수' : scenario.average >= 65 ? '보통' : '개선 필요'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mbti" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* MBTI Usage Distribution */}
            <Card data-testid="card-mbti-usage">
              <CardHeader>
                <CardTitle><CardInfo title="MBTI 유형별 사용량" description="각 MBTI 페르소나와의 대화 횟수. 사용자들이 선호하는 페르소나 유형을 파악할 수 있습니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={mbtiUsageData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value, name) => [`${value}회`, name === 'count' ? '사용 횟수' : name]} />
                    <Bar dataKey="count" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* MBTI Performance Chart */}
            <Card data-testid="card-mbti-performance">
              <CardHeader>
                <CardTitle><CardInfo title="MBTI 유형별 성과" description="각 MBTI 페르소나와의 대화에서 받은 평가 점수의 평균. 특정 페르소나와의 상호작용에서 사용자의 성과를 비교할 수 있습니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={performance ? Object.entries(performance.mbtiPerformance).map(([mbti, data]) => ({
                    name: mbti.toUpperCase(),
                    average: data.average,
                    count: data.count
                  })) : []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(value, name) => [
                      name === 'average' ? `${value}점` : `${value}회`,
                      name === 'average' ? '평균 점수' : '세션 수'
                    ]} />
                    <Bar dataKey="average" fill="#06b6d4" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* MBTI Details Table */}
          <Card data-testid="card-mbti-details">
            <CardHeader>
              <CardTitle><CardInfo title="MBTI 상세 분석" description="전체 MBTI 페르소나의 통계. 평균 점수, 세션 수, 사용 비율, 성과 레벨을 한눈에 확인할 수 있습니다." /></CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">MBTI 유형</th>
                      <th className="text-left p-2">평균 점수</th>
                      <th className="text-left p-2">세션 수</th>
                      <th className="text-left p-2">사용 비율</th>
                      <th className="text-left p-2">성과 레벨</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance ? Object.entries(performance.mbtiPerformance).map(([mbti, data], index) => {
                      const usageCount = overview?.mbtiUsage[mbti] || 0;
                      const usagePercentage = overview?.totalSessions ? Math.round((usageCount / overview.totalSessions) * 100) : 0;
                      
                      return (
                        <tr key={index} className="border-b hover:bg-slate-50" data-testid={`mbti-row-${index}`}>
                          <td className="p-2 font-medium">{mbti.toUpperCase()}</td>
                          <td className="p-2">
                            <span className={`font-semibold ${
                              data.average >= 80 ? 'text-green-600' :
                              data.average >= 70 ? 'text-blue-600' :
                              data.average >= 60 ? 'text-yellow-600' : 'text-red-600'
                            }`}>
                              {data.average}점
                            </span>
                          </td>
                          <td className="p-2">{data.count}회</td>
                          <td className="p-2">{usagePercentage}%</td>
                          <td className="p-2">
                            <span className={`px-2 py-1 rounded-full text-xs ${
                              data.average >= 80 ? 'bg-green-100 text-green-800' :
                              data.average >= 70 ? 'bg-blue-100 text-blue-800' :
                              data.average >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {data.average >= 80 ? '탁월' : 
                               data.average >= 70 ? '우수' : 
                               data.average >= 60 ? '보통' : '개선 필요'}
                            </span>
                          </td>
                        </tr>
                      );
                    }) : []}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            {/* Daily Usage Trends */}
            <Card data-testid="card-daily-usage">
              <CardHeader>
                <CardTitle><CardInfo title="일일 사용량 추이" description="최근 30일간 매일 시작된 세션과 완료된 세션의 수. 사용자 활동 추세와 완료율 변화를 시간순으로 볼 수 있습니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends?.dailyUsage || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="sessions" stroke="#3b82f6" name="시작된 세션" />
                    <Line type="monotone" dataKey="completed" stroke="#10b981" name="완료된 세션" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Performance Trends */}
            <Card data-testid="card-performance-trends">
              <CardHeader>
                <CardTitle><CardInfo title="성과 트렌드" description="최근 20개 세션의 평가 점수 추이. 사용자의 학습 진행 상황과 개선 정도를 시각적으로 파악할 수 있습니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends?.performanceTrends || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="session" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Emotion Analysis Tab - Combined View */}
        <TabsContent value="emotions" className="space-y-6">
          {/* Overall Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="card-enhanced" data-testid="card-total-emotions">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="총 감정 표현" description="AI가 대화 중 표현한 총 감정 횟수입니다." /></CardTitle>
                <i className="fas fa-heart text-pink-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-pink-600">{emotions?.totalEmotions || 0}회</div>
                <p className="text-xs text-slate-600">기록된 감정 표현</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-unique-emotions">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="감정 종류" description="AI가 표현한 고유한 감정 종류의 개수입니다." /></CardTitle>
                <i className="fas fa-theater-masks text-purple-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600">{emotions?.uniqueEmotions || 0}종류</div>
                <p className="text-xs text-slate-600">다양한 감정 표현</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-top-emotion">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="최다 감정" description="가장 많이 표현된 감정입니다." /></CardTitle>
                <i className="fas fa-star text-yellow-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">
                  {emotions?.emotions?.[0] ? `${emotions.emotions[0].emoji} ${emotions.emotions[0].emotion}` : '-'}
                </div>
                <p className="text-xs text-slate-600">
                  {emotions?.emotions?.[0] ? `${emotions.emotions[0].count}회 (${emotions.emotions[0].percentage}%)` : '데이터 없음'}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Overall Emotion Distribution Chart */}
          <Card data-testid="card-emotion-distribution">
              <CardHeader>
                <CardTitle><CardInfo title="감정 분포" description="전체 감정 표현의 비율을 보여줍니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={emotions?.emotions?.map((e, i) => ({
                        name: `${e.emoji} ${e.emotion}`,
                        value: e.count,
                        fill: ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#84cc16', '#14b8a6'][i % 11]
                      })) || []}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {emotions?.emotions?.map((_, i) => (
                        <Cell key={`cell-${i}`} fill={['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#84cc16', '#14b8a6'][i % 11]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [`${value}회`, '빈도']} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

          {/* Difficulty Analysis Section */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <i className="fas fa-signal text-orange-500"></i>
              난이도별 감정 분석
            </h3>
            
            {!difficultyEmotions?.difficultyStats?.length ? (
              <div className="text-center py-8 text-slate-500">난이도별 감정 데이터가 없습니다.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {difficultyEmotions.difficultyStats.map((diff) => {
                    const difficultyColors: Record<number, string> = {
                      1: 'bg-green-100 border-green-300',
                      2: 'bg-blue-100 border-blue-300',
                      3: 'bg-orange-100 border-orange-300',
                      4: 'bg-red-100 border-red-300'
                    };
                    return (
                      <div key={diff.difficulty} className={`border-2 rounded-lg p-4 ${difficultyColors[diff.difficulty] || 'bg-slate-100 border-slate-300'}`}>
                        <div className="flex justify-between items-center mb-3">
                          <div>
                            <span className="font-bold text-lg">{diff.difficultyName}</span>
                            <span className="ml-2 text-sm text-slate-500">Lv.{diff.difficulty}</span>
                          </div>
                          {diff.topEmotion && (
                            <span className="text-2xl" title={`주요 감정: ${diff.topEmotion.emotion}`}>
                              {diff.topEmotion.emoji}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 mb-3">총 {diff.totalCount}회 감정 표현</p>
                        <div className="flex flex-wrap gap-2">
                          {diff.emotions.slice(0, 4).map((e) => (
                            <span 
                              key={e.emotion}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/80 text-slate-700"
                            >
                              {e.emoji} {e.percentage}%
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Card data-testid="card-difficulty-emotion-chart">
                  <CardHeader>
                    <CardTitle><CardInfo title="난이도별 감정 빈도 비교" description="난이도별로 총 감정 표현 횟수를 비교합니다." /></CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={difficultyEmotions.difficultyStats.map(d => ({
                        name: d.difficultyName,
                        count: d.totalCount,
                        topEmotion: d.topEmotion?.emoji || ''
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip 
                          formatter={(value: number) => [`${value}회`, '감정 표현 횟수']}
                          labelFormatter={(label) => {
                            const diff = difficultyEmotions.difficultyStats.find(d => d.difficultyName === label);
                            return diff?.topEmotion ? `${label} (주요: ${diff.topEmotion.emoji} ${diff.topEmotion.emotion})` : label;
                          }}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {difficultyEmotions.difficultyStats.map((d, idx) => {
                            const colors = ['#22c55e', '#3b82f6', '#f97316', '#ef4444'];
                            return <Cell key={`cell-${idx}`} fill={colors[d.difficulty - 1] || '#8b5cf6'} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* Scenario Analysis Section */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <i className="fas fa-folder-open text-purple-500"></i>
              시나리오별 감정 분석
            </h3>
            
            {!scenarioEmotions?.scenarios?.length ? (
              <div className="text-center py-8 text-slate-500">시나리오 감정 데이터가 없습니다.</div>
            ) : (
              <>
                <div className="space-y-4 mb-6">
                  {scenarioEmotions.scenarios.slice(0, 6).map((scenario) => (
                    <div key={scenario.scenarioId} className="border rounded-lg p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h4 className="font-medium text-slate-900">{scenario.scenarioName}</h4>
                          <p className="text-sm text-slate-500">총 {scenario.totalCount}회 감정 표현</p>
                        </div>
                        {scenario.topEmotion && (
                          <div className="text-right">
                            <span className="text-2xl">{scenario.topEmotion.emoji}</span>
                            <p className="text-xs text-slate-500">주요 감정: {scenario.topEmotion.emotion}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {scenario.emotions.slice(0, 5).map((e) => (
                          <span 
                            key={e.emotion}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                          >
                            {e.emoji} {e.emotion} ({e.percentage}%)
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <Card data-testid="card-scenario-emotion-chart">
                  <CardHeader>
                    <CardTitle><CardInfo title="시나리오별 감정 빈도 비교" description="시나리오별로 총 감정 표현 횟수를 비교합니다." /></CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={scenarioEmotions.scenarios.slice(0, 8).map(s => ({
                        name: s.scenarioName.length > 15 ? s.scenarioName.slice(0, 15) + '...' : s.scenarioName,
                        count: s.totalCount,
                        topEmotion: s.topEmotion?.emoji || ''
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-15} textAnchor="end" height={80} />
                        <YAxis />
                        <Tooltip formatter={(value: number) => [`${value}회`, '감정 표현 횟수']} />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </TabsContent>

        {/* Content Registration Status */}
        <TabsContent value="content" className="space-y-6">
          {/* 1. 콘텐츠 요약 카드 (4개) */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="card-enhanced" data-testid="card-total-scenarios">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="총 시나리오" description="시스템에 등록된 전체 시나리오 개수. 사용자에게 제공되는 대화 훈련 주제의 총 개수입니다." /></CardTitle>
                <i className="fas fa-folder text-blue-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{scenarios.length}개</div>
                <p className="text-xs text-slate-600">등록된 시나리오 수</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-total-personas">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="총 페르소나" description="시스템에 등록된 전체 MBTI 페르소나 개수. 사용자가 대화할 수 있는 개별 AI 캐릭터의 총 개수입니다." /></CardTitle>
                <i className="fas fa-user-circle text-purple-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600">{personas.length}개</div>
                <p className="text-xs text-slate-600">등록된 MBTI 페르소나 수</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-avg-personas-per-scenario">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="평균 페르소나/시나리오" description="각 시나리오당 포함된 페르소나의 평균 개수. (전체 페르소나 수 / 시나리오 수) 계산값입니다." /></CardTitle>
                <i className="fas fa-users-cog text-green-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {scenarios.length > 0 
                    ? (scenarios.reduce((sum: number, s: any) => sum + (s.personas?.length || 0), 0) / scenarios.length).toFixed(1)
                    : 0}명
                </div>
                <p className="text-xs text-slate-600">시나리오당 평균 페르소나</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-recent-update">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium"><CardInfo title="최근 업데이트" description="마지막으로 시나리오 또는 페르소나 콘텐츠가 수정되거나 추가된 날짜와 시간입니다." /></CardTitle>
                <i className="fas fa-clock text-teal-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-teal-600">
                  {overview?.lastContentUpdate 
                    ? new Date(overview.lastContentUpdate).toLocaleDateString('ko-KR', { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '업데이트 없음'}
                </div>
                <p className="text-xs text-slate-600">마지막 콘텐츠 수정 일시</p>
              </CardContent>
            </Card>
          </div>

          {/* 2. 콘텐츠 목록 테이블 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card data-testid="card-scenario-list">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-list text-blue-600"></i>
                  <CardInfo title="시나리오 목록" description="전체 시나리오의 정보. 포함된 페르소나 수, 평균 점수, 사용 횟수를 확인할 수 있습니다." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">시나리오명</th>
                        <th className="p-2 text-center">페르소나</th>
                        <th className="p-2 text-center">평균 점수</th>
                        <th className="p-2 text-center">사용 횟수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((scenario: any, index: number) => {
                        const usageCount = overview?.scenarioStats?.[scenario.id]?.count || 0;
                        const avgScore = overview?.scenarioAverages?.find((s: any) => s.id === scenario.id)?.averageScore || 0;
                        return (
                          <tr key={scenario.id} className="border-b hover:bg-slate-50" data-testid={`content-scenario-row-${index}`}>
                            <td className="p-2 font-medium truncate max-w-[180px]" title={scenario.title}>
                              {scenario.title}
                            </td>
                            <td className="p-2 text-center">{scenario.personas?.length || 0}명</td>
                            <td className="p-2 text-center font-semibold text-corporate-600">{avgScore > 0 ? avgScore.toFixed(1) : '-'}점</td>
                            <td className="p-2 text-center font-semibold text-slate-600">{usageCount}회</td>
                          </tr>
                        );
                      })}
                      {scenarios.length === 0 && (
                        <tr><td colSpan={4} className="p-4 text-center text-slate-500">등록된 시나리오가 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Persona List Table */}
            <Card data-testid="card-persona-list">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-users text-purple-600"></i>
                  <CardInfo title="MBTI 페르소나 목록" description="전체 MBTI 페르소나의 정보. 평균 점수와 사용 횟수를 통해 각 페르소나의 인기도와 성과를 확인할 수 있습니다." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">MBTI</th>
                        <th className="p-2 text-left">이름</th>
                        <th className="p-2 text-center">평균 점수</th>
                        <th className="p-2 text-center">사용 횟수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {personas.map((persona: any, index: number) => {
                        const mbtiKey = persona.mbti ? persona.mbti.toLowerCase() : '';
                        const usageCount = mbtiKey ? (overview?.mbtiUsage?.[mbtiKey] || 0) : 0;
                        const avgScore = overview?.mbtiAverages?.find((m: any) => m.mbti.toLowerCase() === mbtiKey)?.averageScore || 0;
                        return (
                          <tr key={persona.id || index} className="border-b hover:bg-slate-50" data-testid={`content-persona-row-${index}`}>
                            <td className="p-2">
                              <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-bold">
                                {persona.mbti?.toUpperCase() || 'N/A'}
                              </span>
                            </td>
                            <td className="p-2 font-medium">{persona.name || persona.mbti?.toUpperCase()}</td>
                            <td className="p-2 text-center font-semibold text-corporate-600">{avgScore > 0 ? avgScore.toFixed(1) : '-'}점</td>
                            <td className="p-2 text-center font-semibold text-slate-600">{usageCount}회</td>
                          </tr>
                        );
                      })}
                      {personas.length === 0 && (
                        <tr><td colSpan={4} className="p-4 text-center text-slate-500">등록된 페르소나가 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 참석자 관리 탭 */}
        <TabsContent value="participants" className="space-y-6">
          <Card className="card-enhanced">
            <CardHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <CardTitle className="text-lg font-semibold text-slate-800">참석자 관리</CardTitle>
                  <Input
                    placeholder="이름 또는 이메일 검색..."
                    value={participantSearch}
                    onChange={e => setParticipantSearch(e.target.value)}
                    className="w-56 h-9 text-sm"
                    data-testid="participant-search"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-500 font-medium whitespace-nowrap">최근 훈련일:</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Input
                      type="date"
                      value={participantDateFrom}
                      onChange={e => setParticipantDateFrom(e.target.value)}
                      className="h-9 text-sm w-40"
                      data-testid="participant-date-from"
                    />
                    <span className="text-slate-400 text-sm">~</span>
                    <Input
                      type="date"
                      value={participantDateTo}
                      onChange={e => setParticipantDateTo(e.target.value)}
                      className="h-9 text-sm w-40"
                      data-testid="participant-date-to"
                    />
                    {(participantDateFrom || participantDateTo) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 px-3 text-slate-500 hover:text-slate-700"
                        onClick={() => { setParticipantDateFrom(''); setParticipantDateTo(''); }}
                        data-testid="participant-date-reset"
                      >
                        초기화
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {participantsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-corporate-600"></div>
                </div>
              ) : (() => {
                const allParticipants = participantsData?.participants || [];
                const dateFromTs = participantDateFrom ? new Date(participantDateFrom).setHours(0, 0, 0, 0) : null;
                const dateToTs = participantDateTo ? new Date(participantDateTo).setHours(23, 59, 59, 999) : null;
                const filtered = allParticipants.filter(p => {
                  if (participantSearch) {
                    const s = participantSearch.toLowerCase();
                    if (!p.name.toLowerCase().includes(s) && !p.email.toLowerCase().includes(s)) return false;
                  }
                  if (dateFromTs !== null || dateToTs !== null) {
                    if (!p.lastTrainingAt) return false;
                    const t = new Date(p.lastTrainingAt).getTime();
                    if (dateFromTs !== null && t < dateFromTs) return false;
                    if (dateToTs !== null && t > dateToTs) return false;
                  }
                  return true;
                });

                const sorted = [...filtered].sort((a, b) => {
                  const av = a[participantSortKey];
                  const bv = b[participantSortKey];
                  if (av === null || av === undefined) return 1;
                  if (bv === null || bv === undefined) return -1;
                  if (typeof av === 'string' && typeof bv === 'string') {
                    return participantSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
                  }
                  if (typeof av === 'number' && typeof bv === 'number') {
                    return participantSortAsc ? av - bv : bv - av;
                  }
                  return 0;
                });

                const handleSort = (key: keyof Participant) => {
                  if (participantSortKey === key) {
                    setParticipantSortAsc(!participantSortAsc);
                  } else {
                    setParticipantSortKey(key);
                    setParticipantSortAsc(false);
                  }
                };

                const SortIcon = ({ col }: { col: keyof Participant }) => (
                  <span className="ml-1 text-xs text-slate-400">
                    {participantSortKey === col ? (participantSortAsc ? '▲' : '▼') : '⇅'}
                  </span>
                );

                const tierColors: Record<string, string> = {
                  bronze: 'bg-orange-100 text-orange-700',
                  silver: 'bg-slate-100 text-slate-600',
                  gold: 'bg-yellow-100 text-yellow-700',
                  platinum: 'bg-cyan-100 text-cyan-700',
                  diamond: 'bg-purple-100 text-purple-700',
                };

                const scoreColor = (score: number | null) => {
                  if (score === null) return 'text-slate-400';
                  if (score >= 90) return 'text-emerald-600 font-bold';
                  if (score >= 70) return 'text-blue-600 font-semibold';
                  if (score >= 50) return 'text-amber-600';
                  return 'text-red-500';
                };

                return (
                  <>
                    <div className="text-sm text-slate-500 mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>총 <span className="font-semibold text-slate-700">{sorted.length}</span>명의 참석자</span>
                        {participantSearch && (
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-xs">검색: "{participantSearch}"</span>
                        )}
                        {(participantDateFrom || participantDateTo) && (
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                            훈련일: {participantDateFrom || '∞'} ~ {participantDateTo || '∞'}
                          </span>
                        )}
                      </div>
                      {selectedParticipantIds.size > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-corporate-700 font-medium bg-corporate-50 px-2 py-1 rounded">
                            {selectedParticipantIds.size}명 선택됨
                          </span>
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-corporate-600 hover:bg-corporate-700 h-8 text-xs"
                            onClick={handleBulkDownload}
                            disabled={isBulkDownloading}
                          >
                            {isBulkDownloading ? (
                              <><div className="animate-spin rounded-full h-3 w-3 border-b border-white mr-1" />처리 중...</>
                            ) : (
                              <><Download className="w-3 h-3 mr-1" />피드백 리포트 다운로드</>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs text-slate-500"
                            onClick={() => setSelectedParticipantIds(new Set())}
                          >
                            선택 해제
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="p-3 w-10">
                              <Checkbox
                                checked={sorted.length > 0 && sorted.every(p => selectedParticipantIds.has(p.userId))}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedParticipantIds(new Set(sorted.map(p => p.userId)));
                                  } else {
                                    setSelectedParticipantIds(new Set());
                                  }
                                }}
                                aria-label="전체 선택"
                              />
                            </th>
                            <th className="p-3 text-left font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('name')}>
                              이름 <SortIcon col="name" />
                            </th>
                            <th className="p-3 text-left font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('email')}>
                              이메일 <SortIcon col="email" />
                            </th>
                            <th className="p-3 text-left font-medium text-slate-600">카테고리</th>
                            <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('completedSessions')}>
                              완료 세션 <SortIcon col="completedSessions" />
                            </th>
                            <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('averageScore')}>
                              평균 점수 <SortIcon col="averageScore" />
                            </th>
                            <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('latestScore')}>
                              최근 점수 <SortIcon col="latestScore" />
                            </th>
                            <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('lastTrainingAt')}>
                              최근 훈련일 <SortIcon col="lastTrainingAt" />
                            </th>
                            <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('tier')}>
                              등급 <SortIcon col="tier" />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sorted.length === 0 ? (
                            <tr>
                              <td colSpan={9} className="p-8 text-center text-slate-400">
                                {(participantSearch || participantDateFrom || participantDateTo) ? '조건에 맞는 참석자가 없습니다.' : '아직 훈련에 참여한 사용자가 없습니다.'}
                              </td>
                            </tr>
                          ) : sorted.map((p, idx) => (
                            <tr key={p.userId} className={`border-b hover:bg-slate-50 transition-colors ${selectedParticipantIds.has(p.userId) ? 'bg-corporate-50/40' : idx % 2 === 0 ? '' : 'bg-slate-50/40'}`} data-testid={`participant-row-${idx}`}>
                              <td className="p-3">
                                <Checkbox
                                  checked={selectedParticipantIds.has(p.userId)}
                                  onCheckedChange={(checked) => {
                                    const next = new Set(selectedParticipantIds);
                                    if (checked) next.add(p.userId);
                                    else next.delete(p.userId);
                                    setSelectedParticipantIds(next);
                                  }}
                                  aria-label={`${p.name} 선택`}
                                />
                              </td>
                              <td className="p-3">
                                <Link href={`/admin/participant/${p.userId}`} className="font-medium text-corporate-600 hover:text-corporate-700 hover:underline flex items-center gap-1">
                                  {p.name}
                                  <ExternalLink className="w-3 h-3 opacity-50" />
                                </Link>
                              </td>
                              <td className="p-3 text-slate-500 text-xs">{p.email}</td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1">
                                  {p.categories.length > 0
                                    ? p.categories.map((cat, ci) => (
                                        <span key={ci} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{cat}</span>
                                      ))
                                    : <span className="text-slate-400 text-xs">-</span>
                                  }
                                </div>
                              </td>
                              <td className="p-3 text-center">
                                <Link href={`/admin/participant/${p.userId}`} className="inline-flex items-center gap-1 group">
                                  <span className="font-semibold text-corporate-600 group-hover:underline">{p.completedSessions}</span>
                                  <span className="text-slate-400 text-xs"> / {p.totalSessions}</span>
                                </Link>
                              </td>
                              <td className={`p-3 text-center ${scoreColor(p.averageScore)}`}>
                                {p.averageScore !== null ? `${p.averageScore}점` : '-'}
                              </td>
                              <td className={`p-3 text-center ${scoreColor(p.latestScore)}`}>
                                {p.latestScore !== null ? `${p.latestScore}점` : '-'}
                              </td>
                              <td className="p-3 text-center text-slate-500 text-xs">
                                {p.lastTrainingAt
                                  ? new Date(p.lastTrainingAt).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
                                  : '-'}
                              </td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${tierColors[p.tier] || 'bg-slate-100 text-slate-600'}`}>
                                  {p.tier}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="translations" className="space-y-6">
          <TranslationDashboard />
        </TabsContent>

      </Tabs>
      </div>
    </div>
  );
}