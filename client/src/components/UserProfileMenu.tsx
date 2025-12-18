import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { User, LogOut, History, Settings, BarChart3, UserCog, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { ProfileEditDialog } from "./ProfileEditDialog";

const roleConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  admin: { label: "시스템관리자", color: "text-red-700", bgColor: "bg-red-100" },
  operator: { label: "운영자", color: "text-blue-700", bgColor: "bg-blue-100" },
  user: { label: "일반유저", color: "text-slate-600", bgColor: "bg-slate-100" },
};

export function UserProfileMenu() {
  const { logout, user } = useAuth();
  const [showProfileEdit, setShowProfileEdit] = useState(false);

  const { data: categories } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['/api/categories'],
    enabled: !!user?.assignedCategoryId,
  });

  const role = user?.role || "user";
  const roleInfo = roleConfig[role] || roleConfig.user;
  const assignedCategory = categories?.find(c => String(c.id) === String(user?.assignedCategoryId));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center justify-center w-10 h-10 p-0 overflow-hidden rounded-full"
            data-testid="mypage-button"
            title="마이페이지"
          >
            {user?.profileImage ? (
              <img 
                src={user.profileImage} 
                alt="프로필" 
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-4 h-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{user?.name || "사용자"}</p>
              <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {assignedCategory && (
                  <Badge className="bg-green-100 text-green-700 text-xs w-fit" data-testid="menu-category-badge">
                    {assignedCategory.name}
                  </Badge>
                )}
                <Badge className={`${roleInfo.bgColor} ${roleInfo.color} text-xs w-fit`} data-testid="menu-role-badge">
                  {roleInfo.label}
                </Badge>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => window.location.href = '/mypage'}
            data-testid="menu-history"
          >
            <History className="w-4 h-4 mr-2" />
            History
          </DropdownMenuItem>
          
          <DropdownMenuItem
            onClick={() => setShowProfileEdit(true)}
            data-testid="menu-profile-edit"
          >
            <UserCog className="w-4 h-4 mr-2" />
            회원정보 수정
          </DropdownMenuItem>
          
          {user?.role === 'admin' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => window.location.href = '/system-admin'}
                data-testid="menu-system-admin"
              >
                <ShieldCheck className="w-4 h-4 mr-2" />
                시스템 관리자
              </DropdownMenuItem>
            </>
          )}
          
          {(user?.role === 'admin' || user?.role === 'operator') && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => window.location.href = '/admin'}
                data-testid="menu-admin-dashboard"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                운영자 대시보드
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => window.location.href = '/admin-management'}
                data-testid="menu-content-management"
              >
                <Settings className="w-4 h-4 mr-2" />
                콘텐츠 관리
              </DropdownMenuItem>
            </>
          )}
          
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await logout();
              window.location.href = '/';
            }}
            data-testid="menu-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            로그아웃
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {user && (
        <ProfileEditDialog
          open={showProfileEdit}
          onOpenChange={setShowProfileEdit}
          currentUser={{
            id: user.id,
            email: user.email || "",
            name: user.name || "",
            role: user.role,
            profileImage: user.profileImage,
            tier: user.tier,
          }}
        />
      )}
    </>
  );
}
