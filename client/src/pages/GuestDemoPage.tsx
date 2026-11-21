import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { GuestDemoError, guestDemoRequest } from "@/lib/guestDemo";
import { GUEST_MESSAGE_MAX_LENGTH, type GuestDemoView, type GuestProgress } from "@shared/guestDemo";

const viewKey = ["guest-demo"] as const;
const demoPath = "/api/guest/demo";

export default function GuestDemoPage() {
  const { t } = useTranslation();
  const { guestLogin } = useAuth();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const latestMessage = useRef<HTMLDivElement>(null);
  const view = useQuery({
    queryKey: viewKey, queryFn: () => guestDemoRequest<GuestDemoView>(demoPath),
    retry: false, staleTime: 0,
  });
  const progress = view.data?.progress;
  const expired = view.error instanceof GuestDemoError && view.error.code === "guest_session_required";
  const finished = !!progress && progress.turns >= progress.turnLimit;

  useEffect(() => {
    latestMessage.current?.scrollIntoView?.({ block: "nearest" });
  }, [progress?.turns]);

  const copy = (key: string, options?: Record<string, unknown>) => t(`guest.trial.${key}`, options);
  const errorText = (code: string) => copy(`errors.${code}`, { defaultValue: copy("errors.guest_unavailable") });

  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await fn();
    } catch (error) {
      const code = error instanceof GuestDemoError ? error.code : "guest_unavailable";
      setActionError(code);
      if (["guest_session_required", "guest_turn_changed", "guest_turn_pending"].includes(code)) {
        void view.refetch();
      }
    } finally {
      setBusy(false);
    }
  }

  function startSession() {
    return act(async () => {
      const result = await guestLogin();
      if (!result.success) throw new GuestDemoError(result.code || "guest_unavailable");
      await view.refetch();
    });
  }

  function saveProgress(next: GuestProgress) {
    client.setQueryData<GuestDemoView>(viewKey, { scenarios: [], progress: next });
  }

  function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!progress || !message || finished) return;
    const { turns } = progress;
    void act(async () => {
      const next = await guestDemoRequest<GuestProgress>(`${demoPath}/message`, { message, turns });
      saveProgress(next);
      setDraft("");
    });
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/auth" className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-slate-600 hover:text-indigo-700">
          <ArrowLeft size={16} aria-hidden="true" />{copy("back")}
        </Link>
        <header className="mb-6 mt-5">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
            <MessageSquare size={19} aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{copy("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{copy("description")}</p>
        </header>

        {view.isPending && <p role="status" className="text-sm text-slate-600">{t("common.loading")}</p>}
        {expired && (
          <div className="rounded-xl border bg-white p-5">
            <p className="mb-3 text-sm text-slate-600">{copy("startHint")}</p>
            <Button disabled={busy} onClick={() => void startSession()}>{t("auth.guestLogin")}</Button>
          </div>
        )}
        {view.isError && !expired && (
          <div className="rounded-xl border bg-white p-5">
            <p role="alert" className="mb-3 text-sm text-red-800">{errorText("guest_unavailable")}</p>
            <Button variant="outline" onClick={() => void view.refetch()}>{copy("retry")}</Button>
          </div>
        )}

        {!view.isError && view.data && !progress && (
          <section aria-label={copy("choose")} className="space-y-3">
            <h2 className="text-base font-semibold">{copy("choose")}</h2>
            {view.data.scenarios.length === 0 && (
              <div className="rounded-xl border bg-white p-5 text-sm text-slate-600">
                <p>{copy("empty")}</p>
                <Button className="mt-3" variant="outline" onClick={() => void view.refetch()}>{copy("retry")}</Button>
              </div>
            )}
            {view.data.scenarios.map(scenario => (
              <article key={scenario.id} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <h3 className="font-semibold text-slate-900">{scenario.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{scenario.description}</p>
                <Button type="button" className="mt-4 gap-2" variant="outline" disabled={busy} onClick={() => void act(async () => {
                  saveProgress(await guestDemoRequest<GuestProgress>(`${demoPath}/scenario`, { scenarioId: scenario.id }));
                })}>
                  {copy("start")} <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </article>
            ))}
          </section>
        )}

        {!view.isError && progress && (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b bg-slate-50/60 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="font-semibold">{progress.scenario.title}</h2>
                <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-800">
                  {copy("turns", { used: progress.turns, limit: progress.turnLimit })}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{progress.scenario.situation}</p>
              <p className="mt-2 text-sm font-medium text-indigo-900">
                {[progress.scenario.partner.name, progress.scenario.partner.role].filter(Boolean).join(" · ")}
              </p>
            </div>
            <div role="log" aria-label={copy("messages")} className="max-h-[45vh] space-y-3 overflow-y-auto p-4 sm:p-5">
              {!progress.messages.length && <p className="text-sm text-slate-600">{copy("firstMessage")}</p>}
              {progress.messages.map((item, i) => (
                <div key={i} className={item.sender === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-xl p-3 text-sm leading-relaxed ${
                    item.sender === "user" ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-900"
                  }`}>
                    <span className="sr-only">{item.sender === "user" ? copy("you") : progress.scenario.partner.name}: </span>
                    {item.message}
                  </div>
                </div>
              ))}
              {busy && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={15} className="animate-spin" />{copy("replying")}</p>}
              <div ref={latestMessage} />
            </div>
            {finished ? (
              <div className="border-t bg-indigo-50 p-4 sm:p-5">
                <p className="font-semibold text-indigo-900">{t("guest.demoCompleted")}</p>
                <p className="my-2 text-sm text-slate-700">{t("guest.demoCompletedDesc")}</p>
                <Button asChild><Link href="/auth?mode=register">{t("guest.registerNow")}</Link></Button>
              </div>
            ) : (
              <form className="flex flex-col gap-2 border-t p-4 sm:flex-row sm:items-end sm:p-5" onSubmit={send}>
                <label className="min-w-0 flex-1 text-sm font-medium">
                  {copy("message")}
                  <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={2}
                    maxLength={GUEST_MESSAGE_MAX_LENGTH} disabled={busy}
                    className="mt-1 w-full resize-y rounded-lg border border-slate-300 p-2.5 text-sm" />
                </label>
                <Button type="submit" disabled={busy || !draft.trim()}>{copy("send")}</Button>
              </form>
            )}
          </section>
        )}
        {actionError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorText(actionError)}</p>}
      </div>
    </main>
  );
}
