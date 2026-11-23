import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import type { PersonaAvatarMode, PersonaLiveAvatar, PersonaStockAvatar, PersonaVoice } from '@shared/avatar/personaAvatar';
import { isLiveValidatedPersonaAvatar, isSelectableStockAvatar, personaAvatarCatalogSchema, personaVoiceCatalogPageSchema } from '@shared/avatar/personaAvatar';
import { PersonaAvatarCreationPanel, type PersonaAvatarSource } from '@/components/admin/PersonaAvatarCreationPanel';
import { PersonaAvatarValidationPanel } from '@/components/admin/PersonaAvatarValidationPanel';
import { LiveAvatarTestPanel } from '@/components/admin/LiveAvatarTestPanel';
import { AnamAvatarTestPanel } from '@/components/admin/AnamAvatarTestPanel';
import { AvatarVoiceTestPanel } from '@/components/admin/avatarTest/AvatarVoiceTestPanel';
import { PersonaSeedLivePanel } from './PersonaSeedLivePanel';
import { StockAvatarGallery } from './StockAvatarGallery';
import type { PersonaSeedDraft } from '@shared/avatar/personaSeedLive';
export type { PersonaAvatarMode, PersonaLiveAvatar } from '@shared/avatar/personaAvatar';

type AvatarAsset = {
  id: string;
  name: string;
  providerId: 'tavus' | 'anam';
  providerAvatarId: string | null;
  imageAssetId?: string;
  status: 'queued' | 'submitting' | 'processing' | 'ready' | 'failed' | 'reconciliation_required' | 'deleting' | 'deleted';
  capabilities: {
    reusable: boolean;
    liveRendering: boolean;
    validation: 'documentation_only' | 'provisioned' | 'live_verified';
  };
  liveValidated: boolean;
  liveValidation?: {
    status: 'unvalidated' | 'validated';
    runtimeSupported: boolean;
    method: 'client_playback_report' | null;
    sessionId: string | null;
    validatedAt: string | null;
  };
};

type AssetResponse = {
  projectId: string; assets: AvatarAsset[]; stockAvatars: PersonaStockAvatar[];
  voiceCatalog: { providers: Array<{ providerId: 'tavus' | 'anam'; status: 'available' | 'unconfigured' | 'unavailable'; errorCode: string | null }>; voices: PersonaVoice[] };
  voiceCatalogNextOffset: number | null;
  customLiveProviders: Array<'tavus' | 'anam'>;
  runtimeAvailable: false;
};

type Props = {
  creationSource?: PersonaAvatarSource;
  personaId?: string;
  seedSource?: string;
  seedDraft?: PersonaSeedDraft | null;
  onSeedDraftChange?: (draft: PersonaSeedDraft | null) => void;
  mode: PersonaAvatarMode;
  liveAvatar: PersonaLiveAvatar | null;
  videoManagementAllowed?: boolean;
  activeVideoEnabled?: boolean;
  onModeChange: (mode: PersonaAvatarMode) => void;
  onLiveAvatarChange: (avatar: PersonaLiveAvatar | null) => void;
};

let catalogRequestSequence = 0;

function displayCatalogName(name: string): string {
  return name.replace(/\b(Tavus|Anam)\b/gi, '아바타');
}

const provisioningLabels: Record<AvatarAsset['status'], string> = {
  queued: '대기 중',
  submitting: '제출 중',
  processing: '처리 중',
  ready: '준비 완료',
  failed: '실패',
  reconciliation_required: '확인 필요',
  deleting: '삭제 중',
  deleted: '삭제됨',
};

