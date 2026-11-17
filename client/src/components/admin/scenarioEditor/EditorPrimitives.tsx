import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** A titled, self-contained group of related settings inside an editor section. */
export function EditorGroup({ id, title, description, actions, children, flat = false, className }: {
  id?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode;
  children: React.ReactNode; flat?: boolean; className?: string;
}) {
  return (
    <section id={id} className={cx('se-group', flat && 'is-flat', className)}>
      <header className="se-group-head">
        <div className="min-w-0">
          <h3 className="se-group-title">{title}</h3>
          {description && <p className="se-group-desc">{description}</p>}
        </div>
        {actions && <div className="se-group-actions">{actions}</div>}
      </header>
      <div className="se-group-body">{children}</div>
    </section>
  );
}

/** Label + control + help/error, with one consistent vertical rhythm. */
export function Field({ label, htmlFor, hint, error, required, optional, action, children, className }: {
  label: React.ReactNode; htmlFor?: string; hint?: React.ReactNode; error?: React.ReactNode;
  required?: boolean; optional?: boolean; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cx('se-field', className)}>
      <div className="se-field-label">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="se-req" aria-hidden="true">*</span>}
          {optional && <span className="se-opt">선택</span>}
        </Label>
        {action}
      </div>
      {children}
      {error ? <p className="se-field-error">{error}</p> : hint ? <p className="se-field-hint">{hint}</p> : null}
    </div>
  );
}

export function FieldGrid({ cols = 2, children }: { cols?: 2 | 3; children: React.ReactNode }) {
  return <div className={cx('se-grid', cols === 3 && 'is-3')}>{children}</div>;
}

/** Switch with a full-width clickable label and a state-aware explanation. */
export function ToggleRow({ id, label, description, checked, onCheckedChange, icon }: {
  id: string; label: React.ReactNode; description?: React.ReactNode; checked: boolean;
  onCheckedChange: (checked: boolean) => void; icon?: React.ReactNode;
}) {
  return (
    <div className="se-toggle">
      <Label htmlFor={id} className="se-toggle-text">
        <span className="se-toggle-label">{icon}{label}</span>
        {description && <span className="se-toggle-desc">{description}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** Collapsed expert settings. Native details so validation/quality navigation can open it. */
export function AdvancedDisclosure({ summary, description, children, id }: {
  summary: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; id?: string;
}) {
  return (
    <details id={id} className="scenario-editor-advanced se-advanced">
      <summary>
        <span className="se-advanced-title">{summary}</span>
        {description && <span className="se-advanced-desc">{description}</span>}
      </summary>
      <div className="se-advanced-body">{children}</div>
    </details>
  );
}

/** The single consistent AI action. Explains why it is unavailable instead of silently disabling. */
export function AiGenerateButton({ onClick, loading, disabled, blockedReason, label = 'AI 초안', loadingLabel, variant = 'secondary', block, testId }: {
  onClick: () => void; loading: boolean; disabled: boolean; blockedReason?: string; label?: React.ReactNode;
  loadingLabel?: React.ReactNode; variant?: 'primary' | 'secondary'; block?: boolean; testId?: string;
}) {
  const button = (
    <button type="button" onClick={onClick} disabled={disabled} data-testid={testId}
      className={cx('se-ai-button', variant === 'primary' && 'is-primary', block && 'is-block')}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
      <span>{loading ? (loadingLabel ?? '생성 중…') : label}</span>
    </button>
  );
  if (!blockedReason) return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild><span className={block ? 'block w-full' : 'inline-flex'} tabIndex={0}>{button}</span></TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{blockedReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function aiBlockedReason(opts: { needsContext?: boolean; otherRunning?: boolean; contextMessage?: string }) {
  if (opts.needsContext) return opts.contextMessage ?? '시나리오 제목 또는 설명을 먼저 입력해 주세요';
  if (opts.otherRunning) return '다른 AI 생성이 진행 중입니다';
  return undefined;
}
