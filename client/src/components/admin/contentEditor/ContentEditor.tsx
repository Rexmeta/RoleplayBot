import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FileText, Lock, Save, X } from 'lucide-react';
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AutoResizeTextareaHeightProvider } from '@/components/ui/auto-resize-textarea';
import '../scenarioEditor/scenario-editor.css';

/** Section definition shared by every full-screen content editor (scenario, persona, rubric, culture profile). */
export type EditorSectionDef = { id: string; label: string; description: string; group: string; icon: typeof FileText };

type EditorNavigation = { active: string; reveal: (id: string) => void };
const Navigation = createContext<EditorNavigation | null>(null);
export const useContentEditorNavigation = () => useContext(Navigation);
const REVEAL_EVENT = 'scenario-editor-reveal';
export function revealContentEditorTarget(id: string) {
  document.getElementById(id)?.dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true, detail: { id } }));
}

/** Keep every section mounted: local builder state must survive navigation. */
export function ContentEditorRegion({ sections, children, className, id }: {
  sections: string | string[]; children: React.ReactNode; className?: string; id?: string;
}) {
  const navigation = useContentEditorNavigation();
  const allowed: string[] = typeof sections === 'string' ? [sections] : sections;
  const hidden = !!navigation && !allowed.includes(navigation.active);
  return <div id={id} data-scenario-editor-section={allowed[0]} hidden={hidden}
    className={className} style={hidden ? { display: 'none' } : className ? undefined : { display: 'contents' }}>{children}</div>;
}