function AssetThumbnail({ asset }: { asset: AvatarAsset }) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const name = displayCatalogName(asset.name);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setThumbnailUrl(null);
    setUnavailable(!asset.imageAssetId);
    if (!asset.imageAssetId) return;

    void apiRequest(
      'GET',
      `/api/admin/personas/live-avatar/assets/${encodeURIComponent(asset.id)}/thumbnail`,
    )
      .then(response => response.blob())
      .then(blob => {
        if (!blob.type.startsWith('image/')) throw new Error('invalid_thumbnail_type');
        objectUrl = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setThumbnailUrl(objectUrl);
      })
      .catch(() => { if (active) setUnavailable(true); });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset.id, asset.imageAssetId]);

  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
      {asset.imageAssetId && thumbnailUrl && !unavailable ? (
        <img
          src={thumbnailUrl}
          alt={`${name} 썸네일`}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setUnavailable(true)}
        />
      ) : (
        <div role="img" aria-label={`${name} 미리보기 없음`} className="flex flex-col items-center gap-1 px-1 text-center text-[10px] text-slate-500">
          <ImageIcon size={22} aria-hidden="true" />
          <span>{asset.imageAssetId && !unavailable ? '미리보기 불러오는 중' : '미리보기 없음'}</span>
        </div>
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'ZodError') return '서버의 아바타 목록 응답 형식이 올바르지 않습니다. 관리자에게 연결 상태 확인을 요청하세요.';
  const message = error instanceof Error ? error.message : '';
  if (/persona_voice_unavailable|VOICE_NOT_AVAILABLE|VOICE_GENDER_CHANGED/.test(message)) {
    return '선택한 음성이 현재 공급자 목록이나 성별 분류와 일치하지 않습니다. 음성 목록을 새로고침한 뒤 다시 선택해 주세요.';
  }
  if (/403/.test(message)) return '아바타 목록 조회 권한이 없습니다. assets:read scope가 필요합니다.';
  if (/서버에 연결할 수 없습니다|Failed to fetch|NetworkError|fetch/i.test(message)) {
    return '서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
  }
  return message || '아바타 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function PersonaAvatarSettings({ mode, liveAvatar, onModeChange, onLiveAvatarChange, videoManagementAllowed = true, activeVideoEnabled = false,
  creationSource, personaId, seedSource = '', seedDraft = null, onSeedDraftChange }: Props) {
  const [assets, setAssets] = useState<AvatarAsset[] | null>(null);
  const [stockAvatars, setStockAvatars] = useState<PersonaStockAvatar[] | null>(null);
  const [voiceCatalog, setVoiceCatalog] = useState<AssetResponse['voiceCatalog'] | null>(null);
  const [voiceNextOffset, setVoiceNextOffset] = useState<number | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [voiceLoadError, setVoiceLoadError] = useState(false);
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female' | 'neutral'>('all');
  const [voiceSearch, setVoiceSearch] = useState('');
  const [browseProvider, setBrowseProvider] = useState<'all' | 'tavus' | 'anam'>('all');
  const [customLiveProviders, setCustomLiveProviders] = useState<AssetResponse['customLiveProviders']>(['tavus']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [testEntry, setTestEntry] = useState<'basic' | 'voice' | null>(null);
  const [selectedKind, setSelectedKind] = useState<'stock' | 'custom'>(
    liveAvatar ? (liveAvatar.kind === 'stock' ? 'stock' : 'custom') : seedDraft ? 'custom' : 'stock',
  );
  const [creationBusy, setCreationBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [creationOpen, setCreationOpen] = useState(false);
  const [seedPanelOpen, setSeedPanelOpen] = useState(false);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const seedFlow = Boolean(personaId && onSeedDraftChange);

  useEffect(() => {
    if (liveAvatar) {
      setSelectedKind(liveAvatar.kind === 'stock' ? 'stock' : 'custom');
    }
  }, [liveAvatar]);

  useEffect(() => {
    setVoiceSearch('');
    setVoiceGenderFilter('all');
  }, [liveAvatar?.providerId]);

  useEffect(() => {
    if (mode === 'live' && selectedKind === 'custom' && seedFlow && assets === null && !loading && !error) {
      void loadAssets();
    }
  }, [mode, selectedKind, seedFlow]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current = ++catalogRequestSequence;
    };
  }, []);

  const loadAssets = async () => {
    const requestId = ++catalogRequestSequence;
    requestRef.current = requestId;
    setLoading(true);
    setLoadingVoices(false);
    setVoiceLoadError(false);
    setError(null);
    try {
      const response = await apiRequest('GET', '/api/admin/personas/live-avatar/assets');
      const result: AssetResponse = personaAvatarCatalogSchema.parse(await response.json());
      if (!mountedRef.current || requestRef.current !== requestId) return;
      setAssets(result.assets);
      setStockAvatars(result.stockAvatars);
      setVoiceCatalog(result.voiceCatalog);
      setVoiceNextOffset(result.voiceCatalogNextOffset);
      setCustomLiveProviders(result.customLiveProviders);
      setProjectId(result.projectId);
    } catch (cause) {
      if (!mountedRef.current || requestRef.current !== requestId) return;
      setError(errorMessage(cause));
    } finally {
      if (mountedRef.current && requestRef.current === requestId) setLoading(false);
    }
  };

  const loadRemainingVoices = async () => {
    if (loadingVoices || loading || !projectId || voiceNextOffset === null) return;
    const requestId = requestRef.current;
    const isCurrent = () => mountedRef.current && requestRef.current === requestId;
    setLoadingVoices(true);
    setVoiceLoadError(false);
    let offset: number | null = voiceNextOffset;
    try {
      while (offset !== null && isCurrent()) {
        const query = new URLSearchParams({ projectId, offset: String(offset) });
        const response = await apiRequest('GET', `/api/admin/personas/live-avatar/voices?${query}`);
        const page = personaVoiceCatalogPageSchema.parse(await response.json());
        if (!isCurrent()) return;
        if (page.nextOffset !== null && page.nextOffset <= offset) throw new Error('invalid_voice_catalog_offset');
        setVoiceCatalog(previous => {
          const unique = new Map<string, PersonaVoice>();
          for (const voice of [...(previous?.voices ?? []), ...page.voices]) unique.set(`${voice.providerId}:${voice.id}`, voice);
          return { providers: page.providers, voices: Array.from(unique.values()) };
        });
        offset = page.nextOffset;
        setVoiceNextOffset(offset);
      }
    } catch {
      if (isCurrent()) setVoiceLoadError(true);
    } finally {
      if (isCurrent()) setLoadingVoices(false);
    }
  };

  const customAssetId = liveAvatar && liveAvatar.kind !== 'stock' ? liveAvatar.assetId : null;
  const stockAvatarId = liveAvatar?.kind === 'stock' ? liveAvatar.avatarId : null;
  const selectedAsset = assets?.find(asset => asset.id === customAssetId);
  const selectedStock = stockAvatars?.find(avatar => avatar.id === stockAvatarId && avatar.providerId === liveAvatar?.providerId);
  const selectedVoice = liveAvatar?.voiceSelection;
  const selectedVoiceEntry = selectedVoice && voiceCatalog?.voices.find(voice =>
    voice.providerId === liveAvatar?.providerId && voice.id === selectedVoice.voiceId && voice.gender === selectedVoice.gender);
  const selectedVoiceProvider = liveAvatar && voiceCatalog?.providers.find(provider => provider.providerId === liveAvatar.providerId);
  const providerVoices = voiceCatalog?.voices.filter(voice =>
    voice.providerId === liveAvatar?.providerId && voice.gender !== 'unclassified' && voice.available) ?? [];
  const selectableVoices = providerVoices.filter(voice =>
    (voiceGenderFilter === 'all' || voice.gender === voiceGenderFilter) &&
    voice.name.toLocaleLowerCase().includes(voiceSearch.trim().toLocaleLowerCase()));
  const selectedMissing = Boolean(liveAvatar && assets && !selectedAsset && !selectedStock);
  const selectedTavusCustom = Boolean(liveAvatar && liveAvatar.kind !== 'stock' && liveAvatar.providerId === 'tavus');
  const selectedLucy = liveAvatar?.kind === 'stock' && liveAvatar.providerId === 'tavus' && liveAvatar.avatarId === 'tavus-stock-lucy';
  const selectedAnam = liveAvatar?.kind === 'stock' && liveAvatar.providerId === 'anam' && liveAvatar.avatarId === 'anam-persona-default';
  const hasSelectedTest = Boolean(selectedTavusCustom || selectedLucy || selectedAnam);
  const selectableAssets = (assets ?? []).filter(asset =>
    asset.status === 'ready' &&
    asset.capabilities.reusable &&
    Boolean(asset.providerAvatarId) &&
    customLiveProviders.includes(asset.providerId)
  );
  const browsedAssets = selectableAssets.filter(asset => browseProvider === 'all' || asset.providerId === browseProvider);
  const customProviderUnavailable = browseProvider !== 'all' && !customLiveProviders.includes(browseProvider);

  const chooseAsset = (assetId: string) => {
    if (testBusy) return;
    setTestEntry(null);
    if (!assetId) {
      onLiveAvatarChange(null);
      return;
    }
    const asset = selectableAssets.find(candidate => candidate.id === assetId);
    if (!asset) return;
    onLiveAvatarChange({
      kind: 'custom',
      assetId: asset.id,
      providerId: asset.providerId,
      voiceMode: 'roleplayx',
      validationStatus: isLiveValidatedPersonaAvatar(asset) ? 'live_verified' : 'unverified',
      activation: 'draft',
      ...(projectId ? { projectId } : {}),
    });
    if (seedFlow) {
      onSeedDraftChange?.(null);
      setSeedPanelOpen(false);
    }
  };

  const chooseStock = (avatarId: string) => {
    if (testBusy) return;
    setTestEntry(null);
    if (!avatarId) return onLiveAvatarChange(null);
    const avatar = stockAvatars?.find(candidate => candidate.id === avatarId && isSelectableStockAvatar(candidate));
    if (!avatar) return;
    onLiveAvatarChange({
      kind: 'stock', avatarId: avatar.id, providerId: avatar.providerId as 'tavus' | 'anam',
      voiceMode: 'roleplayx', validationStatus: 'unverified', activation: 'draft',
      ...(projectId ? { projectId } : {}),
    });
  };

  const chooseVoice = (voiceId: string) => {
    if (!liveAvatar) return;
    const { voiceSelection: _oldSelection, ...withoutVoice } = liveAvatar;
    if (!voiceId) {
      onLiveAvatarChange(withoutVoice);
      return;
    }
    const voice = selectableVoices.find(item => item.id === voiceId);
    if (!voice) return;
    onLiveAvatarChange({ ...liveAvatar, voiceSelection: { voiceId: voice.id, gender: voice.gender as 'male' | 'female' | 'neutral' } });
  };

  const chooseKind = (kind: 'stock' | 'custom') => {
    if (testBusy || creationBusy) return;
    setSelectedKind(kind);
    setTestEntry(null);
    if (liveAvatar && (kind === 'stock') !== (liveAvatar.kind === 'stock')) onLiveAvatarChange(null);
  };
  const changeMode = (nextMode: PersonaAvatarMode) => {
    if (testBusy || creationBusy) return;
    if (nextMode !== 'live') setTestEntry(null);
    onModeChange(nextMode);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="persona-avatar-settings-title">
      <div className="mb-4">
        <h3 id="persona-avatar-settings-title" className="text-base font-bold text-slate-900">아바타 표시 방식</h3>
        <p className="mt-1 text-sm text-slate-600">페르소나 대화에 사용할 이미지 또는 비디오 구성을 선택합니다.</p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="아바타 표시 방식">
        {([
          ['image', '이미지'],
          ['video', '비디오'],
          ['live', '라이브 아바타'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={!videoManagementAllowed && (value === 'video' || (value === 'image' && activeVideoEnabled)) || testBusy || creationBusy}
            onClick={() => changeMode(value)}
            className={`min-h-11 rounded-md border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === value
                ? 'border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-600'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {!videoManagementAllowed && <p className="mt-2 text-xs text-slate-500">비디오 표시 변경은 비디오 관리 권한이 필요합니다.</p>}

      {mode === 'live' && (
        <div className="mt-4 space-y-4">
          {!liveAvatar && (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">라이브 아바타 미연결</p>
              <p className="mt-1">표시 방식만 라이브로 선택하면 대화에서 사용할 수 없습니다. 아래 목록에서 기본 또는 맞춤 아바타를 하나 선택하고 상단 ‘저장’을 누르세요. 새 시나리오 대화부터 적용됩니다.</p>
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-700">아바타 종류</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="아바타 종류">
              {([
                ['stock', '기본 아바타'],
                ['custom', '맞춤 아바타'],
              ] as const).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={selectedKind === kind}
                  disabled={testBusy || creationBusy}
                  onClick={() => chooseKind(kind)}
                  className={`min-h-11 rounded-md border px-4 py-2 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                    selectedKind === kind
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-600'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {(testBusy || creationBusy) && (
              <p className="text-xs text-amber-800" role="status">
                {testBusy ? '테스트 세션 또는 정리 작업이 진행 중이거나 확인이 필요해 종류와 대상을 잠시 제한합니다.' : '커스텀 생성 작업이 진행 중이거나 결과 확인이 필요해 종류 변경을 잠시 제한합니다.'}
              </p>
            )}
          </fieldset>

          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">저장된 설정은 아바타 참조 정보입니다.</p>
            <p className="mt-1 leading-relaxed">
              실제 대화 사용은 전역 및 시나리오 허용, 서비스 준비 상태, 사용자 동의가 모두 필요합니다. 설정 저장이나 관리자 테스트만으로 대화가 시작되거나 유료 세션이 생성되지는 않습니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={loadAssets} disabled={loading || testBusy}>
              {loading ? '목록 조회 중…' : assets === null ? '아바타 목록 조회' : '목록 새로고침'}
            </Button>
            {projectId && <span className="text-xs text-slate-500">프로젝트 {projectId}</span>}
          </div>

          {loading && (
            <div role="status" className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="h-3 w-2/5 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-slate-100" />
              <span className="sr-only">아바타 목록을 불러오는 중입니다.</span>
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>{error}</p>
              <Button type="button" variant="link" className="h-auto p-0 text-red-800" onClick={loadAssets} disabled={loading}>
                다시 시도
              </Button>
            </div>
          )}

          {!loading && !error && stockAvatars !== null && (
            <label className="block max-w-xs text-sm font-medium text-slate-700">
              아바타 공급자
              <select value={browseProvider} disabled={testBusy || creationBusy}
                onChange={event => setBrowseProvider(event.target.value as typeof browseProvider)}
                className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
                <option value="all">전체 공급자</option>
                <option value="tavus">Tavus</option>
                <option value="anam">Anam</option>
              </select>
            </label>
          )}

          {liveAvatar && selectedKind === (liveAvatar.kind === 'stock' ? 'stock' : 'custom') && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <p className="font-semibold text-slate-800">연결된 아바타</p>
                  <p className="mt-1 break-all text-slate-600">
                    {liveAvatar.kind === 'stock' ? '기본 아바타' : '맞춤 아바타'} · 외부 서비스 연결
                  </p>
                </div>
                 <Button type="button" variant="link" className="h-auto p-0" disabled={testBusy} onClick={() => { setTestEntry(null); onLiveAvatarChange(null); }}>
                   아바타 연결 해제
                </Button>
              </div>
            </div>
          )}

          {liveAvatar && selectedKind === (liveAvatar.kind === 'stock' ? 'stock' : 'custom') && (
            <section className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50/50 p-4" aria-label="라이브 대화 음성 모델">
              <div>
                <h4 className="text-sm font-semibold text-slate-800">라이브 대화 음성</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  선택한 Tavus·Anam 전체 파이프라인이 대화와 음성을 생성합니다. 이 모드에서는 Gemini Live 음성을 함께 실행하지 않습니다.
                </p>
              </div>
              {!voiceCatalog ? (
                <p className="text-xs text-slate-600">음성 목록은 아바타 목록 조회 후 표시됩니다.</p>
              ) : selectedVoiceProvider?.status !== 'available' ? (
                <p className="text-xs text-amber-900" role="status">
                  {liveAvatar.providerId === 'anam' ? 'Anam' : 'Tavus'} 음성 목록을 현재 확인할 수 없습니다. provider 설정 또는 카탈로그 상태를 확인하세요.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-700 sm:col-span-2">
                    음성 이름 검색
                    <input type="search" value={voiceSearch} onChange={event => setVoiceSearch(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    음성 성별
                    <select
                      aria-label="음성 성별"
                      value={voiceGenderFilter}
                      disabled={testBusy || creationBusy}
                      onChange={event => setVoiceGenderFilter(event.target.value as typeof voiceGenderFilter)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    >
                      <option value="all">전체 성별</option>
                      <option value="male">남성</option>
                      <option value="female">여성</option>
                      <option value="neutral">중립</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-700">
                    음성 모델
                    <select
                      aria-label="음성 모델"
                      value={selectedVoice?.voiceId ?? ''}
                      disabled={testBusy || creationBusy}
                      onChange={event => chooseVoice(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    >
                      <option value="">공급자 기본 음성 사용</option>
                      {selectedVoice && !selectableVoices.some(voice => voice.id === selectedVoice.voiceId) && (
                        <option value={selectedVoice.voiceId}>{selectedVoiceEntry?.name ?? '저장한 음성'} · 현재 선택</option>
                      )}
                      {selectableVoices.map(voice => (
                        <option key={`${voice.providerId}:${voice.id}`} value={voice.id}>
                          {voice.name}{voice.genderSource === 'admin' ? ' · 관리자 분류' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {selectedVoice && !selectedVoiceEntry && voiceCatalog && voiceNextOffset === null && (
                <p className="text-xs text-amber-900" role="alert">
                  저장된 음성이 현재 목록에서 확인되지 않습니다. 자동으로 다른 음성을 고르지 않았습니다. 목록을 새로고침한 뒤 다시 선택하세요.
                </p>
              )}
              {selectedVoiceEntry && (
                <p className="text-xs text-slate-600" role="status">
                  선택됨: {selectedVoiceEntry.name} · {selectedVoiceEntry.genderSource === 'admin' ? '관리자 지정 성별' : '제공자 성별 정보'}
                </p>
              )}
              {selectedVoiceProvider?.status === 'available' && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span role="status">{voiceSearch ? `검색 결과 ${selectableVoices.length}개` : `불러온 선택 가능 음성 ${providerVoices.length}개`}</span>
                  {voiceNextOffset !== null && <Button type="button" size="sm" variant="outline"
                    disabled={loading || loadingVoices || testBusy || creationBusy} onClick={() => void loadRemainingVoices()}>
                    {loadingVoices ? '나머지 음성 불러오는 중…' : '나머지 음성 불러오기'}
                  </Button>}
                </div>
              )}
              {voiceLoadError && <p className="text-xs text-amber-900" role="alert">음성 목록 일부를 불러오지 못했습니다. 이미 불러온 음성은 계속 선택할 수 있습니다.</p>}
            </section>
          )}

          {selectedKind === 'stock' && liveAvatar?.kind === 'stock' && selectedStock && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-800">선택한 기본 아바타</p>
               <p className="mt-1 text-slate-600">{displayCatalogName(selectedStock.name)} · {isSelectableStockAvatar(selectedStock) ? '선택 가능' : '현재 선택 불가'}</p>
            </div>
          )}
          {selectedKind === 'stock' && liveAvatar?.kind === 'stock' && selectedMissing && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              새로 조회한 목록에서 저장된 기본 아바타를 찾지 못했습니다. 다른 아바타로 자동 변경하지 않았습니다.
            </p>
          )}

          {selectedKind === 'stock' && stockAvatars !== null && !loading && !error && (
            <div className="space-y-2">
              <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-900" role="note">
                읽기 전용 카탈로그입니다. 목록은 연결된 서비스 계정에서 현재 구성·제공하는 기본 아바타를 그대로 보여 주며, 요금제에 따라 개수가 달라질 수 있습니다.
              </div>
              <p className="text-sm font-semibold text-slate-700">기본 아바타</p>
              <StockAvatarGallery
                avatars={browseProvider === 'all' ? stockAvatars : stockAvatars.filter(avatar => avatar.providerId === browseProvider)}
                selectedId={selectedStock ? stockAvatarId : null}
                selectedProviderId={selectedStock ? liveAvatar?.providerId ?? null : null}
                disabled={testBusy}
                onSelect={chooseStock}
                displayName={displayCatalogName}
              />
              <p className="text-xs text-slate-500">선택한 아바타는 페르소나를 저장하면 반영됩니다. 아바타 실행과 세션 관리는 라우터가 처리합니다.</p>
            </div>
          )}

          {selectedKind === 'custom' && liveAvatar?.kind !== 'stock' && selectedAsset && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-800">선택한 커스텀 아바타</p>
              <p className="mt-1 text-slate-600">
                라우터 자산 상태: {provisioningLabels[selectedAsset.status]}
              </p>
              {!selectableAssets.some(asset => asset.id === selectedAsset.id) && (
                <p className="mt-1 text-amber-800">이 자산은 현재 선택 조건을 충족하지 않습니다. 연결은 유지했으며 다른 자산으로 자동 변경하지 않았습니다.</p>
              )}
            </div>
          )}
          {selectedKind === 'custom' && liveAvatar?.kind !== 'stock' && selectedMissing && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              새로 조회한 목록에서 저장된 자산을 찾지 못했습니다. 삭제·실패·목록 접근 불가일 수 있습니다. 다른 자산으로 자동 변경하지 않았습니다.
            </p>
          )}

          {selectedKind === 'custom' && assets !== null && browseProvider === 'all' && !customLiveProviders.includes('anam') && (
            <p role="note" className="text-xs text-slate-600">
              현재 이 라우터는 Anam 기본 아바타만 라이브로 연결할 수 있습니다.
            </p>
          )}
          {selectedKind === 'custom' && assets !== null && !loading && !error && (
            customProviderUnavailable ? (
              <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                현재 라우터에서 {browseProvider === 'anam' ? 'Anam' : 'Tavus'} 맞춤 아바타를 지원하지 않습니다. 기본 아바타를 선택하거나 다른 공급자를 확인하세요.
              </p>
            ) : browsedAssets.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                선택할 수 있는 프로젝트 커스텀 아바타가 없습니다. 준비 완료·재사용 가능 자산만 표시합니다.
                Studio 개인 자산과 프로젝트 API 키 자산은 자동 공유되지 않습니다.
                기본 아바타 중 일부는 커스텀 자산 목록에 포함되지 않으며 별도의 관리자 라이브 테스트에서 확인할 수 있습니다.
              </div>
            ) : (
              <div className="space-y-2">
                {seedFlow ? (
                  <div className="space-y-2" aria-label="프로젝트 커스텀 아바타 카탈로그">
                    <p className="text-sm font-semibold text-slate-700">프로젝트 커스텀 아바타</p>
                    <p className="text-xs leading-relaxed text-slate-600">
                      완성된 자산은 시드 준비와 별개로 페르소나 편집 초안에 연결됩니다. 페르소나를 저장해야 변경이 반영되며, 목록 조회는 읽기 전용이라 생성·재생 요청을 보내지 않습니다.
                    </p>
                    {browsedAssets.map(asset => {
                      const selected = customAssetId === asset.id;
                      return (
                        <div key={asset.id} className={`flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between ${selected ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-200 bg-white'}`}>
                          <AssetThumbnail asset={asset} />
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold text-slate-800">{displayCatalogName(asset.name)}</p>
                            <p className="mt-1 break-all font-mono text-xs text-slate-500">자산 ID · {asset.id}</p>
                            <p className="mt-1 text-xs text-slate-600">라우터 상태: {provisioningLabels[asset.status]}</p>
                            {selected && <p className="mt-1 text-xs font-semibold text-indigo-800">현재 페르소나 초안에 연결됨 · 저장 후 반영</p>}
                          </div>
                          <Button type="button" size="sm" variant={selected ? 'default' : 'outline'} disabled={testBusy} onClick={() => chooseAsset(asset.id)}>
                            {selected ? '선택됨' : '이 자산 선택'}
                          </Button>
                        </div>
                      );
                    })}
                    <p className="text-xs leading-relaxed text-slate-500">
                      기존 선택은 새로고침이나 조회 오류 시에도 자동으로 바뀌지 않습니다.
                    </p>
                  </div>
                ) : (
                  <>
                    <label htmlFor="live-avatar-asset" className="text-sm font-semibold text-slate-700">연결할 커스텀 자산</label>
                    <select
                      id="live-avatar-asset"
                      value={selectedAsset ? customAssetId ?? '' : ''}
                      disabled={testBusy}
                      onChange={event => chooseAsset(event.target.value)}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">자산 선택</option>
                      {browsedAssets.map(asset => (
                          <option key={asset.id} value={asset.id}>
                            {displayCatalogName(asset.name)} · 외부 서비스 · {provisioningLabels[asset.status]}
                          </option>
                      ))}
                    </select>
                  </>
                )}
                <p className="text-xs leading-relaxed text-slate-500">
                  선택 조건: 준비 완료, 재사용 가능, 서비스 아바타 ID 보유. 이미지가 연결된 자산은 프로젝트 보안 경로로 미리보기를 불러옵니다.
                  아바타 상태는 라우터가 반환한 내용을 표시합니다.
                </p>
              </div>
            )
          )}

          {selectedKind === 'custom' && !customProviderUnavailable && customLiveProviders.includes('tavus') && browseProvider !== 'anam' && (
            personaId && onSeedDraftChange ? (
              <>
                {liveAvatar && liveAvatar.kind !== 'stock' && !liveAvatar.seedImageAssetId && !seedPanelOpen ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-800">기본 이미지 시드와 독립된 자산</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">선택한 프로젝트 자산은 시드 초안과 별도로 연결되어 있습니다. 필요할 때만 시드 준비 상태를 열어 확인할 수 있습니다.</p>
                    <Button type="button" size="sm" variant="outline" className="mt-3" disabled={testBusy} onClick={() => setSeedPanelOpen(true)}>시드 준비 열기</Button>
                  </div>
                ) : !testBusy && !testEntry ? (
                  <PersonaSeedLivePanel
                    personaId={personaId} source={seedSource} draft={seedDraft}
                    onDraftChange={onSeedDraftChange} onSelect={onLiveAvatarChange} onActivityChange={setCreationBusy}
                  />
                ) : null}
              </>
            ) :
            <section className="rounded-md border border-slate-200 bg-white p-3" aria-labelledby="persona-create-disclosure">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 id="persona-create-disclosure" className="text-sm font-semibold text-slate-800">새 커스텀 아바타가 필요한가요?</h4>
                  <p className="mt-1 text-xs text-slate-600">생성 양식은 직접 열고, 확인 항목을 모두 완료한 경우에만 제출됩니다.</p>
                </div>
                <Button type="button" size="sm" variant="outline" disabled={creationBusy} aria-expanded={creationOpen}
                  onClick={() => setCreationOpen(open => !open)}>
                  {creationOpen ? '생성 양식 닫기' : '생성 양식 열기'}
                </Button>
              </div>
              <div className={creationOpen ? 'mt-3' : ''} hidden={!creationOpen} aria-hidden={!creationOpen}>
                <PersonaAvatarCreationPanel source={creationSource} onSubmitted={() => void loadAssets()} onActivityChange={setCreationBusy} />
              </div>
            </section>
          )}
          {liveAvatar && selectedKind === (liveAvatar.kind === 'stock' ? 'stock' : 'custom') && <div className="space-y-2">
            <p className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-950">
              선택한 아바타를 라우터에 연결합니다. 실행과 세션 관리는 라우터가 처리하며, 페르소나 변경 사항은 별도로 저장해야 반영됩니다.
            </p>
            {hasSelectedTest ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={testBusy || creationBusy}
                  aria-expanded={testEntry === 'voice'} onClick={() => setTestEntry(open => open === 'voice' ? null : 'voice')}>
                  {testEntry === 'voice' ? '음성 선택 테스트 닫기' : '음성 선택 테스트'}
                </Button>
                <Button type="button" variant="outline" disabled={testBusy || creationBusy}
                  aria-expanded={testEntry === 'basic'} onClick={() => setTestEntry(open => open === 'basic' ? null : 'basic')}>
                  {testEntry === 'basic' ? '선택 아바타 테스트 닫기' : '선택 아바타 테스트'}
                </Button>
              </div>
            ) : (
              <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {liveAvatar.kind !== 'stock'
                  ? '선택한 외부 서비스 아바타는 이 관리자 재생 테스트에서 지원되지 않습니다.'
                  : '선택한 기본 아바타는 이 관리자 테스트에서 지원되지 않습니다. 현재 일부 기본 아바타만 테스트할 수 있습니다.'}
              </p>
            )}
            {(testEntry === 'voice' || (testEntry === 'basic' && selectedAnam && Boolean(selectedVoice))) && hasSelectedTest && (
              <AvatarVoiceTestPanel key={liveAvatar.kind === 'stock' ? liveAvatar.avatarId : liveAvatar.assetId}
                target={liveAvatar.kind === 'stock' ? liveAvatar.avatarId : liveAvatar.assetId}
                initialVoice={selectedVoice} initialVoiceName={selectedVoiceEntry?.name} onActivityChange={setTestBusy} />
            )}
            {testEntry === 'basic' && liveAvatar.kind !== 'stock' && selectedTavusCustom && (
                <PersonaAvatarValidationPanel key={liveAvatar.assetId} assetId={liveAvatar.assetId} assetName={displayCatalogName(selectedAsset?.name ?? '저장된 커스텀 자산')} onReported={() => void loadAssets()} onActivityChange={setTestBusy} />
            )}
            {testEntry === 'basic' && selectedLucy && <LiveAvatarTestPanel onActivityChange={setTestBusy} />}
            {testEntry === 'basic' && selectedAnam && !selectedVoice && <AnamAvatarTestPanel onActivityChange={setTestBusy} />}
          </div>}
        </div>
      )}
    </section>
  );
}
