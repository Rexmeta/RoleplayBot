import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Loader2, Plus, Pencil, Trash2, Languages, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  isActive: boolean;
  isDefault: boolean;
  displayOrder: number;
  createdAt: string;
}

export function LanguageManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLanguage, setEditingLanguage] = useState<SupportedLanguage | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    nativeName: "",
    displayOrder: 99,
  });

  const { data: languages = [], isLoading } = useQuery<SupportedLanguage[]>({
    queryKey: ["/api/admin/languages"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/admin/languages", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/languages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/languages"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "성공", description: "언어가 추가되었습니다." });
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ code, updates }: { code: string; updates: Partial<SupportedLanguage> }) => {
      const res = await apiRequest("PUT", `/api/admin/languages/${code}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/languages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/languages"] });
      setIsDialogOpen(false);
      setEditingLanguage(null);
      resetForm();
      toast({ title: "성공", description: "언어 설정이 수정되었습니다." });
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("DELETE", `/api/admin/languages/${code}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/languages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/languages"] });
      toast({ title: "성공", description: "언어가 삭제되었습니다." });
    },
    onError: (error: Error) => {
      toast({ title: "오류", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ code: "", name: "", nativeName: "", displayOrder: 99 });
  };

  const handleOpenDialog = (language?: SupportedLanguage) => {
    if (language) {
      setEditingLanguage(language);
      setFormData({
        code: language.code,
        name: language.name,
        nativeName: language.nativeName,
        displayOrder: language.displayOrder,
      });
    } else {
      setEditingLanguage(null);
      resetForm();
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.code || !formData.name || !formData.nativeName) {
      toast({ title: "오류", description: "모든 필수 필드를 입력해주세요.", variant: "destructive" });
      return;
    }

    if (editingLanguage) {
      updateMutation.mutate({
        code: editingLanguage.code,
        updates: {
          name: formData.name,
          nativeName: formData.nativeName,
          displayOrder: formData.displayOrder,
        },
      });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleToggleActive = (language: SupportedLanguage) => {
    if (language.isDefault) {
      toast({ title: "오류", description: "기본 언어는 비활성화할 수 없습니다.", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      code: language.code,
      updates: { isActive: !language.isActive },
    });
  };

  const handleDelete = (language: SupportedLanguage) => {
    if (language.isDefault) {
      toast({ title: "오류", description: "기본 언어는 삭제할 수 없습니다.", variant: "destructive" });
      return;
    }
    if (confirm(`"${language.nativeName}" 언어를 삭제하시겠습니까?\n이 언어의 모든 번역 데이터도 함께 삭제됩니다.`)) {
      deleteMutation.mutate(language.code);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">전체 언어</CardTitle>
            <Languages className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{languages.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">활성 언어</CardTitle>
            <Globe className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {languages.filter((l) => l.isActive).length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">기본 언어</CardTitle>
            <Languages className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {languages.find((l) => l.isDefault)?.nativeName || "-"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>지원 언어 관리</CardTitle>
          <Button onClick={() => handleOpenDialog()} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            언어 추가
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>코드</TableHead>
                    <TableHead>이름</TableHead>
                    <TableHead>네이티브 이름</TableHead>
                    <TableHead>순서</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>활성화</TableHead>
                    <TableHead className="text-right">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {languages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        등록된 언어가 없습니다.
                      </TableCell>
                    </TableRow>
                  ) : (
                    languages
                      .sort((a, b) => a.displayOrder - b.displayOrder)
                      .map((language) => (
                        <TableRow key={language.code}>
                          <TableCell className="font-mono">{language.code}</TableCell>
                          <TableCell>{language.name}</TableCell>
                          <TableCell>{language.nativeName}</TableCell>
                          <TableCell>{language.displayOrder}</TableCell>
                          <TableCell>
                            {language.isDefault ? (
                              <Badge variant="default">기본</Badge>
                            ) : language.isActive ? (
                              <Badge variant="secondary">활성</Badge>
                            ) : (
                              <Badge variant="outline">비활성</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={language.isActive}
                              onCheckedChange={() => handleToggleActive(language)}
                              disabled={language.isDefault}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleOpenDialog(language)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(language)}
                                disabled={language.isDefault}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
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

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingLanguage ? "언어 수정" : "새 언어 추가"}
            </DialogTitle>
            <DialogDescription>
              {editingLanguage
                ? "언어 설정을 수정합니다."
                : "새로운 지원 언어를 추가합니다. 언어 코드는 ISO 639-1 표준을 따릅니다."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">언어 코드 *</label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value.toLowerCase() })}
                placeholder="예: ko, en, ja, zh, vi"
                maxLength={10}
                disabled={!!editingLanguage}
              />
              <p className="text-xs text-muted-foreground">
                ISO 639-1 언어 코드 (예: ko=한국어, en=영어, ja=일본어)
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">영어 이름 *</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="예: Korean, English, Japanese"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">네이티브 이름 *</label>
              <Input
                value={formData.nativeName}
                onChange={(e) => setFormData({ ...formData, nativeName: e.target.value })}
                placeholder="예: 한국어, English, 日本語"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">표시 순서</label>
              <Input
                type="number"
                value={formData.displayOrder}
                onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value) || 0 })}
                min={1}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              취소
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingLanguage ? "수정" : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
