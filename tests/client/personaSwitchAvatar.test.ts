// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRealtimeVoice } from '../../client/src/hooks/useRealtimeVoice';
import { resolvePersonaAfterSwitch } from '../../client/src/components/chat/resolvePersonaAfterSwitch';
import type { ScenarioPersona } from '../../client/src/lib/scenario-system';

// ---------------------------------------------------------------------------
// Helpers: minimal mocks required by useRealtimeVoice
// ---------------------------------------------------------------------------

function buildMockAudioNode() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function buildMockAudioContext() {
  const analyser = { ...buildMockAudioNode(), fftSize: 256, smoothingTimeConstant: 0.8, getFloatTimeDomainData: vi.fn((a: Float32Array) => a.fill(0)) };
  const gainNode = { ...buildMockAudioNode(), gain: { value: 1.0 } };
  const compressor = { ...buildMockAudioNode(), threshold: { value: -24 }, knee: { value: 30 }, ratio: { value: 12 }, attack: { value: 0.003 }, release: { value: 0.25 } };
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: buildMockAudioNode(),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => gainNode),
    createDynamicsCompressor: vi.fn(() => compressor),
    createBufferSource: vi.fn(() => ({ ...buildMockAudioNode(), buffer: null, playbackRate: { value: 1 }, start: vi.fn(), stop: vi.fn(), onended: null })),
    createBuffer: vi.fn((_c: number, len: number, sr: number) => ({ duration: len / sr, getChannelData: vi.fn(() => new Float32Array(len)), _channelData: new Float32Array(len) })),
    createMediaStreamSource: vi.fn(() => buildMockAudioNode()),
    createScriptProcessor: vi.fn(() => ({ ...buildMockAudioNode(), onaudioprocess: null })),
    resume: vi.fn(async function() {}),
    suspend: vi.fn(async function() {}),
    close: vi.fn(async function() {}),
  };
  return ctx;
}

// AudioContext constructor factory — must use a regular function so vitest
// allows it to be called with `new`.
function makeAudioContextConstructor(ctx: ReturnType<typeof buildMockAudioContext>) {
  return vi.fn(function MockAudioContext() { return ctx; });
}

type MockWebSocketInstance = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  _fireMessage: (payload: object) => void;
  _fireOpen: () => void;
};

let lastWsInstance: MockWebSocketInstance | null = null;

function buildMockWebSocket(): MockWebSocketInstance {
  const inst: MockWebSocketInstance = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    _fireMessage(payload: object) {
      inst.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
    },
    _fireOpen() {
      inst.onopen?.({} as Event);
    },
  };
  return inst;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let mockAudioCtx: ReturnType<typeof buildMockAudioContext>;

beforeEach(() => {
  vi.useFakeTimers();

  mockAudioCtx = buildMockAudioContext();
  (globalThis as any).AudioContext = makeAudioContextConstructor(mockAudioCtx);
  (globalThis as any).webkitAudioContext = makeAudioContextConstructor(mockAudioCtx);
  (window as any).AudioContext = (globalThis as any).AudioContext;
  (window as any).webkitAudioContext = (globalThis as any).webkitAudioContext;

  (globalThis as any).atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
  (globalThis as any).requestAnimationFrame = vi.fn(() => 1);
  (globalThis as any).cancelAnimationFrame = vi.fn();

  lastWsInstance = null;
  const MockWebSocket = vi.fn(function MockWebSocket() {
    const ws = buildMockWebSocket();
    lastWsInstance = ws;
    return ws;
  });
  MockWebSocket.OPEN = 1;
  MockWebSocket.CONNECTING = 0;
  MockWebSocket.CLOSING = 2;
  MockWebSocket.CLOSED = 3;
  (globalThis as any).WebSocket = MockWebSocket;
  (window as any).WebSocket = MockWebSocket;

  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
    if (key === 'authToken') return 'test-token';
    return null;
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});

  Object.defineProperty(window, 'location', {
    value: { protocol: 'http:', host: 'localhost:5000' },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as any).AudioContext;
  delete (globalThis as any).webkitAudioContext;
  delete (globalThis as any).WebSocket;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
});

