import { Loader2, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LiveAvatarBadge } from "@/components/LiveAvatarBadge";
import { PersonaPortrait } from "@/components/PersonaPortrait";
import type { ScenarioPersona } from "@/lib/scenario-system";

interface PersonaDetailDialogProps {
  persona: ScenarioPersona | null;
  imageSrc?: string;
  isCompleted: boolean;
  isLoading: boolean;
  isStarting: boolean;
  onClose: () => void;
  onStart: (persona: ScenarioPersona) => void;
}

function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <section>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</h4>
      <div className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap break-keep">{children}</div>
    </section>
  );
}

function Chips({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-800">{item}</span>
      ))}
    </div>
  );
}

export function PersonaDetailDialog({ persona, imageSrc, isCompleted, isLoading, isStarting, onClose, onStart }: PersonaDetailDialogProps) {
  const { t } = useTranslation();
  const p = persona;
  return (
    <Dialog open={!!p} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl"
        data-testid="persona-detail-dialog"
      >
        {p && (
          <>
            <div className="grid min-h-0 flex-1 overflow-y-auto sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
              <div className="sm:sticky sm:top-0 sm:self-start">
                <PersonaPortrait
                  src={imageSrc}
                  name={p.name}
                  alt={t("scenario.personaPortraitAlt", { defaultValue: "{{name}}, {{role}}", name: p.name, role: p.role || "" })}
                  aspect="4 / 5"
                  sizes="(min-width: 640px) 240px, 90vw"
                  className="max-h-[45dvh] w-full sm:max-h-none"
                />
              </div>
              <div className="space-y-5 p-5 sm:p-6">
                <header className="space-y-1.5 pr-6">
                  <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">{p.name}</DialogTitle>
                  <DialogDescription className="text-sm text-slate-500">
                    {[p.role || p.position, p.department].filter(Boolean).join(" · ")}
                  </DialogDescription>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <LiveAvatarBadge configured={!!p.liveAvatarConfigured} inline />
                    {p.mbti && <Badge variant="secondary" className="font-mono text-[11px] tracking-wider">{p.mbti}</Badge>}
                    {p.experience && <Badge variant="outline" className="text-[11px] font-normal">{p.experience}</Badge>}
                  </div>
                </header>

                <Field label={t("scenario.personaStance", { defaultValue: "입장" })}>{p.stance}</Field>
                <Field label={t("scenario.personaGoal", { defaultValue: "목표" })}>{p.goal}</Field>
                <Field label={t("scenario.personaTradeoff", { defaultValue: "협상 가능 범위" })}>{p.tradeoff}</Field>
                <Field label={t("scenario.personaTraits", { defaultValue: "성향" })}>
                  <Chips items={p.personality?.traits} />
                </Field>
                <Field label={t("scenario.personaCommunication", { defaultValue: "소통 방식" })}>
                  {p.personality?.communicationStyle !== p.stance ? p.personality?.communicationStyle : undefined}
                </Field>
                <Field label={t("scenario.personaMotivation", { defaultValue: "동기" })}>{p.personality?.motivation !== p.goal ? p.personality?.motivation : undefined}</Field>
                <Field label={t("scenario.personaConcerns", { defaultValue: "우려 사항" })}>
                  <Chips items={p.currentSituation?.concerns} />
                </Field>
              </div>
            </div>

            <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 p-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="min-h-11" onClick={onClose} data-testid="persona-detail-close">
                {t("common.close", { defaultValue: "닫기" })}
              </Button>
              {!isCompleted && (
                <Button
                  type="button"
                  className="min-h-11 bg-indigo-600 text-white hover:bg-indigo-700"
                  disabled={isLoading}
                  onClick={() => onStart(p)}
                  data-testid={`select-persona-${p.id}`}
                >
                  {isStarting ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                      {t("scenario.preparing")}
                    </>
                  ) : (
                    <>
                      <Play className="mr-1.5 h-4 w-4" aria-hidden />
                      {t("scenario.startConversation")}
                    </>
                  )}
                </Button>
              )}
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
