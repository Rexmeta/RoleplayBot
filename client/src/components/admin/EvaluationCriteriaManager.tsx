import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Star, Check, GripVertical, Copy, Settings, MessageCircle, Target, Lightbulb, Heart, Users, Award, Brain, Zap, Shield, TrendingUp, Eye, Ear, HandHeart, Compass, Flag, ThumbsUp, Megaphone, PenTool, BookOpen, Sparkles, AlertCircle, Languages } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const AVAILABLE_ICONS = [
  { name: 'Star', icon: Star },
  { name: 'MessageCircle', icon: MessageCircle },
  { name: 'Target', icon: Target },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Heart', icon: Heart },
  { name: 'Users', icon: Users },
  { name: 'Award', icon: Award },
  { name: 'Brain', icon: Brain },
  { name: 'Zap', icon: Zap },
  { name: 'Shield', icon: Shield },
  { name: 'TrendingUp', icon: TrendingUp },
  { name: 'Eye', icon: Eye },
  { name: 'Ear', icon: Ear },
  { name: 'HandHeart', icon: HandHeart },
  { name: 'Compass', icon: Compass },
  { name: 'Flag', icon: Flag },
  { name: 'ThumbsUp', icon: ThumbsUp },
  { name: 'Megaphone', icon: Megaphone },
  { name: 'PenTool', icon: PenTool },
  { name: 'BookOpen', icon: BookOpen },
  { name: 'Sparkles', icon: Sparkles },
  { name: 'Check', icon: Check },
  { name: 'Settings', icon: Settings },
];

const getIconComponent = (iconName: string) => {
  const found = AVAILABLE_ICONS.find(i => i.name === iconName);
  return found ? found.icon : Star;
};

interface ScoringRubric {
  score: number;
  label: string;
  description: string;
}

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
  isActive: boolean;
}

interface EvaluationCriteriaSet {
  id: string;
  name: string;
  description?: string | null;
  isDefault: boolean;
  isActive: boolean;
  categoryId?: string | null;
  createdAt: string;
  updatedAt: string;
  dimensions?: EvaluationDimension[];
}

interface Category {
  id: string;
  name: string;
}

const DEFAULT_DIMENSIONS = [
  { key: 'clarityLogic', name: '명확성 & 논리성', description: '의사 표현의 명확성과 논리적 구성', weight: 20 },
  { key: 'listeningEmpathy', name: '경청 & 공감', description: '상대방의 말을 듣고 공감하는 능력', weight: 20 },
  { key: 'appropriatenessAdaptability', name: '적절성 & 상황대응', description: '상황에 맞는 적절한 대응', weight: 20 },
  { key: 'persuasivenessImpact', name: '설득력 & 영향력', description: '상대방을 설득하고 영향을 미치는 능력', weight: 20 },
  { key: 'strategicCommunication', name: '전략적 커뮤니케이션', description: '목표 달성을 위한 전략적 소통', weight: 20 },
];

const DIMENSION_TYPE_OPTIONS = [
  { value: 'core', label: '필수 기준', description: '반드시 충족해야 하는 핵심 평가 항목', color: 'text-red-600' },
  { value: 'standard', label: '일반 기준', description: '표준 평가 항목', color: 'text-blue-600' },
  { value: 'bonus', label: '가점 기준', description: '추가 가점을 받을 수 있는 항목', color: 'text-green-600' },
];

