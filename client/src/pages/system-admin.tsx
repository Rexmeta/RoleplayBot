import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Search, Users, Shield, UserCog, Loader2, User, KeyRound, Eye, EyeOff, FolderTree, Plus, Pencil, Trash2, GripVertical, Settings, Save, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

interface UserData {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "user";
  tier: string;
  isActive: boolean;
  profileImage?: string | null;
  lastLoginAt?: string | null;
  assignedCategoryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  order: number;
  scenarioCount?: number;
  createdAt: string;
}

interface SystemSetting {
  id: string;
  category: string;
  key: string;
  value: string;
  description: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const SETTING_CATEGORIES = {
  ai: { label: "AI 모델 설정", description: "AI 응답 생성 및 대화 관련 설정" },
  evaluation: { label: "평가 시스템", description: "사용자 응답 평가 기준 및 점수 계산" },
  conversation: { label: "대화 기본 설정", description: "대화 턴 수, 시간 제한 등" },
  voice: { label: "음성 설정", description: "TTS 및 실시간 음성 관련 설정" },
};

const DEFAULT_SETTINGS: { category: string; key: string; value: string; description: string }[] = [
  { category: "ai", key: "model", value: "gemini-2.5-flash", description: "AI 대화에 사용할 모델 (gemini-2.5-flash, gemini-2.5-pro)" },
  { category: "ai", key: "temperature", value: "0.7", description: "AI 응답의 창의성 정도 (0.0 ~ 1.0)" },
  { category: "ai", key: "maxTokens", value: "2048", description: "AI 응답의 최대 토큰 수" },
  { category: "evaluation", key: "minPassingScore", value: "60", description: "합격 기준 점수 (0 ~ 100, C등급 기준)" },
  { category: "evaluation", key: "evaluationCategories", value: "명확성&논리성,경청&공감,적절성&상황대응,설득력&영향력,전략적커뮤니케이션", description: "평가 항목 (쉼표로 구분)" },
  { category: "conversation", key: "maxTurns", value: "10", description: "대화당 최대 턴 수" },
  { category: "conversation", key: "idleTimeout", value: "5", description: "유휴 시간 제한 (분, 대화 중단으로 간주)" },
  { category: "voice", key: "ttsProvider", value: "elevenlabs", description: "TTS 서비스 제공자 (elevenlabs, openai)" },
  { category: "voice", key: "speechRate", value: "1.0", description: "음성 속도 (0.5 ~ 2.0)" },
];

const roleConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  admin: { label: "시스템관리자", color: "text-red-700", bgColor: "bg-red-100" },
  operator: { label: "운영자", color: "text-blue-700", bgColor: "bg-blue-100" },
  user: { label: "일반유저", color: "text-slate-700", bgColor: "bg-slate-100" },
};

const tierConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  bronze: { label: "브론즈", color: "text-amber-700", bgColor: "bg-amber-100" },
  silver: { label: "실버", color: "text-slate-600", bgColor: "bg-slate-100" },
  gold: { label: "골드", color: "text-yellow-600", bgColor: "bg-yellow-100" },
  platinum: { label: "플래티넘", color: "text-cyan-600", bgColor: "bg-cyan-100" },
  diamond: { label: "다이아몬드", color: "text-purple-600", bgColor: "bg-purple-100" },
};

