import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import type { PersonaAvatarMode, PersonaLiveAvatar, PersonaStockAvatar } from '@shared/avatar/personaAvatar';
import { isLiveValidatedPersonaAvatar, isSelectableStockAvatar, personaAvatarCatalogSchema } from '@shared/avatar/personaAvatar';
import { PersonaAvatarCreationPanel } from '@/components/admin/PersonaAvatarCreationPanel';
import { PersonaAvatarValidationPanel } from '@/components/admin/PersonaAvatarValidationPanel';
import { LiveAvatarTestPanel } from '@/components/admin/LiveAvatarTestPanel';
import { AnamAvatarTestPanel } from '@/components/admin/AnamAvatarTestPanel';
import { PersonaSeedLivePanel } from './PersonaSeedLivePanel';
import { StockAvatarGallery } from './StockAvatarGallery';
import type { PersonaSeedDraft } from '@shared/avatar/personaSeedLive';
export type { PersonaAvatarMode, PersonaLiveAvatar } from '@shared/avatar/personaAvatar';

type AvatarAsset = {
  id: string;
  name: string;
  providerId: 'tavus' | 'anam';
  providerAvatarId: string | null;
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

type AssetResponse = { projectId: string; assets: AvatarAsset[]; stockAvatars: PersonaStockAvatar[]; runtimeAvailable: false };

type Props = {
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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'ZodError') return '서버의 아바타 목록 응답 형식이 올바르지 않습니다. 관리자에게 연결 상태 확인을 요청하세요.';
  const message = error instanceof Error ? error.message : '';
  if (/403/.test(message)) return '아바타 목록 조회 권한이 없습니다. assets:read scope가 필요합니다.';
  if (/서버에 연결할 수 없습니다|Failed to fetch|NetworkError|fetch/i.test(message)) {
    return '서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
  }
  return message || '아바타 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function PersonaAvatarSettings({ mode, liveAvatar, onModeChange, onLiveAvatarChange, videoManagementAllowed = true, activeVideoEnabled = false,
  personaId, seedSource = '', seedDraft = null, onSeedDraftChange }: Props) {
  const [assets, setAssets] = useState<AvatarAsset[] | null>(null);
  const [stockAvatars, setStockAvatars] = useState<PersonaStockAvatar[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [testEntryOpen, setTestEntryOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<'stock' | 'custom'>(liveAvatar ? (liveAvatar.kind === 'stock' ? 'stock' : 'custom') : 'stock');
  const [creationBusy, setCreationBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [creationOpen, setCreationOpen] = useState(false);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);
  const seedFlow = Boolean(personaId && onSeedDraftChange);

  useEffect(() => {
    if (liveAvatar) setSelectedKind(liveAvatar.kind === 'stock' ? 'stock' : 'custom');
  }, [liveAvatar]);

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
    setError(null);
    try {
      const response = await apiRequest('GET', '/api/admin/personas/live-avatar/assets');
      const result: AssetResponse = personaAvatarCatalogSchema.parse(await response.json());
      if (!mountedRef.current || requestRef.current !== requestId) return;
      setAssets(result.assets);
      setStockAvatars(result.stockAvatars);
      setProjectId(result.projectId);
    } catch (cause) {
      if (!mountedRef.current || requestRef.current !== requestId) return;
      setError(errorMessage(cause));
    } finally {
      if (mountedRef.current && requestRef.current === requestId) setLoading(false);
    }
  };

  const customAssetId = liveAvatar && liveAvatar.kind !== 'stock' ? liveAvatar.assetId : null;
  const stockAvatarId = liveAvatar?.kind === 'stock' ? liveAvatar.avatarId : null;
  const selectedAsset = assets?.find(asset => asset.id === customAssetId);
  const selectedStock = stockAvatars?.find(avatar => avatar.id === stockAvatarId && avatar.providerId === liveAvatar?.providerId);
  const selectedMissing = Boolean(liveAvatar && assets && !selectedAsset && !selectedStock);
  const selectedTavusCustom = Boolean(liveAvatar && liveAvatar.kind !== 'stock' && liveAvatar.providerId === 'tavus');
  const selectedLucy = liveAvatar?.kind === 'stock' && liveAvatar.providerId === 'tavus' && liveAvatar.avatarId === 'tavus-stock-lucy';
  const selectedAnam = liveAvatar?.kind === 'stock' && liveAvatar.providerId === 'anam' && liveAvatar.avatarId === 'anam-persona-default';
  const hasSelectedTest = Boolean(selectedTavusCustom || selectedLucy || selectedAnam);
  const selectableAssets = (assets ?? []).filter(asset =>
    asset.status === 'ready' &&
    asset.capabilities.reusable &&
    Boolean(asset.providerAvatarId) &&
    (asset.providerId === 'tavus' || asset.providerId === 'anam')
  );

  const chooseAsset = (assetId: string) => {
    if (testBusy) return;
    setTestEntryOpen(false);
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
  };

  const chooseStock = (avatarId: string) => {
    if (testBusy) return;
    setTestEntryOpen(false);
    if (!avatarId) return onLiveAvatarChange(null);
    const avatar = stockAvatars?.find(candidate => candidate.id === avatarId && isSelectableStockAvatar(candidate));
    if (!avatar) return;
    onLiveAvatarChange({
      kind: 'stock', avatarId: avatar.id, providerId: avatar.providerId as 'tavus' | 'anam',
      voiceMode: 'roleplayx', validationStatus: 'unverified', activation: 'draft',
      ...(projectId ? { projectId } : {}),
    });
  };

  const chooseKind = (kind: 'stock' | 'custom') => {
    if (testBusy || creationBusy) return;
    setSelectedKind(kind);
    setTestEntryOpen(false);
    if (liveAvatar && (kind === 'stock') !== (liveAvatar.kind === 'stock')) onLiveAvatarChange(null);
  };
  const changeMode = (nextMode: PersonaAvatarMode) => {
    if ((testBusy || creationBusy) && nextMode !== 'live') return;
    if (nextMode !== 'live') setTestEntryOpen(false);
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
            disabled={!videoManagementAllowed && (value === 'video' || (value === 'image' && activeVideoEnabled)) || ((testBusy || creationBusy) && value !== 'live')}
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
            <Button type="button" variant="outline" onClick={loadAssets} disabled={loading}>
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

          {liveAvatar && selectedKind === (liveAvatar.kind === 'stock' ? 'stock' : 'custom') && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <p className="font-semibold text-slate-800">연결된 아바타</p>
                  <p className="mt-1 break-all text-slate-600">
                    {liveAvatar.kind === 'stock' ? '기본 아바타' : '맞춤 아바타'} · 외부 서비스 연결
                  </p>
                  <p className="mt-1 text-slate-600">Live 검증: {liveAvatar.validationStatus === 'live_verified' ? '검증됨' : '미검증'}</p>
                </div>
                 <Button type="button" variant="link" className="h-auto p-0" disabled={testBusy} onClick={() => { setTestEntryOpen(false); onLiveAvatarChange(null); }}>
                   아바타 연결 해제
                </Button>
              </div>
            </div>
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
                avatars={stockAvatars}
                selectedId={selectedStock ? stockAvatarId : null}
                selectedProviderId={selectedStock ? liveAvatar?.providerId ?? null : null}
                disabled={testBusy}
                onSelect={chooseStock}
                displayName={displayCatalogName}
              />
              <p className="text-xs text-slate-500">카탈로그에서 선택한 것은 재생 검증 근거가 아닙니다. 선택은 초안으로만 반영되며 저장해도 유료 세션이 생성되거나 업로드가 일어나지 않습니다. 실제 라이브 사용은 별도 비용 동의가 필요합니다.</p>
            </div>
          )}

          {selectedKind === 'custom' && liveAvatar?.kind !== 'stock' && selectedAsset && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-800">선택한 커스텀 아바타</p>
              <p className="mt-1 text-slate-600">
                현재 자산 상태: {provisioningLabels[selectedAsset.status]} · Live 검증: {isLiveValidatedPersonaAvatar(selectedAsset) ? '검증됨' : '미검증'}
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

          {selectedKind === 'custom' && !seedFlow && assets !== null && !loading && !error && (
            assets.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                조회 가능한 프로젝트 소유 커스텀 자산이 없습니다. Studio 개인 자산과 프로젝트 API 키 자산은 자동 공유되지 않습니다.
                기본 아바타 중 일부는 커스텀 자산 목록에 포함되지 않으며 별도의 관리자 라이브 테스트에서 확인할 수 있습니다.
                준비 완료·재사용 가능 자산만 선택할 수 있습니다.
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="live-avatar-asset" className="text-sm font-semibold text-slate-700">연결할 커스텀 자산</label>
                <select
                  id="live-avatar-asset"
                  value={selectedAsset ? customAssetId ?? '' : ''}
                  disabled={testBusy}
                  onChange={event => chooseAsset(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">자산 선택</option>
                  {assets.map(asset => {
                    const eligible = selectableAssets.some(candidate => candidate.id === asset.id);
                    return (
                      <option key={asset.id} value={asset.id} disabled={!eligible}>
                        {displayCatalogName(asset.name)} · 외부 서비스 · {provisioningLabels[asset.status]}
                        {!eligible ? ' · 선택 불가' : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="text-xs leading-relaxed text-slate-500">
                  선택 조건: 준비 완료, 재사용 가능, 서비스 아바타 ID 보유. 미리보기 URL은 제공되지 않습니다.
                  자산 준비 상태와 Live 검증 상태는 별도로 표시됩니다.
                </p>
              </div>
            )
          )}

          {selectedKind === 'custom' && (
            personaId && onSeedDraftChange ? <PersonaSeedLivePanel
              personaId={personaId} source={seedSource} draft={seedDraft}
              onDraftChange={onSeedDraftChange} onSelect={onLiveAvatarChange} onActivityChange={setCreationBusy}
            /> :
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
                <PersonaAvatarCreationPanel onSubmitted={() => void loadAssets()} onActivityChange={setCreationBusy} />
              </div>
            </section>
          )}
          {liveAvatar && !(seedFlow && liveAvatar.kind !== 'stock') && selectedKind === (liveAvatar.kind === 'stock' ? 'stock' : 'custom') && <div className="space-y-2">
            {hasSelectedTest ? (
              <Button type="button" variant="outline" disabled={testBusy} onClick={() => setTestEntryOpen(open => !open)}>
                {testEntryOpen ? '선택 아바타 테스트 닫기' : '선택 아바타 테스트'}
              </Button>
            ) : (
              <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {liveAvatar.kind !== 'stock'
                  ? '선택한 외부 서비스 아바타는 이 관리자 재생 테스트에서 지원되지 않습니다.'
                  : '선택한 기본 아바타는 이 관리자 테스트에서 지원되지 않습니다. 현재 일부 기본 아바타만 테스트할 수 있습니다.'}
              </p>
            )}
            {testEntryOpen && liveAvatar.kind !== 'stock' && selectedTavusCustom && (
                <PersonaAvatarValidationPanel key={liveAvatar.assetId} assetId={liveAvatar.assetId} assetName={displayCatalogName(selectedAsset?.name ?? '저장된 커스텀 자산')} onReported={() => void loadAssets()} onActivityChange={setTestBusy} />
            )}
            {testEntryOpen && selectedLucy && <LiveAvatarTestPanel onActivityChange={setTestBusy} />}
            {testEntryOpen && selectedAnam && <AnamAvatarTestPanel onActivityChange={setTestBusy} />}
          </div>}
        </div>
      )}
    </section>
  );
}
