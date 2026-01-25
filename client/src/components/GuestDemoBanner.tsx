import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useState } from "react";

export function GuestDemoBanner() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(false);

  if (!user?.isGuest || dismissed) return null;

  const handleRegister = async () => {
    await logout();
    setLocation("/auth");
  };

  if (user.hasCompletedDemo) {
    return (
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🎉</span>
            <div>
              <p className="font-semibold">{t('guest.demoCompleted')}</p>
              <p className="text-sm text-white/90">{t('guest.demoCompletedDesc')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRegister}
              className="bg-white text-orange-600 hover:bg-orange-50"
            >
              {t('guest.registerNow')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white px-4 py-2 shadow-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">{t('guest.demoBanner')}</span>
          <span className="text-sm text-white/80 hidden sm:inline">
            {t('guest.demoBannerDesc')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRegister}
            className="text-white hover:bg-white/20"
          >
            {t('guest.registerNow')}
          </Button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1 hover:bg-white/20 rounded-full transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
