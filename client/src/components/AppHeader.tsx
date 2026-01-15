import { Link } from "wouter";
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
  
  const displayTitle = title || `🎭 ${t('common.appName')}`;
  const displaySubtitle = subtitle || t('common.tagline');
  const displayBackLabel = backLabel || t('nav.backToHome');

  const LogoContent = (
    <div>
      <h1 className="text-xl font-bold text-slate-900">{displayTitle}</h1>
      <p className="text-sm text-slate-600">{displaySubtitle}</p>
    </div>
  );

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
                <h1 className="text-3xl font-bold text-slate-900" data-testid="page-title">{displayTitle}</h1>
                <p className="text-slate-600 mt-2">{displaySubtitle}</p>
              </div>
            </div>
          ) : onLogoClick ? (
            <button 
              onClick={onLogoClick}
              className="flex items-center space-x-3 hover:opacity-80 transition-opacity cursor-pointer bg-transparent border-none" 
              data-testid="home-link"
            >
              {LogoContent}
            </button>
          ) : (
            <Link 
              href="/home" 
              className="flex items-center space-x-3 hover:opacity-80 transition-opacity" 
              data-testid="home-link"
            >
              {LogoContent}
            </Link>
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
