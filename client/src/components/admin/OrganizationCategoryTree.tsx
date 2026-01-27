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
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Loader2, Plus, Pencil, Trash2, FolderTree, Building2, ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

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
  company?: { id: string; name: string; code: string } | null;
}

interface Category {
  id: string;
  name: string;
  description?: string | null;
  order: number;
  organizationId?: string | null;
  organization?: { id: string; name: string } | null;
  company?: { id: string; name: string } | null;
}

type DialogMode = 'create-org' | 'edit-org' | 'create-category' | 'edit-category' | null;

export function OrganizationCategoryTree() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const currentUser = user as UserInfo | null;

  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'org' | 'category'; item: Organization | Category } | null>(null);

  const [orgFormData, setOrgFormData] = useState({ name: '', code: '', description: '', companyId: '' });
  const [categoryFormData, setCategoryFormData] = useState({ name: '', description: '', order: 0 });

  const isAdmin = currentUser?.role === 'admin';
  const isCompanyLevelOperator = currentUser?.role === 'operator' &&
    currentUser?.assignedCompanyId &&
    !currentUser?.assignedOrganizationId &&
    !currentUser?.assignedCategoryId;
  const isCategoryLevelOperator = currentUser?.role === 'operator' && currentUser?.assignedCategoryId;
  
  const canManageOrgs = isAdmin || isCompanyLevelOperator;
  const canCreateCategories = isAdmin || isCompanyLevelOperator || (currentUser?.role === 'operator' && currentUser?.assignedOrganizationId);
  const canEditCategories = isAdmin || (currentUser?.role === 'operator' && !isCategoryLevelOperator);
  const canDeleteCategories = isAdmin || (currentUser?.role === 'operator' && !isCategoryLevelOperator);

  const { data: organizations = [], isLoading: orgsLoading } = useQuery<Organization[]>({
    queryKey: ['/api/admin/organizations'],
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<Category[]>({
    queryKey: ['/api/admin/categories'],
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['/api/public/companies'],
    enabled: isAdmin,
  });

  const createOrgMutation = useMutation({
    mutationFn: async (data: typeof orgFormData) => {
      return await apiRequest('POST', '/api/admin/organizations', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/organizations'] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('orgCategoryTree.orgCreated', '조직이 생성되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: 'destructive' });
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Organization> }) => {
      return await apiRequest('PATCH', `/api/admin/organizations/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/organizations'] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('orgCategoryTree.orgUpdated', '조직이 수정되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: 'destructive' });
    },
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/admin/organizations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/organizations'] });
      setDeleteTarget(null);
      toast({ title: t('common.success', '성공'), description: t('orgCategoryTree.orgDeleted', '조직이 삭제되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: 'destructive' });
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; order: number; organizationId: string }) => {
      return await apiRequest('POST', '/api/admin/categories', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('orgCategoryTree.categoryCreated', '카테고리가 생성되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: 'destructive' });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Category> }) => {
      return await apiRequest('PATCH', `/api/admin/categories/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('orgCategoryTree.categoryUpdated', '카테고리가 수정되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: 'destructive' });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/admin/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/categories'] });
      setDeleteTarget(null);
      toast({ title: t('common.success', '성공'), description: t('orgCategoryTree.categoryDeleted', '카테고리가 삭제되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: 'destructive' });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return await apiRequest('PATCH', `/api/admin/organizations/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/organizations'] });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: 'destructive' });
    },
  });

  const closeDialog = () => {
    setDialogMode(null);
    setSelectedOrganization(null);
    setSelectedCategory(null);
    setOrgFormData({ name: '', code: '', description: '', companyId: '' });
    setCategoryFormData({ name: '', description: '', order: 0 });
  };

  const openCreateOrgDialog = () => {
    setDialogMode('create-org');
    setOrgFormData({ name: '', code: '', description: '', companyId: '' });
  };

  const openEditOrgDialog = (org: Organization) => {
    setDialogMode('edit-org');
    setSelectedOrganization(org);
    setOrgFormData({
      name: org.name,
      code: org.code || '',
      description: org.description || '',
      companyId: org.companyId,
    });
  };

  const openCreateCategoryDialog = (org: Organization) => {
    setDialogMode('create-category');
    setSelectedOrganization(org);
    setCategoryFormData({ name: '', description: '', order: 0 });
  };

  const openEditCategoryDialog = (category: Category) => {
    setDialogMode('edit-category');
    setSelectedCategory(category);
    setCategoryFormData({
      name: category.name,
      description: category.description || '',
      order: category.order,
    });
  };

  const handleOrgSubmit = () => {
    if (dialogMode === 'create-org') {
      createOrgMutation.mutate(orgFormData);
    } else if (dialogMode === 'edit-org' && selectedOrganization) {
      updateOrgMutation.mutate({
        id: selectedOrganization.id,
        updates: { name: orgFormData.name, code: orgFormData.code, description: orgFormData.description },
      });
    }
  };

  const handleCategorySubmit = () => {
    if (dialogMode === 'create-category' && selectedOrganization) {
      createCategoryMutation.mutate({
        ...categoryFormData,
        organizationId: selectedOrganization.id,
      });
    } else if (dialogMode === 'edit-category' && selectedCategory) {
      updateCategoryMutation.mutate({
        id: selectedCategory.id,
        updates: categoryFormData,
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'org') {
      deleteOrgMutation.mutate((deleteTarget.item as Organization).id);
    } else {
      deleteCategoryMutation.mutate((deleteTarget.item as Category).id);
    }
  };

  const toggleOrg = (orgId: string) => {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  };

  const getCategoriesForOrg = (orgId: string) => {
    return categories.filter(cat => cat.organizationId === orgId);
  };

  const isLoading = orgsLoading || categoriesLoading;

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
            {t('orgCategoryTree.title', '조직 및 카테고리 관리')}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {t('orgCategoryTree.subtitle', '조직과 그 하위 카테고리를 계층 구조로 관리합니다.')}
          </p>
        </div>
        {canManageOrgs && (
          <Button 
            onClick={openCreateOrgDialog} 
            size="sm"
            disabled={isAdmin && companies.length === 0}
            title={isAdmin && companies.length === 0 ? t('orgCategoryTree.noCompanies', '먼저 회사를 생성해야 합니다.') : undefined}
          >
            <Plus className="w-4 h-4 mr-1" />
            {t('orgCategoryTree.addOrg', '조직 추가')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {organizations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{t('orgCategoryTree.empty', '등록된 조직이 없습니다.')}</p>
            {canManageOrgs && (
              <p className="text-sm mt-2">{t('orgCategoryTree.emptyHint', '"조직 추가" 버튼을 클릭하여 첫 번째 조직을 생성하세요.')}</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {organizations.map((org) => {
              const orgCategories = getCategoriesForOrg(org.id);
              const isExpanded = expandedOrgs.has(org.id);

              return (
                <Collapsible key={org.id} open={isExpanded} onOpenChange={() => toggleOrg(org.id)}>
                  <div className="border rounded-lg">
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between p-3 hover:bg-slate-50 cursor-pointer transition-colors">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                          )}
                          {isExpanded ? (
                            <FolderOpen className="w-5 h-5 text-amber-500" />
                          ) : (
                            <Folder className="w-5 h-5 text-amber-500" />
                          )}
                          <span className="font-medium">{org.name}</span>
                          {org.code && (
                            <Badge variant="outline" className="text-xs ml-1">
                              {org.code}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-xs">
                            {orgCategories.length} {t('orgCategoryTree.categoriesCount', '카테고리')}
                          </Badge>
                          {!org.isActive && (
                            <Badge variant="destructive" className="text-xs">
                              {t('common.inactive', '비활성')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {canManageOrgs && (
                            <>
                              <Switch
                                checked={org.isActive}
                                onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: org.id, isActive: checked })}
                              />
                              <Button variant="ghost" size="sm" onClick={() => openEditOrgDialog(org)}>
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget({ type: 'org', item: org })}>
                                <Trash2 className="w-4 h-4 text-red-500" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t bg-slate-50/50 p-3">
                        {org.description && (
                          <p className="text-sm text-muted-foreground mb-3 pl-6">{org.description}</p>
                        )}
                        <div className="space-y-2 pl-6">
                          {orgCategories.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-2">
                              {t('orgCategoryTree.noCategories', '카테고리가 없습니다.')}
                            </div>
                          ) : (
                            orgCategories.map((category) => (
                              <div
                                key={category.id}
                                className="flex items-center justify-between p-2 bg-white border rounded-md hover:bg-slate-50 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <FolderTree className="w-4 h-4 text-blue-500" />
                                  <span>{category.name}</span>
                                  {category.description && (
                                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                                      - {category.description}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  {canEditCategories && (
                                    <Button variant="ghost" size="sm" onClick={() => openEditCategoryDialog(category)}>
                                      <Pencil className="w-3 h-3" />
                                    </Button>
                                  )}
                                  {canDeleteCategories && (
                                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget({ type: 'category', item: category })}>
                                      <Trash2 className="w-3 h-3 text-red-500" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                          {canCreateCategories && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full mt-2"
                              onClick={() => openCreateCategoryDialog(org)}
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              {t('orgCategoryTree.addCategory', '카테고리 추가')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogMode === 'create-org' || dialogMode === 'edit-org'} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create-org'
                ? t('orgCategoryTree.createOrgDialog.title', '새 조직 생성')
                : t('orgCategoryTree.editOrgDialog.title', '조직 수정')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {isAdmin && dialogMode === 'create-org' && companies.length > 0 && (
              <div>
                <Label>{t('orgCategoryTree.form.company', '회사')} *</Label>
                <Select
                  value={orgFormData.companyId}
                  onValueChange={(value) => setOrgFormData(prev => ({ ...prev, companyId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('orgCategoryTree.form.selectCompany', '회사를 선택하세요')} />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map(company => (
                      <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAdmin && dialogMode === 'edit-org' && selectedOrganization && (
              <div>
                <Label>{t('orgCategoryTree.form.company', '회사')}</Label>
                <Input value={selectedOrganization.company?.name || ''} disabled className="bg-slate-100" />
              </div>
            )}
            <div>
              <Label>{t('orgCategoryTree.form.orgName', '조직 이름')} *</Label>
              <Input
                value={orgFormData.name}
                onChange={(e) => setOrgFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('orgCategoryTree.form.orgNamePlaceholder', '조직 이름을 입력하세요')}
              />
            </div>
            <div>
              <Label>{t('orgCategoryTree.form.orgCode', '조직 코드')}</Label>
              <Input
                value={orgFormData.code}
                onChange={(e) => setOrgFormData(prev => ({ ...prev, code: e.target.value }))}
                placeholder={t('orgCategoryTree.form.orgCodePlaceholder', '예: ORG001')}
              />
            </div>
            <div>
              <Label>{t('orgCategoryTree.form.description', '설명')}</Label>
              <Textarea
                value={orgFormData.description}
                onChange={(e) => setOrgFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('orgCategoryTree.form.descriptionPlaceholder', '설명을 입력하세요')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('common.cancel', '취소')}
            </Button>
            <Button
              onClick={handleOrgSubmit}
              disabled={!orgFormData.name || (isAdmin && dialogMode === 'create-org' && !orgFormData.companyId) || createOrgMutation.isPending || updateOrgMutation.isPending}
            >
              {(createOrgMutation.isPending || updateOrgMutation.isPending) && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {dialogMode === 'create-org' ? t('common.create', '생성') : t('common.save', '저장')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogMode === 'create-category' || dialogMode === 'edit-category'} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create-category'
                ? t('orgCategoryTree.createCategoryDialog.title', '새 카테고리 생성')
                : t('orgCategoryTree.editCategoryDialog.title', '카테고리 수정')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {dialogMode === 'create-category' && selectedOrganization && (
              <div>
                <Label>{t('orgCategoryTree.form.parentOrg', '상위 조직')}</Label>
                <Input value={selectedOrganization.name} disabled className="bg-slate-100" />
              </div>
            )}
            <div>
              <Label>{t('orgCategoryTree.form.categoryName', '카테고리 이름')} *</Label>
              <Input
                value={categoryFormData.name}
                onChange={(e) => setCategoryFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('orgCategoryTree.form.categoryNamePlaceholder', '카테고리 이름을 입력하세요')}
              />
            </div>
            <div>
              <Label>{t('orgCategoryTree.form.description', '설명')}</Label>
              <Textarea
                value={categoryFormData.description}
                onChange={(e) => setCategoryFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('orgCategoryTree.form.descriptionPlaceholder', '설명을 입력하세요')}
              />
            </div>
            <div>
              <Label>{t('orgCategoryTree.form.order', '정렬 순서')}</Label>
              <Input
                type="number"
                value={categoryFormData.order}
                onChange={(e) => setCategoryFormData(prev => ({ ...prev, order: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('common.cancel', '취소')}
            </Button>
            <Button
              onClick={handleCategorySubmit}
              disabled={!categoryFormData.name || createCategoryMutation.isPending || updateCategoryMutation.isPending}
            >
              {(createCategoryMutation.isPending || updateCategoryMutation.isPending) && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {dialogMode === 'create-category' ? t('common.create', '생성') : t('common.save', '저장')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === 'org'
                ? t('orgCategoryTree.deleteOrgDialog.title', '조직 삭제')
                : t('orgCategoryTree.deleteCategoryDialog.title', '카테고리 삭제')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'org'
                ? t('orgCategoryTree.deleteOrgDialog.description', '"{name}" 조직을 삭제하시겠습니까? 하위 카테고리가 있으면 삭제할 수 없습니다.', { name: (deleteTarget?.item as Organization)?.name })
                : t('orgCategoryTree.deleteCategoryDialog.description', '"{name}" 카테고리를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.', { name: (deleteTarget?.item as Category)?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', '취소')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {(deleteOrgMutation.isPending || deleteCategoryMutation.isPending) && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {t('common.delete', '삭제')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
