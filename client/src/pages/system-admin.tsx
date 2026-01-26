import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
import { Search, Users, Shield, UserCog, Loader2, User, KeyRound, Eye, EyeOff, FolderTree, Plus, Pencil, Trash2, GripVertical, Settings, Save, CheckCircle, XCircle, ExternalLink, Activity, DollarSign, Zap, TrendingUp, Calendar, RefreshCw, Languages, Building2 } from "lucide-react";
import { LanguageManager } from "@/components/LanguageManager";
import { HierarchyTreeManager } from "@/components/HierarchyTreeManager";
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

interface AiUsageSummary {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

interface AiUsageByFeature {
  feature: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

interface AiUsageByModel {
  model: string;
  provider: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

interface AiUsageDaily {
  date: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

const AI_MODELS = [
  { 
    value: "gemini-2.0-flash-exp", 
    modelKey: "gemini20flashexp",
    provider: "Google",
    recommended: false
  },
  { 
    value: "gemini-2.5-flash", 
    modelKey: "gemini25flash",
    provider: "Google",
    recommended: true
  },
  { 
    value: "gemini-2.5-pro", 
    modelKey: "gemini25pro",
    provider: "Google",
    recommended: false
  },
  { 
    value: "gpt-4o", 
    modelKey: "gpt4o",
    provider: "OpenAI",
    recommended: false
  },
  { 
    value: "gpt-4o-mini", 
    modelKey: "gpt4omini",
    provider: "OpenAI",
    recommended: false
  },
];

const GEMINI_LIVE_MODELS = [
  { 
    value: "gemini-2.5-flash-native-audio-preview-09-2025", 
    modelKey: "geminiLiveNativeAudio",
    provider: "Google Live",
    recommended: true
  },
];

const FEATURE_MODEL_INFO = [
  {
    id: "conversation",
    settingKey: "model_conversation",
    defaultModel: "gemini-2.5-flash",
    configurable: true,
    supportedProviders: ["Google", "OpenAI"]
  },
  {
    id: "feedback",
    settingKey: "model_feedback",
    defaultModel: "gemini-2.5-flash",
    configurable: true,
    supportedProviders: ["Google", "OpenAI"]
  },
  {
    id: "strategy",
    settingKey: "model_strategy",
    defaultModel: "gemini-2.5-flash",
    configurable: true,
    supportedProviders: ["Google"]
  },
  {
    id: "scenario",
    settingKey: "model_scenario",
    defaultModel: "gemini-2.5-flash",
    configurable: true,
    supportedProviders: ["Google"]
  },
  {
    id: "realtime",
    settingKey: "model_realtime",
    defaultModel: "gemini-2.5-flash-native-audio-preview-09-2025",
    configurable: true,
    supportedProviders: ["Google Live"]
  },
  {
    id: "emotion",
    settingKey: "model_emotion",
    defaultModel: "gemini-2.0-flash-exp",
    configurable: true,
    supportedProviders: ["Google"]
  },
  {
    id: "image",
    fixedModelKey: "geminiFlashImage",
    configurable: false
  },
  {
    id: "video",
    fixedModelKey: "geminiVeo31",
    configurable: false
  }
];

interface ApiKeyStatus {
  gemini: boolean;
  openai: boolean;
  elevenlabs: boolean;
}

const roleColorConfig: Record<string, { color: string; bgColor: string }> = {
  admin: { color: "text-red-700", bgColor: "bg-red-100" },
  operator: { color: "text-blue-700", bgColor: "bg-blue-100" },
  user: { color: "text-slate-700", bgColor: "bg-slate-100" },
};

const tierColorConfig: Record<string, { color: string; bgColor: string }> = {
  bronze: { color: "text-amber-700", bgColor: "bg-amber-100" },
  silver: { color: "text-slate-600", bgColor: "bg-slate-100" },
  gold: { color: "text-yellow-600", bgColor: "bg-yellow-100" },
  platinum: { color: "text-cyan-600", bgColor: "bg-cyan-100" },
  diamond: { color: "text-purple-600", bgColor: "bg-purple-100" },
};

export default function SystemAdminPage() {
  const { t, i18n } = useTranslation();
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

  // System settings state - per-feature model selection
  const [featureModels, setFeatureModels] = useState<Record<string, string>>({
    model_conversation: "gemini-2.5-flash",
    model_feedback: "gemini-2.5-flash",
    model_strategy: "gemini-2.5-flash",
    model_scenario: "gemini-2.5-flash",
    model_realtime: "gemini-2.5-flash-native-audio-preview-09-2025",
    model_emotion: "gemini-2.0-flash-exp",
  });
  const [hasSettingsChanges, setHasSettingsChanges] = useState(false);

  const { data: users = [], isLoading: usersLoading } = useQuery<UserData[]>({
    queryKey: ["/api/system-admin/users"],
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: systemSettings = [], isLoading: settingsLoading } = useQuery<SystemSetting[]>({
    queryKey: ["/api/system-admin/settings"],
  });

  const { data: apiKeyStatus, isLoading: apiKeyStatusLoading } = useQuery<ApiKeyStatus>({
    queryKey: ["/api/system-admin/api-keys-status"],
  });

  // AI Usage state and queries
  const [usageDateRange, setUsageDateRange] = useState(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
    return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
  });

  const { data: usageSummary, isLoading: usageSummaryLoading, refetch: refetchSummary } = useQuery<AiUsageSummary>({
    queryKey: ["/api/system-admin/ai-usage/summary", usageDateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: usageDateRange.start,
        endDate: usageDateRange.end,
      });
      const res = await fetch(`/api/system-admin/ai-usage/summary?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to fetch usage summary');
      return res.json();
    },
    enabled: activeTab === 'ai-usage',
    staleTime: 30 * 1000, // 30 seconds
  });

  const { data: usageByFeature = [], isLoading: usageByFeatureLoading, refetch: refetchByFeature } = useQuery<AiUsageByFeature[]>({
    queryKey: ["/api/system-admin/ai-usage/by-feature", usageDateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: usageDateRange.start,
        endDate: usageDateRange.end,
      });
      const res = await fetch(`/api/system-admin/ai-usage/by-feature?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to fetch usage by feature');
      return res.json();
    },
    enabled: activeTab === 'ai-usage',
    staleTime: 30 * 1000, // 30 seconds
  });

