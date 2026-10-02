import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';

// Exercise the real service, message handler and reconnector. Only external IO,
// content preparation and accounting are mocked. No database/provider is contacted.
const mocks = vi.hoisted(() => ({
  connect: vi.fn(), scenarios: vi.fn(), usage: vi.fn(),
}));
vi.mock('../../server/storage', () => ({
  storage: {
    getUser: vi.fn(async () => ({ name: 'synthetic' })),
    getSystemSetting: vi.fn(async () => null),
    getPersonaRun: vi.fn(async () => null),
    getChatMessagesByPersonaRun: vi.fn(async () => []),
  },
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
}));
vi.mock('../../server/services/fileManager', () => ({
  fileManager: { getAllScenarios: mocks.scenarios, getPersonaByMBTI: vi.fn(async () => null) },
}));
vi.mock('../../server/services/voice/systemPromptBuilder', () => ({
  buildSystemInstructions: () => 'synthetic instructions',
  buildReconnectSystemInstructions: (s: string) => s,
}));
vi.mock('../../server/services/voice/sessionManager', async (importOriginal) => ({
  ...await importOriginal<object>(),
  startCleanupScheduler: () => null, trackSessionUsage: mocks.usage,
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { live = { connect: mocks.connect }; },
  Modality: { AUDIO: 'AUDIO' }, ActivityHandling: { START_OF_ACTIVITY_INTERRUPTS: 'mock' },
}));
vi.mock('../../server/services/voice/openaiRealtimeAdapter', () => ({
  connectOpenAIRealtime: vi.fn(() => { throw new Error('Real providers are forbidden'); }),
}));

import { RealtimeVoiceService } from '../../server/services/realtimeVoiceService';
import { handleGeminiClose } from '../../server/services/voice/geminiReconnector';
import { handleOpenAIClose } from '../../server/services/voice/openaiReconnector';
import type { RealtimeSession } from '../../server/services/voice/types';
import { retryWithBackoff } from '../../server/utils/concurrency';

