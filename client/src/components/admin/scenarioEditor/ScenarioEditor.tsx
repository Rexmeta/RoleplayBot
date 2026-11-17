import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FileText, Flag, Image, ListChecks, MessagesSquare, Save, Settings2, Users, Workflow, X } from 'lucide-react';
import { DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AutoResizeTextareaHeightProvider } from '@/components/ui/auto-resize-textarea';
import './scenario-editor.css';

export const EDITOR_SECTIONS = [
  { id: 'basic', label: '기본 정보', description: '학습자가 처음 보게 될 시나리오의 개요와 연습할 역량입니다.', group: '교육 내용', icon: FileText },
  { id: 'situation', label: '상황과 학습자 역할', description: '어떤 상황에서, 누구의 입장으로 대화할지 정합니다.', group: '교육 내용', icon: MessagesSquare },
  { id: 'actors', label: '대화 상대', description: '각 인물의 입장과 목표를 정합니다. 세부 반응과 문화 설정도 여기에서 편집합니다.', group: '교육 내용', icon: Users },
  { id: 'goals', label: '학습 목표와 성공 기준', description: '이번 연습에서 달성할 목표와 좋은 대화의 기준을 정합니다.', group: '교육 내용', icon: Flag },
  { id: 'flow', label: '대화 흐름', description: '전체 흐름을 보면서 한 단계씩 편집하세요. 자동 전환과 종료 규칙은 필요한 경우에만 설정합니다.', group: '진행 방식', icon: Workflow },
  { id: 'assessment', label: '평가 방식', description: '대화 시간, 평가 기준과 피드백 방식을 정합니다.', group: '진행 방식', icon: ListChecks },
  { id: 'media', label: '이미지·영상', description: '시나리오 이미지와 시작 영상을 관리합니다. 교육 내용과 별도로 설정할 수 있습니다.', group: '배포', icon: Image },
  { id: 'publish', label: '공개 설정', description: '공개 범위, 체험 모드와 언어 설정을 확인합니다.', group: '배포', icon: Settings2 },
] as const;
export type EditorSection = typeof EDITOR_SECTIONS[number]['id'];
type EditorNavigation = { active: EditorSection; reveal: (id: string) => void };
const Navigation = createContext<EditorNavigation | null>(null);
export const useScenarioEditorNavigation = () => useContext(Navigation);
export function revealScenarioEditorTarget(id: string) {
  document.getElementById(id)?.dispatchEvent(new CustomEvent('scenario-editor-reveal', { bubbles: true, detail: { id } }));
}

/** Keep every editor mounted: builder-local state must survive navigation. */
export function ScenarioEditorRegion({ sections, children, className, id }: {
  sections: EditorSection | EditorSection[]; children: React.ReactNode; className?: string; id?: string;
}) {
  const navigation = useScenarioEditorNavigation();
  const allowed = typeof sections === 'string' ? [sections] : sections;
  const hidden = !!navigation && !allowed.includes(navigation.active);
  return <div id={id} data-scenario-editor-section={allowed[0]} hidden={hidden}
    className={className} style={hidden ? { display: 'none' } : className ? undefined : { display: 'contents' }}>{children}</div>;
}

