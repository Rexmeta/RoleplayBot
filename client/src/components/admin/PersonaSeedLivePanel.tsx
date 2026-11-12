import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonaAvatarValidationPanel } from "@/components/admin/PersonaAvatarValidationPanel";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { personaSeedStateSchema, seedSourceIdentity, type PersonaSeedDraft, type PersonaSeedState } from "@shared/avatar/personaSeedLive";
import type { PersonaLiveAvatar } from "@shared/avatar/personaAvatar";

type Candidate = NonNullable<PersonaSeedState["options"]>["candidates"][number];

const basePath = (personaId: string) =>
  `/api/admin/personas/live-avatar/personas/${encodeURIComponent(personaId)}/seed`;

function messageFor(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/persona_seed_save_image_first/.test(message)) return "기본 이미지를 먼저 저장하세요. 저장된 이미지만 시드로 사용할 수 있습니다.";
  if (/persona_seed_reset_blocked/.test(message)) return "생성 진행 중이거나 결과가 불확실하여 초기화할 수 없습니다. 상태를 조회하고 작업 완료 또는 조정 후 다시 시도하세요.";
  if (/persona_seed_reset_stale/.test(message)) return "다른 화면에서 준비 상태가 변경되었습니다. 상태를 다시 조회하세요.";
  if (/403|scope|forbidden/i.test(message)) return "시드 라이브 설정 권한을 확인하세요.";
  if (/fetch|network/i.test(message)) return "서버에 연결하지 못했습니다. 상태를 조회해 결과를 확인하세요.";
  return "요청을 완료하지 못했습니다. 상태를 조회해 결과를 확인하세요.";
}

const stageLabels: Record<PersonaSeedState["stage"], string> = {
  idle: "대기", registering: "등록 중", registered: "등록됨", creating: "생성 요청 중", submitted: "제출 완료",
};
const statusLabels: Record<Candidate["status"], string> = {
  queued: "대기열", submitting: "제출 중", processing: "처리 중", ready: "준비됨", failed: "실패",
  reconciliation_required: "조정 필요", deleting: "삭제 중", deleted: "삭제됨",
};