const scenario = {
  id: 'synthetic-scenario', title: 'synthetic', difficulty: 4,
  context: {}, personas: [{ id: 'synthetic-persona', name: 'synthetic', gender: 'female' }],
};
const pcm = Buffer.alloc(3200).toString('base64'); // synthetic silence only
const services: RealtimeVoiceService[] = [];
const providerSockets = new Set<object>();
function service() {
  const s = new RealtimeVoiceService();
  services.push(s);
  return s;
}
function client(onMessage: (m: any) => void = () => {}, onClose = () => {}) {
  const ws = { readyState: 1, send: (raw: string) => onMessage(JSON.parse(raw)),
    close: () => { ws.readyState = 3; onClose(); } };
  return ws as any;
}
function create(s: RealtimeVoiceService, id: string, ws = client()) {
  return s.createSession(id, id, scenario.id, 'synthetic-persona', 'synthetic-user', ws);
}
function sessions(s: RealtimeVoiceService): Map<string, RealtimeSession> {
  return (s as any).sessions;
}
function clear(s: RealtimeVoiceService) {
  for (const session of sessions(s).values()) {
    if (session.suppressTimeoutId) clearTimeout(session.suppressTimeoutId);
    if (session.greetingTimeoutId) clearTimeout(session.greetingTimeoutId);
    s.closeSession(session.id);
  }
}
beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'synthetic-not-a-key');
  mocks.scenarios.mockResolvedValue([scenario]);
  mocks.connect.mockImplementation(async ({ callbacks }) => {
    const socket = {
      sendClientContent: () => {},
      sendRealtimeInput: ({ audio }: any) => {
        if (audio) setTimeout(() => callbacks.onmessage({ data: pcm }), 5);
      },
      close: () => providerSockets.delete(socket),
    };
    providerSockets.add(socket);
    callbacks.onopen();
    return socket;
  });
  // Do not retain every PCM/log call in vi.fn histories during a long soak.
  vi.stubGlobal('console', { ...console, log: () => {}, warn: () => {}, error: () => {} });
});
afterEach(() => {
  services.forEach(clear);
  services.length = 0;
  providerSockets.forEach((s: any) => s.close());
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('current lifecycle defects — characterization, not fixes', () => {
  it('admits 101 simultaneous preparations although the process cap is 100', async () => {
    const s = service();
    await Promise.all(Array.from({ length: 101 }, (_, i) => create(s, `burst-${i}`)));
    expect(sessions(s).size).toBe(101);
    await expect(create(s, 'after-burst')).rejects.toThrow('동시 접속자');
  });
  it('registers an orphan after the browser closes during preparation', async () => {
    const s = service();
    let release!: (value: typeof scenario[]) => void;
    mocks.scenarios.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const ws = client();
    const pending = create(s, 'closed-during-create', ws);
    ws.readyState = 3;
    s.closeSession('closed-during-create'); // route close event before Map registration
    release([scenario]);
    await pending;
    expect(sessions(s).has('closed-during-create')).toBe(true);
    expect(providerSockets.size).toBe(1);
  });
  it('allows duplicate logical conversations, and a duplicate ID overwrites a live socket', async () => {
    const s = service();
    await Promise.all([create(s, 'same-id'), create(s, 'same-id')]);
    expect(sessions(s).size).toBe(1);
    expect(providerSockets.size).toBe(2);
    clear(s);
    expect(providerSockets.size).toBe(1); // invisible to Map cleanup
  });
  it('admits two connections for the same logical conversation', async () => {
    const s = service();
    await Promise.all(['tab-one', 'tab-two'].map(id =>
      s.createSession(id, 'same-conversation', scenario.id, 'synthetic-persona', 'synthetic-user', client())));
    expect(sessions(s).size).toBe(2);
    expect(providerSockets.size).toBe(2);
  });
  it.each([handleGeminiClose, handleOpenAIClose])('treats 1011 internal error as terminal (%#)', async (handler) => {
    vi.useFakeTimers();
    const s = service();
    await create(s, 'internal');
    const sess = sessions(s).get('internal')!;
    const connect = vi.fn();
    const send = vi.fn();
    handler({ code: 1011, reason: 'Internal server error' }, sess, sessions(s), send, connect, mocks.usage);
    await vi.advanceTimersByTimeAsync(32_000);
    expect(connect).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(sess, expect.objectContaining({ recoverable: false }));
  });
  it.each(['API key not valid', 'billing disabled'])('does not retry terminal %s', async (reason) => {
    vi.useFakeTimers();
    const s = service();
    await create(s, 'terminal');
    const connect = vi.fn();
    handleGeminiClose({ code: 1008, reason }, sessions(s).get('terminal')!, sessions(s), vi.fn(), connect, mocks.usage);
    await vi.advanceTimersByTimeAsync(32_000);
    expect(connect).not.toHaveBeenCalled();
  });
  it('synchronizes 70 retries at exactly 1000ms without jitter', async () => {
    vi.useFakeTimers();
    const s = service();
    await Promise.all(Array.from({ length: 70 }, (_, i) => create(s, `retry-${i}`)));
    const times: number[] = [];
    const start = Date.now();
    for (const sess of sessions(s).values()) {
      handleGeminiClose({ code: 1006, reason: 'network' }, sess, sessions(s), vi.fn(),
        async () => { times.push(Date.now() - start); }, mocks.usage);
    }
    await vi.advanceTimersByTimeAsync(999);
    expect(times).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(70);
    expect(new Set(times)).toEqual(new Set([1000]));
  });
  it('deletes a reconnecting session if a second close arrives while waiting', async () => {
    vi.useFakeTimers();
    const s = service();
    await create(s, 'double-close');
    const sess = sessions(s).get('double-close')!;
    const connect = vi.fn();
    const args = [sess, sessions(s), vi.fn(), connect, mocks.usage] as const;
    handleGeminiClose({ code: 1006, reason: 'network' }, ...args);
    handleGeminiClose({ code: 1006, reason: 'network' }, ...args);
    await vi.advanceTimersByTimeAsync(1000);
    expect(connect).not.toHaveBeenCalled();
    expect(sessions(s).has(sess.id)).toBe(false);
  });
  it.each([
    [{ status: 429, message: 'rate limit' }, 4],
    [{ status: 503, message: 'unavailable' }, 4],
    [{ status: 429, message: 'RESOURCE_EXHAUSTED' }, 1],
    [{ status: 401, message: 'unauthorized' }, 1],
    [{ status: 429, message: 'insufficient_quota billing' }, 1],
  ])('distinguishes generic HTTP retry policy for %j', async (error, calls) => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(error);
    const outcome = retryWithBackoff(fn).catch(e => e);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual(error);
    expect(fn).toHaveBeenCalledTimes(calls);
  });
});

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { samples: sorted.length, p50: q(.5), p95: q(.95), max: sorted.at(-1) ?? null };
}
describe('offline application-service load (not provider capacity)', () => {
  it('measures staged, burst, reconnect and soak lifetimes with synthetic PCM', async () => {
    const duration = Number(process.env.VOICE_DIAGNOSTIC_DURATION_MS ?? 100);
    const selected = process.env.VOICE_DIAGNOSTIC_SCENARIO ?? 'all';
    const rows: any[] = [];
    const plans = [
      ...[10, 30, 50, 70, 100].map(count => ({ kind: 'steps', count })),
      { kind: 'burst', count: 70 }, { kind: 'reconnect', count: 70 }, { kind: 'soak', count: 70 },
    ].filter(p => selected === 'all' || selected === p.kind);
    for (const plan of plans) {
      const s = service();
      const loop = monitorEventLoopDelay({ resolution: 10 });
      loop.enable();
      const cpuStart = process.cpuUsage();
      const start = performance.now();
      const memoryBefore = process.memoryUsage();
      let pending = 0, peakPending = 0, peakRegistered = 0, peakProvider = 0;
      let sent = 0, received = 0, unexpected = 0;
      let peakRss = memoryBefore.rss, peakHeap = memoryBefore.heapUsed;
      const connectTimes: number[] = [], responseTimes: number[] = [], recoveryTimes: number[] = [];
      const errors: Record<string, number> = {};
      const clients: Array<{ id: string; ws: any; sentAt: number | null; recoveredAt: number | null }> = [];
      const sampler = setInterval(() => {
        const memory = process.memoryUsage();
        peakRss = Math.max(peakRss, memory.rss);
        peakHeap = Math.max(peakHeap, memory.heapUsed);
        peakRegistered = Math.max(peakRegistered, sessions(s).size);
        peakProvider = Math.max(peakProvider, providerSockets.size);
      }, 10);
      try {
        await Promise.all(Array.from({ length: plan.count }, async (_, i) => {
          const item = { id: `${plan.kind}-${i}`, ws: null as any, sentAt: null as number | null, recoveredAt: null as number | null };
          item.ws = client(message => {
            if (message.type === 'audio.delta' && item.sentAt !== null) {
              received++;
              responseTimes.push(performance.now() - item.sentAt);
              item.sentAt = null;
            }
            if (message.type === 'session.reconnected' && item.recoveredAt !== null) {
              recoveryTimes.push(performance.now() - item.recoveredAt);
            }
            if (message.type === 'error') { errors['app-error'] = (errors['app-error'] ?? 0) + 1; }
          }, () => { unexpected++; });
          clients.push(item);
          pending++; peakPending = Math.max(peakPending, pending);
          const at = performance.now();
          try { await create(s, item.id, item.ws); connectTimes.push(performance.now() - at); }
          catch { errors['creation-failed'] = (errors['creation-failed'] ?? 0) + 1; }
          finally { pending--; }
        }));
        peakRegistered = Math.max(peakRegistered, sessions(s).size);
        peakProvider = Math.max(peakProvider, providerSockets.size);
        if (plan.kind === 'reconnect') {
          for (const item of clients) {
            const sess = sessions(s).get(item.id);
            if (!sess) continue;
            // Mock unexpected provider disconnect, then invoke real retry scheduler.
            sess.geminiSession.close();
            item.recoveredAt = performance.now();
            handleGeminiClose({ code: 1006, reason: 'synthetic-network' }, sess, sessions(s),
              (session, message) => session.clientWs.send(JSON.stringify(message)),
              (s as any).connectToGemini.bind(s), mocks.usage);
          }
          await wait(1100);
        }
        const end = performance.now() + duration;
        do {
          for (const item of clients) {
            const sess = sessions(s).get(item.id);
            if (!sess?.geminiSession) continue;
            item.sentAt = performance.now();
            sent++;
            const captureGeneration = sess.currentClientCaptureGeneration ?? 0;
            s.handleClientMessage(item.id, {
              type: 'client.user_speech.started', captureGeneration, speechSeq: sent,
            });
            s.handleClientMessage(item.id, {
              type: 'input_audio_buffer.append', audio: pcm, captureGeneration, speechSeq: sent,
            });
          }
          await wait(25);
        } while (performance.now() < end);
        await wait(25); // drain synthetic responses
        const cpu = process.cpuUsage(cpuStart);
        const measuredDuration = performance.now() - start;
        unexpected = Math.max(unexpected, connectTimes.length - sessions(s).size);
        clear(s);
        rows.push({
          ...plan, provider: 'MOCK — no real provider capacity claim',
          durationMs: performance.now() - start, requestedHoldMs: duration,
          successfulConnections: connectTimes.length, connectionSuccessRate: connectTimes.length / plan.count,
          unexpectedTerminations: unexpected, unexpectedTerminationRate: unexpected / plan.count,
          responseMs: distribution(responseTimes), connectionMs: distribution(connectTimes),
          recoveryMs: distribution(recoveryTimes), peakCreating: peakPending,
          peakRegistered, peakProvider, creatingAfter: pending,
          activeAfter: sessions(s).size, providerAfter: providerSockets.size,
          inputFrames: sent, outputFrames: received, lostFrames: sent - received,
          cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
          cpuOneCorePercent: (cpu.user + cpu.system) / 1000 / measuredDuration * 100,
          injectedProviderDisconnects: plan.kind === 'reconnect' ? plan.count : 0,
          memoryBefore, memoryAfter: process.memoryUsage(), peakRss, peakHeap,
          eventLoopP50Ms: loop.percentile(50) / 1e6, eventLoopP95Ms: loop.percentile(95) / 1e6,
          errors,
        });
        expect(sessions(s).size).toBe(0);
        expect(providerSockets.size).toBe(0);
        expect(sent).toBe(received);
      } finally {
        clearInterval(sampler);
        loop.disable();
        clear(s);
      }
    }
    if (process.env.VOICE_DIAGNOSTIC_WRITE === '1') {
      mkdirSync('docs/diagnostics/results', { recursive: true });
      writeFileSync(`docs/diagnostics/results/mock-load-${selected}.json`, JSON.stringify({
        scope: 'real application-service code; in-process fake sockets/provider/storage; not HTTP/DB/OS/network capacity',
        measuredAt: new Date().toISOString(), rows,
      }, null, 2));
    }
  }, Number(process.env.VOICE_DIAGNOSTIC_DURATION_MS ?? 100) * 8 + 120_000);
});