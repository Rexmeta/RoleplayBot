import { useEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ComponentPropsWithoutRef } from 'react';

const MAX_AUTO_HEIGHT = 400;

type AutoResizeTextareaProps = ComponentPropsWithoutRef<typeof Textarea>;

export function AutoResizeTextarea({ className, value, ...props }: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const capped = Math.min(el.scrollHeight, MAX_AUTO_HEIGHT);
    el.style.height = capped + 'px';
    el.style.overflowY = el.scrollHeight > MAX_AUTO_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  return (
    <Textarea
      ref={ref}
      className={cn('resize-none', className)}
      value={value}
      {...props}
    />
  );
}
