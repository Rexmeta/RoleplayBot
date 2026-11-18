import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

/**
 * Shared section navigation primitives used by both the full-screen ContentEditor (modal)
 * and the page-level AdminWorkspace. One implementation of: grouped sidebar, mobile chips,
 * previous/next pager, leave confirmation and beforeunload guard.
 */
export type SectionDef = { id: string; label: string; description: string; group: string; icon: typeof FileText };

/** When set, buttons behave as ARIA tabs controlling `${idPrefix}-panel-${id}`. */
export type SectionTabsConfig = { idPrefix: string; testIdPrefix?: string };

type NavProps = {
  sections: readonly SectionDef[]; active: string; onSelect: (id: string) => void; label: string;
  tabs?: SectionTabsConfig; disabled?: boolean;
};

export const sectionTabId = (prefix: string, id: string, mobile = false) => `${prefix}-${mobile ? 'mtab' : 'tab'}-${id}`;
export const sectionPanelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

function SectionButton({ section, active, onSelect, tabs, mobile, disabled }: {
  section: SectionDef; active: boolean; onSelect: (id: string) => void; tabs?: SectionTabsConfig; mobile?: boolean; disabled?: boolean;
}) {
  const Icon = section.icon;
  return <button type="button" data-section-id={section.id} aria-current={active ? 'page' : undefined} disabled={disabled}
    role={tabs ? 'tab' : undefined} aria-selected={tabs ? active : undefined}
    id={tabs ? sectionTabId(tabs.idPrefix, section.id, mobile) : undefined}
    aria-controls={tabs ? sectionPanelId(tabs.idPrefix, section.id) : undefined}
    tabIndex={tabs ? (active ? 0 : -1) : undefined}
    data-testid={tabs?.testIdPrefix !== undefined ? `${mobile ? 'mobile-' : ''}${tabs.testIdPrefix}${section.id}` : undefined}
    onClick={() => onSelect(section.id)}><Icon size={16} aria-hidden="true" /><span>{section.label}</span></button>;
}

/** Arrow/Home/End roving navigation between section buttons. */
function useRovingKeys(sections: readonly SectionDef[], active: string, onSelect: (id: string) => void) {
  return (event: React.KeyboardEvent<HTMLElement>) => {
    const index = sections.findIndex(s => s.id === active);
    const last = sections.length - 1;
    const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? Math.min(index + 1, last)
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? Math.max(index - 1, 0)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    if (next < 0 || !(event.target instanceof HTMLButtonElement)) return;
    event.preventDefault();
    if (next === index) return;
    const container = event.currentTarget;
    const id = sections[next].id;
    onSelect(id);
    requestAnimationFrame(() => container.querySelector<HTMLElement>(`[data-section-id="${id}"]`)?.focus());
  };
}

/** Grouped desktop sidebar. */
export function SectionSidebar({ sections, active, onSelect, label, tabs, disabled }: NavProps) {
  const groups = Array.from(new Set(sections.map(s => s.group)));
  const onKeyDown = useRovingKeys(sections, active, onSelect);
  return <nav className="scenario-editor-nav" aria-label={label} role={tabs ? 'tablist' : undefined}
    aria-orientation={tabs ? 'vertical' : undefined} onKeyDown={onKeyDown}>
    {groups.map(group => <div key={group} role={tabs ? 'presentation' : undefined}>
      <p aria-hidden={tabs ? true : undefined}>{group}</p>
      {sections.filter(s => s.group === group).map(s =>
        <SectionButton key={s.id} section={s} active={active === s.id} onSelect={onSelect} tabs={tabs} disabled={disabled} />)}
    </div>)}
  </nav>;
}

/** Horizontally scrolling chip navigation for narrow screens. */
export function SectionMobileNav({ sections, active, onSelect, label, tabs, disabled }: NavProps) {
  const onKeyDown = useRovingKeys(sections, active, onSelect);
  return <nav className="scenario-editor-mobile" aria-label={label} role={tabs ? 'tablist' : undefined} onKeyDown={onKeyDown}>
    {sections.map(s => <SectionButton key={s.id} section={s} active={active === s.id} onSelect={onSelect} tabs={tabs} mobile disabled={disabled} />)}
  </nav>;
}

/** Previous / position / next controls. */
export function SectionPager({ sections, active, onSelect, disabled }: {
  sections: readonly SectionDef[]; active: string; onSelect: (id: string) => void; disabled?: boolean;
}) {
  const index = Math.max(0, sections.findIndex(s => s.id === active));
  return <>
    <button type="button" className="scenario-editor-button" disabled={disabled || index === 0}
      onClick={() => onSelect(sections[index - 1].id)} data-testid="section-prev"><ChevronLeft size={16} />이전</button>
    <span className="shrink-0 whitespace-nowrap text-xs text-slate-500">{index + 1} / {sections.length}</span>
    <button type="button" className="scenario-editor-button" disabled={disabled || index === sections.length - 1}
      onClick={() => onSelect(sections[index + 1].id)} data-testid="section-next">다음<ChevronRight size={16} /></button>
  </>;
}

/** Focus the section heading and bring the active mobile chip into view after a section change. */
export function focusSectionHeading(root: HTMLElement | null, headingSelector: string) {
  requestAnimationFrame(() => {
    root?.querySelector<HTMLElement>(headingSelector)?.focus({ preventScroll: true });
    root?.querySelector<HTMLElement>('.scenario-editor-mobile [aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
}

export function useBeforeUnloadGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

export function LeaveConfirmDialog({ open, onOpenChange, onConfirm, title = '저장하지 않고 닫을까요?',
  description = '저장하지 않은 변경 내용은 사라집니다. 계속 편집하려면 취소하세요.', confirmLabel = '저장하지 않고 닫기' }: {
  open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void;
  title?: React.ReactNode; description?: React.ReactNode; confirmLabel?: React.ReactNode;
}) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel data-testid="leave-cancel">계속 편집</AlertDialogCancel><AlertDialogAction onClick={onConfirm} data-testid="leave-confirm">{confirmLabel}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