export default function SystemAdminPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("users");
  
  // User management state
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [editFormData, setEditFormData] = useState<{
    role: string;
    tier: string;
    isActive: boolean;
    assignedCategoryId: string | null;
  }>({ role: "", tier: "", isActive: true, assignedCategoryId: null });
  const [resetPasswordUser, setResetPasswordUser] = useState<UserData | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Category management state
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [categoryFormData, setCategoryFormData] = useState<{
    name: string;
    description: string;
    order: number;
  }>({ name: "", description: "", order: 0 });
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  // System settings state
  const [settingsFormData, setSettingsFormData] = useState<Record<string, string>>({});
  const [hasSettingsChanges, setHasSettingsChanges] = useState(false);

  const { data: users = [], isLoading: usersLoading } = useQuery<UserData[]>({
    queryKey: ["/api/system-admin/users"],
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: systemSettings = [], isLoading: settingsLoading, refetch: refetchSettings } = useQuery<SystemSetting[]>({
    queryKey: ["/api/system-admin/settings"],
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      return await apiRequest("PATCH", `/api/system-admin/users/${id}`, updates);
    },
    onSuccess: () => {
      toast({
        title: "수정 완료",
        description: "사용자 정보가 성공적으로 수정되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/users"] });
      setEditingUser(null);
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "사용자 정보 수정에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, newPassword }: { id: string; newPassword: string }) => {
      return await apiRequest("POST", `/api/system-admin/users/${id}/reset-password`, { newPassword });
    },
    onSuccess: () => {
      toast({
        title: "비밀번호 재설정 완료",
        description: "임시 비밀번호가 설정되었습니다. 사용자에게 알려주세요.",
      });
      setResetPasswordUser(null);
      setNewPassword("");
      setShowPassword(false);
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "비밀번호 재설정에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; order: number }) => {
      return await apiRequest("POST", "/api/system-admin/categories", data);
    },
    onSuccess: () => {
      toast({
        title: "카테고리 생성 완료",
        description: "새 카테고리가 추가되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setIsCreatingCategory(false);
      setCategoryFormData({ name: "", description: "", order: 0 });
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "카테고리 생성에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      return await apiRequest("PATCH", `/api/system-admin/categories/${id}`, updates);
    },
    onSuccess: () => {
      toast({
        title: "수정 완료",
        description: "카테고리가 수정되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingCategory(null);
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "카테고리 수정에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/system-admin/categories/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "삭제 완료",
        description: "카테고리가 삭제되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setDeletingCategory(null);
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error.message || "카테고리 삭제에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: { category: string; key: string; value: string; description?: string }[]) => {
      return await apiRequest("PUT", "/api/system-admin/settings/batch", { settings });
    },
    onSuccess: () => {
      toast({
        title: "저장 완료",
        description: "시스템 설정이 저장되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/settings"] });
      setHasSettingsChanges(false);
    },
    onError: (error: any) => {
      toast({
        title: "저장 실패",
        description: error.message || "시스템 설정 저장에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // Initialize settings form data when settings are loaded
  const initializeSettingsForm = () => {
    const formData: Record<string, string> = {};
    
    // First, set default values
    DEFAULT_SETTINGS.forEach(setting => {
      formData[`${setting.category}.${setting.key}`] = setting.value;
    });
    
    // Then, override with saved values from database
    systemSettings.forEach(setting => {
      formData[`${setting.category}.${setting.key}`] = setting.value;
    });
    
    setSettingsFormData(formData);
    setHasSettingsChanges(false);
  };

  const handleSettingChange = (category: string, key: string, value: string) => {
    setSettingsFormData(prev => ({
      ...prev,
      [`${category}.${key}`]: value,
    }));
    setHasSettingsChanges(true);
  };

  const handleSaveSettings = () => {
    const settings = Object.entries(settingsFormData).map(([fullKey, value]) => {
      const [category, key] = fullKey.split(".");
      const defaultSetting = DEFAULT_SETTINGS.find(s => s.category === category && s.key === key);
      return {
        category,
        key,
        value,
        description: defaultSetting?.description,
      };
    });
    saveSettingsMutation.mutate(settings);
  };

  const handleResetSettings = () => {
    initializeSettingsForm();
  };

  // Initialize settings form when data is loaded
  useEffect(() => {
    if (systemSettings.length > 0 || !settingsLoading) {
      initializeSettingsForm();
    }
  }, [systemSettings, settingsLoading]);

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    const matchesTier = tierFilter === "all" || user.tier === tierFilter;
    return matchesSearch && matchesRole && matchesTier;
  });

  const openEditUserDialog = (user: UserData) => {
    setEditingUser(user);
    setEditFormData({
      role: user.role,
      tier: user.tier,
      isActive: user.isActive,
      assignedCategoryId: user.assignedCategoryId || null,
    });
  };

  const handleSaveUser = () => {
    if (!editingUser) return;

    const updates: any = {};
    if (editFormData.role !== editingUser.role) updates.role = editFormData.role;
    if (editFormData.tier !== editingUser.tier) updates.tier = editFormData.tier;
    if (editFormData.isActive !== editingUser.isActive) updates.isActive = editFormData.isActive;
    if (editFormData.assignedCategoryId !== editingUser.assignedCategoryId) {
      updates.assignedCategoryId = editFormData.assignedCategoryId;
    }

    if (Object.keys(updates).length === 0) {
      toast({
        title: "알림",
        description: "변경된 내용이 없습니다.",
      });
      return;
    }

    updateUserMutation.mutate({ id: editingUser.id, updates });
  };

  const openEditCategoryDialog = (category: Category) => {
    setEditingCategory(category);
    setCategoryFormData({
      name: category.name,
      description: category.description || "",
      order: category.order,
    });
  };

  const handleSaveCategory = () => {
    if (isCreatingCategory) {
      createCategoryMutation.mutate(categoryFormData);
    } else if (editingCategory) {
      const updates: any = {};
      if (categoryFormData.name !== editingCategory.name) updates.name = categoryFormData.name;
      if (categoryFormData.description !== (editingCategory.description || "")) updates.description = categoryFormData.description;
      if (categoryFormData.order !== editingCategory.order) updates.order = categoryFormData.order;

      if (Object.keys(updates).length === 0) {
        toast({
          title: "알림",
          description: "변경된 내용이 없습니다.",
        });
        return;
      }

      updateCategoryMutation.mutate({ id: editingCategory.id, updates });
    }
  };

  const getCategoryName = (categoryId: string | null | undefined) => {
    if (!categoryId) return "-";
    const category = categories.find((c) => c.id === categoryId);
    return category?.name || "-";
  };

  const userStats = {
    total: users.length,
    admins: users.filter((u) => u.role === "admin").length,
    operators: users.filter((u) => u.role === "operator").length,
    activeUsers: users.filter((u) => u.isActive).length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        title="시스템 관리자"
        subtitle="사용자 계정, 권한 및 카테고리 관리"
        showBackButton
      />

      <div className="container mx-auto p-6 space-y-6" data-testid="system-admin-page">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="users" className="flex items-center gap-2" data-testid="tab-users">
              <Users className="h-4 w-4" />
              사용자 관리
            </TabsTrigger>
            <TabsTrigger value="categories" className="flex items-center gap-2" data-testid="tab-categories">
              <FolderTree className="h-4 w-4" />
              카테고리 관리
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2" data-testid="tab-settings">
              <Settings className="h-4 w-4" />
              시스템 설정
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card data-testid="card-total-users">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">전체 사용자</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.total}</div>
                </CardContent>
              </Card>

              <Card data-testid="card-admin-count">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">시스템 관리자</CardTitle>
                  <Shield className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.admins}</div>
                </CardContent>
              </Card>

              <Card data-testid="card-operator-count">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">운영자</CardTitle>
                  <UserCog className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.operators}</div>
                </CardContent>
              </Card>

              <Card data-testid="card-active-users">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">활성 사용자</CardTitle>
                  <User className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.activeUsers}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>사용자 관리</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4 mb-6">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="이름 또는 이메일로 검색"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                      data-testid="input-search"
                    />
                  </div>

                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[150px]" data-testid="select-role-filter">
                      <SelectValue placeholder="역할 필터" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">모든 역할</SelectItem>
                      <SelectItem value="admin">시스템관리자</SelectItem>
                      <SelectItem value="operator">운영자</SelectItem>
                      <SelectItem value="user">일반유저</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={tierFilter} onValueChange={setTierFilter}>
                    <SelectTrigger className="w-[150px]" data-testid="select-tier-filter">
                      <SelectValue placeholder="등급 필터" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">모든 등급</SelectItem>
                      <SelectItem value="bronze">브론즈</SelectItem>
                      <SelectItem value="silver">실버</SelectItem>
                      <SelectItem value="gold">골드</SelectItem>
                      <SelectItem value="platinum">플래티넘</SelectItem>
                      <SelectItem value="diamond">다이아몬드</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {usersLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[60px]">프로필</TableHead>
                          <TableHead>이름</TableHead>
                          <TableHead>이메일</TableHead>
                          <TableHead>역할</TableHead>
                          <TableHead>담당 카테고리</TableHead>
                          <TableHead>등급</TableHead>
                          <TableHead>상태</TableHead>
                          <TableHead>최근 접속</TableHead>
                          <TableHead className="w-[120px]">관리</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                              검색 결과가 없습니다.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredUsers.map((user) => (
                            <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                              <TableCell>
                                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden">
                                  {user.profileImage ? (
                                    <img
                                      src={user.profileImage}
                                      alt={user.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <User className="w-5 h-5 text-slate-400" />
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="font-medium">{user.name}</TableCell>
                              <TableCell className="text-muted-foreground">{user.email}</TableCell>
                              <TableCell>
                                <Badge
                                  className={`${roleConfig[user.role]?.bgColor} ${roleConfig[user.role]?.color}`}
                                >
                                  {roleConfig[user.role]?.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">
                                {user.role === "operator" ? (
                                  <Badge variant="outline" className="bg-slate-50">
                                    {getCategoryName(user.assignedCategoryId)}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  className={`${tierConfig[user.tier]?.bgColor} ${tierConfig[user.tier]?.color}`}
                                >
                                  {tierConfig[user.tier]?.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={user.isActive ? "default" : "secondary"}
                                  className={user.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}
                                >
                                  {user.isActive ? "활성" : "비활성"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {user.lastLoginAt
                                  ? format(new Date(user.lastLoginAt), "MM/dd HH:mm", { locale: ko })
                                  : "-"}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openEditUserDialog(user)}
                                    data-testid={`button-edit-${user.id}`}
                                  >
                                    수정
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setResetPasswordUser(user)}
                                    data-testid={`button-reset-password-${user.id}`}
                                    title="비밀번호 재설정"
                                  >
                                    <KeyRound className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="categories" className="space-y-6 mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>카테고리 관리</CardTitle>
                <Button
                  onClick={() => {
                    setIsCreatingCategory(true);
                    setCategoryFormData({ name: "", description: "", order: categories.length });
                  }}
                  data-testid="button-add-category"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  카테고리 추가
                </Button>
              </CardHeader>
              <CardContent>
                {categoriesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : categories.length === 0 ? (
                  <div className="text-center py-12">
                    <FolderTree className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">등록된 카테고리가 없습니다.</p>
                    <p className="text-sm text-muted-foreground mt-1">새 카테고리를 추가해주세요.</p>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50px]">순서</TableHead>
                          <TableHead>카테고리명</TableHead>
                          <TableHead>설명</TableHead>
                          <TableHead>시나리오 수</TableHead>
                          <TableHead>담당 운영자</TableHead>
                          <TableHead className="w-[120px]">관리</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {categories.map((category) => {
                          const assignedOperators = users.filter(
                            (u) => u.role === "operator" && u.assignedCategoryId === category.id
                          );
                          return (
                            <TableRow key={category.id} data-testid={`row-category-${category.id}`}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                                  <span>{category.order + 1}</span>
                                </div>
                              </TableCell>
                              <TableCell className="font-medium">{category.name}</TableCell>
                              <TableCell className="text-muted-foreground max-w-[200px] truncate">
                                {category.description || "-"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">{category.scenarioCount ?? 0}</Badge>
                              </TableCell>
                              <TableCell>
                                {assignedOperators.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {assignedOperators.slice(0, 2).map((op) => (
                                      <Badge key={op.id} variant="outline" className="text-xs">
                                        {op.name}
                                      </Badge>
                                    ))}
                                    {assignedOperators.length > 2 && (
                                      <Badge variant="outline" className="text-xs">
                                        +{assignedOperators.length - 2}
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-sm">-</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openEditCategoryDialog(category)}
                                    data-testid={`button-edit-category-${category.id}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDeletingCategory(category)}
                                    data-testid={`button-delete-category-${category.id}`}
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-6 mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>시스템 설정</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    AI 모델, 평가 기준, 대화 및 음성 설정을 관리합니다.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleResetSettings}
                    disabled={!hasSettingsChanges || saveSettingsMutation.isPending}
                    data-testid="button-reset-settings"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    초기화
                  </Button>
                  <Button
                    onClick={handleSaveSettings}
                    disabled={!hasSettingsChanges || saveSettingsMutation.isPending}
                    data-testid="button-save-settings"
                  >
                    {saveSettingsMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        저장 중...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        저장
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {settingsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-8">
                    {Object.entries(SETTING_CATEGORIES).map(([categoryKey, categoryInfo]) => (
                      <div key={categoryKey} className="space-y-4">
                        <div className="border-b pb-2">
                          <h3 className="font-semibold text-lg">{categoryInfo.label}</h3>
                          <p className="text-sm text-muted-foreground">{categoryInfo.description}</p>
                        </div>
                        <div className="grid gap-4">
                          {DEFAULT_SETTINGS.filter(s => s.category === categoryKey).map(setting => (
                            <div key={`${setting.category}-${setting.key}`} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start p-4 bg-slate-50 rounded-lg">
                              <div className="space-y-1">
                                <label className="text-sm font-medium">{setting.key}</label>
                                <p className="text-xs text-muted-foreground">{setting.description}</p>
                              </div>
                              <div className="md:col-span-2">
                                <Input
                                  value={settingsFormData[`${setting.category}.${setting.key}`] || setting.value}
                                  onChange={(e) => handleSettingChange(setting.category, setting.key, e.target.value)}
                                  data-testid={`input-setting-${setting.category}-${setting.key}`}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {hasSettingsChanges && (
              <div className="fixed bottom-6 right-6 bg-amber-100 text-amber-800 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
                <span className="text-sm">저장되지 않은 변경사항이 있습니다.</span>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* User Edit Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent data-testid="dialog-edit-user">
          <DialogHeader>
            <DialogTitle>사용자 정보 수정</DialogTitle>
            <DialogDescription>
              {editingUser?.name} ({editingUser?.email})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">역할</label>
              <Select
                value={editFormData.role}
                onValueChange={(value) => setEditFormData((prev) => ({ ...prev, role: value }))}
              >
                <SelectTrigger data-testid="select-edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">시스템관리자</SelectItem>
                  <SelectItem value="operator">운영자</SelectItem>
                  <SelectItem value="user">일반유저</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editFormData.role === "operator" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">담당 카테고리</label>
                <Select
                  value={editFormData.assignedCategoryId || "none"}
                  onValueChange={(value) =>
                    setEditFormData((prev) => ({
                      ...prev,
                      assignedCategoryId: value === "none" ? null : value,
                    }))
                  }
                >
                  <SelectTrigger data-testid="select-edit-category">
                    <SelectValue placeholder="카테고리 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">카테고리 없음</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  운영자는 담당 카테고리 내에서만 시나리오를 관리할 수 있습니다.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">등급</label>
              <Select
                value={editFormData.tier}
                onValueChange={(value) => setEditFormData((prev) => ({ ...prev, tier: value }))}
              >
                <SelectTrigger data-testid="select-edit-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bronze">브론즈</SelectItem>
                  <SelectItem value="silver">실버</SelectItem>
                  <SelectItem value="gold">골드</SelectItem>
                  <SelectItem value="platinum">플래티넘</SelectItem>
                  <SelectItem value="diamond">다이아몬드</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <label className="text-sm font-medium">계정 상태</label>
                <p className="text-sm text-muted-foreground">
                  비활성화하면 로그인이 차단됩니다
                </p>
              </div>
              <Switch
                checked={editFormData.isActive}
                onCheckedChange={(checked) =>
                  setEditFormData((prev) => ({ ...prev, isActive: checked }))
                }
                data-testid="switch-edit-active"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)} data-testid="button-cancel-edit">
              취소
            </Button>
            <Button
              onClick={handleSaveUser}
              disabled={updateUserMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateUserMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  저장 중...
                </>
              ) : (
                "저장"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Reset Dialog */}
      <Dialog open={!!resetPasswordUser} onOpenChange={(open) => {
        if (!open) {
          setResetPasswordUser(null);
          setNewPassword("");
          setShowPassword(false);
        }
      }}>
        <DialogContent data-testid="dialog-reset-password">
          <DialogHeader>
            <DialogTitle>비밀번호 재설정</DialogTitle>
            <DialogDescription>
              {resetPasswordUser?.name} ({resetPasswordUser?.email})의 새 비밀번호를 설정합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">새 비밀번호</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="6자 이상 입력"
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                임시 비밀번호 설정 후 사용자에게 직접 알려주세요.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResetPasswordUser(null);
                setNewPassword("");
                setShowPassword(false);
              }}
              data-testid="button-cancel-reset"
            >
              취소
            </Button>
            <Button
              onClick={() => {
                if (resetPasswordUser && newPassword.length >= 6) {
                  resetPasswordMutation.mutate({ id: resetPasswordUser.id, newPassword });
                }
              }}
              disabled={resetPasswordMutation.isPending || newPassword.length < 6}
              data-testid="button-confirm-reset"
            >
              {resetPasswordMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  재설정 중...
                </>
              ) : (
                "비밀번호 재설정"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Create/Edit Dialog */}
      <Dialog
        open={isCreatingCategory || !!editingCategory}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreatingCategory(false);
            setEditingCategory(null);
            setCategoryFormData({ name: "", description: "", order: 0 });
          }
        }}
      >
        <DialogContent data-testid="dialog-category">
          <DialogHeader>
            <DialogTitle>
              {isCreatingCategory ? "새 카테고리 추가" : "카테고리 수정"}
            </DialogTitle>
            <DialogDescription>
              {isCreatingCategory
                ? "시나리오를 분류할 새 카테고리를 추가합니다."
                : `${editingCategory?.name} 카테고리 정보를 수정합니다.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">카테고리명 *</label>
              <Input
                value={categoryFormData.name}
                onChange={(e) => setCategoryFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="예: 온보딩, 리더십"
                data-testid="input-category-name"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">설명</label>
              <Textarea
                value={categoryFormData.description}
                onChange={(e) => setCategoryFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="카테고리에 대한 간단한 설명"
                rows={3}
                data-testid="input-category-description"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">정렬 순서</label>
              <Input
                type="number"
                value={categoryFormData.order}
                onChange={(e) => setCategoryFormData((prev) => ({ ...prev, order: parseInt(e.target.value) || 0 }))}
                min={0}
                data-testid="input-category-order"
              />
              <p className="text-xs text-muted-foreground">
                낮은 숫자가 먼저 표시됩니다.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreatingCategory(false);
                setEditingCategory(null);
                setCategoryFormData({ name: "", description: "", order: 0 });
              }}
              data-testid="button-cancel-category"
            >
              취소
            </Button>
            <Button
              onClick={handleSaveCategory}
              disabled={
                !categoryFormData.name.trim() ||
                createCategoryMutation.isPending ||
                updateCategoryMutation.isPending
              }
              data-testid="button-save-category"
            >
              {(createCategoryMutation.isPending || updateCategoryMutation.isPending) ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  저장 중...
                </>
              ) : isCreatingCategory ? (
                "추가"
              ) : (
                "저장"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Delete Confirmation Dialog */}
      <Dialog open={!!deletingCategory} onOpenChange={(open) => !open && setDeletingCategory(null)}>
        <DialogContent data-testid="dialog-delete-category">
          <DialogHeader>
            <DialogTitle>카테고리 삭제</DialogTitle>
            <DialogDescription>
              "{deletingCategory?.name}" 카테고리를 삭제하시겠습니까?
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              이 카테고리에 연결된 시나리오나 담당 운영자가 있으면 삭제할 수 없습니다.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingCategory(null)} data-testid="button-cancel-delete">
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingCategory && deleteCategoryMutation.mutate(deletingCategory.id)}
              disabled={deleteCategoryMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteCategoryMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  삭제 중...
                </>
              ) : (
                "삭제"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