  const { data: usageByModel = [], isLoading: usageByModelLoading, refetch: refetchByModel } = useQuery<AiUsageByModel[]>({
    queryKey: ["/api/system-admin/ai-usage/by-model", usageDateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: usageDateRange.start,
        endDate: usageDateRange.end,
      });
      const res = await fetch(`/api/system-admin/ai-usage/by-model?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to fetch usage by model');
      return res.json();
    },
    enabled: activeTab === 'ai-usage',
    staleTime: 30 * 1000, // 30 seconds
  });

  const { data: dailyUsage = [], isLoading: dailyUsageLoading, refetch: refetchDaily } = useQuery<AiUsageDaily[]>({
    queryKey: ["/api/system-admin/ai-usage/daily", usageDateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: usageDateRange.start,
        endDate: usageDateRange.end,
      });
      const res = await fetch(`/api/system-admin/ai-usage/daily?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('authToken')}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to fetch daily usage');
      return res.json();
    },
    enabled: activeTab === 'ai-usage',
    staleTime: 30 * 1000, // 30 seconds
  });

  // 모든 AI 사용량 데이터 새로고침
  const refetchAllUsageData = () => {
    refetchSummary();
    refetchByFeature();
    refetchByModel();
    refetchDaily();
  };

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      return await apiRequest("PATCH", `/api/system-admin/users/${id}`, updates);
    },
    onSuccess: () => {
      toast({
        title: t('systemAdmin.toast.updateSuccess'),
        description: t('systemAdmin.toast.updateSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/users"] });
      setEditingUser(null);
    },
    onError: (error: any) => {
      toast({
        title: t('systemAdmin.toast.error'),
        description: error.message || t('systemAdmin.toast.updateFailed'),
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
        title: t('systemAdmin.toast.passwordResetSuccess'),
        description: t('systemAdmin.toast.passwordResetSuccessDesc'),
      });
      setResetPasswordUser(null);
      setNewPassword("");
      setShowPassword(false);
    },
    onError: (error: any) => {
      toast({
        title: t('systemAdmin.toast.error'),
        description: error.message || t('systemAdmin.toast.passwordResetFailed'),
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
        title: t('systemAdmin.toast.categoryCreateSuccess'),
        description: t('systemAdmin.toast.categoryCreateSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setIsCreatingCategory(false);
      setCategoryFormData({ name: "", description: "", order: 0 });
    },
    onError: (error: any) => {
      toast({
        title: t('systemAdmin.toast.error'),
        description: error.message || t('systemAdmin.toast.categoryCreateFailed'),
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
        title: t('systemAdmin.toast.categoryUpdateSuccess'),
        description: t('systemAdmin.toast.categoryUpdateSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setEditingCategory(null);
    },
    onError: (error: any) => {
      toast({
        title: t('systemAdmin.toast.error'),
        description: error.message || t('systemAdmin.toast.categoryUpdateFailed'),
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
        title: t('systemAdmin.toast.categoryDeleteSuccess'),
        description: t('systemAdmin.toast.categoryDeleteSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      setDeletingCategory(null);
    },
    onError: (error: any) => {
      toast({
        title: t('systemAdmin.toast.categoryDeleteFailed'),
        description: error.message || t('systemAdmin.toast.categoryDeleteFailedDesc'),
        variant: "destructive",
      });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: { category: string; key: string; value: string; description?: string }[]) => {
      const results = [];
      for (const setting of settings) {
        const result = await apiRequest("PUT", "/api/system-admin/settings", setting);
        results.push(result);
      }
      return results;
    },
    onSuccess: () => {
      toast({
        title: t('systemAdmin.settings.saveSuccess'),
        description: t('systemAdmin.settings.saveSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/settings"] });
      setHasSettingsChanges(false);
    },
    onError: (error: any) => {
      toast({
        title: t('systemAdmin.settings.saveFailed'),
        description: error.message || t('systemAdmin.settings.saveFailedDesc'),
        variant: "destructive",
      });
    },
  });

  const handleFeatureModelChange = (settingKey: string, value: string) => {
    setFeatureModels(prev => ({ ...prev, [settingKey]: value }));
    setHasSettingsChanges(true);
  };

  const handleSaveSettings = () => {
    for (const [key, value] of Object.entries(featureModels)) {
      const modelInfo = AI_MODELS.find(m => m.value === value);
      if (modelInfo && 'disabled' in modelInfo && modelInfo.disabled) {
        toast({
          title: t('systemAdmin.settings.cannotSave'),
          description: t('systemAdmin.settings.unsupportedModel'),
          variant: "destructive",
        });
        return;
      }
    }

    const settings = Object.entries(featureModels).map(([key, value]) => ({
      category: "ai",
      key,
      value,
      description: "",
    }));

    saveSettingsMutation.mutate(settings);
  };

  // Initialize models from saved settings
  useEffect(() => {
    const newFeatureModels: Record<string, string> = { ...featureModels };
    let hasChanges = false;
    
    FEATURE_MODEL_INFO.filter(f => f.configurable && 'settingKey' in f).forEach(feature => {
      const saved = systemSettings.find(s => s.category === "ai" && s.key === feature.settingKey);
      if (saved && saved.value !== newFeatureModels[feature.settingKey!]) {
        newFeatureModels[feature.settingKey!] = saved.value;
        hasChanges = true;
      }
    });
    
    if (hasChanges) {
      setFeatureModels(newFeatureModels);
    }
    setHasSettingsChanges(false);
  }, [systemSettings]);

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
        title: t('systemAdmin.toast.noChanges'),
        description: t('systemAdmin.toast.noChangesDesc'),
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
          title: t('systemAdmin.toast.noChanges'),
          description: t('systemAdmin.toast.noChangesDesc'),
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
        title={t('systemAdmin.title')}
        subtitle={t('systemAdmin.subtitle')}
        showBackButton
      />

      <div className="container mx-auto p-6 space-y-6" data-testid="system-admin-page">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-5xl grid-cols-6">
            <TabsTrigger value="users" className="flex items-center gap-2" data-testid="tab-users">
              <Users className="h-4 w-4" />
              {t('systemAdmin.tabs.users')}
            </TabsTrigger>
            <TabsTrigger value="companies" className="flex items-center gap-2" data-testid="tab-companies">
              <FolderTree className="h-4 w-4" />
              {t('systemAdmin.tabs.hierarchy', '조직 구조')}
            </TabsTrigger>
            <TabsTrigger value="categories" className="flex items-center gap-2" data-testid="tab-categories">
              <FolderTree className="h-4 w-4" />
              {t('systemAdmin.tabs.categories')}
            </TabsTrigger>
            <TabsTrigger value="languages" className="flex items-center gap-2" data-testid="tab-languages">
              <Languages className="h-4 w-4" />
              {t('systemAdmin.tabs.languages')}
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2" data-testid="tab-settings">
              <Settings className="h-4 w-4" />
              {t('systemAdmin.tabs.settings')}
            </TabsTrigger>
            <TabsTrigger value="ai-usage" className="flex items-center gap-2" data-testid="tab-ai-usage">
              <Activity className="h-4 w-4" />
              {t('systemAdmin.tabs.aiUsage')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card data-testid="card-total-users">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('systemAdmin.users.total')}</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.total}</div>
                </CardContent>
              </Card>

              <Card data-testid="card-admin-count">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('systemAdmin.users.admins')}</CardTitle>
                  <Shield className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.admins}</div>
                </CardContent>
              </Card>

              <Card data-testid="card-operator-count">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('systemAdmin.users.operators')}</CardTitle>
                  <UserCog className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.operators}</div>
                </CardContent>
              </Card>

              <Card data-testid="card-active-users">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('systemAdmin.users.activeUsers')}</CardTitle>
                  <User className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{userStats.activeUsers}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('systemAdmin.users.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4 mb-6">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t('systemAdmin.users.searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                      data-testid="input-search"
                    />
                  </div>

                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-[150px]" data-testid="select-role-filter">
                      <SelectValue placeholder={t('systemAdmin.users.roleFilter')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('systemAdmin.users.allRoles')}</SelectItem>
                      <SelectItem value="admin">{t('systemAdmin.roles.admin')}</SelectItem>
                      <SelectItem value="operator">{t('systemAdmin.roles.operator')}</SelectItem>
                      <SelectItem value="user">{t('systemAdmin.roles.user')}</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={tierFilter} onValueChange={setTierFilter}>
                    <SelectTrigger className="w-[150px]" data-testid="select-tier-filter">
                      <SelectValue placeholder={t('systemAdmin.users.tierFilter')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('systemAdmin.users.allTiers')}</SelectItem>
                      <SelectItem value="bronze">{t('systemAdmin.tiers.bronze')}</SelectItem>
                      <SelectItem value="silver">{t('systemAdmin.tiers.silver')}</SelectItem>
                      <SelectItem value="gold">{t('systemAdmin.tiers.gold')}</SelectItem>
                      <SelectItem value="platinum">{t('systemAdmin.tiers.platinum')}</SelectItem>
                      <SelectItem value="diamond">{t('systemAdmin.tiers.diamond')}</SelectItem>
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
                          <TableHead className="w-[60px]">{t('systemAdmin.users.table.profile')}</TableHead>
                          <TableHead>{t('systemAdmin.users.table.name')}</TableHead>
                          <TableHead>{t('systemAdmin.users.table.email')}</TableHead>
                          <TableHead>{t('systemAdmin.users.table.role')}</TableHead>
                          <TableHead>{t('systemAdmin.users.table.category')}</TableHead>
                          <TableHead>{t('systemAdmin.users.table.tier')}</TableHead>
                          <TableHead>{t('systemAdmin.users.table.status')}</TableHead>
                          <TableHead>{t('systemAdmin.users.table.lastLogin')}</TableHead>
                          <TableHead className="w-[120px]">{t('systemAdmin.users.table.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                              {t('systemAdmin.users.noResults')}
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
                                  className={`${roleColorConfig[user.role]?.bgColor} ${roleColorConfig[user.role]?.color}`}
                                >
                                  {t(`systemAdmin.roles.${user.role}`)}
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
                                  className={`${tierColorConfig[user.tier]?.bgColor} ${tierColorConfig[user.tier]?.color}`}
                                >
                                  {t(`systemAdmin.tiers.${user.tier}`)}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={user.isActive ? "default" : "secondary"}
                                  className={user.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}
                                >
                                  {user.isActive ? t('systemAdmin.users.active') : t('systemAdmin.users.inactive')}
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
                                    {t('systemAdmin.users.edit')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setResetPasswordUser(user)}
                                    data-testid={`button-reset-password-${user.id}`}
                                    title={t('systemAdmin.users.resetPassword')}
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

          <TabsContent value="companies" className="space-y-6 mt-6">
            <HierarchyTreeManager />
          </TabsContent>

          <TabsContent value="categories" className="space-y-6 mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t('systemAdmin.categories.title')}</CardTitle>
                <Button
                  onClick={() => {
                    setIsCreatingCategory(true);
                    setCategoryFormData({ name: "", description: "", order: categories.length });
                  }}
                  data-testid="button-add-category"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('systemAdmin.categories.add')}
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
                    <p className="text-muted-foreground">{t('systemAdmin.categories.empty')}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t('systemAdmin.categories.addFirst')}</p>
                  </div>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[50px]">{t('systemAdmin.categories.table.order')}</TableHead>
                          <TableHead>{t('systemAdmin.categories.table.name')}</TableHead>
                          <TableHead>{t('systemAdmin.categories.table.description')}</TableHead>
                          <TableHead>{t('systemAdmin.categories.table.scenarioCount')}</TableHead>
                          <TableHead>{t('systemAdmin.categories.table.assignedOperators')}</TableHead>
                          <TableHead className="w-[120px]">{t('systemAdmin.categories.table.actions')}</TableHead>
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

          <TabsContent value="languages" className="space-y-6 mt-6">
            <LanguageManager />
          </TabsContent>

          <TabsContent value="settings" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('systemAdmin.settings.aiModelStatus')}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t('systemAdmin.settings.aiModelStatusDesc')}
                </p>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('systemAdmin.settings.table.feature')}</TableHead>
                        <TableHead>{t('systemAdmin.settings.table.description')}</TableHead>
                        <TableHead>{t('systemAdmin.settings.table.model')}</TableHead>
                        <TableHead className="text-center">{t('systemAdmin.settings.table.configurable')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {FEATURE_MODEL_INFO.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{t(`systemAdmin.features.${item.id}.name`)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{t(`systemAdmin.features.${item.id}.description`)}</TableCell>
                          <TableCell>
                            {item.configurable && 'settingKey' in item ? (
                              <Badge variant="outline" className="text-blue-600 border-blue-200">
                                {(() => {
                                  const selectedModel = AI_MODELS.find(m => m.value === featureModels[item.settingKey!]);
                                  return selectedModel ? t(`systemAdmin.models.${selectedModel.modelKey}.label`) : item.defaultModel;
                                })()}
                              </Badge>
                            ) : (
                              <span className="text-sm text-gray-600">{t(`systemAdmin.models.${item.fixedModelKey}.label`)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.configurable ? (
                              <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                            ) : (
                              <XCircle className="h-4 w-4 text-gray-400 mx-auto" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('systemAdmin.settings.aiModelConfig')}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t('systemAdmin.settings.aiModelConfigDesc')}
                </p>
              </CardHeader>
              <CardContent>
                {settingsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    {FEATURE_MODEL_INFO.filter(f => f.configurable && 'settingKey' in f).map((feature) => {
                      const supportedProviders: string[] = 'supportedProviders' in feature && feature.supportedProviders ? feature.supportedProviders : [];
                      const modelsToShow = feature.id === 'realtime' ? GEMINI_LIVE_MODELS : AI_MODELS;
                      
                      return (
                      <div key={feature.id} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-base">{t(`systemAdmin.features.${feature.id}.name`)}</h4>
                          <Badge variant="secondary" className="text-xs">{t(`systemAdmin.features.${feature.id}.description`)}</Badge>
                          {supportedProviders.length === 1 && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                              {t('systemAdmin.settings.onlySupported', { provider: supportedProviders[0] })}
                            </Badge>
                          )}
                        </div>
                        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4">
                          {modelsToShow.map((model) => {
                            const isProviderSupported = supportedProviders.length === 0 || supportedProviders.includes(model.provider);
                            const isModelDisabled = 'disabled' in model && model.disabled;
                            const isDisabled = isModelDisabled || !isProviderSupported;
                            const isSelected = featureModels[feature.settingKey!] === model.value;
                            
                            return (
                              <div
                                key={model.value}
                                className={`p-3 border rounded-lg transition-colors ${
                                  isDisabled 
                                    ? "border-gray-200 bg-gray-50 cursor-not-allowed opacity-60 pointer-events-none"
                                    : isSelected
                                      ? "border-blue-500 bg-blue-50 cursor-pointer"
                                      : "border-gray-200 hover:border-gray-300 cursor-pointer"
                                }`}
                                onClick={() => !isDisabled && handleFeatureModelChange(feature.settingKey!, model.value)}
                                data-testid={`model-option-${feature.id}-${model.value}`}
                                aria-disabled={isDisabled ? true : undefined}
                              >
                                <div className="flex items-start gap-2">
                                  <div className={`w-4 h-4 mt-0.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                    isDisabled 
                                      ? "border-gray-300"
                                      : isSelected 
                                        ? "border-blue-500" 
                                        : "border-gray-300"
                                  }`}>
                                    {isSelected && !isDisabled && (
                                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="font-medium text-sm">{t(`systemAdmin.models.${model.modelKey}.label`)}</span>
                                      {'recommended' in model && model.recommended && (
                                        <Badge className="text-[10px] px-1 py-0 bg-green-100 text-green-700 hover:bg-green-100">{t('systemAdmin.settings.recommended')}</Badge>
                                      )}
                                      {Boolean(isModelDisabled) && (
                                        <Badge variant="secondary" className="text-[10px] px-1 py-0">{t('systemAdmin.settings.preparing')}</Badge>
                                      )}
                                      {!isProviderSupported && !isModelDisabled && (
                                        <Badge variant="outline" className="text-[10px] px-1 py-0 text-gray-500">{t('systemAdmin.settings.unsupported')}</Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{t(`systemAdmin.models.${model.modelKey}.description`)}</p>
                                    <p className="text-[10px] text-blue-600 font-mono mt-1">{t(`systemAdmin.models.${model.modelKey}.pricing`)}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                    
                    <div className="pt-4 border-t">
                      <h4 className="font-medium text-sm text-muted-foreground mb-2">{t('systemAdmin.settings.fixedModels')}</h4>
                      <div className="grid gap-2 md:grid-cols-2">
                        {FEATURE_MODEL_INFO.filter(f => !f.configurable).map((feature) => (
                          <div key={feature.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <p className="font-medium text-sm">{t(`systemAdmin.features.${feature.id}.name`)}</p>
                              <p className="text-xs text-muted-foreground">{t(`systemAdmin.features.${feature.id}.description`)}</p>
                            </div>
                            <Badge variant="outline" className="text-gray-600">{t(`systemAdmin.models.${feature.fixedModelKey}.label`)}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 pt-4 border-t">
                      <Button
                        onClick={handleSaveSettings}
                        disabled={!hasSettingsChanges || saveSettingsMutation.isPending}
                        data-testid="button-save-settings"
                      >
                        {saveSettingsMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {t('systemAdmin.settings.saving')}
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            {t('systemAdmin.settings.save')}
                          </>
                        )}
                      </Button>
                      {hasSettingsChanges && (
                        <span className="text-sm text-amber-600">{t('systemAdmin.settings.hasChanges')}</span>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('systemAdmin.settings.apiKeyStatus')}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t('systemAdmin.settings.apiKeyStatusDesc')}
                </p>
              </CardHeader>
              <CardContent>
                {apiKeyStatusLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {apiKeyStatus?.gemini ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                        <div>
                          <p className="font-medium">{t('systemAdmin.settings.geminiApi')}</p>
                          <p className="text-sm text-muted-foreground">{t('systemAdmin.settings.geminiApiDesc')}</p>
                        </div>
                      </div>
                      <Badge variant={apiKeyStatus?.gemini ? "default" : "destructive"}>
                        {apiKeyStatus?.gemini ? t('systemAdmin.settings.configured') : t('systemAdmin.settings.notConfigured')}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {apiKeyStatus?.openai ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                        <div>
                          <p className="font-medium">{t('systemAdmin.settings.openaiApi')}</p>
                          <p className="text-sm text-muted-foreground">{t('systemAdmin.settings.openaiApiDesc')}</p>
                        </div>
                      </div>
                      <Badge variant={apiKeyStatus?.openai ? "default" : "destructive"}>
                        {apiKeyStatus?.openai ? t('systemAdmin.settings.configured') : t('systemAdmin.settings.notConfigured')}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        {apiKeyStatus?.elevenlabs ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                        <div>
                          <p className="font-medium">{t('systemAdmin.settings.elevenlabsApi')}</p>
                          <p className="text-sm text-muted-foreground">{t('systemAdmin.settings.elevenlabsApiDesc')}</p>
                        </div>
                      </div>
                      <Badge variant={apiKeyStatus?.elevenlabs ? "default" : "destructive"}>
                        {apiKeyStatus?.elevenlabs ? t('systemAdmin.settings.configured') : t('systemAdmin.settings.notConfigured')}
                      </Badge>
                    </div>

                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-800">
                        {t('systemAdmin.settings.apiKeySecurityNote')}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai-usage" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  {t('systemAdmin.aiUsage.dateRange')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4 items-center">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">{t('systemAdmin.aiUsage.startDate')}</label>
                    <Input
                      type="date"
                      value={usageDateRange.start}
                      onChange={(e) => setUsageDateRange(prev => ({ ...prev, start: e.target.value }))}
                      className="w-40"
                      data-testid="input-usage-start-date"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium">{t('systemAdmin.aiUsage.endDate')}</label>
                    <Input
                      type="date"
                      value={usageDateRange.end}
                      onChange={(e) => setUsageDateRange(prev => ({ ...prev, end: e.target.value }))}
                      className="w-40"
                      data-testid="input-usage-end-date"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const end = new Date();
                        const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
                        setUsageDateRange({
                          start: start.toISOString().split('T')[0],
                          end: end.toISOString().split('T')[0]
                        });
                      }}
                      data-testid="button-usage-7days"
                    >
                      {t('systemAdmin.aiUsage.last7Days')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const end = new Date();
                        const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
                        setUsageDateRange({
                          start: start.toISOString().split('T')[0],
                          end: end.toISOString().split('T')[0]
                        });
                      }}
                      data-testid="button-usage-30days"
                    >
                      {t('systemAdmin.aiUsage.last30Days')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const end = new Date();
                        const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
                        setUsageDateRange({
                          start: start.toISOString().split('T')[0],
                          end: end.toISOString().split('T')[0]
                        });
                      }}
                      data-testid="button-usage-90days"
                    >
                      {t('systemAdmin.aiUsage.last90Days')}
                    </Button>
                  </div>
                  <div className="ml-auto">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={refetchAllUsageData}
                      disabled={usageSummaryLoading || usageByFeatureLoading || usageByModelLoading || dailyUsageLoading}
                      data-testid="button-refresh-usage"
                    >
                      <RefreshCw className={`h-4 w-4 mr-1 ${(usageSummaryLoading || usageByFeatureLoading || usageByModelLoading || dailyUsageLoading) ? 'animate-spin' : ''}`} />
                      {t('systemAdmin.aiUsage.refresh')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card data-testid="card-total-requests">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('systemAdmin.aiUsage.totalRequests')}</CardTitle>
                  <Zap className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  {usageSummaryLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <div className="text-2xl font-bold">{(usageSummary?.requestCount || 0).toLocaleString()}</div>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-total-tokens">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('systemAdmin.aiUsage.totalTokens')}</CardTitle>
                  <Activity className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  {usageSummaryLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <>
                      <div className="text-2xl font-bold">{((usageSummary?.totalTokens || 0) / 1000).toFixed(1)}K</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('systemAdmin.aiUsage.input')}: {((usageSummary?.promptTokens || 0) / 1000).toFixed(1)}K / {t('systemAdmin.aiUsage.output')}: {((usageSummary?.completionTokens || 0) / 1000).toFixed(1)}K
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-total-cost">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('systemAdmin.aiUsage.estimatedCost')}</CardTitle>
                  <DollarSign className="h-4 w-4 text-amber-500" />
                </CardHeader>
                <CardContent>
                  {usageSummaryLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <div className="text-2xl font-bold">${(usageSummary?.totalCostUsd || 0).toFixed(4)}</div>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-avg-cost-per-request">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{t('systemAdmin.aiUsage.avgCostPerRequest')}</CardTitle>
                  <TrendingUp className="h-4 w-4 text-purple-500" />
                </CardHeader>
                <CardContent>
                  {usageSummaryLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <div className="text-2xl font-bold">
                      ${usageSummary?.requestCount 
                        ? ((usageSummary.totalCostUsd || 0) / usageSummary.requestCount).toFixed(6) 
                        : '0.000000'}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('systemAdmin.aiUsage.usageByFeature')}</CardTitle>
              </CardHeader>
              <CardContent>
                {usageByFeatureLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : usageByFeature.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t('systemAdmin.aiUsage.noData')}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('systemAdmin.aiUsage.table.feature')}</TableHead>
                        <TableHead className="text-right">{t('systemAdmin.aiUsage.table.requests')}</TableHead>
                        <TableHead className="text-right">{t('systemAdmin.aiUsage.table.tokens')}</TableHead>
                        <TableHead className="text-right">{t('systemAdmin.aiUsage.table.cost')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usageByFeature.map((row) => (
                        <TableRow key={row.feature} data-testid={`row-feature-${row.feature}`}>
                          <TableCell className="font-medium">
                            <Badge variant="outline">
                              {t(`systemAdmin.aiUsage.features.${row.feature}`, row.feature)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{row.requestCount.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{(row.totalTokens / 1000).toFixed(1)}K</TableCell>
                          <TableCell className="text-right">${row.totalCostUsd.toFixed(4)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('systemAdmin.aiUsage.usageByModel')}</CardTitle>
              </CardHeader>
              <CardContent>
                {usageByModelLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : usageByModel.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t('systemAdmin.aiUsage.noData')}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('systemAdmin.aiUsage.table.model')}</TableHead>
                        <TableHead>{t('systemAdmin.aiUsage.table.provider')}</TableHead>
                        <TableHead className="text-right">{t('systemAdmin.aiUsage.table.requests')}</TableHead>
                        <TableHead className="text-right">{t('systemAdmin.aiUsage.table.tokens')}</TableHead>
                        <TableHead className="text-right">{t('systemAdmin.aiUsage.table.cost')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usageByModel.map((row) => (
                        <TableRow key={`${row.model}-${row.provider}`} data-testid={`row-model-${row.model}`}>
                          <TableCell className="font-medium">{row.model}</TableCell>
                          <TableCell>
                            <Badge 
                              variant="secondary"
                              className={
                                row.provider === 'gemini' ? 'bg-blue-100 text-blue-700' :
                                row.provider === 'openai' ? 'bg-green-100 text-green-700' :
                                row.provider === 'anthropic' ? 'bg-purple-100 text-purple-700' :
                                ''
                              }
                            >
                              {row.provider === 'gemini' ? 'Google' :
                               row.provider === 'openai' ? 'OpenAI' :
                               row.provider === 'anthropic' ? 'Anthropic' :
                               row.provider}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{row.requestCount.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{(row.totalTokens / 1000).toFixed(1)}K</TableCell>
                          <TableCell className="text-right">${row.totalCostUsd.toFixed(4)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('systemAdmin.aiUsage.dailyUsage')}</CardTitle>
              </CardHeader>
              <CardContent>
                {dailyUsageLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : dailyUsage.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    {t('systemAdmin.aiUsage.noData')}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('systemAdmin.aiUsage.table.date')}</TableHead>
                          <TableHead className="text-right">{t('systemAdmin.aiUsage.table.requests')}</TableHead>
                          <TableHead className="text-right">{t('systemAdmin.aiUsage.table.tokens')}</TableHead>
                          <TableHead className="text-right">{t('systemAdmin.aiUsage.table.cost')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyUsage.slice(-14).map((row) => (
                          <TableRow key={row.date} data-testid={`row-daily-${row.date}`}>
                            <TableCell className="font-medium">{row.date}</TableCell>
                            <TableCell className="text-right">{row.requestCount.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{(row.totalTokens / 1000).toFixed(1)}K</TableCell>
                            <TableCell className="text-right">${row.totalCostUsd.toFixed(4)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {dailyUsage.length > 14 && (
                      <p className="text-sm text-muted-foreground mt-2 text-center">
                        {t('systemAdmin.aiUsage.showingLast14Days', { total: dailyUsage.length })}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent data-testid="dialog-edit-user">
          <DialogHeader>
            <DialogTitle>{t('systemAdmin.dialogs.editUser.title')}</DialogTitle>
            <DialogDescription>
              {editingUser?.name} ({editingUser?.email})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('systemAdmin.dialogs.editUser.role')}</label>
              <Select
                value={editFormData.role}
                onValueChange={(value) => setEditFormData((prev) => ({ ...prev, role: value }))}
              >
                <SelectTrigger data-testid="select-edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('systemAdmin.roles.admin')}</SelectItem>
                  <SelectItem value="operator">{t('systemAdmin.roles.operator')}</SelectItem>
                  <SelectItem value="user">{t('systemAdmin.roles.user')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editFormData.role === "operator" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('systemAdmin.dialogs.editUser.assignedCategory')}</label>
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
                    <SelectValue placeholder={t('systemAdmin.dialogs.editUser.selectCategory')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('systemAdmin.dialogs.editUser.noCategory')}</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('systemAdmin.dialogs.editUser.categoryHint')}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('systemAdmin.dialogs.editUser.tier')}</label>
              <Select
                value={editFormData.tier}
                onValueChange={(value) => setEditFormData((prev) => ({ ...prev, tier: value }))}
              >
                <SelectTrigger data-testid="select-edit-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bronze">{t('systemAdmin.tiers.bronze')}</SelectItem>
                  <SelectItem value="silver">{t('systemAdmin.tiers.silver')}</SelectItem>
                  <SelectItem value="gold">{t('systemAdmin.tiers.gold')}</SelectItem>
                  <SelectItem value="platinum">{t('systemAdmin.tiers.platinum')}</SelectItem>
                  <SelectItem value="diamond">{t('systemAdmin.tiers.diamond')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('systemAdmin.dialogs.editUser.accountStatus')}</label>
                <p className="text-sm text-muted-foreground">
                  {t('systemAdmin.dialogs.editUser.accountStatusHint')}
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
              {t('systemAdmin.common.cancel')}
            </Button>
            <Button
              onClick={handleSaveUser}
              disabled={updateUserMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateUserMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('systemAdmin.common.saving')}
                </>
              ) : (
                t('systemAdmin.common.save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetPasswordUser} onOpenChange={(open) => {
        if (!open) {
          setResetPasswordUser(null);
          setNewPassword("");
          setShowPassword(false);
        }
      }}>
        <DialogContent data-testid="dialog-reset-password">
          <DialogHeader>
            <DialogTitle>{t('systemAdmin.dialogs.resetPassword.title')}</DialogTitle>
            <DialogDescription>
              {t('systemAdmin.dialogs.resetPassword.description', { name: resetPasswordUser?.name, email: resetPasswordUser?.email })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('systemAdmin.dialogs.resetPassword.newPassword')}</label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('systemAdmin.dialogs.resetPassword.placeholder')}
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
                {t('systemAdmin.dialogs.resetPassword.hint')}
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
              {t('systemAdmin.common.cancel')}
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
                  {t('systemAdmin.dialogs.resetPassword.resetting')}
                </>
              ) : (
                t('systemAdmin.dialogs.resetPassword.reset')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {isCreatingCategory ? t('systemAdmin.categories.createTitle') : t('systemAdmin.categories.editTitle')}
            </DialogTitle>
            <DialogDescription>
              {isCreatingCategory
                ? t('systemAdmin.categories.createDesc')
                : t('systemAdmin.categories.editDesc', { name: editingCategory?.name })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('systemAdmin.categories.form.name')} *</label>
              <Input
                value={categoryFormData.name}
                onChange={(e) => setCategoryFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('systemAdmin.categories.form.namePlaceholder')}
                data-testid="input-category-name"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('systemAdmin.categories.form.description')}</label>
              <Textarea
                value={categoryFormData.description}
                onChange={(e) => setCategoryFormData((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={t('systemAdmin.categories.form.descriptionPlaceholder')}
                rows={3}
                data-testid="input-category-description"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('systemAdmin.categories.form.order')}</label>
              <Input
                type="number"
                value={categoryFormData.order}
                onChange={(e) => setCategoryFormData((prev) => ({ ...prev, order: parseInt(e.target.value) || 0 }))}
                min={0}
                data-testid="input-category-order"
              />
              <p className="text-xs text-muted-foreground">
                {t('systemAdmin.categories.form.orderHint')}
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
              {t('systemAdmin.common.cancel')}
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
                  {t('systemAdmin.common.saving')}
                </>
              ) : isCreatingCategory ? (
                t('systemAdmin.common.add')
              ) : (
                t('systemAdmin.common.save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingCategory} onOpenChange={(open) => !open && setDeletingCategory(null)}>
        <DialogContent data-testid="dialog-delete-category">
          <DialogHeader>
            <DialogTitle>{t('systemAdmin.categories.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('systemAdmin.categories.deleteConfirm', { name: deletingCategory?.name })}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {t('systemAdmin.categories.deleteWarning')}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingCategory(null)} data-testid="button-cancel-delete">
              {t('systemAdmin.common.cancel')}
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
                  {t('systemAdmin.common.deleting')}
                </>
              ) : (
                t('systemAdmin.common.delete')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
