import { useState, Fragment } from "react";
import { useDefaultSourceLocale } from "@/lib/localeUtils";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Star, Check, Copy, Settings, Target, Brain, Eye, AlertCircle, Languages, GitBranch, History, CheckCircle, XCircle, Archive, ClockIcon, Lock, ArrowLeftRight, UserCheck, LayoutTemplate, FlaskConical, BarChart2, Info, Bot, Download } from "lucide-react";
import { CriteriaSetEditor, DimensionEditor } from "./evaluationEditor/CriteriaEditors";
import { getIconComponent, type ScoringRubric } from "./evaluationEditor/shared";
import { CriteriaSetFewShotTab } from "./CriteriaSetFewShotTab";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface EvaluationDimension {
  id: string;
  criteriaSetId: string;
  key: string;
  name: string;
  description?: string | null;
  weight: number;
  dimensionType: 'core' | 'standard' | 'bonus';
  minScore: number;
  maxScore: number;
  icon?: string | null;
  color?: string | null;
  displayOrder: number;
  scoringRubric?: ScoringRubric[] | null;
  evaluationPrompt?: string | null;
  isActive: boolean;
}

interface EvaluationCriteriaSet {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  isActive: boolean;
  categoryId?: string | null;
  ownerOperatorId?: string | null;
  authoredByAgent?: { agentKeyId: string; agentKeyName: string; ownerUserId: string } | null;
  status?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  version?: number | null;
  parentSetId?: string | null;
  createdAt: string;
  updatedAt: string;
  dimensions?: EvaluationDimension[];
}

interface Category {
  id: string;
  name: string;
}

interface Operator {
  id: string;
  name: string;
  email: string;
}

const DEFAULT_DIMENSIONS = [
  {
    key: 'clarityLogic', name: '명확성 & 논리성', description: '의사 표현의 명확성과 논리적 구성', weight: 20,
    scoringRubric: [
      { score: 2, label: '매우 미흡', description: '발화가 거의 없거나 주제와 무관한 단어 나열. 논리 구조 전혀 없음.', behaviorAnchor: '발화가 거의 없거나 "어..." "글쎄요" 같은 단편 소리만 내거나 주제와 무관한 말을 늘어놓음. 문장 단위의 의미 전달 불가.' },
      { score: 4, label: '미흡', description: '의도는 파악되나 근거 없이 주장만 하거나 문장이 단편적. 두서없는 구성.', behaviorAnchor: '"그냥 이게 맞아요"처럼 근거 없이 주장만 반복하거나 주제가 자주 바뀜. 상대가 무엇을 원하는지 파악하기 어려움.' },
      { score: 6, label: '보통', description: '기본적인 주장과 근거가 있으나 구조가 약하거나 핵심이 불분명한 경우가 있음.', behaviorAnchor: '주장과 이유를 모두 말하지만 핵심이 중간에 묻히거나 결론이 불분명. "여러 가지 이유가 있는데..."로 시작하지만 마무리가 흐릿함.' },
      { score: 8, label: '우수', description: '대체로 명확하고 논리적 근거 제시. 간혹 애매한 표현이나 논리 비약이 있음.', behaviorAnchor: '핵심 메시지를 먼저 제시하고 2~3가지 근거를 순서대로 설명. 간혹 "그러니까" 수준의 연결어가 부족하거나 세부 근거가 빠짐.' },
      { score: 10, label: '탁월', description: '명확한 핵심 메시지, 탄탄한 논리 구조, 구체적 사례/데이터 인용, 일관성 탁월.', behaviorAnchor: '"결론은 A입니다. 이유는 첫째…둘째…이며, 실제로 B팀에서 이 방식으로 30% 효율 개선을 달성했습니다"처럼 두괄식 구조에 구체적 근거와 사례를 결합.' },
    ],
  },
  {
    key: 'listeningEmpathy', name: '경청 & 공감', description: '상대방의 말을 듣고 공감하는 능력', weight: 20,
    scoringRubric: [
      { score: 2, label: '매우 미흡', description: '상대방 발화를 완전히 무시하거나 엉뚱한 응답. 공감 표현 전무.', behaviorAnchor: '상대가 불만을 표출하는데 "어쨌든 제 제안이..."처럼 상대 발화를 완전히 무시하고 자기 이야기만 함. 공감 표현이 단 한 번도 없음.' },
      { score: 4, label: '미흡', description: '상대방 말에 최소한 반응하나 내용 반영 없이 자기 이야기만 함.', behaviorAnchor: '"네, 알겠습니다" 한 마디 후 바로 자기 주장으로 넘어감. 상대 발화 내용을 재진술하거나 구체적으로 반영하지 않음.' },
      { score: 6, label: '보통', description: '상대방 말을 일부 참조하나 요약·재진술 부족. 공감이 형식적("네", "알겠습니다" 수준).', behaviorAnchor: '"말씀하신 것처럼 비용 문제가 있군요"처럼 상대 말을 한 번 언급하지만 감정·니즈 탐색 없이 바로 해결책 제시로 이동.' },
      { score: 8, label: '우수', description: '상대방 발화를 파악하고 관련 반응. 재진술·공감 표현. 감정 인식 시도.', behaviorAnchor: '"말씀하시는 우려가 일정 압박 때문이군요. 그 부분이 많이 부담되셨겠어요"처럼 상대 감정을 인식하고 재진술한 뒤 입장을 반영해 답변.' },
      { score: 10, label: '탁월', description: '상대방 핵심 우려를 정확히 짚어 재진술하고, 감정 인식, 적극적 공감, 니즈 탐색.', behaviorAnchor: '"지금 말씀하시는 걸 들어보면, 일정 문제보다 팀원 부담이 더 큰 걱정이신 것 같아요. 제가 제대로 이해한 건가요?"처럼 핵심 니즈를 짚고 확인 질문.' },
    ],
  },
  {
    key: 'appropriatenessAdaptability', name: '적절성 & 상황대응', description: '상황에 맞는 적절한 대응', weight: 20,
    scoringRubric: [
      { score: 2, label: '매우 미흡', description: '상황과 전혀 어울리지 않는 발언, 갈등 악화, 역할 혼동.', behaviorAnchor: '상사에게 반말 사용, 협상 자리에서 감정적 폭발, 상황과 무관한 주제 돌발 제기 등 맥락을 완전히 이탈한 발언.' },
      { score: 4, label: '미흡', description: '상황 인식이 부족하거나 부적절한 표현이 반복됨. 상황 변화에 둔감.', behaviorAnchor: '상대가 분위기를 전환하는데도 같은 어조 반복, 상황 변화(상대 감정 악화)를 인지하지 못하고 동일 전략 고수.' },
      { score: 6, label: '보통', description: '대체로 상황에 맞는 발언이나 간혹 어색하거나 타이밍 미스. 대응 유연성 부족.', behaviorAnchor: '일반적으로 적절하지만 상대가 흥분할 때 타이밍 없이 숫자/데이터를 나열하거나 유머가 어색하게 삽입되는 순간 발생.' },
      { score: 8, label: '우수', description: '상황 변화에 잘 대응하고 적절한 표현 선택. 소소한 실수는 있음.', behaviorAnchor: '상대 감정 변화를 감지해 어조를 낮추거나 화제를 전환. 간혹 한 박자 늦게 대응하는 경우 있지만 전반적으로 상황 파악 우수.' },
      { score: 10, label: '탁월', description: '상황별 최적 표현과 어조 선택. 갈등 발생 시 유연하게 전환. 분위기 조율 능숙.', behaviorAnchor: '분위기가 경색될 때 "잠깐, 우리가 같은 목표를 갖고 있다는 걸 먼저 확인하죠"처럼 갈등을 즉시 재프레이밍하며 분위기를 조율.' },
    ],
  },
  {
    key: 'persuasivenessImpact', name: '설득력 & 영향력', description: '상대방을 설득하고 영향을 미치는 능력', weight: 20,
    scoringRubric: [
      { score: 2, label: '매우 미흡', description: '설득 시도 없거나 근거 없이 요구·강요만 하여 역효과 발생.', behaviorAnchor: '"무조건 제 방식대로 해야 해요"처럼 근거 없이 강압적 요구만 하거나 설득 시도 자체가 없어 상대 반감 유발.' },
      { score: 4, label: '미흡', description: '일부 주장이 있으나 논리적 근거나 구체적 사례 거의 없음. 상대방 이익 미반영.', behaviorAnchor: '"이게 더 좋은 방법입니다"라고 주장하지만 왜 좋은지 구체적 근거 없음. 상대가 어떤 이익을 얻는지 전혀 언급 안 함.' },
      { score: 6, label: '보통', description: '부분적 논거 제시. 상대 입장 일부 반영하나 설득력 약함. 합의 도출 미흡.', behaviorAnchor: '한두 가지 근거는 제시하나 상대의 구체적 반론에 재반박하지 못하거나 "한번 생각해 보세요" 수준으로 마무리.' },
      { score: 8, label: '우수', description: '논리적 근거와 상대 이익 제시. 설득 흐름 구축. 타협 여지 제시.', behaviorAnchor: '"이 방안을 선택하시면 팀 일정 2주 단축과 비용 15% 절감이 가능합니다. 혹시 우려되는 부분이 있다면 조정 여지가 있습니다"처럼 이익 제시 + 타협 가능성 표현.' },
      { score: 10, label: '탁월', description: '체계적 논거, 상대 이익 부각, 감정적 공감과 논리 결합, 구체적 행동 변화 유도.', behaviorAnchor: '공감으로 시작해 상대 핵심 이익을 명확히 짚고, 데이터·사례로 뒷받침하며, 구체적 다음 단계("그럼 이번 주 안에 파일럿 일정을 잡아볼까요?")까지 이끌어냄.' },
    ],
  },
  {
    key: 'strategicCommunication', name: '전략적 커뮤니케이션', description: '목표 달성을 위한 전략적 소통', weight: 20,
    scoringRubric: [
      { score: 2, label: '매우 미흡', description: '목표 없이 반응형 대화. 주도권 전혀 없음. 대화 방향 조율 불가.', behaviorAnchor: '상대의 흐름에만 끌려다니며 어젠다 없이 응답만 반복. 대화를 어떤 방향으로도 이끌려는 시도 전혀 없음.' },
      { score: 4, label: '미흡', description: '목표 의식이 희미하거나 산만하게 대화. 전략적 흐름 없음.', behaviorAnchor: '대화 중 주제가 자주 흔들리거나 목표와 무관한 내용에 시간 소비. 핵심 합의에 이르지 못하고 대화가 표류.' },
      { score: 6, label: '보통', description: '어느 정도 목표 지향적이나 전략 일관성 부족. 기회 포착 미흡.', behaviorAnchor: '어느 정도 방향성은 있으나 상대가 양보 신호를 보낼 때 이를 포착하지 못하고 기회를 놓치거나 전략 전환이 늦음.' },
      { score: 8, label: '우수', description: '대화 흐름 주도, 목표 지향적 발언, 타협·조율 시도.', behaviorAnchor: '대화 시작 시 의도를 명확히 하고 흐름을 주도. 교착 상태에서 "다른 접근법을 시도해 보죠"처럼 전략적 전환 실행.' },
      { score: 10, label: '탁월', description: '전략적 순서로 대화 구성. 상대 반응에 따른 전술 조정. 합의 도출 주도.', behaviorAnchor: '처음부터 끝까지 단계적 전략(공감→공통목표 확인→이익 제시→합의 확인)을 유지하며 상대 반응에 따라 전술을 실시간 조정하고 명확한 합의로 마무리.' },
    ],
  },
];

