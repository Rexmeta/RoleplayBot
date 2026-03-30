import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Menu, X } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

interface TopMenuPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function TopMenuPanel({ isOpen, onToggle, onClose }: TopMenuPanelProps) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (isMobile) {
    return createPortal(
      <>
        {isOpen && (
          <div
            className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
        )}

        <div
          className={`fixed bottom-0 left-0 right-0 z-[9999] bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
            isOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 bg-slate-300 rounded-full" />
          </div>
          <AppHeader />
        </div>

        <button
          onClick={onToggle}
          data-testid="button-toggle-top-menu"
          title={isOpen ? '메뉴 닫기' : '메뉴 열기'}
          className={`fixed right-4 z-[9999] w-12 h-12 flex items-center justify-center rounded-full shadow-lg transition-all duration-200 active:scale-95 ${
            isOpen
              ? 'bg-emerald-500 text-white'
              : 'bg-white/90 backdrop-blur text-slate-600 border border-slate-200'
          }`}
          style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </>,
      document.body
    );
  }

  return createPortal(
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[9998]"
          onClick={onClose}
        />
      )}
      <div
        className={`fixed left-0 right-0 top-0 z-[9999] shadow-lg transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <AppHeader />
      </div>
      <button
        onClick={onToggle}
        data-testid="button-toggle-top-menu"
        title={isOpen ? '메뉴 닫기' : '메뉴 열기'}
        className={`fixed top-0 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center justify-center gap-[3px] px-5 h-[18px] rounded-b-xl shadow-md transition-all duration-200 border border-t-0 group
          ${isOpen
            ? 'bg-emerald-500 border-emerald-400'
            : 'bg-white/90 backdrop-blur border-slate-200 hover:bg-emerald-50 hover:border-emerald-300'
          }`}
      >
        {isOpen ? (
          <ChevronUp className="w-3 h-3 text-white" />
        ) : (
          <>
            <span className="w-4 h-[1.5px] bg-slate-400 group-hover:bg-emerald-500 rounded-full transition-colors" />
            <span className="w-4 h-[1.5px] bg-slate-400 group-hover:bg-emerald-500 rounded-full transition-colors" />
            <span className="w-4 h-[1.5px] bg-slate-400 group-hover:bg-emerald-500 rounded-full transition-colors" />
          </>
        )}
      </button>
    </>,
    document.body
  );
}
