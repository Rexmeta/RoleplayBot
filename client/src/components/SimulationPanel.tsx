import { memo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, TrendingUp, Heart, Eye, Brain, Zap, Timer, ChevronDown, SkipForward } from 'lucide-react';
import type { SimulationState, Incident, TurnScore } from '@/hooks/useSimulationState';

interface SimulationPanelProps {
  state: SimulationState | null;
  newIncident?: Incident | null;
  latestTurnScore?: TurnScore | null;
  evaluationSkipped?: boolean;
  hasActiveIncident?: boolean;
  isVisible?: boolean;
  className?: string;
}

export const STAGE_STEPS: string[] = ['intro', 'conflict', 'negotiation', 'escalation', 'resolution'];

export const STAGE_COLORS: Record<string, string> = {
  intro: 'bg-blue-500',
  conflict: 'bg-yellow-500',
  negotiation: 'bg-orange-500',
  escalation: 'bg-red-500',
  resolution: 'bg-green-500',
};

export const EMOTION_COLORS: Record<string, string> = {
  anger: 'bg-red-400',
  trust: 'bg-blue-400',
  confusion: 'bg-yellow-400',
  interest: 'bg-green-400',
};

function EmotionBar({ label, value, icon, colorClass }: { label: string; value: number; icon: React.ReactNode; colorClass: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-4">{icon}</span>
      <span className="text-muted-foreground w-12 shrink-0">{label}</span>
      <div className="flex-1 relative">
        <Progress value={value} className="h-1.5" />
        <div
          className={`absolute top-0 left-0 h-1.5 rounded-full transition-all duration-700 ${colorClass}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right font-mono text-xs">{value}</span>
    </div>
  );
}

function StageIndicator({ stage }: { stage: string }) {
  const { t } = useTranslation();
  const currentIdx = STAGE_STEPS.indexOf(stage);
  const stageLabel = t(`simulation.stages.${stage}`, { defaultValue: stage });
  return (
    <div className="flex items-center gap-1">
      {STAGE_STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div
            className={`rounded-full w-2 h-2 transition-all duration-500 ${
              i < currentIdx
                ? 'bg-muted-foreground/40'
                : i === currentIdx
                ? `${STAGE_COLORS[s]} scale-125`
                : 'bg-muted-foreground/20'
            }`}
            title={t(`simulation.stages.${s}`, { defaultValue: s })}
          />
          {i < STAGE_STEPS.length - 1 && (
            <div className={`h-0.5 w-3 ${i < currentIdx ? 'bg-muted-foreground/40' : 'bg-muted-foreground/10'}`} />
          )}
        </div>
      ))}
      <span className="ml-1 text-xs font-medium text-foreground">{stageLabel}</span>
    </div>
  );
}

function PressureLevel({ level }: { level: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className={`rounded-sm w-3 h-3 transition-all duration-500 ${
            i <= level
              ? level >= 4 ? 'bg-red-500' : level >= 3 ? 'bg-orange-400' : 'bg-yellow-400'
              : 'bg-muted-foreground/20'
          }`}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{t('simulation.pressure', { level })}</span>
    </div>
  );
}

function IncidentBanner({ incident }: { incident: Incident }) {
  const severityClass = {
    low: 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-400',
    medium: 'border-orange-500 bg-orange-500/10 text-orange-700 dark:text-orange-400',
    high: 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400',
  }[incident.severity];

  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs animate-in slide-in-from-top-2 duration-300 ${severityClass}`}>
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold capitalize mr-1">[{incident.severity.toUpperCase()}]</span>
        {incident.message}
      </div>
    </div>
  );
}

