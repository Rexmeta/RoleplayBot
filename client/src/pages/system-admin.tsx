import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Search, Users, Shield, UserCog, Loader2, User } from "lucide-react";
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
  createdAt: string;
  updatedAt: string;
}

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
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [editFormData, setEditFormData] = useState<{
    role: string;
    tier: string;
    isActive: boolean;
  }>({ role: "", tier: "", isActive: true });

  const { data: users = [], isLoading } = useQuery<UserData[]>({
    queryKey: ["/api/system-admin/users"],
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

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === "all" || user.role === roleFilter;
    const matchesTier = tierFilter === "all" || user.tier === tierFilter;
    return matchesSearch && matchesRole && matchesTier;
  });

  const openEditDialog = (user: UserData) => {
    setEditingUser(user);
    setEditFormData({
      role: user.role,
      tier: user.tier,
      isActive: user.isActive,
    });
  };

  const handleSaveUser = () => {
    if (!editingUser) return;

    const updates: any = {};
    if (editFormData.role !== editingUser.role) updates.role = editFormData.role;
    if (editFormData.tier !== editingUser.tier) updates.tier = editFormData.tier;
    if (editFormData.isActive !== editingUser.isActive) updates.isActive = editFormData.isActive;

    if (Object.keys(updates).length === 0) {
      toast({
        title: "알림",
        description: "변경된 내용이 없습니다.",
      });
      return;
    }

    updateUserMutation.mutate({ id: editingUser.id, updates });
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
        subtitle="사용자 계정 및 권한 관리"
        showBackButton
      />

      <div className="container mx-auto p-6 space-y-6" data-testid="system-admin-page">
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

            {isLoading ? (
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
                      <TableHead>등급</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead>최근 접속</TableHead>
                      <TableHead>가입일</TableHead>
                      <TableHead className="w-[80px]">관리</TableHead>
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
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(user.createdAt), "yyyy-MM-dd", { locale: ko })}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(user)}
                              data-testid={`button-edit-${user.id}`}
                            >
                              수정
                            </Button>
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
      </div>

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
    </div>
  );
}
