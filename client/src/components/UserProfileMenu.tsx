import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { User, LogOut, History, Settings, BarChart3, UserCog, ShieldCheck, Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { ProfileEditDialog } from "./ProfileEditDialog";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type LanguageCode } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const roleConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  admin: { label: "시스템관리자", color: "text-red-700", bgColor: "bg-red-100" },
  operator: { label: "운영자", color: "text-blue-700", bgColor: "bg-blue-100" },
  user: { label: "일반유저", color: "text-slate-600", bgColor: "bg-slate-100" },
};

export function UserProfileMenu() {
  const { logout, user } = useAuth();
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const { i18n, t } = useTranslation();
  const { toast } = useToast();

  const { data: categories } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['/api/categories'],
    enabled: !!user?.assignedCategoryId,
  });

  const updateLanguageMutation = useMutation({
    mutationFn: async (language: LanguageCode) => {
      const response = await apiRequest('PATCH', '/api/auth/user/language', { language });
      if (!response.ok) {
        throw new Error('Failed to update language');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.refetchQueries({ queryKey: ['/api/scenarios'], type: 'active' });
      queryClient.refetchQueries({ queryKey: ['/api/categories'], type: 'active' });
      queryClient.refetchQueries({ queryKey: ['/api/admin/scenarios'], type: 'active' });
    },
  });

  const handleLanguageChange = async (langCode: LanguageCode) => {
    if (!user) {
      i18n.changeLanguage(langCode);
      localStorage.setItem('preferredLanguage', langCode);
      return;
    }
    
    const previousLang = i18n.language;
    i18n.changeLanguage(langCode);
    localStorage.setItem('preferredLanguage', langCode);
    
    try {
      await updateLanguageMutation.mutateAsync(langCode);
    } catch (error) {
      i18n.changeLanguage(previousLang);
      localStorage.setItem('preferredLanguage', previousLang);
      toast({
        title: t('common.error'),
        description: t('settings.languageUpdateFailed'),
        variant: "destructive"
      });
    }
  };

  const currentLang = SUPPORTED_LANGUAGES.find(lang => lang.code === i18n.language) || SUPPORTED_LANGUAGES[0];
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
            {t('mypage.profile') || '회원정보 수정'}
          </DropdownMenuItem>
          
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="menu-language">
              <Globe className="w-4 h-4 mr-2" />
              <span>{t('common.language')}</span>
              <span className="ml-auto text-xs opacity-60">{currentLang.flag}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <DropdownMenuItem
                  key={lang.code}
                  onClick={() => handleLanguageChange(lang.code)}
                  className={i18n.language === lang.code ? 'bg-slate-100' : ''}
                  data-testid={`menu-language-${lang.code}`}
                >
                  <span className="mr-2">{lang.flag}</span>
                  <span>{lang.name}</span>
                  {i18n.language === lang.code && (
                    <span className="ml-auto text-green-500">✓</span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          
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
            {t('common.logout')}
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