export function EvaluationCriteriaManager() {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language;
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDimensionDialogOpen, setIsDimensionDialogOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [setToDelete, setSetToDelete] = useState<EvaluationCriteriaSet | null>(null);
  const [selectedSet, setSelectedSet] = useState<EvaluationCriteriaSet | null>(null);
  const [selectedDimension, setSelectedDimension] = useState<EvaluationDimension | null>(null);
  
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
    maxScore: 5,
    icon: '',
    color: '#6366f1',
    isActive: true,
    scoringRubric: [] as ScoringRubric[],
  });

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

  const autoTranslateMutation = useMutation({
    mutationFn: async (criteriaSetId: string) => {
      return apiRequest('POST', `/api/admin/evaluation-criteria/${criteriaSetId}/auto-translate`, { sourceLocale: 'ko' });
    },
    onSuccess: (data: any) => {
      // Invalidate query to refresh with translated content
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: t('admin.evaluationCriteria.translationSuccess'), description: data.message });
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
          const result = await apiRequest('POST', `/api/admin/evaluation-criteria/${id}/auto-translate`, { sourceLocale: 'ko' });
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

  const createDimensionMutation = useMutation({
    mutationFn: async ({ criteriaSetId, data }: { criteriaSetId: string; data: any }) => {
      return apiRequest('POST', `/api/admin/evaluation-criteria/${criteriaSetId}/dimensions`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 차원이 추가되었습니다" });
      setIsDimensionDialogOpen(false);
      resetDimensionFormData();
    },
    onError: (error: any) => {
      toast({ title: "추가 실패", description: error.message, variant: "destructive" });
    },
  });

  const updateDimensionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest('PUT', `/api/admin/evaluation-dimensions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 차원이 수정되었습니다" });
      setIsDimensionDialogOpen(false);
      setSelectedDimension(null);
    },
    onError: (error: any) => {
      toast({ title: "수정 실패", description: error.message, variant: "destructive" });
    },
  });

  const deleteDimensionMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/admin/evaluation-dimensions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 차원이 삭제되었습니다" });
    },
    onError: (error: any) => {
      toast({ title: "삭제 실패", description: error.message, variant: "destructive" });
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
      maxScore: 5,
      icon: '',
      color: '',
      isActive: true,
      scoringRubric: [],
    });
  };

  const handleCreate = () => {
    const dimensions = formData.useDefaultDimensions
      ? DEFAULT_DIMENSIONS.map((dim, idx) => ({
          ...dim,
          weight: dim.weight,
          dimensionType: 'standard',
          minScore: 1,
          maxScore: 5,
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
    if (!selectedSet) return;
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
    setIsDimensionDialogOpen(true);
  };

  const handleEditDimension = (set: EvaluationCriteriaSet, dimension: EvaluationDimension) => {
    setSelectedSet(set);
    setSelectedDimension(dimension);
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
    });
    setIsDimensionDialogOpen(true);
  };

  const handleSaveDimension = () => {
    if (!selectedSet) return;

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
          <Button onClick={() => { resetFormData(); setIsCreateDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            {t('admin.evaluationCriteria.newCriteriaSet')}
          </Button>
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
            <Button onClick={() => { resetFormData(); setIsCreateDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" />
              {t('admin.evaluationCriteria.createFirstSet')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-4">
          {criteriaSets.map((set) => (
            <AccordionItem key={set.id} value={set.id} className="border rounded-lg">
              <AccordionTrigger className="px-4 hover:no-underline">
                <div className="flex items-center gap-3 w-full">
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{set.name}</span>
                      {set.isDefault && (
                        <Badge variant="default" className="bg-blue-600">
                          <Star className="h-3 w-3 mr-1" />
                          기본
                        </Badge>
                      )}
                      {!set.isActive && (
                        <Badge variant="secondary">비활성</Badge>
                      )}
                      {set.categoryId && (
                        <Badge variant="outline">{getCategoryName(set.categoryId)}</Badge>
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
                  onEditDimension={(dim) => handleEditDimension(set, dim)}
                  onDeleteDimension={(dimId) => deleteDimensionMutation.mutate(dimId)}
                  isDefault={set.isDefault}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>새 평가 기준 세트</DialogTitle>
            <DialogDescription>
              대화 피드백에 사용될 새로운 평가 기준 세트를 만듭니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">이름 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="예: 영업팀 평가 기준"
              />
            </div>
            <div>
              <Label htmlFor="description">설명</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="이 평가 기준 세트에 대한 설명"
              />
            </div>
            <div>
              <Label htmlFor="category">연결 카테고리</Label>
              <Select
                value={formData.categoryId}
                onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="선택 없음 (모든 카테고리)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">선택 없음</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1">
                특정 카테고리에 연결하면 해당 카테고리의 시나리오에서만 이 기준이 사용됩니다.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="isDefault">기본 기준으로 설정</Label>
              <Switch
                id="isDefault"
                checked={formData.isDefault}
                onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="useDefault">기본 5개 평가 차원 포함</Label>
              <Switch
                id="useDefault"
                checked={formData.useDefaultDimensions}
                onCheckedChange={(checked) => setFormData({ ...formData, useDefaultDimensions: checked })}
              />
            </div>
            <div className="flex items-center justify-between border-t pt-4 mt-4">
              <div>
                <Label htmlFor="autoTranslate" className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  {t('admin.evaluationCriteria.autoTranslate')}
                </Label>
                <p className="text-xs text-slate-500 mt-1">
                  {t('admin.evaluationCriteria.autoTranslateDescription')}
                </p>
              </div>
              <Switch
                id="autoTranslate"
                checked={formData.autoTranslate}
                onCheckedChange={(checked) => setFormData({ ...formData, autoTranslate: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCreate} disabled={!formData.name || createMutation.isPending}>
              {createMutation.isPending ? t('admin.common.loading') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>평가 기준 세트 수정</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">이름 *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-description">설명</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-category">연결 카테고리</Label>
              <Select
                value={formData.categoryId || "none"}
                onValueChange={(value) => setFormData({ ...formData, categoryId: value === "none" ? "" : value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">선택 없음</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-isActive">활성화</Label>
              <Switch
                id="edit-isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-isDefault">기본 기준으로 설정</Label>
              <Switch
                id="edit-isDefault"
                checked={formData.isDefault}
                onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked })}
              />
            </div>
            <div className="flex items-center justify-between border-t pt-4 mt-4">
              <div>
                <Label className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  {t('admin.evaluationCriteria.autoTranslate')}
                </Label>
                <p className="text-xs text-slate-500 mt-1">
                  {t('admin.evaluationCriteria.autoTranslateDescription')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => selectedSet?.id && autoTranslateMutation.mutate(selectedSet.id)}
                disabled={autoTranslateMutation.isPending || !selectedSet?.id}
              >
                {autoTranslateMutation.isPending 
                  ? t('admin.common.loading')
                  : t('admin.evaluationCriteria.triggerAutoTranslate')
                }
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleUpdate} disabled={!formData.name || updateMutation.isPending}>
              {updateMutation.isPending ? t('admin.common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDimensionDialogOpen} onOpenChange={setIsDimensionDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedDimension ? "평가 차원 수정" : "새 평가 차원 추가"}</DialogTitle>
            <DialogDescription>
              평가 차원의 세부 설정을 입력하세요.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dim-key">키 (영문) *</Label>
                <Input
                  id="dim-key"
                  value={dimensionFormData.key}
                  onChange={(e) => setDimensionFormData({ ...dimensionFormData, key: e.target.value })}
                  placeholder="clarityLogic"
                  disabled={!!selectedDimension}
                />
              </div>
              <div>
                <Label htmlFor="dim-name">이름 *</Label>
                <Input
                  id="dim-name"
                  value={dimensionFormData.name}
                  onChange={(e) => setDimensionFormData({ ...dimensionFormData, name: e.target.value })}
                  placeholder="명확성 & 논리성"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="dim-description">설명</Label>
              <Textarea
                id="dim-description"
                value={dimensionFormData.description}
                onChange={(e) => setDimensionFormData({ ...dimensionFormData, description: e.target.value })}
                placeholder="이 평가 차원에 대한 상세 설명"
              />
            </div>
            <div>
              <Label>차원 유형</Label>
              <Select
                value={dimensionFormData.dimensionType}
                onValueChange={(value: 'core' | 'standard' | 'bonus') => setDimensionFormData({ ...dimensionFormData, dimensionType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMENSION_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <span className={opt.color}>{opt.label}</span>
                        <span className="text-xs text-slate-400">- {opt.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label htmlFor="dim-weight">가중치 (%)</Label>
                <span className="text-lg font-bold text-blue-600">{dimensionFormData.weight}%</span>
              </div>
              <Slider
                id="dim-weight"
                min={0}
                max={100}
                step={5}
                value={[dimensionFormData.weight]}
                onValueChange={(values) => setDimensionFormData({ ...dimensionFormData, weight: values[0] })}
                className="my-2"
              />
              <p className="text-xs text-slate-500">모든 활성 차원의 가중치 합계가 100%가 되도록 설정하세요.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dim-minScore">최소 점수</Label>
                <Input
                  id="dim-minScore"
                  type="number"
                  value={dimensionFormData.minScore}
                  onChange={(e) => setDimensionFormData({ ...dimensionFormData, minScore: parseInt(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label htmlFor="dim-maxScore">최대 점수</Label>
                <Input
                  id="dim-maxScore"
                  type="number"
                  value={dimensionFormData.maxScore}
                  onChange={(e) => setDimensionFormData({ ...dimensionFormData, maxScore: parseInt(e.target.value) || 5 })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dim-icon">아이콘</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start gap-2">
                      {(() => {
                        const IconComp = getIconComponent(dimensionFormData.icon || 'Star');
                        return <IconComp className="h-4 w-4" />;
                      })()}
                      <span>{dimensionFormData.icon || '아이콘 선택'}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3" align="start">
                    <div className="grid grid-cols-6 gap-2">
                      {AVAILABLE_ICONS.map(({ name, icon: IconComp }) => (
                        <Button
                          key={name}
                          variant={dimensionFormData.icon === name ? "default" : "ghost"}
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => setDimensionFormData({ ...dimensionFormData, icon: name })}
                        >
                          <IconComp className="h-4 w-4" />
                        </Button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label htmlFor="dim-color">색상</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between px-3">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div 
                          className="w-4 h-4 rounded-full shrink-0 border border-slate-200" 
                          style={{ backgroundColor: dimensionFormData.color || '#6366f1' }}
                        />
                        <span className="truncate text-xs font-mono">{dimensionFormData.color || '#6366f1'}</span>
                      </div>
                      <Settings className="h-4 w-4 opacity-50 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[220px] p-3" align="end">
                    <div className="space-y-3">
                      <div className="grid grid-cols-4 gap-2">
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={color}
                            className={`w-8 h-8 rounded-md border border-slate-200 hover:scale-110 transition-transform ${dimensionFormData.color === color ? 'ring-2 ring-slate-950 ring-offset-1' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setDimensionFormData({ ...dimensionFormData, color })}
                            title={color}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2 pt-2 border-t">
                        <Input
                          type="color"
                          value={dimensionFormData.color || '#6366f1'}
                          onChange={(e) => setDimensionFormData({ ...dimensionFormData, color: e.target.value })}
                          className="w-10 h-8 p-1 cursor-pointer shrink-0 border-none bg-transparent"
                        />
                        <Input
                          type="text"
                          value={dimensionFormData.color || '#6366f1'}
                          onChange={(e) => setDimensionFormData({ ...dimensionFormData, color: e.target.value })}
                          className="h-8 text-xs font-mono"
                          placeholder="#000000"
                        />
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="dim-isActive">활성화</Label>
              <Switch
                id="dim-isActive"
                checked={dimensionFormData.isActive}
                onCheckedChange={(checked) => setDimensionFormData({ ...dimensionFormData, isActive: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDimensionDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button 
              onClick={handleSaveDimension} 
              disabled={!dimensionFormData.key || !dimensionFormData.name || createDimensionMutation.isPending || updateDimensionMutation.isPending}
            >
              {(createDimensionMutation.isPending || updateDimensionMutation.isPending) ? t('admin.common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 삭제 확인 다이얼로그 */}
      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
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
  onDeleteDimension,
  isDefault,
}: {
  setId: string;
  fetchSetWithDimensions: (id: string) => Promise<EvaluationCriteriaSet>;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onAddDimension: () => void;
  onEditDimension: (dim: EvaluationDimension) => void;
  onDeleteDimension: (dimId: string) => void;
  isDefault: boolean;
}) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language;
  const { data: setWithDimensions, isLoading } = useQuery({
    queryKey: ['/api/admin/evaluation-criteria', setId, currentLang],
    queryFn: () => fetchSetWithDimensions(setId),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="h-4 w-4 mr-1" />
            {t('admin.evaluationCriteria.edit')}
          </Button>
          {!isDefault && (
            <Button variant="outline" size="sm" onClick={onSetDefault}>
              <Star className="h-4 w-4 mr-1" />
              {t('admin.evaluationCriteria.setAsDefault')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onAddDimension}>
            <Plus className="h-4 w-4 mr-1" />
            {t('admin.evaluationCriteria.addDimension')}
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-1" />
            {t('common.delete')}
          </Button>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-lg ${isWeightValid ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {!isWeightValid && <AlertCircle className="h-4 w-4" />}
          <span className="text-sm font-medium">
            {t('admin.evaluationCriteria.weightSum')}: <span className="font-bold">{totalWeight.toFixed(1)}%</span>
            {!isWeightValid && ` ${t('admin.evaluationCriteria.weightRecommended')}`}
          </span>
        </div>
      </div>

      {dimensions.length === 0 ? (
        <div className="py-6 text-center text-slate-500">
          <p>{t('admin.evaluationCriteria.noDimensions')}</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2">{t('admin.evaluationCriteria.order')}</th>
                <th className="text-left px-3 py-2">{t('admin.evaluationCriteria.type')}</th>
                <th className="text-left px-3 py-2">{t('admin.evaluationCriteria.name')}</th>
                <th className="text-left px-3 py-2">{t('admin.evaluationCriteria.descriptionLabel')}</th>
                <th className="text-center px-3 py-2">{t('admin.evaluationCriteria.weight')}</th>
                <th className="text-center px-3 py-2">{t('admin.evaluationCriteria.score')}</th>
                <th className="text-center px-3 py-2">{t('admin.evaluationCriteria.status')}</th>
                <th className="text-right px-3 py-2">{t('admin.evaluationCriteria.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dim, index) => (
                <tr key={dim.id} className="border-t">
                  <td className="px-3 py-2 text-slate-500">{index + 1}</td>
                  <td className="px-3 py-2">{getDimensionTypeBadge((dim as any).dimensionType || 'standard')}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {dim.icon && <span className="mr-1">{dim.icon}</span>}
                      <span className="font-medium">{dim.name}</span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">{dim.key}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate">
                    {dim.description}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="font-bold text-blue-600">{dim.weight}%</span>
                  </td>
                  <td className="px-3 py-2 text-center">{dim.minScore}-{dim.maxScore}</td>
                  <td className="px-3 py-2 text-center">
                    {dim.isActive ? (
                      <Badge variant="default" className="bg-green-100 text-green-700">{t('admin.evaluationCriteria.active')}</Badge>
                    ) : (
                      <Badge variant="secondary">{t('admin.evaluationCriteria.inactive')}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEditDimension(dim)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => onDeleteDimension(dim.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
