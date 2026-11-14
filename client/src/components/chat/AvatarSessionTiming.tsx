import { useTranslation } from "react-i18next";
import type { SessionTiming } from "@shared/avatar/sessionTiming";

const duration = (seconds: number | null | undefined) => seconds == null ? "—"
  : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Render only router observations; do not extrapolate playback from wall time. */
export function AvatarSessionTiming({ timing, reportFailed = false }: { timing?: SessionTiming; reportFailed?: boolean }) {
  const { i18n } = useTranslation();
  const en = i18n.language.startsWith("en");
  const observed = timing?.evidence === "authenticated_client_report" && !!timing.clientVideoReportedAt;
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600"
    aria-label={en ? "Video timing observations" : "영상 시간 관측"} data-testid="avatar-session-timing">
    <dl className="flex flex-wrap gap-x-5 gap-y-2">
      <div><dt>{en ? "Router elapsed" : "라우터 경과"}</dt><dd className="font-mono">{duration(timing?.routerElapsedSeconds)}</dd></div>
      <div><dt>{en ? "Preparation until first report" : "첫 보고까지 준비"}</dt><dd className="font-mono">{duration(observed ? timing?.preparationSeconds : null)}</dd></div>
      <div><dt>{en ? "Since first video report" : "첫 영상 보고 이후"}</dt><dd className="font-mono">{duration(observed ? timing?.connectedSeconds : null)}</dd></div>
    </dl>
    {!observed && <p className="mt-2">{en ? "No video report · prior sessions are not estimated." : "영상 보고 없음 · 과거 기록을 추정하지 않습니다."}</p>}
    <p className="mt-2">{en
      ? "Based on server receipt of an authenticated client's first-frame report. Includes stalls; not speech, continuous playback or billed time."
      : "인증된 클라이언트의 첫 프레임 보고를 서버가 받은 시각 기준입니다. 중간 멈춤을 포함하며 발화·연속 재생·청구 시간이 아닙니다."}</p>
    {reportFailed && <p role="status" className="mt-2 text-amber-800">{en
      ? "Video timing report failed. Playback continues; no restart or termination was requested."
      : "영상 시간 보고에 실패했습니다. 재생은 유지하며 새 연결이나 종료를 요청하지 않습니다."}</p>}
  </section>;
}