export function PersonaSeedLivePanel({ personaId, source, draft, onDraftChange, onSelect, onActivityChange }: {
  personaId: string; source: string; draft: PersonaSeedDraft | null;
  onDraftChange: (draft: PersonaSeedDraft | null) => void;
  onSelect: (avatar: PersonaLiveAvatar | null) => void;
  onActivityChange?: (active: boolean) => void;
}) {
  const { user } = useAuth();
  const identity = `${user?.id ?? ""}|${personaId}|${seedSourceIdentity(source)}`;
  const identityRef = useRef(identity);
  const epochRef = useRef(0);
  // Bump the epoch synchronously during render so late responses are discarded before effects run.
  if (identityRef.current !== identity) { identityRef.current = identity; epochRef.current++; }
  const mountedRef = useRef(false);
  const postingRef = useRef(false);
  const requestRef = useRef(0);
  const effectIdentityRef = useRef(identity);
  const [state, setState] = useState<PersonaSeedState | null>(null);
  const [uncertainFence, setUncertainFence] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [likeness, setLikeness] = useState<"synthetic" | "real_person">("synthetic");
  const [consentReference, setConsentReference] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validateOpen, setValidateOpen] = useState<string | null>(null);
  const [validationBusy, setValidationBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const cbRef = useRef({ onDraftChange, onSelect, onActivityChange });
  cbRef.current = { onDraftChange, onSelect, onActivityChange };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; epochRef.current++; };
  }, []);

  const url = (suffix = "") => `${basePath(personaId)}${suffix}?source=${encodeURIComponent(source)}`;
  const live = (epoch: number) => mountedRef.current && epochRef.current === epoch;

  const apply = (next: PersonaSeedState) => {
    setState(next);
    cbRef.current.onDraftChange(next.draft);
  };

  const refresh = async (quiet = false) => {
    if (postingRef.current) return;
    const epoch = epochRef.current;
    const request = ++requestRef.current;
    if (!quiet) { setLoading(true); setError(""); }
    try {
      const response = await apiRequest("GET", url());
      const next = personaSeedStateSchema.parse(await response.json());
      if (!live(epoch) || requestRef.current !== request) return;
      apply(next);
      if (!next.uncertain) setUncertainFence(false);
      if (!quiet) setNotice("서버의 최신 시드 상태를 확인했습니다. 새 요청은 보내지 않았습니다.");
    } catch (cause) {
      if (live(epoch) && requestRef.current === request && !quiet) setError(messageFor(cause));
    } finally { if (live(epoch) && requestRef.current === request) setLoading(false); }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Source/persona/user change: clear everything, then read-only hydration.
  useEffect(() => {
    setState(null); setUncertainFence(false); setError(""); setNotice("");
    setRightsConfirmed(false); setTransferConfirmed(false); setCostConfirmed(false);
    setLikeness("synthetic"); setConsentReference(""); setSelectedId(null); setValidateOpen(null);
    setResetOpen(false);
    setBusy(false); setLoading(false);
    if (effectIdentityRef.current !== identity) {
      cbRef.current.onSelect(null);
      cbRef.current.onDraftChange(null);
      effectIdentityRef.current = identity;
    }
    if (source && personaId && user?.id) void refreshRef.current();
  }, [identity]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = Boolean(state?.options?.candidates.some(c => c.status === "queued" || c.status === "processing"));
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => { if (!postingRef.current) void refreshRef.current(true); }, 4000);
    return () => window.clearInterval(id);
  }, [pending, identity]);

  const uncertain = uncertainFence || Boolean(state?.uncertain);
  useEffect(() => {
    cbRef.current.onActivityChange?.(validationBusy || busy || loading || uncertain || state?.stage === "registering" || state?.stage === "creating");
  }, [validationBusy, busy, loading, uncertain, state?.stage]);

  const post = async (suffix: string, body: unknown, ok: string, onSuccess?: () => void) => {
    if (postingRef.current) return;
    postingRef.current = true;
    ++requestRef.current;
    const epoch = epochRef.current;
    setBusy(true); setLoading(false); setError(""); setNotice("");
    try {
      const response = await apiRequest("POST", url(suffix), body);
      const next = personaSeedStateSchema.parse(await response.json());
      if (!live(epoch)) return;
      apply(next);
      if (next.uncertain) setUncertainFence(true);
      setNotice(ok);
      onSuccess?.();
    } catch (cause) {
      if (!live(epoch)) return;
      const msg = cause instanceof Error ? cause.message : "";
      if (!/persona_seed_save_image_first|persona_seed_reset_blocked|persona_seed_reset_stale/.test(msg)) {
        setUncertainFence(true);
        setNotice("요청 결과가 불확실할 수 있습니다. 다시 요청하지 말고 먼저 상태를 조회하세요.");
      }
      setError(messageFor(cause));
    } finally {
      postingRef.current = false;
      if (live(epoch)) setBusy(false);
    }
  };

  const consentOk = likeness !== "real_person" || Boolean(consentReference.trim());
  const canRegister = Boolean(source && rightsConfirmed && transferConfirmed && consentOk && !busy && !loading && !validationBusy && !uncertain &&
    (!state || state.stage === "idle" || !state.draft));
  const canCreate = Boolean(state?.draft && state.options?.canProvision && costConfirmed && !busy && !loading && !validationBusy && !uncertain &&
    state.stage === "registered");
  const canReset = Boolean(state?.draft && state.options && !busy && !loading && !validationBusy && !uncertain &&
    state.stage !== "registering" &&
    ((state.stage !== "submitted" && state.stage !== "creating") || state.options.candidates.length > 0) &&
    state.options.candidates.every(c => ["ready", "failed", "deleted"].includes(c.status) &&
      c.nextAction !== "reconcile" && c.failure?.creationOutcome !== "unknown" &&
      c.failure?.nextAction !== "operator_reconcile"));

  const register = () => canRegister && void post("", {
    rightsConfirmed: true, transferConfirmed: true, likeness,
    ...(likeness === "real_person" ? { consentReference: consentReference.trim() } : {}),
  }, "저장된 기본 이미지를 시드로 등록했습니다. 아직 생성 요청은 보내지 않았습니다.");
  const create = () => canCreate && void post("/create", { costConfirmed: true },
    "생성 요청을 보냈습니다. 준비 후 초안에 연결할 후보를 직접 선택하세요.");
  const reset = () => canReset && void post("/reset", { confirmed: true, draft: state!.draft },
    "생성 준비 상태를 초기화했습니다. 권리·전송 동의를 다시 확인하고 이미지를 등록한 후 새 생성 요청을 제출하세요.", () => {
      setRightsConfirmed(false); setTransferConfirmed(false); setCostConfirmed(false);
      setLikeness("synthetic"); setConsentReference(""); setSelectedId(null); setValidateOpen(null);
      setResetOpen(false);
      cbRef.current.onSelect(null);
    });

  const select = (c: Candidate) => {
    if (!state?.draft || busy || validationBusy || c.status === "deleting" || c.status === "deleted") return;
    const verified = c.canActivate && c.liveReference?.avatarAssetId === c.avatarAssetId;
    setSelectedId(c.avatarAssetId);
    onSelect({
      kind: "custom", assetId: c.avatarAssetId, providerId: "tavus", voiceMode: "roleplayx", activation: "draft",
      validationStatus: verified ? "live_verified" : "unverified", projectId: state.draft.projectId,
      seedImageAssetId: state.draft.imageAssetId, seedImageVersion: state.draft.imageVersion,
      seedSourceFingerprint: state.draft.sourceFingerprint,
    });
  };

  return <section className="rounded-md border border-slate-200 bg-white p-4" aria-labelledby="persona-seed-live-title" data-testid="panel-persona-seed-live">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 id="persona-seed-live-title" className="text-sm font-bold text-slate-900">기본 이미지로 라이브 아바타 준비</h4>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">저장된 페르소나 기본 이미지만 서버가 전송합니다. 음성(Gemini)과 시나리오 설정은 변경하지 않습니다. 모든 전송은 관리자 명시 동작으로만 실행됩니다.</p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={loading || busy || !source} data-testid="button-seed-refresh">
        <RefreshCw className="mr-2 h-4 w-4" />{loading ? "확인 중…" : "상태 조회"}
      </Button>
    </div>
    <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
      최소 512×512의 성인 한 명, 머리와 양쪽 어깨가 보이는 상반신 사진을 사용하세요. 배꼽 또는 그 위에서 자르고 손·팔은 가슴 이하로 낮추세요. Router가 학습 보정을 요청하지만 성공을 보장하지 않으며 원본은 유지됩니다.
    </p>
    {!source && <p className="mt-3 text-xs text-slate-600">기본 이미지를 저장하면 시드 설정을 시작할 수 있습니다.</p>}
    {loading && !state && <div className="mt-3 h-14 animate-pulse rounded-md bg-slate-100" />}
    {state && <div className={`mt-3 grid gap-2 rounded-md border p-3 text-xs sm:grid-cols-3 ${uncertain ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`} data-testid="status-seed-state">
      <p><span className="font-semibold">단계</span><br />{stageLabels[state.stage]}</p>
      <p><span className="font-semibold">이미지 버전</span><br />{state.draft ? `v${state.draft.imageVersion}` : "미등록"}</p>
      <p><span className="font-semibold">다음 작업</span><br />{state.options?.nextAction ?? "등록 필요"}</p>
    </div>}
    {uncertain && <div role="alert" className="mt-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      <AlertTriangle className="h-4 w-4 shrink-0" /><p>요청 결과가 불확실합니다. 상태 조회에서 불확실 상태가 해제될 때까지 등록·생성이 잠깁니다.</p>
    </div>}

    {(!state?.draft) && source && <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
      <fieldset className="text-xs font-semibold text-slate-700">
        <legend>인물 유형</legend>
        <div className="mt-1 flex items-center gap-2">
          {(["synthetic", "real_person"] as const).map(v => <button key={v} type="button" aria-pressed={likeness === v} onClick={() => setLikeness(v)} data-testid={`button-likeness-${v}`}
            className={`rounded border px-3 py-1.5 font-normal ${likeness === v ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-200 text-slate-600"}`}>{v === "synthetic" ? "합성 인물" : "실존 인물"}</button>)}
        </div>
      </fieldset>
      {likeness === "real_person" && <label className="block text-xs font-semibold text-slate-700">동의 증빙 참조
        <input value={consentReference} onChange={e => setConsentReference(e.target.value.slice(0, 200))} maxLength={200} data-testid="input-seed-consent"
          className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal" placeholder="내부 승인 번호 또는 증빙 참조" />
      </label>}
      <div className="grid gap-2 text-xs text-slate-700 md:grid-cols-2">
        <Confirm checked={rightsConfirmed} onChange={setRightsConfirmed} label="이미지 사용 권리와 초상 사용 권한을 확인했습니다." />
        <Confirm checked={transferConfirmed} onChange={setTransferConfirmed} label="저장된 이미지가 외부 서비스에 전송됨을 확인했습니다." />
      </div>
      <Button type="button" size="sm" onClick={register} disabled={!canRegister} data-testid="button-seed-register">{busy ? "처리 중…" : "시드 이미지 등록"}</Button>
    </div>}

    {state?.draft && <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
      <Confirm checked={costConfirmed} onChange={setCostConfirmed} label="외부 제공자 비용이 발생할 수 있음을 확인했습니다." />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={create} disabled={!canCreate} data-testid="button-seed-create">{busy ? "처리 중…" : "라이브 아바타 생성 요청"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setResetOpen(true)} disabled={!canReset} data-testid="button-seed-reset">초기화하고 다시 제출</Button>
        {!state.options?.canProvision && <span className="text-xs text-slate-500">현재 상태에서는 새 생성이 허용되지 않습니다.</span>}
      </div>
      {!canReset && !busy && !loading && <p className="text-xs text-slate-500">진행 중이거나 결과가 불확실한 작업은 완료 또는 조정 후 초기화할 수 있습니다.</p>}
      {resetOpen && <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950" role="group" aria-label="생성 준비 초기화 확인">
        <p>현재 초안 연결과 생성 준비 상태를 초기화합니다. 기존 아바타 자산은 삭제하지 않으며, 저장된 페르소나는 저장 전까지 변경되지 않습니다. 다시 제출하면 새 생성 비용이 발생할 수 있습니다.</p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setResetOpen(false)} disabled={busy}>취소</Button>
          <Button type="button" size="sm" onClick={reset} disabled={!canReset} data-testid="button-seed-reset-confirm">초기화 확인</Button>
        </div>
      </div>}
    </div>}

    {state?.options && state.options.candidates.length > 0 && <ul className="mt-4 space-y-2">
      {state.options.candidates.map(c => {
        const verified = c.canActivate && c.liveReference?.avatarAssetId === c.avatarAssetId;
        const selectable = c.status !== "deleting" && c.status !== "deleted";
        return <li key={c.avatarAssetId} className={`rounded-md border p-3 text-xs ${selectedId === c.avatarAssetId ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200"}`} data-testid={`card-seed-candidate-${c.avatarAssetId}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p><span className="font-semibold text-slate-800">{statusLabels[c.status]}</span>
              <span className="ml-2 text-slate-500">{verified ? "재생 검증됨 · 활성화 가능" : "미검증 · 초안 연결만 가능"}</span></p>
            <div className="flex gap-2">
              {c.nextAction === "validate" && <Button type="button" size="sm" variant="outline" disabled={validationBusy || busy} onClick={() => setValidateOpen(validateOpen === c.avatarAssetId ? null : c.avatarAssetId)} aria-expanded={validateOpen === c.avatarAssetId} data-testid={`button-seed-validate-${c.avatarAssetId}`}>재생 점검 {validateOpen === c.avatarAssetId ? "닫기" : "열기"}</Button>}
              <Button type="button" size="sm" variant={selectedId === c.avatarAssetId ? "default" : "outline"} disabled={!selectable || !state.draft || validationBusy || busy} onClick={() => select(c)} data-testid={`button-seed-select-${c.avatarAssetId}`}>
                {selectedId === c.avatarAssetId ? <><CheckCircle2 className="mr-1 h-4 w-4" />초안에 연결됨</> : "초안으로 선택"}
              </Button>
            </div>
          </div>
          {c.failure && <div role="alert" className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-red-800">
            <p>{c.failure.messageKo}</p>
            <p className="mt-1 text-red-700">코드 {c.failure.code} · 단계 {c.failure.stage}{c.failure.providerHttpStatus !== null ? ` · HTTP ${c.failure.providerHttpStatus}` : ""}</p>
          </div>}
          {validateOpen === c.avatarAssetId && c.nextAction === "validate" &&
            <PersonaAvatarValidationPanel assetId={c.avatarAssetId} assetName="시드 라이브 아바타" onReported={() => void refresh()} onActivityChange={setValidationBusy} />}
        </li>;
      })}
    </ul>}
    {(selectedId || draft) && <p className="mt-2 text-xs text-slate-500">선택은 초안 설정일 뿐이며, 재생 검증과 활성화 조건 충족 전에는 라이브로 활성화되지 않습니다. 생성 이름은 페르소나 ID입니다.</p>}
    {notice && <p role="status" className="mt-3 flex items-center gap-1 text-xs text-slate-600"><CheckCircle2 className="h-3.5 w-3.5" />{notice}</p>}
    {error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800" data-testid="text-seed-error">{error}</p>}
  </section>;
}

function Confirm({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-slate-700"><input type="checkbox" className="mt-0.5 accent-indigo-700" checked={checked} onChange={e => onChange(e.target.checked)} /><span>{label}</span></label>;
}
