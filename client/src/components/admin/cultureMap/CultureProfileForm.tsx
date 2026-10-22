import { useId, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CULTURE_DIMENSIONS, isSystemCultureProfile, newCultureValues } from "@shared/cultureMap";
import type { CultureProfile, CultureProfileInput, CultureSource } from "@shared/cultureMap";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
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
  inDialog?: boolean;
  nameInputRef?: Ref<HTMLInputElement>;
};

export function CultureProfileForm({
  draft, onChange, isAdmin, saving, onSave, onCancel, errorText,
  editing = null, readOnly = false, duplicatePending = false, onDuplicate,
  inDialog = false, nameInputRef,
}: Props) {
  const prefix = useId();
  const fieldId = (field: string) => `${prefix}-${field}`;
  const disabled = readOnly || saving;
  const title = editing ? (readOnly ? "프로필 살펴보기" : "프로필 편집") : "새 프로필 만들기";
  const description = "8개 차원은 프로필의 행동 경향을 정의합니다.";
  const setField = <K extends keyof CultureProfileInput>(key: K, value: CultureProfileInput[K]) =>
    onChange({ ...draft, [key]: value });
  const updateSource = (index: number, patch: Partial<CultureSource>) =>
    setField("sources", draft.sources.map((source, i) => i === index ? { ...source, ...patch } : source));

  return (
    <form onSubmit={event => { event.preventDefault(); if (!disabled) onSave(); }} aria-label={title}>
      {inDialog ? (
        <DialogHeader className="mb-5 border-b border-teal-100 pb-4 pr-8">
          <DialogTitle className="text-xl text-slate-900">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
      ) : (
        <header className="mb-5 border-b border-teal-100 pb-4">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </header>
      )}
      {errorText && <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{errorText}</div>}
      {isAdmin && <div className="mb-5 flex justify-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.visibility === "shared"} disabled={disabled} onChange={event => setField("visibility", event.target.checked ? "shared" : "private")} />공유 프로필</label></div>}
      <div className="mb-4"><CultureOriginNotice origin={draft.origin} /></div>
      {editing && isSystemCultureProfile(editing) && <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm"><span>시스템 기본 프로필은 읽기 전용입니다. 수정하려면 복제하세요.</span><Button type="button" variant="outline" size="sm" disabled={duplicatePending} onClick={onDuplicate}>복제 후 편집</Button></div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor={fieldId("name")}>프로필 이름 *</Label><Input ref={nameInputRef} id={fieldId("name")} value={draft.name} maxLength={150} disabled={disabled} onChange={event => setField("name", event.target.value)} /></div>
        <div><Label htmlFor={fieldId("country")}>국가/문화권 *</Label><Input id={fieldId("country")} value={draft.country} maxLength={100} disabled={disabled} onChange={event => setField("country", event.target.value)} /></div>
        <div><Label htmlFor={fieldId("region")}>지역/맥락</Label><Input id={fieldId("region")} value={draft.region} maxLength={100} disabled={disabled} onChange={event => setField("region", event.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={fieldId("description")}>설명</Label><Textarea id={fieldId("description")} value={draft.description} maxLength={2000} rows={3} disabled={disabled} onChange={event => setField("description", event.target.value)} /></div>
      </div>
      <div className="mt-6 space-y-4">
        <h4 className="font-semibold text-slate-800">행동 차원 <span className="text-xs font-normal text-slate-500">(0–100)</span></h4>
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{CULTURE_DIMENSIONS.map(dimension => (
          <div key={dimension.key}>
            <div className="mb-1 flex justify-between text-sm"><Label htmlFor={fieldId(dimension.key)}>{dimension.label}</Label><output htmlFor={fieldId(dimension.key)} className="font-mono text-xs text-slate-600">{draft.dimensions[dimension.key]}</output></div>
            <input id={fieldId(dimension.key)} aria-label={`${dimension.label} 점수`} type="range" min="0" max="100" step="1" value={draft.dimensions[dimension.key]} disabled={disabled} onChange={event => setField("dimensions", { ...draft.dimensions, [dimension.key]: Number(event.target.value) })} className="w-full accent-teal-700" />
            <div className="flex justify-between text-[11px] text-slate-500"><span>{dimension.low}</span><span>{dimension.high}</span></div>
          </div>
        ))}</div>
      </div>
      <div className="mt-7 space-y-3">
        <div className="flex items-center justify-between"><div><h4 className="font-semibold text-slate-800">근거 자료</h4><p className="text-xs text-slate-500">직접 조사한 출처를 기록하세요. 최대 20개.</p></div><Button type="button" variant="outline" size="sm" disabled={disabled || draft.sources.length >= 20} onClick={() => setField("sources", [...draft.sources, { title: "", url: "", locator: "", note: "" }])}><Plus className="mr-1 h-4 w-4" />출처 추가</Button></div>
        {draft.sources.map((source, index) => <div key={index} className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
          <Input aria-label={`출처 ${index + 1} 제목`} value={source.title} placeholder="자료 제목" disabled={disabled} onChange={event => updateSource(index, { title: event.target.value })} />
          <Input aria-label={`출처 ${index + 1} URL`} type="url" value={source.url} placeholder="https://" disabled={disabled} onChange={event => updateSource(index, { url: event.target.value })} />
          <Input aria-label={`출처 ${index + 1} 위치`} value={source.locator} placeholder="페이지·절·위치" disabled={disabled} onChange={event => updateSource(index, { locator: event.target.value })} />
          <div className="flex gap-2"><Input aria-label={`출처 ${index + 1} 메모`} value={source.note} placeholder="메모" disabled={disabled} onChange={event => updateSource(index, { note: event.target.value })} /><Button type="button" variant="ghost" aria-label={`출처 ${index + 1} 삭제`} disabled={disabled} onClick={() => setField("sources", draft.sources.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>
        </div>)}
      </div>
      <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
        {readOnly && <p className="self-center text-sm text-slate-600">{editing && isSystemCultureProfile(editing) ? "시스템 기본 프로필은 복제 후 수정할 수 있습니다." : "공유 프로필은 관리자만 수정할 수 있습니다."}</p>}
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>취소</Button>
        <Button type="submit" disabled={disabled}>{saving ? "저장 중…" : editing ? "변경 저장" : "프로필 생성"}</Button>
      </div>
      {editing && <p className="mt-2 text-right text-xs text-slate-500">수정 시 v{editing.version}을 기준으로 저장합니다.</p>}
    </form>
  );
}
