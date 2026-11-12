import React, { useMemo, useRef, useState } from 'react';
import type { PersonaStockAvatar } from '@shared/avatar/personaAvatar';
import { isSelectableStockAvatar } from '@shared/avatar/personaAvatar';

type GalleryAvatar = PersonaStockAvatar & {
  thumbnailUrl?: string | null;
  previewVideoUrl?: string | null;
  model?: string;
  stock?: boolean;
};

type Props = {
  avatars: PersonaStockAvatar[];
  selectedId: string | null;
  selectedProviderId: string | null;
  disabled?: boolean;
  onSelect: (avatarId: string) => void;
  displayName: (name: string) => string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map(part => Array.from(part)[0] ?? '').join('').toUpperCase();
}

function providerLabel(providerId: string): string {
  if (providerId === 'tavus' || providerId === 'anam') return '외부 서비스';
  return providerId;
}

function Thumb({ url, name }: { url: string | null | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-100 to-slate-200 text-lg font-bold text-indigo-700" aria-hidden="true">
        {initials(name)}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

export function StockAvatarGallery({ avatars, selectedId, selectedProviderId, disabled = false, onSelect, displayName }: Props) {
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('all');
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const list = avatars as GalleryAvatar[];

  const models = useMemo(() => {
    const set = new Set<string>();
    list.forEach(avatar => { if (avatar.model) set.add(avatar.model); });
    return Array.from(set).sort();
  }, [list]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(avatar =>
      (model === 'all' || avatar.model === model) &&
      (!q || avatar.name.toLowerCase().includes(q) || displayName(avatar.name).toLowerCase().includes(q)));
  }, [list, query, model, displayName]);

  const isSelected = (avatar: GalleryAvatar) => avatar.id === selectedId && avatar.providerId === selectedProviderId;
  const selectedIndex = filtered.findIndex(isSelected);
  const firstSelectable = filtered.findIndex(isSelectableStockAvatar);
  const tabStop = selectedIndex >= 0 && isSelectableStockAvatar(filtered[selectedIndex]) ? selectedIndex : firstSelectable;

  const moveFocus = (from: number, delta: number) => {
    const n = filtered.length;
    for (let step = 1; step <= n; step++) {
      const next = (from + delta * step + n * step) % n;
      if (isSelectableStockAvatar(filtered[next])) {
        itemRefs.current[next]?.focus();
        if (!disabled) onSelect(filtered[next].id);
        return;
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); moveFocus(index, 1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); moveFocus(index, -1); }
    else if (event.key === 'Home') { event.preventDefault(); moveFocus(-1 + filtered.length, 1); }
    else if (event.key === 'End') { event.preventDefault(); moveFocus(0, -1); }
  };

  return (
    <div className="space-y-3" data-testid="gallery-stock-avatars">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="stock-avatar-search">이름으로 검색</label>
        <input
          id="stock-avatar-search"
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="이름으로 검색"
          data-testid="input-stock-avatar-search"
          className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {models.length > 0 && (
          <>
            <label className="sr-only" htmlFor="stock-avatar-model">모델 필터</label>
            <select
              id="stock-avatar-model"
              value={model}
              onChange={event => setModel(event.target.value)}
              data-testid="select-stock-avatar-model"
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">모든 모델</option>
              {models.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </>
        )}
      </div>
      <p className="text-xs text-slate-500" aria-live="polite" data-testid="text-stock-avatar-count">
        {filtered.length === list.length ? `${list.length}개 아바타` : `${list.length}개 중 ${filtered.length}개 표시`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          {list.length === 0 ? '조회 가능한 기본 아바타가 없습니다.' : '검색 조건에 맞는 아바타가 없습니다.'}
          {list.length > 0 && (
            <button type="button" className="ml-2 font-semibold text-indigo-700 hover:underline" onClick={() => { setQuery(''); setModel('all'); }}>
              필터 초기화
            </button>
          )}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label="기본 아바타"
          className="grid max-h-[28rem] grid-cols-2 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          {filtered.map((avatar, index) => {
            const selectable = isSelectableStockAvatar(avatar);
            const checked = isSelected(avatar);
            const name = displayName(avatar.name);
            return (
              <button
                key={`${avatar.providerId}:${avatar.id}`}
                ref={node => { itemRefs.current[index] = node; }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={!selectable || disabled}
                tabIndex={index === tabStop ? 0 : -1}
                onClick={() => { if (selectable && !disabled) onSelect(avatar.id); }}
                onKeyDown={event => onKeyDown(event, index)}
                data-testid={`radio-stock-avatar-${avatar.id}`}
                className={`group relative flex flex-col overflow-hidden rounded-md border bg-white text-left transition-[box-shadow,border-color,transform] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  checked ? 'border-indigo-600 ring-2 ring-indigo-600' : 'border-slate-200 hover:-translate-y-px hover:border-indigo-300 hover:shadow-sm'
                } ${!selectable || disabled ? 'cursor-not-allowed opacity-55 hover:translate-y-0' : ''}`}
              >
                <div className="aspect-square w-full overflow-hidden bg-slate-100">
                  <Thumb url={avatar.thumbnailUrl} name={avatar.name} />
                </div>
                {checked && (
                  <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white shadow" aria-hidden="true">
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor"><path d="M7.7 13.3 4.4 10l-1.4 1.4 4.7 4.7 9.3-9.3-1.4-1.4z" /></svg>
                  </span>
                )}
                <div className="min-w-0 px-2 py-1.5">
                  <p className="truncate text-xs font-semibold text-slate-800" title={name}>{name}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {providerLabel(avatar.providerId)}{avatar.model ? ` · ${avatar.model}` : ''}
                  </p>
                  {!selectable && <p className="text-[11px] font-medium text-amber-700">선택 불가</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
