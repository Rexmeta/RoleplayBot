import { useState } from "react";
import { Link, useLocation } from "wouter";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { LayoutDashboard } from "lucide-react";

interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  showBackButton?: boolean;
  backHref?: string;
  backLabel?: string;
  onLogoClick?: () => void;
  rightContent?: React.ReactNode;
  variant?: 'default' | 'mypage';
  userName?: string;
  userEmail?: string;
}

function SwitchingLogo({ onRoleplayClick }: { onRoleplayClick?: () => void }) {
  const [location, navigate] = useLocation();
  const isPersonaMode = location === '/free-chat' || location === '/persona' || location.startsWith('/persona/');
  const [isContainerHovered, setIsContainerHovered] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const handleRoleplayClick = () => {
    if (onRoleplayClick) {
      onRoleplayClick();
    } else {
      navigate('/home');
    }
  };

  const handlePersonaClick = () => {
    navigate('/persona');
  };

  return (
    <div
      className="flex items-center"
      onMouseEnter={() => setIsContainerHovered(true)}
      onMouseLeave={() => setIsContainerHovered(false)}
    >
      <div className={`flex items-center rounded-xl p-1 gap-0.5 transition-all duration-200 ${isContainerHovered ? 'bg-slate-100' : 'bg-transparent'}`}>
        {/* RoleplayX: hover시 항상 보임 / 기본은 PersonaX모드가 아닐 때만 */}
        <button
          onClick={handleRoleplayClick}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-200
            ${!isPersonaMode
              ? 'bg-white text-slate-900 shadow-sm'
              : isContainerHovered
                ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                : 'hidden'
            }
          `}
          data-testid="logo-roleplay"
        >
          <span className="text-base">🎭</span>
          <span>RoleplayX</span>
        </button>
        {/* PersonaX: 시스템 관리자(admin)에게만 노출 */}
        {isAdmin && (
          <button
            onClick={handlePersonaClick}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-200
              ${isPersonaMode
                ? 'bg-emerald-600 text-white shadow-sm'
                : isContainerHovered
                  ? 'text-emerald-600 hover:bg-emerald-50'
                  : 'hidden'
              }
            `}
            data-testid="logo-persona"
          >
            <span className="text-base">💬</span>
            <span>PersonaX</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function AppHeader({
  title,
  subtitle,
  showBackButton = false,
  backHref = "/home",
  backLabel,
  onLogoClick,
  rightContent,
  variant = 'default',
  userName,
  userEmail
}: AppHeaderProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  
  const displaySubtitle = subtitle || t('common.tagline');
  const displayBackLabel = backLabel || t('nav.backToHome');
  const isAdminOrOperator = user?.role === 'admin' || user?.role === 'operator';

  if (variant === 'mypage') {
    return (
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link 
                href="/home" 
                className="flex items-center space-x-2 text-corporate-600 hover:text-corporate-700" 
                data-testid="back-to-home"
              >
                <i className="fas fa-arrow-left"></i>
                <span className="text-sm">{t('nav.backToHome')}</span>
              </Link>
              <div className="border-l border-slate-300 pl-4">
                <h1 className="text-sm font-bold text-slate-900" data-testid="user-name">
                  {userName || t('common.user')}{t('mypage.titleSuffix')}
                </h1>
                <p className="text-xs text-slate-600" data-testid="user-email">{userEmail}</p>
              </div>
            </div>
            <div className="flex gap-3 items-center">
              {rightContent}
              {isAdminOrOperator && (
                <Link
                  href="/admin-management"
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-corporate-600 border border-corporate-200 bg-corporate-50 hover:bg-corporate-100 hover:border-corporate-400 rounded-full transition-all duration-200 shadow-sm"
                  data-testid="content-management-btn"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  콘텐츠 관리
                </Link>
              )}
              <UserProfileMenu />
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {showBackButton ? (
            <div className="flex items-center space-x-4">
              <Link 
                href={backHref} 
                className="flex items-center space-x-2 text-corporate-600 hover:text-corporate-700" 
                data-testid="back-to-home"
              >
                <i className="fas fa-arrow-left"></i>
                <span className="text-sm">{displayBackLabel}</span>
              </Link>
              <div className="border-l border-slate-300 pl-4">
                <SwitchingLogo onRoleplayClick={onLogoClick} />
                <p className="text-slate-600 mt-1 text-sm">{displaySubtitle}</p>
              </div>
            </div>
          ) : (
            <SwitchingLogo onRoleplayClick={onLogoClick} />
          )}
          <div className="flex items-center space-x-2">
            {rightContent}
            {isAdminOrOperator && (
              <Link
                href="/admin-management"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-corporate-600 border border-corporate-200 bg-corporate-50 hover:bg-corporate-100 hover:border-corporate-400 rounded-full transition-all duration-200 shadow-sm"
                data-testid="content-management-btn"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                콘텐츠 관리
              </Link>
            )}
            <UserProfileMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