function ScoreCard({ score, showHeader = true }: { score: TurnScore; showHeader?: boolean }) {
  const { t } = useTranslation();
  const dims = [
    { key: 'clarity', value: score.clarity },
    { key: 'empathy', value: score.empathy },
    { key: 'logic', value: score.logic },
    { key: 'ownership', value: score.ownership },
    { key: 'actionPlan', value: score.actionPlan },
  ];
  return (
    <div className="space-y-1">
      {showHeader && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{t('simulation.score.turnScore')}</span>
          <Badge variant={score.total >= 70 ? 'default' : score.total >= 50 ? 'secondary' : 'destructive'} className="text-xs">
            {t('simulation.score.points', { score: score.total })}
          </Badge>
        </div>
      )}
      <div className="grid grid-cols-5 gap-1">
        {dims.map(d => (
          <div key={d.key} className="flex flex-col items-center">
            <span className="text-[10px] font-semibold text-foreground mb-0.5">{d.value}</span>
            <div className="relative h-8 w-full bg-muted rounded-sm overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 bg-primary/70 transition-all duration-700"
                style={{ height: `${d.value}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground mt-0.5">{t(`simulation.score.dimensions.${d.key}`)}</span>
          </div>
        ))}
      </div>
      {score.hint && (
        <p className="text-[11px] text-muted-foreground italic">💡 {score.hint}</p>
      )}
    </div>
  );
}

function Sparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) return null;
  const W = 100;
  const H = 20;
  const points = scores.map((s, i) => {
    const x = (i / (scores.length - 1)) * W;
    const y = H - (Math.max(0, Math.min(100, s)) / 100) * H;
    return { x, y };
  });
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-5" preserveAspectRatio="none">
      <polyline
        points={polyline}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-primary/60"
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="1.5" className="fill-primary/80" />
      ))}
      <circle cx={last.x} cy={last.y} r="2.5" className="fill-primary" />
    </svg>
  );
}

function ScoreHistory({ scores }: { scores: TurnScore[] }) {
  const { t } = useTranslation();
  const [expandedTurnId, setExpandedTurnId] = useState<string | null>(null);

  if (scores.length === 0) return null;

  const totals = scores.map(s => s.total);
  const reversed = [...scores].reverse();

  return (
    <div className="space-y-1.5 border-t border-border/40 pt-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
        <span className="font-medium">{t('simulation.history.title')}</span>
        <span>{t('simulation.history.turnCount', { count: scores.length })}</span>
      </div>

      <Sparkline scores={totals} />

      <div className="space-y-0.5 mt-1">
        {reversed.map((score, revIdx) => {
          const origIdx = scores.length - 1 - revIdx;
          const prev = origIdx > 0 ? scores[origIdx - 1] : null;
          const delta = prev !== null ? score.total - prev.total : null;
          const isExpanded = expandedTurnId === score.turnId;

          return (
            <div key={score.turnId} className="rounded border border-border/30 overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/40 transition-colors"
                onClick={() => setExpandedTurnId(isExpanded ? null : score.turnId)}
              >
                <span className="text-muted-foreground">
                  {t('simulation.history.turn', { n: score.turnIndex + 1 })}
                </span>
                <div className="flex items-center gap-1.5">
                  {delta !== null && (
                    <span className={`font-mono text-[10px] ${delta > 0 ? 'text-green-500' : delta < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                      {delta > 0 ? '+' : ''}{delta}
                    </span>
                  )}
                  <Badge
                    variant={score.total >= 70 ? 'default' : score.total >= 50 ? 'secondary' : 'destructive'}
                    className="text-[10px] h-4 px-1.5 py-0"
                  >
                    {score.total}
                  </Badge>
                  <ChevronDown
                    className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>
              {isExpanded && (
                <div className="px-2 pb-2 pt-1 border-t border-border/20 bg-muted/10">
                  <ScoreCard score={score} showHeader={false} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SimulationTimer({ timer }: { timer: SimulationState['timer'] }) {
  const [displaySec, setDisplaySec] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!timer.enabled) {
      setDisplaySec(timer.elapsedSec);
      return;
    }

    const computeElapsed = () => {
      if (timer.startedAt && !timer.pausedAt) {
        const wallElapsed = Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000);
        return timer.elapsedSec + wallElapsed;
      }
      return timer.elapsedSec;
    };

    setDisplaySec(computeElapsed());
    intervalRef.current = setInterval(() => setDisplaySec(computeElapsed()), 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [timer.startedAt, timer.pausedAt, timer.elapsedSec, timer.enabled]);

  const remaining = timer.timeLimitSec > 0 ? Math.max(0, timer.timeLimitSec - displaySec) : null;
  const isWarning = remaining !== null && remaining <= 30;
  const pct = timer.timeLimitSec > 0 ? Math.min(100, (displaySec / timer.timeLimitSec) * 100) : null;

  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  if (!timer.enabled) return null;

  return (
    <div className={`flex items-center gap-1.5 text-xs ${isWarning ? 'text-red-500' : 'text-muted-foreground'}`}>
      <Timer className="h-3 w-3" />
      {remaining !== null ? (
        <span className={`font-mono ${isWarning ? 'font-bold animate-pulse' : ''}`}>{fmt(remaining)}</span>
      ) : (
        <span className="font-mono">{fmt(displaySec)}</span>
      )}
      {pct !== null && (
        <div className="flex-1 max-w-16">
          <Progress value={pct} className={`h-1 ${isWarning ? '[&>div]:bg-red-500' : ''}`} />
        </div>
      )}
    </div>
  );
}

const SimulationPanel = memo(function SimulationPanel({
  state,
  newIncident,
  latestTurnScore,
  evaluationSkipped = false,
  hasActiveIncident = false,
  isVisible = true,
  className = '',
}: SimulationPanelProps) {
  const { t } = useTranslation();
  const scrollBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (newIncident && scrollBodyRef.current) {
      scrollBodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [newIncident]);

  if (!isVisible || !state) return null;

  const { npcEmotions, stage, pressureLevel, currentScore, summary, timer } = state;

  return (
    <Card className={`w-full border border-border/50 bg-card/60 backdrop-blur-sm flex flex-col overflow-hidden ${className}`}>
      {/* Sticky header — always visible even when content below is scrolled */}
      <div className="sticky top-0 z-10 bg-card/90 backdrop-blur-sm px-3 pt-3 pb-2 border-b border-border/30 shrink-0">
        {newIncident && <IncidentBanner incident={newIncident} />}

        <div className={`flex items-center justify-between ${newIncident ? 'mt-2' : ''}`}>
          <div className="flex items-center gap-1.5">
            <StageIndicator stage={stage} />
            {hasActiveIncident && (
              <span className="w-2 h-2 bg-orange-400 rounded-full animate-pulse shrink-0" title={t('simulation.activeIncident', { defaultValue: 'Active incident' })} />
            )}
          </div>
          <PressureLevel level={pressureLevel} />
        </div>

        {timer.enabled && (
          <div className="mt-1.5">
            <SimulationTimer timer={timer} />
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div ref={scrollBodyRef} className="overflow-y-auto flex-1">
        <CardContent className="p-3 space-y-3">
          <div className="space-y-1.5">
            <EmotionBar
              label={t('simulation.emotions.anger')}
              value={npcEmotions.anger}
              icon={<Zap className="h-3 w-3 text-red-400" />}
              colorClass="bg-red-400"
            />
            <EmotionBar
              label={t('simulation.emotions.trust')}
              value={npcEmotions.trust}
              icon={<Heart className="h-3 w-3 text-blue-400" />}
              colorClass="bg-blue-400"
            />
            <EmotionBar
              label={t('simulation.emotions.confusion')}
              value={npcEmotions.confusion}
              icon={<Brain className="h-3 w-3 text-yellow-400" />}
              colorClass="bg-yellow-400"
            />
            <EmotionBar
              label={t('simulation.emotions.interest')}
              value={npcEmotions.interest}
              icon={<Eye className="h-3 w-3 text-green-400" />}
              colorClass="bg-green-400"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 pt-2">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              <span>{t('simulation.summary.avgScore', { score: summary.averageScore })}</span>
            </div>
            <span>{t('simulation.summary.turns', { count: summary.totalTurns })}</span>
            {summary.totalIncidents > 0 && (
              <span className="text-orange-500">{t('simulation.summary.issues', { count: summary.totalIncidents })}</span>
            )}
          </div>

          {evaluationSkipped ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-t border-border/40 pt-2">
              <SkipForward className="h-3 w-3 shrink-0" />
              <span>{t('simulation.score.skipped', { defaultValue: 'Turn skipped — message too short to score' })}</span>
            </div>
          ) : (latestTurnScore ?? state.recentTurnScores?.at(-1)) ? (
            <ScoreCard score={latestTurnScore ?? state.recentTurnScores.at(-1)!} />
          ) : (
            <div className="border-t border-border/40 pt-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="h-3 w-3 rounded-full border border-muted-foreground/40 border-t-transparent animate-spin shrink-0" />
                <span>{t('simulation.score.waitingFirst', { defaultValue: 'Scores loading...' })}</span>
              </div>
              <div className="space-y-1">
                <div className="h-2 rounded bg-muted-foreground/10 animate-pulse w-full" />
                <div className="h-2 rounded bg-muted-foreground/10 animate-pulse w-4/5" />
                <div className="h-2 rounded bg-muted-foreground/10 animate-pulse w-3/5" />
              </div>
            </div>
          )}

          {state.recentTurnScores && state.recentTurnScores.length > 0 && (
            <ScoreHistory scores={state.recentTurnScores} />
          )}
        </CardContent>
      </div>
    </Card>
  );
});

export default SimulationPanel;
