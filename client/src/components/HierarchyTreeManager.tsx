import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Loader2, Plus, Pencil, Trash2, Building2, Users, FolderTree, 
  ChevronRight, ChevronDown, MoreHorizontal, UserCircle
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Company {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

interface Organization {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  companyId: string;
  isActive: boolean;
  createdAt: string;
}

interface Category {
  id: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  companyId: string | null;
  isActive: boolean;
  createdAt: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'user';
  assignedCompanyId: string | null;
  assignedOrganizationId: string | null;
  assignedCategoryId: string | null;
}

type DialogType = 'company' | 'organization' | 'category' | null;
type DialogMode = 'create' | 'edit';

export function HierarchyTreeManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());
  
  const [dialogType, setDialogType] = useState<DialogType>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>('create');
  const [editingItem, setEditingItem] = useState<Company | Organization | Category | null>(null);
  const [parentContext, setParentContext] = useState<{ companyId?: string; organizationId?: string }>({});
  
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    description: "",
    companyId: "",
    organizationId: "",
  });

  const { data: companies = [], isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/system-admin/companies"],
  });

  const { data: organizations = [] } = useQuery<Organization[]>({
    queryKey: ["/api/system-admin/organizations"],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/admin/categories"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/system-admin/users"],
  });

  const operators = users.filter(u => u.role === 'operator');

  const getOperatorsForCompany = (companyId: string) => {
    return operators.filter(op => 
      op.assignedCompanyId === companyId && 
      !op.assignedOrganizationId && 
      !op.assignedCategoryId
    );
  };

  const getOperatorsForOrg = (orgId: string) => {
    return operators.filter(op => 
      op.assignedOrganizationId === orgId && 
      !op.assignedCategoryId
    );
  };

  const getOperatorsForCategory = (categoryId: string) => {
    return operators.filter(op => op.assignedCategoryId === categoryId);
  };

  const createCompanyMutation = useMutation({
    mutationFn: async (data: { name: string; code: string; description: string }) => {
      const res = await apiRequest("POST", "/api/system-admin/companies", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/companies"] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('companyOrg.companyCreated', '회사가 생성되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const updateCompanyMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/system-admin/companies/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/companies"] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('companyOrg.companyUpdated', '회사 정보가 수정되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/system-admin/companies/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/companies"] });
      toast({ title: t('common.success', '성공'), description: t('companyOrg.companyDeleted', '회사가 삭제되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const createOrgMutation = useMutation({
    mutationFn: async (data: { name: string; code: string; description: string; companyId: string }) => {
      const res = await apiRequest("POST", "/api/system-admin/organizations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/organizations"] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('companyOrg.orgCreated', '조직이 생성되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/system-admin/organizations/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/organizations"] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('companyOrg.orgUpdated', '조직 정보가 수정되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/system-admin/organizations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-admin/organizations"] });
      toast({ title: t('common.success', '성공'), description: t('companyOrg.orgDeleted', '조직이 삭제되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; organizationId?: string; companyId?: string }) => {
      const res = await apiRequest("POST", "/api/admin/categories", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('hierarchy.categoryCreated', '카테고리가 생성되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/categories/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      closeDialog();
      toast({ title: t('common.success', '성공'), description: t('hierarchy.categoryUpdated', '카테고리가 수정되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/categories/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      toast({ title: t('common.success', '성공'), description: t('hierarchy.categoryDeleted', '카테고리가 삭제되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", code: "", description: "", companyId: "", organizationId: "" });
  };

  const closeDialog = () => {
    setDialogType(null);
    setEditingItem(null);
    setParentContext({});
    resetForm();
  };

  const openCreateDialog = (type: DialogType, context?: { companyId?: string; organizationId?: string }) => {
    resetForm();
    setDialogType(type);
    setDialogMode('create');
    setEditingItem(null);
    if (context) {
      setParentContext(context);
      setFormData(prev => ({
        ...prev,
        companyId: context.companyId || "",
        organizationId: context.organizationId || "",
      }));
    }
  };

  const openEditDialog = (type: DialogType, item: Company | Organization | Category) => {
    setDialogType(type);
    setDialogMode('edit');
    setEditingItem(item);
    
    if (type === 'company') {
      const company = item as Company;
      setFormData({
        name: company.name,
        code: company.code || "",
        description: company.description || "",
        companyId: "",
        organizationId: "",
      });
    } else if (type === 'organization') {
      const org = item as Organization;
      setFormData({
        name: org.name,
        code: org.code || "",
        description: org.description || "",
        companyId: org.companyId,
        organizationId: "",
      });
    } else if (type === 'category') {
      const cat = item as Category;
      setFormData({
        name: cat.name,
        code: "",
        description: cat.description || "",
        companyId: cat.companyId || "",
        organizationId: cat.organizationId || "",
      });
    }
  };

  const handleSubmit = () => {
    if (dialogType === 'company') {
      if (dialogMode === 'edit' && editingItem) {
        updateCompanyMutation.mutate({ 
          id: editingItem.id, 
          updates: { name: formData.name, code: formData.code, description: formData.description }
        });
      } else {
        createCompanyMutation.mutate({ 
          name: formData.name, 
          code: formData.code, 
          description: formData.description 
        });
      }
    } else if (dialogType === 'organization') {
      if (dialogMode === 'edit' && editingItem) {
        updateOrgMutation.mutate({ 
          id: editingItem.id, 
          updates: { name: formData.name, code: formData.code, description: formData.description }
        });
      } else {
        createOrgMutation.mutate({ 
          name: formData.name, 
          code: formData.code, 
          description: formData.description,
          companyId: formData.companyId || parentContext.companyId || ""
        });
      }
    } else if (dialogType === 'category') {
      if (dialogMode === 'edit' && editingItem) {
        updateCategoryMutation.mutate({ 
          id: editingItem.id, 
          updates: { name: formData.name, description: formData.description }
        });
      } else {
        createCategoryMutation.mutate({ 
          name: formData.name, 
          description: formData.description,
          organizationId: formData.organizationId || parentContext.organizationId || undefined,
          companyId: formData.companyId || parentContext.companyId || undefined
        });
      }
    }
  };

  const toggleCompany = (companyId: string) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
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

  const getOrgsForCompany = (companyId: string) => 
    organizations.filter(org => org.companyId === companyId);

  const getCategoriesForOrg = (orgId: string) => 
    categories.filter(cat => cat.organizationId === orgId);

  const getUnassignedCategories = () =>
    categories.filter(cat => !cat.organizationId);

  const isPending = createCompanyMutation.isPending || updateCompanyMutation.isPending ||
    createOrgMutation.isPending || updateOrgMutation.isPending ||
    createCategoryMutation.isPending || updateCategoryMutation.isPending;

  if (companiesLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const expandAll = () => {
    setExpandedCompanies(new Set(companies.map(c => c.id)));
    setExpandedOrgs(new Set(organizations.map(o => o.id)));
  };

  const collapseAll = () => {
    setExpandedCompanies(new Set());
    setExpandedOrgs(new Set());
  };

  const OperatorBadge = ({ operators: ops, level }: { operators: User[]; level: 'company' | 'org' | 'category' }) => {
    if (ops.length === 0) return null;
    
    const sizeClasses = level === 'category' ? 'text-xs' : 'text-xs';
    
    return (
      <>
        <div className="hidden md:flex items-center gap-1 flex-wrap max-w-[200px]">
          <UserCircle className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          {ops.slice(0, 2).map((op) => (
            <Badge key={op.id} variant="outline" className={`${sizeClasses} py-0 px-1`}>
              {op.name}
            </Badge>
          ))}
          {ops.length > 2 && (
            <Popover>
              <PopoverTrigger asChild>
                <Badge variant="secondary" className={`${sizeClasses} py-0 px-1 cursor-pointer hover:bg-slate-200`}>
                  +{ops.length - 2}
                </Badge>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2">
                <div className="text-sm font-medium mb-2">{t('hierarchy.assignedOperators', '할당된 운영자')}</div>
                <div className="space-y-1">
                  {ops.map((op) => (
                    <div key={op.id} className="text-sm flex items-center gap-2">
                      <UserCircle className="h-3 w-3 text-muted-foreground" />
                      <span>{op.name}</span>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="md:hidden">
          <Popover>
            <PopoverTrigger asChild>
              <Badge variant="outline" className={`${sizeClasses} py-0 px-1.5 cursor-pointer hover:bg-slate-100`}>
                <UserCircle className="h-3 w-3 mr-1" />
                {ops.length}
              </Badge>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2">
              <div className="text-sm font-medium mb-2">{t('hierarchy.assignedOperators', '할당된 운영자')}</div>
              <div className="space-y-1">
                {ops.map((op) => (
                  <div key={op.id} className="text-sm flex items-center gap-2">
                    <UserCircle className="h-3 w-3 text-muted-foreground" />
                    <span>{op.name}</span>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FolderTree className="h-5 w-5" />
                {t('hierarchy.title', '조직 구조 관리')}
              </CardTitle>
              <CardDescription>
                {t('hierarchy.description', '회사 > 조직 > 카테고리 계층 구조를 관리합니다.')}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={expandAll}>
                {t('hierarchy.expandAll', '모두 펼치기')}
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll}>
                {t('hierarchy.collapseAll', '모두 접기')}
              </Button>
              <Button size="sm" onClick={() => openCreateDialog('company')}>
                <Plus className="h-4 w-4 mr-2" />
                {t('companyOrg.addCompany', '회사 추가')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {companies.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {t('companyOrg.noCompanies', '등록된 회사가 없습니다.')}
              </div>
            ) : (
              companies.map((company) => {
                const orgs = getOrgsForCompany(company.id);
                const isExpanded = expandedCompanies.has(company.id);
                
                return (
                  <div key={company.id} className="border rounded-lg">
                    <Collapsible open={isExpanded} onOpenChange={() => toggleCompany(company.id)}>
                      <div className="flex items-center justify-between p-3 bg-muted/50">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="gap-2 h-auto py-1">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <Building2 className="h-4 w-4 text-blue-600" />
                            <span className="font-semibold">{company.name}</span>
                            {company.code && (
                              <Badge variant="outline" className="ml-2 text-xs">{company.code}</Badge>
                            )}
                          </Button>
                        </CollapsibleTrigger>
                        <div className="flex items-center gap-2">
                          <Badge variant={company.isActive ? "default" : "secondary"}>
                            {company.isActive ? t('common.active', '활성') : t('common.inactive', '비활성')}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {t('hierarchy.orgCount', '{{count}}개 조직', { count: orgs.length })}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openCreateDialog('organization', { companyId: company.id })}>
                                <Plus className="h-4 w-4 mr-2" />
                                {t('companyOrg.addOrg', '조직 추가')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEditDialog('company', company)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                {t('common.edit', '수정')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  if (confirm(t('companyOrg.confirmDeleteCompany', '이 회사를 삭제하시겠습니까?'))) {
                                    deleteCompanyMutation.mutate(company.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                {t('common.delete', '삭제')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      
                      <CollapsibleContent>
                        <div className="pl-6 py-2 space-y-2">
                          {orgs.length === 0 ? (
                            <div className="pl-4 py-2 text-sm text-muted-foreground italic">
                              {t('companyOrg.noOrgs', '등록된 조직이 없습니다.')}
                            </div>
                          ) : (
                            orgs.map((org) => {
                              const cats = getCategoriesForOrg(org.id);
                              const isOrgExpanded = expandedOrgs.has(org.id);
                              
                              return (
                                <div key={org.id} className="border rounded-md ml-4">
                                  <Collapsible open={isOrgExpanded} onOpenChange={() => toggleOrg(org.id)}>
                                    <div className="flex items-center justify-between p-2 bg-muted/30">
                                      <CollapsibleTrigger asChild>
                                        <Button variant="ghost" size="sm" className="gap-2 h-auto py-1">
                                          {isOrgExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                          <Users className="h-4 w-4 text-green-600" />
                                          <span className="font-medium">{org.name}</span>
                                          {org.code && (
                                            <Badge variant="outline" className="ml-2 text-xs">{org.code}</Badge>
                                          )}
                                        </Button>
                                      </CollapsibleTrigger>
                                      <div className="flex items-center gap-2">
                                        <Badge variant={org.isActive ? "default" : "secondary"} className="text-xs">
                                          {org.isActive ? t('common.active', '활성') : t('common.inactive', '비활성')}
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                          {t('hierarchy.catCount', '{{count}}개 카테고리', { count: cats.length })}
                                        </span>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-7 w-7">
                                              <MoreHorizontal className="h-4 w-4" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => openCreateDialog('category', { organizationId: org.id, companyId: company.id })}>
                                              <Plus className="h-4 w-4 mr-2" />
                                              {t('hierarchy.addCategory', '카테고리 추가')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => openEditDialog('organization', org)}>
                                              <Pencil className="h-4 w-4 mr-2" />
                                              {t('common.edit', '수정')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              className="text-destructive"
                                              onClick={() => {
                                                if (confirm(t('companyOrg.confirmDeleteOrg', '이 조직을 삭제하시겠습니까?'))) {
                                                  deleteOrgMutation.mutate(org.id);
                                                }
                                              }}
                                            >
                                              <Trash2 className="h-4 w-4 mr-2" />
                                              {t('common.delete', '삭제')}
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    </div>
                                    
                                    <CollapsibleContent>
                                      <div className="pl-8 py-2 space-y-1">
                                        {cats.length === 0 ? (
                                          <div className="py-1 text-sm text-muted-foreground italic">
                                            {t('hierarchy.noCategories', '등록된 카테고리가 없습니다.')}
                                          </div>
                                        ) : (
                                          cats.map((cat) => (
                                            <div key={cat.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/20">
                                              <div className="flex items-center gap-2">
                                                <FolderTree className="h-4 w-4 text-orange-500" />
                                                <span className="text-sm">{cat.name}</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <Badge variant={cat.isActive ? "default" : "secondary"} className="text-xs">
                                                  {cat.isActive ? t('common.active', '활성') : t('common.inactive', '비활성')}
                                                </Badge>
                                                <DropdownMenu>
                                                  <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6">
                                                      <MoreHorizontal className="h-3 w-3" />
                                                    </Button>
                                                  </DropdownMenuTrigger>
                                                  <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => openEditDialog('category', cat)}>
                                                      <Pencil className="h-4 w-4 mr-2" />
                                                      {t('common.edit', '수정')}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                      className="text-destructive"
                                                      onClick={() => {
                                                        if (confirm(t('hierarchy.confirmDeleteCategory', '이 카테고리를 삭제하시겠습니까?'))) {
                                                          deleteCategoryMutation.mutate(cat.id);
                                                        }
                                                      }}
                                                    >
                                                      <Trash2 className="h-4 w-4 mr-2" />
                                                      {t('common.delete', '삭제')}
                                                    </DropdownMenuItem>
                                                  </DropdownMenuContent>
                                                </DropdownMenu>
                                              </div>
                                            </div>
                                          ))
                                        )}
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                );
              })
            )}

            {getUnassignedCategories().length > 0 && (
              <div className="mt-4 border rounded-lg border-dashed">
                <div className="p-3 bg-muted/30">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FolderTree className="h-4 w-4" />
                    <span className="font-medium">{t('hierarchy.unassignedCategories', '미할당 카테고리')}</span>
                    <Badge variant="secondary" className="ml-2">
                      {getUnassignedCategories().length}
                    </Badge>
                  </div>
                </div>
                <div className="p-3 space-y-1">
                  {getUnassignedCategories().map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/20">
                      <div className="flex items-center gap-2">
                        <FolderTree className="h-4 w-4 text-orange-500" />
                        <span className="text-sm">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreHorizontal className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog('category', cat)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              {t('common.edit', '수정')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                if (confirm(t('hierarchy.confirmDeleteCategory', '이 카테고리를 삭제하시겠습니까?'))) {
                                  deleteCategoryMutation.mutate(cat.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t('common.delete', '삭제')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogType !== null} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'edit' 
                ? (dialogType === 'company' ? t('companyOrg.editCompany', '회사 수정') 
                   : dialogType === 'organization' ? t('companyOrg.editOrg', '조직 수정')
                   : t('hierarchy.editCategory', '카테고리 수정'))
                : (dialogType === 'company' ? t('companyOrg.addCompany', '회사 추가')
                   : dialogType === 'organization' ? t('companyOrg.addOrg', '조직 추가')
                   : t('hierarchy.addCategory', '카테고리 추가'))
              }
            </DialogTitle>
            <DialogDescription>
              {dialogType === 'company' ? t('companyOrg.companyFormDesc', '회사 정보를 입력하세요.')
                : dialogType === 'organization' ? t('companyOrg.orgFormDesc', '조직 정보를 입력하세요.')
                : t('hierarchy.categoryFormDesc', '카테고리 정보를 입력하세요.')
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {dialogType === 'organization' && dialogMode === 'create' && (
              <div className="space-y-2">
                <Label>{t('companyOrg.company', '소속 회사')}</Label>
                <Select
                  value={formData.companyId}
                  onValueChange={(value) => setFormData({ ...formData, companyId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('companyOrg.selectCompany', '회사 선택')} />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {dialogType === 'category' && dialogMode === 'create' && (
              <div className="space-y-2">
                <Label>{t('hierarchy.parentOrg', '소속 조직')}</Label>
                <Select
                  value={formData.organizationId}
                  onValueChange={(value) => setFormData({ ...formData, organizationId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('hierarchy.selectOrg', '조직 선택')} />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations.map((org) => {
                      const company = companies.find(c => c.id === org.companyId);
                      return (
                        <SelectItem key={org.id} value={org.id}>
                          {company?.name} &gt; {org.name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="space-y-2">
              <Label>
                {dialogType === 'company' ? t('companyOrg.companyName', '회사명')
                  : dialogType === 'organization' ? t('companyOrg.orgName', '조직명')
                  : t('hierarchy.categoryName', '카테고리명')
                }
              </Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={
                  dialogType === 'company' ? t('companyOrg.companyNamePlaceholder', '예: 삼성전자')
                    : dialogType === 'organization' ? t('companyOrg.orgNamePlaceholder', '예: 개발팀')
                    : t('hierarchy.categoryNamePlaceholder', '예: 영업 시나리오')
                }
              />
            </div>
            
            {(dialogType === 'company' || dialogType === 'organization') && (
              <div className="space-y-2">
                <Label>{t('companyOrg.code', '코드')}</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder={t('companyOrg.codePlaceholder', '예: SAMSUNG')}
                  maxLength={20}
                />
              </div>
            )}
            
            <div className="space-y-2">
              <Label>{t('companyOrg.description', '설명')}</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('companyOrg.descriptionPlaceholder', '간단한 설명')}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('common.cancel', '취소')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.name || isPending}
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {dialogMode === 'edit' ? t('common.save', '저장') : t('common.create', '생성')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
