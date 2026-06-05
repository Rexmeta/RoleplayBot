import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { ComplexScenario } from '@/lib/scenario-system';
import { flowGraphSchema, personaSwitchRulesSchema, evaluationHarnessSchema, terminationRulesSchema, simulationHarnessSchema, playerConstraintsSchema, difficultyProfileSchema, analyticsSpecSchema, TRACKED_METRICS, REPORT_SECTIONS } from '@shared/schema/scenarios';
import type { TrackedMetricKey, ReportSectionKey } from '@shared/schema/scenarios';
import type { EvaluationHarness, TerminationRules, TerminationConditionGroup } from '@shared/schema/scenarios';
import { toMediaUrl } from '@/lib/mediaUrl';
import { Loader2, MoreVertical, ChevronDown, ChevronUp, Clock, Users, Target, Languages, Search, Sparkles, Eye, Copy, Download, Upload, ImageOff, UserX, ListX, BarChart2, Star, Folder } from 'lucide-react';
import { AIScenarioGenerator } from './AIScenarioGenerator';
import { ScenarioTranslationEditor } from './ScenarioTranslationEditor';
import { ScenarioVersionHistory } from './ScenarioVersionHistory';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ScenarioPersona {
  id: string;
  name: string;
  gender: 'male' | 'female'; // 성별 필드 추가
  mbti: string; // MBTI 필드 추가
  department: string;
  position: string;
  experience: string;
  personaRef: string;
  stance: string;
  goal: string;
  tradeoff: string;
  isPrimary?: boolean;
  voiceId?: string;
  entryLine?: string;
  triggerHints?: string[];
}

interface ScenarioFormData {
  title: string;
  description: string;
  difficulty: number;
  estimatedTime: string;
  skills: string[];
  theme?: string;
  industry?: string;
  categoryId?: string; // 카테고리 ID 필드 추가
  evaluationCriteriaSetId?: string; // 평가 기준 세트 ID 필드 추가
  image?: string; // 시나리오 이미지 URL 필드 추가
  imagePrompt?: string; // 이미지 생성 프롬프트 필드 추가
  introVideoUrl?: string; // 인트로 비디오 URL 필드 추가
  introVideoMode?: 'none' | 'default' | 'custom'; // 인트로 비디오 모드
  videoPrompt?: string; // 비디오 생성 프롬프트 필드 추가
  objectiveType?: string; // 목표 유형 추가
  targetDurationMinutes?: number; // 시나리오별 목표 대화 시간(분)
  targetTurns?: number; // 시나리오별 목표 턴 수
  minValidTurns?: number; // 최소 유효 턴 수
  isDemo?: boolean; // 게스트 데모용 시나리오 여부
  isPublic?: boolean; // 공개 여부
  autoTranslate?: boolean; // AI 자동 번역 여부
  storeListed?: boolean;
  storePriceUsd?: number | null;
  storePackId?: string | null;
  personaSwitchMode?: 'replace' | 'join'; // 다중 페르소나 전환 방식
  context: {
    situation: string;
    timeline: string;
    stakes: string;
    playerRole: {
      position: string;
      department: string;
      experience: string;
      responsibility: string;
    };
  };
  objectives: string[];
  successCriteria: {
    optimal: string;
    good: string;
    acceptable: string;
    failure: string;
  };
  personas: ScenarioPersona[];
  recommendedFlow: string[];
  flowGraph?: any;
  personaSwitchRules?: any;
  simulationHarness?: any;
}

interface ScenarioManagerProps {
  onGoToPersonas?: () => void;
}

const HARNESS_ALL_INCIDENT_TYPES = [
  'executive_join', 'customer_escalation', 'deadline_pressure',
  'new_evidence', 'competitor_offer', 'policy_constraint',
  'quality_issue', 'manager_interrupt', 'budget_cut', 'compliance_warning',
] as const;

const OPERATOR_LABELS: Record<string, string> = {
  gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=',
};

const DIMENSION_LABELS: Record<string, string> = {
  clarity: 'Clarity', empathy: 'Empathy', logic: 'Logic',
  ownership: 'Ownership', actionPlan: 'Action Plan',
};

function ConditionGroupSummary({ group, label }: { group: TerminationConditionGroup; label: string }) {
  const items: string[] = [];
  if (group.npcEmotions) {
    for (const [emotion, cond] of Object.entries(group.npcEmotions)) {
      if (cond) items.push(`NPC ${emotion} ${OPERATOR_LABELS[cond.operator] ?? cond.operator} ${cond.value}`);
    }
  }
  if (group.currentScore) {
    items.push(`Score ${OPERATOR_LABELS[group.currentScore.operator] ?? group.currentScore.operator} ${group.currentScore.value}`);
  }
  if (group.stage) items.push(`Stage = "${group.stage}"`);
  if (group.totalTurns) {
    items.push(`Total turns ${OPERATOR_LABELS[group.totalTurns.operator] ?? group.totalTurns.operator} ${group.totalTurns.value}`);
  }
  if (group.consecutiveTurnsBelow) {
    items.push(`${group.consecutiveTurnsBelow.turns} consecutive turns below score ${group.consecutiveTurnsBelow.scoreThreshold}`);
  }
  if (items.length === 0) return null;
  const logic = group.logic === 'any' ? 'ANY' : 'ALL';
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div className="flex flex-wrap gap-1 mt-0.5">
        {items.map((item, i) => (
          <Badge key={i} variant="outline" className="text-xs font-mono px-1.5 py-0">{item}</Badge>
        ))}
        {items.length > 1 && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0">{logic}</Badge>
        )}
      </div>
    </div>
  );
}

