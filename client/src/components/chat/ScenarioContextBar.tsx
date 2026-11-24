import { MapPin, Target, UserRound, Quote } from "lucide-react";
import type { ComplexScenario } from "@/lib/scenario-system";

export interface ScenarioSceneContext {
  title?: string;
  setting?: string;
  mood?: string;
  openingLine?: string;
  genre?: string;
}

/** Scene attached by FreeChatPage as an additive scenario snapshot field. */
export function getScenarioScene(scenario: ComplexScenario): ScenarioSceneContext | null {
  const scene = (scenario as any)?._personaScene;
  return scene && typeof scene === "object" && (scene.title || scene.setting) ? scene : null;
}

/**
 * Scenario / scene context shown inside the top hidden bar. Intentionally never
 * renders organization override metadata; those directives remain runtime-only.
 */
export function ScenarioContextBar({ scenario, closeNotice = "starts" }: {
  scenario: ComplexScenario;
  /** "starts": closing begins the conversation. "explicit": start stays an explicit action (e.g. live avatar mic). */
  closeNotice?: "starts" | "explicit";
}) {
  const scene = getScenarioScene(scenario);
  const isUserPersona = Boolean((scenario as any)?._userPersonaMode);
  const situation = scenario.context?.situation;
  const role = scenario.context?.playerRole;
  const objectives = isUserPersona ? [] : (scenario.objectives ?? []).filter(Boolean).slice(0, 4);

  return (
    <section data-testid="scenario-context-bar" aria-label="대화 상황" className="mx-auto max-w-3xl space-y-3 text-slate-700">
      <header className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
            {scene ? "장면" : "상황"}
          </p>
          <h2 className="text-sm font-semibold text-slate-900" data-testid="scenario-context-title">
            {scene?.title || scenario.title}
          </h2>
          {scene?.mood && <p className="text-xs text-emerald-700/80">{scene.mood}{scene.genre ? ` · ${scene.genre}` : ""}</p>}
        </div>
      </header>

      {scene?.setting ? (
        <p className="text-sm leading-6 text-slate-600" data-testid="scenario-context-setting">{scene.setting}</p>
      ) : situation ? (
        <p className="text-sm leading-6 text-slate-600" data-testid="scenario-context-situation">{situation}</p>
      ) : null}

      {scene?.openingLine && (
        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm italic text-emerald-800">
          <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{scene.openingLine}</span>
        </p>
      )}

      {!isUserPersona && (scenario.context as any)?.playerRoleText && (
        <p className="text-xs leading-5 text-slate-600"><span className="font-semibold text-slate-800">내 역할 </span>{(scenario.context as any).playerRoleText}</p>
      )}
      {!isUserPersona && !(scenario.context as any)?.playerRoleText && role?.position && (
        <p className="flex items-start gap-2 text-xs leading-5 text-slate-600">
          <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span><span className="font-semibold text-slate-800">내 역할 </span>{role.position}{role.department ? ` · ${role.department}` : ""}{role.responsibility ? ` — ${role.responsibility}` : ""}</span>
        </p>
      )}

      {objectives.length > 0 && (
        <div className="flex items-start gap-2 text-xs leading-5 text-slate-600">
          <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <ul className="space-y-0.5">{objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}

      <p className="text-[11px] text-slate-400" data-testid="scenario-context-notice">
        {closeNotice === "starts"
          ? "이 창을 닫으면 대화가 시작됩니다. 상단 손잡이로 언제든 다시 볼 수 있어요."
          : "이 창을 닫아도 연결은 시작되지 않습니다. 준비되면 마이크 버튼을 눌러 시작하세요."}
      </p>
    </section>
  );
}