// ---------------------------------------------------------------------------
// Helper: render useRealtimeVoice and establish a connected WebSocket
// ---------------------------------------------------------------------------

async function connectHook(overrides: {
  onPersonaSwitched?: ReturnType<typeof vi.fn>;
} = {}) {
  const onPersonaSwitched = overrides.onPersonaSwitched ?? vi.fn();

  const { result } = renderHook(() =>
    useRealtimeVoice({
      conversationId: 1,
      scenarioId: 1,
      personaId: 1,
      enabled: false,
      onPersonaSwitched,
    })
  );

  // Start the connection (creates the WebSocket)
  await act(async () => {
    result.current.connect();
    // Advance just enough for the async token fetch path to resolve
    await vi.advanceTimersByTimeAsync(50);
  });

  // Fire onopen (registers handlers & schedules client.ready via setTimeout(100))
  await act(async () => {
    lastWsInstance?._fireOpen();
    // Advance past the 100 ms client.ready delay without triggering the 25 s heartbeat loop
    await vi.advanceTimersByTimeAsync(200);
  });

  return { result, ws: lastWsInstance!, onPersonaSwitched };
}

// ---------------------------------------------------------------------------
// Part 1 — useRealtimeVoice: persona.switched WebSocket event handling
// ---------------------------------------------------------------------------

describe('useRealtimeVoice — persona.switched event', () => {
  it('calls onPersonaSwitched with the newPersonaName from the server message', async () => {
    const { ws, onPersonaSwitched } = await connectHook();

    await act(async () => {
      ws._fireMessage({
        type: 'persona.switched',
        newPersonaName: 'Bob',
        fromPersonaName: 'Alice',
        switched: {
          fromIndex: 0,
          toIndex: 1,
          reason: 'scenario branch',
          transitionLine: 'Let me hand you over to Bob.',
        },
      });
    });

    expect(onPersonaSwitched).toHaveBeenCalledTimes(1);
    expect(onPersonaSwitched).toHaveBeenCalledWith(
      expect.objectContaining({ newPersonaName: 'Bob' })
    );
  });

  it('passes fromIndex and toIndex through to onPersonaSwitched', async () => {
    const { ws, onPersonaSwitched } = await connectHook();

    await act(async () => {
      ws._fireMessage({
        type: 'persona.switched',
        newPersonaName: 'Carol',
        switched: {
          fromIndex: 0,
          toIndex: 2,
          reason: 'escalation',
          transitionLine: 'Handing off to Carol.',
        },
      });
    });

    expect(onPersonaSwitched).toHaveBeenCalledWith(
      expect.objectContaining({ fromIndex: 0, toIndex: 2 })
    );
  });

  it('passes reason and transitionLine through to onPersonaSwitched', async () => {
    const { ws, onPersonaSwitched } = await connectHook();

    await act(async () => {
      ws._fireMessage({
        type: 'persona.switched',
        newPersonaName: 'Dave',
        switched: {
          fromIndex: 0,
          toIndex: 1,
          reason: 'user request',
          transitionLine: 'Dave will take it from here.',
        },
      });
    });

    expect(onPersonaSwitched).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'user request',
        transitionLine: 'Dave will take it from here.',
      })
    );
  });

  it('passes fromPersonaName when present in the server message', async () => {
    const { ws, onPersonaSwitched } = await connectHook();

    await act(async () => {
      ws._fireMessage({
        type: 'persona.switched',
        newPersonaName: 'Eve',
        fromPersonaName: 'Alice',
        switched: { fromIndex: 0, toIndex: 1, reason: 'test', transitionLine: '' },
      });
    });

    expect(onPersonaSwitched).toHaveBeenCalledWith(
      expect.objectContaining({ fromPersonaName: 'Alice' })
    );
  });

  it('does not call onPersonaSwitched when the switched payload is missing', async () => {
    const { ws, onPersonaSwitched } = await connectHook();

    await act(async () => {
      ws._fireMessage({
        type: 'persona.switched',
        newPersonaName: 'Frank',
        // switched field intentionally omitted
      });
    });

    expect(onPersonaSwitched).not.toHaveBeenCalled();
  });

  it('defaults newPersonaName to empty string when absent in the server message', async () => {
    const { ws, onPersonaSwitched } = await connectHook();

    await act(async () => {
      ws._fireMessage({
        type: 'persona.switched',
        // newPersonaName intentionally omitted
        switched: { fromIndex: 0, toIndex: 1, reason: 'test', transitionLine: '' },
      });
    });

    expect(onPersonaSwitched).toHaveBeenCalledWith(
      expect.objectContaining({ newPersonaName: '' })
    );
  });
});

