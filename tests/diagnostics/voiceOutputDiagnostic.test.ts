import { describe, it, expect, vi } from 'vitest';
import { VoiceOutputTrace, OUTPUT_TRACE_LIMIT } from '../../shared/voiceOutputDiagnostic';
import { enableOutputDiagnostic, observeOutputFrame } from '../../server/services/voice/outputDiagnostic';
import type { RealtimeSession } from '../../server/services/voice/types';

describe('bounded numeric-only output observer', () => {
  it('allowlists fields, rejects strings/nonfinite values and gives immutable snapshots', () => {
    const trace = new VoiceOutputTrace(() => 1);
    trace.record('receive', { durationMs: 200, source: 'private label', delta: 'audio-secret',
      text: 'private transcript', token: 'token-secret', turnSeq: Infinity } as any);
    expect(trace.snapshot().rows).toEqual([{ event: 'receive', atMs: 0, durationMs: 200 }]);
    trace.snapshot().rows[0].durationMs = 999;
    expect(trace.snapshot().rows[0].durationMs).toBe(200);
    trace.record('untrusted-event' as any);
    expect(trace.snapshot().rows).toHaveLength(1);
    expect(() => trace.record('receive', null as any)).not.toThrow();
  });
  it('caps memory and expires without timers', () => {
    let now = 0;
    const trace = new VoiceOutputTrace(() => now);
    for (let i = 0; i < 10_000; i++) trace.record('receive');
    expect(trace.snapshot().rows).toHaveLength(OUTPUT_TRACE_LIMIT);
    const expired = new VoiceOutputTrace(() => now);
    now = 60_000;
    expired.record('receive');
    expect(expired.active).toBe(false);
    expect(expired.snapshot().rows).toHaveLength(0);
    const stopped = new VoiceOutputTrace();
    stopped.stop();
    stopped.record('receive');
    expect(stopped.snapshot().rows).toHaveLength(0);
  });
  it('default-disabled path returns the original sender with no extra frames', () => {
    const send = vi.fn();
    const session = {} as RealtimeSession;
    expect(observeOutputFrame(session, { data: 'private-audio' }, send)).toBe(send);
    expect(send).not.toHaveBeenCalled();
  });
  it('opt-in is nonrenewable, has a 200-wire-event budget and retains no content', () => {
    const send = vi.fn();
    const session = { turnSeq: 18, cancelledTurnSeq: 17, providerConnectionGeneration: 2 } as RealtimeSession;
    enableOutputDiagnostic(session);
    const original = session.outputDiagnostic;
    enableOutputDiagnostic(session);
    expect(session.outputDiagnostic).toBe(original);
    for (let i = 0; i < 500; i++) {
      const observed = observeOutputFrame(session, { data: 'private-audio' }, send);
      observed(session, { type: 'audio.delta', delta: 'private-audio', turnSeq: 18 });
    }
    expect(session.outputDiagnostic?.emitted).toBe(200);
    const diagnosticFrames = send.mock.calls.map(call => call[1]).filter(row => row.type === 'output.diagnostic');
    expect(diagnosticFrames).toHaveLength(100);
    expect(JSON.stringify(diagnosticFrames)).not.toContain('private-audio');
    expect(send.mock.calls.filter(call => call[1].type === 'audio.delta')).toHaveLength(500);
    session.outputDiagnostic!.startedAt = Date.now() - 60_000;
    expect(observeOutputFrame(session, { data: 'private-audio' }, send)).toBe(send);
  });
  it('metadata observer failure does not prevent the original audio send', () => {
    const session = {} as RealtimeSession;
    enableOutputDiagnostic(session);
    const send = vi.fn((_s, message) => {
      if (message.type === 'output.diagnostic') throw new Error('synthetic diagnostic failure');
    });
    const observed = observeOutputFrame(session, { data: 'synthetic' }, send);
    observed(session, { type: 'audio.delta', delta: 'synthetic' });
    expect(send).toHaveBeenCalledWith(session, expect.objectContaining({ type: 'audio.delta' }));
  });
});