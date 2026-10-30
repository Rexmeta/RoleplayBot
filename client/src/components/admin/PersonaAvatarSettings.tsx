import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import type { PersonaAvatarMode, PersonaLiveAvatar } from '@shared/avatar/personaAvatar';
import { isLiveValidatedPersonaAvatar, personaAvatarCatalogSchema } from '@shared/avatar/personaAvatar';
import { PersonaAvatarCreationPanel } from '@/components/admin/PersonaAvatarCreationPanel';
import { PersonaAvatarValidationPanel } from '@/components/admin/PersonaAvatarValidationPanel';
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

type AssetResponse = { projectId: string; assets: AvatarAsset[]; runtimeAvailable: false };

type Props = {
  mode: PersonaAvatarMode;
  liveAvatar: PersonaLiveAvatar | null;
  videoManagementAllowed?: boolean;
  activeVideoEnabled?: boolean;
  onModeChange: (mode: PersonaAvatarMode) => void;
  onLiveAvatarChange: (avatar: PersonaLiveAvatar | null) => void;
};

let catalogRequestSequence = 0;

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

export function PersonaAvatarSettings({ mode, liveAvatar, onModeChange, onLiveAvatarChange, videoManagementAllowed = true, activeVideoEnabled = false }: Props) {
  const [assets, setAssets] = useState<AvatarAsset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);

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
      setProjectId(result.projectId);
    } catch (cause) {
      if (!mountedRef.current || requestRef.current !== requestId) return;
      setError(errorMessage(cause));
    } finally {
      if (mountedRef.current && requestRef.current === requestId) setLoading(false);
    }
  };

  const selectedAsset = assets?.find(asset => asset.id === liveAvatar?.assetId);
  const selectedMissing = Boolean(liveAvatar && assets && !selectedAsset);
  const selectableAssets = (assets ?? []).filter(asset =>
    asset.status === 'ready' &&
    asset.capabilities.reusable &&
    Boolean(asset.providerAvatarId) &&
    (asset.providerId === 'tavus' || asset.providerId === 'anam')
  );

  const chooseAsset = (assetId: string) => {
    if (!assetId) {
      onLiveAvatarChange(null);
      return;
    }
    const asset = selectableAssets.find(candidate => candidate.id === assetId);
    if (!asset) return;
    onLiveAvatarChange({
      assetId: asset.id,
      providerId: asset.providerId,
      voiceMode: 'roleplayx',
      validationStatus: isLiveValidatedPersonaAvatar(asset) ? 'live_verified' : 'unverified',
      activation: 'draft',
      ...(projectId ? { projectId } : {}),
    });
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
          ['live', 'Live'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={!videoManagementAllowed && (value === 'video' || (value === 'image' && activeVideoEnabled))}
            onClick={() => onModeChange(value)}
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
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">Live 아바타는 이번 단계에서 초안으로만 저장됩니다.</p>
            <p className="mt-1 leading-relaxed">
              학습자 대화의 Live 렌더링은 아직 사용할 수 없습니다. 별도의 관리자 생성·재생 점검과 무관하게 기존 이미지/비디오 표시가 유지되며,
              Live 선택은 대화 동작을 변경하지 않습니다.
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

          {liveAvatar && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">저장된 초안 선택</p>
                  <p className="mt-1 break-all text-slate-600">자산 ID: {liveAvatar.assetId} · 제공자: {liveAvatar.providerId}</p>
                  <p className="mt-1 text-slate-600">
                    Live 검증: {liveAvatar.validationStatus === 'live_verified' ? '검증됨' : '미검증'} · 활성화: 초안
                  </p>
                </div>
                <Button type="button" variant="link" className="h-auto p-0" onClick={() => onLiveAvatarChange(null)}>
                  초안 연결 해제
                </Button>
              </div>
              {selectedMissing && (
                <p className="mt-2 text-amber-800">
                  새로 조회한 목록에서 저장된 자산을 찾지 못했습니다. 삭제·실패·목록 접근 불가일 수 있습니다. 다른 자산으로 자동 변경하지 않았습니다.
                </p>
              )}
              {selectedAsset && (
                <>
                  <p className="mt-2 text-slate-600">
                    현재 자산 상태: {provisioningLabels[selectedAsset.status]} · Live 검증: {isLiveValidatedPersonaAvatar(selectedAsset) ? '검증됨' : '미검증'}
                  </p>
                  {!selectableAssets.some(asset => asset.id === selectedAsset.id) && (
                    <p className="mt-1 text-amber-800">
                      이 자산은 현재 초안 선택 조건을 충족하지 않습니다. 연결은 유지했으며 다른 자산으로 자동 변경하지 않았습니다.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {assets !== null && !loading && !error && (
            assets.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                조회 가능한 프로젝트 소유 커스텀 자산이 없습니다. Studio 개인 자산과 프로젝트 API 키 자산은 자동 공유되지 않습니다.
                기본 Lucy는 커스텀 자산 목록에 포함되지 않으며 별도의 관리자 Live 테스트에서 확인할 수 있습니다.
                준비 완료·재사용 가능 자산만 초안에 선택할 수 있습니다.
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="live-avatar-asset" className="text-sm font-semibold text-slate-700">초안에 연결할 자산</label>
                <select
                  id="live-avatar-asset"
                  value={selectedAsset ? liveAvatar?.assetId ?? '' : ''}
                  onChange={event => chooseAsset(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">자산 선택</option>
                  {assets.map(asset => {
                    const eligible = selectableAssets.some(candidate => candidate.id === asset.id);
                    return (
                      <option key={asset.id} value={asset.id} disabled={!eligible}>
                        {asset.name} · {asset.providerId} · {provisioningLabels[asset.status]}
                        {!eligible ? ' · 선택 불가' : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="text-xs leading-relaxed text-slate-500">
                  선택 조건: 준비 완료, 재사용 가능, 제공자 아바타 ID 보유. 미리보기 URL은 제공되지 않습니다.
                  자산 준비 상태와 Live 검증 상태는 별도로 표시됩니다.
                </p>
              </div>
            )
          )}

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-slate-700">관리자 생성·검증과 학습자 런타임 분리</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">커스텀 생성은 관리자 요청 시에만 실행됩니다.</span>
            </div>
            <p className="mt-2 text-xs text-slate-600">생성·검증은 학습자 대화에 영향을 주지 않으며, 페르소나 연결은 항상 초안으로만 저장됩니다.</p>
          </div>

          <PersonaAvatarCreationPanel onSubmitted={() => void loadAssets()} />
          {assets !== null && liveAvatar?.providerId === 'tavus' && (
              <PersonaAvatarValidationPanel key={liveAvatar.assetId} assetId={liveAvatar.assetId} assetName={selectedAsset?.name ?? '저장된 Tavus 자산'} onReported={() => void loadAssets()} />
            )}

          <div role="note" className="rounded-md border border-slate-200 bg-slate-100 p-3 text-sm text-slate-700">
            학습자 런타임은 비활성화 상태입니다. 관리자 재생 검증에 성공해도 페르소나 연결은 초안으로만 저장되며, 학습자 대화에서 Live 아바타를 제공하지 않습니다.
          </div>
        </div>
      )}
    </section>
  );
}
