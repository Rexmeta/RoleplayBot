import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import type { DifficultyProfile } from '@shared/schema/scenarios';

interface SliderFieldProps {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatDisplay: (v: number) => string;
  onChange: (v: number) => void;
}

function SliderField({ label, description, value, min, max, step, formatDisplay, onChange }: SliderFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium text-slate-700">{label}</Label>
          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
        </div>
        <span className="text-sm font-semibold text-slate-800 bg-white border border-slate-200 rounded px-2 py-0.5 min-w-[3.5rem] text-center shrink-0">
          {formatDisplay(value)}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-slate-400">
        <span>{formatDisplay(min)}</span>
        <span>{formatDisplay(max)}</span>
      </div>
    </div>
  );
}

const DEFAULTS: Required<DifficultyProfile> = {
  npcPatience: 5,
  hintFrequency: 0.3,
  incidentProbability: 1.0,
  passThreshold: 60,
};

interface DifficultyProfileBuilderProps {
  value: DifficultyProfile | null;
  onChange: (value: DifficultyProfile | null) => void;
}

export function DifficultyProfileBuilder({ value, onChange }: DifficultyProfileBuilderProps) {
  const dp: Required<DifficultyProfile> = {
    npcPatience: value?.npcPatience ?? DEFAULTS.npcPatience,
    hintFrequency: value?.hintFrequency ?? DEFAULTS.hintFrequency,
    incidentProbability: value?.incidentProbability ?? DEFAULTS.incidentProbability,
    passThreshold: value?.passThreshold ?? DEFAULTS.passThreshold,
  };

  const update = (patch: Partial<DifficultyProfile>) => {
    onChange({ ...dp, ...patch });
  };

  return (
    <div className="space-y-5 rounded-md border border-slate-200 bg-slate-50 p-4">
      <SliderField
        label="NPC 인내심 (npcPatience)"
        description="NPC가 대화를 얼마나 오래 참고 이어갈지 결정합니다. 낮을수록 NPC가 쉽게 대화를 끊습니다."
        value={dp.npcPatience}
        min={1}
        max={10}
        step={1}
        formatDisplay={(v) => `${v}`}
        onChange={(v) => update({ npcPatience: v })}
      />

      <SliderField
        label="힌트 빈도 (hintFrequency)"
        description="AI가 대화 중 플레이어에게 힌트를 제공하는 빈도입니다. 높을수록 힌트가 자주 나타납니다."
        value={Math.round(dp.hintFrequency * 100)}
        min={0}
        max={100}
        step={5}
        formatDisplay={(v) => `${v}%`}
        onChange={(v) => update({ hintFrequency: v / 100 })}
      />

      <SliderField
        label="사건 발생 확률 (incidentProbability)"
        description="시나리오 중 돌발 사건이 발생할 확률 배율입니다. 1×가 기본값이며 높을수록 사건이 자주 발생합니다."
        value={dp.incidentProbability}
        min={0}
        max={2}
        step={0.1}
        formatDisplay={(v) => `${v.toFixed(1)}×`}
        onChange={(v) => update({ incidentProbability: Math.round(v * 10) / 10 })}
      />

      <SliderField
        label="통과 기준 점수 (passThreshold)"
        description="시나리오를 통과하기 위해 플레이어가 받아야 하는 최소 점수입니다."
        value={dp.passThreshold}
        min={0}
        max={100}
        step={5}
        formatDisplay={(v) => `${v}점`}
        onChange={(v) => update({ passThreshold: v })}
      />
    </div>
  );
}