export function EvaluationCriteriaManager() {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOperator = user?.role === 'operator';
  const { toast } = useToast();
  const defaultSourceLocale = useDefaultSourceLocale();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDimensionDialogOpen, setIsDimensionDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [setToDelete, setSetToDelete] = useState<EvaluationCriteriaSet | null>(null);
  const [setToTransfer, setSetToTransfer] = useState<EvaluationCriteriaSet | null>(null);
  const [transferTargetOperatorId, setTransferTargetOperatorId] = useState<string>('');
  const [selectedSet, setSelectedSet] = useState<EvaluationCriteriaSet | null>(null);
  const [selectedDimension, setSelectedDimension] = useState<EvaluationDimension | null>(null);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isDefault: false,
    isActive: true,
    categoryId: '',
    useDefaultDimensions: true,
    autoTranslate: true,
  });

  const [dimensionFormData, setDimensionFormData] = useState({
    key: '',
    name: '',
    description: '',
    weight: 20,
    dimensionType: 'standard' as 'core' | 'standard' | 'bonus',
    minScore: 1,
    maxScore: 10,
    icon: '',
    color: '#6366f1',
    isActive: true,
    scoringRubric: [] as ScoringRubric[],
    evaluationPrompt: '',
  });

  const [rubricOverview, setRubricOverview] = useState({ positiveOverview: '', negativeOverview: '' });

  const PRESET_COLORS = [
    '#6366f1', // Indigo
    '#3b82f6', // Blue
    '#0ea5e9', // Sky
    '#06b6d4', // Cyan
    '#10b981', // Emerald
    '#22c55e', // Green
    '#84cc16', // Lime
    '#eab308', // Yellow
    '#f59e0b', // Amber
    '#f97316', // Orange
    '#ef4444', // Red
    '#ec4899', // Pink
    '#d946ef', // Fuchsia
    '#a855f7', // Purple
    '#8b5cf6', // Violet
    '#64748b', // Slate
  ];

  const { data: criteriaSets = [], isLoading } = useQuery<EvaluationCriteriaSet[]>({
    queryKey: ['/api/admin/evaluation-criteria', currentLang],
    queryFn: async () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/evaluation-criteria?lang=${currentLang}`, { credentials: 'include', headers });
      return res.json();
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const { data: operators = [] } = useQuery<Operator[]>({
    queryKey: ['/api/admin/operators'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/operators');
      return res.json();
    },
    enabled: isAdmin,
  });

  const transferOwnerMutation = useMutation({
    mutationFn: async ({ id, ownerOperatorId }: { id: string; ownerOperatorId: string | null }) => {
      return apiRequest('PATCH', `/api/admin/evaluation-criteria/${id}/transfer-owner`, { ownerOperatorId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "소유자가 변경되었습니다" });
      setIsTransferDialogOpen(false);
      setSetToTransfer(null);
      setTransferTargetOperatorId('');
    },
    onError: (error: any) => {
      toast({ title: "이관 실패", description: error.message, variant: "destructive" });
    },
  });

  const { data: rubricTemplates = [] } = useQuery<any[]>({
    queryKey: ['/api/admin/evaluation-criteria/templates'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/evaluation-criteria/templates');
      return res.json();
    },
  });

  const fromTemplateMutation = useMutation({
    mutationFn: async (data: { templateId: string; name?: string; description?: string; categoryId?: string }) => {
      const res = await apiRequest('POST', '/api/admin/evaluation-criteria/from-template', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: '템플릿에서 루브릭이 생성되었습니다', description: '초안 상태로 생성되었습니다. 필요에 따라 차원을 수정하세요.' });
      setIsTemplateDialogOpen(false);
      setSelectedTemplateId(null);
    },
    onError: (error: any) => {
      toast({ title: '생성 실패', description: error.message, variant: 'destructive' });
    },
  });

  const autoTranslateMutation = useMutation({
    mutationFn: async (criteriaSetId: string) => {
      const response = await apiRequest('POST', `/api/admin/evaluation-criteria/${criteriaSetId}/auto-translate`, { sourceLocale: defaultSourceLocale });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      const failed: { locale: string; reason: string }[] = data.failedLocales || [];
      if (failed.length > 0) {
        const failedList = failed.map((f) => `${f.locale}: ${f.reason}`).join('\n');
        toast({
          title: t('admin.evaluationCriteria.translationPartialFailure'),
          description: `${data.message}\n${t('admin.evaluationCriteria.translationFailedLocales')}: ${failedList}`,
          variant: "destructive",
        });
      } else {
        toast({ title: t('admin.evaluationCriteria.translationSuccess'), description: data.message });
      }
    },
    onError: (error: any) => {
      toast({ title: t('admin.evaluationCriteria.translationFailed'), description: error.message, variant: "destructive" });
    },
  });

  const [batchTranslateProgress, setBatchTranslateProgress] = useState<{ current: number; total: number } | null>(null);
  
  const batchTranslateMutation = useMutation({
    mutationFn: async (criteriaSetIds: string[]) => {
      setBatchTranslateProgress({ current: 0, total: criteriaSetIds.length });
      const results = [];
      for (let i = 0; i < criteriaSetIds.length; i++) {
        const id = criteriaSetIds[i];
        try {
          const result = await apiRequest('POST', `/api/admin/evaluation-criteria/${id}/auto-translate`, { sourceLocale: defaultSourceLocale });
          results.push({ id, success: true, result });
        } catch (error) {
          results.push({ id, success: false, error });
        }
        setBatchTranslateProgress({ current: i + 1, total: criteriaSetIds.length });
      }
      return results;
    },
    onSuccess: (results: any[]) => {
      const successCount = results.filter(r => r.success).length;
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ 
        title: t('admin.evaluationCriteria.batchTranslateComplete'), 
        description: `${successCount}/${results.length} ${t('admin.evaluationCriteria.setsTranslated')}`
      });
      setBatchTranslateProgress(null);
    },
    onError: (error: any) => {
      toast({ title: t('admin.evaluationCriteria.translationFailed'), description: error.message, variant: "destructive" });
      setBatchTranslateProgress(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', '/api/admin/evaluation-criteria', data);
      return response;
    },
    onSuccess: async (response: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 기준 세트가 생성되었습니다" });
      
      if (formData.autoTranslate && response?.id) {
        autoTranslateMutation.mutate(response.id);
      }
      
      setIsCreateDialogOpen(false);
      resetFormData();
    },
    onError: (error: any) => {
      toast({ title: "생성 실패", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest('PUT', `/api/admin/evaluation-criteria/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 기준 세트가 수정되었습니다" });
      setIsEditDialogOpen(false);
      setSelectedSet(null);
    },
    onError: (error: any) => {
      toast({ title: "수정 실패", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/admin/evaluation-criteria/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 기준 세트가 삭제되었습니다" });
    },
    onError: (error: any) => {
      toast({ title: "삭제 실패", description: error.message, variant: "destructive" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('POST', `/api/admin/evaluation-criteria/${id}/set-default`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "기본 평가 기준으로 설정되었습니다" });
    },
    onError: (error: any) => {
      toast({ title: "설정 실패", description: error.message, variant: "destructive" });
    },
  });

  const generateRubricAnchorsMutation = useMutation({
    mutationFn: async (payload: {
      dimensionName: string;
      dimensionDescription: string;
      minScore: number;
      maxScore: number;
      positiveOverview: string;
      negativeOverview: string;
      rubricScores: number[];
    }) => {
      const res = await apiRequest('POST', '/api/evaluation-criteria/generate-rubric-anchors', payload);
      return res.json() as Promise<Array<{ score: number; behaviorAnchor: string; positiveIndicators: string[]; negativeIndicators: string[] }>>;
    },
    onSuccess: (anchors) => {
      setDimensionFormData(prev => ({
        ...prev,
        scoringRubric: prev.scoringRubric.map(item => {
          const match = anchors.find(a => a.score === item.score);
          if (!match) return item;
          return {
            ...item,
            behaviorAnchor: match.behaviorAnchor || item.behaviorAnchor,
            positiveIndicators: match.positiveIndicators?.length ? match.positiveIndicators : item.positiveIndicators,
            negativeIndicators: match.negativeIndicators?.length ? match.negativeIndicators : item.negativeIndicators,
          };
        }),
      }));
      toast({ title: "루브릭 행동 기준이 생성되었습니다", description: "생성된 내용을 검토하고 필요에 따라 수정하세요." });
    },
    onError: (error: any) => {
      toast({ title: "AI 생성 실패", description: error.message, variant: "destructive" });
    },
  });

  const createDimensionMutation = useMutation({
    mutationFn: async ({ criteriaSetId, data }: { criteriaSetId: string; data: any }) => {
      const res = await apiRequest('POST', `/api/admin/evaluation-criteria/${criteriaSetId}/dimensions`, data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      if (data?.autoForked) {
        toast({ title: "승인된 루브릭이 자동으로 새 초안 버전으로 분기되었습니다. 목록에서 새 버전을 선택해 계속 편집하세요." });
      } else {
        toast({ title: "평가 차원이 추가되었습니다" });
      }
      setIsDimensionDialogOpen(false);
      resetDimensionFormData();
    },
    onError: (error: any) => {
      toast({ title: "추가 실패", description: error.message, variant: "destructive" });
    },
  });

  const updateDimensionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest('PUT', `/api/admin/evaluation-dimensions/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 차원이 수정되었습니다" });
      setIsDimensionDialogOpen(false);
      setSelectedDimension(null);
    },
    onError: (error: any) => {
      const msg = String(error.message || '').replace(/^\d+:\s*/, '');
      toast({ title: "수정 실패", description: msg, variant: "destructive" });
    },
  });

  const deleteDimensionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/admin/evaluation-dimensions/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 차원이 삭제되었습니다" });
    },
    onError: (error: any) => {
      const msg = String(error.message || '').replace(/^\d+:\s*/, '');
      toast({ title: "삭제 실패", description: msg, variant: "destructive" });
    },
  });

  const resetFormData = () => {
    setFormData({
      name: '',
      description: '',
      isDefault: false,
      isActive: true,
      categoryId: '',
      useDefaultDimensions: true,
      autoTranslate: true,
    });
  };

  const resetDimensionFormData = () => {
    setDimensionFormData({
      key: '',
      name: '',
      description: '',
      weight: 20,
      dimensionType: 'standard',
      minScore: 1,
      maxScore: 10,
      icon: '',
      color: '',
      isActive: true,
      scoringRubric: [
        { score: 2, label: '매우 미흡', description: '', behaviorAnchor: '' },
        { score: 4, label: '미흡', description: '', behaviorAnchor: '' },
        { score: 6, label: '보통', description: '', behaviorAnchor: '' },
        { score: 8, label: '우수', description: '', behaviorAnchor: '' },
        { score: 10, label: '탁월', description: '', behaviorAnchor: '' },
      ],
      evaluationPrompt: '',
    });
  };

  const handleCreate = () => {
    if (!formData.name.trim()) return;
    const dimensions = formData.useDefaultDimensions
      ? DEFAULT_DIMENSIONS.map((dim, idx) => ({
          ...dim,
          weight: dim.weight,
          dimensionType: 'standard',
          minScore: 1,
          maxScore: 10,
          displayOrder: idx,
          isActive: true,
        }))
      : [];

    createMutation.mutate({
      name: formData.name,
      description: formData.description || null,
      isDefault: formData.isDefault,
      isActive: formData.isActive,
      categoryId: formData.categoryId || null,
      dimensions,
    });
  };

  const handleUpdate = () => {
    if (!selectedSet || !formData.name.trim()) return;
    updateMutation.mutate({
      id: selectedSet.id,
      data: {
        name: formData.name,
        description: formData.description || null,
        isDefault: formData.isDefault,
        isActive: formData.isActive,
        categoryId: formData.categoryId || null,
      },
    });
  };

  const handleEditSet = (set: EvaluationCriteriaSet) => {
    setSelectedSet(set);
    setFormData({
      name: set.name,
      description: set.description || '',
      isDefault: set.isDefault,
      isActive: set.isActive,
      categoryId: set.categoryId || '',
      useDefaultDimensions: false,
      autoTranslate: false,
    });
    setIsEditDialogOpen(true);
  };

  const handleAddDimension = (set: EvaluationCriteriaSet) => {
    setSelectedSet(set);
    setSelectedDimension(null);
    resetDimensionFormData();
    setRubricOverview({ positiveOverview: '', negativeOverview: '' });
    setIsDimensionDialogOpen(true);
  };

  const handleEditDimension = (set: EvaluationCriteriaSet, dimension: EvaluationDimension) => {
    setSelectedSet(set);
    setSelectedDimension(dimension);
    setRubricOverview({ positiveOverview: '', negativeOverview: '' });
    setDimensionFormData({
      key: dimension.key,
      name: dimension.name,
      description: dimension.description || '',
      weight: dimension.weight,
      dimensionType: dimension.dimensionType || 'standard',
      minScore: dimension.minScore,
      maxScore: dimension.maxScore,
      icon: dimension.icon || '',
      color: dimension.color || '',
      isActive: dimension.isActive,
      scoringRubric: dimension.scoringRubric || [],
      evaluationPrompt: dimension.evaluationPrompt || '',
    });
    setIsDimensionDialogOpen(true);
  };

  const handleSaveDimension = () => {
    if (!selectedSet || !dimensionFormData.key || !dimensionFormData.name) return;
    if (dimensionFormData.scoringRubric.length >= 5 && dimensionFormData.scoringRubric.some(r => !r.behaviorAnchor?.trim())) return;

    const data = {
      key: dimensionFormData.key,
      name: dimensionFormData.name,
      description: dimensionFormData.description || null,
      weight: dimensionFormData.weight,
      dimensionType: dimensionFormData.dimensionType,
      minScore: dimensionFormData.minScore,
      maxScore: dimensionFormData.maxScore,
      icon: dimensionFormData.icon || 'Star',
      color: dimensionFormData.color || '#6366f1',
      isActive: dimensionFormData.isActive,
      scoringRubric: dimensionFormData.scoringRubric.length > 0 ? dimensionFormData.scoringRubric : null,
      evaluationPrompt: dimensionFormData.evaluationPrompt || null,
    };

    if (selectedDimension) {
      updateDimensionMutation.mutate({ id: selectedDimension.id, data });
    } else {
      createDimensionMutation.mutate({ criteriaSetId: selectedSet.id, data });
    }
  };

  const fetchSetWithDimensions = async (id: string): Promise<EvaluationCriteriaSet> => {
    const token = localStorage.getItem("authToken");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/admin/evaluation-criteria/${id}?lang=${currentLang}`, { credentials: 'include', headers });
    return res.json();
  };

  const getCategoryName = (categoryId: string | null | undefined) => {
    if (!categoryId) return null;
    const category = categories.find(c => c.id === categoryId);
    return category?.name;
  };

  const getOperatorName = (operatorId: string | null | undefined) => {
    if (!operatorId) return null;
    const op = operators.find(o => o.id === operatorId);
    return op?.name || operatorId;
  };

  const handleOpenTransferDialog = (set: EvaluationCriteriaSet) => {
    setSetToTransfer(set);
    setTransferTargetOperatorId(set.ownerOperatorId || '');
    setIsTransferDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">{t('admin.evaluationCriteria.title')}</h2>
          <p className="text-slate-600">사용자 대화 피드백에 사용될 평가 기준을 설정합니다.</p>
        </div>
        <div className="flex gap-2">
          {criteriaSets.length > 0 && (
            <Button 
              variant="outline"
              onClick={() => batchTranslateMutation.mutate(criteriaSets.map(s => s.id))}
              disabled={batchTranslateMutation.isPending}
            >
              <Languages className="h-4 w-4 mr-2" />
              {batchTranslateMutation.isPending 
                ? (batchTranslateProgress 
                    ? `${batchTranslateProgress.current}/${batchTranslateProgress.total}...`
                    : t('admin.common.loading'))
                : t('admin.evaluationCriteria.translateAll')}
            </Button>
          )}
          {(isAdmin || isOperator) && (
            <>
              <Button variant="outline" onClick={() => { setSelectedTemplateId(null); setIsTemplateDialogOpen(true); }}>
                <LayoutTemplate className="h-4 w-4 mr-2" />
                템플릿으로 시작
              </Button>
              <Button onClick={() => { resetFormData(); setIsCreateDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                {t('admin.evaluationCriteria.newCriteriaSet')}
              </Button>
            </>
          )}
        </div>
      </div>

      {criteriaSets.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Settings className="h-12 w-12 mx-auto text-slate-400 mb-4" />
            <h3 className="text-lg font-semibold mb-2">평가 기준이 없습니다</h3>
            <p className="text-slate-600 mb-4">
              새 평가 기준 세트를 생성하여 사용자 피드백 평가 항목을 커스터마이즈하세요.
            </p>
            {(isAdmin || isOperator) && (
              <Button onClick={() => { resetFormData(); setIsCreateDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                {t('admin.evaluationCriteria.createFirstSet')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-4">
          {criteriaSets.map((set) => (
            <AccordionItem key={set.id} value={set.id} className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex items-center gap-3 w-full">
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{set.name}</span>
                      {set.version && set.version > 1 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono">v{set.version}</Badge>
                      )}
                      {(() => {
                        const s = set.status;
                        if (!s || s === 'approved') return <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5 py-0 h-4"><CheckCircle className="h-2.5 w-2.5 mr-0.5" />승인됨</Badge>;
                        if (s === 'review') return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-[10px] px-1.5 py-0 h-4"><ClockIcon className="h-2.5 w-2.5 mr-0.5" />검토중</Badge>;
                        if (s === 'archived') return <Badge className="bg-slate-100 text-slate-500 border-slate-200 text-[10px] px-1.5 py-0 h-4"><Archive className="h-2.5 w-2.5 mr-0.5" />보관됨</Badge>;
                        return <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">초안</Badge>;
                      })()}
                      {set.authoredByAgent && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-300 text-amber-700 bg-amber-50" title={set.authoredByAgent.agentKeyName}>에이전트 작성</Badge>
                      )}
                      {set.isDefault && (
                        <Badge variant="default" className="bg-blue-600 text-[10px] px-1.5 py-0 h-4">
                          <Star className="h-2.5 w-2.5 mr-0.5" />
                          기본
                        </Badge>
                      )}
                      {!set.isActive && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">비활성</Badge>
                      )}
                      {set.categoryId && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{getCategoryName(set.categoryId)}</Badge>
                      )}
                      {isAdmin && set.ownerOperatorId && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-violet-300 text-violet-700 bg-violet-50">
                          <UserCheck className="h-2.5 w-2.5 mr-0.5" />{getOperatorName(set.ownerOperatorId)}
                        </Badge>
                      )}
                    </div>
                    {set.description && (
                      <p className="text-sm text-slate-500 mt-1">{set.description}</p>
                    )}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <CriteriaSetDetail
                  setId={set.id}
                  fetchSetWithDimensions={fetchSetWithDimensions}
                  onEdit={() => handleEditSet(set)}
                  onDelete={() => { setSetToDelete(set); setIsDeleteConfirmOpen(true); }}
                  onSetDefault={() => setDefaultMutation.mutate(set.id)}
                  onAddDimension={() => handleAddDimension(set)}
                  onEditDimension={(dimension) => handleEditDimension(set, dimension)}
                  onTransferOwner={isAdmin ? () => handleOpenTransferDialog(set) : undefined}
                  isDefault={set.isDefault}
                  isAdmin={isAdmin}
                  isOperator={isOperator}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <Dialog open={isCreateDialogOpen || isEditDialogOpen} onOpenChange={(open) => { if (!open) { setIsCreateDialogOpen(false); setIsEditDialogOpen(false); } }}>
        {(isCreateDialogOpen || isEditDialogOpen) && (
          <CriteriaSetEditor
            key={isEditDialogOpen ? `edit-${selectedSet?.id}` : 'create'}
            isNew={!isEditDialogOpen}
            formData={formData}
            onChange={setFormData}
            categories={categories}
            pending={isEditDialogOpen ? updateMutation.isPending : createMutation.isPending}
            onClose={() => { setIsCreateDialogOpen(false); setIsEditDialogOpen(false); }}
            onSave={isEditDialogOpen ? handleUpdate : handleCreate}
            onTranslate={() => selectedSet?.id && autoTranslateMutation.mutate(selectedSet.id)}
            translatePending={autoTranslateMutation.isPending}
            canTranslate={!!selectedSet?.id}
          />
        )}
      </Dialog>

      {/* ── 템플릿 선택 다이얼로그 ── */}
      <Dialog open={isTemplateDialogOpen} onOpenChange={(open) => { setIsTemplateDialogOpen(open); if (!open) setSelectedTemplateId(null); }}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><LayoutTemplate className="h-5 w-5" />시나리오 유형별 루브릭 템플릿</DialogTitle>
            <DialogDescription>
              시나리오 유형에 맞는 템플릿을 선택하면 전문 루브릭 차원이 자동으로 포함된 초안이 생성됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto py-2">
            {rubricTemplates.map((tpl: any) => (
              <button
                key={tpl.id}
                onClick={() => setSelectedTemplateId(tpl.id === selectedTemplateId ? null : tpl.id)}
                className={`text-left rounded-lg border-2 p-4 transition-colors hover:bg-slate-50 ${selectedTemplateId === tpl.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{tpl.name}</p>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{tpl.description}</p>
                  </div>
                  {selectedTemplateId === tpl.id && <CheckCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />}
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(tpl.dimensions || []).map((d: any) => (
                    <span key={d.key} className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{d.name} {d.weight}%</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTemplateDialogOpen(false)}>취소</Button>
            <Button
              disabled={!selectedTemplateId || fromTemplateMutation.isPending}
              onClick={() => {
                if (selectedTemplateId) {
                  const tpl = rubricTemplates.find((t: any) => t.id === selectedTemplateId);
                  fromTemplateMutation.mutate({ templateId: selectedTemplateId, name: tpl ? `${tpl.name} (복사본)` : undefined });
                }
              }}
            >
              {fromTemplateMutation.isPending ? '생성 중...' : '이 템플릿으로 시작'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDimensionDialogOpen} onOpenChange={setIsDimensionDialogOpen}>
        {isDimensionDialogOpen && (
          <DimensionEditor
            key={selectedDimension?.id ?? `new-${selectedSet?.id}`}
            isNew={!selectedDimension}
            dimensionId={selectedDimension?.id}
            formData={dimensionFormData}
            onChange={setDimensionFormData}
            rubricOverview={rubricOverview}
            onRubricOverviewChange={setRubricOverview}
            presetColors={PRESET_COLORS}
            pending={createDimensionMutation.isPending || updateDimensionMutation.isPending}
            generating={generateRubricAnchorsMutation.isPending}
            onGenerate={() => generateRubricAnchorsMutation.mutate({
              dimensionName: dimensionFormData.name || '평가 차원',
              dimensionDescription: dimensionFormData.description,
              minScore: dimensionFormData.minScore,
              maxScore: dimensionFormData.maxScore,
              positiveOverview: rubricOverview.positiveOverview,
              negativeOverview: rubricOverview.negativeOverview,
              rubricScores: dimensionFormData.scoringRubric.map(r => r.score),
            })}
            onClose={() => setIsDimensionDialogOpen(false)}
            onSave={handleSaveDimension}
          />
        )}
      </Dialog>

      {/* 소유자 이관 다이얼로그 */}
      <Dialog open={isTransferDialogOpen} onOpenChange={(open) => { setIsTransferDialogOpen(open); if (!open) { setSetToTransfer(null); setTransferTargetOperatorId(''); } }}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5 text-violet-600" />
              루브릭 소유자 이관
            </DialogTitle>
            <DialogDescription>
              이 루브릭의 담당 운영자를 변경합니다. 소유자가 바뀌어도 루브릭의 접근 범위(카테고리/조직)는 유지됩니다.
            </DialogDescription>
          </DialogHeader>
          {setToTransfer && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">루브릭</p>
                <p className="font-medium text-slate-800">{setToTransfer.name}</p>
              </div>
              <div>
                <Label htmlFor="transfer-operator">새 소유자 운영자</Label>
                <Select
                  value={transferTargetOperatorId || 'none'}
                  onValueChange={(val) => setTransferTargetOperatorId(val === 'none' ? '' : val)}
                >
                  <SelectTrigger id="transfer-operator" className="mt-1">
                    <SelectValue placeholder="운영자 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">소유자 없음 (해제)</SelectItem>
                    {operators.map((op) => (
                      <SelectItem key={op.id} value={op.id}>
                        <div className="flex flex-col">
                          <span>{op.name}</span>
                          <span className="text-xs text-slate-400">{op.email}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 mt-1">
                  현재 소유자: {setToTransfer.ownerOperatorId ? (getOperatorName(setToTransfer.ownerOperatorId) || '알 수 없음') : '없음'}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsTransferDialogOpen(false); setSetToTransfer(null); setTransferTargetOperatorId(''); }}>
              취소
            </Button>
            <Button
              onClick={() => {
                if (setToTransfer) {
                  transferOwnerMutation.mutate({
                    id: setToTransfer.id,
                    ownerOperatorId: transferTargetOperatorId || null,
                  });
                }
              }}
              disabled={transferOwnerMutation.isPending}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {transferOwnerMutation.isPending ? '처리 중...' : '이관 확정'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              평가 기준 세트 삭제
            </DialogTitle>
            <DialogDescription>
              이 작업은 되돌릴 수 없습니다. 정말로 삭제하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          {setToDelete && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 my-4">
              <p className="font-medium text-slate-800">{setToDelete.name}</p>
              {setToDelete.description && (
                <p className="text-sm text-slate-600 mt-1">{setToDelete.description}</p>
              )}
              {setToDelete.isDefault && (
                <Badge className="mt-2 bg-amber-100 text-amber-700">기본 평가 기준</Badge>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setIsDeleteConfirmOpen(false); setSetToDelete(null); }}>
              {t('common.cancel')}
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => {
                if (setToDelete) {
                  deleteMutation.mutate(setToDelete.id);
                  setIsDeleteConfirmOpen(false);
                  setSetToDelete(null);
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t('admin.common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CriteriaSetDetail({
  setId,
  fetchSetWithDimensions,
  onEdit,
  onDelete,
  onSetDefault,
  onAddDimension,
  onEditDimension,
  onTransferOwner,
  isDefault,
  isAdmin,
  isOperator,
}: {
  setId: string;
  fetchSetWithDimensions: (id: string) => Promise<EvaluationCriteriaSet>;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onAddDimension: () => void;
  /** Opens the shared full-screen DimensionEditor owned by the manager. */
  onEditDimension: (dimension: EvaluationDimension) => void;
  onTransferOwner?: () => void;
  isDefault: boolean;
  isAdmin?: boolean;
  isOperator?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language;
  const { toast } = useToast();
  const [deleteConfirmDimId, setDeleteConfirmDimId] = useState<string | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dimensions' | 'quality' | 'dryrun' | 'translation' | 'scoring-examples'>('dimensions');
  const [reviewRequestWeightError, setReviewRequestWeightError] = useState<string | null>(null);
  const [dryRunInputMode, setDryRunInputMode] = useState<'freetext' | 'json'>('freetext');
  const [dryRunFreeText, setDryRunFreeText] = useState(
`사용자: 안녕하세요. 이번 프로젝트 진행 상황을 보고드리려고 합니다.
AI: 네, 말씀해 보세요.
사용자: 결론부터 말씀드리면 일정이 2주 지연되었습니다. 주요 원인은 외부 API 연동 이슈였고, 현재 해결 완료하여 정상 진행 중입니다.
AI: 지연된 이유가 더 있나요?
사용자: 네, API 이슈 외에도 인원 1명이 병가를 내어 일정에 영향을 주었습니다. 2주 뒤 원래 일정 대비 80% 완료를 목표로 하고 있습니다.`);
  const [dryRunMessages, setDryRunMessages] = useState(`[
  { "role": "user", "content": "안녕하세요. 이번 프로젝트 진행 상황을 보고드리려고 합니다." },
  { "role": "assistant", "content": "네, 말씀해 보세요." },
  { "role": "user", "content": "결론부터 말씀드리면 일정이 2주 지연되었습니다. 주요 원인은 외부 API 연동 이슈였고, 현재 해결 완료하여 정상 진행 중입니다." },
  { "role": "assistant", "content": "지연된 이유가 더 있나요?" },
  { "role": "user", "content": "네, API 이슈 외에도 인원 1명이 병가를 내어 일정에 영향을 주었습니다. 2주 뒤 원래 일정 대비 80% 완료를 목표로 하고 있습니다." }
]`);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [dryRunPreviewJson, setDryRunPreviewJson] = useState<string | null>(null);
  const [dryRunPreviewError, setDryRunPreviewError] = useState<string | null>(null);
  const [showQualityBreakdown, setShowQualityBreakdown] = useState(false);

  const { data: setWithDimensions, isLoading } = useQuery({
    queryKey: ['/api/admin/evaluation-criteria', setId, currentLang],
    queryFn: () => fetchSetWithDimensions(setId),
  });

  const { data: qualityScore, refetch: refetchQuality } = useQuery<any>({
    queryKey: ['/api/admin/evaluation-criteria', setId, 'quality-score'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/evaluation-criteria/${setId}/quality-score`);
      return res.json();
    },
    staleTime: 30000,
  });

  const { data: allLanguages = [] } = useQuery<any[]>({
    queryKey: ['/api/languages'],
  });

  const { data: criteriaTranslations = [] } = useQuery<any[]>({
    queryKey: ['/api/admin/evaluation-criteria', setId, 'translations'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/evaluation-criteria/${setId}/translations`);
      return res.json();
    },
    enabled: activeTab === 'translation',
  });

  function parseFreeTextToMessages(text: string): Array<{ role: string; content: string }> {
    const lines = text.split('\n');
    const messages: Array<{ role: string; content: string }> = [];
    let currentRole: string | null = null;
    let currentLines: string[] = [];

    const flush = () => {
      if (currentRole && currentLines.length > 0) {
        const content = currentLines.join('\n').trim();
        if (content) messages.push({ role: currentRole, content });
      }
      currentLines = [];
    };

    const skippedLines: string[] = [];
    for (const line of lines) {
      const userMatch = line.match(/^사용자:\s*(.*)/);
      const aiMatch = line.match(/^AI:\s*(.*)/i);
      if (userMatch) {
        flush();
        currentRole = 'user';
        currentLines = [userMatch[1]];
      } else if (aiMatch) {
        flush();
        currentRole = 'assistant';
        currentLines = [aiMatch[1]];
      } else if (currentRole) {
        currentLines.push(line);
      } else if (line.trim()) {
        skippedLines.push(line.trim());
      }
    }
    flush();

    if (skippedLines.length > 0) {
      console.warn('[드라이런] 인식되지 않은 라인 무시됨:', skippedLines);
    }

    if (messages.length === 0) {
      throw new Error('대화를 파싱할 수 없습니다. "사용자: ..." / "AI: ..." 형식으로 입력해 주세요.');
    }
    return messages;
  }

  const dryRunMutation = useMutation({
    mutationFn: async () => {
      let parsedMessages;
      if (dryRunInputMode === 'freetext') {
        parsedMessages = parseFreeTextToMessages(dryRunFreeText);
        setDryRunMessages(JSON.stringify(parsedMessages, null, 2));
      } else {
        try {
          parsedMessages = JSON.parse(dryRunMessages);
        } catch {
          throw new Error('대화 메시지 형식이 올바르지 않습니다. JSON 배열 형식으로 입력해 주세요.');
        }
      }
      const res = await apiRequest('POST', `/api/admin/evaluation-criteria/${setId}/dry-run`, {
        messages: parsedMessages,
        language: 'ko',
      });
      return res.json();
    },
    onSuccess: (data) => {
      setDryRunResult(data.feedback ?? data);
      toast({ title: '드라이런 평가 완료', description: '이 결과는 저장되지 않습니다.' });
    },
    onError: (error: any) => {
      toast({ title: '드라이런 실패', description: error.message, variant: 'destructive' });
    },
  });

  const { data: versionHistory = [] } = useQuery<EvaluationCriteriaSet[]>({
    queryKey: ['/api/admin/evaluation-criteria', setId, 'versions'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/evaluation-criteria/${setId}/versions`);
      return res.json();
    },
    enabled: showVersionHistory,
  });

  const { data: compareVersionData } = useQuery<any>({
    queryKey: ['/api/admin/evaluation-criteria', compareVersionId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/admin/evaluation-criteria/${compareVersionId}`);
      return res.json();
    },
    enabled: !!compareVersionId && compareVersionId !== setId,
  });

  const statusMutation = useMutation({
    mutationFn: async ({ action }: { action: string }) => {
      const res = await apiRequest('POST', `/api/admin/evaluation-criteria/${setId}/${action}`);
      return res.json();
    },
    onSuccess: (_data, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      const labels: Record<string, string> = {
        'request-review': '검토 요청이 완료되었습니다',
        'approve': '루브릭이 승인되었습니다',
        'reject': '루브릭이 반려되었습니다',
        'archive': '루브릭이 보관되었습니다',
      };
      toast({ title: labels[action] || '상태가 변경되었습니다' });
    },
    onError: (error: any) => {
      toast({ title: '상태 변경 실패', description: error.message, variant: 'destructive' });
    },
  });

  const forkVersionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/admin/evaluation-criteria/${setId}/fork-version`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: '새 버전이 초안으로 생성되었습니다' });
    },
    onError: (error: any) => {
      toast({ title: '버전 분기 실패', description: error.message, variant: 'destructive' });
    },
  });

  const deleteDimInlineMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/admin/evaluation-dimensions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 차원이 삭제되었습니다" });
      setDeleteConfirmDimId(null);
    },
    onError: (error: any) => {
      const msg = String(error.message || '').replace(/^\d+:\s*/, '');
      toast({ title: "삭제 실패", description: msg, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="py-4 text-center text-slate-500">{t('common.loading')}</div>;
  }

  const dimensions = setWithDimensions?.dimensions || [];
  const activeDimensions = dimensions.filter(d => d.isActive);
  const totalWeight = activeDimensions.reduce((sum, d) => sum + (d.weight || 0), 0);
  const isWeightValid = Math.abs(totalWeight - 100) < 0.1;

  const getDimensionTypeBadge = (type: string) => {
    switch (type) {
      case 'core':
        return <Badge className="bg-red-100 text-red-700 text-xs">{t('admin.evaluationCriteria.required')}</Badge>;
      case 'bonus':
        return <Badge className="bg-green-100 text-green-700 text-xs">{t('admin.evaluationCriteria.bonus')}</Badge>;
      default:
        return <Badge className="bg-blue-100 text-blue-700 text-xs">{t('admin.evaluationCriteria.general')}</Badge>;
    }
  };

  const currentStatus = setWithDimensions?.status;
  const isPending = statusMutation.isPending || forkVersionMutation.isPending;
  // Explicit role-based action capability:
  // admin:    full control — edit, approve, reject, archive, delete, set-default, fork
  // operator: can edit own rubrics, request review, fork approved; cannot approve/reject
  // user:     read-only — history view only, no mutations
  const canEdit = isAdmin || isOperator;
  const canApproveReject = isAdmin;
  const canRequestReview = isAdmin || isOperator;
  const canDelete = isAdmin || isOperator;
  const canFork = isAdmin || isOperator;
  const canSetDefault = isAdmin;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onEdit} disabled={currentStatus === 'archived'}>
              <Edit className="h-4 w-4 mr-1" />
              {t('admin.evaluationCriteria.edit')}
            </Button>
          )}
          {canSetDefault && !isDefault && (
            <Button variant="outline" size="sm" onClick={onSetDefault} disabled={currentStatus !== 'approved' && currentStatus != null}>
              <Star className="h-4 w-4 mr-1" />
              {t('admin.evaluationCriteria.setAsDefault')}
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onAddDimension} disabled={currentStatus === 'archived' || currentStatus === 'approved'}>
              <Plus className="h-4 w-4 mr-1" />
              {t('admin.evaluationCriteria.addDimension')}
            </Button>
          )}
          {canRequestReview && (currentStatus === 'draft' || !currentStatus) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!isWeightValid) {
                  setReviewRequestWeightError(`가중치 합계가 100%여야 합니다. 현재 ${totalWeight.toFixed(1)}%입니다.`);
                  return;
                }
                setReviewRequestWeightError(null);
                statusMutation.mutate({ action: 'request-review' });
              }}
              disabled={isPending}
              className="text-yellow-700 border-yellow-300 hover:bg-yellow-50"
            >
              <ClockIcon className="h-4 w-4 mr-1" />
              {isAdmin ? '검토 요청' : '승인 요청'}
            </Button>
          )}
          {currentStatus === 'review' && canApproveReject && (
            <>
              <Button variant="outline" size="sm" onClick={() => statusMutation.mutate({ action: 'approve' })} disabled={isPending} className="text-green-700 border-green-300 hover:bg-green-50">
                <CheckCircle className="h-4 w-4 mr-1" />
                승인
              </Button>
              <Button variant="outline" size="sm" onClick={() => statusMutation.mutate({ action: 'reject' })} disabled={isPending} className="text-red-700 border-red-300 hover:bg-red-50">
                <XCircle className="h-4 w-4 mr-1" />
                반려
              </Button>
            </>
          )}
          {currentStatus === 'review' && isOperator && (
            <div className="flex items-center gap-1.5 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-1.5">
              <ClockIcon className="h-3.5 w-3.5" />
              승인 대기 중 — 관리자 검토 필요
            </div>
          )}
          {currentStatus === 'approved' && canFork && (
            <>
              <Button variant="outline" size="sm" onClick={() => forkVersionMutation.mutate()} disabled={isPending} className="text-blue-700 border-blue-300 hover:bg-blue-50">
                <GitBranch className="h-4 w-4 mr-1" />
                새 버전
              </Button>
              {!isDefault && isAdmin && (
                <Button variant="outline" size="sm" onClick={() => statusMutation.mutate({ action: 'archive' })} disabled={isPending} className="text-slate-600 border-slate-300 hover:bg-slate-50">
                  <Archive className="h-4 w-4 mr-1" />
                  보관
                </Button>
              )}
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowVersionHistory(true)}>
            <History className="h-4 w-4 mr-1" />
            이력
          </Button>
          {onTransferOwner && (
            <Button variant="outline" size="sm" onClick={onTransferOwner} className="text-violet-700 border-violet-300 hover:bg-violet-50">
              <ArrowLeftRight className="h-4 w-4 mr-1" />
              소유자 이관
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={currentStatus === 'approved'}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t('common.delete')}
            </Button>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`flex items-center gap-2 px-3 py-1 rounded-lg ${isWeightValid ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {!isWeightValid && <AlertCircle className="h-4 w-4" />}
            <span className="text-sm font-medium">
              {t('admin.evaluationCriteria.weightSum')}: <span className="font-bold">{totalWeight.toFixed(1)}%</span>
              {!isWeightValid && ` ${t('admin.evaluationCriteria.weightRecommended')}`}
            </span>
          </div>
          {reviewRequestWeightError && !isWeightValid && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span>{reviewRequestWeightError}</span>
            </div>
          )}
        </div>
      </div>

      {currentStatus === 'approved' && (
        <div className="sticky top-0 z-10 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800">
          <Lock className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
          <div className="flex-1 text-sm">
            <span className="font-semibold">승인된 루브릭은 편집이 잠겨 있습니다.</span>{' '}
            차원을 수정하려면 먼저 <span className="font-semibold">"새 버전"</span> 버튼으로 새 초안을 만드세요.
          </div>
          <GitBranch className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
        </div>
      )}

      <Dialog open={showVersionHistory} onOpenChange={(open) => { setShowVersionHistory(open); if (!open) setCompareVersionId(null); }}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              버전 이력
            </DialogTitle>
            <DialogDescription>이 루브릭의 모든 버전을 확인하고 비교합니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {versionHistory.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">버전 이력이 없습니다.</p>
            ) : (
              versionHistory.map((v) => {
                const s = v.status;
                const isCurrent = v.id === setId;
                const isComparing = compareVersionId === v.id;
                const currentDims: any[] = setWithDimensions?.dimensions ?? [];
                const compareDims: any[] = isComparing && compareVersionData ? (compareVersionData.dimensions ?? []) : [];
                const currentKeys = new Set(currentDims.map((d: any) => d.key));
                const compareKeys = new Set(compareDims.map((d: any) => d.key));
                return (
                  <div key={v.id} className={`border rounded-lg p-3 ${isCurrent ? 'border-blue-300 bg-blue-50' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold">v{v.version ?? 1}</span>
                        {isCurrent && <Badge variant="outline" className="text-[10px] h-4">현재</Badge>}
                        {(!s || s === 'approved') && <Badge className="bg-green-100 text-green-700 text-[10px] h-4">승인됨</Badge>}
                        {s === 'review' && <Badge className="bg-yellow-100 text-yellow-700 text-[10px] h-4">검토중</Badge>}
                        {s === 'draft' && <Badge variant="outline" className="text-[10px] h-4">초안</Badge>}
                        {s === 'archived' && <Badge className="bg-slate-100 text-slate-500 text-[10px] h-4">보관됨</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{new Date(v.createdAt).toLocaleDateString('ko-KR')}</span>
                        {!isCurrent && (
                          <Button
                            size="sm"
                            variant={isComparing ? "default" : "outline"}
                            className="h-6 text-[10px] px-2"
                            onClick={() => setCompareVersionId(isComparing ? null : v.id)}
                          >
                            {isComparing ? '닫기' : '현재와 비교'}
                          </Button>
                        )}
                      </div>
                    </div>
                    {v.approvedAt && (
                      <p className="text-xs text-slate-500 mt-1">승인일: {new Date(v.approvedAt).toLocaleDateString('ko-KR')}</p>
                    )}
                    {isComparing && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-xs font-semibold text-slate-600 mb-2">평가 차원 비교 (왼쪽: v{v.version ?? 1} → 오른쪽: 현재)</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="space-y-1">
                            <p className="font-medium text-slate-500 mb-1">v{v.version ?? 1} 차원</p>
                            {compareDims.length === 0 ? (
                              <p className="text-slate-400 italic">데이터 로딩 중...</p>
                            ) : compareDims.map((d: any) => (
                              <div key={d.key} className={`flex items-center justify-between px-2 py-1 rounded ${!currentKeys.has(d.key) ? 'bg-red-50 border border-red-200' : d.weight !== currentDims.find((c: any) => c.key === d.key)?.weight ? 'bg-yellow-50 border border-yellow-200' : 'bg-white border border-slate-200'}`}>
                                <span className={!currentKeys.has(d.key) ? 'text-red-700 line-through' : 'text-slate-700'}>{d.name}</span>
                                <span className="text-slate-400 ml-2">w{d.weight}</span>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-1">
                            <p className="font-medium text-slate-500 mb-1">현재 차원</p>
                            {currentDims.map((d: any) => (
                              <div key={d.key} className={`flex items-center justify-between px-2 py-1 rounded ${!compareKeys.has(d.key) ? 'bg-green-50 border border-green-200' : d.weight !== compareDims.find((c: any) => c.key === d.key)?.weight ? 'bg-yellow-50 border border-yellow-200' : 'bg-white border border-slate-200'}`}>
                                <span className={!compareKeys.has(d.key) ? 'text-green-700 font-semibold' : 'text-slate-700'}>{d.name}</span>
                                <span className="text-slate-400 ml-2">w{d.weight}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-green-100 border border-green-300"></span>추가됨</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-red-100 border border-red-300"></span>제거됨</span>
                          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-yellow-100 border border-yellow-300"></span>가중치 변경</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowVersionHistory(false); setCompareVersionId(null); }}>닫기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="h-8">
          <TabsTrigger value="dimensions" className="text-xs h-7 px-3">
            <Target className="h-3.5 w-3.5 mr-1.5" />
            평가 차원
          </TabsTrigger>
          <TabsTrigger value="quality" className="text-xs h-7 px-3" onClick={() => refetchQuality()}>
            <BarChart2 className="h-3.5 w-3.5 mr-1.5" />
            품질 점수
          </TabsTrigger>
          <TabsTrigger value="dryrun" className="text-xs h-7 px-3">
            <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
            드라이런 테스트
          </TabsTrigger>
          <TabsTrigger value="translation" className="text-xs h-7 px-3">
            <Languages className="h-3.5 w-3.5 mr-1.5" />
            번역 현황
          </TabsTrigger>
          <TabsTrigger value="scoring-examples" className="text-xs h-7 px-3">
            <Brain className="h-3.5 w-3.5 mr-1.5" />
            채점 예시
          </TabsTrigger>
        </TabsList>

        {/* ── 차원 탭 ── */}
        <TabsContent value="dimensions" className="mt-3">
          {dimensions.length === 0 ? (
            <div className="py-6 text-center text-slate-500">
              <p>{t('admin.evaluationCriteria.noDimensions')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {dimensions.map((dim, index) => {
                const IconComp = getIconComponent(dim.icon || 'Star');
                const isApproved = currentStatus === 'approved';
                const editable = canEdit && !isApproved && currentStatus !== 'archived';
                const openEditor = () => { if (editable) onEditDimension(dim); };

                return (
                  <div
                    key={dim.id}
                    data-testid={`dimension-card-${dim.id}`}
                    role={editable ? 'button' : undefined}
                    tabIndex={editable ? 0 : undefined}
                    aria-label={editable ? `${dim.name} 평가 차원 편집` : undefined}
                    className={`border rounded-lg p-3 flex items-center gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${editable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default'} ${!dim.isActive ? 'opacity-60 bg-slate-50' : 'bg-white'}`}
                    onClick={openEditor}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(); }
                    }}
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-md shrink-0" style={{ backgroundColor: (dim.color || '#6366f1') + '1A' }}>
                      <IconComp className="h-4 w-4" style={{ color: dim.color || '#6366f1' }} />
                    </div>
                    <div className="text-xs text-slate-400 w-5 text-center shrink-0">{index + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{dim.name}</span>
                        {getDimensionTypeBadge((dim as any).dimensionType || 'standard')}
                        {!dim.isActive && <Badge variant="secondary" className="text-xs">{t('admin.evaluationCriteria.inactive')}</Badge>}
                      </div>
                      {dim.description && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{dim.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-sm">
                      <div className="text-center">
                        <span className="font-bold text-blue-600">{dim.weight}%</span>
                      </div>
                      <div className="text-center text-slate-500">
                        {dim.minScore}-{dim.maxScore}
                      </div>
                      {isApproved ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button variant="ghost" size="icon" className="h-7 w-7 opacity-40 cursor-not-allowed" disabled>
                                  <Lock className="h-3.5 w-3.5" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs max-w-[200px]">
                              승인된 루브릭입니다. "새 버전" 버튼으로 포크 후 편집하세요.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : editable ? (
                        <>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`${dim.name} 편집`} tabIndex={-1}
                            onClick={(e) => { e.stopPropagation(); openEditor(); }}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" aria-label={`${dim.name} 삭제`}
                            data-testid={`button-delete-dimension-${dim.id}`}
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmDimId(dim.id); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── 품질 점수 탭 ── */}
        <TabsContent value="quality" className="mt-3">
          {!qualityScore ? (
            <div className="py-6 text-center text-slate-400 text-sm">품질 점수를 불러오는 중...</div>
          ) : qualityScore.error ? (
            <div className="py-4 text-center text-red-500 text-sm">{qualityScore.error}</div>
          ) : (
            <div className="space-y-4">
              {/* gauge */}
              <div className="flex items-center gap-6 p-4 border rounded-lg bg-white">
                <div className="relative flex items-center justify-center w-24 h-24 shrink-0">
                  <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15.9" fill="none"
                      stroke={qualityScore.totalScore >= 80 ? '#22c55e' : qualityScore.totalScore >= 60 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="3"
                      strokeDasharray={`${(qualityScore.totalScore / 100) * 100} 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <span className={`text-2xl font-bold ${qualityScore.totalScore >= 80 ? 'text-green-600' : qualityScore.totalScore >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                      {qualityScore.totalScore}
                    </span>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-base">루브릭 품질 점수</span>
                    {qualityScore.totalScore >= 80 ? (
                      <Badge className="bg-green-100 text-green-700 text-xs">승인 가능</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-700 text-xs">개선 필요 (80점 이상 필요)</Badge>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mb-3">
                    {qualityScore.totalScore >= 80
                      ? '이 루브릭은 품질 기준을 충족합니다. 검토 요청을 진행할 수 있습니다.'
                      : `승인을 위해 ${80 - qualityScore.totalScore}점이 더 필요합니다. 아래 항목을 개선해 주세요.`}
                  </p>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowQualityBreakdown(v => !v)}>
                    <Info className="h-3.5 w-3.5 mr-1" />
                    {showQualityBreakdown ? '세부 내역 닫기' : '세부 내역 보기'}
                  </Button>
                </div>
              </div>

              {/* breakdown */}
              {showQualityBreakdown && qualityScore.breakdown && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-slate-600">항목</th>
                        <th className="text-right px-4 py-2 text-xs font-semibold text-slate-600">점수</th>
                        <th className="text-right px-4 py-2 text-xs font-semibold text-slate-600">최대</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { key: 'scoreConsistency', label: '점수 일관성', max: 20 },
                        { key: 'weightAccuracy', label: '가중치 정확도', max: 20 },
                        { key: 'behaviorAnchorSpecificity', label: '행동 앵커 구체성', max: 25 },
                        { key: 'rubricStageCompleteness', label: '루브릭 단계 완성도', max: 20 },
                        { key: 'evaluationPromptQuality', label: '평가 프롬프트 품질', max: 15 },
                      ].map((item) => {
                        const entry = qualityScore.breakdown?.[item.key];
                        const score = entry?.score ?? 0;
                        const maxScore = entry?.maxScore ?? item.max;
                        const issues: string[] = entry?.issues ?? [];
                        const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
                        return (
                          <Fragment key={item.key}>
                            <tr className="border-b last:border-0">
                              <td className="px-4 py-2.5 text-slate-700">{item.label}</td>
                              <td className="px-4 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className={`font-medium w-6 text-right ${pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-amber-500' : 'text-red-500'}`}>{score}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right text-slate-400 text-xs">{maxScore}</td>
                            </tr>
                            {issues.length > 0 && (
                              <tr className="border-b last:border-0 bg-red-50">
                                <td colSpan={3} className="px-4 pb-2 pt-0">
                                  <ul className="space-y-0.5">
                                    {issues.map((issue, i) => (
                                      <li key={i} className="text-xs text-red-600 flex items-start gap-1">
                                        <span className="mt-0.5 shrink-0">•</span>
                                        <span>{issue}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t">
                      <tr>
                        <td className="px-4 py-2 font-semibold text-slate-700">합계</td>
                        <td className="px-4 py-2 text-right font-bold text-slate-800">{qualityScore.totalScore}</td>
                        <td className="px-4 py-2 text-right text-slate-400 text-xs">100</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── 드라이런 탭 ── */}
        <TabsContent value="dryrun" className="mt-3 space-y-4">
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-amber-800 text-sm">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <span>드라이런 평가는 이 루브릭으로 샘플 대화를 테스트합니다. <strong>결과는 저장되지 않습니다.</strong></span>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
            <button
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${dryRunInputMode === 'freetext' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              onClick={() => { setDryRunInputMode('freetext'); setDryRunPreviewJson(null); setDryRunPreviewError(null); }}
            >
              자유 텍스트
            </button>
            <button
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${dryRunInputMode === 'json' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              onClick={() => { setDryRunInputMode('json'); setDryRunPreviewJson(null); setDryRunPreviewError(null); }}
            >
              JSON 직접 입력
            </button>
          </div>

          {dryRunInputMode === 'freetext' ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs font-semibold text-slate-600 mb-1.5 block">대화 입력 (사용자: ... / AI: ... 형식)</Label>
                <Textarea
                  value={dryRunFreeText}
                  onChange={(e) => { setDryRunFreeText(e.target.value); setDryRunPreviewJson(null); setDryRunPreviewError(null); }}
                  rows={10}
                  className="text-sm"
                  placeholder={`사용자: 안녕하세요.\nAI: 네, 말씀해 보세요.\n사용자: ...`}
                />
                <p className="text-xs text-slate-400 mt-1.5">줄마다 <code className="bg-slate-100 px-1 rounded">사용자:</code> 또는 <code className="bg-slate-100 px-1 rounded">AI:</code> 로 시작하세요. 실행 시 자동으로 JSON으로 변환됩니다.</p>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => {
                  try {
                    const parsed = parseFreeTextToMessages(dryRunFreeText);
                    setDryRunPreviewJson(JSON.stringify(parsed, null, 2));
                    setDryRunPreviewError(null);
                  } catch (e: any) {
                    setDryRunPreviewJson(null);
                    setDryRunPreviewError(e.message);
                  }
                }}
              >
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                JSON 변환 미리보기
              </Button>

              {dryRunPreviewError && (
                <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-red-700 text-xs">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{dryRunPreviewError}</span>
                </div>
              )}

              {dryRunPreviewJson && (
                <div>
                  <Label className="text-xs font-semibold text-slate-600 mb-1.5 block">변환 결과 미리보기 (읽기 전용)</Label>
                  <Textarea
                    value={dryRunPreviewJson}
                    readOnly
                    rows={8}
                    className="font-mono text-xs bg-slate-50 text-slate-700"
                  />
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    {JSON.parse(dryRunPreviewJson).length}개의 메시지로 변환되었습니다. 아래 실행 버튼을 눌러 평가를 시작하세요.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <Label className="text-xs font-semibold text-slate-600 mb-1.5 block">샘플 대화 메시지 (JSON 배열)</Label>
              <Textarea
                value={dryRunMessages}
                onChange={(e) => setDryRunMessages(e.target.value)}
                rows={10}
                className="font-mono text-xs"
                placeholder='[{"role":"user","content":"..."}, {"role":"assistant","content":"..."}]'
              />
            </div>
          )}

          <Button onClick={() => dryRunMutation.mutate()} disabled={dryRunMutation.isPending} className="w-full">
            <FlaskConical className="h-4 w-4 mr-2" />
            {dryRunMutation.isPending
              ? '평가 중...'
              : dryRunInputMode === 'freetext'
                ? 'JSON으로 변환 후 실행'
                : '드라이런 평가 실행'}
          </Button>

          {dryRunResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(dryRunResult, null, 2))
                      .then(() => toast({ title: '클립보드에 복사됨', description: 'JSON 결과가 클립보드에 복사되었습니다.' }))
                      .catch(() => toast({ title: '복사 실패', variant: 'destructive' }));
                  }}
                >
                  <Copy className="h-3 w-3" />
                  결과 복사
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => {
                    const scores = (dryRunResult.dimensionScores || dryRunResult.dimension_scores || []);
                    const lines = [
                      `드라이런 평가 결과`,
                      `종합 점수: ${dryRunResult.overallScore ?? dryRunResult.total_score ?? '—'}`,
                      `요약: ${dryRunResult.summary || dryRunResult.overallComment || '요약 없음'}`,
                      '',
                      '차원별 점수:',
                      ...scores.map((ds: any, i: number) =>
                        `  ${ds.dimensionName || ds.dimension_name || `차원 ${i + 1}`}: ${ds.score ?? ds.rawScore ?? '—'} (가중치 ${ds.weight ?? '—'}%)${ds.comment ? ' — ' + ds.comment : ''}`
                      ),
                    ];
                    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `dryrun_result_${Date.now()}.txt`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    toast({ title: '다운로드 완료', description: '텍스트 요약 파일이 저장되었습니다.' });
                  }}
                >
                  <Download className="h-3 w-3" />
                  텍스트 다운로드
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(dryRunResult, null, 2)], { type: 'application/json;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `dryrun_result_${Date.now()}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    toast({ title: '다운로드 완료', description: 'JSON 결과 파일이 저장되었습니다.' });
                  }}
                >
                  <Download className="h-3 w-3" />
                  JSON 다운로드
                </Button>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-lg border bg-white">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">{dryRunResult.overallScore ?? dryRunResult.total_score ?? '—'}</div>
                  <div className="text-xs text-slate-500 mt-0.5">종합 점수</div>
                </div>
                <div className="flex-1 border-l pl-4">
                  <p className="text-sm font-semibold text-slate-700 mb-1">드라이런 결과 요약</p>
                  <p className="text-xs text-slate-500 line-clamp-3">{dryRunResult.summary || dryRunResult.overallComment || '요약 없음'}</p>
                </div>
              </div>

              {(dryRunResult.dimensionScores || dryRunResult.dimension_scores || []).length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-slate-50 border-b px-4 py-2 text-xs font-semibold text-slate-600">차원별 점수</div>
                  <div className="divide-y">
                    {(dryRunResult.dimensionScores || dryRunResult.dimension_scores || []).map((ds: any, i: number) => (
                      <div key={i} className="px-4 py-3 flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center text-sm font-bold text-blue-700 shrink-0">
                          {ds.score ?? ds.rawScore ?? '—'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700">{ds.dimensionName || ds.dimension_name || `차원 ${i + 1}`}</p>
                          {ds.comment && <p className="text-xs text-slate-500 mt-0.5">{ds.comment}</p>}
                        </div>
                        <div className="text-xs text-slate-400 shrink-0">가중치 {ds.weight ?? '—'}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── 번역 현황 탭 ── */}
        <TabsContent value="translation" className="mt-3">
          {allLanguages.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-sm">지원 언어를 불러오는 중...</div>
          ) : (
            <div className="space-y-2">
              {allLanguages.map((lang: any) => {
                const tx = criteriaTranslations.find((t: any) => t.locale === lang.code);
                const hasTranslation = !!tx?.name;
                const isReviewed = tx?.isReviewed;
                const isMachine = tx?.isMachineTranslated && !isReviewed;

                let statusBadge;
                if (!hasTranslation) {
                  statusBadge = (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-slate-400 border-slate-300">
                      누락
                    </Badge>
                  );
                } else if (isReviewed) {
                  statusBadge = (
                    <Badge className="text-[10px] px-1.5 py-0 h-5 bg-green-100 text-green-700 border border-green-200">
                      <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                      번역됨
                    </Badge>
                  );
                } else if (isMachine) {
                  statusBadge = (
                    <Badge className="text-[10px] px-1.5 py-0 h-5 bg-amber-100 text-amber-700 border border-amber-200">
                      <Bot className="h-2.5 w-2.5 mr-0.5" />
                      기계번역
                    </Badge>
                  );
                } else {
                  statusBadge = (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-blue-600 border-blue-300">
                      수동
                    </Badge>
                  );
                }

                return (
                  <div key={lang.code} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-white text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400 w-7">{lang.code}</span>
                      <span className="font-medium text-slate-700">{lang.nativeName}</span>
                      {tx?.name && (
                        <span className="text-xs text-slate-400 truncate max-w-[200px]">— {tx.name}</span>
                      )}
                    </div>
                    {statusBadge}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── 채점 예시 탭 ── */}
        <TabsContent value="scoring-examples" className="mt-3">
          <CriteriaSetFewShotTab
            criteriaSetId={setId}
            dimensions={dimensions}
          />
        </TabsContent>
      </Tabs>

      {/* 평가 차원 삭제 확인 다이얼로그 */}
      <Dialog open={deleteConfirmDimId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmDimId(null); }}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              평가 차원 삭제
            </DialogTitle>
            <DialogDescription>
              이 작업은 되돌릴 수 없습니다. 정말로 삭제하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          {deleteConfirmDimId && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 my-4">
              <p className="font-medium text-slate-800">
                {dimensions.find((d) => d.id === deleteConfirmDimId)?.name}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmDimId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmDimId) {
                  deleteDimInlineMutation.mutate(deleteConfirmDimId);
                }
              }}
              disabled={deleteDimInlineMutation.isPending}
            >
              {deleteDimInlineMutation.isPending ? t('admin.common.loading') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
