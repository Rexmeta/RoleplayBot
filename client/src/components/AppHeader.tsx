import { useState } from "react";
import { Link, useLocation } from "wouter";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { useTranslation } from "react-i18next";

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
  const isPersonaMode = location === '/free-chat';
  const [hovered, setHovered] = useState<'roleplay' | 'persona' | null>(null);

  const handleRoleplayClick = () => {
    if (onRoleplayClick) {
      onRoleplayClick();
    } else {
      navigate('/home');
    }
  };

  const handlePersonaClick = () => {
    navigate('/free-chat');
  };

  return (
    <div className="flex items-center">
      <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">
        <button
          onClick={handleRoleplayClick}
          onMouseEnter={() => setHovered('roleplay')}
          onMouseLeave={() => setHovered(null)}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-200
            ${!isPersonaMode
              ? 'bg-white text-slate-900 shadow-sm'
              : hovered === 'roleplay'
                ? 'text-slate-600 bg-slate-200'
                : 'text-slate-400'
            }
          `}
          data-testid="logo-roleplay"
        >
          <span className="text-base">🎭</span>
          <span>RoleplayX</span>
        </button>
        <button
          onClick={handlePersonaClick}
          onMouseEnter={() => setHovered('persona')}
          onMouseLeave={() => setHovered(null)}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-200
            ${isPersonaMode
              ? 'bg-emerald-600 text-white shadow-sm'
              : hovered === 'persona'
                ? 'text-emerald-600 bg-emerald-50'
                : 'text-slate-400'
            }
          `}
          data-testid="logo-persona"
        >
          <span className="text-base">💬</span>
          <span>PersonaX</span>
        </button>
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
  
  const displaySubtitle = subtitle || t('common.tagline');
  const displayBackLabel = backLabel || t('nav.backToHome');

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
            <div className="flex gap-3">
              {rightContent}
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
            <UserProfileMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
