import { memo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, TrendingUp, Heart, Eye, Brain, Zap, Timer } from 'lucide-react';
import type { SimulationState, Incident, TurnScore } from '@/hooks/useSimulationState';

interface SimulationPanelProps {
  state: SimulationState | null;
  newIncident?: Incident | null;
  latestTurnScore?: TurnScore | null;
  hasActiveIncident?: boolean;
  isVisible?: boolean;
  className?: string;
}

const STAGE_STEPS: string[] = ['intro', 'conflict', 'negotiation', 'escalation', 'resolution'];

const STAGE_COLORS: Record<string, string> = {
  intro: 'bg-blue-500',
  conflict: 'bg-yellow-500',
  negotiation: 'bg-orange-500',
  escalation: 'bg-red-500',
  resolution: 'bg-green-500',
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

function ScoreCard({ score }: { score: TurnScore }) {
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
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('simulation.score.turnScore')}</span>
        <Badge variant={score.total >= 70 ? 'default' : score.total >= 50 ? 'secondary' : 'destructive'} className="text-xs">
          {t('simulation.score.points', { score: score.total })}
        </Badge>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {dims.map(d => (
          <div key={d.key} className="flex flex-col items-center">
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
  hasActiveIncident = false,
  isVisible = true,
  className = '',
}: SimulationPanelProps) {
  const { t } = useTranslation();

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
      <div className="overflow-y-auto flex-1">
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

          {latestTurnScore && <ScoreCard score={latestTurnScore} />}
        </CardContent>
      </div>
    </Card>
  );
});

export default SimulationPanel;
