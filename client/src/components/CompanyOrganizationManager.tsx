import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, Pencil, Trash2, Building2, Users, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Company {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

interface Organization {
  id: string;
  name: string;
  code: string;
  description: string | null;
  companyId: string;
  isActive: boolean;
  createdAt: string;
}

export function CompanyOrganizationManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState("companies");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  
  const [isCompanyDialogOpen, setIsCompanyDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyFormData, setCompanyFormData] = useState({
    name: "",
    code: "",
    description: "",
  });

  const [isOrgDialogOpen, setIsOrgDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [orgFormData, setOrgFormData] = useState({
    name: "",
    code: "",
    description: "",
    companyId: "",
  });

  const { data: companies = [], isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const { data: organizations = [], isLoading: orgsLoading } = useQuery<Organization[]>({
    queryKey: ["/api/organizations", selectedCompanyId],
    queryFn: async () => {
      const url = selectedCompanyId 
        ? `/api/organizations?companyId=${selectedCompanyId}` 
        : "/api/organizations";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data: typeof companyFormData) => {
      const res = await apiRequest("POST", "/api/companies", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/companies"] });
      setIsCompanyDialogOpen(false);
      resetCompanyForm();
      toast({ title: t('common.success', '성공'), description: t('companyOrg.companyCreated', '회사가 생성되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const updateCompanyMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Company> }) => {
      const res = await apiRequest("PUT", `/api/companies/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/companies"] });
      setIsCompanyDialogOpen(false);
      setEditingCompany(null);
      resetCompanyForm();
      toast({ title: t('common.success', '성공'), description: t('companyOrg.companyUpdated', '회사 정보가 수정되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/companies/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/companies"] });
      toast({ title: t('common.success', '성공'), description: t('companyOrg.companyDeleted', '회사가 삭제되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const createOrgMutation = useMutation({
    mutationFn: async (data: typeof orgFormData) => {
      const res = await apiRequest("POST", "/api/organizations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/organizations"] });
      setIsOrgDialogOpen(false);
      resetOrgForm();
      toast({ title: t('common.success', '성공'), description: t('companyOrg.orgCreated', '조직이 생성되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Organization> }) => {
      const res = await apiRequest("PUT", `/api/organizations/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/organizations"] });
      setIsOrgDialogOpen(false);
      setEditingOrg(null);
      resetOrgForm();
      toast({ title: t('common.success', '성공'), description: t('companyOrg.orgUpdated', '조직 정보가 수정되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/organizations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/organizations"] });
      toast({ title: t('common.success', '성공'), description: t('companyOrg.orgDeleted', '조직이 삭제되었습니다.') });
    },
    onError: (error: Error) => {
      toast({ title: t('common.error', '오류'), description: error.message, variant: "destructive" });
    },
  });

  const resetCompanyForm = () => {
    setCompanyFormData({ name: "", code: "", description: "" });
  };

  const resetOrgForm = () => {
    setOrgFormData({ name: "", code: "", description: "", companyId: "" });
  };

  const handleEditCompany = (company: Company) => {
    setEditingCompany(company);
    setCompanyFormData({
      name: company.name,
      code: company.code,
      description: company.description || "",
    });
    setIsCompanyDialogOpen(true);
  };

  const handleEditOrg = (org: Organization) => {
    setEditingOrg(org);
    setOrgFormData({
      name: org.name,
      code: org.code,
      description: org.description || "",
      companyId: org.companyId,
    });
    setIsOrgDialogOpen(true);
  };

  const handleCompanySubmit = () => {
    if (editingCompany) {
      updateCompanyMutation.mutate({ id: editingCompany.id, updates: companyFormData });
    } else {
      createCompanyMutation.mutate(companyFormData);
    }
  };

  const handleOrgSubmit = () => {
    if (editingOrg) {
      updateOrgMutation.mutate({ id: editingOrg.id, updates: orgFormData });
    } else {
      createOrgMutation.mutate(orgFormData);
    }
  };

  const toggleCompanyActive = (company: Company) => {
    updateCompanyMutation.mutate({ id: company.id, updates: { isActive: !company.isActive } });
  };

  const toggleOrgActive = (org: Organization) => {
    updateOrgMutation.mutate({ id: org.id, updates: { isActive: !org.isActive } });
  };

  const getCompanyName = (companyId: string) => {
    const company = companies.find(c => c.id === companyId);
    return company?.name || companyId;
  };

  if (companiesLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t('companyOrg.title', '회사 및 조직 관리')}
          </CardTitle>
          <CardDescription>
            {t('companyOrg.description', '3단계 계층 구조(회사 > 조직 > 카테고리)를 관리합니다.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="companies" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                {t('companyOrg.companies', '회사')}
              </TabsTrigger>
              <TabsTrigger value="organizations" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t('companyOrg.organizations', '조직')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="companies" className="space-y-4 mt-4">
              <div className="flex justify-between items-center">
                <div className="text-sm text-muted-foreground">
                  {t('companyOrg.totalCompanies', '총 {{count}}개 회사', { count: companies.length })}
                </div>
                <Button
                  onClick={() => {
                    resetCompanyForm();
                    setEditingCompany(null);
                    setIsCompanyDialogOpen(true);
                  }}
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('companyOrg.addCompany', '회사 추가')}
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('companyOrg.companyName', '회사명')}</TableHead>
                    <TableHead>{t('companyOrg.code', '코드')}</TableHead>
                    <TableHead>{t('companyOrg.status', '상태')}</TableHead>
                    <TableHead className="text-right">{t('common.actions', '작업')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium">{company.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{company.code}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={company.isActive}
                          onCheckedChange={() => toggleCompanyActive(company)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditCompany(company)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm(t('companyOrg.confirmDeleteCompany', '이 회사를 삭제하시겠습니까? 하위 조직도 함께 삭제됩니다.'))) {
                                deleteCompanyMutation.mutate(company.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {companies.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        {t('companyOrg.noCompanies', '등록된 회사가 없습니다.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="organizations" className="space-y-4 mt-4">
              <div className="flex flex-wrap justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                  <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder={t('companyOrg.selectCompany', '회사 선택')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{t('companyOrg.allCompanies', '모든 회사')}</SelectItem>
                      {companies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">
                    {t('companyOrg.totalOrgs', '총 {{count}}개 조직', { count: organizations.length })}
                  </span>
                </div>
                <Button
                  onClick={() => {
                    resetOrgForm();
                    setEditingOrg(null);
                    if (selectedCompanyId) {
                      setOrgFormData(prev => ({ ...prev, companyId: selectedCompanyId }));
                    }
                    setIsOrgDialogOpen(true);
                  }}
                  size="sm"
                  disabled={companies.length === 0}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('companyOrg.addOrg', '조직 추가')}
                </Button>
              </div>

              {orgsLoading ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('companyOrg.orgName', '조직명')}</TableHead>
                      <TableHead>{t('companyOrg.code', '코드')}</TableHead>
                      <TableHead>{t('companyOrg.company', '소속 회사')}</TableHead>
                      <TableHead>{t('companyOrg.status', '상태')}</TableHead>
                      <TableHead className="text-right">{t('common.actions', '작업')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {organizations.map((org) => (
                      <TableRow key={org.id}>
                        <TableCell className="font-medium">{org.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{org.code}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Building2 className="h-3 w-3" />
                            {getCompanyName(org.companyId)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={org.isActive}
                            onCheckedChange={() => toggleOrgActive(org)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditOrg(org)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm(t('companyOrg.confirmDeleteOrg', '이 조직을 삭제하시겠습니까?'))) {
                                  deleteOrgMutation.mutate(org.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {organizations.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          {t('companyOrg.noOrgs', '등록된 조직이 없습니다.')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={isCompanyDialogOpen} onOpenChange={setIsCompanyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCompany ? t('companyOrg.editCompany', '회사 수정') : t('companyOrg.addCompany', '회사 추가')}
            </DialogTitle>
            <DialogDescription>
              {t('companyOrg.companyFormDesc', '회사 정보를 입력하세요.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('companyOrg.companyName', '회사명')}</Label>
              <Input
                value={companyFormData.name}
                onChange={(e) => setCompanyFormData({ ...companyFormData, name: e.target.value })}
                placeholder={t('companyOrg.companyNamePlaceholder', '예: 삼성전자')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('companyOrg.code', '코드')}</Label>
              <Input
                value={companyFormData.code}
                onChange={(e) => setCompanyFormData({ ...companyFormData, code: e.target.value.toUpperCase() })}
                placeholder={t('companyOrg.codePlaceholder', '예: SAMSUNG')}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('companyOrg.description', '설명')}</Label>
              <Input
                value={companyFormData.description}
                onChange={(e) => setCompanyFormData({ ...companyFormData, description: e.target.value })}
                placeholder={t('companyOrg.descriptionPlaceholder', '회사에 대한 간단한 설명')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCompanyDialogOpen(false)}>
              {t('common.cancel', '취소')}
            </Button>
            <Button
              onClick={handleCompanySubmit}
              disabled={!companyFormData.name || !companyFormData.code || createCompanyMutation.isPending || updateCompanyMutation.isPending}
            >
              {(createCompanyMutation.isPending || updateCompanyMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingCompany ? t('common.save', '저장') : t('common.create', '생성')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isOrgDialogOpen} onOpenChange={setIsOrgDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingOrg ? t('companyOrg.editOrg', '조직 수정') : t('companyOrg.addOrg', '조직 추가')}
            </DialogTitle>
            <DialogDescription>
              {t('companyOrg.orgFormDesc', '조직 정보를 입력하세요.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('companyOrg.company', '소속 회사')}</Label>
              <Select
                value={orgFormData.companyId}
                onValueChange={(value) => setOrgFormData({ ...orgFormData, companyId: value })}
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
            <div className="space-y-2">
              <Label>{t('companyOrg.orgName', '조직명')}</Label>
              <Input
                value={orgFormData.name}
                onChange={(e) => setOrgFormData({ ...orgFormData, name: e.target.value })}
                placeholder={t('companyOrg.orgNamePlaceholder', '예: 개발팀')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('companyOrg.code', '코드')}</Label>
              <Input
                value={orgFormData.code}
                onChange={(e) => setOrgFormData({ ...orgFormData, code: e.target.value.toUpperCase() })}
                placeholder={t('companyOrg.codePlaceholder', '예: DEV')}
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('companyOrg.description', '설명')}</Label>
              <Input
                value={orgFormData.description}
                onChange={(e) => setOrgFormData({ ...orgFormData, description: e.target.value })}
                placeholder={t('companyOrg.descriptionPlaceholder', '조직에 대한 간단한 설명')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOrgDialogOpen(false)}>
              {t('common.cancel', '취소')}
            </Button>
            <Button
              onClick={handleOrgSubmit}
              disabled={!orgFormData.name || !orgFormData.code || !orgFormData.companyId || createOrgMutation.isPending || updateOrgMutation.isPending}
            >
              {(createOrgMutation.isPending || updateOrgMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingOrg ? t('common.save', '저장') : t('common.create', '생성')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
