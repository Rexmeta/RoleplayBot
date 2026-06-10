import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';
import type { NpcBehaviorHarness, NpcBehaviorHarnessTrigger } from '@shared/schema/scenarios';

interface TriggerRowProps {
  trigger: NpcBehaviorHarnessTrigger;
  onChange: (updated: NpcBehaviorHarnessTrigger) => void;
  onRemove: () => void;
  readOnly?: boolean;
}

function TriggerRow({ trigger, onChange, onRemove, readOnly }: TriggerRowProps) {
  return (
    <div className="grid grid-cols-[1fr_5rem_5rem_1fr_auto] gap-1.5 items-start">
      <div>
        <Input
          value={trigger.keyword}
          onChange={(e) => onChange({ ...trigger, keyword: e.target.value })}
          placeholder="키워드"
          className="bg-white text-xs h-8"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Input
          type="number"
          value={trigger.trustDelta ?? ''}
          onChange={(e) => {
            const v = e.target.value === '' ? undefined : Number(e.target.value);
            onChange({ ...trigger, trustDelta: v });
          }}
          placeholder="신뢰±"
          className="bg-white text-xs h-8"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Input
          type="number"
          value={trigger.angerDelta ?? ''}
          onChange={(e) => {
            const v = e.target.value === '' ? undefined : Number(e.target.value);
            onChange({ ...trigger, angerDelta: v });
          }}
          placeholder="분노±"
          className="bg-white text-xs h-8"
          readOnly={readOnly}
        />
      </div>
      <div>
        <Input
          value={trigger.description ?? ''}
          onChange={(e) => onChange({ ...trigger, description: e.target.value || undefined })}
          placeholder="설명 (선택)"
          className="bg-white text-xs h-8"
          readOnly={readOnly}
        />
      </div>
      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-8 w-8 p-0 text-slate-400 hover:text-red-500 shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

interface TriggerListProps {
  label: string;
  description: string;
  triggers: NpcBehaviorHarnessTrigger[];
  onChange: (triggers: NpcBehaviorHarnessTrigger[]) => void;
  readOnly?: boolean;
}

function TriggerList({ label, description, triggers, onChange, readOnly }: TriggerListProps) {
  const addTrigger = () => {
    onChange([...triggers, { keyword: '' }]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-semibold text-slate-700">{label}</Label>
          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTrigger}
            className="h-7 text-xs gap-1 shrink-0 ml-2"
          >
            <Plus className="w-3 h-3" />
            추가
          </Button>
        )}
      </div>
      {triggers.length > 0 && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_5rem_5rem_1fr_auto] gap-1.5 px-0.5">
            <span className="text-xs text-slate-400 font-medium">키워드</span>
            <span className="text-xs text-slate-400 font-medium">신뢰±</span>
            <span className="text-xs text-slate-400 font-medium">분노±</span>
            <span className="text-xs text-slate-400 font-medium">설명</span>
            {!readOnly && <span />}
          </div>
          {triggers.map((t, i) => (
            <TriggerRow
              key={i}
              trigger={t}
              onChange={(updated) => {
                const next = [...triggers];
                next[i] = updated;
                onChange(next);
              }}
              onRemove={() => onChange(triggers.filter((_, idx) => idx !== i))}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
      {triggers.length === 0 && readOnly && (
        <p className="text-xs text-slate-400 italic">없음</p>
      )}
    </div>
  );
}

interface NpcBehaviorHarnessBuilderProps {
  value: NpcBehaviorHarness | null | undefined;
  onChange: (value: NpcBehaviorHarness | null) => void;
  readOnly?: boolean;
}

export function NpcBehaviorHarnessBuilder({ value, onChange, readOnly }: NpcBehaviorHarnessBuilderProps) {
  const harness = value ?? {};

  const update = (patch: Partial<NpcBehaviorHarness>) => {
    const next = { ...harness, ...patch };
    const bounds = next.negotiationBounds;
    const hasBounds =
      bounds !== undefined &&
      (bounds.minTrustToYield !== undefined ||
        bounds.maxAngerBeforeWalkout !== undefined ||
        bounds.maxPatienceTurns !== undefined);
    const hasTrust = (next.trustTriggers?.length ?? 0) > 0;
    const hasEscalation = (next.escalationTriggers?.length ?? 0) > 0;
    onChange(hasBounds || hasTrust || hasEscalation ? next : null);
  };

  const bounds = harness.negotiationBounds ?? {};

  const updateBounds = (patch: Partial<NonNullable<NpcBehaviorHarness['negotiationBounds']>>) => {
    const nextBounds = { ...bounds, ...patch };
    const hasAny =
      nextBounds.minTrustToYield !== undefined ||
      nextBounds.maxAngerBeforeWalkout !== undefined ||
      nextBounds.maxPatienceTurns !== undefined;
    update({ negotiationBounds: hasAny ? nextBounds : undefined });
  };

  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      {/* Negotiation Bounds */}
      <div className="space-y-2">
        <div>
          <Label className="text-xs font-semibold text-slate-700">협상 임계값 (negotiationBounds)</Label>
          <p className="text-xs text-slate-400 mt-0.5">NPC가 양보하거나 자리를 뜨는 기준 수치 (0–100)</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">양보 최소 신뢰도</Label>
            <p className="text-xs text-slate-400">minTrustToYield</p>
            <Input
              type="number"
              min={0}
              max={100}
              value={bounds.minTrustToYield ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                updateBounds({ minTrustToYield: v });
              }}
              placeholder="예: 60"
              className="bg-white text-xs h-8"
              readOnly={readOnly}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">이탈 최대 분노</Label>
            <p className="text-xs text-slate-400">maxAngerBeforeWalkout</p>
            <Input
              type="number"
              min={0}
              max={100}
              value={bounds.maxAngerBeforeWalkout ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                updateBounds({ maxAngerBeforeWalkout: v });
              }}
              placeholder="예: 80"
              className="bg-white text-xs h-8"
              readOnly={readOnly}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">최대 인내 턴 수</Label>
            <p className="text-xs text-slate-400">maxPatienceTurns</p>
            <Input
              type="number"
              min={1}
              step={1}
              value={bounds.maxPatienceTurns ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Math.max(1, Math.round(Number(e.target.value)));
                updateBounds({ maxPatienceTurns: v });
              }}
              placeholder="예: 5"
              className="bg-white text-xs h-8"
              readOnly={readOnly}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200" />

      {/* Trust Triggers */}
      <TriggerList
        label="신뢰 트리거 (trustTriggers)"
        description="특정 키워드 감지 시 신뢰/분노 수치를 조정합니다"
        triggers={harness.trustTriggers ?? []}
        onChange={(triggers) => update({ trustTriggers: triggers.length > 0 ? triggers : undefined })}
        readOnly={readOnly}
      />

      <div className="border-t border-slate-200" />

      {/* Escalation Triggers */}
      <TriggerList
        label="에스컬레이션 트리거 (escalationTriggers)"
        description="갈등을 고조시키는 키워드와 그 효과를 정의합니다"
        triggers={harness.escalationTriggers ?? []}
        onChange={(triggers) => update({ escalationTriggers: triggers.length > 0 ? triggers : undefined })}
        readOnly={readOnly}
      />
    </div>
  );
}
