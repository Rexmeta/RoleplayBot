import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, Pencil, Trash2, Building2, FolderTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";

interface UserInfo {
  id: string;
  role: string;
  assignedCompanyId?: string | null;
  assignedOrganizationId?: string | null;
  assignedCategoryId?: string | null;
}

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Organization {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  companyId: string;
  isActive: boolean;
  createdAt: string;
  company?: {
    id: string;
    name: string;
    code: string;
  } | null;
}

export function OperatorOrganizationManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const currentUser = user as UserInfo | null;
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [deletingOrg, setDeletingOrg] = useState<Organization | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    description: "",
    companyId: "",
  });

  const isCompanyLevelOperator = currentUser?.role === 'operator' && 
    currentUser?.assignedCompanyId && 
    !currentUser?.assignedOrganizationId && 
    !currentUser?.assignedCategoryId;
  
  const isAdmin = currentUser?.role === 'admin';

  const { data: organizations = [], isLoading } = useQuery<Organization[]>({
    queryKey: ["/api/admin/organizations"],
  });
  
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["/api/public/companies"],
    enabled: isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/admin/organizations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/organizations"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: t('common.success', '성공'), description: t('operatorOrg.orgCreated', '조직이 생성되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Organization> }) => {
      const res = await apiRequest("PATCH", `/api/admin/organizations/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/organizations"] });
      setIsDialogOpen(false);
      setEditingOrg(null);
      resetForm();
      toast({ title: t('common.success', '성공'), description: t('operatorOrg.orgUpdated', '조직 정보가 수정되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/organizations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/organizations"] });
      setDeletingOrg(null);
      toast({ title: t('common.success', '성공'), description: t('operatorOrg.orgDeleted', '조직이 삭제되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/organizations/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", code: "", description: "", companyId: "" });
  };

  const openCreateDialog = () => {
    setEditingOrg(null);
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (org: Organization) => {
    setEditingOrg(org);
    setFormData({
      name: org.name,
      code: org.code || "",
      description: org.description || "",
      companyId: org.companyId || "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editingOrg) {
      updateMutation.mutate({ id: editingOrg.id, updates: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  if (!isCompanyLevelOperator && currentUser?.role !== 'admin') {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{t('operatorOrg.noAccess', '조직 관리 권한이 없습니다.')}</p>
            <p className="text-sm mt-2">{t('operatorOrg.noAccessHint', '회사 레벨 운영자만 조직을 관리할 수 있습니다.')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {t('operatorOrg.title', '조직 관리')}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {t('operatorOrg.subtitle', '담당 회사의 조직을 생성하고 관리합니다.')}
          </p>
        </div>
        <Button onClick={openCreateDialog} size="sm">
          <Plus className="w-4 h-4 mr-1" />
          {t('operatorOrg.addOrg', '조직 추가')}
        </Button>
      </CardHeader>
      <CardContent>
        {organizations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FolderTree className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{t('operatorOrg.empty', '등록된 조직이 없습니다.')}</p>
            <p className="text-sm mt-2">{t('operatorOrg.emptyHint', '"조직 추가" 버튼을 클릭하여 첫 번째 조직을 생성하세요.')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {organizations.map((org) => (
              <div
                key={org.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{org.name}</span>
                    {org.code && (
                      <Badge variant="outline" className="text-xs">
                        {org.code}
                      </Badge>
                    )}
                    {!org.isActive && (
                      <Badge variant="secondary" className="text-xs">
                        {t('common.inactive', '비활성')}
                      </Badge>
                    )}
                  </div>
                  {org.description && (
                    <p className="text-sm text-muted-foreground mt-1">{org.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={org.isActive}
                      onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: org.id, isActive: checked })}
                    />
                    <span className="text-sm text-muted-foreground">
                      {org.isActive ? t('common.active', '활성') : t('common.inactive', '비활성')}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog(org)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeletingOrg(org)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingOrg 
                ? t('operatorOrg.editDialog.title', '조직 수정')
                : t('operatorOrg.createDialog.title', '새 조직 생성')
              }
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {isAdmin && !editingOrg && companies.length > 0 && (
              <div>
                <Label>{t('operatorOrg.form.company', '회사')} *</Label>
                <Select
                  value={formData.companyId}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, companyId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('operatorOrg.form.selectCompany', '회사를 선택하세요')} />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map(company => (
                      <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAdmin && editingOrg && (
              <div>
                <Label>{t('operatorOrg.form.company', '회사')}</Label>
                <Input 
                  value={editingOrg.company?.name || ''} 
                  disabled 
                  className="bg-slate-100"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('operatorOrg.form.companyReadOnly', '조직의 회사는 변경할 수 없습니다.')}
                </p>
              </div>
            )}
            <div>
              <Label>{t('operatorOrg.form.name', '조직 이름')} *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('operatorOrg.form.namePlaceholder', '조직 이름을 입력하세요')}
              />
            </div>
            <div>
              <Label>{t('operatorOrg.form.code', '조직 코드')}</Label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                placeholder={t('operatorOrg.form.codePlaceholder', '예: ORG001')}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t('operatorOrg.form.codeHint', '고유한 식별 코드 (선택사항)')}
              </p>
            </div>
            <div>
              <Label>{t('operatorOrg.form.description', '설명')}</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('operatorOrg.form.descriptionPlaceholder', '조직에 대한 설명을 입력하세요')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {t('common.cancel', '취소')}
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={!formData.name || (isAdmin && !editingOrg && !formData.companyId) || createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {editingOrg ? t('common.save', '저장') : t('common.create', '생성')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingOrg} onOpenChange={(open) => !open && setDeletingOrg(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('operatorOrg.deleteDialog.title', '조직 삭제')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('operatorOrg.deleteDialog.description', '"{name}" 조직을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', { name: deletingOrg?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', '취소')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingOrg && deleteMutation.mutate(deletingOrg.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {t('common.delete', '삭제')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
