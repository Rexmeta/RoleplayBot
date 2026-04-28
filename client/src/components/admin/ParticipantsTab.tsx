import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";
import { Download, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Participant } from "./adminTypes";

interface ParticipantsTabProps {
  participantsData: { participants: Participant[] } | undefined;
  participantsLoading: boolean;
}

const buildReportHtml = (r: any): string => {
  const safe = (v: any): string => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const df = r.detailedFeedback || {};
  const scores: any[] = Array.isArray(r.scores) ? r.scores : [];
  const behaviorGuides: any[] = Array.isArray(df.behaviorGuides) ? df.behaviorGuides : [];
  const conversationGuides: any[] = Array.isArray(df.conversationGuides) ? df.conversationGuides : [];
  const developmentPlan: any = df.developmentPlan || null;
  const sequenceAnalysis: any = df.sequenceAnalysis || null;
  const now = new Date().toLocaleDateString('ko-KR');

  const overallScore = Number(r.overallScore ?? 0);
  const grade = overallScore >= 90 ? { letter: 'S', color: '#7c3aed' }
    : overallScore >= 80 ? { letter: 'A', color: '#16a34a' }
    : overallScore >= 70 ? { letter: 'B', color: '#2563eb' }
    : overallScore >= 60 ? { letter: 'C', color: '#d97706' }
    : { letter: 'D', color: '#dc2626' };

  const p: string[] = [];
  p.push('<!DOCTYPE html><html lang="ko"><head>');
  p.push('<meta charset="UTF-8"><meta name="color-scheme" content="light only">');
  p.push('<meta name="viewport" content="width=device-width,initial-scale=1.0">');
  p.push('<title>' + safe(r.user?.name) + ' 피드백 리포트 - ' + safe(r.scenarioTitle) + '</title>');
  p.push('<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">');
  p.push('<style>');
  p.push('*{box-sizing:border-box;margin:0;padding:0;}html,body{background:#f8fafc;color:#1e293b;}');
  p.push('body{font-family:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;padding:40px 20px;max-width:900px;margin:0 auto;}');
  p.push('.print-tip{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;padding:16px 24px;border-radius:10px;margin-bottom:28px;display:flex;align-items:center;justify-content:space-between;}');
  p.push('.print-tip p{font-size:13px;opacity:.9;}.print-tip button{background:#fff;color:#4f46e5;border:none;padding:8px 18px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;}');
  p.push('.hdr{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;padding:24px 28px;border-radius:12px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;}');
  p.push('.hdr h1{font-size:22px;font-weight:700;margin-bottom:4px;}.hdr .sub{font-size:13px;opacity:.8;margin-bottom:2px;}');
  p.push('.grade-box{background:#fff;border-radius:8px;padding:12px 20px;text-align:center;min-width:80px;}');
  p.push('.grade-letter{font-size:36px;font-weight:900;line-height:1;}.grade-score{font-size:13px;color:#4b5563;margin-top:2px;}');
  p.push('.sec{background:#fff;border-radius:10px;padding:22px 26px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.07);}');
  p.push('.sec-title{font-size:18px;font-weight:700;color:#1f2937;border-bottom:2px solid #4f46e5;padding-bottom:8px;margin-bottom:16px;}');
  p.push('.score-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px;}');
  p.push('.score-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;}');
  p.push('.score-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}');
  p.push('.score-name{font-size:13px;font-weight:600;color:#374151;}.score-badge{background:#dbeafe;color:#1e40af;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:600;}');
  p.push('.score-bar-bg{height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-bottom:6px;}');
  p.push('.score-bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#3b82f6,#6366f1);}');
  p.push('.score-fb{font-size:12px;color:#6b7280;line-height:1.5;}');
  p.push('.tri-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}');
  p.push('.list-item{font-size:13px;color:#4b5563;margin-bottom:5px;line-height:1.5;}');
  p.push('.expert-box{border-top:1px solid #e2e8f0;padding-top:14px;margin-top:14px;font-size:13px;color:#374151;line-height:1.6;}');
  p.push('.guide-card{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-bottom:12px;}');
  p.push('.guide-card-teal{background:#f0fdfa;border:1px solid #99f6e4;}');
  p.push('.eg-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:10px 0;}');
  p.push('.eg-good{background:#dcfce7;border:1px solid #86efac;padding:10px;border-radius:4px;}');
  p.push('.eg-bad{background:#fef2f2;border:1px solid #fecaca;padding:10px;border-radius:4px;}');
  p.push('.dev-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}');
  p.push('@media print{.print-tip{display:none!important;}body{background:#fff;padding:20px;}}');
  p.push('</style></head><body>');

  p.push('<div class="print-tip"><p>이 파일을 PDF로 저장하려면 Ctrl+P (Mac: Cmd+P)를 누르세요.</p><button onclick="window.print()">인쇄 / PDF 저장</button></div>');
  p.push('<div class="hdr"><div>');
  p.push('<h1>' + safe(r.user?.name) + '님 피드백 리포트</h1>');
  p.push('<div class="sub">시나리오: ' + safe(r.scenarioTitle) + '</div>');
  p.push('<div class="sub">대화 상대: ' + safe(r.personaName) + '</div>');
  p.push('<div style="font-size:12px;opacity:.7;margin-top:6px;">완료일: ' + (r.completedAt ? new Date(r.completedAt).toLocaleDateString('ko-KR') : '-') + ' · 생성: ' + now + '</div>');
  p.push('</div><div class="grade-box">');
  p.push('<div class="grade-letter" style="color:' + grade.color + ';">' + grade.letter + '</div>');
  p.push('<div class="grade-score">' + overallScore.toFixed(1) + '점</div></div></div>');

  if (df.evaluationCriteriaSetName) {
    p.push('<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#4338ca;">📋 평가 기준: ' + safe(df.evaluationCriteriaSetName) + '</div>');
  }
  if (df.conversationDuration) {
    const dur = Number(df.conversationDuration);
    const timeRating = df.timePerformance;
    p.push('<div class="sec"><div class="sec-title">⏱️ 대화 시간 분석</div>');
    p.push('<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">');
    p.push('<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px;text-align:center;">');
    p.push('<div style="font-size:22px;font-weight:700;color:#0284c7;">' + Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0') + '</div>');
    p.push('<div style="font-size:12px;color:#0369a1;">총 대화 시간</div></div>');
    if (df.averageResponseTime) {
      p.push('<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;text-align:center;">');
      p.push('<div style="font-size:22px;font-weight:700;color:#16a34a;">' + df.averageResponseTime + '초</div>');
      p.push('<div style="font-size:12px;color:#15803d;">평균 응답 시간</div></div>');
    }
    if (timeRating) {
      const rtColor = timeRating.rating === 'excellent' ? '#16a34a' : timeRating.rating === 'good' ? '#2563eb' : timeRating.rating === 'average' ? '#d97706' : '#dc2626';
      const rtLabel = timeRating.rating === 'excellent' ? '🎯 우수' : timeRating.rating === 'good' ? '✅ 좋음' : timeRating.rating === 'average' ? '🔶 보통' : '⚠️ 개선필요';
      p.push('<div style="background:#fff7ed;border:1px solid #ffedd5;border-radius:8px;padding:14px;text-align:center;">');
      p.push('<div style="font-size:16px;font-weight:600;color:' + rtColor + ';">' + rtLabel + '</div>');
      p.push('<div style="font-size:11px;color:#9a3412;margin-top:4px;">' + safe(timeRating.feedback) + '</div></div>');
    }
    p.push('</div></div>');
  }
  if (scores.length > 0) {
    p.push('<div class="sec"><div class="sec-title">📊 성과 분석</div><div class="score-grid">');
    scores.forEach((s: any) => {
      const val = Number(s.score ?? 0);
      const pct = Math.round((val / 10) * 100);
      p.push('<div class="score-card"><div class="score-header">');
      p.push('<span class="score-name">' + safe(s.icon || '') + ' ' + safe(s.name || s.category || '') + (s.weight ? ' <span style="font-weight:400;color:#94a3b8;font-size:11px;">(' + s.weight + '%)</span>' : '') + '</span>');
      p.push('<span class="score-badge">' + val.toFixed(1) + '/10</span></div>');
      p.push('<div class="score-bar-bg"><div class="score-bar-fill" style="width:' + pct + '%;"></div></div>');
      if (s.feedback) p.push('<div class="score-fb">' + safe(s.feedback) + '</div>');
      p.push('</div>');
    });
    p.push('</div>');
    const strengths: string[] = Array.isArray(df.strengths) ? df.strengths : [];
    const improvements: string[] = Array.isArray(df.improvements) ? df.improvements : [];
    const nextSteps: string[] = Array.isArray(df.nextSteps) ? df.nextSteps : [];
    if (strengths.length || improvements.length || nextSteps.length) {
      p.push('<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px;">');
      p.push('<div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:14px;">📈 종합 평가</div><div class="tri-grid">');
      p.push('<div><div style="font-size:13px;font-weight:600;color:#16a34a;margin-bottom:8px;">✅ 주요 강점</div>');
      strengths.forEach(s => p.push('<div class="list-item">• ' + safe(s) + '</div>'));
      p.push('</div><div><div style="font-size:13px;font-weight:600;color:#ea580c;margin-bottom:8px;">⬆️ 개선 포인트</div>');
      improvements.forEach(s => p.push('<div class="list-item">• ' + safe(s) + '</div>'));
      p.push('</div><div><div style="font-size:13px;font-weight:600;color:#2563eb;margin-bottom:8px;">➡️ 다음 단계</div>');
      nextSteps.forEach(s => p.push('<div class="list-item">• ' + safe(s) + '</div>'));
      p.push('</div></div>');
      if (df.ranking) p.push('<div class="expert-box"><strong>전문가 의견:</strong> ' + safe(df.ranking) + '</div>');
      p.push('</div>');
    }
    p.push('</div>');
  }
  if (df.summary) {
    p.push('<div class="sec"><div class="sec-title">💬 종합 피드백 요약</div>');
    p.push('<div style="background:#f0f9ff;border-left:4px solid #3b82f6;border-radius:0 6px 6px 0;padding:14px 16px;font-size:13px;line-height:1.8;color:#334155;">' + safe(df.summary) + '</div></div>');
  }
  if (behaviorGuides.length > 0) {
    p.push('<div class="sec"><div class="sec-title">🎯 행동 가이드</div>');
    behaviorGuides.forEach((g: any) => {
      p.push('<div class="guide-card"><div style="font-size:15px;font-weight:600;color:#92400e;margin-bottom:10px;">💡 ' + safe(g.situation) + '</div>');
      p.push('<div style="margin-bottom:8px;"><div style="font-size:13px;font-weight:600;color:#4f46e5;margin-bottom:4px;">권장 행동</div>');
      p.push('<div style="font-size:13px;color:#374151;background:#f0f9ff;padding:8px;border-radius:4px;">' + safe(g.action) + '</div></div>');
      if (g.example) {
        p.push('<div style="margin-bottom:8px;"><div style="font-size:13px;font-weight:600;color:#16a34a;margin-bottom:4px;">구체적 예시</div>');
        p.push('<div style="font-size:13px;color:#166534;background:#dcfce7;padding:8px;border-radius:4px;font-style:italic;">"' + safe(g.example) + '"</div></div>');
      }
      if (g.impact) {
        p.push('<div><div style="font-size:13px;font-weight:600;color:#2563eb;margin-bottom:4px;">기대 효과</div>');
        p.push('<div style="font-size:13px;color:#374151;">' + safe(g.impact) + '</div></div>');
      }
      p.push('</div>');
    });
    p.push('</div>');
  }
  if (conversationGuides.length > 0) {
    p.push('<div class="sec"><div class="sec-title">💬 대화 가이드</div>');
    conversationGuides.forEach((g: any) => {
      p.push('<div class="guide-card guide-card-teal">');
      p.push('<div style="font-size:15px;font-weight:600;color:#0f766e;margin-bottom:10px;">💭 ' + safe(g.scenario) + '</div>');
      p.push('<div class="eg-grid">');
      p.push('<div class="eg-good"><div style="font-size:12px;font-weight:600;color:#16a34a;margin-bottom:4px;">✅ 좋은 예시</div><div style="font-size:12px;color:#166534;">' + safe(g.goodExample) + '</div></div>');
      p.push('<div class="eg-bad"><div style="font-size:12px;font-weight:600;color:#dc2626;margin-bottom:4px;">❌ 피해야 할 예시</div><div style="font-size:12px;color:#991b1b;">' + safe(g.badExample) + '</div></div>');
      p.push('</div>');
      if (Array.isArray(g.keyPoints) && g.keyPoints.length > 0) {
        p.push('<div style="font-size:12px;font-weight:600;color:#4f46e5;margin-bottom:4px;">🔑 핵심 포인트</div>');
        p.push('<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;">');
        g.keyPoints.forEach((pt: string) => p.push('<div style="font-size:12px;color:#4b5563;">• ' + safe(pt) + '</div>'));
        p.push('</div>');
      }
      p.push('</div>');
    });
    p.push('</div>');
  }
  if (developmentPlan) {
    p.push('<div class="sec"><div class="sec-title">📈 개발 계획</div><div class="dev-grid">');
    const planSections = [
      { key: 'shortTerm', label: '📅 단기 목표 (1-2주)', bg: '#f0fdf4', border: '#22c55e', hColor: '#16a34a', measBg: '#dcfce7', measColor: '#166534' },
      { key: 'mediumTerm', label: '📆 중기 목표 (1-2개월)', bg: '#eff6ff', border: '#3b82f6', hColor: '#2563eb', measBg: '#dbeafe', measColor: '#1e40af' },
      { key: 'longTerm', label: '🗓️ 장기 목표 (3-6개월)', bg: '#faf5ff', border: '#a855f7', hColor: '#7c3aed', measBg: '#f3e8ff', measColor: '#6b21a8' },
    ];
    planSections.forEach(ps => {
      const items: any[] = Array.isArray(developmentPlan[ps.key]) ? developmentPlan[ps.key] : [];
      p.push('<div style="background:' + ps.bg + ';border-left:4px solid ' + ps.border + ';padding:14px;border-radius:0 8px 8px 0;">');
      p.push('<div style="font-size:14px;font-weight:600;color:' + ps.hColor + ';margin-bottom:10px;">' + ps.label + '</div>');
      items.forEach(item => {
        p.push('<div style="background:#fff;padding:10px;border-radius:4px;margin-bottom:8px;">');
        p.push('<div style="font-size:13px;font-weight:600;color:' + ps.hColor + ';margin-bottom:6px;">' + safe(item.goal) + '</div>');
        (Array.isArray(item.actions) ? item.actions : []).forEach((a: string) =>
          p.push('<div style="font-size:12px;color:#4b5563;">→ ' + safe(a) + '</div>')
        );
        if (item.measurable) p.push('<div style="font-size:11px;background:' + ps.measBg + ';padding:3px 8px;border-radius:4px;color:' + ps.measColor + ';margin-top:6px;">측정지표: ' + safe(item.measurable) + '</div>');
        p.push('</div>');
      });
      p.push('</div>');
    });
    p.push('</div>');
    const resources: string[] = Array.isArray(developmentPlan.recommendedResources) ? developmentPlan.recommendedResources : [];
    if (resources.length > 0) {
      p.push('<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-top:14px;">');
      p.push('<div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:10px;">📚 추천 학습 자료</div>');
      p.push('<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">');
      resources.forEach(res => p.push('<div style="background:#fff;padding:8px 12px;border-radius:4px;font-size:13px;color:#4b5563;">📖 ' + safe(res) + '</div>'));
      p.push('</div></div>');
    }
    p.push('</div>');
  }
  if (sequenceAnalysis) {
    p.push('<div class="sec"><div class="sec-title">🎮 전략 평가</div>');
    p.push('<div style="background:#fdf4ff;border-left:4px solid #a855f7;padding:18px;border-radius:0 8px 8px 0;">');
    p.push('<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">');
    p.push('<span style="font-size:15px;font-weight:600;color:#7c3aed;">전략 점수</span>');
    p.push('<span style="background:#e9d5ff;color:#7c3aed;padding:6px 14px;border-radius:8px;font-size:17px;font-weight:700;">' + safe(String(sequenceAnalysis.strategicScore ?? '평가 대기중')) + '</span>');
    p.push('</div>');
    if (sequenceAnalysis.strategicRationale) p.push('<div style="font-size:13px;color:#6b21a8;margin-bottom:12px;">' + safe(sequenceAnalysis.strategicRationale) + '</div>');
    if (sequenceAnalysis.sequenceEffectiveness) {
      p.push('<div style="font-size:13px;font-weight:600;color:#2563eb;margin-bottom:4px;">🎯 순서 선택의 효과성</div>');
      p.push('<div style="font-size:13px;color:#374151;background:#fff;padding:10px;border-radius:4px;margin-bottom:12px;">' + safe(sequenceAnalysis.sequenceEffectiveness) + '</div>');
    }
    if (sequenceAnalysis.strategicInsights) {
      p.push('<div style="font-size:13px;font-weight:600;color:#eab308;margin-bottom:4px;">💡 전략적 통찰</div>');
      p.push('<div style="font-size:13px;color:#374151;background:#fef9c3;padding:10px;border-radius:4px;border-left:4px solid #eab308;margin-bottom:12px;">' + safe(sequenceAnalysis.strategicInsights) + '</div>');
    }
    const altApproaches: string[] = Array.isArray(sequenceAnalysis.alternativeApproaches) ? sequenceAnalysis.alternativeApproaches : [];
    if (altApproaches.length > 0) {
      p.push('<div style="font-size:13px;font-weight:600;color:#16a34a;margin-bottom:6px;">🛤️ 대안적 접근법</div>');
      altApproaches.forEach((a, i) => {
        p.push('<div style="display:flex;align-items:flex-start;gap:8px;background:#dcfce7;padding:10px;border-radius:4px;margin-bottom:6px;">');
        p.push('<span style="background:#22c55e;color:#fff;padding:2px 7px;border-radius:4px;font-size:12px;">' + (i + 1) + '</span>');
        p.push('<div style="font-size:13px;color:#166534;">' + safe(a) + '</div></div>');
      });
    }
    p.push('</div></div>');
  }
  p.push('<div style="text-align:center;padding-top:20px;border-top:1px solid #e2e8f0;color:#9ca3af;font-size:12px;margin-top:20px;">');
  p.push('생성일: ' + now + ' · AI 기반 개인 맞춤 피드백 리포트</div>');
  p.push('</body></html>');
  return p.join('\n');
};

const triggerDownload = (html: string, filename: string) => {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
};

export function ParticipantsTab({ participantsData, participantsLoading }: ParticipantsTabProps) {
  const { toast } = useToast();
  const [participantSearch, setParticipantSearch] = useState('');
  const [participantDateFrom, setParticipantDateFrom] = useState('');
  const [participantDateTo, setParticipantDateTo] = useState('');
  const [participantSortKey, setParticipantSortKey] = useState<keyof Participant>('lastTrainingAt');
  const [participantSortAsc, setParticipantSortAsc] = useState(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  const handleBulkDownload = async () => {
    if (selectedParticipantIds.size === 0) return;
    setIsBulkDownloading(true);
    try {
      const token = localStorage.getItem('authToken');
      const resp = await fetch('/api/admin/bulk-feedback-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
        body: JSON.stringify({ userIds: Array.from(selectedParticipantIds) }),
      });
      if (!resp.ok) throw new Error('서버 오류');
      const { results } = await resp.json();
      if (!results || results.length === 0) {
        toast({ title: '다운로드 불가', description: '완료된 피드백 리포트가 없습니다.', variant: 'destructive' });
        return;
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const html = buildReportHtml(r);
        const safeName = String(r.user?.name ?? 'unknown').replace(/[^a-zA-Z0-9가-힣]/g, '_');
        await new Promise<void>(resolve => setTimeout(() => { triggerDownload(html, '피드백리포트_' + safeName + '_' + dateStr + '.html'); resolve(); }, i * 400));
      }
      toast({ title: '다운로드 완료', description: results.length + '명의 피드백 리포트가 다운로드되었습니다.' });
    } catch (err) {
      console.error(err);
      toast({ title: '다운로드 실패', description: '피드백 리포트를 가져오는 중 오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setIsBulkDownloading(false);
    }
  };

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
    if (typeof av === 'string' && typeof bv === 'string') return participantSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    if (typeof av === 'number' && typeof bv === 'number') return participantSortAsc ? av - bv : bv - av;
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

  return (
    <Card className="card-enhanced">
      <CardHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h3 className="text-lg font-semibold text-slate-800">참석자 관리</h3>
            <Input
              placeholder="이름 또는 이메일 검색..."
              value={participantSearch}
              onChange={e => setParticipantSearch(e.target.value)}
              className="w-full md:w-56 h-9 text-sm"
              data-testid="participant-search"
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
            <span className="text-sm text-slate-500 font-medium whitespace-nowrap">최근 훈련일:</span>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-wrap w-full sm:w-auto">
              <Input
                type="date"
                value={participantDateFrom}
                onChange={e => setParticipantDateFrom(e.target.value)}
                className="h-9 text-sm w-full sm:w-40"
                data-testid="participant-date-from"
              />
              <span className="text-slate-400 text-sm hidden sm:inline">~</span>
              <Input
                type="date"
                value={participantDateTo}
                onChange={e => setParticipantDateTo(e.target.value)}
                className="h-9 text-sm w-full sm:w-40"
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
        ) : (
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
                          if (checked) setSelectedParticipantIds(new Set(sorted.map(p => p.userId)));
                          else setSelectedParticipantIds(new Set());
                        }}
                        aria-label="전체 선택"
                      />
                    </th>
                    <th className="p-3 text-left font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('name')}>
                      이름 <SortIcon col="name" />
                    </th>
                    <th className="p-3 text-left font-medium text-slate-600 cursor-pointer hover:text-slate-800 hidden md:table-cell" onClick={() => handleSort('email')}>
                      이메일 <SortIcon col="email" />
                    </th>
                    <th className="p-3 text-left font-medium text-slate-600 hidden md:table-cell">카테고리</th>
                    <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('completedSessions')}>
                      완료 세션 <SortIcon col="completedSessions" />
                    </th>
                    <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800" onClick={() => handleSort('averageScore')}>
                      평균 점수 <SortIcon col="averageScore" />
                    </th>
                    <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800 hidden sm:table-cell" onClick={() => handleSort('latestScore')}>
                      최근 점수 <SortIcon col="latestScore" />
                    </th>
                    <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800 hidden sm:table-cell" onClick={() => handleSort('lastTrainingAt')}>
                      최근 훈련일 <SortIcon col="lastTrainingAt" />
                    </th>
                    <th className="p-3 text-center font-medium text-slate-600 cursor-pointer hover:text-slate-800 hidden md:table-cell" onClick={() => handleSort('tier')}>
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
                            if (checked) next.add(p.userId); else next.delete(p.userId);
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
                      <td className="p-3 text-slate-500 text-xs hidden md:table-cell">{p.email}</td>
                      <td className="p-3 hidden md:table-cell">
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
                        {p.averageScore !== null ? `${Number(p.averageScore).toFixed(1)}점` : '-'}
                      </td>
                      <td className={`p-3 text-center hidden sm:table-cell ${scoreColor(p.latestScore)}`}>
                        {p.latestScore !== null ? `${Number(p.latestScore).toFixed(1)}점` : '-'}
                      </td>
                      <td className="p-3 text-center text-slate-500 text-xs hidden sm:table-cell">
                        {p.lastTrainingAt
                          ? new Date(p.lastTrainingAt).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
                          : '-'}
                      </td>
                      <td className="p-3 text-center hidden md:table-cell">
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
        )}
      </CardContent>
    </Card>
  );
}
