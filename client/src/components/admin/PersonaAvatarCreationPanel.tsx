import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import type { PersonaAvatarCreationInput, PersonaAvatarCreationState } from "@shared/avatar/personaAvatarCreation";

const endpoint = "/api/admin/personas/live-avatar/creation";

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/403|scope|forbidden/i.test(message)) return "커스텀 아바타 생성 권한을 확인하세요.";
  if (/fetch|network/i.test(message)) return "서버에 연결하지 못했습니다. 상태를 먼저 조회해 작업 결과를 확인하세요.";
  return message || "요청을 완료하지 못했습니다. 상태를 조회해 결과를 확인하세요.";
}

async function imageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("이미지 인코딩을 확인할 수 없습니다."));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function parseState(value: unknown): PersonaAvatarCreationState {
  if (!value || typeof value !== "object" || !("stage" in value) || !("uncertain" in value)) {
    throw new Error("생성 상태 응답 형식이 올바르지 않습니다.");
  }
  const state = value as PersonaAvatarCreationState;
  if (!["idle", "ingesting", "image_ready", "provisioning", "submitted"].includes(state.stage) ||
      typeof state.uncertain !== "boolean") throw new Error("생성 상태 응답 형식이 올바르지 않습니다.");
  return state;
}

const stageLabels: Record<PersonaAvatarCreationState["stage"], string> = {
  idle: "대기", ingesting: "이미지 처리 중", image_ready: "이미지 준비됨",
  provisioning: "제공자 작업 중", submitted: "제출 완료",
};

