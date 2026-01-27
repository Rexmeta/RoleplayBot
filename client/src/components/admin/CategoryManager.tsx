import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Loader2, Plus, Pencil, Trash2, FolderTree, Building2 } from 'lucide-react';

interface CategoryWithHierarchy {
  id: string;
  name: string;
  description?: string | null;
  order: number;
  organizationId?: string | null;
  organization?: { id: string; name: string; code?: string | null } | null;
  company?: { id: string; name: string; code?: string | null } | null;
}

interface Organization {
  id: string;
  name: string;
  code?: string | null;
  companyId?: string | null;
}

interface UserInfo {
  id: string;
  role: string;
  assignedCompanyId?: string | null;
  assignedOrganizationId?: string | null;
  assignedCategoryId?: string | null;
}

export function CategoryManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryWithHierarchy | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<CategoryWithHierarchy | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', order: 0, organizationId: '' });

  const { data: currentUser } = useQuery<UserInfo>({
    queryKey: ['/api/auth/user'],
  });

  const { data: categories = [], isLoading } = useQuery<CategoryWithHierarchy[]>({
    queryKey: ['/api/admin/categories'],
  });
  
  const { data: organizations = [] } = useQuery<Organization[]>({
    queryKey: ['/api/admin/organizations'],
    enabled: currentUser?.role === 'admin' || (currentUser?.role === 'operator' && !!currentUser?.assignedCompanyId && !currentUser?.assignedOrganizationId),
  });
  
  const isCompanyLevelOperator = currentUser?.role === 'operator' && currentUser?.assignedCompanyId && !currentUser?.assignedOrganizationId && !currentUser?.assignedCategoryId;
  const isCategoryLevelOperator = currentUser?.role === 'operator' && currentUser?.assignedCategoryId;
  const canCreateDelete = currentUser?.role === 'admin' || (currentUser?.role === 'operator' && !isCategoryLevelOperator);
  
  const accessibleOrganizations = organizations.filter(org => {
    if (currentUser?.role === 'admin') return true;
    if (isCompanyLevelOperator && currentUser?.assignedCompanyId) {
      return org.companyId === currentUser.assignedCompanyId;
    }
    return false;
  });

  const filteredCategories = categories;

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; order: number; organizationId?: string }) => {
      return await apiRequest('POST', '/api/admin/categories', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      setIsCreateDialogOpen(false);
      setFormData({ name: '', description: '', order: 0, organizationId: '' });
      toast({ title: t('admin.categoryManager.toast.created', '카테고리가 생성되었습니다.') });
    },
    onError: (error: any) => {
      toast({ title: t('admin.categoryManager.toast.createFailed', '카테고리 생성에 실패했습니다.'), description: error.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { name?: string; description?: string; order?: number; organizationId?: string } }) => {
      return await apiRequest('PATCH', `/api/admin/categories/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      setEditingCategory(null);
      toast({ title: t('admin.categoryManager.toast.updated', '카테고리가 수정되었습니다.') });
    },
    onError: (error: any) => {
      toast({ title: t('admin.categoryManager.toast.updateFailed', '카테고리 수정에 실패했습니다.'), description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/admin/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      setDeletingCategory(null);
      toast({ title: t('admin.categoryManager.toast.deleted', '카테고리가 삭제되었습니다.') });
    },
    onError: (error: any) => {
      toast({ title: t('admin.categoryManager.toast.deleteFailed', '카테고리 삭제에 실패했습니다.'), description: error.message, variant: 'destructive' });
    },
  });

  const handleCreate = () => {
    let organizationId: string | undefined;
    
    if (currentUser?.role === 'admin') {
      organizationId = formData.organizationId || undefined;
    } else if (currentUser?.role === 'operator') {
      if (currentUser.assignedOrganizationId) {
        organizationId = currentUser.assignedOrganizationId;
      } else if (isCompanyLevelOperator && formData.organizationId) {
        organizationId = formData.organizationId;
      }
    }
    
    createMutation.mutate({ 
      name: formData.name, 
      description: formData.description, 
      order: formData.order, 
      organizationId 
    });
  };

  const handleUpdate = () => {
    if (!editingCategory) return;
    
    const updates: { name?: string; description?: string; order?: number; organizationId?: string } = {
      name: formData.name,
      description: formData.description,
      order: formData.order,
    };
    
    // admin과 회사 레벨 운영자는 조직 변경 가능
    if (currentUser?.role === 'admin' || isCompanyLevelOperator) {
      if (formData.organizationId) {
        updates.organizationId = formData.organizationId;
      }
    }
    
    updateMutation.mutate({ id: editingCategory.id, updates });
  };

  const openEditDialog = (category: CategoryWithHierarchy) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description || '',
      order: category.order,
      organizationId: category.organizationId || '',
    });
  };

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
            <FolderTree className="w-5 h-5" />
            {t('admin.categoryManager.title', '카테고리 관리')}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {currentUser?.role === 'admin' 
              ? t('admin.categoryManager.adminHint', '모든 카테고리를 관리합니다.')
              : isCategoryLevelOperator
                ? t('admin.categoryManager.categoryOperatorHint', '담당 카테고리만 수정할 수 있습니다.')
                : isCompanyLevelOperator
                  ? t('admin.categoryManager.companyOperatorHint', '담당 회사의 모든 조직 카테고리를 관리합니다.')
                  : t('admin.categoryManager.operatorHint', '담당 조직의 카테고리를 관리합니다.')
            }
          </p>
        </div>
        {canCreateDelete && (
          <Button onClick={() => setIsCreateDialogOpen(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            {t('admin.categoryManager.addCategory', '카테고리 추가')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {filteredCategories.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FolderTree className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{t('admin.categoryManager.empty', '관리 가능한 카테고리가 없습니다.')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredCategories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{category.name}</span>
                    {category.company && category.organization && (
                      <Badge variant="outline" className="text-xs">
                        <Building2 className="w-3 h-3 mr-1" />
                        {category.company.name} &gt; {category.organization.name}
                      </Badge>
                    )}
                  </div>
                  {category.description && (
                    <p className="text-sm text-muted-foreground mt-1">{category.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog(category)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  {canCreateDelete && (
                    <Button variant="ghost" size="sm" onClick={() => setDeletingCategory(category)}>
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.categoryManager.createDialog.title', '새 카테고리 생성')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {(currentUser?.role === 'admin' || isCompanyLevelOperator) && accessibleOrganizations.length > 0 && (
              <div>
                <Label>{t('admin.categoryManager.form.organization', '조직')}</Label>
                <Select
                  value={formData.organizationId}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, organizationId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('admin.categoryManager.form.selectOrganization', '조직을 선택하세요')} />
                  </SelectTrigger>
                  <SelectContent>
                    {accessibleOrganizations.map(org => (
                      <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{t('admin.categoryManager.form.name', '카테고리 이름')}</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('admin.categoryManager.form.namePlaceholder', '카테고리 이름을 입력하세요')}
              />
            </div>
            <div>
              <Label>{t('admin.categoryManager.form.description', '설명')}</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('admin.categoryManager.form.descriptionPlaceholder', '카테고리 설명을 입력하세요')}
              />
            </div>
            <div>
              <Label>{t('admin.categoryManager.form.order', '정렬 순서')}</Label>
              <Input
                type="number"
                value={formData.order}
                onChange={(e) => setFormData(prev => ({ ...prev, order: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              {t('common.cancel', '취소')}
            </Button>
            <Button 
              onClick={handleCreate} 
              disabled={!formData.name || createMutation.isPending || (!!isCompanyLevelOperator && !formData.organizationId)}
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {t('common.create', '생성')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCategory} onOpenChange={(open) => !open && setEditingCategory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.categoryManager.editDialog.title', '카테고리 수정')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {(currentUser?.role === 'admin' || isCompanyLevelOperator) && accessibleOrganizations.length > 0 && (
              <div>
                <Label>{t('admin.categoryManager.form.organization', '조직')}</Label>
                <Select
                  value={formData.organizationId}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, organizationId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('admin.categoryManager.form.selectOrganization', '조직을 선택하세요')} />
                  </SelectTrigger>
                  <SelectContent>
                    {accessibleOrganizations.map(org => (
                      <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('admin.categoryManager.form.organizationHint', '카테고리가 속할 조직을 변경할 수 있습니다.')}
                </p>
              </div>
            )}
            <div>
              <Label>{t('admin.categoryManager.form.name', '카테고리 이름')}</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('admin.categoryManager.form.description', '설명')}</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>
            <div>
              <Label>{t('admin.categoryManager.form.order', '정렬 순서')}</Label>
              <Input
                type="number"
                value={formData.order}
                onChange={(e) => setFormData(prev => ({ ...prev, order: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCategory(null)}>
              {t('common.cancel', '취소')}
            </Button>
            <Button onClick={handleUpdate} disabled={!formData.name || updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {t('common.save', '저장')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingCategory} onOpenChange={(open) => !open && setDeletingCategory(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.categoryManager.deleteDialog.title', '카테고리 삭제')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.categoryManager.deleteDialog.description', '"{name}" 카테고리를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', { name: deletingCategory?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', '취소')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingCategory && deleteMutation.mutate(deletingCategory.id)}
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