export function ScenarioEditor({ title, revision, pending, onClose, onSubmit, children, isNew }: {
  title: string; revision: string; pending: boolean; onClose: () => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>; children: React.ReactNode; isNew: boolean;
}) {
  const [active, setActive] = useState<EditorSection>('basic');
  const [baseline] = useState(revision);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLFormElement>(null);
  const firstInvalid = useRef(false);
  const dirty = baseline !== revision;
  const section = EDITOR_SECTIONS.find(s => s.id === active)!;
  const index = EDITOR_SECTIONS.indexOf(section);
  const requestClose = () => { if (!pending) dirty ? setConfirmLeave(true) : onClose(); };
  const navigate = (id: EditorSection) => {
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
    if (region) setActive(region.dataset.scenarioEditorSection as EditorSection);
    for (let parent: HTMLElement | null = element; parent && parent !== root.current; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    requestAnimationFrame(() => element.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  };
  useEffect(() => {
    const handle = (event: Event) => reveal((event as CustomEvent<{ id: string }>).detail.id);
    // Radix may attach the portal after this component's first effect.
    // reveal() fences requests to the currently mounted editor.
    document.addEventListener('scenario-editor-reveal', handle);
    return () => document.removeEventListener('scenario-editor-reveal', handle);
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
        if (!pending) scroll.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [pending]);
  const navButton = (s: typeof EDITOR_SECTIONS[number]) => {
    const Icon = s.icon;
    return <button key={s.id} type="button" aria-current={active === s.id ? 'page' : undefined}
      onClick={() => navigate(s.id)}><Icon size={16} aria-hidden="true" /><span>{s.label}</span></button>;
  };

  return <DialogContent ref={root} className="scenario-editor" aria-describedby="scenario-editor-description"
    onEscapeKeyDown={event => { event.preventDefault(); requestClose(); }}
    onPointerDownOutside={event => event.preventDefault()}>
    <Navigation.Provider value={{ active, reveal }}>
      <AutoResizeTextareaHeightProvider value={Infinity}>
        <header className="scenario-editor-header">
          <div className="scenario-editor-bar">
            <div className="min-w-0 flex-1">
              <div className="scenario-editor-breadcrumb">시나리오 관리 <ChevronRight size={12} /> {isNew ? '새로 만들기' : '수정'}</div>
              <DialogTitle className="scenario-editor-title">{title || '새 시나리오'}</DialogTitle>
              <DialogDescription id="scenario-editor-description" className="sr-only">섹션을 이동하며 편집하세요. 변경 내용은 저장 버튼을 누르면 전체가 함께 저장됩니다.</DialogDescription>
            </div>
            <span className={`scenario-editor-status ${dirty ? 'is-dirty' : ''}`} role="status">
              {pending ? '저장 중…' : dirty ? '저장하지 않은 변경 사항' : isNew ? '새 시나리오' : '변경 없음'}
            </span>
            <button type="button" className="scenario-editor-button" onClick={requestClose} disabled={pending} aria-label="편집 닫기"><X size={16} /><span className="hidden sm:inline">닫기</span></button>
            <button type="submit" form="scenario-editor-form" className="scenario-editor-button primary" disabled={pending} data-testid="button-save-scenario"><Save size={16} />{pending ? '저장 중…' : '저장'}</button>
          </div>
          <nav className="scenario-editor-mobile" aria-label="편집 섹션">{EDITOR_SECTIONS.map(navButton)}</nav>
        </header>
        <form ref={scroll} id="scenario-editor-form" className="scenario-editor-scroll"
          onSubmit={event => { if (pending) { event.preventDefault(); return; } setInvalidMessage(''); onSubmit(event); }}
          onInvalidCapture={event => {
            event.preventDefault();
            if (firstInvalid.current) return;
            firstInvalid.current = true;
            const field = event.target as HTMLInputElement;
            setInvalidMessage(field.validationMessage || '필수 입력 항목을 확인해 주세요.');
            const region = field.closest<HTMLElement>('[data-scenario-editor-section]');
            if (region) setActive(region.dataset.scenarioEditorSection as EditorSection);
            for (let parent = field.parentElement; parent && parent !== root.current; parent = parent.parentElement) {
              if (parent instanceof HTMLDetailsElement) parent.open = true;
            }
            requestAnimationFrame(() => { field.focus(); field.scrollIntoView?.({ block: 'center' }); firstInvalid.current = false; });
          }}>
          <div className="scenario-editor-layout">
            <nav className="scenario-editor-nav" aria-label="편집 섹션">
              {['교육 내용', '진행 방식', '배포'].map(group => <div key={group}>
                <p>{group}</p>{EDITOR_SECTIONS.filter(s => s.group === group).map(navButton)}
              </div>)}
            </nav>
            <main className="scenario-editor-main">
              <div className="scenario-editor-heading"><h2 data-editor-heading tabIndex={-1}>{section.label}</h2><p>{section.description}</p></div>
              {invalidMessage && <div role="alert" className="scenario-editor-validation">{invalidMessage}</div>}
              {children}
            </main>
          </div>
        </form>
        <footer className="scenario-editor-footer">
          <span className="scenario-editor-footer-status">{dirty ? '변경 내용은 모든 섹션이 함께 저장됩니다.' : <><Check size={15} />섹션을 이동해도 편집 내용은 유지됩니다.</>}</span>
          <div className="flex items-center gap-2">
            <button type="button" className="scenario-editor-button" disabled={index === 0} onClick={() => navigate(EDITOR_SECTIONS[index - 1].id)}><ChevronLeft size={16} />이전</button>
            <span className="text-xs text-slate-500">{index + 1} / {EDITOR_SECTIONS.length}</span>
            <button type="button" className="scenario-editor-button" disabled={index === EDITOR_SECTIONS.length - 1} onClick={() => navigate(EDITOR_SECTIONS[index + 1].id)}>다음<ChevronRight size={16} /></button>
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
