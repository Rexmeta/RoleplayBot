import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Info, X } from 'lucide-react';
import {
  focusSectionHeading, LeaveConfirmDialog, SectionMobileNav, SectionPager, SectionSidebar,
  sectionPanelId, sectionTabId, useBeforeUnloadGuard, type SectionDef,
} from './sectionNavigation';
import '../scenarioEditor/scenario-editor.css';

/**
 * `view`: a hub of independent actions (tables, toggles that save immediately, dialogs). No page-level Save.
 * `form`: the section holds drafts that the page saves explicitly (see `headerActions`).
 */
export type WorkspaceSectionDef = SectionDef & { kind?: 'view' | 'form' };

type PanelContext = { active: string; mounted: ReadonlySet<string>; idPrefix: string };
const Panels = createContext<PanelContext | null>(null);

/**
 * Section content. Only the active section is mounted, plus (with `keepVisited`) sections already
 * visited, so costly/provider panels are never eagerly mounted and drafts in visited panels survive.
 */
export function WorkspacePanel({ id, children, className = 'space-y-6' }: { id: string; children: React.ReactNode; className?: string }) {
  const ctx = useContext(Panels);
  if (!ctx) return <>{children}</>;
  const isActive = ctx.active === id;
  if (!isActive && !ctx.mounted.has(id)) return null;
  return <div role="tabpanel" id={sectionPanelId(ctx.idPrefix, id)} aria-labelledby={sectionTabId(ctx.idPrefix, id)}
    hidden={!isActive} data-workspace-panel={id} className={className}>{children}</div>;
}

type Target = { kind: 'section'; id: string } | { kind: 'close' };

export type AdminWorkspaceProps = {
  title: string; breadcrumb: string; sections: readonly WorkspaceSectionDef[];
  active: string; onActiveChange: (id: string) => void;
  /** Close/back action. Defaults to browser history back (or home). */
  onClose?: () => void; closeLabel?: string;
  /** Unsaved drafts that would be lost by leaving the current section or page. */
  dirty?: boolean; dirtyLabel?: string;
  /** A save is running: navigation and close are blocked until it settles. */
  pending?: boolean;
  /** Called after the user confirms discarding drafts; restore drafts to their clean baseline here. */
  onDiscard?: (sectionId: string) => void;
  /** Keep visited sections mounted (hidden) instead of unmounting them. */
  keepVisited?: boolean;
  headerActions?: React.ReactNode; sectionActions?: React.ReactNode;
  /** Rendered between the section heading and its content (filters, notices). */
  toolbar?: React.ReactNode;
  /** Overrides the footer explanation for the active section. */
  footerNote?: React.ReactNode;
  /** Hides the active section title and description above its content. */
  hideSectionHeading?: boolean;
  idPrefix?: string; testId?: string; children: React.ReactNode;
};

const defaultClose = () => {
  if (window.history.length > 1) window.history.back();
  else window.location.assign('/');
};

