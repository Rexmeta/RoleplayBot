import { useState } from "react";
import { Button } from "@/components/ui/button";
import { User, LogOut, History, Settings, BarChart3, UserCog } from "lucide-react";
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

const tierConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  bronze: { label: "브론즈", color: "text-amber-700", bgColor: "bg-amber-100" },
  silver: { label: "실버", color: "text-slate-600", bgColor: "bg-slate-100" },
  gold: { label: "골드", color: "text-yellow-600", bgColor: "bg-yellow-100" },
  platinum: { label: "플래티넘", color: "text-cyan-600", bgColor: "bg-cyan-100" },
  diamond: { label: "다이아몬드", color: "text-purple-600", bgColor: "bg-purple-100" },
};

export function UserProfileMenu() {
  const { logout, user } = useAuth();
  const [showProfileEdit, setShowProfileEdit] = useState(false);

  const tier = user?.tier || "bronze";
  const tierInfo = tierConfig[tier] || tierConfig.bronze;

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
              <Badge className={`${tierInfo.bgColor} ${tierInfo.color} text-xs mt-1 w-fit`} data-testid="menu-tier-badge">
                {tierInfo.label}
              </Badge>
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
          
          {(user?.role === 'admin' || user?.role === 'operator') && (
            <>
              <DropdownMenuSeparator />
              {user?.role === 'admin' && (
                <DropdownMenuItem
                  onClick={() => window.location.href = '/admin'}
                  data-testid="menu-admin-dashboard"
                >
                  <BarChart3 className="w-4 h-4 mr-2" />
                  관리자 대시보드
                </DropdownMenuItem>
              )}
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
