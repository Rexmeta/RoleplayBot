import React, { useState, useMemo, useRef } from 'react';
import { useDefaultSourceLocale } from '@/lib/localeUtils';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AutoResizeTextarea } from '@/components/ui/auto-resize-textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient, streamApiRequest } from '@/lib/queryClient';
import { ComplexScenario } from '@/lib/scenario-system';
import { flowGraphSchema, personaSwitchRulesSchema, evaluationHarnessSchema, terminationRulesSchema, simulationHarnessSchema, playerConstraintsSchema, difficultyProfileSchema, analyticsSpecSchema, TRACKED_METRICS, REPORT_SECTIONS } from '@shared/schema/scenarios';
import type { TrackedMetricKey, ReportSectionKey, EvaluationHarness, TerminationRules, TerminationConditionGroup, FlowGraph, PersonaSwitchRules, PlayerConstraints, DifficultyProfile, NpcBehaviorHarness } from '@shared/schema/scenarios';
import { PlayerConstraintsBuilder } from './PlayerConstraintsBuilder';
import { NpcBehaviorHarnessBuilder } from './NpcBehaviorHarnessBuilder';
import { DifficultyProfileBuilder } from './DifficultyProfileBuilder';
import { toMediaUrl } from '@/lib/mediaUrl';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, MoreVertical, ChevronDown, ChevronUp, Clock, Users, Target, Languages, Search, Sparkles, Eye, Copy, Download, Upload, ImageOff, UserX, ListX, BarChart2, Star, Folder, AlertTriangle, CheckCircle, XCircle, Info, Plus, Trash2, Film, Video, VideoOff } from 'lucide-react';
import { validateScenario } from '@shared/scenarioValidator';
import { FlowGraphBuilder, TerminationRulesBuilder, PersonaSwitchRulesBuilder, EvaluationHarnessBuilder } from './StateMachineBuilders';
import { AIScenarioGenerator } from './AIScenarioGenerator';
import { ScenarioTranslationEditor } from './ScenarioTranslationEditor';
import { ScenarioVersionHistory } from './ScenarioVersionHistory';
import { ScenarioCriteriaPreview } from './ScenarioCriteriaPreview';
import {
  createScenariosZip,
  normalizeScenarioImport,
  parseScenarioImportFile,
  safeScenarioFileName,
  scenarioJson,
  serializeScenario,
} from '@/lib/scenarioExport';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ActorCultureEditor } from '@/components/admin/cultureMap/ActorCultureEditor';
import { ScenarioLiveAvatarPolicy } from '@/components/admin/ScenarioLiveAvatarPolicy';
import type { ActorCulture } from '@shared/cultureMap';
import { getScenarioPersonaTemplateId, stableActorIdForTemplate } from '@/components/admin/cultureMap/actorIdentity';
import { EditorGroup, Field, FieldGrid, ToggleRow, AdvancedDisclosure, AiGenerateButton, aiBlockedReason } from './scenarioEditor/EditorPrimitives';
import { ConversationLengthGroup } from './scenarioEditor/ConversationLengthGroup';
import { PersonaMediaPreview, type ScenarioPersonaMedia } from './scenarioEditor/PersonaMediaPreview';
import { ScenarioEditor, ScenarioEditorRegion, useScenarioEditorNavigation, revealScenarioEditorTarget } from './scenarioEditor/ScenarioEditor';

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
  npcBehaviorHarness?: NpcBehaviorHarness;
  culture?: ActorCulture;
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
  introVideoModel?: string; // 생성에 사용된 비디오 모델
  modelVideoOverride?: string; // 비디오 모델 오버라이드 (전역 설정 우선순위 최상위)
  videoPrompt?: string; // 비디오 생성 프롬프트 필드 추가
  objectiveType?: string; // 목표 유형 추가
  targetDurationMinutes?: number; // 시나리오별 목표 대화 시간(분)
  targetTurns?: number; // 시나리오별 목표 턴 수
  minValidTurns?: number; // 최소 유효 턴 수
  isDemo?: boolean; // 게스트 데모용 시나리오 여부
  isPublic?: boolean; // 공개 여부
  useVideoAvatar?: boolean; // 비디오 아바타 사용 여부
  autoTranslate?: boolean; // AI 자동 번역 여부
  storeListed?: boolean;
  storePriceUsd?: number | null;
  storePackId?: string | null;
  personaSwitchMode?: 'replace' | 'join' | 'none'; // 다중 페르소나 전환 방식
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
  playerConstraints?: any;
  difficultyProfile?: any;
  analyticsSpec?: any;
}

interface ScenarioManagerProps {
  onGoToPersonas?: () => void;
}

const VIDEO_MODELS = [
  { value: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite (720p)' },
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast (720p)' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (1080p · 오디오 포함)', recommended: true },
] as const;

const OBJECTIVE_TYPES: [string, string][] = [
  ['역할책임명확화', '역할 및 책임 명확화'], ['우선순위협의', '우선순위 협의 및 합의'], ['공정평가기준수립', '공정한 평가 기준 수립'],
  ['세대간이해증진', '세대 간 상호 이해 증진'], ['효과적소통정보공유', '효과적 소통 및 정보 공유'], ['의사결정표준화', '의사결정 프로세스 표준화'],
  ['리더십스타일조정', '리더십 스타일 조정'], ['공로분배팀워크', '공로 분배 및 팀워크 강화'], ['정보투명성공유', '정보 투명성 및 공유'],
  ['책임소재명확화', '책임 소재 명확화'], ['업무프로세스조정', '업무 프로세스 조정'], ['목표정렬', '목표 정렬 및 방향성 통일'],
  ['전문성존중학습', '전문성 존중 및 학습'], ['업무경계협력', '업무 경계 설정 및 협력'], ['공정한조직문화', '공정한 조직 문화 조성'],
  ['신뢰회복감정해소', '신뢰 회복 및 감정 해소'], ['기여도인정동기부여', '기여도 인정 및 동기 부여'], ['신뢰관계재구축', '신뢰 관계 재구축'],
  ['리소스배분협의', '리소스 배분 협의 및 최적화'], ['다양성포용성증진', '다양성 이해 및 포용성 증진'],
];

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


const CHECK_TO_SECTION: Record<number, string> = {
  1: 'section-personas',
  2: 'section-personas',
  3: 'section-turns',
  4: 'section-success-criteria',
  5: 'section-evaluation',
  6: 'section-persona-switch',
  7: 'section-simulation-harness',
  8: 'section-player-constraints',
  9: 'section-flow-graph',
  10: 'section-source-locale',
};

interface ValidationIssue {
  check: number;
  key: string;
  severity: string;
  message: string;
}

interface QualityValidation {
  score: number;
  issues: ValidationIssue[];
  hasFatalErrors: boolean;
}

function SectionIssueIcon({ sectionId, issuesBySectionId }: { sectionId: string; issuesBySectionId: Map<string, string> }) {
  const severity = issuesBySectionId.get(sectionId);
  if (!severity) return null;
  if (severity === 'error') return <XCircle className="inline h-3.5 w-3.5 text-red-500 ml-1 flex-shrink-0" />;
  if (severity === 'warning') return <AlertTriangle className="inline h-3.5 w-3.5 text-amber-500 ml-1 flex-shrink-0" />;
  return <Info className="inline h-3.5 w-3.5 text-blue-400 ml-1 flex-shrink-0" />;
}