export function PersonaAvatarCreationPanel({ onSubmitted }: { onSubmitted: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [likeness, setLikeness] = useState<"synthetic" | "real_person">("synthetic");
  const [consentReference, setConsentReference] = useState("");
  const [imageBase64, setImageBase64] = useState("");
  const [imageName, setImageName] = useState("");
  const [state, setState] = useState<PersonaAvatarCreationState | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const fileSequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; fileSequence.current++; };
  }, []);

  const selectFile = async (file?: File) => {
    if (!file) return;
    if (state?.imageId && imageBase64 && state.stage !== "idle") return;
    const sequence = ++fileSequence.current;
    setError("");
    setImageBase64(""); setImageName("");
    setRightsConfirmed(false); setTransferConfirmed(false); setCostConfirmed(false);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 4_500_000) {
      setError("4.5MB 이하의 JPEG, PNG 또는 WebP 이미지를 선택하세요."); return;
    }
    try {
      const encoded = await imageAsBase64(file);
      if (!mounted.current || sequence !== fileSequence.current) return;
      if (encoded.length > 6_000_000) throw new Error("이미지 크기가 허용 범위를 초과합니다.");
      setImageBase64(encoded);
      setImageName(file.name);
    } catch (cause) {
      if (!mounted.current || sequence !== fileSequence.current) return;
      setImageBase64("");
      setImageName("");
      setError(messageFor(cause));
    }
  };

  const reconcile = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await apiRequest("GET", endpoint);
      if (!mounted.current) return;
      setState(parseState(await response.json()));
      setNotice("서버의 최신 작업 상태를 확인했습니다. 새 생성 요청은 보내지 않았습니다.");
    } catch (cause) { if (mounted.current) setError(messageFor(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };

  const pendingReview = state?.consentStatus === "pending_review";
  const resumeReady = state?.stage === "image_ready" &&
    (state.consentStatus === "verified" || state.consentStatus === "not_required");
  const imageLocked = Boolean(state?.imageId && imageBase64 && state.stage !== "idle");
  const blocked = Boolean(state?.uncertain || state?.stage === "ingesting" || state?.stage === "provisioning" || state?.stage === "submitted");
  const canSubmit = Boolean(name.trim() && imageBase64 && rightsConfirmed && transferConfirmed && costConfirmed &&
    (likeness !== "real_person" || consentReference.trim()) && !busy && !blocked && !pendingReview &&
    (!state || state.stage === "idle" || resumeReady));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError(""); setNotice("");
    const payload: PersonaAvatarCreationInput = {
      name: name.trim(), imageBase64, likeness,
      ...(likeness === "real_person" ? { consentReference: consentReference.trim() } : {}),
      rightsConfirmed: true, transferConfirmed: true, costConfirmed: true,
    };
    try {
      const response = await apiRequest("POST", endpoint, payload);
      const result = await response.json() as { state: unknown };
      if (!mounted.current) return;
      const next = parseState(result.state);
      setState(next);
      if (next.stage === "submitted") {
        setNotice("커스텀 아바타 작업을 제출했습니다. 목록을 새로 조회했습니다. 준비 완료 후 초안에 연결할 자산을 직접 선택하세요.");
        onSubmitted();
      } else if (next.consentStatus === "pending_review") {
        setNotice("동의 검토 대기 중입니다. 검토 완료 후 같은 이미지로 상태를 다시 확인하고 수동 재개하세요.");
      } else {
        setNotice("요청 결과를 받았습니다. 불확실한 경우 새 요청 대신 상태를 조회하세요.");
      }
    } catch (cause) {
      if (!mounted.current) return;
      setState({ stage: "provisioning", uncertain: true });
      setError(messageFor(cause));
      setNotice("요청 결과가 불확실할 수 있습니다. 다시 제출하지 말고 먼저 상태를 조회하세요.");
    } finally { if (mounted.current) setBusy(false); }
  };

  return <section className="rounded-md border border-slate-200 bg-white p-4" aria-labelledby="persona-creation-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 id="persona-creation-title" className="text-sm font-bold text-slate-900">Tavus 커스텀 생성</h4>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">관리자 명시 동작으로만 이미지를 제출합니다. 상태 조회는 수동이며, 불확실한 작업은 중복 제출하지 않습니다.</p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => void reconcile()} disabled={busy}>
        <RefreshCw className="mr-2 h-4 w-4" />{busy ? "확인 중…" : "작업 상태 조회"}
      </Button>
    </div>
    {state && <div className={`mt-3 grid gap-2 rounded-md border p-3 text-xs sm:grid-cols-3 ${state.uncertain ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
      <p><span className="font-semibold">단계</span><br />{stageLabels[state.stage]}</p>
      <p><span className="font-semibold">동의 검토</span><br />{state.consentStatus === "pending_review" ? "검토 대기" : state.consentStatus === "verified" ? "확인됨" : state.consentStatus === "not_required" ? "해당 없음" : "상태 미확인"}</p>
      <p className="break-all"><span className="font-semibold">작업 식별자</span><br />{state.assetId || state.imageId || "없음"}</p>
    </div>}
    {state?.uncertain && <div role="alert" className="mt-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <AlertTriangle className="h-4 w-4 shrink-0" /><p>요청 결과가 불확실합니다. 새 생성은 잠겼습니다. 상태 조회로만 원격 결과를 확인하세요.</p>
    </div>}
    {pendingReview && <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
      동의 검토가 끝날 때까지 학습용 사용은 차단됩니다. 검토 완료 후 상태를 다시 조회하고, 서버가 같은 이미지의 재개를 허용하면 선택된 동일 이미지로 수동 제출할 수 있습니다.
    </div>}
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-xs font-semibold text-slate-700">표시 이름
        <input value={name} onChange={event => setName(event.target.value.slice(0, 80))} maxLength={80} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal" placeholder="예: 고객 상담 코치" />
      </label>
      <fieldset className="text-xs font-semibold text-slate-700">
        <legend>인물 유형</legend>
        <div className="mt-1 flex h-9 items-center gap-2">
          <button type="button" aria-pressed={likeness === "synthetic"} onClick={() => setLikeness("synthetic")} className={`rounded border px-3 py-1.5 font-normal ${likeness === "synthetic" ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-200 text-slate-600"}`}>합성 인물</button>
          <button type="button" aria-pressed={likeness === "real_person"} onClick={() => setLikeness("real_person")} className={`rounded border px-3 py-1.5 font-normal ${likeness === "real_person" ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-200 text-slate-600"}`}>실존 인물</button>
        </div>
      </fieldset>
      {likeness === "real_person" && <label className="text-xs font-semibold text-slate-700 md:col-span-2">동의 증빙 참조
        <input value={consentReference} onChange={event => setConsentReference(event.target.value.slice(0, 200))} maxLength={200} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal" placeholder="내부 승인 번호 또는 증빙 참조" />
      </label>}
      <div className="md:col-span-2">
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={event => void selectFile(event.target.files?.[0])} />
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-slate-300 p-3">
        <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy || imageLocked}><Upload className="mr-2 h-4 w-4" />이미지 파일 선택</Button>
          <span className="min-w-0 break-all text-xs text-slate-600">{imageName || "파일을 직접 선택하세요. 선택 전에는 업로드되지 않습니다."}</span>
        </div>
      </div>
    </div>
    <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-700 md:grid-cols-3">
      <Confirm checked={rightsConfirmed} onChange={setRightsConfirmed} label="이미지 사용 권리와 초상 사용 권한을 확인했습니다." />
      <Confirm checked={transferConfirmed} onChange={setTransferConfirmed} label="이미지가 Tavus 등 외부 제공자에게 전송됨을 확인했습니다." />
      <Confirm checked={costConfirmed} onChange={setCostConfirmed} label="외부 제공자 비용이 발생할 수 있음을 확인했습니다." />
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" onClick={() => void submit()} disabled={!canSubmit}>
        {busy ? "처리 중…" : resumeReady ? "같은 이미지 작업 재개" : "커스텀 아바타 생성"}
      </Button>
      {state?.stage === "submitted" && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
        fileSequence.current++;
        setState(null); setImageBase64(""); setImageName(""); setName("");
        setConsentReference(""); setLikeness("synthetic");
        setRightsConfirmed(false); setTransferConfirmed(false); setCostConfirmed(false);
        setNotice(""); setError("");
        if (fileRef.current) fileRef.current.value = "";
      }}>새 이미지로 생성 준비</Button>}
      {resumeReady && <span className="text-xs text-slate-600">검토 완료 상태입니다. 기존 선택 이미지를 다시 전송합니다.</span>}
      {notice && <span role="status" className="flex items-center gap-1 text-xs text-slate-600"><CheckCircle2 className="h-3.5 w-3.5" />{notice}</span>}
    </div>
    {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>}
  </section>;
}

function Confirm({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="flex cursor-pointer items-start gap-2 leading-relaxed"><input type="checkbox" className="mt-0.5 accent-indigo-700" checked={checked} onChange={event => onChange(event.target.checked)} /><span>{label}</span></label>;
}
