import { createPortal } from "react-dom";
import { ChevronUp } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

interface TopMenuPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function TopMenuPanel({ isOpen, onToggle, onClose }: TopMenuPanelProps) {
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
