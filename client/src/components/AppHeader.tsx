import { Link } from "wouter";
import { UserProfileMenu } from "@/components/UserProfileMenu";

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
  title = "🎭 Roleplay X",
  subtitle = "커뮤니케이션 역량 개발",
  showBackButton = false,
  backHref = "/home",
  backLabel = "홈으로",
  onLogoClick,
  rightContent,
  variant = 'default',
  userName,
  userEmail
}: AppHeaderProps) {
  const LogoContent = (
    <div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600">{subtitle}</p>
    </div>
  );

  if (variant === 'mypage') {
    return (
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(userName || 'User')}&background=6366f1&color=fff&size=80`}
                alt="프로필"
                className="w-16 h-16 rounded-full object-cover"
                data-testid="profile-image"
              />
              <div>
                <h1 className="text-2xl font-bold text-slate-900" data-testid="user-name">
                  {userName || '사용자'}님의 MyPage
                </h1>
                <p className="text-slate-600" data-testid="user-email">{userEmail}</p>
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
                <span className="text-sm">{backLabel}</span>
              </Link>
              <div className="border-l border-slate-300 pl-4">
                <h1 className="text-3xl font-bold text-slate-900" data-testid="page-title">{title}</h1>
                <p className="text-slate-600 mt-2">{subtitle}</p>
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