function ScenarioQualityPanel({
  validation,
  isLive = false,
  savedScore,
}: {
  validation?: QualityValidation;
  isLive?: boolean;
  savedScore?: number;
}) {
  const editorNavigation = useScenarioEditorNavigation();
  if (!validation) return null;

  const { score, issues } = validation;

  const scrollToSection = (sectionId: string) => {
    if (editorNavigation) { editorNavigation.reveal(sectionId); return; }
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const severityIcon = (severity: string) => {
    if (severity === 'error') return <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />;
    if (severity === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />;
    return <Info className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />;
  };

  const liveBadge = isLive ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
      </span>
      실시간
    </span>
  ) : null;

  if (issues.length === 0) {
    return (
      <div id="scenario-quality-panel" className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-green-700">품질 통과</span>
        <span className="text-xs text-green-600 ml-1">— 점수: {score}/100</span>
        {liveBadge}
        {isLive && savedScore !== undefined && savedScore !== score && (
          <span className="text-xs text-slate-400 ml-auto">저장된 점수: {savedScore}/100</span>
        )}
      </div>
    );
  }

  const panelColor =
    score >= 80 ? 'bg-green-50 border-green-200' :
    score >= 60 ? 'bg-amber-50 border-amber-200' :
                  'bg-red-50 border-red-200';
  const scoreColor =
    score >= 80 ? 'text-green-700' :
    score >= 60 ? 'text-amber-700' :
                  'text-red-700';

  return (
    <div id="scenario-quality-panel" className={`border rounded-lg p-4 space-y-2.5 ${panelColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`h-4 w-4 flex-shrink-0 ${scoreColor}`} />
          <span className={`text-sm font-semibold ${scoreColor}`}>품질 점수: {score}/100</span>
          {liveBadge}
        </div>
        <div className="flex items-center gap-3">
          {isLive && savedScore !== undefined && savedScore !== score && (
            <span className="text-xs text-slate-400">저장된 점수: {savedScore}/100</span>
          )}
          <span className="text-xs text-slate-500">{issues.length}개 항목 미충족</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {issues.map((issue) => {
          const sectionId = CHECK_TO_SECTION[issue.check];
          return (
            <div key={`${issue.check}-${issue.key}`} className="flex items-start gap-2 bg-white/80 rounded-md px-3 py-2">
              {severityIcon(issue.severity)}
              <span className="text-xs text-slate-700 flex-1 leading-relaxed">{issue.message}</span>
              {sectionId && (
                <button
                  type="button"
                  onClick={() => scrollToSection(sectionId)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap ml-2 flex-shrink-0"
                >
                  바로가기 →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ScenarioManager({ onGoToPersonas }: ScenarioManagerProps = {}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const currentLang = i18n.language;
  const defaultSourceLocale = useDefaultSourceLocale();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingScenario, setEditingScenario] = useState<ComplexScenario | null>(null);
  const [invalidCultureActors, setInvalidCultureActors] = useState<Set<number>>(new Set());
  const [flowGraphValue, setFlowGraphValue] = useState<FlowGraph | null>(null);
  const [personaSwitchRulesValue, setPersonaSwitchRulesValue] = useState<PersonaSwitchRules | null>(null);
  const [terminationRulesValue, setTerminationRulesValue] = useState<TerminationRules | null>(null);
  const [builderKey, setBuilderKey] = useState(0);
  const [evaluationHarnessValue, setEvaluationHarnessValue] = useState<EvaluationHarness | null>(null);
  const [playerConstraintsValue, setPlayerConstraintsValue] = useState<PlayerConstraints | null>(null);
  const [difficultyProfileValue, setDifficultyProfileValue] = useState<DifficultyProfile | null>(null);
  const [aiPreviewOpen, setAiPreviewOpen] = useState(false);
  const [aiPreviewType, setAiPreviewType] = useState<'evaluationHarness' | 'playerConstraints' | null>(null);
  const [aiPreviewData, setAiPreviewData] = useState<EvaluationHarness | PlayerConstraints | null>(null);
  const [aiPreviewExisting, setAiPreviewExisting] = useState<EvaluationHarness | PlayerConstraints | null>(null);
  const [aiPreviewEdited, setAiPreviewEdited] = useState<EvaluationHarness | PlayerConstraints | null>(null);
  const [analyticsTrackedMetrics, setAnalyticsTrackedMetrics] = useState<string[]>([]);
  const [analyticsReportSections, setAnalyticsReportSections] = useState<string[]>([]);
  const [analyticsBenchmarkGroup, setAnalyticsBenchmarkGroup] = useState('');
  // Structured simulation harness state
  const [harnessEnabled, setHarnessEnabled] = useState(false);
  const [harnessAffectiveAxes, setHarnessAffectiveAxes] = useState('affective.intensity,relational.trust,cognitive.confusion,motivational.interest');
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

  const harnessEffective = useMemo(() => {
    if (!harnessEnabled) return null;
    const DEF_AXES = ['affective.intensity', 'relational.trust', 'cognitive.confusion', 'motivational.interest'];
    const DEF_TYPES = [...HARNESS_ALL_INCIDENT_TYPES] as string[];
    if (harnessShowRaw) {
      if (!harnessRawJson.trim()) {
        return { valid: true, usingDefaults: true, affectiveAxes: DEF_AXES, maxCallsPerTurn: 2, maxDeltaPerCall: 30, allowedTypes: DEF_TYPES, globalCooldownSec: 60, perTypeCooldownSec: 120, stateUpdatesEnabled: true, preferredSignals: {} as Record<string, string>, fieldErrors: {} as Record<string, string> };
      }
      let raw: unknown;
      try { raw = JSON.parse(harnessRawJson); } catch { return { valid: false, parseError: 'JSON 구문 오류', fieldErrors: {} as Record<string, string> }; }
      const result = simulationHarnessSchema.safeParse(raw);
      if (!result.success) {
        const fieldErrors: Record<string, string> = {};
        result.error.issues.forEach(e => { const path = e.path.join('.'); fieldErrors[path] = e.message; });
        return { valid: false, fieldErrors };
      }
      const h = result.data;
      return {
        valid: true, usingDefaults: false,
        affectiveAxes: h.affectiveAxes ?? DEF_AXES,
        maxCallsPerTurn: h.toolPolicy?.npcAffectiveStateDelta?.maxCallsPerTurn ?? 2,
        maxDeltaPerCall: h.toolPolicy?.npcAffectiveStateDelta?.maxDeltaPerCall ?? 30,
        allowedTypes: h.toolPolicy?.triggerIncident?.allowedTypes ?? DEF_TYPES,
        globalCooldownSec: h.toolPolicy?.triggerIncident?.cooldownOverride?.globalCooldownSec ?? 60,
        perTypeCooldownSec: h.toolPolicy?.triggerIncident?.cooldownOverride?.perTypeCooldownSec ?? 120,
        stateUpdatesEnabled: h.toolPolicy?.updateScenarioState?.enabled ?? true,
        preferredSignals: h.preferredSignals ?? {} as Record<string, string>,
        fieldErrors: {} as Record<string, string>,
      };
    } else {
      const affectiveAxes = harnessAffectiveAxes.split(',').map(s => s.trim()).filter(Boolean);
      const preferredSignals: Record<string, string> = {};
      harnessPreferredSignals.forEach(({ key, value }) => { if (key.trim()) preferredSignals[key.trim()] = value; });
      return {
        valid: true, usingDefaults: false,
        affectiveAxes: affectiveAxes.length > 0 ? affectiveAxes : DEF_AXES,
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
  }, [harnessEnabled, harnessShowRaw, harnessRawJson, harnessAffectiveAxes, harnessMaxCallsPerTurn, harnessMaxDeltaPerCall, harnessAllowedTypes, harnessGlobalCooldownSec, harnessPerTypeCooldownSec, harnessStateUpdatesEnabled, harnessPreferredSignals]);

  const harnessWarnings = useMemo(() => {
    if (!harnessEffective?.valid) return [];
    const warnings: string[] = [];
    if ((harnessEffective.allowedTypes?.length ?? 0) === 0) {
      warnings.push('허용 이벤트 유형이 없습니다 — 인시던트가 전혀 발생하지 않습니다.');
    }
    if (harnessEffective.maxCallsPerTurn === 0) {
      warnings.push('턴당 최대 어펙티브 상태 업데이트 횟수가 0입니다 — NPC 상태가 업데이트되지 않습니다.');
    }
    if (harnessEffective.globalCooldownSec === 0) {
      warnings.push('전역 쿨다운이 0초입니다 — 인시던트가 매 턴 반복될 수 있습니다.');
    }
    if (harnessEffective.perTypeCooldownSec === 0) {
      warnings.push('유형별 쿨다운이 0초입니다 — 동일 인시던트가 연속 발생할 수 있습니다.');
    }
    return warnings;
  }, [harnessEffective]);

  const [isGeneratingEvaluationHarness, setIsGeneratingEvaluationHarness] = useState(false);
  const [isGeneratingPlayerConstraints, setIsGeneratingPlayerConstraints] = useState(false);
  const [isGeneratingNpcBehaviorHarness, setIsGeneratingNpcBehaviorHarness] = useState<Record<number, boolean>>({});
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const isAnyGenerating =
    isGeneratingImage ||
    isGeneratingVideo ||
    isGeneratingEvaluationHarness ||
    isGeneratingPlayerConstraints ||
    Object.values(isGeneratingNpcBehaviorHarness).some(Boolean);
  const [isUploadingDefaultVideo, setIsUploadingDefaultVideo] = useState(false);
  const defaultVideoInputRef = useRef<HTMLInputElement>(null);
  const videoJobPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string | number>>(new Set());
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [translatingScenario, setTranslatingScenario] = useState<ComplexScenario | null>(null);
  const [previewScenario, setPreviewScenario] = useState<ComplexScenario | null>(null);
  const [versionHistoryScenario, setVersionHistoryScenario] = useState<ComplexScenario | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [exportingScenarioId, setExportingScenarioId] = useState<string | number | null>(null);
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
    modelVideoOverride: '',
    videoPrompt: '', // 비디오 프롬프트 초기값 추가
    objectiveType: '', // 목표 유형 초기값 추가
    targetDurationMinutes: 7,
    targetTurns: 10,
    minValidTurns: 4,
    isDemo: false,
    isPublic: false,
    useVideoAvatar: false,
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

  const { data: videoAvatarAccess } = useQuery<{ operatorEnabled: boolean }>({
    queryKey: ['/api/settings/video-avatar-access'],
    staleTime: 1000 * 60,
  });
  const canManageVideoAvatar = user?.role === 'admin' || videoAvatarAccess?.operatorEnabled === true;
  
  // 편집용 원본 데이터 조회 (번역 적용 안됨)
  const { data: originalScenarios, isLoading: isLoadingOriginalScenarios } = useQuery<ComplexScenario[]>({
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

  // 기본 인트로 비디오 정보 조회 (admin only)
  const { data: defaultVideoInfo, refetch: refetchDefaultVideo } = useQuery<{ hasCustomVideo: boolean; url: string; storagePath?: string }>({
    queryKey: ['/api/admin/default-intro-video'],
    queryFn: async () => {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/default-intro-video', { headers, credentials: 'include' });
      if (!res.ok) return { hasCustomVideo: false, url: '/videos/intro_default.webm' };
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
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
  const { data: availablePersonas = [] } = useQuery<(ScenarioPersonaMedia & { personality_traits?: string[]; communication_style?: string })[]>({
    queryKey: ['/api/admin/personas'],
  });

  // 시나리오 완료 통계 조회
  const { data: scenarioStats = [] } = useQuery<{ scenarioId: string; completionCount: number; averageScore: number | null }[]>({
    queryKey: ['/api/scenarios/stats'],
    queryFn: () => fetch('/api/scenarios/stats').then(res => res.json()),
    staleTime: 1000 * 60 * 10,
  });
  const statsMap = useMemo(() => new Map(scenarioStats.map(s => [s.scenarioId, s] as const)), [scenarioStats]);

  // 활성 지원 언어 목록 조회 (번역 상태 배지용)
  const { data: activeLanguages = [] } = useQuery<{ code: string; name: string; nativeName: string; isDefault: boolean }[]>({
    queryKey: ['/api/languages'],
  });

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

  // 편집 중인 시나리오의 이슈를 섹션 ID 기준으로 집계 (SectionIssueIcon 용)
  const issuesBySectionId = useMemo(() => {
    const map = new Map<string, string>();
    if (!editingScenario) return map;
    const validation = validationMap[String(editingScenario.id)];
    if (!validation) return map;
    const SEVERITY_RANK: Record<string, number> = { error: 2, warning: 1, info: 0 };
    for (const issue of validation.issues) {
      const sectionId = CHECK_TO_SECTION[issue.check];
      if (!sectionId) continue;
      const existing = map.get(sectionId);
      if (!existing || (SEVERITY_RANK[issue.severity] ?? -1) > (SEVERITY_RANK[existing] ?? -1)) {
        map.set(sectionId, issue.severity);
      }
    }
    return map;
  }, [validationMap, editingScenario]);

  // 실시간 클라이언트 품질 검증 — 편집 폼 변경 시마다 재계산
  const liveValidation = useMemo((): QualityValidation | null => {
    if (!editingScenario) return null;

    const parsedEvalHarness: any = evaluationHarnessValue ?? null;

    const parsedPlayerConstraints: any = playerConstraintsValue ?? null;

    let simulationHarnessForValidation: any = null;
    if (harnessEffective?.valid && harnessEnabled) {
      simulationHarnessForValidation = {
        toolPolicy: {
          triggerIncident: { allowedTypes: harnessEffective.allowedTypes ?? [] },
        },
      };
    }

    const scenarioLike = {
      id: String(editingScenario.id),
      title: formData.title || editingScenario.title || '',
      personas: formData.personas,
      targetTurns: formData.targetTurns,
      minValidTurns: formData.minValidTurns,
      successCriteria: formData.successCriteria,
      objectives: formData.objectives,
      evaluationHarness: parsedEvalHarness,
      personaSwitchRules: personaSwitchRulesValue,
      simulationHarness: simulationHarnessForValidation,
      playerConstraints: parsedPlayerConstraints,
      flowGraph: flowGraphValue,
      sourceLocale: (editingScenario as any).sourceLocale ?? null,
    };

    const mbtiPersonaIds = new Set(availablePersonas.map(p => p.id));
    const result = validateScenario(scenarioLike, mbtiPersonaIds, [], []);
    return { score: result.score, issues: result.issues, hasFatalErrors: result.hasFatalErrors };
  }, [
    editingScenario,
    formData.personas, formData.title, formData.targetTurns, formData.minValidTurns,
    formData.successCriteria, formData.objectives,
    evaluationHarnessValue, playerConstraintsValue,
    flowGraphValue, personaSwitchRulesValue,
    harnessEffective, harnessEnabled,
    availablePersonas,
  ]);

  // 실시간 이슈를 섹션 ID 기준으로 집계 (SectionIssueIcon 용)
  const liveIssuesBySectionId = useMemo(() => {
    const map = new Map<string, string>();
    if (!liveValidation) return map;
    const SEVERITY_RANK: Record<string, number> = { error: 2, warning: 1, info: 0 };
    for (const issue of liveValidation.issues) {
      const sectionId = CHECK_TO_SECTION[issue.check];
      if (!sectionId) continue;
      const existing = map.get(sectionId);
      if (!existing || (SEVERITY_RANK[issue.severity] ?? -1) > (SEVERITY_RANK[existing] ?? -1)) {
        map.set(sectionId, issue.severity);
      }
    }
    return map;
  }, [liveValidation]);

  // Each Actor has an independent id; Persona templates may be reused by any slot.
  const getAvailablePersonasForSlot = () => availablePersonas;

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
      introVideoModel: (scenario as any).introVideoModel || '',
      modelVideoOverride: (scenario as any).modelVideoOverride || '',
      videoPrompt: scenario.videoPrompt || '',
      objectiveType: scenario.objectiveType || '',
      isDemo: scenario.isDemo || false,
      isPublic: scenario.isPublic || false,
      useVideoAvatar: (scenario as any).useVideoAvatar || false,
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
      const response = await apiRequest('POST', `/api/admin/scenarios/${scenarioId}/auto-translate`, { sourceLocale: defaultSourceLocale });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios', currentLang] });
      if (data.fatalError) {
        toast({
          title: t('admin.evaluationCriteria.translationFailed'),
          description: data.fatalError,
          variant: "destructive",
        });
        return;
      }
      const failed: { locale: string; reason: string }[] = data.failedLocales || [];
      if (failed.length > 0) {
        const failedList = failed.map((f) => `${f.locale}: ${f.reason}`).join('\n');
        toast({
          title: t('admin.evaluationCriteria.translationPartialFailure'),
          description: `${data.message}\n${t('admin.evaluationCriteria.translationFailedLocales')}: ${failedList}`,
          variant: "destructive",
        });
      } else if (data.translatedCount === 0) {
        toast({
          title: t('admin.evaluationCriteria.translationFailed'),
          description: "번역 대상 언어가 설정되지 않았습니다. 시스템 언어 설정을 확인하세요.",
          variant: "destructive",
        });
      } else {
        toast({ 
          title: t('admin.evaluationCriteria.translationSuccess'), 
          description: data.message 
        });
      }
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
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios', currentLang] }),
        queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios', 'edit'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios/validate'] }),
      ]);
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
    setInvalidCultureActors(new Set());
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
      modelVideoOverride: '',
      videoPrompt: '', // 비디오 프롬프트 초기화 추가
      objectiveType: '', // 목표 유형 초기화
      targetDurationMinutes: 7,
      targetTurns: 10,
      minValidTurns: 4,
      isPublic: false,
      useVideoAvatar: false,
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
    setFlowGraphValue(null);
    setPersonaSwitchRulesValue(null);
    setTerminationRulesValue(null);
    setBuilderKey(k => k + 1);
    setEvaluationHarnessValue(null);
    setHarnessEnabled(false);
    setHarnessAffectiveAxes('affective.intensity,relational.trust,cognitive.confusion,motivational.interest');
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
    setAnalyticsTrackedMetrics([]);
    setAnalyticsReportSections([]);
    setAnalyticsBenchmarkGroup('');
    setPlayerConstraintsValue(null);
    setDifficultyProfileValue(null);
  };

  const handleEdit = (scenario: ComplexScenario) => {
    setInvalidCultureActors(new Set());
    // 번역된 데이터 대신 원본 데이터 사용
    const originalScenario = originalScenarios?.find((s: any) => s.id === scenario.id)
      || (!(scenario as any)._translated ? scenario : null);
    if (!originalScenario) {
      toast({
        title: isLoadingOriginalScenarios ? '원본 시나리오를 불러오는 중입니다' : '원본 시나리오를 찾을 수 없습니다',
        description: '번역된 제목을 원본 시나리오로 저장하지 않도록 잠시 후 다시 시도해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    
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
      introVideoModel: (originalScenario as any).introVideoModel || '',
      modelVideoOverride: (originalScenario as any).modelVideoOverride || '',
      videoPrompt: (originalScenario as any).videoPrompt || '', // 기존 시나리오의 비디오 프롬프트 로드
      objectiveType: (originalScenario as any).objectiveType || '', // 기존 시나리오의 목표 유형 로드
      targetDurationMinutes: (originalScenario as any).targetDurationMinutes ?? 7,
      targetTurns: (originalScenario as any).targetTurns ?? 10,
      minValidTurns: (originalScenario as any).minValidTurns ?? 4,
      isDemo: (originalScenario as any).isDemo || false,
      isPublic: (originalScenario as any).isPublic || false,
      useVideoAvatar: (originalScenario as any).useVideoAvatar || false,
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
    setFlowGraphValue(existingFlowGraph ?? null);
    const existingPSR = (originalScenario as any).personaSwitchRules;
    setPersonaSwitchRulesValue(existingPSR ?? null);
    const existingEH = (originalScenario as any).evaluationHarness;
    setEvaluationHarnessValue(existingEH ?? null);
    const existingTR = (originalScenario as any).terminationRules;
    setTerminationRulesValue(existingTR ?? null);
    setBuilderKey(k => k + 1);
    const existingHarness = (originalScenario as any).simulationHarness;
    if (existingHarness) {
      setHarnessEnabled(true);
      setHarnessAffectiveAxes((existingHarness.affectiveAxes ?? ['affective.intensity','relational.trust','cognitive.confusion','motivational.interest']).join(','));
      setHarnessMaxCallsPerTurn(String(existingHarness.toolPolicy?.npcAffectiveStateDelta?.maxCallsPerTurn ?? 2));
      setHarnessMaxDeltaPerCall(String(existingHarness.toolPolicy?.npcAffectiveStateDelta?.maxDeltaPerCall ?? 30));
      setHarnessAllowedTypes(existingHarness.toolPolicy?.triggerIncident?.allowedTypes ?? [...HARNESS_ALL_INCIDENT_TYPES]);
      setHarnessGlobalCooldownSec(String(existingHarness.toolPolicy?.triggerIncident?.cooldownOverride?.globalCooldownSec ?? 60));
      setHarnessPerTypeCooldownSec(String(existingHarness.toolPolicy?.triggerIncident?.cooldownOverride?.perTypeCooldownSec ?? 120));
      setHarnessStateUpdatesEnabled(existingHarness.toolPolicy?.updateScenarioState?.enabled ?? true);
      const sigs = existingHarness.preferredSignals ?? {};
      setHarnessPreferredSignals(Object.entries(sigs).map(([key, value]) => ({ key, value: String(value) })));
    } else {
      setHarnessEnabled(false);
      setHarnessAffectiveAxes('affective.intensity,relational.trust,cognitive.confusion,motivational.interest');
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
    setPlayerConstraintsValue(existingPC ?? null);
    const existingDP = (originalScenario as any).difficultyProfile;
    setDifficultyProfileValue(existingDP ?? null);
    const existingAS = (originalScenario as any).analyticsSpec;
    setAnalyticsTrackedMetrics(existingAS?.trackedMetrics ?? []);
    setAnalyticsReportSections(existingAS?.reportSections ?? []);
    setAnalyticsBenchmarkGroup(existingAS?.benchmarkGroup ?? '');
    setIsCreateOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 필수 필드 검증
    const normalizedTitle = formData.title.trim();
    if (!normalizedTitle) {
      revealScenarioEditorTarget('title');
      toast({
        title: t('admin.scenarioManager.toast.titleRequired'),
        description: t('admin.scenarioManager.toast.titleRequiredDesc'),
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.categoryId) {
      revealScenarioEditorTarget('category');
      toast({
        title: t('admin.scenarioManager.toast.categoryRequired'),
        description: t('admin.scenarioManager.toast.categoryRequiredDesc'),
        variant: "destructive",
      });
      return;
    }
    if (invalidCultureActors.size > 0) {
      revealScenarioEditorTarget(`scenario-actor-${Math.min(...Array.from(invalidCultureActors))}`);
      toast({
        title: '문화적 특성 설정을 확인해 주세요',
        description: '문화적 특성을 켠 Actor는 프로필을 선택해야 저장할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    
    const submitData = buildSubmitPayload(normalizedTitle);
    if (!submitData) return;

    if (editingScenario) {
      updateMutation.mutate({ id: editingScenario.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const buildSubmitPayload = (title = formData.title.trim()): (typeof formData & { flowGraph: any; personaSwitchRules: any; evaluationHarness: any; terminationRules: any; simulationHarness: any }) | null => {
    let parsedFlowGraph: any = flowGraphValue ?? null;
    let parsedPSR: any = personaSwitchRulesValue ?? null;
    let parsedHarness: any = null;

    if (parsedFlowGraph) {
      const result = flowGraphSchema.safeParse(parsedFlowGraph);
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? '스키마 검증 실패';
        toast({ title: 'flowGraph 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedFlowGraph = result.data;
    }

    if (parsedPSR) {
      const result = personaSwitchRulesSchema.safeParse(parsedPSR);
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? '스키마 검증 실패';
        toast({ title: 'personaSwitchRules 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedPSR = result.data;
    }

    let parsedEH: any = null;
    if (evaluationHarnessValue) {
      const result = evaluationHarnessSchema.safeParse(evaluationHarnessValue);
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? '스키마 검증 실패';
        toast({ title: 'evaluationHarness 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedEH = result.data;
    }

    let parsedTR: any = terminationRulesValue ?? null;
    if (parsedTR) {
      const result = terminationRulesSchema.safeParse(parsedTR);
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? '스키마 검증 실패';
        toast({ title: 'terminationRules 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedTR = result.data;
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
            const msg = result.error.issues[0]?.message ?? '스키마 검증 실패';
            setHarnessRawJsonError(`시뮬레이션 정책 구조 오류: ${msg}`);
            toast({ title: '시뮬레이션 정책 구조 오류', description: msg, variant: 'destructive' });
            return null;
          }
          parsedHarness = result.data;
          setHarnessRawJsonError('');
        }
      } else {
        const affectiveAxes = harnessAffectiveAxes.split(',').map(s => s.trim()).filter(Boolean);
        const preferredSignals: Record<string, string> = {};
        harnessPreferredSignals.forEach(({ key, value }) => { if (key.trim()) preferredSignals[key.trim()] = value; });
        const built: any = { affectiveAxes, toolPolicy: {
          npcAffectiveStateDelta: { maxCallsPerTurn: parseInt(harnessMaxCallsPerTurn) || 2, maxDeltaPerCall: parseInt(harnessMaxDeltaPerCall) || 30 },
          triggerIncident: { allowedTypes: harnessAllowedTypes, cooldownOverride: { globalCooldownSec: parseInt(harnessGlobalCooldownSec) || 60, perTypeCooldownSec: parseInt(harnessPerTypeCooldownSec) || 120 } },
          updateScenarioState: { enabled: harnessStateUpdatesEnabled },
        }};
        if (Object.keys(preferredSignals).length > 0) built.preferredSignals = preferredSignals;
        const result = simulationHarnessSchema.safeParse(built);
        if (!result.success) {
          const msg = result.error.issues[0]?.message ?? '스키마 검증 실패';
          toast({ title: '시뮬레이션 정책 구조 오류', description: msg, variant: 'destructive' });
          return null;
        }
        parsedHarness = result.data;
      }
    }

    let parsedPC: any = null;
    if (playerConstraintsValue) {
      const result = playerConstraintsSchema.safeParse(playerConstraintsValue);
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? '스키마 검증 실패';
        toast({ title: 'playerConstraints 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedPC = result.data;
    }

    let parsedDP: any = null;
    if (difficultyProfileValue) {
      const result = difficultyProfileSchema.safeParse(difficultyProfileValue);
      if (!result.success) {
        const msg = result.error.issues[0]?.message ?? '스키마 검증 실패';
        toast({ title: 'difficultyProfile 구조 오류', description: msg, variant: 'destructive' });
        return null;
      }
      parsedDP = result.data;
    }

    const analyticsSpec = (analyticsTrackedMetrics.length > 0 || analyticsReportSections.length > 0 || analyticsBenchmarkGroup.trim())
      ? {
          trackedMetrics: analyticsTrackedMetrics,
          reportSections: analyticsReportSections,
          ...(analyticsBenchmarkGroup.trim() ? { benchmarkGroup: analyticsBenchmarkGroup.trim() } : {}),
        }
      : null;

    return { ...formData, title, flowGraph: parsedFlowGraph, personaSwitchRules: parsedPSR, evaluationHarness: parsedEH, terminationRules: parsedTR, simulationHarness: parsedHarness, playerConstraints: parsedPC, difficultyProfile: parsedDP, analyticsSpec };
  };

  const handleSaveAndGoToPersona = () => {
    const normalizedTitle = formData.title.trim();
    if (!normalizedTitle) {
      toast({
        title: '시나리오 제목이 필요합니다',
        description: '시나리오 제목을 먼저 입력해 주세요.',
        variant: 'destructive',
      });
      return;
    }
    if (invalidCultureActors.size > 0) {
      toast({
        title: '문화적 특성 설정을 확인해 주세요',
        description: '문화적 특성을 켠 Actor는 프로필을 선택해야 저장할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }
    const submitData = buildSubmitPayload(normalizedTitle);
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
        industry: formData.industry,
        situation: formData.context?.situation,
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

  const canGenerateAI = !!(formData.title || formData.description);

  const handleGenerateEvaluationHarness = async () => {
    if (!canGenerateAI) return;
    setIsGeneratingEvaluationHarness(true);
    try {
      const data = await streamApiRequest('/api/admin/generate-evaluation-harness', {
        title: formData.title,
        description: formData.description,
        objectives: formData.objectives,
        situation: formData.context.situation,
        playerRole: formData.context.playerRole,
      });
      if (!data.success || !data.evaluationHarness) throw new Error('AI 응답이 올바르지 않습니다');
      setAiPreviewData(data.evaluationHarness);
      setAiPreviewEdited(data.evaluationHarness);
      setAiPreviewExisting(evaluationHarnessValue);
      setAiPreviewType('evaluationHarness');
      setAiPreviewOpen(true);
    } catch (error: any) {
      toast({ title: 'AI 생성 실패', description: error.message || '오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setIsGeneratingEvaluationHarness(false);
    }
  };

  const handleGeneratePlayerConstraints = async () => {
    if (!canGenerateAI) return;
    setIsGeneratingPlayerConstraints(true);
    try {
      const data = await streamApiRequest('/api/admin/generate-player-constraints', {
        title: formData.title,
        description: formData.description,
        objectives: formData.objectives,
        situation: formData.context.situation,
        playerRole: formData.context.playerRole,
      });
      if (!data.success || !data.playerConstraints) throw new Error('AI 응답이 올바르지 않습니다');
      setAiPreviewData(data.playerConstraints);
      setAiPreviewEdited(data.playerConstraints);
      setAiPreviewExisting(playerConstraintsValue);
      setAiPreviewType('playerConstraints');
      setAiPreviewOpen(true);
    } catch (error: any) {
      toast({ title: 'AI 생성 실패', description: error.message || '오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setIsGeneratingPlayerConstraints(false);
    }
  };

  const handleGenerateNpcBehaviorHarness = async (index: number) => {
    if (!canGenerateAI) return;
    const persona = formData.personas[index];
    setIsGeneratingNpcBehaviorHarness(prev => ({ ...prev, [index]: true }));
    try {
      const data = await streamApiRequest('/api/admin/generate-npc-behavior-harness', {
        title: formData.title,
        description: formData.description,
        situation: formData.context.situation,
        persona: {
          name: persona.name,
          stance: persona.stance,
          goal: persona.goal,
          tradeoff: persona.tradeoff,
        },
      });
      if (!data.success || !data.npcBehaviorHarness) throw new Error('AI 응답이 올바르지 않습니다');

      if (persona.npcBehaviorHarness) {
        const confirmed = window.confirm('이미 입력된 NPC Behavior Harness가 있습니다. AI가 생성한 내용으로 덮어쓰시겠습니까?');
        if (!confirmed) return;
      }
      const newPersonas = [...formData.personas];
      newPersonas[index] = { ...persona, npcBehaviorHarness: data.npcBehaviorHarness };
      setFormData(prev => ({ ...prev, personas: newPersonas }));
      toast({ title: 'AI 생성 완료', description: `${persona.name || `페르소나 ${index + 1}`}의 NPC Behavior Harness가 채워졌습니다.` });
    } catch (error: any) {
      toast({ title: 'AI 생성 실패', description: error.message || '오류가 발생했습니다.', variant: 'destructive' });
    } finally {
      setIsGeneratingNpcBehaviorHarness(prev => ({ ...prev, [index]: false }));
    }
  };

  const closeAiPreviewDialog = () => {
    setAiPreviewOpen(false);
    setAiPreviewData(null);
    setAiPreviewEdited(null);
    setAiPreviewExisting(null);
    setAiPreviewType(null);
  };

  const handleApplyAiPreview = () => {
    if (!aiPreviewType) return;
    const dataToApply = aiPreviewEdited ?? aiPreviewData;
    if (!dataToApply) return;
    if (aiPreviewType === 'evaluationHarness') {
      setEvaluationHarnessValue(dataToApply as EvaluationHarness);
      setBuilderKey(k => k + 1);
      toast({ title: 'AI 생성 완료', description: '평가 기준(evaluationHarness)이 채워졌습니다.' });
    } else {
      setPlayerConstraintsValue(dataToApply as PlayerConstraints);
      toast({ title: 'AI 생성 완료', description: '플레이어 제약(playerConstraints)이 채워졌습니다.' });
    }
    closeAiPreviewDialog();
  };

  const pollIntroVideoJob = (scenarioId: string, jobId: string, deadline: number) => {
    const POLL_INTERVAL_MS = 5_000;

    const poll = async (): Promise<void> => {
      if (Date.now() > deadline) {
        setIsGeneratingVideo(false);
        toast({
          title: t('admin.scenarioManager.toast.videoGenerateFailed', '비디오 생성 시간 초과'),
          description: '비디오 생성 시간이 초과되었습니다. 다시 시도해주세요.',
          variant: 'destructive',
        });
        return;
      }

      try {
        const statusRes = await apiRequest('GET', `/api/admin/scenarios/${scenarioId}/generate-intro-video/status?jobId=${encodeURIComponent(jobId)}`);

        if (statusRes.status === 404) {
          setIsGeneratingVideo(false);
          toast({
            title: '서버 재시작',
            description: '서버가 재시작되어 작업 정보를 찾을 수 없습니다. 다시 시도해주세요.',
            variant: 'destructive',
          });
          return;
        }

        const data = await statusRes.json();

        if (data.status === 'done' && data.result?.videoUrl) {
          setIsGeneratingVideo(false);
          setFormData(prev => ({
            ...prev,
            introVideoUrl: data.result.videoUrl,
            introVideoMode: 'custom',
            introVideoModel: data.result.model || prev.introVideoModel || '',
          }));
          toast({
            title: t('admin.scenarioManager.toast.videoGenerated', '비디오 생성 완료'),
            description: t('admin.scenarioManager.toast.videoGeneratedDesc', '인트로 비디오가 생성되었습니다.'),
          });
          queryClient.invalidateQueries({ queryKey: ['/api/admin/scenarios'] });
        } else if (data.status === 'error') {
          setIsGeneratingVideo(false);
          toast({
            title: t('admin.scenarioManager.toast.videoGenerateFailed', '비디오 생성 실패'),
            description: data.error || '비디오 생성 중 오류가 발생했습니다.',
            variant: 'destructive',
          });
        } else {
          // pending or running — keep polling
          videoJobPollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (pollErr: any) {
        const msg = pollErr?.message ?? '';
        if (msg.includes('404') || msg.includes('Job not found')) {
          setIsGeneratingVideo(false);
          toast({
            title: '서버 재시작',
            description: '서버가 재시작되어 작업 정보를 찾을 수 없습니다. 다시 시도해주세요.',
            variant: 'destructive',
          });
          return;
        }
        // Network glitch — keep polling
        videoJobPollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    videoJobPollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
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

    // Cancel any existing poll
    if (videoJobPollRef.current) {
      clearTimeout(videoJobPollRef.current);
      videoJobPollRef.current = null;
    }

    setIsGeneratingVideo(true);
    setVideoLoadFailed(false);
    try {
      const response = await apiRequest('POST', `/api/admin/scenarios/${editingScenario.id}/generate-intro-video`, {
        customPrompt: formData.videoPrompt || undefined,
      });

      const data = await response.json();

      if (!data.jobId) {
        throw new Error(data.error || '작업 ID를 받지 못했습니다.');
      }

      toast({
        title: '비디오 생성 시작',
        description: '인트로 비디오 생성 중… 완료되면 자동으로 반영됩니다. (최대 5분)',
      });

      const TIMEOUT_MS = 10 * 60_000; // 10 minutes
      pollIntroVideoJob(editingScenario.id, data.jobId, Date.now() + TIMEOUT_MS);
    } catch (error: any) {
      console.error('Video generation error:', error);
      setIsGeneratingVideo(false);
      toast({
        title: t('admin.scenarioManager.toast.videoGenerateFailed', 'Video Generation Failed'),
        description: error.message || t('admin.scenarioManager.toast.videoGenerateFailed', 'An error occurred during video generation.'),
        variant: "destructive",
      });
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
        situation: formData.context?.situation,
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
        setFormData(prev => ({ ...prev, introVideoUrl: '', introVideoMode: 'none', introVideoModel: '' }));
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

  const handleUploadDefaultVideo = async (file: File) => {
    if (!file) return;
    const validTypes = ['video/webm', 'video/mp4'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: '지원하지 않는 형식',
        description: 'WebM 또는 MP4 형식의 비디오 파일만 업로드할 수 있습니다.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploadingDefaultVideo(true);
    try {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = { 'Content-Type': file.type };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/admin/default-intro-video', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: file,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || '업로드 실패');
      }

      toast({
        title: '기본 비디오 업로드 완료',
        description: '기본 인트로 비디오가 성공적으로 교체되었습니다.',
      });
      refetchDefaultVideo();
      queryClient.invalidateQueries({ queryKey: ['/api/media/default-intro-video'] });
    } catch (error: any) {
      console.error('Default video upload error:', error);
      toast({
        title: '업로드 실패',
        description: error.message || '기본 인트로 비디오 업로드 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsUploadingDefaultVideo(false);
      if (defaultVideoInputRef.current) defaultVideoInputRef.current.value = '';
    }
  };

  const handleResetDefaultVideo = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/default-intro-video', {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('초기화 실패');
      toast({ title: '기본 비디오 초기화 완료', description: '기본 인트로 비디오가 정적 파일로 되돌아갔습니다.' });
      refetchDefaultVideo();
      queryClient.invalidateQueries({ queryKey: ['/api/media/default-intro-video'] });
    } catch (error: any) {
      toast({ title: '초기화 실패', description: error.message, variant: 'destructive' });
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

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 200);
  };

  // Export: 전체 시나리오를 시나리오별 JSON ZIP으로 다운로드
  const handleExport = () => {
    if (!scenarios || scenarios.length === 0) {
      toast({ title: '내보낼 시나리오가 없습니다', variant: 'destructive' });
      return;
    }
    try {
      const zip = createScenariosZip(scenarios);
      downloadBlob(new Blob([zip], { type: 'application/zip' }), `scenarios-export-${new Date().toISOString().slice(0, 10)}.zip`);
      toast({ title: `${scenarios.length}개 시나리오를 내보냈습니다` });
    } catch (error: any) {
      console.error('Scenario ZIP export error:', error);
      toast({
        title: '내보내기 실패',
        description: error?.message || 'ZIP 파일을 생성하거나 다운로드하지 못했습니다.',
        variant: 'destructive',
      });
    }
  };

  const handleExportScenario = (scenario: ComplexScenario) => {
    setExportingScenarioId(scenario.id);
    try {
      downloadBlob(
        new Blob([scenarioJson(scenario)], { type: 'application/json' }),
        safeScenarioFileName(scenario),
      );
      toast({ title: '시나리오를 내보냈습니다' });
    } catch (error: any) {
      console.error('Scenario export error:', error);
      toast({
        title: '내보내기 실패',
        description: error?.message || 'JSON 파일을 생성하거나 다운로드하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setExportingScenarioId(null);
    }
  };

  // Import: JSON/ZIP 파일 파싱 후 시나리오 생성
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (importFileRef.current) importFileRef.current.value = '';
    
    let parsed: unknown[];
    let parseFailures = 0;
    try {
      const result = await parseScenarioImportFile(file);
      parsed = result.items;
      parseFailures = result.invalidEntries;
      if (parsed.length === 0 && parseFailures > 0) {
        throw new Error('유효한 시나리오 JSON이 없습니다');
      }
    } catch (err: any) {
      toast({ title: '파일 파싱 실패', description: err.message || 'JSON 또는 ZIP 파일을 읽지 못했습니다', variant: 'destructive' });
      return;
    }

    setIsImporting(true);
    let successCount = 0;
    let failCount = parseFailures;

    for (const rawItem of parsed) {
      try {
        const scenarioData = normalizeScenarioImport(rawItem);
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
                accept=".json,.zip,application/json,application/zip"
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
              <TooltipContent side="bottom">시나리오별 JSON을 ZIP 파일로 내보냅니다</TooltipContent>
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
          
            <ScenarioEditor
              title={formData.title || editingScenario?.title || ''}
              isNew={!editingScenario}
              pending={createMutation.isPending || updateMutation.isPending}
              onSubmit={handleSubmit}
              onClose={() => { setIsCreateOpen(false); setEditingScenario(null); resetForm(); }}
              revision={JSON.stringify({
                formData, flowGraphValue, personaSwitchRulesValue, terminationRulesValue,
                evaluationHarnessValue, playerConstraintsValue, difficultyProfileValue,
                analyticsTrackedMetrics, analyticsReportSections, analyticsBenchmarkGroup,
                harnessEnabled, harnessAffectiveAxes, harnessMaxCallsPerTurn, harnessMaxDeltaPerCall,
                harnessAllowedTypes, harnessGlobalCooldownSec, harnessPerTypeCooldownSec,
                harnessStateUpdatesEnabled, harnessPreferredSignals, harnessRawJson,
              })}
            >
              {/* 품질 패널 — 편집 모드에서만 표시 (실시간 미리보기 우선) */}
              {editingScenario && (
                <details className="scenario-editor-quality">
                  <summary>품질 검토 및 수정 필요 항목</summary>
                <ScenarioQualityPanel
                  validation={liveValidation ?? validationMap[String(editingScenario.id)]}
                  isLive={!!liveValidation}
                  savedScore={liveValidation ? validationMap[String(editingScenario.id)]?.score : undefined}
                />
                </details>
              )}

              {/* ── 기본 정보 ── */}
              <ScenarioEditorRegion sections="basic" className="se-stack">
                <EditorGroup title="개요" description="목록과 시작 화면에서 학습자가 가장 먼저 보는 정보입니다.">
                  <Field label={t('admin.scenarioManager.form.scenarioTitle')} htmlFor="title" required>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                      placeholder={t('admin.scenarioManager.form.scenarioTitlePlaceholder')}
                      required
                      data-testid="input-scenario-title"
                      className="bg-white"
                    />
                  </Field>
                  <FieldGrid>
                    <Field label={t('admin.scenarioManager.form.category')} htmlFor="category" required
                      error={!formData.categoryId ? t('admin.scenarioManager.form.selectCategory') : undefined}>
                      <Select
                        value={formData.categoryId || ''}
                        onValueChange={(val) => setFormData(prev => ({ ...prev, categoryId: val }))}
                      >
                        <SelectTrigger
                          id="category"
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
                    </Field>
                    <Field label={t('admin.scenarioManager.form.estimatedTime', 'Estimated Time')} htmlFor="estimatedTime" required
                      hint="목록에 표시되는 안내 문구입니다. 실제 대화 길이는 평가 방식에서 정합니다.">
                      <Input
                        id="estimatedTime"
                        value={formData.estimatedTime}
                        onChange={(e) => setFormData(prev => ({ ...prev, estimatedTime: e.target.value }))}
                        placeholder={t('admin.scenarioManager.form.estimatedTimePlaceholder', 'e.g., 30-45 min')}
                        required
                        data-testid="input-estimated-time"
                        className="bg-white"
                      />
                    </Field>
                  </FieldGrid>
                  <Field label={t('admin.scenarioManager.form.scenarioDescription')} htmlFor="description" required>
                    <AutoResizeTextarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder={t('admin.scenarioManager.form.scenarioDescriptionPlaceholder')}
                      className="min-h-[100px] bg-white whitespace-pre-wrap"
                      required
                      data-testid="textarea-scenario-description"
                    />
                  </Field>
                </EditorGroup>

                <EditorGroup title="연습할 역량" description="이 시나리오로 키우려는 역량입니다. 쉼표로 구분해 입력하면 태그로 정리됩니다.">
                  <Field label={t('admin.scenarioManager.form.skills')} htmlFor="skills">
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
                  </Field>
                  {formData.skills.length > 0 && (
                    <ul className="se-tags" aria-label="입력된 역량">
                      {formData.skills.map((skill, index) => (
                        <li key={index} className="se-tag">
                          {skill}
                          <button
                            type="button"
                            onClick={() => removeSkill(index)}
                            aria-label={`${skill} 삭제`}
                            data-testid={`remove-skill-${index}`}
                          >
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </EditorGroup>
              </ScenarioEditorRegion>

              {/* ── 상황과 학습자 역할 ── */}
              <ScenarioEditorRegion sections="situation" className="se-stack">
                <EditorGroup title="상황" description="대화가 시작되기 직전까지 무슨 일이 있었는지 적습니다.">
                  <Field label={t('admin.scenarioManager.form.situation')} htmlFor="situation">
                    <AutoResizeTextarea
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
                  </Field>
                  <FieldGrid>
                    <Field label={t('admin.scenarioManager.form.timeline')} htmlFor="timeline">
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
                    </Field>
                    <Field label={t('admin.scenarioManager.form.stakes')} htmlFor="stakes">
                      <AutoResizeTextarea
                        id="stakes"
                        value={formData.context.stakes}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          context: { ...prev.context, stakes: e.target.value }
                        }))}
                        placeholder={t('admin.scenarioManager.form.stakesPlaceholder')}
                        data-testid="input-stakes"
                        className="min-h-[40px] bg-white whitespace-pre-wrap"
                      />
                    </Field>
                  </FieldGrid>
                </EditorGroup>

                <EditorGroup title="학습자 역할" description="학습자가 맡을 인물입니다. 대화 상대는 이 정보를 기준으로 반응합니다.">
                  <FieldGrid>
                    {([
                      { key: 'position', id: 'position', testId: 'input-position', label: t('admin.scenarioManager.form.playerPosition', 'Player Position'), placeholder: t('admin.scenarioManager.form.playerPositionPlaceholder', 'e.g., Junior Developer') },
                      { key: 'department', id: 'playerDepartment', testId: 'input-player-department', label: t('admin.scenarioManager.form.playerDepartment', 'Player Department'), placeholder: t('admin.scenarioManager.form.playerDepartmentPlaceholder', 'e.g., Development Team') },
                      { key: 'experience', id: 'playerExperience', testId: 'input-player-experience', label: t('admin.scenarioManager.form.playerExperience', 'Player Experience'), placeholder: t('admin.scenarioManager.form.playerExperiencePlaceholder', 'e.g., 6 months') },
                      { key: 'responsibility', id: 'responsibility', testId: 'input-responsibility', label: t('admin.scenarioManager.form.playerResponsibility', 'Responsibility'), placeholder: t('admin.scenarioManager.form.playerResponsibilityPlaceholder', 'e.g., Coordinate with departments') },
                    ] as const).map(f => (
                      <Field key={f.key} label={f.label} htmlFor={f.id}>
                        <Input
                          id={f.id}
                          value={formData.context.playerRole[f.key]}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            context: { ...prev.context, playerRole: { ...prev.context.playerRole, [f.key]: e.target.value } }
                          }))}
                          placeholder={f.placeholder}
                          data-testid={f.testId}
                          className="bg-white"
                        />
                      </Field>
                    ))}
                  </FieldGrid>
                </EditorGroup>

                <AdvancedDisclosure summary="학습자 행동 제약과 난이도 조정" description="필요할 때만 설정합니다. 비워 두면 기본 동작을 따릅니다.">
                  <EditorGroup flat id="section-player-constraints"
                    title={<>학습자 행동 제약<SectionIssueIcon sectionId="section-player-constraints" issuesBySectionId={liveIssuesBySectionId.size > 0 ? liveIssuesBySectionId : issuesBySectionId} /></>}
                    description="학습자가 해서는 안 되는 말이나 반드시 지켜야 할 조건입니다."
                    actions={<AiGenerateButton onClick={handleGeneratePlayerConstraints} loading={isGeneratingPlayerConstraints}
                      disabled={!canGenerateAI || isGeneratingPlayerConstraints || isAnyGenerating}
                      blockedReason={aiBlockedReason({ needsContext: !canGenerateAI, otherRunning: isAnyGenerating && !isGeneratingPlayerConstraints })} />}>
                    <PlayerConstraintsBuilder
                      value={playerConstraintsValue}
                      onChange={setPlayerConstraintsValue}
                    />
                  </EditorGroup>
                  <EditorGroup flat title="난이도 프로파일" description="대화 상대의 저항 강도와 단서 제공 정도를 조정합니다.">
                    <DifficultyProfileBuilder
                      value={difficultyProfileValue}
                      onChange={setDifficultyProfileValue}
                    />
                  </EditorGroup>
                </AdvancedDisclosure>
              </ScenarioEditorRegion>

              {/* ── 대화 상대 ── */}
              <ScenarioEditorRegion sections="actors" id="section-personas" className="se-stack">
                <div className="se-toolbar">
                  <div className="min-w-0">
                    <p className="se-toolbar-title">
                      {t('admin.scenarioManager.form.personaManagement')}
                      <span className="se-count">{formData.personas.length}명</span>
                      <SectionIssueIcon sectionId="section-personas" issuesBySectionId={liveIssuesBySectionId.size > 0 ? liveIssuesBySectionId : issuesBySectionId} />
                    </p>
                    <p className="se-toolbar-hint">기본 이미지와 아바타 설정을 확인하고, 카드를 펼쳐 프로필과 반응 방식을 편집하세요.</p>
                  </div>
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
                    size="sm"
                    className="se-primary-action"
                    data-testid="add-persona"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {t('admin.scenarioManager.form.addPersona')}
                  </Button>
                </div>

                {invalidCultureActors.size > 0 && (
                  <div role="alert" className="se-alert is-warn">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>문화적 특성을 켠 대화 상대는 프로필 선택이 필요합니다. 미완료: {Array.from(invalidCultureActors).sort((a, b) => a - b).map((i) => `${i + 1}번`).join(', ')}</span>
                  </div>
                )}

                {formData.personas.length >= 2 && (
                  <EditorGroup title="상대 전환 방식" description="둘 이상의 상대가 등장할 때 새 상대가 들어오는 방식입니다.">
                    <Field label="전환 방식" htmlFor="persona-switch-mode" className="se-narrow">
                      <Select
                        value={formData.personaSwitchMode ?? 'replace'}
                        onValueChange={(value: 'replace' | 'join' | 'none') =>
                          setFormData(prev => ({ ...prev, personaSwitchMode: value }))
                        }
                      >
                        <SelectTrigger id="persona-switch-mode" className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="replace">
                            <div>
                              <div className="font-medium">교체</div>
                              <div className="text-xs text-slate-500">다음 상대가 이전 상대를 대신합니다</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="join">
                            <div>
                              <div className="font-medium">합류</div>
                              <div className="text-xs text-slate-500">다음 상대가 기존 상대와 함께 참여합니다</div>
                            </div>
                          </SelectItem>
                          <SelectItem value="none">
                            <div>
                              <div className="font-medium">전환 안 함</div>
                              <div className="text-xs text-slate-500">첫 번째 상대만 대화에 남습니다</div>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </EditorGroup>
                )}

                <div className="se-actor-list">
                  {formData.personas.map((persona, index) => {
                    const template = availablePersonas.find(p => p.id === getScenarioPersonaTemplateId(persona));
                    const updatePersona = (patch: Partial<ScenarioPersona>) => {
                      const newPersonas = [...formData.personas];
                      newPersonas[index] = { ...persona, ...patch };
                      setFormData(prev => ({ ...prev, personas: newPersonas }));
                    };
                    return (
                    <details key={index} id={`scenario-actor-${index}`} open={index === 0 ? true : undefined} className="se-actor">
                      <summary className="se-actor-summary flex-wrap">
                        <span className="se-actor-index" aria-hidden="true">{index + 1}</span>
                        <span className="se-actor-name">
                          {persona.name || `${index + 1}번 대화 상대`}
                          <small>{[persona.department, persona.position, persona.mbti].filter(Boolean).join(' · ') || '프로필 미입력'}</small>
                        </span>
                        <PersonaMediaPreview persona={template} gender={persona.gender} />
                        {persona.isPrimary && <span className="se-chip is-info">주 상대</span>}
                        {persona.culture && <span className="se-chip">문화 설정</span>}
                        <ChevronDown className="se-actor-chevron h-4 w-4" aria-hidden="true" />
                      </summary>
                      <div className="se-actor-body">
                        <EditorGroup flat title="프로필" description="등록된 페르소나를 고르면 성격 유형이 자동으로 채워집니다."
                          actions={
                            <Button
                              type="button"
                              onClick={() => {
                                setInvalidCultureActors((current) => {
                                  const adjusted = new Set<number>();
                                  current.forEach((actorIndex) => {
                                    if (actorIndex < index) adjusted.add(actorIndex);
                                    else if (actorIndex > index) adjusted.add(actorIndex - 1);
                                  });
                                  return adjusted;
                                });
                                setFormData(prev => ({
                                  ...prev,
                                  personas: prev.personas.filter((_, i) => i !== index)
                                }));
                              }}
                              variant="ghost"
                              size="sm"
                              className="se-danger-ghost"
                              aria-label={`${index + 1}번 대화 상대 삭제`}
                              data-testid={`remove-persona-${index}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              <span>삭제</span>
                            </Button>
                          }>
                          <FieldGrid cols={3}>
                            <Field label={t('admin.scenarioManager.form.personaId')} htmlFor={`persona-id-${index}`} required>
                              <Select
                                value={getScenarioPersonaTemplateId(persona)}
                                onValueChange={(selectedId) => {
                                  if (selectedId === '__new_persona__') {
                                    handleSaveAndGoToPersona();
                                    return;
                                  }
                                  const selectedPersona = availablePersonas.find(p => p.id === selectedId);
                                  if (selectedPersona) {
                                    const newPersonas = [...formData.personas];
                                    const actorId = stableActorIdForTemplate(selectedId, persona, formData.personas);
                                    newPersonas[index] = {
                                      ...persona,
                                      id: actorId,
                                      mbti: selectedPersona.mbti.toUpperCase(),
                                      personaRef: selectedId
                                    };
                                    setFormData(prev => ({ ...prev, personas: newPersonas }));
                                  }
                                }}
                              >
                                <SelectTrigger id={`persona-id-${index}`} data-testid={`select-persona-id-${index}`} className="bg-white">
                                  <SelectValue placeholder={t('admin.scenarioManager.form.selectPersona')} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__new_persona__">
                                    <div className="flex items-center gap-2 font-medium text-[color:var(--editor-sky)]">
                                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                      <span>페르소나 신규 생성</span>
                                    </div>
                                  </SelectItem>
                                  {getAvailablePersonasForSlot().length === 0 ? (
                                    <div className="py-2 px-3 text-sm text-slate-500">
                                      {t('admin.scenarioManager.form.noPersonasAvailable')}
                                    </div>
                                  ) : (
                                    getAvailablePersonasForSlot().map((p) => (
                                      <SelectItem key={p.id} value={p.id}>
                                        <div className="flex items-center gap-2">
                                          <PersonaMediaPreview persona={p} gender={persona.gender} compact />
                                          <span className="font-medium">{p.mbti}</span>
                                          <span className="text-xs text-slate-500">({p.id})</span>
                                        </div>
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field label={t('admin.scenarioManager.form.personaName', 'Name')} htmlFor={`persona-name-${index}`} required>
                              <Input
                                id={`persona-name-${index}`}
                                value={persona.name}
                                onChange={(e) => updatePersona({ name: e.target.value })}
                                placeholder={t('admin.scenarioManager.form.personaNamePlaceholder', '예: 김서연')}
                                data-testid={`input-persona-name-${index}`}
                                className="bg-white"
                              />
                            </Field>
                            <Field label={t('admin.scenarioManager.form.personaGender', 'Gender')} htmlFor={`persona-gender-${index}`} required>
                              <Select
                                value={persona.gender}
                                onValueChange={(value: 'male' | 'female') => updatePersona({ gender: value })}
                              >
                                <SelectTrigger id={`persona-gender-${index}`} data-testid={`select-persona-gender-${index}`} className="bg-white">
                                  <SelectValue placeholder={t('admin.scenarioManager.form.selectGender', 'Select gender')} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="male">{t('admin.personaManager.male')}</SelectItem>
                                  <SelectItem value="female">{t('admin.personaManager.female')}</SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                            <Field label={t('admin.scenarioManager.form.personaDepartment')} htmlFor={`persona-department-${index}`} required>
                              <Input
                                id={`persona-department-${index}`}
                                value={persona.department}
                                onChange={(e) => updatePersona({ department: e.target.value })}
                                placeholder={t('admin.scenarioManager.form.personaDepartmentPlaceholder')}
                                data-testid={`input-persona-department-${index}`}
                                className="bg-white"
                              />
                            </Field>
                            <Field label={t('admin.scenarioManager.form.personaPosition')} htmlFor={`persona-position-${index}`} required>
                              <Input
                                id={`persona-position-${index}`}
                                value={persona.position}
                                onChange={(e) => updatePersona({ position: e.target.value })}
                                placeholder={t('admin.scenarioManager.form.personaPositionPlaceholder')}
                                data-testid={`input-persona-position-${index}`}
                                className="bg-white"
                              />
                            </Field>
                            <Field label={t('admin.scenarioManager.form.personaExperience', 'Experience')} htmlFor={`persona-experience-${index}`}>
                              <Input
                                id={`persona-experience-${index}`}
                                value={persona.experience}
                                onChange={(e) => updatePersona({ experience: e.target.value })}
                                placeholder={t('admin.scenarioManager.form.personaExperiencePlaceholder', 'e.g., 8 years, junior, 5 years')}
                                data-testid={`input-persona-experience-${index}`}
                                className="bg-white"
                              />
                            </Field>
                          </FieldGrid>
                        </EditorGroup>

                        <EditorGroup flat title="대화 속 입장" description="이 인물이 무엇을 원하고, 무엇을 양보할 수 있는지 정합니다.">
                          <Field label={t('admin.scenarioManager.form.personaStance')} htmlFor={`persona-stance-${index}`} required>
                            <AutoResizeTextarea
                              id={`persona-stance-${index}`}
                              value={persona.stance}
                              onChange={(e) => updatePersona({ stance: e.target.value })}
                              placeholder={t('admin.scenarioManager.form.personaStancePlaceholder')}
                              data-testid={`input-persona-stance-${index}`}
                              className="bg-white whitespace-pre-wrap"
                            />
                          </Field>
                          <FieldGrid>
                            <Field label={t('admin.scenarioManager.form.personaGoal')} htmlFor={`persona-goal-${index}`} required>
                              <AutoResizeTextarea
                                id={`persona-goal-${index}`}
                                value={persona.goal}
                                onChange={(e) => updatePersona({ goal: e.target.value })}
                                placeholder={t('admin.scenarioManager.form.personaGoalPlaceholder')}
                                data-testid={`input-persona-goal-${index}`}
                                className="bg-white whitespace-pre-wrap"
                              />
                            </Field>
                            <Field label={t('admin.scenarioManager.form.personaTradeoff')} htmlFor={`persona-tradeoff-${index}`} optional>
                              <AutoResizeTextarea
                                id={`persona-tradeoff-${index}`}
                                value={persona.tradeoff}
                                onChange={(e) => updatePersona({ tradeoff: e.target.value })}
                                placeholder={t('admin.scenarioManager.form.personaTradeoffPlaceholder')}
                                data-testid={`input-persona-tradeoff-${index}`}
                                className="bg-white whitespace-pre-wrap"
                              />
                            </Field>
                          </FieldGrid>
                        </EditorGroup>

                        <AdvancedDisclosure summary="등장 방식과 음성" description="여러 상대가 순서대로 등장할 때 사용합니다.">
                          <label htmlFor={`persona-isprimary-${index}`} className="se-check">
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
                            />
                            <span><strong>주 상대로 지정</strong><small>대화를 처음 시작하는 인물입니다. 한 명만 지정할 수 있습니다.</small></span>
                          </label>
                          <FieldGrid>
                            <Field label="음성 ID" htmlFor={`persona-voiceid-${index}`} optional hint="ElevenLabs 음성 ID. 비워 두면 기본 음성을 씁니다.">
                              <Input
                                id={`persona-voiceid-${index}`}
                                value={persona.voiceId ?? ''}
                                onChange={(e) => updatePersona({ voiceId: e.target.value })}
                                placeholder="voice id"
                                className="bg-white font-mono text-sm"
                              />
                            </Field>
                            <Field label="첫 대사" htmlFor={`persona-entryline-${index}`} optional hint="이 인물이 대화에 들어올 때 처음 하는 말입니다.">
                              <Input
                                id={`persona-entryline-${index}`}
                                value={persona.entryLine ?? ''}
                                onChange={(e) => updatePersona({ entryLine: e.target.value })}
                                placeholder="예: 잠깐 제가 이야기를 이어받겠습니다."
                                className="bg-white"
                              />
                            </Field>
                          </FieldGrid>
                          <Field label="등장 계기가 되는 표현" htmlFor={`persona-triggerhints-${index}`} optional hint="한 줄에 하나씩 입력합니다. 학습자가 이런 말을 하면 이 인물로 전환됩니다.">
                            <AutoResizeTextarea
                              id={`persona-triggerhints-${index}`}
                              value={(persona.triggerHints ?? []).join('\n')}
                              onChange={(e) => {
                                const hints = e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean);
                                updatePersona({ triggerHints: hints });
                              }}
                              placeholder={'예: 예산 승인\n법무 검토 필요'}
                              className="bg-white whitespace-pre-wrap text-sm"
                            />
                          </Field>
                        </AdvancedDisclosure>

                        <AdvancedDisclosure summary="반응 방식" description="감정 변화, 말투, 양보 조건 등 세부 반응을 정합니다.">
                          <div className="se-inline-actions">
                            <p className="se-field-hint">시나리오 내용을 바탕으로 초안을 만든 뒤 다듬을 수 있습니다.</p>
                            <AiGenerateButton
                              onClick={() => handleGenerateNpcBehaviorHarness(index)}
                              loading={!!isGeneratingNpcBehaviorHarness[index]}
                              disabled={!canGenerateAI || !!isGeneratingNpcBehaviorHarness[index] || isAnyGenerating}
                              blockedReason={aiBlockedReason({ needsContext: !canGenerateAI, otherRunning: isAnyGenerating && !isGeneratingNpcBehaviorHarness[index] })}
                            />
                          </div>
                          <NpcBehaviorHarnessBuilder
                            value={persona.npcBehaviorHarness}
                            onChange={(updated: NpcBehaviorHarness | null) => updatePersona({ npcBehaviorHarness: updated ?? undefined })}
                          />
                        </AdvancedDisclosure>

                        <ActorCultureEditor
                          key={`${editingScenario?.id ?? 'new'}-${persona.id || index}-${index}`}
                          actorKey={`${editingScenario?.id ?? 'new'}-${persona.id || index}-${index}`}
                          value={persona.culture}
                          onValidityChange={(incomplete) => {
                            setInvalidCultureActors((current) => {
                              const next = new Set(current);
                              if (incomplete) next.add(index);
                              else next.delete(index);
                              return next;
                            });
                          }}
                          onChange={(culture) => updatePersona({ culture })}
                        />
                      </div>
                    </details>
                    );
                  })}

                  {formData.personas.length === 0 && (
                    <div className="se-empty">
                      <UserX className="h-6 w-6" aria-hidden="true" />
                      <p className="se-empty-title">아직 대화 상대가 없습니다</p>
                      <p>{t('admin.scenarioManager.form.personaRequired')}</p>
                    </div>
                  )}
                </div>

                <EditorGroup title="아바타 표시" description="실시간 아바타 허용 정책은 아래의 정책 저장 버튼으로 별도 반영합니다. 영상 클립 설정은 상단 저장에 포함됩니다.">
                  <ScenarioLiveAvatarPolicy key={editingScenario?.id ?? "new"} scenarioId={editingScenario?.id} />
                  {canManageVideoAvatar && (
                    <ToggleRow
                      id="useVideoAvatar"
                      label="기본 아바타에 영상 클립 사용"
                      description={formData.useVideoAvatar ? '페르소나 영상 클립을 재생합니다' : '정적 이미지를 사용합니다'}
                      checked={formData.useVideoAvatar || false}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, useVideoAvatar: checked }))}
                    />
                  )}
                </EditorGroup>
              </ScenarioEditorRegion>

              {/* ── 학습 목표와 성공 기준 ── */}
              <ScenarioEditorRegion sections="goals" id="section-success-criteria" className="se-stack">
                <EditorGroup title={<>학습 목표<SectionIssueIcon sectionId="section-success-criteria" issuesBySectionId={liveIssuesBySectionId.size > 0 ? liveIssuesBySectionId : issuesBySectionId} /></>}
                  description="학습자가 이 대화에서 무엇을 해내야 하는지 정합니다.">
                  <Field label={t('admin.scenarioManager.form.objectiveType')} htmlFor="objectiveType" className="se-narrow">
                    <Select
                      value={formData.objectiveType || ''}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, objectiveType: value }))}
                    >
                      <SelectTrigger id="objectiveType" className="bg-white">
                        <SelectValue placeholder={t('admin.scenarioManager.form.selectObjectiveType')} />
                      </SelectTrigger>
                      <SelectContent>
                        {OBJECTIVE_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t('admin.scenarioManager.form.objectives')} htmlFor="objectives" hint="한 줄에 목표 하나씩 입력합니다.">
                    <AutoResizeTextarea
                      id="objectives"
                      value={formData.objectives.join('\n')}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        objectives: e.target.value.split('\n').filter(obj => obj.trim())
                      }))}
                      placeholder={'각 부서의 이해관계와 우려사항 파악\n부서 간 갈등을 중재하고 합의점 도출\n품질과 일정을 균형있게 고려한 현실적 해결책 제시'}
                      className="min-h-[100px] bg-white whitespace-pre-wrap"
                      data-testid="textarea-objectives"
                    />
                  </Field>
                </EditorGroup>

                <EditorGroup title="성공 기준" description="대화 결과를 네 단계로 구분합니다. 위에서 아래로 갈수록 낮은 결과입니다.">
                  <ol className="se-tiers">
                    {([
                      { key: 'optimal', label: t('admin.scenarioManager.form.optimal'), placeholder: '모든 부서가 만족하는 타협안 도출' },
                      { key: 'good', label: t('admin.scenarioManager.form.good'), placeholder: '주요 이해관계자들의 핵심 요구사항 반영' },
                      { key: 'acceptable', label: t('admin.scenarioManager.form.acceptable'), placeholder: '최소한의 품질 기준을 유지하면서 일정 준수' },
                      { key: 'failure', label: t('admin.scenarioManager.form.failure'), placeholder: '부서 간 갈등 심화 또는 비현실적 해결책 제시' },
                    ] as const).map(tier => (
                      <li key={tier.key} className="se-tier" data-tier={tier.key}>
                        <Field label={tier.label} htmlFor={tier.key}>
                          <AutoResizeTextarea
                            id={tier.key}
                            value={formData.successCriteria[tier.key]}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              successCriteria: { ...prev.successCriteria, [tier.key]: e.target.value }
                            }))}
                            placeholder={tier.placeholder}
                            className="min-h-[44px] bg-white whitespace-pre-wrap"
                            data-testid={`textarea-${tier.key}`}
                          />
                        </Field>
                      </li>
                    ))}
                  </ol>
                </EditorGroup>
              </ScenarioEditorRegion>

              {/* ── 대화 흐름 ── */}
              <ScenarioEditorRegion sections="flow" className="se-stack">
                <EditorGroup id="section-flow-graph"
                  title={<>대화 단계<SectionIssueIcon sectionId="section-flow-graph" issuesBySectionId={liveIssuesBySectionId.size > 0 ? liveIssuesBySectionId : issuesBySectionId} /></>}
                  description="단계마다 학습자가 할 일과 다음 단계로 넘어가는 조건을 정합니다. 설정하지 않으면 기존 동작을 유지합니다.">
                  <FlowGraphBuilder
                    focused
                    key={`fg-${builderKey}`}
                    defaultValue={flowGraphValue}
                    onChange={setFlowGraphValue}
                  />
                </EditorGroup>

                <AdvancedDisclosure summary="상대 자동 전환과 종료 규칙" description="조건에 따라 대화 상대를 바꾸거나 대화를 끝냅니다.">
                  <EditorGroup flat id="section-persona-switch"
                    title={<>상대 자동 전환<SectionIssueIcon sectionId="section-persona-switch" issuesBySectionId={liveIssuesBySectionId.size > 0 ? liveIssuesBySectionId : issuesBySectionId} /></>}
                    description="조건이 맞으면 다른 대화 상대가 등장합니다.">
                    <PersonaSwitchRulesBuilder
                      key={`psr-${builderKey}`}
                      defaultValue={personaSwitchRulesValue}
                      onChange={setPersonaSwitchRulesValue}
                      personaCount={Math.max(2, formData.personas.length)}
                    />
                  </EditorGroup>
                  <EditorGroup flat title="자동 종료 조건" description="성공, 실패, 시간 초과 조건 중 하나라도 충족하면 대화를 끝냅니다.">
                    <TerminationRulesBuilder
                      key={`tr-${builderKey}`}
                      defaultValue={terminationRulesValue}
                      onChange={setTerminationRulesValue}
                    />
                  </EditorGroup>
                </AdvancedDisclosure>

                <AdvancedDisclosure summary="시뮬레이션 정책" description="감정 변화 폭, 돌발 상황의 종류와 빈도를 조정합니다. 끄면 전역 기본값을 씁니다.">
              <div id="section-simulation-harness" className="se-stack">
                <ToggleRow
                  id="harness-enabled"
                  label={<>시나리오 전용 정책 사용<SectionIssueIcon sectionId="section-simulation-harness" issuesBySectionId={liveIssuesBySectionId.size > 0 ? liveIssuesBySectionId : issuesBySectionId} /></>}
                  description={harnessEnabled ? '아래 설정이 이 시나리오에 적용됩니다.' : '전역 기본값이 적용됩니다.'}
                  checked={harnessEnabled}
                  onCheckedChange={setHarnessEnabled}
                />

                {harnessEnabled && (
                  <div className="space-y-4">
                    {/* Affective Axes */}
                    <div>
                      <Label className="text-xs font-semibold text-slate-700 mb-1 block">어펙티브 레이어 축 (쉼표로 구분)</Label>
                      <Input
                        value={harnessAffectiveAxes}
                        onChange={e => setHarnessAffectiveAxes(e.target.value)}
                        placeholder="affective.intensity,relational.trust,cognitive.confusion,motivational.interest"
                        className="text-xs h-8"
                      />
                      <p className="text-xs text-slate-400 mt-0.5">AI가 조절할 어펙티브 레이어 축 목록 (기본: affective.intensity, relational.trust, cognitive.confusion, motivational.interest)</p>
                    </div>

                    {/* Emotion Tool Limits */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-3">
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                          <button type="button" onClick={() => setHarnessPreferredSignals(prev => prev.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-500 text-xs px-1" aria-label="신호 삭제"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
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

                          {/* Affective Axes — removable chips + add input */}
                          <div>
                            <span className="font-medium text-slate-500 block mb-1">어펙티브 레이어 축:</span>
                            <div className="flex gap-1 flex-wrap items-center">
                              {harnessEffective.affectiveAxes!.map(e => (
                                <span key={e} className="inline-flex items-center gap-0.5 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  {e}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = harnessEffective.affectiveAxes!.filter(x => x !== e);
                                      setHarnessAffectiveAxes(updated.join(','));
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
                                    if (name && !harnessEffective.affectiveAxes!.includes(name)) {
                                      setHarnessAffectiveAxes([...harnessEffective.affectiveAxes!, name].join(','));
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
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
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
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
                            const affectiveAxes = harnessAffectiveAxes.split(',').map(s => s.trim()).filter(Boolean);
                            const preferredSignals: Record<string, string> = {};
                            harnessPreferredSignals.forEach(({ key, value }) => { if (key.trim()) preferredSignals[key.trim()] = value; });
                            const built: any = { affectiveAxes, toolPolicy: {
                              npcAffectiveStateDelta: { maxCallsPerTurn: parseInt(harnessMaxCallsPerTurn) || 2, maxDeltaPerCall: parseInt(harnessMaxDeltaPerCall) || 30 },
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
                                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                        <span>{w}</span>
                                      </p>
                                    ))}
                                  </div>
                                )}
                                <div>
                                  <p className="text-slate-400 text-[10px] mb-0.5">어펙티브 레이어 축</p>
                                  <div className="flex flex-wrap gap-0.5">
                                    {harnessEffective.affectiveAxes!.map(e => (
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
                                  <p>상태 업데이트: <span className={`font-semibold ${harnessEffective.stateUpdatesEnabled ? 'text-green-600' : 'text-slate-400'}`}>{harnessEffective.stateUpdatesEnabled ? '켜짐' : '꺼짐'}</span></p>
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
                </AdvancedDisclosure>
              </ScenarioEditorRegion>

              {/* ── 평가 방식 ── */}
              <ScenarioEditorRegion sections="assessment" className="se-stack">
                <EditorGroup title={t('admin.scenarioManager.form.evaluationCriteria')} description={t('admin.scenarioManager.form.evaluationCriteriaHelp')}>
                  <Field label="적용할 기준 세트" htmlFor="evaluationCriteria" className="se-narrow">
                    <Select
                      value={formData.evaluationCriteriaSetId || 'default'}
                      onValueChange={(val) => setFormData(prev => ({ ...prev, evaluationCriteriaSetId: val === 'default' ? '' : val }))}
                    >
                      <SelectTrigger
                        id="evaluationCriteria"
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
                  </Field>
                  <ScenarioCriteriaPreview criteriaSetId={formData.evaluationCriteriaSetId} />
                </EditorGroup>

                <ConversationLengthGroup
                  difficulty={formData.difficulty}
                  targetDurationMinutes={formData.targetDurationMinutes}
                  targetTurns={formData.targetTurns}
                  minValidTurns={formData.minValidTurns}
                  onChange={(patch) => setFormData(prev => ({ ...prev, ...patch }))}
                />

                <EditorGroup id="section-evaluation"
                  title={<>세부 평가 기준<SectionIssueIcon sectionId="section-evaluation" issuesBySectionId={liveIssuesBySectionId.size > 0 ? liveIssuesBySectionId : issuesBySectionId} /></>}
                  description="점수 항목의 가중치와 판단 신호를 이 시나리오에 맞게 조정합니다. 비워 두면 기준 세트를 그대로 씁니다."
                  actions={<AiGenerateButton onClick={handleGenerateEvaluationHarness} loading={isGeneratingEvaluationHarness}
                    disabled={!canGenerateAI || isGeneratingEvaluationHarness || isAnyGenerating}
                    blockedReason={aiBlockedReason({ needsContext: !canGenerateAI, otherRunning: isAnyGenerating && !isGeneratingEvaluationHarness })} />}>
                  <EvaluationHarnessBuilder
                    key={`eh-${builderKey}`}
                    defaultValue={evaluationHarnessValue}
                    onChange={setEvaluationHarnessValue}
                  />
                </EditorGroup>

                <AdvancedDisclosure summary="분석 지표와 비교 그룹" description="리포트에 표시할 섹션과 추적 지표, 비교 기준 그룹을 정합니다.">
                  <Field label="추적 지표">
                    <div className="se-check-grid">
                      {TRACKED_METRICS.map((metric) => (
                        <label key={metric} className="se-check-chip">
                          <input
                            type="checkbox"
                            checked={analyticsTrackedMetrics.includes(metric)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAnalyticsTrackedMetrics(prev => [...prev, metric]);
                              } else {
                                setAnalyticsTrackedMetrics(prev => prev.filter(m => m !== metric));
                              }
                            }}
                          />
                          <span>{metric}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="보고서 섹션" hint="선택한 섹션만 피드백 리포트에 표시됩니다. 비워 두면 모든 섹션이 표시됩니다.">
                    <div className="se-check-grid">
                      {REPORT_SECTIONS.map((sec) => (
                        <label key={sec} className="se-check-chip">
                          <input
                            type="checkbox"
                            checked={analyticsReportSections.includes(sec)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAnalyticsReportSections(prev => [...prev, sec]);
                              } else {
                                setAnalyticsReportSections(prev => prev.filter(s => s !== sec));
                              }
                            }}
                          />
                          <span>{sec}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="비교 그룹" htmlFor="analytics-benchmark-group" className="se-narrow" hint="같은 그룹의 시나리오끼리 평균 점수를 비교합니다.">
                    <Input
                      id="analytics-benchmark-group"
                      value={analyticsBenchmarkGroup}
                      onChange={(e) => setAnalyticsBenchmarkGroup(e.target.value)}
                      placeholder="예: customer-complaint"
                      className="bg-white font-mono text-sm"
                    />
                  </Field>
                </AdvancedDisclosure>
              </ScenarioEditorRegion>

              {/* ── 이미지·영상 ── */}
              <ScenarioEditorRegion sections="media" className="se-stack">
                <EditorGroup title="시나리오 이미지" description="목록 카드와 시작 화면에 쓰입니다. 생성하거나 이미 만든 이미지를 고르세요."
                  actions={<Button type="button" variant="outline" size="sm" onClick={handleOpenImageSelector} className="se-secondary-action">
                    <Folder className="h-4 w-4" aria-hidden="true" />{t('admin.scenarioManager.form.selectExisting', '기존 이미지 선택')}
                  </Button>}>
                  <div className="se-media">
                    <div className="se-media-preview">
                      {!formData.image ? (
                        <div className="se-media-empty"><ImageOff className="h-6 w-6" aria-hidden="true" /><span>아직 이미지가 없습니다</span></div>
                      ) : imageLoadFailed ? (
                        <div className="se-media-empty is-warn">
                          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
                          <span>이미지 파일을 찾을 수 없습니다</span>
                          <Button type="button" variant="ghost" size="sm" className="se-danger-ghost"
                            onClick={() => { setFormData(prev => ({ ...prev, image: '' })); setImageLoadFailed(false); }}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" />이미지 경로 지우기
                          </Button>
                        </div>
                      ) : (
                        <button type="button" className="se-media-frame" aria-label="이미지 크게 보기"
                          onClick={() => setImagePreviewUrl(selectedImageSignedUrl || toMediaUrl(formData.image) || null)}
                          data-testid="image-preview-container">
                          <img
                            src={selectedImageSignedUrl || toMediaUrl(formData.image)}
                            alt={t('admin.scenarioManager.form.imagePreview')}
                            onError={() => setImageLoadFailed(true)}
                            onLoad={() => setImageLoadFailed(false)}
                            data-testid="scenario-image-preview"
                          />
                          <span className="se-media-zoom"><Eye className="h-3.5 w-3.5" aria-hidden="true" />크게 보기</span>
                        </button>
                      )}
                    </div>
                    <div className="se-media-controls">
                      <Field label={t('admin.scenarioManager.form.imagePromptLabel', '이미지 생성 설명')} htmlFor="imagePrompt" optional
                        hint="비워 두면 시나리오 내용으로 자동 작성합니다."
                        action={<button type="button" className="se-link" onClick={handleLoadDefaultImagePrompt} disabled={!formData.title}>
                          {t('admin.scenarioManager.form.loadDefaultPrompt', '기본 프롬프트 로드')}
                        </button>}>
                        <AutoResizeTextarea
                          id="imagePrompt"
                          value={formData.imagePrompt || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, imagePrompt: e.target.value }))}
                          placeholder={t('admin.scenarioManager.form.imagePromptPlaceholder', 'Enter custom image prompt. Leave empty to auto-generate.')}
                          className="min-h-[80px] bg-white whitespace-pre-wrap"
                          data-testid="textarea-image-prompt"
                        />
                      </Field>
                      <AiGenerateButton
                        variant="primary"
                        block
                        testId="button-generate-image"
                        onClick={handleGenerateImage}
                        loading={isGeneratingImage}
                        loadingLabel={t('admin.scenarioManager.form.generatingImage')}
                        label={t('admin.scenarioManager.form.generateImage')}
                        disabled={isGeneratingImage || !formData.title || isAnyGenerating}
                        blockedReason={aiBlockedReason({ needsContext: !formData.title, contextMessage: '시나리오 제목을 먼저 입력해 주세요', otherRunning: isAnyGenerating && !isGeneratingImage })}
                      />
                      <Field label={t('admin.scenarioManager.form.imageUrl')} htmlFor="image" hint="이미지 경로를 직접 입력할 수도 있습니다.">
                        <Input
                          id="image"
                          value={formData.image || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, image: e.target.value }))}
                          placeholder={t('admin.scenarioManager.form.imageUrlPlaceholder')}
                          data-testid="input-scenario-image"
                          className="bg-white font-mono text-sm"
                        />
                      </Field>
                    </div>
                  </div>
                </EditorGroup>

                <EditorGroup title={t('admin.scenarioManager.form.introVideo')} description="대화 시작 전에 재생할 영상을 고릅니다.">
                  <div role="radiogroup" aria-label="시작 영상 방식" className="se-segment">
                    {([
                      { mode: 'none', label: '사용 안 함', hint: '영상 없이 바로 시작', Icon: VideoOff },
                      { mode: 'default', label: '기본 영상', hint: '모든 시나리오 공통', Icon: Film },
                      { mode: 'custom', label: '전용 영상', hint: '이 시나리오만의 영상', Icon: Video },
                    ] as const).map(({ mode, label, hint, Icon }) => (
                      <button key={mode} type="button" role="radio" aria-checked={formData.introVideoMode === mode}
                        onClick={() => setFormData(prev => ({ ...prev, introVideoMode: mode }))}
                        data-testid={`video-mode-${mode}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span className="se-segment-label">{label}</span>
                        <span className="se-segment-hint">{hint}</span>
                      </button>
                    ))}
                  </div>

                  {formData.introVideoMode === 'default' && (
                    <div className="se-media is-video">
                      <div className="se-media-preview is-dark">
                        <video
                          key={defaultVideoInfo?.url}
                          src={defaultVideoInfo?.hasCustomVideo ? toMediaUrl(defaultVideoInfo.url) : '/videos/intro_default.webm'}
                          controls
                          preload="metadata"
                          data-testid="default-video-preview"
                        />
                      </div>
                      <div className="se-media-controls">
                        <p className="se-field-hint">
                          {defaultVideoInfo?.hasCustomVideo ? '교체된 공통 영상을 사용 중입니다.' : '기본 제공 영상을 사용 중입니다.'}
                          {' '}교체하면 기본 영상을 쓰는 모든 시나리오에 적용됩니다. WebM 또는 MP4를 지원합니다.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" className="se-secondary-action"
                            disabled={isUploadingDefaultVideo} onClick={() => defaultVideoInputRef.current?.click()}>
                            {isUploadingDefaultVideo
                              ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />업로드 중…</>
                              : <><Upload className="h-4 w-4" aria-hidden="true" />공통 영상 교체</>}
                          </Button>
                          {defaultVideoInfo?.hasCustomVideo && (
                            <Button type="button" variant="ghost" size="sm" className="se-danger-ghost" onClick={handleResetDefaultVideo}>
                              기본 제공 영상으로 되돌리기
                            </Button>
                          )}
                        </div>
                        <input
                          ref={defaultVideoInputRef}
                          type="file"
                          accept="video/webm,video/mp4"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadDefaultVideo(file);
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {formData.introVideoMode === 'custom' && (
                    <div className="se-media is-video">
                      <div className="se-media-preview is-dark">
                        {isGeneratingVideo ? (
                          <div className="se-media-empty"><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /><span>영상을 생성하고 있습니다</span></div>
                        ) : videoLoadFailed ? (
                          <div className="se-media-empty is-warn"><AlertTriangle className="h-6 w-6" aria-hidden="true" /><span>영상을 불러올 수 없습니다. 새로 생성해 주세요.</span></div>
                        ) : formData.introVideoUrl ? (
                          <div className="se-media-frame is-video" data-testid="video-preview-container">
                            <video
                              key={formData.introVideoUrl}
                              src={toMediaUrl(formData.introVideoUrl)}
                              controls
                              preload="metadata"
                              onError={() => {
                                setVideoLoadFailed(true);
                                setFormData(prev => ({ ...prev, introVideoUrl: '', introVideoModel: '' }));
                              }}
                              data-testid="scenario-video-preview"
                            />
                            <div className="se-media-caption">
                              {formData.introVideoModel && (
                                <span className="se-chip">{formData.introVideoModel.includes('lite') ? 'Lite' : formData.introVideoModel.includes('fast') ? 'Fast' : 'Full'}</span>
                              )}
                              <button type="button" className="se-link" onClick={() => setVideoPreviewUrl(toMediaUrl(formData.introVideoUrl) || null)}>
                                <Eye className="h-3.5 w-3.5" aria-hidden="true" />크게 보기
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="se-media-empty"><Video className="h-6 w-6" aria-hidden="true" /><span>아직 영상이 없습니다</span></div>
                        )}
                      </div>
                      <div className="se-media-controls">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={handleOpenVideoSelector} className="se-secondary-action">
                            <Folder className="h-4 w-4" aria-hidden="true" />{t('admin.scenarioManager.form.selectExistingVideo', '기존 비디오 선택')}
                          </Button>
                          {formData.introVideoUrl && (
                            <Button type="button" variant="ghost" size="sm" onClick={handleDeleteVideo} className="se-danger-ghost" data-testid="button-delete-video">
                              <Trash2 className="h-4 w-4" aria-hidden="true" />{t('common.delete')}
                            </Button>
                          )}
                        </div>
                        <Field label={t('admin.scenarioManager.form.videoPromptLabel', '영상 생성 설명')} htmlFor="videoPrompt" optional
                          action={<button type="button" className="se-link" onClick={handleLoadDefaultVideoPrompt} disabled={!formData.title}>
                            {t('admin.scenarioManager.form.loadDefaultPrompt', '기본 프롬프트 로드')}
                          </button>}>
                          <AutoResizeTextarea
                            id="videoPrompt"
                            value={formData.videoPrompt || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, videoPrompt: e.target.value }))}
                            placeholder={t('admin.scenarioManager.form.videoPromptPlaceholder')}
                            className="min-h-[80px] bg-white whitespace-pre-wrap"
                            data-testid="textarea-video-prompt"
                          />
                        </Field>
                        <AiGenerateButton
                          variant="primary"
                          block
                          testId="button-generate-video"
                          onClick={handleGenerateVideo}
                          loading={isGeneratingVideo}
                          loadingLabel={t('admin.scenarioManager.form.generatingVideo')}
                          label={editingScenario?.id ? t('admin.scenarioManager.form.generateVideo') : t('admin.scenarioManager.form.videoAfterSave')}
                          disabled={isGeneratingVideo || !editingScenario?.id || isAnyGenerating}
                          blockedReason={aiBlockedReason({ needsContext: !editingScenario?.id, contextMessage: '시나리오를 먼저 저장해야 영상을 생성할 수 있습니다', otherRunning: isAnyGenerating && !isGeneratingVideo })}
                        />
                        <Field label="영상 경로" htmlFor="introVideoUrl" hint="경로를 직접 입력할 수도 있습니다.">
                          <Input
                            id="introVideoUrl"
                            value={formData.introVideoUrl || ''}
                            onChange={(e) => {
                              setFormData(prev => ({ ...prev, introVideoUrl: e.target.value, introVideoModel: '' }));
                              if (e.target.value) setVideoLoadFailed(false);
                            }}
                            placeholder="/scenarios/videos/intro.webm"
                            data-testid="input-intro-video-url"
                            className="bg-white font-mono text-sm"
                          />
                        </Field>
                      </div>
                    </div>
                  )}

                  <AdvancedDisclosure summary="영상 생성 모델" description={formData.modelVideoOverride ? `이 시나리오는 ${VIDEO_MODELS.find(m => m.value === formData.modelVideoOverride)?.label ?? formData.modelVideoOverride} 모델을 사용합니다.` : '전역 기본 모델을 사용합니다.'}>
                    <Field label="비디오 모델" htmlFor="model-video-override" className="se-narrow" hint="설정하면 시스템 전역 비디오 모델보다 우선 적용됩니다.">
                      <Select
                        value={formData.modelVideoOverride || '__global__'}
                        onValueChange={(v) => setFormData(prev => ({ ...prev, modelVideoOverride: v === '__global__' ? '' : v }))}
                      >
                        <SelectTrigger id="model-video-override" className="bg-white">
                          <SelectValue placeholder="전역 기본값 사용" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__global__">전역 기본값 사용</SelectItem>
                          {VIDEO_MODELS.map(m => (
                            <SelectItem key={m.value} value={m.value}>
                              {m.label}{(m as any).recommended ? ' (권장)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </AdvancedDisclosure>
                </EditorGroup>
              </ScenarioEditorRegion>

              {/* ── 공개 설정 ── */}
              <ScenarioEditorRegion sections="publish" className="se-stack">
                <EditorGroup title="공개 범위" description="누가 이 시나리오를 볼 수 있는지 정합니다.">
                  <ToggleRow
                    id="isPublic"
                    label={t('admin.scenarioManager.form.isPublic', '공개 시나리오')}
                    description={formData.isPublic
                      ? t('admin.scenarioManager.form.isPublicOn', '일반 사용자에게 노출됩니다')
                      : t('admin.scenarioManager.form.isPublicOff', '관리자/운영자만 접근 가능합니다')}
                    checked={formData.isPublic || false}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isPublic: checked }))}
                  />
                  <ToggleRow
                    id="isDemo"
                    label={t('admin.scenarioManager.form.isDemo', 'Guest Demo Scenario')}
                    description={formData.isDemo ? '로그인하지 않은 방문자도 체험할 수 있습니다.' : '체험 모드에 표시되지 않습니다.'}
                    checked={formData.isDemo || false}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDemo: checked }))}
                  />
                </EditorGroup>

                <EditorGroup title="콘텐츠 스토어" description="다른 조직이 구매하거나 받을 수 있도록 스토어에 등록합니다.">
                  <ToggleRow
                    id="storeListed"
                    icon={<Star className="h-4 w-4 text-[color:var(--editor-amber)]" aria-hidden="true" />}
                    label="스토어에 등록"
                    description={formData.storeListed ? '콘텐츠 스토어에 표시됩니다.' : '스토어에 표시되지 않습니다.'}
                    checked={formData.storeListed || false}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, storeListed: checked }))}
                  />
                  {formData.storeListed && (
                    <FieldGrid>
                      <Field label="가격 (USD)" htmlFor="store-price" hint="0이면 무료입니다.">
                        <Input
                          id="store-price"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          className="bg-white"
                          value={formData.storePriceUsd ?? ''}
                          onChange={e => setFormData(prev => ({ ...prev, storePriceUsd: e.target.value ? parseFloat(e.target.value) : null }))}
                        />
                      </Field>
                      <Field label="팩 ID" htmlFor="store-pack-id" optional>
                        <Input
                          id="store-pack-id"
                          type="text"
                          placeholder="스토어 팩 ID"
                          className="bg-white font-mono text-sm"
                          value={formData.storePackId ?? ''}
                          onChange={e => setFormData(prev => ({ ...prev, storePackId: e.target.value || null }))}
                        />
                      </Field>
                    </FieldGrid>
                  )}
                </EditorGroup>

                <EditorGroup id="section-source-locale" title="언어"
                  description={!editingScenario ? t('admin.evaluationCriteria.autoTranslateDescription') : '원문을 기준으로 지원 언어의 번역을 다시 만듭니다.'}>
                  {!editingScenario ? (
                    <ToggleRow
                      id="autoTranslate"
                      icon={<Languages className="h-4 w-4" aria-hidden="true" />}
                      label={t('admin.evaluationCriteria.autoTranslate')}
                      checked={formData.autoTranslate || false}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, autoTranslate: checked }))}
                    />
                  ) : (
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => editingScenario?.id && autoTranslateMutation.mutate(editingScenario.id)}
                        disabled={autoTranslateMutation.isPending}
                        className="se-secondary-action"
                      >
                        {autoTranslateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Languages className="h-4 w-4" aria-hidden="true" />}
                        {autoTranslateMutation.isPending
                          ? t('admin.common.loading')
                          : t('admin.evaluationCriteria.triggerAutoTranslate')
                        }
                      </Button>
                    </div>
                  )}
                </EditorGroup>
              </ScenarioEditorRegion>
          </ScenarioEditor>
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEdit(scenario);
                                  setTimeout(() => {
                                    const el = document.getElementById('scenario-quality-panel');
                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }, 150);
                                }}
                                className={`text-sm font-bold whitespace-nowrap shrink-0 cursor-pointer border px-2 py-0.5 gap-1 ${
                                  validation.hasFatalErrors
                                    ? 'bg-red-100 text-red-700 border-red-400'
                                    : validation.score >= 80
                                    ? 'bg-green-50 text-green-700 border-green-300'
                                    : validation.score >= 60
                                    ? 'bg-yellow-50 text-yellow-700 border-yellow-300'
                                    : 'bg-red-50 text-red-700 border-red-300'
                                }`}
                              >
                                {validation.hasFatalErrors && <span className="mr-0.5">❌</span>}
                                {validation.score}/100
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
                              <p className="text-xs text-slate-400 pt-1">클릭하면 품질 패널로 이동합니다</p>
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
                      {(() => {
                        const videoMode = (scenario as any).introVideoMode || 'none';
                        const videoModeConfig = {
                          none:    { emoji: '🚫', label: '없음' },
                          default: { emoji: '🎬', label: '기본' },
                          custom:  { emoji: '🎥', label: '커스텀' },
                        }[videoMode as 'none' | 'default' | 'custom'] ?? { emoji: '🚫', label: '없음' };
                        return (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="text-xs bg-slate-50 text-slate-600 border-slate-200 cursor-default select-none">
                                  {videoModeConfig.emoji} {videoModeConfig.label}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">인트로 영상: {videoModeConfig.label}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })()}
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
                    {/* 번역 상태 뱃지 */}
                    {(() => {
                      const translationLocales: Array<{ locale: string; isMachineTranslated: boolean; isReviewed: boolean; isOriginal: boolean }> = (scenario as any)._translationLocales || [];
                      const sourceLocale: string = (scenario as any)._sourceLocale || defaultSourceLocale;
                      const targetLangs = activeLanguages.filter(l => l.code !== sourceLocale);
                      if (targetLangs.length === 0) return null;
                      return (
                        <div className="flex items-center gap-1 flex-wrap mt-1">
                          <Languages className="w-3 h-3 text-slate-400 shrink-0" />
                          {targetLangs.map(lang => {
                            const entry = translationLocales.find(t => t.locale === lang.code && !t.isOriginal);
                            let icon: string;
                            let colorClass: string;
                            let tooltip: string;
                            if (!entry) {
                              icon = '–';
                              colorClass = 'text-slate-400 bg-slate-50 border-slate-200';
                              tooltip = `${lang.name}: 번역 없음`;
                            } else if (entry.isMachineTranslated && !entry.isReviewed) {
                              icon = '⚠';
                              colorClass = 'text-amber-600 bg-amber-50 border-amber-200';
                              tooltip = `${lang.name}: AI 번역 (검토 대기)`;
                            } else {
                              icon = '✓';
                              colorClass = 'text-green-600 bg-green-50 border-green-200';
                              tooltip = `${lang.name}: 번역 완료${entry.isReviewed ? ' (검토됨)' : ''}`;
                            }
                            return (
                              <TooltipProvider key={lang.code}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`inline-flex items-center gap-0.5 text-xs font-mono border rounded px-1 py-0 leading-5 cursor-default select-none ${colorClass}`}>
                                      {lang.code.toUpperCase()} {icon}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom">{tooltip}</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          })}
                        </div>
                      );
                    })()}
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
                        <DropdownMenuItem
                          onClick={() => handleExportScenario(scenario)}
                          disabled={exportingScenarioId === scenario.id}
                          data-testid={`button-export-scenario-${scenario.id}`}
                        >
                          {exportingScenarioId === scenario.id
                            ? <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                            : <Download className="mr-2 w-4 h-4" />}
                          JSON 내보내기
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
                    <div className="space-y-2">
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
                          <div key={index}>
                            <Badge 
                              variant="outline" 
                              className="text-xs bg-purple-50 text-purple-700 border-purple-200"
                            >
                              {displayText}
                            </Badge>
                          </div>
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
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="translation-dialog">
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
              sourceLocale={translatingScenario.sourceLocale || defaultSourceLocale}
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
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-4xl max-h-[80vh] overflow-y-auto">
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-4xl max-h-[80vh] overflow-y-auto">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

      <Dialog open={aiPreviewOpen} onOpenChange={(open) => { if (!open) closeAiPreviewDialog(); }}>
        <DialogContent className={aiPreviewExisting ? 'w-full max-w-[calc(100vw-2rem)] sm:max-w-5xl max-h-[90vh] flex flex-col' : 'w-full max-w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[80vh] flex flex-col'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              {aiPreviewType === 'evaluationHarness' ? 'AI 생성 결과 — 평가 기준 (evaluationHarness)' : 'AI 생성 결과 — 플레이어 제약 (playerConstraints)'}
            </DialogTitle>
            <DialogDescription>
              {aiPreviewExisting
                ? '기존 내용과 AI 생성 내용을 비교하세요. AI 버전을 바로 편집한 후 적용할 수 있습니다.'
                : '아래 내용을 확인한 후 적용하거나 취소할 수 있습니다. 적용하면 현재 입력된 내용이 대체됩니다.'}
            </DialogDescription>
          </DialogHeader>

          {aiPreviewExisting ? (
            /* ── Diff view: existing vs AI generated ── */
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 overflow-hidden">
              {/* Left: current content (read-only) */}
              <div className="flex flex-col min-h-0 border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 border-b shrink-0">
                  <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-600">현재 내용</span>
                </div>
                <div className="flex-1 overflow-auto p-2">
                  {aiPreviewType === 'evaluationHarness' && (
                    <EvaluationHarnessBuilder
                      key={`existing-${JSON.stringify(aiPreviewExisting)}`}
                      defaultValue={aiPreviewExisting as EvaluationHarness}
                      onChange={() => {}}
                      readOnly
                    />
                  )}
                  {aiPreviewType === 'playerConstraints' && (
                    <PlayerConstraintsBuilder
                      value={aiPreviewExisting as PlayerConstraints}
                      onChange={() => {}}
                      readOnly
                    />
                  )}
                </div>
              </div>

              {/* Right: AI generated content (editable so users can merge manually) */}
              <div className="flex flex-col min-h-0 border rounded-lg border-purple-200 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 border-b shrink-0">
                  <Sparkles className="w-3 h-3 text-purple-500 shrink-0" />
                  <span className="text-xs font-semibold text-purple-700">AI 생성 — 편집 후 적용 가능</span>
                </div>
                <div className="flex-1 overflow-auto p-2">
                  {aiPreviewType === 'evaluationHarness' && (
                    <EvaluationHarnessBuilder
                      key={`ai-${JSON.stringify(aiPreviewData)}`}
                      defaultValue={(aiPreviewEdited ?? aiPreviewData) as EvaluationHarness}
                      onChange={(val) => setAiPreviewEdited(val)}
                    />
                  )}
                  {aiPreviewType === 'playerConstraints' && (
                    <PlayerConstraintsBuilder
                      value={(aiPreviewEdited ?? aiPreviewData) as PlayerConstraints}
                      onChange={(val) => setAiPreviewEdited(val)}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ── Single preview (no existing content) ── */
            <div className="flex-1 overflow-auto p-1 min-h-0">
              {aiPreviewData && aiPreviewType === 'evaluationHarness' && (
                <EvaluationHarnessBuilder
                  key={JSON.stringify(aiPreviewData)}
                  defaultValue={aiPreviewData as EvaluationHarness}
                  onChange={() => {}}
                  readOnly
                />
              )}
              {aiPreviewData && aiPreviewType === 'playerConstraints' && (
                <PlayerConstraintsBuilder
                  value={aiPreviewData as PlayerConstraints}
                  onChange={() => {}}
                  readOnly
                />
              )}
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 shrink-0">
            <Button type="button" variant="outline" onClick={closeAiPreviewDialog}>
              취소
            </Button>
            {aiPreviewExisting && (
              <Button type="button" variant="outline" onClick={closeAiPreviewDialog}>
                현재 유지
              </Button>
            )}
            <Button type="button" onClick={handleApplyAiPreview}>
              {aiPreviewExisting ? 'AI 버전 적용' : '적용'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
