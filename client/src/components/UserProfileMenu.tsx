import { useState } from "react";
import { Button } from "@/components/ui/button";
import { User, LogOut, History, Settings, BarChart3, UserCog } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { ProfileEditDialog } from "./ProfileEditDialog";

export function UserProfileMenu() {
  const { logout, user } = useAuth();
  const [showProfileEdit, setShowProfileEdit] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center justify-center w-10 h-10"
            data-testid="mypage-button"
            title="마이페이지"
          >
            <User className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
          }}
        />
      )}
    </>
  );
}