function EvaluationHarnessPreview({ json }: { json: string }) {
  if (!json.trim()) return null;
  let parsed: EvaluationHarness;
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    parsed = raw as EvaluationHarness;
  } catch { return null; }
  const hasDimensions = parsed.dimensions && parsed.dimensions.length > 0;
  const hasPassingRule = parsed.passingRule != null;
  if (!hasDimensions && !hasPassingRule) return null;
  return (
    <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 space-y-2 mb-2">
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Preview</p>
      {hasDimensions && (
        <div>
          <p className="text-xs text-slate-500 mb-1">Dimension weights</p>
          <div className="flex flex-wrap gap-1.5">
            {parsed.dimensions!.map((d) => (
              <span key={d.key} className="inline-flex items-center gap-1 rounded bg-white border border-blue-200 px-2 py-0.5 text-xs">
                <span className="font-medium text-slate-700">{DIMENSION_LABELS[d.key] ?? d.key}</span>
                <span className="text-blue-600 font-bold">×{d.weight}</span>
              </span>
            ))}
          </div>
          {parsed.dimensions!.some(d => d.scenarioSpecificDefinition) && (
            <div className="mt-1.5 space-y-1">
              {parsed.dimensions!.filter(d => d.scenarioSpecificDefinition).map(d => (
                <p key={d.key} className="text-xs text-slate-500 italic">
                  <span className="font-medium not-italic text-slate-600">{DIMENSION_LABELS[d.key] ?? d.key}:</span>{' '}
                  {d.scenarioSpecificDefinition}
                </p>
              ))}
            </div>
          )}
          {parsed.dimensions!.some(d => (d.positiveSignals?.length ?? 0) + (d.negativeSignals?.length ?? 0) > 0) && (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs text-slate-500">Custom signals</p>
              {parsed.dimensions!.filter(d => (d.positiveSignals?.length ?? 0) + (d.negativeSignals?.length ?? 0) > 0).map(d => (
                <div key={d.key} className="space-y-0.5">
                  <p className="text-xs font-medium text-slate-600">{DIMENSION_LABELS[d.key] ?? d.key}</p>
                  <div className="flex flex-wrap gap-1">
                    {d.positiveSignals?.map((s, i) => (
                      <span key={`pos-${i}`} className="inline-flex items-center gap-0.5 rounded bg-green-50 border border-green-200 px-1.5 py-0 text-xs text-green-700">
                        <span>+</span>{s}
                      </span>
                    ))}
                    {d.negativeSignals?.map((s, i) => (
                      <span key={`neg-${i}`} className="inline-flex items-center gap-0.5 rounded bg-red-50 border border-red-200 px-1.5 py-0 text-xs text-red-700">
                        <span>−</span>{s}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {hasPassingRule && (
        <div>
          <p className="text-xs text-slate-500 mb-1">Passing rule</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-xs">Min avg ≥ {parsed.passingRule!.minAverageScore}</Badge>
            {parsed.passingRule!.requiredDimensions?.map(rd => (
              <Badge key={rd.key} variant="outline" className="text-xs">
                {DIMENSION_LABELS[rd.key] ?? rd.key} ≥ {rd.minScore}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TerminationRulesPreview({ json }: { json: string }) {
  if (!json.trim()) return null;
  let parsed: TerminationRules;
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    parsed = raw as TerminationRules;
  } catch { return null; }
  const hasSuccess = parsed.success != null;
  const hasFailure = parsed.failure != null;
  const hasTimeout = parsed.timeout != null;
  if (!hasSuccess && !hasFailure && !hasTimeout) return null;
  return (
    <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 space-y-2 mb-2">
      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Preview</p>
      {hasSuccess && <ConditionGroupSummary group={parsed.success!} label="✓ Success when" />}
      {hasFailure && <ConditionGroupSummary group={parsed.failure!} label="✗ Failure when" />}
      {hasTimeout && (
        <div className="flex flex-wrap gap-1.5">
          {parsed.timeout!.maxTurns != null && (
            <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
              ⏱ Max {parsed.timeout!.maxTurns} turns
            </Badge>
          )}
          {parsed.timeout!.maxTimeSec != null && (
            <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
              ⏱ Max {parsed.timeout!.maxTimeSec}s
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

export function ScenarioManager({ onGoToPersonas }: ScenarioManagerProps = {}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const currentLang = i18n.language;
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<ComplexScenario | null>(null);
  const [flowGraphJson, setFlowGraphJson] = useState('');
  const [personaSwitchRulesJson, setPersonaSwitchRulesJson] = useState('');
  const [flowGraphError, setFlowGraphError] = useState('');
  const [personaSwitchRulesError, setPersonaSwitchRulesError] = useState('');
  const [evaluationHarnessJson, setEvaluationHarnessJson] = useState('');
  const [terminationRulesJson, setTerminationRulesJson] = useState('');
  const [playerConstraintsJson, setPlayerConstraintsJson] = useState('');
  const [difficultyProfileJson, setDifficultyProfileJson] = useState('');
  const [analyticsTrackedMetrics, setAnalyticsTrackedMetrics] = useState<string[]>([]);
  const [analyticsReportSections, setAnalyticsReportSections] = useState<string[]>([]);
  const [analyticsBenchmarkGroup, setAnalyticsBenchmarkGroup] = useState('');
  const [evaluationHarnessError, setEvaluationHarnessError] = useState('');
  const [terminationRulesError, setTerminationRulesError] = useState('');
  // Structured simulation harness state
  const [harnessEnabled, setHarnessEnabled] = useState(false);
  const [harnessEmotionModel, setHarnessEmotionModel] = useState('anger,trust,confusion,interest');
  const [harnessMaxCallsPerTurn, setHarnessMaxCallsPerTurn] = useState('2');
  const [harnessMaxDeltaPerCall, setHarnessMaxDeltaPerCall] = useState('30');
  const [harnessAllowedTypes, setHarnessAllowedTypes] = useState<string[]>([...HARNESS_ALL_INCIDENT_TYPES]);
  const [harnessGlobalCooldownSec, setHarnessGlobalCooldownSec] = useState('60');
  const [harnessPerTypeCooldownSec, setHarnessPerTypeCooldownSec] = useState('120');
  const [harnessStateUpdatesEnabled, setHarnessStateUpdatesEnabled] = useState(true);
  const [harnessPreferredSignals, setHarnessPreferredSignals] = useState<{key: string; value: string}[]>([]);
  const [harnessShowRaw, setHarnessShowRaw] = useState(false);
  const [previewEmotionInput, setPreviewEmotionInput] = useState('');
  const [harnessRawJson, setHarnessRawJson] = useState('');
  const [harnessRawJsonError, setHarnessRawJsonError] = useState('');
  const [playerConstraintsError, setPlayerConstraintsError] = useState('');
  const [difficultyProfileError, setDifficultyProfileError] = useState('');

  const harnessEffective = useMemo(() => {
    if (!harnessEnabled) return null;
    const DEF_EMOTIONS = ['anger', 'trust', 'confusion', 'interest'];
    const DEF_TYPES = [...HARNESS_ALL_INCIDENT_TYPES] as string[];
    if (harnessShowRaw) {
      if (!harnessRawJson.trim()) {
        return { valid: true, usingDefaults: true, emotionModel: DEF_EMOTIONS, maxCallsPerTurn: 2, maxDeltaPerCall: 30, allowedTypes: DEF_TYPES, globalCooldownSec: 60, perTypeCooldownSec: 120, stateUpdatesEnabled: true, preferredSignals: {} as Record<string, string>, fieldErrors: {} as Record<string, string> };
      }
      let raw: unknown;
      try { raw = JSON.parse(harnessRawJson); } catch { return { valid: false, parseError: 'JSON 구문 오류', fieldErrors: {} as Record<string, string> }; }
      const result = simulationHarnessSchema.safeParse(raw);
      if (!result.success) {
        const fieldErrors: Record<string, string> = {};
        result.error.errors.forEach(e => { const path = e.path.join('.'); fieldErrors[path] = e.message; });
        return { valid: false, fieldErrors };
      }
      const h = result.data;
      return {
        valid: true, usingDefaults: false,
        emotionModel: h.emotionModel ?? DEF_EMOTIONS,
        maxCallsPerTurn: h.toolPolicy?.updateNpcEmotion?.maxCallsPerTurn ?? 2,
        maxDeltaPerCall: h.toolPolicy?.updateNpcEmotion?.maxDeltaPerCall ?? 30,
        allowedTypes: h.toolPolicy?.triggerIncident?.allowedTypes ?? DEF_TYPES,
        globalCooldownSec: h.toolPolicy?.triggerIncident?.cooldownOverride?.globalCooldownSec ?? 60,
        perTypeCooldownSec: h.toolPolicy?.triggerIncident?.cooldownOverride?.perTypeCooldownSec ?? 120,
        stateUpdatesEnabled: h.toolPolicy?.updateScenarioState?.enabled ?? true,
        preferredSignals: h.preferredSignals ?? {} as Record<string, string>,
        fieldErrors: {} as Record<string, string>,
      };
    } else {
      const emotionModel = harnessEmotionModel.split(',').map(s => s.trim()).filter(Boolean);
      const preferredSignals: Record<string, string> = {};
      harnessPreferredSignals.forEach(({ key, value }) => { if (key.trim()) preferredSignals[key.trim()] = value; });
      return {
        valid: true, usingDefaults: false,
        emotionModel: emotionModel.length > 0 ? emotionModel : DEF_EMOTIONS,
        maxCallsPerTurn: parseInt(harnessMaxCallsPerTurn) || 2,
        maxDeltaPerCall: parseInt(harnessMaxDeltaPerCall) || 30,
        allowedTypes: harnessAllowedTypes,
        globalCooldownSec: parseInt(harnessGlobalCooldownSec) || 60,
        perTypeCooldownSec: parseInt(harnessPerTypeCooldownSec) || 120,
        stateUpdatesEnabled: harnessStateUpdatesEnabled,
        preferredSignals,
        fieldErrors: {} as Record<string, string>,
      };
    }
  }, [harnessEnabled, harnessShowRaw, harnessRawJson, harnessEmotionModel, harnessMaxCallsPerTurn, harnessMaxDeltaPerCall, harnessAllowedTypes, harnessGlobalCooldownSec, harnessPerTypeCooldownSec, harnessStateUpdatesEnabled, harnessPreferredSignals]);

  const harnessWarnings = useMemo(() => {
    if (!harnessEffective?.valid) return [];
    const warnings: string[] = [];
    if ((harnessEffective.allowedTypes?.length ?? 0) === 0) {
      warnings.push('허용 이벤트 유형이 없습니다 — 인시던트가 전혀 발생하지 않습니다.');
    }
    if (harnessEffective.maxCallsPerTurn === 0) {
      warnings.push('턴당 최대 감정 호출이 0입니다 — NPC 감정이 업데이트되지 않습니다.');
    }
    if (harnessEffective.globalCooldownSec === 0) {
      warnings.push('전역 쿨다운이 0초입니다 — 인시던트가 매 턴 반복될 수 있습니다.');
    }
    if (harnessEffective.perTypeCooldownSec === 0) {
      warnings.push('유형별 쿨다운이 0초입니다 — 동일 인시던트가 연속 발생할 수 있습니다.');
    }
    return warnings;
  }, [harnessEffective]);

  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string | number>>(new Set());
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [translatingScenario, setTranslatingScenario] = useState<ComplexScenario | null>(null);
  const [previewScenario, setPreviewScenario] = useState<ComplexScenario | null>(null);
  const [versionHistoryScenario, setVersionHistoryScenario] = useState<ComplexScenario | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);
  const [showImageSelector, setShowImageSelector] = useState(false);
  const [showVideoSelector, setShowVideoSelector] = useState(false);
  const [existingImages, setExistingImages] = useState<{ path: string; url: string; updatedAt: string }[]>([]);
  const [existingVideos, setExistingVideos] = useState<{ path: string; url: string; updatedAt: string }[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [selectedImageSignedUrl, setSelectedImageSignedUrl] = useState<string | null>(null);
  const [selectedVideoSignedUrl, setSelectedVideoSignedUrl] = useState<string | null>(null);
  const [formData, setFormData] = useState<ScenarioFormData>({
    title: '',
    description: '',
    difficulty: 4, // 기본값을 4로 설정 (최고 난이도)
    estimatedTime: '',
    skills: [],
    categoryId: '', // 카테고리 ID 초기값 추가
    evaluationCriteriaSetId: '', // 평가 기준 세트 ID 초기값 추가
    image: '', // 이미지 초기값 추가
    imagePrompt: '', // 이미지 프롬프트 초기값 추가
    introVideoUrl: '', // 인트로 비디오 URL 초기값 추가
    introVideoMode: 'none', // 인트로 비디오 모드 초기값
    videoPrompt: '', // 비디오 프롬프트 초기값 추가
    objectiveType: '', // 목표 유형 초기값 추가
    targetDurationMinutes: 7,
    targetTurns: 10,
    minValidTurns: 4,
    isDemo: false,
    isPublic: false,
    autoTranslate: true,
    storeListed: false,
    storePriceUsd: null,
    storePackId: null,
    context: {
      situation: '',
      timeline: '',
      stakes: '',
      playerRole: {
        position: '',
        department: '',
        experience: '',
        responsibility: ''
      }
    },
    objectives: [],
    successCriteria: {
      optimal: '',
      good: '',
      acceptable: '',
      failure: ''
    },
    personas: [],
    recommendedFlow: []
  });

  const { data: scenarios, isLoading } = useQuery<ComplexScenario[]>({
    queryKey: ['/api/admin/scenarios', currentLang],
    queryFn: async () => {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/admin/scenarios?lang=${currentLang}`, {
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch scenarios');
      }
      return response.json();
    },
  });
  
  // 편집용 원본 데이터 조회 (번역 적용 안됨)
  const { data: originalScenarios } = useQuery<ComplexScenario[]>({
    queryKey: ['/api/admin/scenarios', 'edit'],
    queryFn: async () => {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await fetch(`/api/admin/scenarios?mode=edit`, {
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch original scenarios');
      }
      return response.json();
    },
  });

  // 카테고리 목록 조회 (조직/회사 정보 포함)
  const { data: categories } = useQuery<{ 
    id: string; 
    name: string; 
    description?: string;
    organization?: { id: string; name: string; code?: string } | null;
    company?: { id: string; name: string; code?: string } | null;
  }[]>({
    queryKey: ['/api/admin/categories'],
  });

  // 평가 기준 세트 목록 조회
  const { data: evaluationCriteriaSets } = useQuery<{ id: string; name: string; description?: string; isDefault?: boolean }[]>({
    queryKey: ['/api/evaluation-criteria'],
  });

  // 등록된 페르소나 목록 조회
  const { data: availablePersonas = [] } = useQuery<{ id: string; mbti: string; personality_traits?: string[]; communication_style?: string }[]>({
    queryKey: ['/api/admin/personas'],
  });

  // 시나리오 완료 통계 조회
  const { data: scenarioStats = [] } = useQuery<{ scenarioId: string; completionCount: number; averageScore: number | null }[]>({
    queryKey: ['/api/scenarios/stats'],
    queryFn: () => fetch('/api/scenarios/stats').then(res => res.json()),
    staleTime: 1000 * 60 * 10,
  });
  const statsMap = useMemo(() => new Map(scenarioStats.map(s => [s.scenarioId, s] as const)), [scenarioStats]);

  // 시나리오 품질 검증 결과 조회
  const { data: validationData } = useQuery<Record<string, { score: number; issues: { check: number; key: string; severity: string; message: string }[]; hasFatalErrors: boolean }>>({
    queryKey: ['/api/admin/scenarios/validate'],
    queryFn: async () => {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch('/api/admin/scenarios/validate', { headers, credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch validation data');
      return response.json();
    },
    staleTime: 1000 * 60 * 5,
  });
  const validationMap = useMemo(() => validationData ?? {}, [validationData]);

  // 시나리오 내 이미 선택된 페르소나 ID 목록
  const selectedPersonaIds = useMemo(() => {
    return formData.personas.map(p => p.id).filter(id => id);
  }, [formData.personas]);

  // 특정 인덱스의 페르소나 슬롯에서 선택 가능한 페르소나 목록 (중복 방지)
  const getAvailablePersonasForSlot = (currentIndex: number) => {
    const currentPersonaId = formData.personas[currentIndex]?.id;
    return availablePersonas.filter(p => 
      p.id === currentPersonaId || !selectedPersonaIds.includes(p.id)
    );
  };

  // 시나리오 로드 시 모두 펼쳐진 상태로 초기화
  React.useEffect(() => {
    if (scenarios && scenarios.length > 0) {
      setExpandedScenarios(new Set(scenarios.map(s => s.id)));
    }
  }, [scenarios]);


  const handleAIGenerated = (result: any) => {
    // AI 생성 결과를 폼에 자동 입력 - 모든 필드 완전 복사
    const scenario = result.scenario || {};
    setFormData({
      title: scenario.title || '',
      description: scenario.description || '',
      difficulty: 4, // 기본값을 4로 설정 (최고 난이도)
      estimatedTime: scenario.estimatedTime || '',
      skills: scenario.skills || [],
      categoryId: scenario.categoryId ? String(scenario.categoryId) : '',
      evaluationCriteriaSetId: scenario.evaluationCriteriaSetId || '',
      image: scenario.image || '',
      imagePrompt: scenario.imagePrompt || '',
      introVideoUrl: scenario.introVideoUrl || '',
      introVideoMode: (scenario as any).introVideoMode || (scenario.introVideoUrl ? 'custom' : 'none'),
      videoPrompt: scenario.videoPrompt || '',
      objectiveType: scenario.objectiveType || '',
      isDemo: scenario.isDemo || false,
      isPublic: scenario.isPublic || false,
      storeListed: (scenario as any).storeListed || false,
      storePriceUsd: (scenario as any).storePriceUsd ?? null,
      storePackId: (scenario as any).storePackId ?? null,
      context: scenario.context || {
        situation: '',
        timeline: '',
        stakes: '',
        playerRole: {
          position: '',
          department: '',
          experience: '',
          responsibility: ''
        }
      },
      objectives: scenario.objectives || [],
      successCriteria: scenario.successCriteria || {
        optimal: '',
        good: '',
        acceptable: '',
        failure: ''
      },
      personas: scenario.personas || [],
      recommendedFlow: scenario.recommendedFlow || [],
      targetDurationMinutes: scenario.targetDurationMinutes ?? 7,
      targetTurns: scenario.targetTurns ?? 10,
      minValidTurns: scenario.minValidTurns ?? 4,
    });
    
    setIsCreateOpen(true);
  };

  const autoTranslateMutation = useMutation({
    mutationFn: async (scenarioId: string) => {
      return apiRequest('POST', `/api/admin/scenarios/${scenarioId}/auto-translate`, { sourceLocale: 'ko' });
    },
    onSuccess: async (response: any) => {
      const data = await response.json();
      toast({ 
        title: t('admin.evaluationCriteria.translationSuccess'), 
        description: data.message 
      });
    },
    onError: (error: any) => {
      toast({ 
        title: t('admin.evaluationCriteria.translationFailed'), 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: ScenarioFormData) => {
      const response = await apiRequest('POST', '/api/admin/scenarios', data);
      return response.json();
    },
    onSuccess: async (responseData: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      setIsCreateOpen(false);
      
      if (formData.autoTranslate && responseData?.id) {
        autoTranslateMutation.mutate(responseData.id);
      }
      
      resetForm();
      toast({
        title: t('admin.scenarioManager.createSuccess'),
        description: t('admin.scenarioManager.saveSuccess'),
      });
    },
    onError: () => {
      toast({
        title: t('admin.scenarioManager.saveFailed'),
        description: t('admin.scenarioManager.saveFailed'),
        variant: "destructive",
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ScenarioFormData }) => {
      const response = await apiRequest('PUT', `/api/admin/scenarios/${id}`, data);
      const result = await response.json();
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      setEditingScenario(null);
      resetForm();
      setIsCreateOpen(false);
      toast({
        title: t('admin.scenarioManager.updateSuccess'),
        description: t('admin.scenarioManager.saveSuccess'),
      });
    },
    onError: () => {
      toast({
        title: t('admin.scenarioManager.saveFailed'),
        description: t('admin.scenarioManager.saveFailed'),
        variant: "destructive",
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('DELETE', `/api/admin/scenarios/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      toast({
        title: t('admin.scenarioManager.deleteSuccess'),
        description: t('admin.scenarioManager.deleteSuccess'),
      });
    },
    onError: () => {
      toast({
        title: t('admin.scenarioManager.deleteFailed'),
        description: t('admin.scenarioManager.deleteFailed'),
        variant: "destructive",
      });
    }
  });

  const togglePublicMutation = useMutation({
    mutationFn: async ({ id, isPublic }: { id: string; isPublic: boolean }) => {
      const response = await apiRequest('PATCH', `/api/admin/scenarios/${id}/visibility`, { isPublic });
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      toast({
        title: variables.isPublic ? '시나리오가 공개되었습니다' : '시나리오가 비공개로 변경되었습니다',
        description: variables.isPublic ? '일반 사용자에게 노출됩니다' : '관리자/운영자만 접근 가능합니다',
      });
    },
    onError: () => {
      toast({
        title: '변경 실패',
        description: '공개 설정을 변경하지 못했습니다.',
        variant: 'destructive',
      });
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest('POST', `/api/admin/scenarios/${id}/duplicate`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      toast({ title: '시나리오 복제 완료', description: '시나리오가 복제되었습니다.' });
    },
    onError: () => {
      toast({ title: '복제 실패', description: '시나리오를 복제하지 못했습니다.', variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setFormData({
      title: '',
      description: '',
      difficulty: 4, // 기본값을 4로 설정 (최고 난이도)
      estimatedTime: '',
      skills: [],
      categoryId: '', // 카테고리 ID 초기화
      evaluationCriteriaSetId: '', // 평가 기준 세트 ID 초기화
      image: '', // 이미지 필드 초기화 추가
      imagePrompt: '', // 이미지 프롬프트 초기화 추가
      introVideoUrl: '', // 인트로 비디오 URL 초기화 추가
      introVideoMode: 'none', // 인트로 비디오 모드 초기화
      videoPrompt: '', // 비디오 프롬프트 초기화 추가
      objectiveType: '', // 목표 유형 초기화
      targetDurationMinutes: 7,
      targetTurns: 10,
      minValidTurns: 4,
      isPublic: false,
      autoTranslate: true,
      storeListed: false,
      storePriceUsd: null,
      storePackId: null,
      context: {
        situation: '',
        timeline: '',
        stakes: '',
        playerRole: {
          position: '',
          department: '',
          experience: '',
          responsibility: ''
        }
      },
      objectives: [],
      successCriteria: {
        optimal: '',
        good: '',
        acceptable: '',
        failure: ''
      },
      personas: [],
      recommendedFlow: []
    });
    setImageLoadFailed(false);
    setVideoLoadFailed(false);
    setSelectedImageSignedUrl(null);
    setSelectedVideoSignedUrl(null);
    setFlowGraphJson('');
    setPersonaSwitchRulesJson('');
    setEvaluationHarnessJson('');
    setTerminationRulesJson('');
    setHarnessEnabled(false);
    setHarnessEmotionModel('anger,trust,confusion,interest');
    setHarnessMaxCallsPerTurn('2');
    setHarnessMaxDeltaPerCall('30');
    setHarnessAllowedTypes([...HARNESS_ALL_INCIDENT_TYPES]);
    setHarnessGlobalCooldownSec('60');
    setHarnessPerTypeCooldownSec('120');
    setHarnessStateUpdatesEnabled(true);
    setHarnessPreferredSignals([]);
    setHarnessShowRaw(false);
    setHarnessRawJson('');
    setHarnessRawJsonError('');
    setFlowGraphError('');
    setPersonaSwitchRulesError('');
    setEvaluationHarnessError('');
    setTerminationRulesError('');
    setAnalyticsTrackedMetrics([]);
    setAnalyticsReportSections([]);
    setAnalyticsBenchmarkGroup('');
  };

  const handleEdit = (scenario: ComplexScenario) => {
    // 번역된 데이터 대신 원본 데이터 사용
    const originalScenario = originalScenarios?.find((s: any) => s.id === scenario.id) || scenario;
    
    setEditingScenario(originalScenario);
    setImageLoadFailed(false);
    setVideoLoadFailed(false);
    setSelectedImageSignedUrl(null);
    setSelectedVideoSignedUrl(null);
    setFormData({
      title: originalScenario.title,
      description: originalScenario.description,
      difficulty: originalScenario.difficulty || 4, // 기존 난이도 사용 또는 기본값 4
      estimatedTime: originalScenario.estimatedTime,
      skills: originalScenario.skills,
      categoryId: (originalScenario as any).categoryId ? String((originalScenario as any).categoryId) : '', // 기존 시나리오의 카테고리 ID 로드
      evaluationCriteriaSetId: (originalScenario as any).evaluationCriteriaSetId || '', // 기존 시나리오의 평가 기준 세트 ID 로드
      image: originalScenario.image || '', // 기존 시나리오의 이미지 URL 로드
      imagePrompt: (originalScenario as any).imagePrompt || '', // 기존 시나리오의 이미지 프롬프트 로드
      introVideoUrl: (originalScenario as any).introVideoUrl || '', // 기존 시나리오의 인트로 비디오 URL 로드
      introVideoMode: (originalScenario as any).introVideoMode || ((originalScenario as any).introVideoUrl ? 'custom' : 'none'),
      videoPrompt: (originalScenario as any).videoPrompt || '', // 기존 시나리오의 비디오 프롬프트 로드
      objectiveType: (originalScenario as any).objectiveType || '', // 기존 시나리오의 목표 유형 로드
      targetDurationMinutes: (originalScenario as any).targetDurationMinutes ?? 7,
      targetTurns: (originalScenario as any).targetTurns ?? 10,
      minValidTurns: (originalScenario as any).minValidTurns ?? 4,
      isDemo: (originalScenario as any).isDemo || false,
      isPublic: (originalScenario as any).isPublic || false,
      storeListed: (originalScenario as any).storeListed || false,
      storePriceUsd: (originalScenario as any).storePriceUsd ?? null,
      storePackId: (originalScenario as any).storePackId ?? null,
      context: originalScenario.context,
      objectives: originalScenario.objectives,
      successCriteria: originalScenario.successCriteria,
      // personas가 객체 배열인 경우 ID만 추출, 문자열 배열인 경우 그대로 사용
      personaSwitchMode: (originalScenario as any).personaSwitchMode ?? 'replace',
      personas: Array.isArray(originalScenario.personas) 
        ? originalScenario.personas.map((p: any) => {
            if (typeof p === 'string') {
              return {
                id: p,
                name: '',
                gender: 'male' as const,
                mbti: p.toUpperCase(),
                department: '',
                position: '',
                experience: '',
                personaRef: p + '.json',
                stance: '',
                goal: '',
                tradeoff: ''
              };
            }
            // 객체인 경우 mbti 필드가 없으면 id를 대문자로 변환해서 사용 (하위 호환성)
            return {
              ...p,
              mbti: p.mbti || p.id.toUpperCase()
            } as ScenarioPersona;
          })
        : [],
      recommendedFlow: originalScenario.recommendedFlow
    });
    const existingFlowGraph = (originalScenario as any).flowGraph;
    setFlowGraphJson(existingFlowGraph ? JSON.stringify(existingFlowGraph, null, 2) : '');
    const existingPSR = (originalScenario as any).personaSwitchRules;
    setPersonaSwitchRulesJson(existingPSR ? JSON.stringify(existingPSR, null, 2) : '');
    const existingEH = (originalScenario as any).evaluationHarness;
    setEvaluationHarnessJson(existingEH ? JSON.stringify(existingEH, null, 2) : '');
    const existingTR = (originalScenario as any).terminationRules;
    setTerminationRulesJson(existingTR ? JSON.stringify(existingTR, null, 2) : '');
    const existingHarness = (originalScenario as any).simulationHarness;
    if (existingHarness) {
      setHarnessEnabled(true);
      setHarnessEmotionModel((existingHarness.emotionModel ?? ['anger','trust','confusion','interest']).join(','));
      setHarnessMaxCallsPerTurn(String(existingHarness.toolPolicy?.updateNpcEmotion?.maxCallsPerTurn ?? 2));
      setHarnessMaxDeltaPerCall(String(existingHarness.toolPolicy?.updateNpcEmotion?.maxDeltaPerCall ?? 30));
      setHarnessAllowedTypes(existingHarness.toolPolicy?.triggerIncident?.allowedTypes ?? [...HARNESS_ALL_INCIDENT_TYPES]);
      setHarnessGlobalCooldownSec(String(existingHarness.toolPolicy?.triggerIncident?.cooldownOverride?.globalCooldownSec ?? 60));
      setHarnessPerTypeCooldownSec(String(existingHarness.toolPolicy?.triggerIncident?.cooldownOverride?.perTypeCooldownSec ?? 120));
      setHarnessStateUpdatesEnabled(existingHarness.toolPolicy?.updateScenarioState?.enabled ?? true);
      const sigs = existingHarness.preferredSignals ?? {};
      setHarnessPreferredSignals(Object.entries(sigs).map(([key, value]) => ({ key, value: String(value) })));
    } else {
      setHarnessEnabled(false);
      setHarnessEmotionModel('anger,trust,confusion,interest');
      setHarnessMaxCallsPerTurn('2');
      setHarnessMaxDeltaPerCall('30');
      setHarnessAllowedTypes([...HARNESS_ALL_INCIDENT_TYPES]);
      setHarnessGlobalCooldownSec('60');
      setHarnessPerTypeCooldownSec('120');
      setHarnessStateUpdatesEnabled(true);
      setHarnessPreferredSignals([]);
    }
    setHarnessShowRaw(false);
    setHarnessRawJson('');
    setHarnessRawJsonError('');
    const existingPC = (originalScenario as any).playerConstraints;
    setPlayerConstraintsJson(existingPC ? JSON.stringify(existingPC, null, 2) : '');
    const existingDP = (originalScenario as any).difficultyProfile;
    setDifficultyProfileJson(existingDP ? JSON.stringify(existingDP, null, 2) : '');
    const existingAS = (originalScenario as any).analyticsSpec;
    setAnalyticsTrackedMetrics(existingAS?.trackedMetrics ?? []);
    setAnalyticsReportSections(existingAS?.reportSections ?? []);
    setAnalyticsBenchmarkGroup(existingAS?.benchmarkGroup ?? '');
    setFlowGraphError('');
    setPersonaSwitchRulesError('');
    setEvaluationHarnessError('');
    setTerminationRulesError('');
    setPlayerConstraintsError('');
    setDifficultyProfileError('');
    setIsCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 필수 필드 검증
    if (!formData.title) {
      toast({
        title: t('admin.scenarioManager.toast.titleRequired'),
        description: t('admin.scenarioManager.toast.titleRequiredDesc'),
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.categoryId) {
      toast({
        title: t('admin.scenarioManager.toast.categoryRequired'),
        description: t('admin.scenarioManager.toast.categoryRequiredDesc'),
        variant: "destructive",
      });
      return;
    }
    
    const submitData = buildSubmitPayload();
    if (!submitData) return;

    if (editingScenario) {
      updateMutation.mutate({ id: editingScenario.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const buildSubmitPayload = (): (typeof formData & { flowGraph: any; personaSwitchRules: any; evaluationHarness: any; terminationRules: any; simulationHarness: any }) | null => {
    let parsedFlowGraph: any = null;
    let parsedPSR: any = null;
    let parsedHarness: any = null;

    if (flowGraphJson.trim()) {
      let raw: any;
      try {
        raw = JSON.parse(flowGraphJson);
      } catch {
        setFlowGraphError('flowGraph JSON이 유효하지 않습니다. 형식을 확인하세요.');
        toast({ title: 'flowGraph JSON 오류', description: 'flowGraph JSON을 확인하세요.', variant: 'destructive' });
        return null;
      }
      const result = flowGraphSchema.safeParse(raw);
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? '스키마 검증 실패';
        setFlowGraphError(`flowGraph 구조 오류: ${msg}`);
        toast({ title: 'flowGraph 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedFlowGraph = result.data;
      setFlowGraphError('');
    }

    if (personaSwitchRulesJson.trim()) {
      let raw: any;
      try {
        raw = JSON.parse(personaSwitchRulesJson);
      } catch {
        setPersonaSwitchRulesError('personaSwitchRules JSON이 유효하지 않습니다. 형식을 확인하세요.');
        toast({ title: 'personaSwitchRules JSON 오류', description: 'personaSwitchRules JSON을 확인하세요.', variant: 'destructive' });
        return null;
      }
      const result = personaSwitchRulesSchema.safeParse(raw);
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? '스키마 검증 실패';
        setPersonaSwitchRulesError(`personaSwitchRules 구조 오류: ${msg}`);
        toast({ title: 'personaSwitchRules 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedPSR = result.data;
      setPersonaSwitchRulesError('');
    }

    let parsedEH: any = null;
    if (evaluationHarnessJson.trim()) {
      let raw: any;
      try {
        raw = JSON.parse(evaluationHarnessJson);
      } catch {
        setEvaluationHarnessError('evaluationHarness JSON이 유효하지 않습니다. 형식을 확인하세요.');
        toast({ title: 'evaluationHarness JSON 오류', description: 'evaluationHarness JSON을 확인하세요.', variant: 'destructive' });
        return null;
      }
      const result = evaluationHarnessSchema.safeParse(raw);
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? '스키마 검증 실패';
        setEvaluationHarnessError(`evaluationHarness 구조 오류: ${msg}`);
        toast({ title: 'evaluationHarness 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedEH = result.data;
      setEvaluationHarnessError('');
    }

    let parsedTR: any = null;
    if (terminationRulesJson.trim()) {
      let raw: any;
      try {
        raw = JSON.parse(terminationRulesJson);
      } catch {
        setTerminationRulesError('terminationRules JSON이 유효하지 않습니다. 형식을 확인하세요.');
        toast({ title: 'terminationRules JSON 오류', description: 'terminationRules JSON을 확인하세요.', variant: 'destructive' });
        return null;
      }
      const result = terminationRulesSchema.safeParse(raw);
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? '스키마 검증 실패';
        setTerminationRulesError(`terminationRules 구조 오류: ${msg}`);
        toast({ title: 'terminationRules 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedTR = result.data;
      setTerminationRulesError('');
    }

    if (harnessEnabled) {
      if (harnessShowRaw) {
        if (harnessRawJson.trim()) {
          let raw: any;
          try {
            raw = JSON.parse(harnessRawJson);
          } catch {
            setHarnessRawJsonError('시뮬레이션 정책 JSON이 유효하지 않습니다. 형식을 확인하세요.');
            toast({ title: '시뮬레이션 정책 JSON 오류', description: '시뮬레이션 정책 JSON을 확인하세요.', variant: 'destructive' });
            return null;
          }
          const result = simulationHarnessSchema.safeParse(raw);
          if (!result.success) {
            const msg = result.error.errors[0]?.message ?? '스키마 검증 실패';
            setHarnessRawJsonError(`시뮬레이션 정책 구조 오류: ${msg}`);
            toast({ title: '시뮬레이션 정책 구조 오류', description: msg, variant: 'destructive' });
            return null;
          }
          parsedHarness = result.data;
          setHarnessRawJsonError('');
        }
      } else {
        const emotionModel = harnessEmotionModel.split(',').map(s => s.trim()).filter(Boolean);
        const preferredSignals: Record<string, string> = {};
        harnessPreferredSignals.forEach(({ key, value }) => { if (key.trim()) preferredSignals[key.trim()] = value; });
        const built: any = { emotionModel, toolPolicy: {
          updateNpcEmotion: { maxCallsPerTurn: parseInt(harnessMaxCallsPerTurn) || 2, maxDeltaPerCall: parseInt(harnessMaxDeltaPerCall) || 30 },
          triggerIncident: { allowedTypes: harnessAllowedTypes, cooldownOverride: { globalCooldownSec: parseInt(harnessGlobalCooldownSec) || 60, perTypeCooldownSec: parseInt(harnessPerTypeCooldownSec) || 120 } },
          updateScenarioState: { enabled: harnessStateUpdatesEnabled },
        }};
        if (Object.keys(preferredSignals).length > 0) built.preferredSignals = preferredSignals;
        const result = simulationHarnessSchema.safeParse(built);
        if (!result.success) {
          const msg = result.error.errors[0]?.message ?? '스키마 검증 실패';
          toast({ title: '시뮬레이션 정책 구조 오류', description: msg, variant: 'destructive' });
          return null;
        }
        parsedHarness = result.data;
      }
    }

    let parsedPC: any = null;
    if (playerConstraintsJson.trim()) {
      let raw: any;
      try {
        raw = JSON.parse(playerConstraintsJson);
      } catch {
        setPlayerConstraintsError('playerConstraints JSON이 유효하지 않습니다. 형식을 확인하세요.');
        toast({ title: 'playerConstraints JSON 오류', description: 'playerConstraints JSON을 확인하세요.', variant: 'destructive' });
        return null;
      }
      const result = playerConstraintsSchema.safeParse(raw);
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? '스키마 검증 실패';
        setPlayerConstraintsError(`playerConstraints 구조 오류: ${msg}`);
        toast({ title: 'playerConstraints 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedPC = result.data;
      setPlayerConstraintsError('');
    }

    let parsedDP: any = null;
    if (difficultyProfileJson.trim()) {
      let raw: any;
      try {
        raw = JSON.parse(difficultyProfileJson);
      } catch {
        setDifficultyProfileError('difficultyProfile JSON이 유효하지 않습니다. 형식을 확인하세요.');
        toast({ title: 'difficultyProfile JSON 오류', description: 'difficultyProfile JSON을 확인하세요.', variant: 'destructive' });
        return null;
      }
      const result = difficultyProfileSchema.safeParse(raw);
      if (!result.success) {
        const msg = result.error.errors[0]?.message ?? '스키마 검증 실패';
        setDifficultyProfileError(`difficultyProfile 구조 오류: ${msg}`);
        toast({ title: 'difficultyProfile 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedDP = result.data;
      setDifficultyProfileError('');
    }

    const analyticsSpec = (analyticsTrackedMetrics.length > 0 || analyticsReportSections.length > 0 || analyticsBenchmarkGroup.trim())
      ? {
          trackedMetrics: analyticsTrackedMetrics,
          reportSections: analyticsReportSections,
          ...(analyticsBenchmarkGroup.trim() ? { benchmarkGroup: analyticsBenchmarkGroup.trim() } : {}),
        }
      : null;

    return { ...formData, flowGraph: parsedFlowGraph, personaSwitchRules: parsedPSR, evaluationHarness: parsedEH, terminationRules: parsedTR, simulationHarness: parsedHarness, playerConstraints: parsedPC, difficultyProfile: parsedDP, analyticsSpec };
  };

  const handleSaveAndGoToPersona = () => {
    if (!formData.title) {
      toast({
        title: '시나리오 제목이 필요합니다',
        description: '시나리오 제목을 먼저 입력해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    const submitData = buildSubmitPayload();
    if (!submitData) return;
    const afterSave = () => {
      toast({
        title: '시나리오 저장됨',
        description: '페르소나 생성 화면으로 이동합니다.',
      });
      onGoToPersonas?.();
    };
    if (editingScenario) {
      updateMutation.mutate({ id: editingScenario.id, data: submitData }, { onSuccess: afterSave });
    } else {
      createMutation.mutate(submitData, { onSuccess: afterSave });
    }
  };

  const handleGenerateImage = async () => {
    if (!formData.title) {
      toast({
        title: t('admin.scenarioManager.toast.titleNeededForImage'),
        description: t('admin.scenarioManager.toast.titleNeededForImageDesc'),
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingImage(true);
    try {
      const response = await apiRequest('POST', '/api/image/generate-scenario-image', {
        scenarioId: editingScenario?.id || undefined,
        scenarioTitle: formData.title,
        description: formData.description,
        customPrompt: formData.imagePrompt || undefined,
      });
      
      const data = await response.json();
      
      if (data.success && data.imageUrl) {
        setFormData(prev => ({ ...prev, image: data.storagePath || data.imageUrl }));
        setSelectedImageSignedUrl(toMediaUrl(data.storagePath || data.imageUrl));
        setImageLoadFailed(false);
        toast({
          title: t('admin.scenarioManager.toast.imageGenerated'),
          description: t('admin.scenarioManager.toast.imageGeneratedDesc'),
        });
        if (editingScenario?.id) {
          queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
        }
      } else {
        throw new Error(data.error || t('admin.scenarioManager.toast.imageGenerateFailed', 'Image generation failed'));
      }
    } catch (error: any) {
      console.error('Image generation error:', error);
      toast({
        title: t('admin.scenarioManager.toast.imageGenerateFailed', 'Image Generation Failed'),
        description: error.message || t('admin.scenarioManager.toast.imageGenerateFailed', 'An error occurred during image generation.'),
        variant: "destructive",
      });
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!editingScenario?.id) {
      toast({
        title: t('admin.scenarioManager.toast.saveNeededForVideo'),
        description: t('admin.scenarioManager.toast.saveNeededForVideoDesc'),
        variant: "destructive",
      });
      return;
    }

    if (!formData.title) {
      toast({
        title: t('admin.scenarioManager.toast.titleNeededForVideo'),
        description: t('admin.scenarioManager.toast.titleNeededForVideoDesc'),
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingVideo(true);
    setVideoLoadFailed(false);
    try {
      const response = await apiRequest('POST', `/api/admin/scenarios/${editingScenario.id}/generate-intro-video`, {
        customPrompt: formData.videoPrompt || undefined,
      });
      
      const data = await response.json();
      
      if (data.success && data.videoUrl) {
        setFormData(prev => ({ ...prev, introVideoUrl: data.videoUrl, introVideoMode: 'custom' }));
        toast({
          title: t('admin.scenarioManager.toast.videoGenerated', 'Video Generated'),
          description: t('admin.scenarioManager.toast.videoGeneratedDesc', 'Intro video generated successfully.'),
        });
        queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      } else {
        throw new Error(data.error || t('admin.scenarioManager.toast.videoGenerateFailed', 'Video generation failed'));
      }
    } catch (error: any) {
      console.error('Video generation error:', error);
      toast({
        title: t('admin.scenarioManager.toast.videoGenerateFailed', 'Video Generation Failed'),
        description: error.message || t('admin.scenarioManager.toast.videoGenerateFailed', 'An error occurred during video generation.'),
        variant: "destructive",
      });
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  // 기본 이미지 프롬프트 로드
  const handleLoadDefaultImagePrompt = async () => {
    if (!formData.title) {
      toast({
        title: t('admin.scenarioManager.toast.titleNeededForImage'),
        description: t('admin.scenarioManager.toast.titleNeededForImageDesc'),
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiRequest('POST', '/api/admin/scenarios/default-image-prompt', {
        scenarioTitle: formData.title,
        description: formData.description,
        theme: formData.theme,
        industry: formData.industry,
      });
      
      const data = await response.json();
      
      if (data.success && data.prompt) {
        setFormData(prev => ({ ...prev, imagePrompt: data.prompt }));
        toast({
          title: t('admin.scenarioManager.toast.promptLoaded', '프롬프트 로드됨'),
          description: t('admin.scenarioManager.toast.promptLoadedDesc', '기본 프롬프트가 로드되었습니다. 편집 후 사용하세요.'),
        });
      }
    } catch (error: any) {
      console.error('Error loading default image prompt:', error);
      toast({
        title: t('admin.scenarioManager.toast.promptLoadFailed', '프롬프트 로드 실패'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  // 기존 이미지 목록 로드
  const handleLoadExistingImages = async () => {
    setLoadingImages(true);
    try {
      const response = await apiRequest('GET', '/api/admin/scenarios/images');
      const data = await response.json();
      if (data.success && data.images) {
        setExistingImages(data.images);
      }
    } catch (error) {
      console.error('Error loading existing images:', error);
    } finally {
      setLoadingImages(false);
    }
  };

  // 기존 비디오 목록 로드
  const handleLoadExistingVideos = async () => {
    setLoadingVideos(true);
    try {
      const response = await apiRequest('GET', '/api/admin/scenarios/videos');
      const data = await response.json();
      if (data.success && data.videos) {
        setExistingVideos(data.videos);
      }
    } catch (error) {
      console.error('Error loading existing videos:', error);
    } finally {
      setLoadingVideos(false);
    }
  };

  // 이미지 선택 다이얼로그 열기
  const handleOpenImageSelector = () => {
    setShowImageSelector(true);
    handleLoadExistingImages();
  };

  // 비디오 선택 다이얼로그 열기
  const handleOpenVideoSelector = () => {
    setShowVideoSelector(true);
    handleLoadExistingVideos();
  };

  // 이미지 선택
  const handleSelectImage = (imagePath: string, signedUrl: string) => {
    setFormData(prev => ({ ...prev, image: imagePath }));
    setSelectedImageSignedUrl(signedUrl && /^https?:\/\//i.test(signedUrl) ? signedUrl : toMediaUrl(imagePath));
    setImageLoadFailed(false);
    setShowImageSelector(false);
    toast({
      title: t('admin.scenarioManager.toast.imageSelected', '이미지 선택됨'),
      description: t('admin.scenarioManager.toast.imageSelectedDesc', '기존 이미지가 선택되었습니다.'),
    });
  };

  // 비디오 선택
  const handleSelectVideo = (videoPath: string, signedUrl: string) => {
    setFormData(prev => ({ ...prev, introVideoUrl: videoPath }));
    setVideoLoadFailed(false);
    setSelectedVideoSignedUrl(signedUrl);
    setShowVideoSelector(false);
    toast({
      title: t('admin.scenarioManager.toast.videoSelected', '비디오 선택됨'),
      description: t('admin.scenarioManager.toast.videoSelectedDesc', '기존 비디오가 선택되었습니다.'),
    });
  };

  // 기본 비디오 프롬프트 로드
  const handleLoadDefaultVideoPrompt = async () => {
    if (!formData.title) {
      toast({
        title: t('admin.scenarioManager.toast.titleNeededForVideo'),
        description: t('admin.scenarioManager.toast.titleNeededForVideoDesc'),
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiRequest('POST', '/api/admin/scenarios/default-video-prompt', {
        scenarioTitle: formData.title,
        description: formData.description,
        context: formData.context,
      });
      
      const data = await response.json();
      
      if (data.success && data.prompt) {
        setFormData(prev => ({ ...prev, videoPrompt: data.prompt }));
        toast({
          title: t('admin.scenarioManager.toast.promptLoaded', '프롬프트 로드됨'),
          description: t('admin.scenarioManager.toast.promptLoadedDesc', '기본 프롬프트가 로드되었습니다. 편집 후 사용하세요.'),
        });
      }
    } catch (error: any) {
      console.error('Error loading default video prompt:', error);
      toast({
        title: t('admin.scenarioManager.toast.promptLoadFailed', '프롬프트 로드 실패'),
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDeleteVideo = async () => {
    if (!editingScenario?.id) {
      return;
    }

    try {
      const response = await apiRequest('DELETE', `/api/admin/scenarios/${editingScenario.id}/intro-video`);
      const data = await response.json();
      
      if (data.success) {
        setFormData(prev => ({ ...prev, introVideoUrl: '', introVideoMode: 'none' }));
        toast({
          title: t('admin.scenarioManager.toast.videoDeleted', 'Video Deleted'),
          description: t('admin.scenarioManager.toast.videoDeletedDesc', 'Intro video has been deleted.'),
        });
        queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
      } else {
        throw new Error(data.error || t('admin.scenarioManager.toast.videoDeleteFailed', 'Video deletion failed'));
      }
    } catch (error: any) {
      console.error('Video deletion error:', error);
      toast({
        title: t('admin.scenarioManager.toast.videoDeleteFailed', 'Video Deletion Failed'),
        description: error.message || t('admin.scenarioManager.toast.videoDeleteFailed', 'An error occurred during video deletion.'),
        variant: "destructive",
      });
    }
  };

  const addSkill = (skill: string) => {
    if (skill && !formData.skills.includes(skill)) {
      setFormData(prev => ({
        ...prev,
        skills: [...prev.skills, skill]
      }));
    }
  };

  const removeSkill = (index: number) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index)
    }));
  };

  const addObjective = (objective: string) => {
    if (objective && !formData.objectives.includes(objective)) {
      setFormData(prev => ({
        ...prev,
        objectives: [...prev.objectives, objective]
      }));
    }
  };

  const removeObjective = (index: number) => {
    setFormData(prev => ({
      ...prev,
      objectives: prev.objectives.filter((_, i) => i !== index)
    }));
  };

  // 완성도 계산 헬퍼
  const getCompleteness = (scenario: ComplexScenario) => {
    const checks = [
      { key: 'image', label: '이미지', icon: ImageOff, ok: !!(scenario.image && !scenario.image.includes('unsplash')) },
      { key: 'personas', label: '페르소나', icon: UserX, ok: (scenario.personas || []).length > 0 },
      { key: 'objectives', label: '목표', icon: ListX, ok: (scenario.objectives || []).length > 0 },
      { key: 'evaluationCriteria', label: '평가기준', icon: BarChart2, ok: !!(scenario as any).evaluationCriteriaSetId },
    ];
    const score = checks.filter(c => c.ok).length;
    const percent = Math.round((score / checks.length) * 100);
    return { checks, score, percent };
  };

  // 미사용 여부 확인 (완료 횟수 0인 경우)
  const isUnused = (scenarioId: string) => {
    const stats = statsMap.get(String(scenarioId));
    return !stats || stats.completionCount === 0;
  };

  // Export: 전체 시나리오를 JSON으로 다운로드
  const handleExport = () => {
    if (!scenarios || scenarios.length === 0) {
      toast({ title: '내보낼 시나리오가 없습니다', variant: 'destructive' });
      return;
    }
    const exportData = scenarios.map(s => {
      const { id, title, description, difficulty, estimatedTime, skills, context, objectives, successCriteria, personas, recommendedFlow, image, imagePrompt, introVideoUrl, introVideoMode, videoPrompt, objectiveType, isDemo, isPublic } = s as any;
      return { id, title, description, difficulty, estimatedTime, skills, context, objectives, successCriteria, personas, recommendedFlow, image, imagePrompt, introVideoUrl, introVideoMode, videoPrompt, objectiveType, isDemo, isPublic, categoryId: (s as any).categoryId, evaluationCriteriaSetId: (s as any).evaluationCriteriaSetId };
    });
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scenarios-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `${exportData.length}개 시나리오를 내보냈습니다` });
  };

  // Import: JSON 파일 파싱 후 시나리오 생성
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (importFileRef.current) importFileRef.current.value = '';
    
    let parsed: any[];
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('배열 형식이 아닙니다');
    } catch (err: any) {
      toast({ title: '파일 파싱 실패', description: err.message, variant: 'destructive' });
      return;
    }

    setIsImporting(true);
    let successCount = 0;
    let failCount = 0;

    for (const item of parsed) {
      try {
        if (!item.title || typeof item.title !== 'string') { failCount++; continue; }
        if (item.description !== undefined && typeof item.description !== 'string') { failCount++; continue; }
        if (item.objectives !== undefined && !Array.isArray(item.objectives)) { failCount++; continue; }
        if (item.personas !== undefined && !Array.isArray(item.personas)) { failCount++; continue; }
        if (item.skills !== undefined && !Array.isArray(item.skills)) { failCount++; continue; }
        const { id: _id, ...scenarioData } = item;
        await apiRequest('POST', '/api/admin/scenarios', scenarioData);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setIsImporting(false);
    queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
    toast({
      title: '가져오기 완료',
      description: `성공 ${successCount}개, 실패 ${failCount}개`,
      variant: failCount > 0 ? 'destructive' : 'default',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-corporate-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('admin.scenarioManager.title')}</h2>
          <p className="text-slate-600 mt-1">{t('admin.scenarioManager.description')}</p>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={importFileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => importFileRef.current?.click()}
                  disabled={isImporting}
                  data-testid="button-import-scenarios"
                >
                  {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  가져오기
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">JSON 파일에서 시나리오를 가져옵니다</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  data-testid="button-export-scenarios"
                >
                  <Download className="mr-2 h-4 w-4" />
                  내보내기
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">시나리오 전체를 JSON 파일로 내보냅니다</TooltipContent>
            </Tooltip>
            <AIScenarioGenerator onGenerated={handleAIGenerated} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  className="bg-corporate-600 hover:bg-corporate-700"
                  onClick={() => {
                    resetForm();
                    setEditingScenario(null);
                    setIsCreateOpen(true);
                  }}
                  data-testid="button-create-scenario"
                >
                  <i className="fas fa-plus mr-2"></i>
                  {t('admin.scenarioManager.createManually')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">새 시나리오를 직접 작성합니다</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-slate-50">
              <DialogHeader className="bg-white px-6 py-4 -mx-6 -mt-6 border-b border-slate-200">
                <DialogTitle className="text-xl text-slate-900">
                  {editingScenario ? (editingScenario.title || t('admin.scenarioManager.editScenario')) : t('admin.scenarioManager.newScenario')}
                </DialogTitle>
              </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-6 pt-6">
              {/* 기본 정보 */}
              <div className="space-y-4 bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900 pb-3 border-b border-slate-200">{t('common.basicInfo', 'Basic Info')}</h3>
                
                {/* 시나리오 이미지 - 최상단으로 이동 */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="image" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.imageUrl')}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleOpenImageSelector}
                      className="text-xs"
                    >
                      📁 {t('admin.scenarioManager.form.selectExisting', '기존 이미지 선택')}
                    </Button>
                  </div>
                  <Input
                    id="image"
                    value={formData.image || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, image: e.target.value }))}
                    placeholder={t('admin.scenarioManager.form.imageUrlPlaceholder')}
                    data-testid="input-scenario-image"
                    className="bg-white"
                  />
                  
                  {/* 이미지 프롬프트 입력 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="imagePrompt" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.imagePrompt', 'Image Prompt (Optional)')}</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleLoadDefaultImagePrompt}
                        disabled={!formData.title}
                        className="text-xs"
                      >
                        {t('admin.scenarioManager.form.loadDefaultPrompt', '기본 프롬프트 로드')}
                      </Button>
                    </div>
                    <Textarea
                      id="imagePrompt"
                      value={formData.imagePrompt || ''}
                      onChange={(e) => setFormData(prev => ({ ...prev, imagePrompt: e.target.value }))}
                      placeholder={t('admin.scenarioManager.form.imagePromptPlaceholder', 'Enter custom image prompt. Leave empty to auto-generate.')}
                      className="min-h-[80px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-image-prompt"
                    />
                    <p className="text-xs text-slate-500">
                      예: "Modern corporate office with team meeting, professional photography, natural lighting"
                    </p>
                  </div>
                  
                  {/* 이미지 생성 버튼 */}
                  <Button
                    type="button"
                    onClick={handleGenerateImage}
                    disabled={isGeneratingImage || !formData.title}
                    className="w-full"
                    data-testid="button-generate-image"
                  >
                    {isGeneratingImage ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('admin.scenarioManager.form.generatingImage')}
                      </>
                    ) : (
                      `🎨 ${t('admin.scenarioManager.form.generateImage')}`
                    )}
                  </Button>
                  
                  {/* 이미지 미리보기 */}
                  {formData.image && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm text-slate-600">{t('admin.scenarioManager.form.imagePreview')}:</p>
                        {imageLoadFailed && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, image: '' }));
                              setImageLoadFailed(false);
                            }}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 text-xs"
                          >
                            <i className="fas fa-trash mr-1"></i>
                            이미지 URL 삭제
                          </Button>
                        )}
                      </div>
                      <div 
                        className="relative w-full h-48 bg-slate-100 rounded-lg overflow-hidden border cursor-pointer hover:shadow-lg transition-shadow"
                        onClick={() => !imageLoadFailed && setImagePreviewUrl(selectedImageSignedUrl || toMediaUrl(formData.image) || null)}
                        data-testid="image-preview-container"
                      >
                        {imageLoadFailed ? (
                          <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-2">
                            <i className="fas fa-exclamation-triangle text-amber-500 text-2xl"></i>
                            <span>이미지 파일을 찾을 수 없습니다</span>
                            <span className="text-xs text-slate-400">위 버튼으로 이미지를 다시 생성하세요</span>
                          </div>
                        ) : (
                          <img
                            src={selectedImageSignedUrl || toMediaUrl(formData.image)}
                            alt={t('admin.scenarioManager.form.imagePreview')}
                            className="w-full h-full object-cover"
                            onError={() => setImageLoadFailed(true)}
                            onLoad={() => setImageLoadFailed(false)}
                            data-testid="scenario-image-preview"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
                
                {/* 인트로 비디오 모드 선택 섹션 */}
                <div className="space-y-3 mt-6 pt-6 border-t border-slate-200">
                  <Label className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.introVideo')}</Label>

                  {/* 모드 선택 라디오 카드 */}
                  <div className="grid grid-cols-3 gap-2">
                    {/* 사용 안 함 */}
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, introVideoMode: 'none' }))}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-sm transition-all ${
                        formData.introVideoMode === 'none'
                          ? 'border-slate-700 bg-slate-50'
                          : 'border-slate-200 bg-white hover:border-slate-400'
                      }`}
                      data-testid="video-mode-none"
                    >
                      <span className="text-xl">🚫</span>
                      <span className="font-medium text-slate-700">사용 안 함</span>
                      <span className="text-xs text-slate-500 text-center">인트로 없이 시작</span>
                    </button>

                    {/* 기본 비디오 */}
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, introVideoMode: 'default' }))}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-sm transition-all ${
                        formData.introVideoMode === 'default'
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-blue-300'
                      }`}
                      data-testid="video-mode-default"
                    >
                      <span className="text-xl">🎬</span>
                      <span className="font-medium text-slate-700">기본 비디오</span>
                      <span className="text-xs text-slate-500 text-center">공통 인트로 재생</span>
                    </button>

                    {/* 커스텀 비디오 */}
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, introVideoMode: 'custom' }))}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-sm transition-all ${
                        formData.introVideoMode === 'custom'
                          ? 'border-purple-600 bg-purple-50'
                          : 'border-slate-200 bg-white hover:border-purple-300'
                      }`}
                      data-testid="video-mode-custom"
                    >
                      <span className="text-xl">🎥</span>
                      <span className="font-medium text-slate-700">커스텀 비디오</span>
                      <span className="text-xs text-slate-500 text-center">시나리오별 영상</span>
                    </button>
                  </div>

                  {/* 기본 비디오 미리보기 */}
                  {formData.introVideoMode === 'default' && (
                    <div className="mt-2">
                      <p className="text-xs text-slate-500 mb-2">기본 비디오 미리보기:</p>
                      <div className="relative w-full bg-slate-900 rounded-lg overflow-hidden border">
                        <video
                          src="/videos/intro_default.webm"
                          controls
                          className="w-full max-h-48 object-contain"
                          preload="metadata"
                          data-testid="default-video-preview"
                        />
                      </div>
                    </div>
                  )}

                  {/* 커스텀 비디오 UI */}
                  {formData.introVideoMode === 'custom' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleOpenVideoSelector}
                            className="text-xs"
                          >
                            📁 {t('admin.scenarioManager.form.selectExistingVideo', '기존 비디오 선택')}
                          </Button>
                        </div>
                        {formData.introVideoUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleDeleteVideo}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            data-testid="button-delete-video"
                          >
                            <i className="fas fa-trash mr-1"></i>
                            {t('common.delete')}
                          </Button>
                        )}
                      </div>

                      {/* 비디오 URL 직접 입력 */}
                      <Input
                        id="introVideoUrl"
                        value={formData.introVideoUrl || ''}
                        onChange={(e) => {
                          setFormData(prev => ({ ...prev, introVideoUrl: e.target.value }));
                          if (e.target.value) setVideoLoadFailed(false);
                        }}
                        placeholder="비디오 URL을 입력하세요 (예: /scenarios/videos/intro.webm)"
                        data-testid="input-intro-video-url"
                        className="bg-white"
                      />

                      {/* 비디오 프롬프트 입력 */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="videoPrompt" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.videoPrompt')}</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleLoadDefaultVideoPrompt}
                            disabled={!formData.title}
                            className="text-xs"
                          >
                            {t('admin.scenarioManager.form.loadDefaultPrompt', '기본 프롬프트 로드')}
                          </Button>
                        </div>
                        <Textarea
                          id="videoPrompt"
                          value={formData.videoPrompt || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, videoPrompt: e.target.value }))}
                          placeholder={t('admin.scenarioManager.form.videoPromptPlaceholder')}
                          className="min-h-[80px] bg-white whitespace-pre-wrap"
                          data-testid="textarea-video-prompt"
                        />
                        <p className="text-xs text-slate-500">
                          예: "Modern tech office, employees discussing urgently around monitors showing security alerts, tense atmosphere"
                        </p>
                      </div>

                      {/* 비디오 생성 버튼 */}
                      <Button
                        type="button"
                        onClick={handleGenerateVideo}
                        disabled={isGeneratingVideo || !editingScenario?.id}
                        className="w-full"
                        variant={editingScenario?.id ? "default" : "secondary"}
                        data-testid="button-generate-video"
                      >
                        {isGeneratingVideo ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('admin.scenarioManager.form.generatingVideo')}
                          </>
                        ) : editingScenario?.id ? (
                          `🎬 ${t('admin.scenarioManager.form.generateVideo')}`
                        ) : (
                          t('admin.scenarioManager.form.videoAfterSave')
                        )}
                      </Button>

                      {/* 비디오 미리보기 */}
                      {isGeneratingVideo && (
                        <div className="mt-3">
                          <div className="flex items-center justify-center h-32 bg-slate-900 rounded-lg border text-slate-400 text-sm">
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            비디오 생성 중...
                          </div>
                        </div>
                      )}
                      {!isGeneratingVideo && videoLoadFailed && (
                        <div className="mt-3">
                          <div className="flex items-center justify-center h-32 bg-slate-900 rounded-lg border text-slate-400 text-sm">
                            <span className="mr-2">⚠️</span>비디오를 불러올 수 없습니다. 새로 생성해 주세요.
                          </div>
                        </div>
                      )}
                      {!isGeneratingVideo && !videoLoadFailed && formData.introVideoUrl && (
                        <div className="mt-3">
                          <p className="text-sm text-slate-600 mb-2">비디오 미리보기 (클릭하면 전체보기):</p>
                          <div
                            className="relative w-full bg-slate-900 rounded-lg overflow-hidden border cursor-pointer hover:shadow-lg transition-shadow"
                            onClick={() => setVideoPreviewUrl(toMediaUrl(formData.introVideoUrl) || null)}
                            data-testid="video-preview-container"
                          >
                            <video
                              key={formData.introVideoUrl}
                              src={toMediaUrl(formData.introVideoUrl)}
                              controls
                              className="w-full max-h-64 object-contain"
                              preload="metadata"
                              onError={() => {
                                setVideoLoadFailed(true);
                                setFormData(prev => ({ ...prev, introVideoUrl: '' }));
                              }}
                              data-testid="scenario-video-preview"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="title" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.scenarioTitle')}</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      placeholder={t('admin.scenarioManager.form.scenarioTitlePlaceholder')}
                      required
                      data-testid="input-scenario-title"
                      className="bg-white"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="category" className="text-sm font-medium text-slate-700">
                      {t('admin.scenarioManager.form.category')} <span className="text-red-500">*</span>
                    </Label>
                    <Select 
                      value={formData.categoryId || ''} 
                      onValueChange={(val) => setFormData(prev => ({ ...prev, categoryId: val }))}
                    >
                      <SelectTrigger 
                        className={`bg-white ${!formData.categoryId ? 'border-red-300' : ''}`}
                        data-testid="select-category"
                      >
                        <SelectValue placeholder={t('admin.scenarioManager.form.categoryPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {categories?.map(cat => {
                          const hierarchyLabel = cat.company && cat.organization 
                            ? `${cat.company.name} > ${cat.organization.name} > ${cat.name}`
                            : cat.organization 
                            ? `${cat.organization.name} > ${cat.name}`
                            : cat.name;
                          return (
                            <SelectItem key={cat.id} value={String(cat.id)} data-testid={`category-option-${cat.id}`}>
                              {hierarchyLabel}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {!formData.categoryId && (
                      <p className="text-xs text-red-500 mt-1">{t('admin.scenarioManager.form.selectCategory')}</p>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="estimatedTime" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.estimatedTime', 'Estimated Time')}</Label>
                    <Input
                      id="estimatedTime"
                      value={formData.estimatedTime}
                      onChange={(e) => setFormData(prev => ({ ...prev, estimatedTime: e.target.value }))}
                      placeholder={t('admin.scenarioManager.form.estimatedTimePlaceholder', 'e.g., 30-45 min')}
                      required
                      data-testid="input-estimated-time"
                      className="bg-white"
                    />
                  </div>

                  {/* 대화 시간 설정 */}
                  {(() => {
                    const difficulty = formData.difficulty ?? 4;
                    const rec = difficulty === 1
                      ? { durationMin: 5, durationMax: 8, turnsMin: 6, turnsMax: 8, minValid: 3 }
                      : difficulty === 2
                      ? { durationMin: 7, durationMax: 10, turnsMin: 8, turnsMax: 12, minValid: 4 }
                      : difficulty === 3
                      ? { durationMin: 10, durationMax: 15, turnsMin: 12, turnsMax: 16, minValid: 5 }
                      : { durationMin: 12, durationMax: 20, turnsMin: 14, turnsMax: 20, minValid: 6 };
                    const difficultyLabel = ['', '입문', '기본', '심화', '전문가'][difficulty] || '전문가';
                    const targetDuration = formData.targetDurationMinutes ?? rec.durationMin;
                    const targetTurns = formData.targetTurns ?? rec.turnsMin;
                    const minValid = formData.minValidTurns ?? rec.minValid;
                    const isDurationInRange = targetDuration >= rec.durationMin && targetDuration <= rec.durationMax;
                    const isTurnsInRange = targetTurns >= rec.turnsMin && targetTurns <= rec.turnsMax;
                    // compute slider track percentages for recommended band overlay (max scale 30 turns, 60 min)
                    const durationRecLeft = `${(rec.durationMin / 60) * 100}%`;
                    const durationRecWidth = `${((rec.durationMax - rec.durationMin) / 60) * 100}%`;
                    const turnsRecLeft = `${(rec.turnsMin / 30) * 100}%`;
                    const turnsRecWidth = `${((rec.turnsMax - rec.turnsMin) / 30) * 100}%`;
                    return (
                    <TooltipProvider>
                    <div className="border border-slate-200 rounded-lg p-4 space-y-5 bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-slate-500" />
                          <span className="text-sm font-semibold text-slate-700">대화 시간 설정</span>
                        </div>
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                          {difficultyLabel} 권장: {rec.durationMin}~{rec.durationMax}분 · {rec.turnsMin}~{rec.turnsMax}턴
                        </span>
                      </div>

                      {/* 목표 시간 슬라이더 */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-medium text-slate-600">목표 시간 (분)</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-slate-400 cursor-help text-xs">ⓘ</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                대화의 목표 소요 시간입니다. AI가 평가 시 기준값으로 활용합니다. 권장 범위(초록 구간)는 선택한 난이도에 맞게 자동 계산됩니다.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number" min={1} max={60}
                              value={targetDuration}
                              onChange={(e) => setFormData(prev => ({ ...prev, targetDurationMinutes: Math.max(1, Math.min(60, parseInt(e.target.value) || rec.durationMin)) }))}
                              className={`w-16 h-7 text-xs text-center bg-white ${isDurationInRange ? 'border-green-400' : 'border-amber-300'}`}
                            />
                            <span className="text-xs text-slate-400">분</span>
                            {isDurationInRange
                              ? <span className="text-xs text-green-600 font-medium">✓ 권장 범위</span>
                              : <span className="text-xs text-amber-600 font-medium">권장: {rec.durationMin}~{rec.durationMax}분</span>
                            }
                          </div>
                        </div>
                        <div className="relative pt-1">
                          {/* 권장 범위 초록 밴드 */}
                          <div className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded bg-green-200 pointer-events-none z-10"
                            style={{ left: durationRecLeft, width: durationRecWidth }} />
                          <Slider
                            min={1} max={60} step={1}
                            value={[targetDuration]}
                            onValueChange={([v]) => setFormData(prev => ({ ...prev, targetDurationMinutes: v }))}
                            className="relative z-20"
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 px-0.5">
                          <span>1분</span><span>15분</span><span>30분</span><span>60분</span>
                        </div>
                      </div>

                      {/* 목표 턴 수 슬라이더 */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-medium text-slate-600">목표 턴 수</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-slate-400 cursor-help text-xs">ⓘ</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                한 턴은 학습자의 발화 1회입니다. 목표 턴의 80%에 도달하면 AI가 자연스러운 마무리를 유도합니다. 점수는 목표 대비 실제 대화량을 기준으로 정규화됩니다.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number" min={2} max={30}
                              value={targetTurns}
                              onChange={(e) => setFormData(prev => ({ ...prev, targetTurns: Math.max(2, Math.min(30, parseInt(e.target.value) || rec.turnsMin)) }))}
                              className={`w-16 h-7 text-xs text-center bg-white ${isTurnsInRange ? 'border-green-400' : 'border-amber-300'}`}
                            />
                            <span className="text-xs text-slate-400">턴</span>
                            {isTurnsInRange
                              ? <span className="text-xs text-green-600 font-medium">✓ 권장 범위</span>
                              : <span className="text-xs text-amber-600 font-medium">권장: {rec.turnsMin}~{rec.turnsMax}턴</span>
                            }
                          </div>
                        </div>
                        <div className="relative pt-1">
                          <div className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded bg-green-200 pointer-events-none z-10"
                            style={{ left: turnsRecLeft, width: turnsRecWidth }} />
                          <Slider
                            min={2} max={30} step={1}
                            value={[targetTurns]}
                            onValueChange={([v]) => setFormData(prev => ({ ...prev, targetTurns: v }))}
                            className="relative z-20"
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 px-0.5">
                          <span>2턴</span><span>10턴</span><span>20턴</span><span>30턴</span>
                        </div>
                      </div>

                      {/* 최소 유효 턴 */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Label className="text-xs font-medium text-slate-600">최소 유효 턴</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-slate-400 cursor-help text-xs">ⓘ</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                이 턴 수에 미달하면 역량 점수 대신 &ldquo;대화 분량 부족&rdquo; 안내가 표시됩니다. 목표 턴 수의 30~40%를 권장합니다.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number" min={1} max={targetTurns}
                              value={minValid}
                              onChange={(e) => setFormData(prev => ({ ...prev, minValidTurns: Math.max(1, Math.min(targetTurns, parseInt(e.target.value) || rec.minValid)) }))}
                              className="w-16 h-7 text-xs text-center bg-white"
                            />
                            <span className="text-xs text-slate-400">턴 · 권장 {rec.minValid}턴</span>
                          </div>
                        </div>
                        <Slider
                          min={1} max={targetTurns} step={1}
                          value={[minValid]}
                          onValueChange={([v]) => setFormData(prev => ({ ...prev, minValidTurns: v }))}
                        />
                      </div>

                      <p className="text-[11px] text-slate-400 italic border-t border-slate-200 pt-3">
                        목표 턴의 80% 도달 시 AI가 자연스럽게 마무리를 유도합니다. 점수는 목표 대비 실제 발화량(턴 수 + 문자 수)으로 정규화됩니다.
                      </p>
                    </div>
                    </TooltipProvider>
                    );
                  })()}
                  
                  <div className="flex items-center gap-3">
                    <Switch
                      id="isDemo"
                      checked={formData.isDemo || false}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDemo: checked }))}
                    />
                    <Label htmlFor="isDemo" className="text-sm font-medium text-slate-700 cursor-pointer">
                      {t('admin.scenarioManager.form.isDemo', 'Guest Demo Scenario')}
                    </Label>
                  </div>

                  <div className="flex items-center gap-3">
                    <Switch
                      id="isPublic"
                      checked={formData.isPublic || false}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isPublic: checked }))}
                    />
                    <Label htmlFor="isPublic" className="text-sm font-medium text-slate-700 cursor-pointer">
                      {t('admin.scenarioManager.form.isPublic', '공개 시나리오')}
                    </Label>
                    <span className="text-xs text-slate-500">
                      {formData.isPublic
                        ? t('admin.scenarioManager.form.isPublicOn', '일반 사용자에게 노출됩니다')
                        : t('admin.scenarioManager.form.isPublicOff', '관리자/운영자만 접근 가능합니다')}
                    </span>
                  </div>
                  
                  <div className="border-t pt-3 mt-3 space-y-3">
                    <div className="flex items-center gap-3">
                      <Switch
                        id="storeListed"
                        checked={formData.storeListed || false}
                        onCheckedChange={(checked) => setFormData(prev => ({ ...prev, storeListed: checked }))}
                      />
                      <Star className="h-4 w-4 text-amber-500" />
                      <Label htmlFor="storeListed" className="text-sm font-medium text-slate-700 cursor-pointer">
                        Publish to Store
                      </Label>
                      <span className="text-xs text-slate-500">
                        {formData.storeListed ? 'Listed in content store' : 'Not in store'}
                      </span>
                    </div>
                    {formData.storeListed && (
                      <div className="ml-8 space-y-2">
                        <div className="flex items-center gap-3">
                          <Label className="text-xs text-slate-600 w-24">Price (USD)</Label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            className="border rounded px-2 py-1 text-sm w-24"
                            value={formData.storePriceUsd ?? ''}
                            onChange={e => setFormData(prev => ({ ...prev, storePriceUsd: e.target.value ? parseFloat(e.target.value) : null }))}
                          />
                          <span className="text-xs text-slate-500">0 = free</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <Label className="text-xs text-slate-600 w-24">Pack ID</Label>
                          <input
                            type="text"
                            placeholder="Store pack ID (optional)"
                            className="border rounded px-2 py-1 text-sm flex-1"
                            value={formData.storePackId ?? ''}
                            onChange={e => setFormData(prev => ({ ...prev, storePackId: e.target.value || null }))}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 border-t pt-3 mt-3">
                    {!editingScenario ? (
                      <>
                        <Switch
                          id="autoTranslate"
                          checked={formData.autoTranslate || false}
                          onCheckedChange={(checked) => setFormData(prev => ({ ...prev, autoTranslate: checked }))}
                        />
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-amber-500" />
                          <Label htmlFor="autoTranslate" className="text-sm font-medium text-slate-700 cursor-pointer">
                            {t('admin.evaluationCriteria.autoTranslate')}
                          </Label>
                        </div>
                        <span className="text-xs text-slate-500">
                          {t('admin.evaluationCriteria.autoTranslateDescription')}
                        </span>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => editingScenario?.id && autoTranslateMutation.mutate(editingScenario.id)}
                        disabled={autoTranslateMutation.isPending}
                        className="flex items-center gap-2"
                      >
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        {autoTranslateMutation.isPending 
                          ? t('admin.common.loading')
                          : t('admin.evaluationCriteria.triggerAutoTranslate')
                        }
                      </Button>
                    )}
                  </div>
                </div>

                <div>
                  <Label htmlFor="description" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.scenarioDescription')}</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder={t('admin.scenarioManager.form.scenarioDescriptionPlaceholder')}
                    className="min-h-[100px] bg-white whitespace-pre-wrap"
                    required
                    data-testid="textarea-scenario-description"
                  />
                </div>

                {/* 평가 기준 선택 */}
                <div>
                  <Label htmlFor="evaluationCriteria" className="text-sm font-medium text-slate-700">
                    {t('admin.scenarioManager.form.evaluationCriteria')}
                  </Label>
                  <Select 
                    value={formData.evaluationCriteriaSetId || 'default'} 
                    onValueChange={(val) => setFormData(prev => ({ ...prev, evaluationCriteriaSetId: val === 'default' ? '' : val }))}
                  >
                    <SelectTrigger 
                      className="bg-white"
                      data-testid="select-evaluation-criteria"
                    >
                      <SelectValue placeholder={t('admin.scenarioManager.form.selectEvaluationCriteria')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{t('admin.scenarioManager.form.defaultCriteria', 'Use default criteria')}</SelectItem>
                      {evaluationCriteriaSets?.map(criteria => (
                        <SelectItem key={criteria.id} value={criteria.id} data-testid={`criteria-option-${criteria.id}`}>
                          {criteria.name} {criteria.isDefault && `(${t('common.default', 'Default')})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 mt-1">
                    {t('admin.scenarioManager.form.evaluationCriteriaHelp')}
                  </p>
                </div>
              </div>

              {/* 상황 설정 */}
              <div className="space-y-4 bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900 pb-3 border-b border-slate-200">{t('admin.scenarioManager.form.situationSettings', 'Situation Settings')}</h3>
                
                <div>
                  <Label htmlFor="situation" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.situation')}</Label>
                  <Textarea
                    id="situation"
                    value={formData.context.situation}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      context: { ...prev.context, situation: e.target.value }
                    }))}
                    placeholder={t('admin.scenarioManager.form.situationPlaceholder')}
                    className="min-h-[80px] bg-white whitespace-pre-wrap"
                    data-testid="textarea-situation"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="timeline" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.timeline')}</Label>
                    <Input
                      id="timeline"
                      value={formData.context.timeline}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { ...prev.context, timeline: e.target.value }
                      }))}
                      placeholder={t('admin.scenarioManager.form.timelinePlaceholder')}
                      data-testid="input-timeline"
                      className="bg-white"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="stakes" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.stakes')}</Label>
                    <Input
                      id="stakes"
                      value={formData.context.stakes}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { ...prev.context, stakes: e.target.value }
                      }))}
                      placeholder={t('admin.scenarioManager.form.stakesPlaceholder')}
                      data-testid="input-stakes"
                      className="bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="position" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.playerPosition', 'Player Position')}</Label>
                    <Input
                      id="position"
                      value={formData.context.playerRole.position}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { 
                          ...prev.context, 
                          playerRole: { ...prev.context.playerRole, position: e.target.value }
                        }
                      }))}
                      placeholder={t('admin.scenarioManager.form.playerPositionPlaceholder', 'e.g., Junior Developer')}
                      data-testid="input-position"
                      className="bg-white"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="playerDepartment" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.playerDepartment', 'Player Department')}</Label>
                    <Input
                      id="playerDepartment"
                      value={formData.context.playerRole.department}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { 
                          ...prev.context, 
                          playerRole: { ...prev.context.playerRole, department: e.target.value }
                        }
                      }))}
                      placeholder={t('admin.scenarioManager.form.playerDepartmentPlaceholder', 'e.g., Development Team')}
                      data-testid="input-player-department"
                      className="bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="playerExperience" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.playerExperience', 'Player Experience')}</Label>
                    <Input
                      id="playerExperience"
                      value={formData.context.playerRole.experience}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { 
                          ...prev.context, 
                          playerRole: { ...prev.context.playerRole, experience: e.target.value }
                        }
                      }))}
                      placeholder={t('admin.scenarioManager.form.playerExperiencePlaceholder', 'e.g., 6 months')}
                      data-testid="input-player-experience"
                      className="bg-white"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="responsibility" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.playerResponsibility', 'Responsibility')}</Label>
                    <Input
                      id="responsibility"
                      value={formData.context.playerRole.responsibility}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        context: { 
                          ...prev.context, 
                          playerRole: { ...prev.context.playerRole, responsibility: e.target.value }
                        }
                      }))}
                      placeholder={t('admin.scenarioManager.form.playerResponsibilityPlaceholder', 'e.g., Coordinate with departments')}
                      data-testid="input-responsibility"
                      className="bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* 목표 및 성공 기준 */}
              <div className="space-y-4 bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900 pb-3 border-b border-slate-200">{t('admin.scenarioManager.form.objectivesAndCriteria', 'Objectives & Success Criteria')}</h3>
                
                <div>
                  <Label htmlFor="objectiveType" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.objectiveType')}</Label>
                  <Select 
                    value={formData.objectiveType || ''} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, objectiveType: value }))}
                  >
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder={t('admin.scenarioManager.form.selectObjectiveType')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="역할책임명확화">역할 및 책임 명확화</SelectItem>
                      <SelectItem value="우선순위협의">우선순위 협의 및 합의</SelectItem>
                      <SelectItem value="공정평가기준수립">공정한 평가 기준 수립</SelectItem>
                      <SelectItem value="세대간이해증진">세대 간 상호 이해 증진</SelectItem>
                      <SelectItem value="효과적소통정보공유">효과적 소통 및 정보 공유</SelectItem>
                      <SelectItem value="의사결정표준화">의사결정 프로세스 표준화</SelectItem>
                      <SelectItem value="리더십스타일조정">리더십 스타일 조정</SelectItem>
                      <SelectItem value="공로분배팀워크">공로 분배 및 팀워크 강화</SelectItem>
                      <SelectItem value="정보투명성공유">정보 투명성 및 공유</SelectItem>
                      <SelectItem value="책임소재명확화">책임 소재 명확화</SelectItem>
                      <SelectItem value="업무프로세스조정">업무 프로세스 조정</SelectItem>
                      <SelectItem value="목표정렬">목표 정렬 및 방향성 통일</SelectItem>
                      <SelectItem value="전문성존중학습">전문성 존중 및 학습</SelectItem>
                      <SelectItem value="업무경계협력">업무 경계 설정 및 협력</SelectItem>
                      <SelectItem value="공정한조직문화">공정한 조직 문화 조성</SelectItem>
                      <SelectItem value="신뢰회복감정해소">신뢰 회복 및 감정 해소</SelectItem>
                      <SelectItem value="기여도인정동기부여">기여도 인정 및 동기 부여</SelectItem>
                      <SelectItem value="신뢰관계재구축">신뢰 관계 재구축</SelectItem>
                      <SelectItem value="리소스배분협의">리소스 배분 협의 및 최적화</SelectItem>
                      <SelectItem value="다양성포용성증진">다양성 이해 및 포용성 증진</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="objectives" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.objectives')} ({t('admin.scenarioManager.form.separatedByNewline', 'separated by newline')})</Label>
                  <Textarea
                    id="objectives"
                    value={formData.objectives.join('\n')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      objectives: e.target.value.split('\n').filter(obj => obj.trim())
                    }))}
                    placeholder="각 부서의 이해관계와 우려사항 파악&#10;부서 간 갈등을 중재하고 합의점 도출&#10;품질과 일정을 균형있게 고려한 현실적 해결책 제시"
                    className="min-h-[100px] bg-white whitespace-pre-wrap"
                    data-testid="textarea-objectives"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="optimal" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.optimal')}</Label>
                    <Textarea
                      id="optimal"
                      value={formData.successCriteria.optimal}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, optimal: e.target.value }
                      }))}
                      placeholder="모든 부서가 만족하는 타협안 도출"
                      className="min-h-[60px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-optimal"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="good" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.good')}</Label>
                    <Textarea
                      id="good"
                      value={formData.successCriteria.good}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, good: e.target.value }
                      }))}
                      placeholder="주요 이해관계자들의 핵심 요구사항 반영"
                      className="min-h-[60px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-good"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="acceptable" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.acceptable')}</Label>
                    <Textarea
                      id="acceptable"
                      value={formData.successCriteria.acceptable}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, acceptable: e.target.value }
                      }))}
                      placeholder="최소한의 품질 기준을 유지하면서 일정 준수"
                      className="min-h-[60px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-acceptable"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="failure" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.failure')}</Label>
                    <Textarea
                      id="failure"
                      value={formData.successCriteria.failure}
                      onChange={(e) => setFormData(prev => ({ 
                        ...prev, 
                        successCriteria: { ...prev.successCriteria, failure: e.target.value }
                      }))}
                      placeholder="부서 간 갈등 심화 또는 비현실적 해결책 제시"
                      className="min-h-[60px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-failure"
                    />
                  </div>
                </div>
              </div>

              {/* 역량 및 페르소나 */}
              <div className="space-y-4 bg-white p-6 rounded-lg border border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900 pb-3 border-b border-slate-200">{t('admin.scenarioManager.form.competenciesAndPersonas')}</h3>
                
                <div>
                  <Label htmlFor="skills" className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.skills')} ({t('admin.scenarioManager.form.separatedByComma', 'comma-separated')})</Label>
                  <Input
                    id="skills"
                    value={formData.skills.join(', ')}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      skills: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                    }))}
                    placeholder={t('admin.scenarioManager.form.skillsPlaceholder', 'Conflict mediation, stakeholder management, problem solving, negotiation')}
                    data-testid="input-skills"
                    className="bg-white"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {formData.skills.map((skill, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {skill}
                        <button 
                          type="button"
                          onClick={() => removeSkill(index)}
                          className="ml-1 hover:bg-red-200"
                          data-testid={`remove-skill-${index}`}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <Label className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaManagement')}</Label>
                    <Button
                      type="button"
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          personas: [...prev.personas, {
                            id: '',
                            name: '',
                            gender: 'male',
                            mbti: '',
                            department: '',
                            position: '',
                            experience: '',
                            personaRef: '',
                            stance: '',
                            goal: '',
                            tradeoff: ''
                          }]
                        }));
                      }}
                      variant="outline"
                      size="sm"
                      data-testid="add-persona"
                    >
                      <i className="fas fa-plus mr-1"></i>
                      {t('admin.scenarioManager.form.addPersona')}
                    </Button>
                  </div>
                  
                  {formData.personas.length >= 2 && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-3">
                      <Label className="text-sm font-medium text-slate-700 block mb-2">
                        페르소나 전환 방식
                      </Label>
                      <Select
                        value={formData.personaSwitchMode ?? 'replace'}
                        onValueChange={(value: 'replace' | 'join') =>
                          setFormData(prev => ({ ...prev, personaSwitchMode: value }))
                        }
                      >
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="replace">
                            <div>
                              <div className="font-medium">Replace (교체)</div>
                              <div className="text-xs text-slate-500">다음 페르소나가 이전 페르소나를 교체합니다</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="join">
                            <div>
                              <div className="font-medium">Join (합류)</div>
                              <div className="text-xs text-slate-500">다음 페르소나가 기존 페르소나와 함께 참여합니다</div>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {formData.personas.map((persona, index) => (
                      <div key={index} className="border border-slate-300 rounded-lg p-4 space-y-3 bg-white shadow-sm">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-slate-700">{t('admin.scenarioManager.form.personaNumber', { number: index + 1 })}</h4>
                          <Button
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                personas: prev.personas.filter((_, i) => i !== index)
                              }));
                            }}
                            variant="destructive"
                            size="sm"
                            data-testid={`remove-persona-${index}`}
                          >
                            <i className="fas fa-trash"></i>
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor={`persona-id-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaId')} *</Label>
                            <Select
                              value={persona.id}
                              onValueChange={(selectedId) => {
                                if (selectedId === '__new_persona__') {
                                  handleSaveAndGoToPersona();
                                  return;
                                }
                                const selectedPersona = availablePersonas.find(p => p.id === selectedId);
                                if (selectedPersona) {
                                  const newPersonas = [...formData.personas];
                                  newPersonas[index] = { 
                                    ...persona, 
                                    id: selectedId,
                                    mbti: selectedPersona.mbti.toUpperCase(),
                                    personaRef: selectedId 
                                  };
                                  setFormData(prev => ({ ...prev, personas: newPersonas }));
                                }
                              }}
                            >
                              <SelectTrigger data-testid={`select-persona-id-${index}`} className="bg-white">
                                <SelectValue placeholder={t('admin.scenarioManager.form.selectPersona')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__new_persona__">
                                  <div className="flex items-center gap-2 text-indigo-600 font-medium">
                                    <span>＋</span>
                                    <span>페르소나 신규 생성</span>
                                  </div>
                                </SelectItem>
                                {getAvailablePersonasForSlot(index).length === 0 ? (
                                  <div className="py-2 px-3 text-sm text-slate-500">
                                    {t('admin.scenarioManager.form.noPersonasAvailable')}
                                  </div>
                                ) : (
                                  getAvailablePersonasForSlot(index).map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium">{p.mbti}</span>
                                        <span className="text-xs text-slate-500">({p.id})</span>
                                      </div>
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-name-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaName', 'Name')} *</Label>
                            <Input
                              id={`persona-name-${index}`}
                              value={persona.name}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, name: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder={t('admin.scenarioManager.form.personaNamePlaceholder', 'e.g., John Doe')}
                              data-testid={`input-persona-name-${index}`}
                              className="bg-white"
                            />
                          </div>

                          <div>
                            <Label htmlFor={`persona-gender-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaGender', 'Gender')} *</Label>
                            <Select
                              value={persona.gender}
                              onValueChange={(value: 'male' | 'female') => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, gender: value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                            >
                              <SelectTrigger data-testid={`select-persona-gender-${index}`} className="bg-white">
                                <SelectValue placeholder={t('admin.scenarioManager.form.selectGender', 'Select gender')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="male">{t('admin.personaManager.male')}</SelectItem>
                                <SelectItem value="female">{t('admin.personaManager.female')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-department-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaDepartment')} *</Label>
                            <Input
                              id={`persona-department-${index}`}
                              value={persona.department}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, department: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder={t('admin.scenarioManager.form.personaDepartmentPlaceholder')}
                              data-testid={`input-persona-department-${index}`}
                              className="bg-white"
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-position-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaPosition')} *</Label>
                            <Input
                              id={`persona-position-${index}`}
                              value={persona.position}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, position: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder={t('admin.scenarioManager.form.personaPositionPlaceholder')}
                              data-testid={`input-persona-position-${index}`}
                              className="bg-white"
                            />
                          </div>
                          
                          <div>
                            <Label htmlFor={`persona-experience-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaExperience', 'Experience')}</Label>
                            <Input
                              id={`persona-experience-${index}`}
                              value={persona.experience}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, experience: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder={t('admin.scenarioManager.form.personaExperiencePlaceholder', 'e.g., 8 years, junior, 5 years')}
                              data-testid={`input-persona-experience-${index}`}
                              className="bg-white"
                            />
                          </div>
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-stance-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaStance')} *</Label>
                          <Textarea
                            id={`persona-stance-${index}`}
                            value={persona.stance}
                            onChange={(e) => {
                              const newPersonas = [...formData.personas];
                              newPersonas[index] = { ...persona, stance: e.target.value };
                              setFormData(prev => ({ ...prev, personas: newPersonas }));
                            }}
                            placeholder={t('admin.scenarioManager.form.personaStancePlaceholder')}
                            rows={2}
                            data-testid={`input-persona-stance-${index}`}
                            className="bg-white whitespace-pre-wrap"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-goal-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaGoal')} *</Label>
                          <Textarea
                            id={`persona-goal-${index}`}
                            value={persona.goal}
                            onChange={(e) => {
                              const newPersonas = [...formData.personas];
                              newPersonas[index] = { ...persona, goal: e.target.value };
                              setFormData(prev => ({ ...prev, personas: newPersonas }));
                            }}
                            placeholder={t('admin.scenarioManager.form.personaGoalPlaceholder')}
                            rows={2}
                            data-testid={`input-persona-goal-${index}`}
                            className="bg-white whitespace-pre-wrap"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor={`persona-tradeoff-${index}`} className="text-sm font-medium text-slate-700">{t('admin.scenarioManager.form.personaTradeoff')}</Label>
                          <Textarea
                            id={`persona-tradeoff-${index}`}
                            value={persona.tradeoff}
                            onChange={(e) => {
                              const newPersonas = [...formData.personas];
                              newPersonas[index] = { ...persona, tradeoff: e.target.value };
                              setFormData(prev => ({ ...prev, personas: newPersonas }));
                            }}
                            placeholder={t('admin.scenarioManager.form.personaTradeoffPlaceholder')}
                            rows={2}
                            data-testid={`input-persona-tradeoff-${index}`}
                            className="bg-white whitespace-pre-wrap"
                          />
                        </div>

                        {/* Multi-persona switching fields */}
                        <div className="border-t border-slate-200 pt-3 mt-1">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Multi-Persona Switching</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`persona-isprimary-${index}`}
                                checked={!!persona.isPrimary}
                                onChange={(e) => {
                                  const newPersonas = [...formData.personas];
                                  if (e.target.checked) {
                                    newPersonas.forEach((p, i) => {
                                      newPersonas[i] = { ...p, isPrimary: i === index };
                                    });
                                  } else {
                                    const otherPrimaryExists = newPersonas.some((p, i) => i !== index && !!p.isPrimary);
                                    if (otherPrimaryExists) {
                                      newPersonas[index] = { ...persona, isPrimary: false };
                                    }
                                  }
                                  setFormData(prev => ({ ...prev, personas: newPersonas }));
                                }}
                                className="rounded border-slate-300"
                              />
                              <Label htmlFor={`persona-isprimary-${index}`} className="text-sm font-medium text-slate-700">Primary Persona</Label>
                            </div>
                            <div>
                              <Label htmlFor={`persona-voiceid-${index}`} className="text-sm font-medium text-slate-700">Voice ID (ElevenLabs)</Label>
                              <Input
                                id={`persona-voiceid-${index}`}
                                value={persona.voiceId ?? ''}
                                onChange={(e) => {
                                  const newPersonas = [...formData.personas];
                                  newPersonas[index] = { ...persona, voiceId: e.target.value };
                                  setFormData(prev => ({ ...prev, personas: newPersonas }));
                                }}
                                placeholder="Optional voice ID override"
                                className="bg-white"
                              />
                            </div>
                          </div>
                          <div className="mt-2">
                            <Label htmlFor={`persona-entryline-${index}`} className="text-sm font-medium text-slate-700">Entry Line</Label>
                            <Input
                              id={`persona-entryline-${index}`}
                              value={persona.entryLine ?? ''}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                newPersonas[index] = { ...persona, entryLine: e.target.value };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder="First line said when this persona enters (e.g. 'Hello, I'm here to help...')"
                              className="bg-white"
                            />
                          </div>
                          <div className="mt-2">
                            <Label htmlFor={`persona-triggerhints-${index}`} className="text-sm font-medium text-slate-700">Trigger Hints (one per line)</Label>
                            <Textarea
                              id={`persona-triggerhints-${index}`}
                              value={(persona.triggerHints ?? []).join('\n')}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                const hints = e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean);
                                newPersonas[index] = { ...persona, triggerHints: hints };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder={"Enter phrases that should trigger switching to this persona\ne.g. 'budget approval'\n'legal review needed'"}
                              rows={3}
                              className="bg-white whitespace-pre-wrap text-sm"
                            />
                          </div>
                          <div className="mt-2">
                            <Label htmlFor={`persona-npcbehaviorharness-${index}`} className="text-sm font-medium text-slate-700">
                              NPC Behavior Harness <span className="text-xs text-slate-400 font-normal">(JSON, 선택사항)</span>
                            </Label>
                            <Textarea
                              id={`persona-npcbehaviorharness-${index}`}
                              value={persona.npcBehaviorHarness ? JSON.stringify(persona.npcBehaviorHarness, null, 2) : ''}
                              onChange={(e) => {
                                const newPersonas = [...formData.personas];
                                let parsed: any = null;
                                if (e.target.value.trim()) {
                                  try { parsed = JSON.parse(e.target.value); } catch { parsed = e.target.value; }
                                }
                                newPersonas[index] = { ...persona, npcBehaviorHarness: parsed };
                                setFormData(prev => ({ ...prev, personas: newPersonas }));
                              }}
                              placeholder={'{\n  "emotionVolatility": 0.8,\n  "resistanceLevel": "high",\n  "allowedEmotionRange": ["angry", "frustrated"]\n}'}
                              rows={4}
                              className="bg-white font-mono text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    {formData.personas.length === 0 && (
                      <div className="text-center py-8 text-slate-500">
                        <i className="fas fa-users text-4xl mb-2"></i>
                        <p>{t('admin.scenarioManager.form.personaRequired')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Simulation Policy: simulationHarness structured editor */}
              <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-800 text-sm mb-0.5">시뮬레이션 정책 (선택사항)</h3>
                    <p className="text-xs text-slate-500">시나리오별 감정 모델, 도구 호출 상한, 허용 이벤트를 설정합니다. 비활성화하면 전역 기본값이 적용됩니다.</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    <label className="text-xs text-slate-600 font-medium">사용</label>
                    <input type="checkbox" checked={harnessEnabled} onChange={e => setHarnessEnabled(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                  </div>
                </div>

                {harnessEnabled && (
                  <div className="space-y-4">
                    {/* Emotion Model */}
                    <div>
                      <Label className="text-xs font-semibold text-slate-700 mb-1 block">감정 모델 (쉼표로 구분)</Label>
                      <Input
                        value={harnessEmotionModel}
                        onChange={e => setHarnessEmotionModel(e.target.value)}
                        placeholder="anger,trust,confusion,interest"
                        className="text-xs h-8"
                      />
                      <p className="text-xs text-slate-400 mt-0.5">AI가 조절할 감정 축 목록 (기본: anger, trust, confusion, interest)</p>
                    </div>

                    {/* Emotion Tool Limits */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold text-slate-700 mb-1 block">턴당 감정 업데이트 횟수 (최대)</Label>
                        <Input
                          type="number"
                          min={1} max={10}
                          value={harnessMaxCallsPerTurn}
                          onChange={e => setHarnessMaxCallsPerTurn(e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-slate-700 mb-1 block">호출당 감정 변화량 상한 (1–100)</Label>
                        <Input
                          type="number"
                          min={1} max={100}
                          value={harnessMaxDeltaPerCall}
                          onChange={e => setHarnessMaxDeltaPerCall(e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                    </div>

                    {/* Allowed Incident Types */}
                    <div>
                      <Label className="text-xs font-semibold text-slate-700 mb-1 block">허용 이벤트 유형</Label>
                      <div className="grid grid-cols-2 gap-y-1 gap-x-3">
                        {HARNESS_ALL_INCIDENT_TYPES.map(type => (
                          <label key={type} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={harnessAllowedTypes.includes(type)}
                              onChange={e => {
                                if (e.target.checked) {
                                  setHarnessAllowedTypes(prev => [...prev, type]);
                                } else {
                                  setHarnessAllowedTypes(prev => prev.filter(t => t !== type));
                                }
                              }}
                              className="h-3.5 w-3.5 accent-blue-600"
                            />
                            {type}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Cooldowns */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-semibold text-slate-700 mb-1 block">전역 이벤트 쿨다운 (초)</Label>
                        <Input
                          type="number" min={0}
                          value={harnessGlobalCooldownSec}
                          onChange={e => setHarnessGlobalCooldownSec(e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-semibold text-slate-700 mb-1 block">동일 유형 이벤트 쿨다운 (초)</Label>
                        <Input
                          type="number" min={0}
                          value={harnessPerTypeCooldownSec}
                          onChange={e => setHarnessPerTypeCooldownSec(e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                    </div>

                    {/* State Updates Enabled */}
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={harnessStateUpdatesEnabled}
                        onChange={e => setHarnessStateUpdatesEnabled(e.target.checked)}
                        className="h-4 w-4 accent-blue-600"
                      />
                      <Label className="text-xs font-semibold text-slate-700 cursor-pointer">시나리오 상태 업데이트 허용 (update_scenario_state)</Label>
                    </div>

                    {/* Preferred Signals */}
                    <div>
                      <Label className="text-xs font-semibold text-slate-700 mb-1 block">선호 신호 (preferredSignals, 선택사항)</Label>
                      {harnessPreferredSignals.map((sig, idx) => (
                        <div key={idx} className="flex gap-2 mb-1">
                          <Input
                            placeholder="감정 축 (예: anger)"
                            value={sig.key}
                            onChange={e => setHarnessPreferredSignals(prev => prev.map((s, i) => i === idx ? { ...s, key: e.target.value } : s))}
                            className="text-xs h-7 flex-1"
                          />
                          <Input
                            placeholder="신호 설명"
                            value={sig.value}
                            onChange={e => setHarnessPreferredSignals(prev => prev.map((s, i) => i === idx ? { ...s, value: e.target.value } : s))}
                            className="text-xs h-7 flex-1"
                          />
                          <button type="button" onClick={() => setHarnessPreferredSignals(prev => prev.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-500 text-xs px-1">✕</button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setHarnessPreferredSignals(prev => [...prev, { key: '', value: '' }])}
                        className="text-xs text-blue-600 hover:text-blue-800 mt-1"
                      >+ 신호 추가</button>
                    </div>

                    {/* Effective Settings Live Preview — editable inline (structured mode) */}
                    {!harnessShowRaw && harnessEffective?.valid && (
                      <div className="pt-2 border-t border-slate-100">
                        <p className="text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">적용될 실제 값 미리보기 <span className="normal-case font-normal text-blue-500">(직접 편집 가능)</span></p>
                        <div className="bg-slate-50 rounded-md p-3 text-xs space-y-2.5 text-slate-700">

                          {/* Emotion Model — removable chips + add input */}
                          <div>
                            <span className="font-medium text-slate-500 block mb-1">감정 축:</span>
                            <div className="flex gap-1 flex-wrap items-center">
                              {harnessEffective.emotionModel!.map(e => (
                                <span key={e} className="inline-flex items-center gap-0.5 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  {e}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = harnessEffective.emotionModel!.filter(x => x !== e);
                                      setHarnessEmotionModel(updated.join(','));
                                    }}
                                    className="ml-0.5 text-blue-400 hover:text-red-500 leading-none"
                                    title="제거"
                                  >×</button>
                                </span>
                              ))}
                              <input
                                type="text"
                                value={previewEmotionInput}
                                onChange={e => setPreviewEmotionInput(e.target.value)}
                                onKeyDown={e => {
                                  if ((e.key === 'Enter' || e.key === ',') && previewEmotionInput.trim()) {
                                    e.preventDefault();
                                    const name = previewEmotionInput.trim().replace(/,/g, '');
                                    if (name && !harnessEffective.emotionModel!.includes(name)) {
                                      setHarnessEmotionModel([...harnessEffective.emotionModel!, name].join(','));
                                    }
                                    setPreviewEmotionInput('');
                                  }
                                }}
                                placeholder="+ 추가"
                                className="border border-dashed border-slate-300 rounded px-1.5 py-0.5 text-xs w-20 focus:outline-none focus:border-blue-400 bg-white"
                              />
                            </div>
                          </div>

                          {/* Numeric fields row */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <label className="flex items-center gap-2">
                              <span className="font-medium text-slate-500 shrink-0">턴당 최대 호출:</span>
                              <input
                                type="number"
                                min={1} max={20}
                                value={harnessMaxCallsPerTurn}
                                onChange={e => setHarnessMaxCallsPerTurn(e.target.value)}
                                className="w-14 border border-slate-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400 bg-white"
                              />
                            </label>
                            <label className="flex items-center gap-2">
                              <span className="font-medium text-slate-500 shrink-0">호출당 변화량:</span>
                              <input
                                type="number"
                                min={1} max={100}
                                value={harnessMaxDeltaPerCall}
                                onChange={e => setHarnessMaxDeltaPerCall(e.target.value)}
                                className="w-14 border border-slate-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400 bg-white"
                              />
                            </label>
                            <label className="flex items-center gap-2">
                              <span className="font-medium text-slate-500 shrink-0">전역 쿨다운:</span>
                              <input
                                type="number"
                                min={0}
                                value={harnessGlobalCooldownSec}
                                onChange={e => setHarnessGlobalCooldownSec(e.target.value)}
                                className="w-16 border border-slate-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400 bg-white"
                              />
                              <span className="text-slate-400">초</span>
                            </label>
                            <label className="flex items-center gap-2">
                              <span className="font-medium text-slate-500 shrink-0">유형 쿨다운:</span>
                              <input
                                type="number"
                                min={0}
                                value={harnessPerTypeCooldownSec}
                                onChange={e => setHarnessPerTypeCooldownSec(e.target.value)}
                                className="w-16 border border-slate-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-blue-400 bg-white"
                              />
                              <span className="text-slate-400">초</span>
                            </label>
                          </div>

                          {/* State updates toggle */}
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <span className="font-medium text-slate-500">상태 업데이트:</span>
                            <input
                              type="checkbox"
                              checked={harnessStateUpdatesEnabled}
                              onChange={e => setHarnessStateUpdatesEnabled(e.target.checked)}
                              className="h-3.5 w-3.5 accent-blue-600"
                            />
                            <span className={harnessStateUpdatesEnabled ? 'text-green-600' : 'text-slate-400'}>
                              {harnessStateUpdatesEnabled ? '허용' : '비허용'}
                            </span>
                          </label>

                          {/* Allowed incident types — toggleable chips */}
                          <div>
                            <span className="font-medium text-slate-500 block mb-1">허용 이벤트 ({harnessAllowedTypes.length}):</span>
                            <div className="flex flex-wrap gap-1">
                              {HARNESS_ALL_INCIDENT_TYPES.map(type => {
                                const active = harnessAllowedTypes.includes(type);
                                return (
                                  <button
                                    key={type}
                                    type="button"
                                    onClick={() => {
                                      if (active) {
                                        setHarnessAllowedTypes(prev => prev.filter(t => t !== type));
                                      } else {
                                        setHarnessAllowedTypes(prev => [...prev, type]);
                                      }
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[11px] border transition-colors ${
                                      active
                                        ? 'bg-indigo-100 text-indigo-700 border-indigo-300 hover:bg-indigo-200'
                                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600'
                                    }`}
                                  >
                                    {type}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Preferred signals (read-only display — edited above) */}
                          {Object.keys(harnessEffective.preferredSignals!).length > 0 && (
                            <div>
                              <span className="font-medium text-slate-500">선호 신호:</span>{' '}
                              {Object.entries(harnessEffective.preferredSignals!).map(([k, v]) => (
                                <span key={k} className="mr-1.5"><span className="font-mono text-blue-600">{k}</span>: {v}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {harnessWarnings.length > 0 && (
                          <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
                            {harnessWarnings.map((w, i) => (
                              <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                                <span className="shrink-0 mt-0.5">⚠</span>
                                <span>{w}</span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Raw JSON fallback toggle */}
                    <div className="pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          if (!harnessShowRaw) {
                            const emotionModel = harnessEmotionModel.split(',').map(s => s.trim()).filter(Boolean);
                            const preferredSignals: Record<string, string> = {};
                            harnessPreferredSignals.forEach(({ key, value }) => { if (key.trim()) preferredSignals[key.trim()] = value; });
                            const built: any = { emotionModel, toolPolicy: {
                              updateNpcEmotion: { maxCallsPerTurn: parseInt(harnessMaxCallsPerTurn) || 2, maxDeltaPerCall: parseInt(harnessMaxDeltaPerCall) || 30 },
                              triggerIncident: { allowedTypes: harnessAllowedTypes, cooldownOverride: { globalCooldownSec: parseInt(harnessGlobalCooldownSec) || 60, perTypeCooldownSec: parseInt(harnessPerTypeCooldownSec) || 120 } },
                              updateScenarioState: { enabled: harnessStateUpdatesEnabled },
                            }};
                            if (Object.keys(preferredSignals).length > 0) built.preferredSignals = preferredSignals;
                            setHarnessRawJson(JSON.stringify(built, null, 2));
                          }
                          setHarnessShowRaw(v => !v);
                        }}
                        className="text-xs text-slate-500 hover:text-slate-700 underline"
                      >{harnessShowRaw ? '← 구조화 편집기로 돌아가기' : '고급: JSON 직접 편집'}</button>
                      {harnessShowRaw && (
                        <div className="mt-2 flex gap-3 items-start">
                          <div className="flex-1 min-w-0">
                            <Textarea
                              value={harnessRawJson}
                              onChange={e => { setHarnessRawJson(e.target.value); setHarnessRawJsonError(''); }}
                              rows={10}
                              className={`bg-white font-mono text-xs ${harnessRawJsonError ? 'border-red-400' : ''}`}
                            />
                            {harnessRawJsonError && <p className="text-xs text-red-500 mt-1">{harnessRawJsonError}</p>}
                          </div>
                          {/* Live preview panel for raw JSON mode */}
                          <div className="w-56 shrink-0 bg-slate-50 rounded-md p-3 text-xs border border-slate-200">
                            <p className="font-semibold text-slate-500 mb-2 uppercase tracking-wide text-[10px]">실시간 미리보기</p>
                            {!harnessEffective?.valid ? (
                              <div className="space-y-1">
                                {'parseError' in (harnessEffective ?? {}) && (
                                  <p className="text-red-500 font-medium">{(harnessEffective as any).parseError}</p>
                                )}
                                {harnessEffective && !('parseError' in harnessEffective) && Object.entries(harnessEffective.fieldErrors ?? {}).length > 0 && (
                                  <div>
                                    <p className="text-red-500 font-medium mb-1">스키마 오류:</p>
                                    {Object.entries(harnessEffective.fieldErrors!).map(([path, msg]) => (
                                      <p key={path} className="text-red-400"><span className="font-mono">{path || '(root)'}</span>: {msg}</p>
                                    ))}
                                  </div>
                                )}
                                {!harnessEffective && <p className="text-slate-400 italic">JSON을 입력하세요</p>}
                              </div>
                            ) : (
                              <div className="space-y-2 text-slate-700">
                                {harnessEffective.usingDefaults && (
                                  <p className="text-amber-600 text-[10px]">비어있음 — 기본값 표시 중</p>
                                )}
                                {harnessWarnings.length > 0 && (
                                  <div className="rounded bg-amber-50 border border-amber-200 px-2 py-1.5 space-y-1">
                                    {harnessWarnings.map((w, i) => (
                                      <p key={i} className="text-[10px] text-amber-700 flex items-start gap-1">
                                        <span className="shrink-0">⚠</span>
                                        <span>{w}</span>
                                      </p>
                                    ))}
                                  </div>
                                )}
                                <div>
                                  <p className="text-slate-400 text-[10px] mb-0.5">감정 축</p>
                                  <div className="flex flex-wrap gap-0.5">
                                    {harnessEffective.emotionModel!.map(e => (
                                      <span key={e} className="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[10px]">{e}</span>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-slate-400 text-[10px] mb-0.5">도구 정책</p>
                                  <p>호출/턴: <span className="font-semibold">{harnessEffective.maxCallsPerTurn}</span></p>
                                  <p>변화량: <span className="font-semibold">{harnessEffective.maxDeltaPerCall}</span></p>
                                  <p>전역 쿨다운: <span className="font-semibold">{harnessEffective.globalCooldownSec}s</span></p>
                                  <p>유형 쿨다운: <span className="font-semibold">{harnessEffective.perTypeCooldownSec}s</span></p>
                                  <p>상태 업데이트: <span className={`font-semibold ${harnessEffective.stateUpdatesEnabled ? 'text-green-600' : 'text-slate-400'}`}>{harnessEffective.stateUpdatesEnabled ? '✓' : '✗'}</span></p>
                                </div>
                                <div>
                                  <p className="text-slate-400 text-[10px] mb-0.5">허용 이벤트 ({harnessEffective.allowedTypes!.length})</p>
                                  <p className="text-slate-600 leading-relaxed">{harnessEffective.allowedTypes!.join(', ') || '없음'}</p>
                                </div>
                                {Object.keys(harnessEffective.preferredSignals!).length > 0 && (
                                  <div>
                                    <p className="text-slate-400 text-[10px] mb-0.5">선호 신호</p>
                                    {Object.entries(harnessEffective.preferredSignals!).map(([k, v]) => (
                                      <p key={k}><span className="font-mono text-blue-600">{k}</span>: {v}</p>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* State Machine: flowGraph & personaSwitchRules JSON editors */}
              <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-4">
                <div>
                  <h3 className="font-semibold text-slate-800 text-sm mb-1">State Machine (선택사항)</h3>
                  <p className="text-xs text-slate-500 mb-3">flowGraph와 personaSwitchRules를 JSON으로 입력하면 서버가 단계 전환과 페르소나 전환을 자동 제어합니다. 비워두면 기존 동작을 유지합니다.</p>
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                    flowGraph
                    <span className="text-xs text-slate-400 font-normal">(대화 단계 전환 상태 머신)</span>
                  </Label>
                  <p className="text-xs text-slate-400 mb-1">예: {`{"stages":[{"id":"intro","goal":"목표","exitConditions":[{"type":"turn_count","operator":"gte","value":3}],"nextStage":"conflict"}]}`}</p>
                  <Textarea
                    value={flowGraphJson}
                    onChange={(e) => {
                      setFlowGraphJson(e.target.value);
                      setFlowGraphError('');
                    }}
                    placeholder={'{\n  "stages": [\n    {\n      "id": "intro",\n      "goal": "...",\n      "exitConditions": [...],\n      "nextStage": "conflict"\n    }\n  ]\n}'}
                    rows={6}
                    className={`bg-white font-mono text-xs ${flowGraphError ? 'border-red-400' : ''}`}
                  />
                  {flowGraphError && <p className="text-xs text-red-500 mt-1">{flowGraphError}</p>}
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                    personaSwitchRules
                    <span className="text-xs text-slate-400 font-normal">(페르소나 자동 전환 규칙)</span>
                  </Label>
                  <p className="text-xs text-slate-400 mb-1">예: {`{"rules":[{"id":"r1","targetPersonaIndex":1,"conditions":[{"metric":"npcEmotions.anger","operator":"gte","value":70}],"reason":"화남","lockAfterSwitch":true}]}`}</p>
                  <Textarea
                    value={personaSwitchRulesJson}
                    onChange={(e) => {
                      setPersonaSwitchRulesJson(e.target.value);
                      setPersonaSwitchRulesError('');
                    }}
                    placeholder={'{\n  "rules": [\n    {\n      "id": "rule-1",\n      "targetPersonaIndex": 1,\n      "conditions": [\n        {"metric": "npcEmotions.anger", "operator": "gte", "value": 70}\n      ],\n      "reason": "Anger threshold reached",\n      "lockAfterSwitch": true\n    }\n  ]\n}'}
                    rows={6}
                    className={`bg-white font-mono text-xs ${personaSwitchRulesError ? 'border-red-400' : ''}`}
                  />
                  {personaSwitchRulesError && <p className="text-xs text-red-500 mt-1">{personaSwitchRulesError}</p>}
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                    evaluationHarness
                    <span className="text-xs text-slate-400 font-normal">(점수 기준 가중치 및 신호 재정의)</span>
                  </Label>
                  <p className="text-xs text-slate-400 mb-1">예: {`{"dimensions":[{"key":"clarity","weight":2}],"passingRule":{"minAverageScore":60}}`}</p>
                  <EvaluationHarnessPreview json={evaluationHarnessJson} />
                  <Textarea
                    value={evaluationHarnessJson}
                    onChange={(e) => {
                      setEvaluationHarnessJson(e.target.value);
                      setEvaluationHarnessError('');
                    }}
                    placeholder={'{\n  "dimensions": [\n    {\n      "key": "clarity",\n      "weight": 2,\n      "scenarioSpecificDefinition": "..."\n    }\n  ],\n  "passingRule": {\n    "minAverageScore": 60\n  }\n}'}
                    rows={6}
                    className={`bg-white font-mono text-xs ${evaluationHarnessError ? 'border-red-400' : ''}`}
                  />
                  {evaluationHarnessError && <p className="text-xs text-red-500 mt-1">{evaluationHarnessError}</p>}
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                    terminationRules
                    <span className="text-xs text-slate-400 font-normal">(자동 종료 조건)</span>
                  </Label>
                  <p className="text-xs text-slate-400 mb-1">예: {`{"success":{"npcEmotions":{"trust":{"operator":"gte","value":80}}},"timeout":{"maxTurns":10}}`}</p>
                  <TerminationRulesPreview json={terminationRulesJson} />
                  <Textarea
                    value={terminationRulesJson}
                    onChange={(e) => {
                      setTerminationRulesJson(e.target.value);
                      setTerminationRulesError('');
                    }}
                    placeholder={'{\n  "success": {\n    "npcEmotions": {"trust": {"operator": "gte", "value": 80}},\n    "logic": "all"\n  },\n  "failure": {\n    "consecutiveTurnsBelow": {"scoreThreshold": 30, "turns": 3}\n  },\n  "timeout": {"maxTurns": 10}\n}'}
                    rows={7}
                    className={`bg-white font-mono text-xs ${terminationRulesError ? 'border-red-400' : ''}`}
                  />
                  {terminationRulesError && <p className="text-xs text-red-500 mt-1">{terminationRulesError}</p>}
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                    playerConstraints
                    <span className="text-xs text-slate-400 font-normal">(플레이어 행동 제약)</span>
                  </Label>
                  <p className="text-xs text-slate-400 mb-1">예: {`{"forbiddenPhrases":["욕설","협박"],"requiredEtiquette":["경어 사용"],"turnTimeLimit":60}`}</p>
                  <Textarea
                    value={playerConstraintsJson}
                    onChange={(e) => {
                      setPlayerConstraintsJson(e.target.value);
                      setPlayerConstraintsError('');
                    }}
                    placeholder={'{\n  "forbiddenPhrases": ["욕설", "협박"],\n  "requiredEtiquette": ["경어 사용"],\n  "turnTimeLimit": 60\n}'}
                    rows={5}
                    className={`bg-white font-mono text-xs ${playerConstraintsError ? 'border-red-400' : ''}`}
                  />
                  {playerConstraintsError && <p className="text-xs text-red-500 mt-1">{playerConstraintsError}</p>}
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 flex items-center gap-1">
                    difficultyProfile
                    <span className="text-xs text-slate-400 font-normal">(난이도 프로파일)</span>
                  </Label>
                  <p className="text-xs text-slate-400 mb-1">예: {`{"incidentProbabilityMultiplier":1.5,"npcResponseDelayMs":500,"scoreThresholds":{"pass":60,"excellent":85}}`}</p>
                  <Textarea
                    value={difficultyProfileJson}
                    onChange={(e) => {
                      setDifficultyProfileJson(e.target.value);
                      setDifficultyProfileError('');
                    }}
                    placeholder={'{\n  "incidentProbabilityMultiplier": 1.0,\n  "npcResponseDelayMs": 0,\n  "scoreThresholds": {"pass": 60, "excellent": 85}\n}'}
                    rows={5}
                    className={`bg-white font-mono text-xs ${difficultyProfileError ? 'border-red-400' : ''}`}
                  />
                  {difficultyProfileError && <p className="text-xs text-red-500 mt-1">{difficultyProfileError}</p>}
                </div>
              </div>

              {/* Analytics Spec Section */}
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-violet-800 flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-violet-500" />
                  분석 지표 스펙 (analyticsSpec)
                </h3>

                <div>
                  <Label className="text-sm font-medium text-slate-700 mb-2 block">추적 지표 (trackedMetrics)</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {TRACKED_METRICS.map((metric) => (
                      <label key={metric} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-violet-600"
                          checked={analyticsTrackedMetrics.includes(metric)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAnalyticsTrackedMetrics(prev => [...prev, metric]);
                            } else {
                              setAnalyticsTrackedMetrics(prev => prev.filter(m => m !== metric));
                            }
                          }}
                        />
                        <span className="text-xs text-slate-700">{metric}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 mb-2 block">보고서 섹션 (reportSections)</Label>
                  <p className="text-xs text-slate-400 mb-2">선택된 섹션만 피드백 리포트에 표시됩니다. 비워두면 모든 섹션이 표시됩니다.</p>
                  <div className="flex flex-wrap gap-2">
                    {REPORT_SECTIONS.map((sec) => (
                      <label key={sec} className="flex items-center gap-1.5 cursor-pointer bg-white border border-slate-200 rounded-lg px-3 py-1.5 select-none hover:border-violet-300 transition-colors">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-slate-300 text-violet-600"
                          checked={analyticsReportSections.includes(sec)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAnalyticsReportSections(prev => [...prev, sec]);
                            } else {
                              setAnalyticsReportSections(prev => prev.filter(s => s !== sec));
                            }
                          }}
                        />
                        <span className="text-xs text-slate-700">{sec}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium text-slate-700 mb-1 block">벤치마크 그룹 (benchmarkGroup)</Label>
                  <p className="text-xs text-slate-400 mb-2">동일 그룹 시나리오끼리 평균 점수를 비교합니다. 예: <code className="bg-slate-100 px-1 rounded">customer-complaint</code></p>
                  <input
                    type="text"
                    value={analyticsBenchmarkGroup}
                    onChange={(e) => setAnalyticsBenchmarkGroup(e.target.value)}
                    placeholder="예: customer-complaint"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setEditingScenario(null);
                    resetForm();
                  }}
                  data-testid="button-cancel"
                >
                  {t('admin.common.cancel')}
                </Button>
                <Button
                  type="submit"
                  className="bg-corporate-600 hover:bg-corporate-700"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-save-scenario"
                >
                  {editingScenario ? t('admin.scenarioManager.editScenario') : t('admin.scenarioManager.addScenario')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* 시나리오 목록 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        {scenarios?.map((scenario) => {
          const isExpanded = expandedScenarios.has(scenario.id);
          const toggleExpand = () => {
            setExpandedScenarios(prev => {
              const next = new Set(prev);
              if (next.has(scenario.id)) {
                next.delete(scenario.id);
              } else {
                next.add(scenario.id);
              }
              return next;
            });
          };
          
          const completeness = getCompleteness(scenario);
          const stats = statsMap.get(String(scenario.id));
          const unused = isUnused(String(scenario.id));
          const validation = validationMap[String(scenario.id)];
          
          return (
            <Card 
              key={scenario.id} 
              className="group relative overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-gradient-to-br from-white to-slate-50"
            >
              <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-corporate-500 to-corporate-600" />
              
              <CardHeader className="pb-3 pl-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-2">
                      <CardTitle className="text-base font-semibold text-slate-800 line-clamp-2 leading-tight flex-1">
                        {scenario.title}
                      </CardTitle>
                      {validation && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                className={`text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer border ${
                                  validation.score >= 80
                                    ? 'bg-green-50 text-green-700 border-green-300'
                                    : validation.score >= 60
                                    ? 'bg-yellow-50 text-yellow-700 border-yellow-300'
                                    : 'bg-red-50 text-red-700 border-red-300'
                                }`}
                              >
                                품질 {validation.score}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs p-3 space-y-1.5">
                              <p className="font-semibold text-sm">품질 점수: {validation.score}/100</p>
                              {validation.issues.length === 0 ? (
                                <p className="text-xs text-green-700">모든 항목 통과</p>
                              ) : (
                                <ul className="space-y-1">
                                  {validation.issues.map((issue) => (
                                    <li key={issue.key} className="text-xs flex items-start gap-1">
                                      <span className={
                                        issue.severity === 'error' ? 'text-red-600' :
                                        issue.severity === 'warning' ? 'text-yellow-600' :
                                        'text-blue-600'
                                      }>
                                        {issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'}
                                      </span>
                                      <span className="text-slate-700">{issue.message}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {unused && (
                        <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-500 border-slate-200 whitespace-nowrap shrink-0">
                          미사용
                        </Badge>
                      )}
                    </div>
                    
                    {/* 완성도 표시기 */}
                    <div className="mb-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Progress value={completeness.percent} className="h-1.5 flex-1" />
                        <span className={`text-xs font-medium ${completeness.percent === 100 ? 'text-green-600' : completeness.percent >= 75 ? 'text-amber-600' : 'text-red-500'}`}>
                          {completeness.percent}%
                        </span>
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {completeness.checks.filter(c => !c.ok).map(c => (
                          <span key={c.key} className="inline-flex items-center gap-0.5 text-xs text-red-500 bg-red-50 rounded px-1 py-0.5">
                            <c.icon className="w-3 h-3" />
                            {c.label} 없음
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex items-center flex-wrap gap-2 text-sm text-slate-500">
                      {categories && (scenario as any).categoryId && (
                        <Badge variant="outline" className="text-xs bg-slate-50 text-slate-700 border-slate-200">
                          <Folder className="w-3 h-3 mr-1" />
                          {categories.find(c => String(c.id) === String((scenario as any).categoryId))?.name || '미분류'}
                        </Badge>
                      )}
                      <div
                        className="flex items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Switch
                          checked={(scenario as any).isPublic || false}
                          onCheckedChange={(checked) =>
                            togglePublicMutation.mutate({ id: scenario.id as string, isPublic: checked })
                          }
                          disabled={togglePublicMutation.isPending}
                          className="scale-75 origin-left"
                        />
                        <span className={`text-xs font-medium ${(scenario as any).isPublic ? 'text-green-700' : 'text-slate-400'}`}>
                          {(scenario as any).isPublic ? '공개' : '비공개'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{scenario.estimatedTime}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        <span>{(scenario.personas || []).length}명</span>
                      </div>
                      {/* 통계 뱃지 */}
                      {stats && stats.completionCount > 0 && (
                        <>
                          <div className="flex items-center gap-1 text-xs text-green-700 bg-green-50 rounded px-1.5 py-0.5">
                            <Users className="w-3 h-3" />
                            {stats.completionCount}회
                          </div>
                          {stats.averageScore != null && (
                            <div className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
                              <Star className="w-3 h-3" />
                              {Number(stats.averageScore).toFixed(1)}점
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-8 h-8 p-0 hover:bg-slate-100"
                          data-testid={`button-scenario-menu-${scenario.id}`}
                        >
                          <MoreVertical className="h-4 w-4 text-slate-500" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setPreviewScenario(scenario)}
                          data-testid={`button-preview-scenario-${scenario.id}`}
                        >
                          <Eye className="mr-2 w-4 h-4" />
                          미리보기
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleEdit(scenario)}
                          data-testid={`button-edit-scenario-${scenario.id}`}
                        >
                          <i className="fas fa-edit mr-2 w-4 h-4 text-center"></i>
                          {t('admin.common.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => duplicateMutation.mutate(scenario.id as string)}
                          disabled={duplicateMutation.isPending}
                          data-testid={`button-duplicate-scenario-${scenario.id}`}
                        >
                          <Copy className="mr-2 w-4 h-4" />
                          복제
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setTranslatingScenario(scenario)}
                          data-testid={`button-translate-scenario-${scenario.id}`}
                        >
                          <Languages className="mr-2 w-4 h-4" />
                          {t('admin.common.manageTranslation')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setVersionHistoryScenario(scenario)}
                          data-testid={`button-version-history-${scenario.id}`}
                        >
                          <i className="fas fa-history mr-2 w-4 h-4 text-center"></i>
                          버전 이력
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              data-testid={`button-delete-scenario-${scenario.id}`}
                              className="text-red-600 focus:text-red-600 focus:bg-red-50"
                            >
                              <i className="fas fa-trash mr-2 w-4 h-4 text-center"></i>
                              {t('admin.common.delete')}
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('admin.scenarioManager.deleteScenario')}</AlertDialogTitle>
                              <AlertDialogDescription className="space-y-2">
                                <div>
                                  {t('admin.scenarioManager.deleteConfirm')}
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(scenario.id)}
                                className="bg-red-600 hover:bg-red-700"
                                data-testid={`confirm-delete-scenario-${scenario.id}`}
                              >
                                {t('common.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>
              
              <div 
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <CardContent className="pt-0 pl-5 pb-4 space-y-4">
                  <div className="border-t border-slate-100 pt-4">
                    <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
                      {scenario.description}
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">주요 역량</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(scenario.skills || []).map((skill, index) => (
                        <Badge 
                          key={index} 
                          variant="secondary" 
                          className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 border-0"
                        >
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{t('admin.scenarioManager.personas')}</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(scenario.personas || []).map((persona, index) => {
                        if (typeof persona === 'string') {
                          return (
                            <Badge 
                              key={index} 
                              variant="outline" 
                              className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                            >
                              {persona}
                            </Badge>
                          );
                        }
                        const p = persona as any;
                        const department = p.department || '';
                        const name = p.name || p.id || t('admin.scenarioManager.unknownPersona', 'Unknown persona');
                        const mbti = p.mbti ? `(${p.mbti})` : '';
                        const displayText = [department, name, mbti].filter(Boolean).join(' ');
                        return (
                          <Badge 
                            key={index} 
                            variant="outline" 
                            className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                          >
                            {displayText}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </div>
            </Card>
          );
        })}
      </div>

      {scenarios?.length === 0 && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📋</div>
          <h3 className="text-xl font-medium text-slate-600 mb-2">{t('admin.scenarioManager.noScenarios')}</h3>
          <p className="text-slate-500 mb-4">{t('admin.scenarioManager.createNewScenarioDesc')}</p>
          <Button
            onClick={() => {
              resetForm();
              setEditingScenario(null);
              setIsCreateOpen(true);
            }}
            className="bg-corporate-600 hover:bg-corporate-700"
          >
            {t('admin.scenarioManager.createFirstScenario')}
          </Button>
        </div>
      )}

      {/* 이미지 전체보기 모달 */}
      <Dialog open={!!imagePreviewUrl} onOpenChange={(open) => !open && setImagePreviewUrl(null)}>
        <DialogContent className="max-w-4xl w-full" data-testid="image-preview-modal">
          <DialogHeader>
            <DialogTitle>{t('admin.scenarioManager.imageFullView')}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-slate-100 rounded-lg overflow-hidden max-h-[70vh]">
            <img
              src={imagePreviewUrl || ''}
              alt={t('admin.scenarioManager.imageFullView')}
              className="max-w-full max-h-[70vh] object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 비디오 전체보기 모달 */}
      <Dialog open={!!videoPreviewUrl} onOpenChange={(open) => !open && setVideoPreviewUrl(null)}>
        <DialogContent className="max-w-4xl w-full" data-testid="video-preview-modal">
          <DialogHeader>
            <DialogTitle>{t('admin.scenarioManager.videoFullView')}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-slate-900 rounded-lg overflow-hidden max-h-[70vh]">
            <video
              src={videoPreviewUrl || ''}
              controls
              className="max-w-full max-h-[70vh] object-contain"
              autoPlay
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* 미리보기 모달 (학습자 화면 카드 스타일) */}
      <Dialog open={!!previewScenario} onOpenChange={(open) => !open && setPreviewScenario(null)}>
        <DialogContent className="max-w-lg" data-testid="scenario-preview-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              학습자 화면 미리보기
            </DialogTitle>
          </DialogHeader>
          {previewScenario && (() => {
            const s = previewScenario;
            const catName = categories?.find(c => String(c.id) === String((s as any).categoryId))?.name;
            const previewStats = statsMap.get(String(s.id));
            return (
              <div className="mt-2">
                <div className="overflow-hidden rounded-xl border-0 shadow-lg relative group">
                  <div
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                    style={{
                      backgroundImage: `url(${toMediaUrl((s as any).thumbnail || s.image) || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=400&fit=crop&auto=format'})`,
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
                  <div className="relative min-h-[14rem]">
                    <div className="absolute top-4 left-4 right-4 flex items-start justify-between z-10">
                      {catName && (
                        <Badge className="bg-blue-600/90 text-white text-xs backdrop-blur-md shadow-lg">
                          <Folder className="h-3 w-3 mr-1" />
                          {catName}
                        </Badge>
                      )}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
                      <h2 className="text-xl font-bold mb-2 drop-shadow-lg line-clamp-2">{s.title}</h2>
                      {s.description && (
                        <p className="text-xs text-gray-200 mb-3 leading-relaxed line-clamp-3 drop-shadow-md">
                          {s.description.length > 300 ? s.description.substring(0, 300) + '...' : s.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 text-sm flex-wrap">
                        <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                          <Users className="h-3 w-3" />
                          <span className="font-medium">{(s.personas || []).length}명</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                          <Clock className="h-3 w-3" />
                          <span className="font-medium">{s.estimatedTime}</span>
                        </div>
                        {previewStats && previewStats.completionCount > 0 && (
                          <>
                            <div className="flex items-center gap-1.5 bg-green-500/30 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                              <Users className="h-3 w-3" />
                              <span className="font-medium text-xs">{previewStats.completionCount}회 완료</span>
                            </div>
                            {previewStats.averageScore != null && (
                              <div className="flex items-center gap-1.5 bg-yellow-500/30 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                                <Star className="h-3 w-3" />
                                <span className="font-medium text-xs">평균 {Number(previewStats.averageScore).toFixed(1)}점</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-500 text-center">위 카드가 학습자 시나리오 선택 화면에서 보여지는 방식입니다.</div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* 번역 관리 모달 */}
      <Dialog open={!!translatingScenario} onOpenChange={(open) => !open && setTranslatingScenario(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="translation-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Languages className="h-5 w-5" />
              번역 관리 - {translatingScenario?.title}
            </DialogTitle>
          </DialogHeader>
          {translatingScenario && (
            <ScenarioTranslationEditor
              scenarioId={String(translatingScenario.id)}
              scenarioTitle={translatingScenario.title}
              scenarioDescription={translatingScenario.description}
              scenarioContext={{
                situation: translatingScenario.context?.situation || '',
                timeline: translatingScenario.context?.timeline || '',
                stakes: translatingScenario.context?.stakes || '',
                playerRole: typeof translatingScenario.context?.playerRole === 'object' 
                  ? [
                      (translatingScenario.context.playerRole as any)?.position,
                      (translatingScenario.context.playerRole as any)?.department,
                      (translatingScenario.context.playerRole as any)?.experience,
                      (translatingScenario.context.playerRole as any)?.responsibility
                    ].filter(Boolean).join(' / ')
                  : (translatingScenario.context?.playerRole || ''),
              }}
              scenarioObjectives={translatingScenario.objectives || []}
              scenarioSuccessCriteria={{
                optimal: translatingScenario.successCriteria?.optimal || '',
                good: translatingScenario.successCriteria?.good || '',
                acceptable: translatingScenario.successCriteria?.acceptable || '',
                failure: translatingScenario.successCriteria?.failure || '',
              }}
              scenarioSkills={translatingScenario.skills || []}
              scenarioPersonas={(translatingScenario.personas || []).map((p: any) => ({
                id: p.id || p.personaRef || '',
                name: p.name || '',
                position: p.position || '',
                department: p.department || '',
                role: p.role || '',
                stance: p.stance || '',
                goal: p.goal || '',
                tradeoff: p.tradeoff || '',
              }))}
              sourceLocale={translatingScenario.sourceLocale || 'ko'}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 버전 이력 다이얼로그 */}
      {versionHistoryScenario && (
        <ScenarioVersionHistory
          scenarioId={String(versionHistoryScenario.id)}
          scenarioTitle={versionHistoryScenario.title}
          open={!!versionHistoryScenario}
          onClose={() => setVersionHistoryScenario(null)}
        />
      )}

      {/* 기존 이미지 선택 다이얼로그 */}
      <Dialog open={showImageSelector} onOpenChange={setShowImageSelector}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('admin.scenarioManager.form.selectExisting', '기존 이미지 선택')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {loadingImages ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">이미지 목록 로드 중...</span>
              </div>
            ) : existingImages.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                생성된 이미지가 없습니다. 먼저 이미지를 생성해주세요.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {existingImages.map((img, idx) => (
                  <div
                    key={idx}
                    className="relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
                    onClick={() => handleSelectImage(img.path, img.url)}
                  >
                    <img
                      src={img.url}
                      alt={img.path}
                      className="w-full h-32 object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/300x200?text=Error';
                      }}
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-2 truncate">
                      {img.path.split('/').pop()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 기존 비디오 선택 다이얼로그 */}
      <Dialog open={showVideoSelector} onOpenChange={setShowVideoSelector}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('admin.scenarioManager.form.selectExistingVideo', '기존 비디오 선택')}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {loadingVideos ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">비디오 목록 로드 중...</span>
              </div>
            ) : existingVideos.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                생성된 비디오가 없습니다. 먼저 비디오를 생성해주세요.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {existingVideos.map((vid, idx) => (
                  <div
                    key={idx}
                    className="relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all group"
                  >
                    <video
                      src={vid.url}
                      className="w-full h-40 object-cover"
                      muted
                      preload="metadata"
                      onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                      onMouseLeave={(e) => {
                        const video = e.target as HTMLVideoElement;
                        video.pause();
                        video.currentTime = 0;
                      }}
                    />
                    {/* Overlay button for reliable selection */}
                    <div 
                      className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSelectVideo(vid.path, vid.url);
                      }}
                    >
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-opacity"
                      >
                        선택
                      </button>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-2 truncate">
                      {vid.path.split('/').pop()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}