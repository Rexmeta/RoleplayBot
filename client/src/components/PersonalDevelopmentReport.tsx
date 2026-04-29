import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { Feedback } from "@shared/schema";
import { authFetchRaw } from "@/lib/authFetch";
import {
  toTenPoint,
  escapeHtml,
  getOverallGrade,
  getPersonaFullInfo,
  extractSentences,
} from "./report/reportUtils";
import { generatePrintableContent } from "./report/generatePrintableContent";
import { ScoreOverview } from "./report/ScoreOverview";
import { PracticeGuidePanel } from "./report/PracticeGuidePanel";
import { DevelopmentPlan } from "./report/DevelopmentPlan";
import { StrategyPanel } from "./report/StrategyPanel";

interface PersonalDevelopmentReportProps {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  onRetry: () => void;
  onSelectNewScenario: () => void;
  hasMorePersonas?: boolean;
  allPersonasCompleted?: boolean;
  onNextPersona?: () => void;
  onFeedbackGeneratingChange?: (isGenerating: boolean) => void;
  onReady?: () => void;
  isAdminView?: boolean;
  autoGenerateFeedback?: boolean;
}

export default function PersonalDevelopmentReport({
  scenario,
  persona,
  conversationId,
  onRetry,
  onSelectNewScenario,
  hasMorePersonas,
  allPersonasCompleted,
  onNextPersona,
  onFeedbackGeneratingChange,
  onReady,
  isAdminView = false,
  autoGenerateFeedback = false
}: PersonalDevelopmentReportProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [hasRequestedFeedback, setHasRequestedFeedback] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [activeReportTab, setActiveReportTab] = useState("scores");
  const [scoreAnimKey, setScoreAnimKey] = useState(0);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(`checklist_${conversationId}`);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: userConversations = [] } = useQuery<any[]>({ queryKey: ['/api/conversations'] });
  const currentConversation = userConversations.find((c: any) => c.id === conversationId) || null;

  const { data: feedback, isLoading, error, refetch } = useQuery<Feedback>({
    queryKey: ["/api/conversations", conversationId, "feedback"],
    enabled: !!conversationId,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const response = await authFetchRaw(`/api/conversations/${conversationId}/feedback`);
      if (response.status === 404) throw new Error("FEEDBACK_NOT_FOUND");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }
  });

  useEffect(() => {
    if (!isLoading && (feedback || error?.message === "FEEDBACK_NOT_FOUND")) {
      onReady?.();
    }
  }, [feedback, isLoading, error, onReady]);

  const { data: userProfile } = useQuery<any>({ queryKey: ['/api/auth/user'] });
  const userName = userProfile?.name || t('report.defaultUser', '사용자');

  const { data: feedbackHistory = [] } = useQuery<any[]>({
    queryKey: ['/api/users/me/feedback-history', scenario.id, persona.id],
    queryFn: async () => {
      const response = await authFetchRaw(
        `/api/users/me/feedback-history?scenarioId=${encodeURIComponent(scenario.id)}&personaId=${encodeURIComponent(persona.id)}`
      );
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!scenario.id && !!persona.id,
    staleTime: 60000,
  });

  const getNextPersona = () => {
    const personasArray = (scenario as any).personas;
    if (!personasArray || personasArray.length <= 1) return null;
    const currentIndex = personasArray.findIndex((p: any) => p.id === persona.id);
    if (currentIndex === -1 || currentIndex === personasArray.length - 1) return null;
    return personasArray[currentIndex + 1];
  };
  const nextPersona = getNextPersona();

  const isNextConversationCompleted = () => {
    if (!nextPersona) return false;
    return userConversations.some(
      (conv: any) => conv.scenarioId === scenario.id && conv.personaId === nextPersona.id && conv.status === 'completed'
    );
  };

  const createNextConversationMutation = useMutation({
    mutationFn: async () => {
      if (!nextPersona) throw new Error("NO_NEXT_PERSONA");
      const response = await apiRequest('POST', '/api/conversations', {
        scenarioId: scenario.id, personaId: nextPersona.id, maxTurns: 3,
      });
      if (!response.ok) throw new Error('CREATE_FAILED');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      window.location.href = `/chat/${data.id}`;
    },
    onError: (error) => {
      const errorKey = error.message === 'NO_NEXT_PERSONA' ? 'report.noNextPersonaError' : 'report.conversationCreateFailed';
      toast({ title: t('report.error', 'Error'), description: t(errorKey, 'Failed to create the next conversation.'), variant: "destructive" });
    }
  });

  const handleNextConversation = () => {
    if (!nextPersona) return;
    const existingConversation = userConversations.find(
      (conv: any) => conv.scenarioId === scenario.id && conv.personaId === nextPersona.id
    );
    if (existingConversation) window.location.href = `/chat/${existingConversation.id}`;
    else createNextConversationMutation.mutate();
  };

  const generateFeedbackMutation = useMutation({
    mutationFn: async (options?: { force?: boolean }) => {
      const response = await authFetchRaw(`/api/conversations/${conversationId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options?.force ? { force: true } : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/conversations", conversationId, "feedback"], data);
      onFeedbackGeneratingChange?.(false);
    },
    onError: (err) => {
      onFeedbackGeneratingChange?.(false);
      toast({ title: "오류", description: `피드백을 생성할 수 없습니다: ${(err as Error).message}`, variant: "destructive" });
    }
  });

  const handleGenerateFeedback = () => {
    setHasRequestedFeedback(true);
    onFeedbackGeneratingChange?.(true);
    generateFeedbackMutation.mutate(undefined);
  };

  const handleRegenerateFeedback = () => {
    onFeedbackGeneratingChange?.(true);
    generateFeedbackMutation.mutate({ force: true });
  };

  useEffect(() => {
    if (autoGenerateFeedback && !isLoading && !feedback && !hasRequestedFeedback && !generateFeedbackMutation.isPending && error?.message === "FEEDBACK_NOT_FOUND") {
      setHasRequestedFeedback(true);
      onFeedbackGeneratingChange?.(true);
      generateFeedbackMutation.mutate(undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateFeedback, isLoading, feedback, hasRequestedFeedback, error?.message, generateFeedbackMutation.isPending]);

  const getTranslatedDimensionName = (key: string | undefined, fallbackName: string) =>
    t(`evaluationDimensions.${key}.name`, { defaultValue: '' }) || fallbackName;

  const toggleCheckItem = (key: string) => {
    setCheckedItems(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(`checklist_${conversationId}`, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const buildPrintContent = () => {
    if (!feedback) return '';
    return generatePrintableContent({
      feedback,
      scenario,
      persona,
      conversationId,
      userName,
      getTranslatedDimensionName,
    });
  };

  const handleDownloadHtml = async () => {
    if (!feedback) return;
    setIsExportingPdf(true);
    const container = document.createElement('div');
    try {
      const printableContent = buildPrintContent();
      if (!printableContent?.trim()) throw new Error('보고서 콘텐츠가 비어 있습니다.');

      const safeFilename = scenario.title.replace(/[<>:"/\\|?*]/g, '_');
      const filename = `개발보고서_${safeFilename}_${new Date().toLocaleDateString('ko-KR').replace(/\./g, '-')}.pdf`;

      container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:white;padding:24px;';
      container.innerHTML = printableContent;
      document.body.appendChild(container);

      await document.fonts.load('400 16px "Noto Sans KR"').catch(() => {});
      await document.fonts.ready;

      const html2pdf = (await import('html2pdf.js')).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, letterRendering: true, allowTaint: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(container)
        .save();
      toast({ title: "PDF 다운로드 완료", description: `${filename} 파일이 저장되었습니다.` });
    } catch (err) {
      toast({ title: "PDF 생성 실패", description: err instanceof Error ? err.message : "PDF 생성 중 오류가 발생했습니다.", variant: "destructive" });
    } finally {
      if (container.parentNode) document.body.removeChild(container);
      setIsExportingPdf(false);
    }
  };

  const handlePrint = () => {
    if (!feedback) return;
    const printableContent = buildPrintContent();
    if (!printableContent?.trim()) {
      toast({ title: "인쇄 실패", description: "보고서 콘텐츠가 비어 있습니다.", variant: "destructive" });
      return;
    }
    const printWindow = window.open('', '_blank', 'width=900,height=800');
    if (!printWindow) {
      toast({ title: "팝업 차단됨", description: "브라우저에서 팝업을 허용해주세요.", variant: "destructive" });
      return;
    }
    printWindow.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(userName)} 맞춤 보고서</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet"><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Noto Sans KR',sans-serif;padding:30px;background:white;}</style></head><body><div class="no-print print-toolbar"><h1 class="print-toolbar-title">${escapeHtml(userName)}님 맞춤 보고서</h1><div><button onclick="window.print()" class="print-btn-primary">🖨️ 인쇄 / PDF 저장</button><button onclick="window.close()" class="print-btn-secondary">닫기</button></div></div>${printableContent}</body></html>`);
    printWindow.document.close();
    toast({ title: "인쇄 창 열림", description: "새 창에서 '인쇄/PDF 저장' 버튼을 클릭하세요." });
  };

  // --- Loading / error states ---
  if (isLoading || generateFeedbackMutation.isPending || (hasRequestedFeedback && !feedback)) {
    return (
      <div className="text-center py-16" data-testid="feedback-loading">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">{t('report.analyzing', '개인 맞춤 분석 중...')}</h2>
        <p className="text-slate-600">{t('report.analyzingDesc', 'AI가 대화를 심층 분석하여 맞춤형 개발 계획을 수립하고 있습니다.')}</p>
      </div>
    );
  }

  if (!feedback && !isLoading && !hasRequestedFeedback && error?.message === "FEEDBACK_NOT_FOUND") {
    return (
      <div className="text-center py-16" data-testid="feedback-not-found">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-clipboard-list text-blue-600 text-xl"></i>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">{t('report.notGenerated', '피드백이 아직 생성되지 않았습니다')}</h2>
        <p className="text-slate-600 mb-4">{t('report.notGeneratedDesc', '대화를 완료한 후 피드백을 생성할 수 있습니다.')}</p>
        {!isAdminView && (
          <div className="space-y-2">
            <Button onClick={handleGenerateFeedback} data-testid="generate-feedback" disabled={generateFeedbackMutation.isPending}>
              {generateFeedbackMutation.isPending ? t('report.generating', '피드백 생성 중...') : t('report.generate', '피드백 생성하기')}
            </Button>
            <Button variant="outline" onClick={() => window.location.href = '/mypage'} data-testid="back-to-mypage">
              {t('report.backToMyPage', '마이페이지로 돌아가기')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!feedback && error && error.message !== "FEEDBACK_NOT_FOUND") {
    return (
      <div className="text-center py-16" data-testid="feedback-error">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">{t('report.error', '오류가 발생했습니다')}</h2>
        <p className="text-slate-600 mb-4">{t('report.feedbackLoadError', '피드백을 불러오는 중 오류가 발생했습니다.')}</p>
        <div className="space-y-2">
          <Button onClick={() => refetch()} data-testid="refetch-feedback">{t('common.retry', '다시 시도')}</Button>
          {!isAdminView && <Button variant="outline" onClick={() => window.location.href = '/mypage'} data-testid="back-to-mypage">{t('report.backToMyPage', '마이페이지로 돌아가기')}</Button>}
        </div>
      </div>
    );
  }

  if (!feedback) {
    return (
      <div className="text-center py-16" data-testid="feedback-loading">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto mb-8"></div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">{t('report.analyzing', '개인 맞춤 분석 중...')}</h2>
        <p className="text-slate-600">{t('report.analyzingDesc', 'AI가 대화를 심층 분석하여 맞춤형 개발 계획을 수립하고 있습니다.')}</p>
      </div>
    );
  }

  const overallGrade = getOverallGrade(feedback.overallScore || 0);
  const displayOverallScore = Number(feedback.overallScore || 0).toFixed(1);
  const scores = feedback.scores || [];
  const maxScoreItem = scores.reduce((best: any, s: any) => (!best || s.score > best.score) ? s : best, null);
  const minScoreItem = scores.reduce((worst: any, s: any) => (!worst || s.score < worst.score) ? s : worst, null);
  const summary = feedback.detailedFeedback?.summary || feedback.detailedFeedback?.ranking || '';
  const topImprovement = feedback.detailedFeedback?.improvements?.[0] || '';

  return (
    <div ref={reportRef} className="max-w-6xl mx-auto space-y-6 print-report-container" data-testid="personal-development-report">

      {/* Header */}
      <div className="bg-gradient-to-r from-corporate-600 to-corporate-700 rounded-xl p-6 text-white screen-only" style={{ opacity: 0, animation: 'fadeInUp 0.8s ease-out forwards' }}>
        <div className="flex items-center justify-between mb-4">
          <div></div>
          {!isAdminView && (
            <Button onClick={() => window.location.href = '/mypage'} variant="ghost" size="sm" className="text-white/80 hover:text-white hover:bg-white/10" data-testid="mypage-button">
              <i className="fas fa-user mr-2"></i>{t('report.toMyPage', '마이페이지로')}
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div style={{ opacity: 0, animation: 'slideInRight 0.8s ease-out 0.3s forwards' }}>
            <h1 className="text-2xl font-bold mb-2" data-testid="report-title">{t('report.title', '{{name}}님 맞춤 보고서', { name: userName })}</h1>
            <p className="text-corporate-100">{t('report.scenario', '시나리오')} : {scenario.title}</p>
            <p className="text-corporate-100 text-sm mt-1">{t('report.conversationPartner', '대화 상대')} : {getPersonaFullInfo(persona)}</p>
          </div>
          <div className={`${overallGrade.bg} ${overallGrade.color} px-6 py-4 rounded-lg text-center min-w-[120px]`} style={{ opacity: 0, animation: 'fadeInUp 0.8s ease-out 0.6s forwards' }}>
            <div className="text-3xl font-bold" data-testid="overall-grade">{overallGrade.grade}</div>
            <div className="text-sm font-medium">{displayOverallScore}{t('report.points', '점')}</div>
            <div className="text-xs">{t('report.overallScore', '종합 점수')}</div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-white/80">
          <div className="flex flex-col gap-0.5"><span className="font-semibold text-white/60 uppercase tracking-wide">발행 일시</span><span>{feedback.createdAt ? new Date(feedback.createdAt).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR')}</span></div>
          <div className="flex flex-col gap-0.5"><span className="font-semibold text-white/60 uppercase tracking-wide">보고서 ID</span><span className="font-mono">{conversationId.slice(0, 8).toUpperCase()}</span></div>
          <div className="flex flex-col gap-0.5"><span className="font-semibold text-white/60 uppercase tracking-wide">난이도</span><span>{['', '입문', '기본', '심화', '전문가'][scenario.difficulty as number] || '기본'}</span></div>
          <div className="flex flex-col gap-0.5"><span className="font-semibold text-white/60 uppercase tracking-wide">대화 모드</span><span>{currentConversation?.mode === 'realtime_voice' ? '실시간 음성' : currentConversation?.mode === 'tts' ? 'TTS 음성' : '텍스트'}</span></div>
        </div>
        {scores.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/20">
            <p className="text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-2">역량별 점수 요약</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {feedback.scores.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] text-white/70 truncate w-24 flex-shrink-0">{getTranslatedDimensionName(s.category, s.name)}</span>
                  <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(toTenPoint(s.score ?? 0, (s as any).maxScore || 10) / 10) * 100}%`, backgroundColor: 'rgba(255,255,255,0.75)' }} />
                  </div>
                  <span className="text-[11px] font-bold text-white/90 w-5 text-right flex-shrink-0">{Number(toTenPoint(s.score ?? 0, (s as any).maxScore || 10)).toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Executive Summary */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-indigo-50 to-purple-50 screen-only" data-testid="executive-summary">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-indigo-800 flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs">★</span>
            이 보고서의 핵심 (Executive Summary)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl p-4 border border-indigo-100">
              <div className="text-xs font-bold text-indigo-600 mb-2 uppercase tracking-wide flex items-center gap-1"><i className="fas fa-align-left text-indigo-400"></i> 총평 요약</div>
              <p className="text-sm text-slate-700 leading-relaxed">{extractSentences(summary, 2) || '종합 평가를 확인하세요.'}</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-green-100">
              <div className="text-xs font-bold text-green-600 mb-2 uppercase tracking-wide flex items-center gap-1"><i className="fas fa-star text-green-400"></i> 핵심 강점</div>
              {maxScoreItem && (
                <>
                  <div className="text-lg font-bold text-green-700 mb-1">{getTranslatedDimensionName(maxScoreItem.category, maxScoreItem.name)}</div>
                  <div className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full mb-2">점수 {Number(toTenPoint(maxScoreItem.score, (maxScoreItem as any).maxScore || 10)).toFixed(1)}/10</div>
                  <p className="text-xs text-slate-600 leading-relaxed">{extractSentences(maxScoreItem.feedback, 2)}</p>
                </>
              )}
            </div>
            <div className="bg-white rounded-xl p-4 border border-orange-100">
              <div className="text-xs font-bold text-orange-600 mb-2 uppercase tracking-wide flex items-center gap-1"><i className="fas fa-bullseye text-orange-400"></i> 1순위 개선 과제</div>
              {minScoreItem && (
                <>
                  <div className="text-sm font-bold text-orange-700 mb-1">{getTranslatedDimensionName(minScoreItem.category, minScoreItem.name)}</div>
                  <div className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 text-xs font-semibold px-2 py-0.5 rounded-full mb-2">점수 {Number(toTenPoint(minScoreItem.score, (minScoreItem as any).maxScore || 10)).toFixed(1)}/10</div>
                </>
              )}
              <p className="text-xs text-slate-600 leading-relaxed">{extractSentences(topImprovement, 2) || '개선 포인트를 확인하세요.'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Time Analysis */}
      {feedback.detailedFeedback?.conversationDuration && (
        <Card className="mb-6 border-blue-200 bg-blue-50 screen-only">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-blue-800">
              <i className="fas fa-clock mr-2"></i>{t('report.timeAnalysis', '대화 시간 분석')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="bg-white rounded-lg p-4">
                <div className="text-2xl font-bold text-blue-600">
                  {Math.floor(feedback.detailedFeedback.conversationDuration / 60)}:{(feedback.detailedFeedback.conversationDuration % 60).toString().padStart(2, '0')}
                </div>
                <div className="text-sm text-slate-600">{t('report.totalDuration', '총 대화 시간')}</div>
              </div>
              {feedback.detailedFeedback.averageResponseTime && (
                <div className="bg-white rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-600">{feedback.detailedFeedback.averageResponseTime}초</div>
                  <div className="text-sm text-slate-600">{t('report.avgResponseTime', '평균 응답 시간')}</div>
                </div>
              )}
              {feedback.detailedFeedback.timePerformance && (
                <div className="bg-white rounded-lg p-4">
                  <div className={`text-lg font-medium ${feedback.detailedFeedback.timePerformance.rating === 'excellent' ? 'text-green-600' : feedback.detailedFeedback.timePerformance.rating === 'good' ? 'text-blue-600' : feedback.detailedFeedback.timePerformance.rating === 'average' ? 'text-yellow-600' : 'text-red-600'}`}>
                    {feedback.detailedFeedback.timePerformance.rating === 'excellent' ? '🎯 우수' : feedback.detailedFeedback.timePerformance.rating === 'good' ? '✅ 좋음' : feedback.detailedFeedback.timePerformance.rating === 'average' ? '🔶 보통' : '⚠️ 개선필요'}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">{feedback.detailedFeedback.timePerformance.feedback}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Report Tabs */}
      <Tabs value={activeReportTab} onValueChange={(val) => {
        if (val === "scores" && activeReportTab !== "scores") setScoreAnimKey(k => k + 1);
        setActiveReportTab(val);
      }} className="space-y-6">
        <TabsList className={`flex flex-wrap justify-center gap-1 sm:grid sm:w-full ${feedback.detailedFeedback?.sequenceAnalysis ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} screen-only h-auto p-1`} style={{ opacity: 0, animation: 'fadeInUp 0.6s ease-out 1s forwards' }}>
          <TabsTrigger value="scores" data-testid="tab-scores" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 whitespace-nowrap">{t('report.tabs.scores', '성과 분석')}</TabsTrigger>
          <TabsTrigger value="behavior" data-testid="tab-behavior" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 whitespace-nowrap">{t('report.tabs.practiceGuide', '실천 가이드')}</TabsTrigger>
          <TabsTrigger value="development" data-testid="tab-development" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 whitespace-nowrap">{t('report.tabs.development', '개발 계획')}</TabsTrigger>
          {feedback.detailedFeedback?.sequenceAnalysis && (
            <TabsTrigger value="strategy" data-testid="tab-strategy" className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 whitespace-nowrap">{t('report.tabs.strategy', '전략 평가')}</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="scores" className="space-y-6 print-show-all">
          <h2 className="print-section-title hidden print:block">📊 {t('report.tabs.scores', '성과 분석')}</h2>
          <ScoreOverview feedback={feedback} feedbackHistory={feedbackHistory} conversationId={conversationId} scoreAnimKey={scoreAnimKey} />
        </TabsContent>

        <TabsContent value="behavior" className="space-y-8 print-show-all">
          <PracticeGuidePanel feedback={feedback} />
        </TabsContent>

        <TabsContent value="development" className="space-y-6 print-show-all">
          <DevelopmentPlan feedback={feedback} conversationId={conversationId} checkedItems={checkedItems} onToggleCheck={toggleCheckItem} />
        </TabsContent>

        {feedback.detailedFeedback?.sequenceAnalysis && (
          <TabsContent value="strategy" className="space-y-6 print-show-all">
            <StrategyPanel feedback={feedback} />
          </TabsContent>
        )}
      </Tabs>

      {/* Desktop Action Buttons */}
      <div className="hidden md:flex justify-center flex-wrap gap-3 pt-6 border-t border-slate-200 no-print">
        {!isAdminView && <Button onClick={() => window.location.href = '/mypage'} variant="outline" className="min-w-[120px]" data-testid="back-to-mypage-button"><i className="fas fa-home mr-2"></i>{t('report.myPage', '마이페이지')}</Button>}
        {!isAdminView && hasMorePersonas && onNextPersona && <Button onClick={onNextPersona} className="min-w-[120px] bg-gradient-to-r from-green-600 to-emerald-600" data-testid="next-persona-button"><i className="fas fa-arrow-right mr-2"></i>{t('report.nextPersona', '다음 페르소나와 대화하기')}</Button>}
        {!isAdminView && allPersonasCompleted && onNextPersona && <Button onClick={onNextPersona} className="min-w-[120px] bg-gradient-to-r from-purple-600 to-indigo-600" data-testid="strategy-reflection-button"><i className="fas fa-clipboard-list mr-2"></i>{t('report.viewStrategyEvaluation', '전략 평가 보기')}</Button>}
        {!isAdminView && !hasMorePersonas && !allPersonasCompleted && nextPersona && !isNextConversationCompleted() && <Button onClick={handleNextConversation} className="min-w-[120px] bg-gradient-to-r from-blue-600 to-indigo-600" data-testid="next-persona-legacy-button" disabled={createNextConversationMutation.isPending}><i className="fas fa-arrow-right mr-2"></i>{createNextConversationMutation.isPending ? t('report.creating', '생성 중...') : t('report.nextConversationPartner', '다음 대화 상대: {{name}}', { name: nextPersona.name })}</Button>}
        {!isAdminView && <Button onClick={onSelectNewScenario} variant="outline" className="min-w-[120px]" data-testid="new-scenario-button"><i className="fas fa-redo mr-2"></i>{t('report.newTraining', '새로운 훈련')}</Button>}
        {!isAdminView && <Button onClick={onRetry} className="min-w-[120px]" data-testid="retry-scenario-button"><i className="fas fa-sync-alt mr-2"></i>{t('report.retryScenario', '같은 시나리오 재도전')}</Button>}
        <Button variant="secondary" onClick={handlePrint} className="min-w-[120px]" data-testid="print-report-button"><i className="fas fa-print mr-2"></i>{t('report.printReport', '보고서 인쇄')}</Button>
        <Button variant="outline" onClick={handleRegenerateFeedback} disabled={generateFeedbackMutation.isPending} className="min-w-[120px] text-orange-600 border-orange-300 hover:bg-orange-50" data-testid="regenerate-feedback-button">
          {generateFeedbackMutation.isPending ? <><i className="fas fa-spinner fa-spin mr-2"></i>{t('report.regenerating', '재생성 중...')}</> : <><i className="fas fa-redo-alt mr-2"></i>{t('report.regenerateFeedback', '피드백 재생성')}</>}
        </Button>
        <Button variant="outline" onClick={handleDownloadHtml} disabled={isExportingPdf} className="min-w-[120px]" data-testid="export-pdf-button">
          {isExportingPdf ? <><i className="fas fa-spinner fa-spin mr-2"></i>{t('report.downloading', '생성 중...')}</> : <><i className="fas fa-file-pdf mr-2"></i>{t('report.downloadPdf', 'PDF 다운로드')}</>}
        </Button>
      </div>

      {/* Mobile Action Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-50 no-print">
        {showMobileMenu && (
          <div className="p-3 border-b border-slate-100 bg-slate-50 animate-in slide-in-from-bottom duration-200">
            <div className="grid grid-cols-2 gap-2">
              {hasMorePersonas && onNextPersona && <Button onClick={() => { setShowMobileMenu(false); onNextPersona(); }} className="w-full text-sm bg-gradient-to-r from-green-600 to-emerald-600" data-testid="mobile-next-persona-button"><i className="fas fa-arrow-right mr-1"></i>{t('report.nextPersonaShort', '다음 페르소나')}</Button>}
              {allPersonasCompleted && onNextPersona && <Button onClick={() => { setShowMobileMenu(false); onNextPersona(); }} className="w-full text-sm bg-gradient-to-r from-purple-600 to-indigo-600" data-testid="mobile-strategy-button"><i className="fas fa-clipboard-list mr-1"></i>{t('report.tabs.strategy', '전략 평가')}</Button>}
              {!hasMorePersonas && !allPersonasCompleted && nextPersona && !isNextConversationCompleted() && <Button onClick={() => { setShowMobileMenu(false); handleNextConversation(); }} className="w-full text-sm bg-gradient-to-r from-blue-600 to-indigo-600" disabled={createNextConversationMutation.isPending} data-testid="mobile-next-legacy-button"><i className="fas fa-arrow-right mr-1"></i>{t('report.nextConversationShort', '다음 대화')}</Button>}
              <Button onClick={() => { setShowMobileMenu(false); onSelectNewScenario(); }} variant="outline" className="w-full text-sm" data-testid="mobile-new-scenario-button"><i className="fas fa-redo mr-1"></i>{t('report.newTrainingShort', '새 훈련')}</Button>
              <Button onClick={() => { setShowMobileMenu(false); onRetry(); }} className="w-full text-sm" data-testid="mobile-retry-button"><i className="fas fa-sync-alt mr-1"></i>{t('report.retryShort', '재도전')}</Button>
              <Button variant="secondary" onClick={() => { setShowMobileMenu(false); handlePrint(); }} className="w-full text-sm" data-testid="mobile-print-button"><i className="fas fa-print mr-1"></i>{t('report.print', '인쇄')}</Button>
              <Button variant="outline" onClick={() => { setShowMobileMenu(false); handleRegenerateFeedback(); }} disabled={generateFeedbackMutation.isPending} className="w-full text-sm text-orange-600 border-orange-300" data-testid="mobile-regenerate-button"><i className="fas fa-redo-alt mr-1"></i>{t('report.regenerateFeedback', '피드백 재생성')}</Button>
              <Button variant="outline" onClick={() => { setShowMobileMenu(false); handleDownloadHtml(); }} disabled={isExportingPdf} className="w-full text-sm" data-testid="mobile-download-button"><i className="fas fa-file-pdf mr-1"></i>{t('report.downloadPdf', 'PDF 다운로드')}</Button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between p-3">
          {!isAdminView && <Button onClick={() => window.location.href = '/mypage'} variant="outline" className="flex-1 mr-2" data-testid="mobile-mypage-button"><i className="fas fa-home mr-2"></i>{t('report.myPage', '마이페이지')}</Button>}
          <Button onClick={() => setShowMobileMenu(!showMobileMenu)} className={`flex-1 ${showMobileMenu ? 'bg-slate-600' : 'bg-indigo-600'}`} data-testid="mobile-menu-toggle">
            <i className={`fas ${showMobileMenu ? 'fa-times' : 'fa-th-large'} mr-2`}></i>
            {showMobileMenu ? t('report.close', '닫기') : t('report.more', '더보기')}
          </Button>
        </div>
      </div>
      <div className="md:hidden h-20"></div>
    </div>
  );
}
