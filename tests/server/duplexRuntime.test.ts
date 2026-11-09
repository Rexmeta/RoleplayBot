import { describe, expect, it, vi } from 'vitest';
import { BASELINE_DUPLEX_CONFIG, initialCharacterEmotion } from '../../shared/duplexMode';
import type { RealtimeSession } from '../../server/services/voice/types';

vi.mock('../../server/storage/db', () => ({ db: {} }));
vi.mock('../../server/storage', () => ({ storage: {} }));

import { pinDuplexRuntime } from '../../server/services/voice/duplexRuntime';

const enhanced = {
  ...BASELINE_DUPLEX_CONFIG, interaction: true, playbackLifecycle: true,
  characterEmotion: true, expressionSync: true, evaluationSnapshot: true,
};

function fixture(protocol = 'legacy', previous?: any, ledgerStatus = 'active') {
  const run = { id: 'run', status: 'active', transcriptProtocol: protocol, duplexRuntime: previous };
  const update = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const rows = [[run], [{ status: ledgerStatus }]];
  const tx = {
    execute: vi.fn(),
    select: vi.fn(() => ({ from: () => ({ where: async () => rows.shift() }) })),
    update: vi.fn(() => ({ set: update })),
  };
  const connection = { transaction: async (fn: any) => fn(tx) } as any;
  const session = { personaRunId: 'run', personaId: 'persona', activePersonaIndex: 0 } as RealtimeSession;
  const load = vi.fn(async () => [{ key: 'config', value: JSON.stringify(enhanced) }]);
  return { run, update, connection, session, load };
}

describe('duplex runtime transcript compatibility', () => {
  it('connects an unpinned legacy run without migrating it or disabling other duplex features', async () => {
    const f = fixture();
    await pinDuplexRuntime(f.session, f.connection, f.load);
    expect(f.session.duplexRuntime?.config).toEqual({ ...enhanced, evaluationSnapshot: false });
    expect(f.update).toHaveBeenCalledWith({ duplexRuntime: f.session.duplexRuntime });
    expect(f.run.transcriptProtocol).toBe('legacy');
    expect(enhanced.evaluationSnapshot).toBe(true);
  });

  it('enables the evaluation snapshot for a Ledger run', async () => {
    const f = fixture('ledger-v1');
    await pinDuplexRuntime(f.session, f.connection, f.load);
    expect(f.session.duplexRuntime?.config).toEqual(enhanced);
  });

  it('preserves the effective legacy configuration on reconnect despite global changes', async () => {
    const f = fixture();
    await pinDuplexRuntime(f.session, f.connection, f.load);
    const previous = f.session.duplexRuntime!;
    const reconnect = fixture('legacy', previous);
    await pinDuplexRuntime(reconnect.session, reconnect.connection, reconnect.load);
    expect(reconnect.session.duplexRuntime?.config).toEqual(previous.config);
    expect(reconnect.session.duplexRuntime?.epoch).toBe(2);
    expect(reconnect.session.duplexRuntime?.character).toEqual(previous.character);
  });

  it('still rejects an incompatible configuration that was already pinned', async () => {
    const f = fixture('legacy', {
      version: 1, config: enhanced, epoch: 1, personaId: 'persona',
      personaIndex: 0, personaGeneration: 0, character: initialCharacterEmotion(),
    });
    await expect(pinDuplexRuntime(f.session, f.connection, f.load))
      .rejects.toThrow('duplex_evaluation_requires_ledger');
    expect(f.update).not.toHaveBeenCalled();
  });

  it('does not reconnect a closed Ledger or overwrite its runtime', async () => {
    const f = fixture('ledger-v1', undefined, 'closed');
    await expect(pinDuplexRuntime(f.session, f.connection, f.load)).rejects.toThrow('duplex_ledger_closed');
    expect(f.update).not.toHaveBeenCalled();
  });

  it('does not reconnect a finalized run even while its parent is active', async () => {
    const f = fixture('ledger-v1', { finalization: { snapshotId: 'immutable' } });
    await expect(pinDuplexRuntime(f.session, f.connection, f.load)).rejects.toThrow('duplex_run_finalized');
    expect(f.update).not.toHaveBeenCalled();
  });
});
