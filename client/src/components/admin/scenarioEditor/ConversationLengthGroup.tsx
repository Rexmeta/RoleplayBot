import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { EditorGroup } from './EditorPrimitives';

type Patch = { targetDurationMinutes?: number; targetTurns?: number; minValidTurns?: number };

export function recommendedLength(difficulty: number) {
  return difficulty === 1
    ? { durationMin: 5, durationMax: 8, turnsMin: 6, turnsMax: 8, minValid: 3 }
    : difficulty === 2
    ? { durationMin: 7, durationMax: 10, turnsMin: 8, turnsMax: 12, minValid: 4 }
    : difficulty === 3
    ? { durationMin: 10, durationMax: 15, turnsMin: 12, turnsMax: 16, minValid: 5 }
    : { durationMin: 12, durationMax: 20, turnsMin: 14, turnsMax: 20, minValid: 6 };
}

function Meter({ id, label, help, unit, value, min, max, recMin, recMax, onChange, ticks }: {
  id: string; label: string; help: string; unit: string; value: number; min: number; max: number;
  recMin?: number; recMax?: number; onChange: (v: number) => void; ticks: number[];
}) {
  const hasRange = recMin !== undefined && recMax !== undefined;
  const inRange = hasRange && value >= recMin! && value <= recMax!;
  return (
    <div className="se-meter">
      <div className="se-meter-head">
        <label htmlFor={id} className="se-meter-label">{label}</label>
        <div className="se-meter-value">
          <Input id={id} type="number" min={min} max={max} value={value}
            onChange={e => onChange(parseInt(e.target.value))}
            className={`w-20 h-9 text-center ${hasRange ? (inRange ? 'se-in-range' : 'se-out-range') : ''}`} />
          <span className="text-xs text-[color:var(--editor-muted)]">{unit}</span>
          {hasRange && <span className={`se-chip ${inRange ? 'is-ok' : 'is-warn'}`}>{inRange ? '권장 범위' : `권장 ${recMin}~${recMax}${unit}`}</span>}
        </div>
      </div>
      <div className="relative pt-1">
        {hasRange && <div className="se-band" aria-hidden="true"
          style={{ left: `${((recMin! - min) / (max - min)) * 100}%`, width: `${((recMax! - recMin!) / (max - min)) * 100}%` }} />}
        <Slider aria-label={label} min={min} max={max} step={1} value={[value]} onValueChange={([v]) => onChange(v)} className="relative z-20" />
      </div>
      <div className="se-ticks" aria-hidden="true">{ticks.map(t => <span key={t}>{t}{unit}</span>)}</div>
      <p className="se-field-hint">{help}</p>
    </div>
  );
}

/** Conversation length targets. Same bounds/clamping as the original inline editor. */
export function ConversationLengthGroup({ difficulty: rawDifficulty, targetDurationMinutes, targetTurns: rawTurns, minValidTurns, onChange }: {
  difficulty?: number; targetDurationMinutes?: number; targetTurns?: number; minValidTurns?: number; onChange: (patch: Patch) => void;
}) {
  const difficulty = rawDifficulty ?? 4;
  const rec = recommendedLength(difficulty);
  const difficultyLabel = ['', '입문', '기본', '심화', '전문가'][difficulty] || '전문가';
  const duration = targetDurationMinutes ?? rec.durationMin;
  const turns = rawTurns ?? rec.turnsMin;
  const minValid = minValidTurns ?? rec.minValid;
  return (
    <EditorGroup id="section-turns" title="대화 길이"
      description="목표 턴의 80%에 도달하면 AI가 자연스럽게 마무리를 유도하고, 점수는 목표 대비 실제 발화량으로 정규화됩니다."
      actions={<span className="se-chip is-info">{difficultyLabel} 권장 {rec.durationMin}~{rec.durationMax}분 · {rec.turnsMin}~{rec.turnsMax}턴</span>}>
      <Meter id="target-duration" label="목표 시간" unit="분" min={1} max={60} value={duration} recMin={rec.durationMin} recMax={rec.durationMax}
        ticks={[1, 15, 30, 60]} help="평가 시 기준이 되는 목표 소요 시간입니다."
        onChange={v => onChange({ targetDurationMinutes: Math.max(1, Math.min(60, v || rec.durationMin)) })} />
      <Meter id="target-turns" label="목표 턴 수" unit="턴" min={2} max={30} value={turns} recMin={rec.turnsMin} recMax={rec.turnsMax}
        ticks={[2, 10, 20, 30]} help="한 턴은 학습자의 발화 1회입니다."
        onChange={v => onChange({ targetTurns: Math.max(2, Math.min(30, v || rec.turnsMin)) })} />
      <Meter id="min-valid-turns" label={`최소 유효 턴 · 권장 ${rec.minValid}턴`} unit="턴" min={1} max={turns} value={minValid}
        ticks={[1, turns]} help="이보다 적으면 역량 점수 대신 '대화 분량 부족' 안내가 표시됩니다. 목표 턴의 30~40%를 권장합니다."
        onChange={v => onChange({ minValidTurns: Math.max(1, Math.min(turns, v || rec.minValid)) })} />
    </EditorGroup>
  );
}
