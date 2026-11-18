import { useId, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { CULTURE_DIMENSIONS, isSystemCultureProfile, newCultureValues } from "@shared/cultureMap";
import type { CultureProfile, CultureProfileInput, CultureSource } from "@shared/cultureMap";
import { AlertTriangle, BookMarked, IdCard, Plus, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import { ContentEditor, ContentEditorRegion, type EditorSectionDef } from "../contentEditor/ContentEditor";
import { EditorGroup, Field, FieldGrid, ToggleRow } from "../contentEditor/EditorPrimitives";
import { CultureOriginNotice } from "./CultureOriginNotice";

export const emptyCultureProfile = (): CultureProfileInput => ({
  name: "", country: "", region: "", description: "", dimensions: newCultureValues(), sources: [], visibility: "private",
});

export function validateCultureProfile(draft: CultureProfileInput): string {
  if (!draft.name.trim() || !draft.country.trim()) return "프로필 이름과 국가/지역을 입력해 주세요.";
  if (draft.sources.some(source => !source.title.trim() || !/^https?:\/\//i.test(source.url))) {
    return "출처 제목과 유효한 HTTP(S) URL을 확인해 주세요.";
  }
  return "";
}

export const CULTURE_PROFILE_SECTIONS: readonly EditorSectionDef[] = [
  { id: "basic", label: "기본 정보", description: "프로필 이름, 국가/문화권과 적용 맥락을 정합니다.", group: "프로필", icon: IdCard },
  { id: "dimensions", label: "행동 차원", description: "8개 차원은 프로필의 행동 경향을 정의합니다. 각 값은 0–100 사이입니다.", group: "프로필", icon: SlidersHorizontal },
  { id: "sources", label: "근거 자료", description: "직접 조사한 출처를 기록하세요. 최대 20개까지 추가할 수 있습니다.", group: "근거", icon: BookMarked },
  { id: "publish", label: "공개 설정", description: "공유 범위와 저장 기준 버전을 확인합니다.", group: "배포", icon: Settings2 },
];

type Props = {
  draft: CultureProfileInput;
  onChange: (draft: CultureProfileInput) => void;
  isAdmin: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  errorText: string;
  editing?: CultureProfile | null;
  readOnly?: boolean;
  duplicatePending?: boolean;
  onDuplicate?: () => void;
  /** @deprecated The form always renders in the shared full-screen editor shell. */
  inDialog?: boolean;
  nameInputRef?: Ref<HTMLInputElement>;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/** Single create/edit/inspect implementation. Must be rendered inside a <Dialog>. */
export function CultureProfileForm({
  draft, onChange, isAdmin, saving, onSave, onCancel, errorText,
  editing = null, readOnly = false, duplicatePending = false, onDuplicate,
  nameInputRef, onOpenAutoFocus, onCloseAutoFocus,
}: Props) {
  const prefix = useId();
  const fieldId = (field: string) => `${prefix}-${field}`;
  const isSystem = !!editing && isSystemCultureProfile(editing);
  const setField = <K extends keyof CultureProfileInput>(key: K, value: CultureProfileInput[K]) =>
    onChange({ ...draft, [key]: value });
  const updateSource = (index: number, patch: Partial<CultureSource>) =>
    setField("sources", draft.sources.map((source, i) => i === index ? { ...source, ...patch } : source));

  const notice = <div className="se-stack mb-4 space-y-3">
    {errorText && <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{errorText}</div>}
    {isSystem && <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm"><span>시스템 기본 프로필은 읽기 전용입니다. 수정하려면 복제하세요.</span><Button type="button" variant="outline" size="sm" disabled={duplicatePending || saving} onClick={onDuplicate}>복제 후 편집</Button></div>}
    {readOnly && !isSystem && <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">공유 프로필은 관리자만 수정할 수 있습니다.</p>}
  </div>;

  return (
    <ContentEditor
      title={editing ? draft.name || editing.name : draft.name}
      revision={JSON.stringify(draft)}
      pending={saving}
      isNew={!editing}
      readOnly={readOnly}
      sections={CULTURE_PROFILE_SECTIONS}
      breadcrumb="Culture Map"
      newTitle="새 프로필 만들기"
      formId="culture-profile-editor-form"
      saveTestId="button-save-culture-profile"
      testId="culture-profile-editor"
      saveLabel={editing ? "변경 저장" : "프로필 생성"}
      notice={notice}
      onClose={onCancel}
      onOpenAutoFocus={onOpenAutoFocus}
      onCloseAutoFocus={onCloseAutoFocus}
      onSubmit={event => { event.preventDefault(); if (!readOnly && !saving) onSave(); }}
    >
      <ContentEditorRegion sections="basic" className="se-stack">
        <div className="mb-4"><CultureOriginNotice origin={draft.origin} /></div>
        {editing?.assessment && <p className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">{editing.assessment.notice}</p>}
        <EditorGroup title="프로필 식별" description="학습자와 운영자가 목록에서 이 프로필을 구분하는 정보입니다.">
          <FieldGrid>
            <Field label="프로필 이름 *" htmlFor={fieldId("name")}><Input ref={nameInputRef} id={fieldId("name")} required value={draft.name} maxLength={150} onChange={event => setField("name", event.target.value)} /></Field>
            <Field label="국가/문화권 *" htmlFor={fieldId("country")}><Input id={fieldId("country")} required value={draft.country} maxLength={100} onChange={event => setField("country", event.target.value)} /></Field>
            <Field label="지역/맥락" htmlFor={fieldId("region")}><Input id={fieldId("region")} value={draft.region} maxLength={100} onChange={event => setField("region", event.target.value)} /></Field>
          </FieldGrid>
          <Field label="설명" htmlFor={fieldId("description")}><AutoResizeTextarea id={fieldId("description")} value={draft.description} maxLength={2000} rows={3} onChange={event => setField("description", event.target.value)} /></Field>
        </EditorGroup>
      </ContentEditorRegion>

      <ContentEditorRegion sections="dimensions" className="se-stack">
        <EditorGroup title={<>행동 차원 <span className="text-xs font-normal text-slate-500">(0–100)</span></>} description="양 끝 설명을 기준으로 이 문화권의 경향에 가까운 위치를 정하세요.">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{CULTURE_DIMENSIONS.map(dimension => (
            <div key={dimension.key}>
              <div className="mb-1 flex justify-between text-sm"><Label htmlFor={fieldId(dimension.key)}>{dimension.label}</Label><output htmlFor={fieldId(dimension.key)} className="font-mono text-xs text-slate-600">{draft.dimensions[dimension.key]}</output></div>
              <input id={fieldId(dimension.key)} aria-label={`${dimension.label} 점수`} type="range" min="0" max="100" step="1" value={draft.dimensions[dimension.key]} onChange={event => setField("dimensions", { ...draft.dimensions, [dimension.key]: Number(event.target.value) })} className="w-full accent-teal-700" />
              <div className="flex justify-between text-[11px] text-slate-500"><span>{dimension.low}</span><span>{dimension.high}</span></div>
            </div>
          ))}</div>
        </EditorGroup>
      </ContentEditorRegion>

      <ContentEditorRegion sections="sources" className="se-stack">
        <EditorGroup title="근거 자료" description="직접 조사한 출처를 기록하세요. 최대 20개."
          actions={<Button type="button" variant="outline" size="sm" disabled={readOnly || draft.sources.length >= 20} onClick={() => setField("sources", [...draft.sources, { title: "", url: "", locator: "", note: "" }])}><Plus className="mr-1 h-4 w-4" />출처 추가</Button>}>
          {draft.sources.length === 0 && <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">아직 기록한 출처가 없습니다.</p>}
          {draft.sources.map((source, index) => <div key={index} className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
            <Input aria-label={`출처 ${index + 1} 제목`} required value={source.title} placeholder="자료 제목" onChange={event => updateSource(index, { title: event.target.value })} />
            <Input aria-label={`출처 ${index + 1} URL`} required type="url" pattern="https?://.+" value={source.url} placeholder="https://" onChange={event => updateSource(index, { url: event.target.value })} />
            <Input aria-label={`출처 ${index + 1} 위치`} value={source.locator} placeholder="페이지·절·위치" onChange={event => updateSource(index, { locator: event.target.value })} />
            <div className="flex gap-2"><Input aria-label={`출처 ${index + 1} 메모`} value={source.note} placeholder="메모" onChange={event => updateSource(index, { note: event.target.value })} /><Button type="button" variant="ghost" aria-label={`출처 ${index + 1} 삭제`} onClick={() => setField("sources", draft.sources.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>
          </div>)}
        </EditorGroup>
      </ContentEditorRegion>

      <ContentEditorRegion sections="publish" className="se-stack">
        <EditorGroup title="공개 범위">
          {isAdmin
            ? <ToggleRow id={fieldId("visibility")} label="공유 프로필" description={draft.visibility === "shared" ? "모든 운영자가 이 프로필을 볼 수 있습니다." : "나만 볼 수 있는 개인 프로필입니다."}
                checked={draft.visibility === "shared"} onCheckedChange={checked => setField("visibility", checked ? "shared" : "private")} />
            : <p className="text-sm text-slate-600">{draft.visibility === "shared" ? "공유 프로필입니다." : "개인 프로필입니다."} 공유 설정은 관리자만 변경할 수 있습니다.</p>}
          {editing && <p className="text-xs text-slate-500">수정 시 v{editing.version}을 기준으로 저장합니다.</p>}
        </EditorGroup>
      </ContentEditorRegion>
    </ContentEditor>
  );
}
