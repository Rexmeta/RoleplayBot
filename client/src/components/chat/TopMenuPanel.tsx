import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";

interface TopMenuPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}

const DISMISS_THRESHOLD = 80;
const FLICK_VELOCITY = 0.4;

export function TopMenuPanel({ isOpen, onToggle, onClose }: TopMenuPanelProps) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setDragY(0);
      setIsDragging(false);
    }
  }, [isOpen]);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    setIsDragging(true);
  }

  function handleTouchMove(e: React.TouchEvent) {
    const delta = e.touches[0].clientY - touchStartY.current;
    setDragY(Math.max(0, delta));
  }

  function handleTouchEnd() {
    const elapsed = Date.now() - touchStartTime.current;
    const velocity = dragY / elapsed;

    if (dragY >= DISMISS_THRESHOLD || velocity >= FLICK_VELOCITY) {
      setDragY(0);
      setIsDragging(false);
      onClose();
    } else {
      setDragY(0);
      setIsDragging(false);
    }
  }

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
          className={`fixed bottom-0 left-0 right-0 z-[9999] bg-white rounded-t-2xl shadow-2xl ${
            isDragging ? '' : 'transition-transform duration-300 ease-out'
          } ${isOpen && dragY === 0 ? 'translate-y-0' : !isOpen && dragY === 0 ? 'translate-y-full' : ''}`}
          style={{
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          }}
        >
          <div
            className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing"
            style={{ touchAction: 'none' }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="w-10 h-1 bg-slate-300 rounded-full" />
          </div>
          <AppHeader />
        </div>

        <button
          onClick={onToggle}
          data-testid="button-toggle-top-menu"
          title={isOpen ? '메뉴 닫기' : '메뉴 열기'}
          className={`fixed top-0 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center justify-center gap-[3px] px-6 h-[22px] rounded-b-xl shadow-md transition-all duration-200 border border-t-0 group active:scale-95
            ${isOpen
              ? 'bg-emerald-500 border-emerald-400'
              : 'bg-white/90 backdrop-blur border-slate-200'
            }`}
        >
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-white" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 group-active:text-emerald-500" />
          )}
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
