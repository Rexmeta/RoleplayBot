import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';
import type { PlayerConstraints } from '@shared/schema/scenarios';

interface TagInputProps {
  label: string;
  description: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}

function TagInput({ label, description, items, onChange, placeholder }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');

  const addItem = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !items.includes(trimmed)) {
      onChange([...items, trimmed]);
    }
    setInputValue('');
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  };

  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-sm font-medium text-slate-700">{label}</Label>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>
      <div className="flex gap-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? '항목 입력 후 추가'}
          className="bg-white text-sm h-8"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addItem}
          className="h-8 px-2 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {items.map((item, i) => (
            <Badge key={i} variant="secondary" className="flex items-center gap-1 text-xs pr-1">
              {item}
              <button
                type="button"
                onClick={() => removeItem(i)}
                className="ml-0.5 rounded-full hover:bg-slate-300 p-0.5 transition-colors"
                aria-label={`${item} 삭제`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

interface PlayerConstraintsBuilderProps {
  value: PlayerConstraints | null;
  onChange: (value: PlayerConstraints | null) => void;
}

export function PlayerConstraintsBuilder({ value, onChange }: PlayerConstraintsBuilderProps) {
  const pc = value ?? {};

  const update = (patch: Partial<PlayerConstraints>) => {
    const next = { ...pc, ...patch };
    const hasAny =
      (next.authorityLevel?.trim() ?? '') !== '' ||
      (next.canOffer?.length ?? 0) > 0 ||
      (next.cannotOffer?.length ?? 0) > 0 ||
      (next.requiredBehaviors?.length ?? 0) > 0 ||
      (next.forbiddenBehaviors?.length ?? 0) > 0;
    onChange(hasAny ? next : null);
  };

  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-1.5">
        <div>
          <Label className="text-sm font-medium text-slate-700">권한 수준 (authorityLevel)</Label>
          <p className="text-xs text-slate-400 mt-0.5">플레이어가 맡은 역할의 권한 범위 (예: 팀장, 담당자, 고객)</p>
        </div>
        <Input
          value={pc.authorityLevel ?? ''}
          onChange={(e) => update({ authorityLevel: e.target.value || undefined })}
          placeholder="예: 팀장, 영업 담당자, 신입 직원"
          className="bg-white text-sm h-8"
        />
      </div>

      <TagInput
        label="제안 가능 항목 (canOffer)"
        description="플레이어가 상대방에게 제안·제공할 수 있는 항목"
        items={pc.canOffer ?? []}
        onChange={(items) => update({ canOffer: items.length > 0 ? items : undefined })}
        placeholder="예: 할인 쿠폰, 무료 배송"
      />

      <TagInput
        label="제안 불가 항목 (cannotOffer)"
        description="플레이어가 제안해서는 안 되는 항목"
        items={pc.cannotOffer ?? []}
        onChange={(items) => update({ cannotOffer: items.length > 0 ? items : undefined })}
        placeholder="예: 환불, 추가 할인"
      />

      <TagInput
        label="필수 행동 (requiredBehaviors)"
        description="플레이어가 반드시 수행해야 하는 행동"
        items={pc.requiredBehaviors ?? []}
        onChange={(items) => update({ requiredBehaviors: items.length > 0 ? items : undefined })}
        placeholder="예: 경어 사용, 자기소개"
      />

      <TagInput
        label="금지 행동 (forbiddenBehaviors)"
        description="플레이어가 해서는 안 되는 행동"
        items={pc.forbiddenBehaviors ?? []}
        onChange={(items) => update({ forbiddenBehaviors: items.length > 0 ? items : undefined })}
        placeholder="예: 욕설, 협박, 개인정보 요청"
      />
    </div>
  );
}
