import { createContext, useContext, useEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ComponentPropsWithoutRef } from 'react';

const MAX_AUTO_HEIGHT = 400;
const AutoResizeTextareaHeight = createContext(MAX_AUTO_HEIGHT);
export const AutoResizeTextareaHeightProvider = AutoResizeTextareaHeight.Provider;

type AutoResizeTextareaProps = ComponentPropsWithoutRef<typeof Textarea>;

export function AutoResizeTextarea({ className, value, ...props }: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const maximumHeight = useContext(AutoResizeTextareaHeight);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = () => {
      el.style.height = 'auto';
      const capped = Math.min(el.scrollHeight, maximumHeight);
      el.style.height = capped + 'px';
      el.style.overflowY = el.scrollHeight > maximumHeight ? 'auto' : 'hidden';
    };
    resize();
    // Section editors stay mounted while hidden; remeasure when they become
    // visible, but ignore our own height changes to avoid observer loops.
    let width = el.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      const nextWidth = el.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; resize(); }
    });
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [value, maximumHeight]);

  return (
    <Textarea
      ref={ref}
      className={cn('resize-none', className)}
      value={value}
      {...props}
    />
  );
}