// ---------------------------------------------------------------------------
// Part 2 — resolvePersonaAfterSwitch (production utility used by ChatWindow)
//
// This suite tests the shared utility that determines which persona's avatar
// to display after a speaker switch.  It covers the name-vs-index lookup
// introduced in task-582 and used in ChatWindow.handlePersonaSwitched.
// ---------------------------------------------------------------------------

function makePersona(name: string, id: string): ScenarioPersona {
  return { id, name } as ScenarioPersona;
}

describe('resolvePersonaAfterSwitch — activePersona resolution', () => {
  const personas: ScenarioPersona[] = [
    makePersona('Alice', '1'),
    makePersona('Bob', '2'),
    makePersona('Carol', '3'),
  ];

  it('resolves by name when newPersonaName is present and matches a persona', () => {
    const result = resolvePersonaAfterSwitch(personas, { toIndex: 0, newPersonaName: 'Bob' });
    expect(result?.name).toBe('Bob');
    expect(result?.id).toBe('2');
  });

  it('falls back to index lookup when newPersonaName is absent', () => {
    const result = resolvePersonaAfterSwitch(personas, { toIndex: 2 });
    expect(result?.name).toBe('Carol');
    expect(result?.id).toBe('3');
  });

  it('falls back to index lookup when newPersonaName is an empty string', () => {
    const result = resolvePersonaAfterSwitch(personas, { toIndex: 1, newPersonaName: '' });
    expect(result?.name).toBe('Bob');
    expect(result?.id).toBe('2');
  });

  it('prefers name-based match even when toIndex points to a different persona', () => {
    // toIndex: 0 (Alice) but name says Carol → Carol should win
    const result = resolvePersonaAfterSwitch(personas, { toIndex: 0, newPersonaName: 'Carol' });
    expect(result?.name).toBe('Carol');
    expect(result?.id).toBe('3');
  });

  it('falls back to index when newPersonaName does not match any persona', () => {
    const result = resolvePersonaAfterSwitch(personas, { toIndex: 1, newPersonaName: 'Unknown' });
    expect(result?.name).toBe('Bob');
  });

  it('returns undefined when personas list is undefined and index lookup also fails', () => {
    const result = resolvePersonaAfterSwitch(undefined, { toIndex: 0, newPersonaName: 'Alice' });
    expect(result).toBeUndefined();
  });

  it('returns undefined when toIndex is out of range and newPersonaName is absent', () => {
    const result = resolvePersonaAfterSwitch(personas, { toIndex: 99 });
    expect(result).toBeUndefined();
  });

  it('is stable across rapid successive switches', () => {
    const first = resolvePersonaAfterSwitch(personas, { toIndex: 0, newPersonaName: 'Bob' });
    const second = resolvePersonaAfterSwitch(personas, { toIndex: 1, newPersonaName: 'Alice' });
    const third = resolvePersonaAfterSwitch(personas, { toIndex: 0 });

    expect(first?.name).toBe('Bob');
    expect(second?.name).toBe('Alice');
    expect(third?.name).toBe('Alice'); // index 0 = Alice
  });
});
