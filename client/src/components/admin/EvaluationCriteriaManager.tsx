import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Edit, Trash2, Star, Check, GripVertical, Copy, Settings } from "lucide-react";

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
  { key: 'clarityLogic', name: '명확성 & 논리성', description: '의사 표현의 명확성과 논리적 구성' },
  { key: 'listeningEmpathy', name: '경청 & 공감', description: '상대방의 말을 듣고 공감하는 능력' },
  { key: 'appropriatenessAdaptability', name: '적절성 & 상황대응', description: '상황에 맞는 적절한 대응' },
  { key: 'persuasivenessImpact', name: '설득력 & 영향력', description: '상대방을 설득하고 영향을 미치는 능력' },
  { key: 'strategicCommunication', name: '전략적 커뮤니케이션', description: '목표 달성을 위한 전략적 소통' },
];

export function EvaluationCriteriaManager() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDimensionDialogOpen, setIsDimensionDialogOpen] = useState(false);
  const [selectedSet, setSelectedSet] = useState<EvaluationCriteriaSet | null>(null);
  const [selectedDimension, setSelectedDimension] = useState<EvaluationDimension | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isDefault: false,
    isActive: true,
    categoryId: '',
    useDefaultDimensions: true,
  });

  const [dimensionFormData, setDimensionFormData] = useState({
    key: '',
    name: '',
    description: '',
    weight: 1,
    minScore: 1,
    maxScore: 5,
    icon: '',
    color: '',
    isActive: true,
    scoringRubric: [] as ScoringRubric[],
  });

  const { data: criteriaSets = [], isLoading } = useQuery<EvaluationCriteriaSet[]>({
    queryKey: ['/api/admin/evaluation-criteria'],
    queryFn: async () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch('/api/admin/evaluation-criteria', { credentials: 'include', headers });
      return res.json();
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', '/api/admin/evaluation-criteria', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/evaluation-criteria'] });
      toast({ title: "평가 기준 세트가 생성되었습니다" });
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
    });
  };

  const resetDimensionFormData = () => {
    setDimensionFormData({
      key: '',
      name: '',
      description: '',
      weight: 1,
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
          weight: 1,
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
      minScore: dimensionFormData.minScore,
      maxScore: dimensionFormData.maxScore,
      icon: dimensionFormData.icon || null,
      color: dimensionFormData.color || null,
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
    const res = await fetch(`/api/admin/evaluation-criteria/${id}`, { credentials: 'include', headers });
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
          <h2 className="text-2xl font-bold">평가 기준 관리</h2>
          <p className="text-slate-600">사용자 대화 피드백에 사용될 평가 기준을 설정합니다.</p>
        </div>
        <Button onClick={() => { resetFormData(); setIsCreateDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          새 평가 기준 세트
        </Button>
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
              첫 평가 기준 세트 만들기
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
                  onDelete={() => deleteMutation.mutate(set.id)}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>취소</Button>
            <Button onClick={handleCreate} disabled={!formData.name || createMutation.isPending}>
              {createMutation.isPending ? "생성 중..." : "생성"}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>취소</Button>
            <Button onClick={handleUpdate} disabled={!formData.name || updateMutation.isPending}>
              {updateMutation.isPending ? "저장 중..." : "저장"}
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
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="dim-weight">가중치</Label>
                <Input
                  id="dim-weight"
                  type="number"
                  min="0"
                  step="0.1"
                  value={dimensionFormData.weight}
                  onChange={(e) => setDimensionFormData({ ...dimensionFormData, weight: parseFloat(e.target.value) || 1 })}
                />
              </div>
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
                <Input
                  id="dim-icon"
                  value={dimensionFormData.icon}
                  onChange={(e) => setDimensionFormData({ ...dimensionFormData, icon: e.target.value })}
                  placeholder="💡"
                />
              </div>
              <div>
                <Label htmlFor="dim-color">색상</Label>
                <Input
                  id="dim-color"
                  value={dimensionFormData.color}
                  onChange={(e) => setDimensionFormData({ ...dimensionFormData, color: e.target.value })}
                  placeholder="#3B82F6"
                />
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
            <Button variant="outline" onClick={() => setIsDimensionDialogOpen(false)}>취소</Button>
            <Button 
              onClick={handleSaveDimension} 
              disabled={!dimensionFormData.key || !dimensionFormData.name || createDimensionMutation.isPending || updateDimensionMutation.isPending}
            >
              {(createDimensionMutation.isPending || updateDimensionMutation.isPending) ? "저장 중..." : "저장"}
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
  const { data: setWithDimensions, isLoading } = useQuery({
    queryKey: ['/api/admin/evaluation-criteria', setId],
    queryFn: () => fetchSetWithDimensions(setId),
  });

  if (isLoading) {
    return <div className="py-4 text-center text-slate-500">로딩 중...</div>;
  }

  const dimensions = setWithDimensions?.dimensions || [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Edit className="h-4 w-4 mr-1" />
          수정
        </Button>
        {!isDefault && (
          <Button variant="outline" size="sm" onClick={onSetDefault}>
            <Star className="h-4 w-4 mr-1" />
            기본으로 설정
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onAddDimension}>
          <Plus className="h-4 w-4 mr-1" />
          차원 추가
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-1" />
          삭제
        </Button>
      </div>

      {dimensions.length === 0 ? (
        <div className="py-6 text-center text-slate-500">
          <p>평가 차원이 없습니다. 차원을 추가하세요.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2">순서</th>
                <th className="text-left px-3 py-2">키</th>
                <th className="text-left px-3 py-2">이름</th>
                <th className="text-left px-3 py-2">설명</th>
                <th className="text-center px-3 py-2">가중치</th>
                <th className="text-center px-3 py-2">점수 범위</th>
                <th className="text-center px-3 py-2">상태</th>
                <th className="text-right px-3 py-2">작업</th>
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dim, index) => (
                <tr key={dim.id} className="border-t">
                  <td className="px-3 py-2 text-slate-500">{index + 1}</td>
                  <td className="px-3 py-2 font-mono text-xs">{dim.key}</td>
                  <td className="px-3 py-2">
                    {dim.icon && <span className="mr-1">{dim.icon}</span>}
                    {dim.name}
                  </td>
                  <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate">
                    {dim.description}
                  </td>
                  <td className="px-3 py-2 text-center">{dim.weight}</td>
                  <td className="px-3 py-2 text-center">{dim.minScore}-{dim.maxScore}</td>
                  <td className="px-3 py-2 text-center">
                    {dim.isActive ? (
                      <Badge variant="default" className="bg-green-100 text-green-700">활성</Badge>
                    ) : (
                      <Badge variant="secondary">비활성</Badge>
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