export type ContentEditorProps = {
  title: string; revision: string; pending: boolean; onClose: () => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>; children: React.ReactNode; isNew: boolean;
  sections: readonly EditorSectionDef[]; breadcrumb: string; newTitle: string; formId: string; saveTestId?: string;
  /** Controlled clean revision (e.g. after background auto-save). Defaults to the revision at mount. */
  baseline?: string; testId?: string;
  /** Inspect-only mode: fields are disabled, save is hidden, no dirty warning. */
  readOnly?: boolean;
  /** Disable save (and Ctrl+S) without hiding it, e.g. while required business rules are unmet. */
  saveDisabled?: boolean;
  saveLabel?: React.ReactNode;
  breadcrumbMode?: React.ReactNode;
  headerActions?: React.ReactNode;
  footerActions?: React.ReactNode;
  /** Rendered above section content, outside the read-only fieldset (notices, errors, duplicate actions). */
  notice?: React.ReactNode;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

export function ContentEditor({ title, revision, pending, onClose, onSubmit, children, isNew, sections, breadcrumb, newTitle,
  formId, saveTestId, baseline: baselineOverride, testId, readOnly = false, saveDisabled = false, saveLabel,
  breadcrumbMode, headerActions, footerActions, notice, onOpenAutoFocus, onCloseAutoFocus }: ContentEditorProps) {
  const [active, setActive] = useState(sections[0].id);
  const [initialBaseline] = useState(revision);
  const baseline = baselineOverride ?? initialBaseline;
  const groups = Array.from(new Set(sections.map(s => s.group)));
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLFormElement>(null);
  const firstInvalid = useRef(false);
  const dirty = !readOnly && baseline !== revision;
  const canSave = !readOnly && !pending && !saveDisabled;
  const section = sections.find(s => s.id === active) ?? sections[0];
  const index = sections.indexOf(section);
  const requestClose = () => { if (!pending) dirty ? setConfirmLeave(true) : onClose(); };
  const navigate = (id: string) => {
    setActive(id);
    scroll.current?.scrollTo?.({ top: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      root.current?.querySelector<HTMLElement>('[data-editor-heading]')?.focus({ preventScroll: true });
      root.current?.querySelector<HTMLElement>('.scenario-editor-mobile [aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  };
  const reveal = (id: string) => {
    const element = document.getElementById(id);
    if (!element || !root.current?.contains(element)) return;
    const region = element.closest<HTMLElement>('[data-scenario-editor-section]');
    if (region?.dataset.scenarioEditorSection) setActive(region.dataset.scenarioEditorSection);
    for (let parent: HTMLElement | null = element; parent && parent !== root.current; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    requestAnimationFrame(() => element.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };
  useEffect(() => {
    const handle = (event: Event) => reveal((event as CustomEvent<{ id: string }>).detail.id);
    // Radix may attach the portal after the first effect; reveal() fences to the mounted editor.
    document.addEventListener(REVEAL_EVENT, handle);
    return () => document.removeEventListener(REVEAL_EVENT, handle);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        if (document.querySelector('[role="alertdialog"]') ||
          Array.from(document.querySelectorAll('[role="dialog"]')).some(dialog => dialog !== root.current)) return;
        event.preventDefault();
        if (canSave) scroll.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [canSave]);
  const navButton = (s: EditorSectionDef) => {
    const Icon = s.icon;
    return <button key={s.id} type="button" aria-current={active === s.id ? 'page' : undefined}
      onClick={() => navigate(s.id)}><Icon size={16} aria-hidden="true" /><span>{s.label}</span></button>;
  };
  const statusText = pending ? '저장 중…' : readOnly ? '읽기 전용' : dirty ? '저장하지 않은 변경 사항' : isNew ? newTitle : '변경 없음';

  return <DialogContent ref={root} className="scenario-editor" data-testid={testId}
    onEscapeKeyDown={event => { event.preventDefault(); requestClose(); }}
    onPointerDownOutside={event => event.preventDefault()}
    onInteractOutside={event => event.preventDefault()}
    onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}>
    <Navigation.Provider value={{ active, reveal }}>
      <AutoResizeTextareaHeightProvider value={Infinity}>
        <header className="scenario-editor-header">
          <div className="scenario-editor-bar">
            <div className="min-w-0 flex-1">
              <div className="scenario-editor-breadcrumb">{breadcrumb} <ChevronRight size={12} /> {breadcrumbMode ?? (readOnly ? '살펴보기' : isNew ? '새로 만들기' : '수정')}</div>
              <DialogTitle className="scenario-editor-title">{title || newTitle}</DialogTitle>
              <DialogDescription className="sr-only">
                {readOnly ? '읽기 전용으로 내용을 살펴봅니다.' : '섹션을 이동하며 편집하세요. 변경 내용은 저장 버튼을 누르면 전체가 함께 저장됩니다.'}
              </DialogDescription>
            </div>
            <span className={`scenario-editor-status ${dirty ? 'is-dirty' : ''}`} role="status">
              {readOnly && <Lock size={13} aria-hidden="true" className="mr-1 inline" />}{statusText}
            </span>
            {headerActions}
            <button type="button" className="scenario-editor-button" onClick={requestClose} disabled={pending} aria-label="편집 닫기"><X size={16} /><span className="hidden sm:inline">닫기</span></button>
            {!readOnly && <button type="submit" form={formId} className="scenario-editor-button primary" disabled={!canSave} data-testid={saveTestId}><Save size={16} />{pending ? '저장 중…' : (saveLabel ?? '저장')}</button>}
          </div>
          <nav className="scenario-editor-mobile" aria-label="편집 섹션">{sections.map(navButton)}</nav>
        </header>
        <form ref={scroll} id={formId} className="scenario-editor-scroll"
          onSubmit={event => { if (!canSave) { event.preventDefault(); return; } setInvalidMessage(''); onSubmit(event); }}
          onInvalidCapture={event => {
            event.preventDefault();
            if (firstInvalid.current) return;
            firstInvalid.current = true;
            const field = event.target as HTMLInputElement;
            setInvalidMessage(field.validationMessage || '필수 입력 항목을 확인해 주세요.');
            const region = field.closest<HTMLElement>('[data-scenario-editor-section]');
            if (region?.dataset.scenarioEditorSection) setActive(region.dataset.scenarioEditorSection);
            for (let parent = field.parentElement; parent && parent !== root.current; parent = parent.parentElement) {
              if (parent instanceof HTMLDetailsElement) parent.open = true;
            }
            requestAnimationFrame(() => { field.focus(); field.scrollIntoView?.({ block: 'center' }); firstInvalid.current = false; });
          }}>
          <div className="scenario-editor-layout">
            <nav className="scenario-editor-nav" aria-label="편집 섹션">
              {groups.map(group => <div key={group}>
                <p>{group}</p>{sections.filter(s => s.group === group).map(navButton)}
              </div>)}
            </nav>
            <main className="scenario-editor-main">
              <div className="scenario-editor-heading"><h2 data-editor-heading tabIndex={-1}>{section.label}</h2><p>{section.description}</p></div>
              {invalidMessage && <div role="alert" className="scenario-editor-validation">{invalidMessage}</div>}
              {notice}
              {/* One consistent fence: nothing is editable while saving or in inspect-only mode. */}
              <fieldset disabled={pending || readOnly} className="contents min-w-0 border-0 p-0 m-0">{children}</fieldset>
            </main>
          </div>
        </form>
        <footer className="scenario-editor-footer">
          <span className="scenario-editor-footer-status">{readOnly ? '읽기 전용 화면입니다.' : dirty ? '변경 내용은 모든 섹션이 함께 저장됩니다.' : <><Check size={15} />섹션을 이동해도 편집 내용은 유지됩니다.</>}</span>
          <div className="flex items-center gap-2">
            {footerActions}
            <button type="button" className="scenario-editor-button" disabled={index === 0} onClick={() => navigate(sections[index - 1].id)}><ChevronLeft size={16} />이전</button>
            <span className="text-xs text-slate-500">{index + 1} / {sections.length}</span>
            <button type="button" className="scenario-editor-button" disabled={index === sections.length - 1} onClick={() => navigate(sections[index + 1].id)}>다음<ChevronRight size={16} /></button>
          </div>
        </footer>
        <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>저장하지 않고 닫을까요?</AlertDialogTitle><AlertDialogDescription>저장하지 않은 변경 내용은 사라집니다. 계속 편집하려면 취소하세요.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>계속 편집</AlertDialogCancel><AlertDialogAction onClick={onClose}>저장하지 않고 닫기</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AutoResizeTextareaHeightProvider>
    </Navigation.Provider>
  </DialogContent>;
}