export function AdminWorkspace({ title, breadcrumb, sections, active, onActiveChange, onClose = defaultClose, closeLabel = '닫기',
  dirty = false, dirtyLabel = '저장하지 않은 변경 사항', pending = false, onDiscard, keepVisited = false,
  headerActions, sectionActions, toolbar, footerNote, hideSectionHeading = false,
  idPrefix = 'workspace', testId, children }: AdminWorkspaceProps) {
  const root = useRef<HTMLDivElement>(null);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([active]));
  const [target, setTarget] = useState<Target | null>(null);
  const section = sections.find(s => s.id === active) ?? sections[0];
  const isForm = section.kind === 'form';
  useBeforeUnloadGuard(dirty || pending);

  // AppHeader is independently sticky. Measure it instead of assuming a fixed height:
  // language, zoom, and responsive actions can all change the available top offset.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const appHeader = node.previousElementSibling;
    const workspaceHeader = node.querySelector<HTMLElement>(':scope > header');
    const measure = () => {
      const appHeight = appHeader instanceof HTMLElement && getComputedStyle(appHeader).position === 'sticky'
        ? appHeader.getBoundingClientRect().height : 0;
      node.style.setProperty('--workspace-app-header-height', `${appHeight}px`);
      node.style.setProperty('--workspace-header-height', `${workspaceHeader?.getBoundingClientRect().height ?? 0}px`);
      node.style.scrollMarginTop = `${appHeight}px`;
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (appHeader) observer?.observe(appHeader);
    if (workspaceHeader) observer?.observe(workspaceHeader);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    if (keepVisited) setVisited(prev => prev.has(active) ? prev : new Set(prev).add(active));
  }, [active, keepVisited]);

  const commit = (next: Target) => {
    if (next.kind === 'close') { onClose(); return; }
    if (next.id === active) return;
    onActiveChange(next.id);
    root.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    focusSectionHeading(root.current, '[data-workspace-heading]');
  };
  const request = (next: Target) => {
    if (pending) return;
    if (next.kind === 'section' && next.id === active) return;
    if (dirty) { setTarget(next); return; }
    commit(next);
  };
  const discardAndContinue = () => {
    const next = target;
    setTarget(null);
    onDiscard?.(active);
    // Remount the discarded section fresh next time so no stale draft survives.
    setVisited(prev => { const copy = new Set(prev); copy.delete(active); return copy; });
    if (next) commit(next);
  };
  const select = (id: string) => request({ kind: 'section', id });
  const tabs = { idPrefix, testIdPrefix: 'tab-' };
  const status = pending ? '저장 중…' : dirty ? dirtyLabel : isForm ? '변경 없음' : '조회 및 개별 작업';
  const footer = footerNote ?? (pending
    ? '저장이 끝날 때까지 이동할 수 없습니다.'
    : dirty ? <>저장하지 않은 변경 사항이 있습니다. 이동하면 확인을 요청합니다.</>
    : isForm ? <><Check size={15} />저장된 상태입니다.</>
    : <><Info size={15} />이 화면에는 일괄 저장이 없습니다. 각 항목은 해당 버튼으로 바로 저장됩니다.</>);

  return <div ref={root} className="admin-workspace" data-testid={testId}>
    <header className="scenario-editor-header">
      <div className="scenario-editor-bar">
        <div className="min-w-0 flex-1">
          <div className="scenario-editor-breadcrumb">{breadcrumb} <ChevronRight size={12} aria-hidden="true" /> {section.group}</div>
          <h1 className="scenario-editor-title">{title}</h1>
        </div>
        <span className={`scenario-editor-status ${dirty ? 'is-dirty' : ''}`} role="status" data-testid="workspace-status">{status}</span>
        {headerActions}
        <button type="button" className="scenario-editor-button" onClick={() => request({ kind: 'close' })} disabled={pending}
          aria-label={closeLabel} data-testid="workspace-close"><X size={16} aria-hidden="true" /><span className="hidden sm:inline">{closeLabel}</span></button>
      </div>
      <SectionMobileNav sections={sections} active={section.id} onSelect={select} label={`${title} 섹션`} tabs={tabs} disabled={pending} />
    </header>
    <div className="admin-workspace-body">
      <div className="scenario-editor-layout">
        <SectionSidebar sections={sections} active={section.id} onSelect={select} label={`${title} 섹션`} tabs={tabs} disabled={pending} />
        <main className="scenario-editor-main">
          {(!hideSectionHeading || sectionActions) && <div className="scenario-editor-heading">
            {!hideSectionHeading && <div className="min-w-0">
              <h2 data-workspace-heading tabIndex={-1}>{section.label}</h2>
              <p>{section.description}</p>
            </div>}
            {sectionActions && <div className="flex shrink-0 flex-wrap items-center gap-2">{sectionActions}</div>}
          </div>}
          {toolbar && <div className="admin-workspace-toolbar">{toolbar}</div>}
          <Panels.Provider value={{ active: section.id, mounted: keepVisited ? visited : new Set(), idPrefix }}>
            {children}
          </Panels.Provider>
        </main>
      </div>
    </div>
    <footer className="scenario-editor-footer">
      <div className="admin-workspace-footer-inner">
        <span className="scenario-editor-footer-status">{footer}</span>
        <div className="flex items-center gap-2">
          <SectionPager sections={sections} active={section.id} onSelect={select} disabled={pending} />
        </div>
      </div>
    </footer>
    <LeaveConfirmDialog open={!!target} onOpenChange={open => { if (!open) setTarget(null); }} onConfirm={discardAndContinue}
      title={target?.kind === 'close' ? '저장하지 않고 닫을까요?' : '저장하지 않고 이동할까요?'}
      description={`'${section.label}'에서 저장하지 않은 변경 내용은 사라집니다. 계속 편집하려면 취소하세요.`}
      confirmLabel={target?.kind === 'close' ? '저장하지 않고 닫기' : '저장하지 않고 이동'} />
  </div>;
}
