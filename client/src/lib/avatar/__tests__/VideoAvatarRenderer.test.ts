/**
 * VideoAvatarRenderer — unit tests
 *
 * Covers:
 *  - _crossFadeTo: only swaps buffers after confirmed 'canplay' ('ready')
 *  - Fallback: error on primary → retry neutral; swap only if neutral is ready
 *  - Timeout on primary → retry neutral; swap only if neutral is ready
 *  - Double failure (primary + neutral) → abort, keep front video visible
 *  - resolveEmotionFolder: optimistic for unprobed, fallback for confirmed-absent
 *  - playState drives _play with correct state/emotion and updates overlayColor
 *  - destroy cleans up video elements and listeners
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toVideoClipSlot } from '../VideoAvatarRenderer';

// ── Minimal HTMLVideoElement stub ─────────────────────────────────────────────

class StubVideo {
  src = '';
  muted = false;
  loop = false;
  playsInline = false;
  preload = '';
  style: Record<string, string | undefined> = {};
  private _listeners: Record<string, Array<(e: Event) => void>> = {};

  setAttribute(_name: string, _value: string) {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  addEventListener(event: string, cb: EventListenerOrEventListenerObject) {
    const fn = typeof cb === 'function' ? cb : cb.handleEvent.bind(cb);
    (this._listeners[event] ??= []).push(fn as (e: Event) => void);
  }
  removeEventListener(event: string, cb: EventListenerOrEventListenerObject) {
    const fn = typeof cb === 'function' ? cb : cb.handleEvent.bind(cb);
    this._listeners[event] = (this._listeners[event] ?? []).filter(l => l !== fn);
  }
  dispatch(event: string) {
    for (const cb of [...(this._listeners[event] ?? [])]) {
      cb({ type: event } as Event);
    }
  }
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
}

class StubDiv {
  style: Record<string, string | undefined> = {};
  children: unknown[] = [];
  parentNode: unknown = null;
  appendChild(child: unknown) { this.children.push(child); }
  removeChild(child: unknown) { this.children = this.children.filter(c => c !== child); }
}

// ── Globals & tracking ────────────────────────────────────────────────────────

let videoInstances: StubVideo[] = [];
let divInstances: StubDiv[] = [];

/** Flush all pending microtasks so async continuations run before we dispatch next event */
const flushMicrotasks = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  videoInstances = [];
  divInstances = [];

  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'video') {
        const v = new StubVideo();
        videoInstances.push(v);
        return v;
      }
      const d = new StubDiv();
      divInstances.push(d);
      return d;
    },
    head: { appendChild: (el: { parentNode: unknown }) => { el.parentNode = { removeChild: () => {} }; } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── Constructor creates: div(containerEl), video(videoA), video(videoB) ────────
// After makeRenderer(): videoInstances[0]=videoA(front), videoInstances[1]=videoB(back)

async function makeRenderer() {
  const { VideoAvatarRenderer } = await import('../VideoAvatarRenderer');
  return new VideoAvatarRenderer();
}

// Helper: call _crossFadeTo on a renderer with a stubbed persona
function crossFadeTo(renderer: Awaited<ReturnType<typeof makeRenderer>>, src: string, fallback?: string) {
  (renderer as unknown as { persona: { id: string } }).persona = { id: 'p1' };
  return (renderer as unknown as {
    _crossFadeTo: (s: string, f?: string) => Promise<void>
  })._crossFadeTo(src, fallback);
}

// ── _crossFadeTo result states ────────────────────────────────────────────────

describe('VideoAvatarRenderer._crossFadeTo', () => {
  it('fades in back buffer when canplay fires (ready path)', async () => {
    const renderer = await makeRenderer();
    // videoInstances: [0]=videoA(front), [1]=videoB(back)
    const back = videoInstances[1];
    expect(back).toBeDefined();

    const playPromise = crossFadeTo(renderer, '/avatars/p1/happy/listening.mp4');

    // canplay fires before any timeout
    back.dispatch('canplay');
    await playPromise;

    expect(back.style.opacity).toBe('1');
  });

  it('retries neutral fallback on primary error and swaps when fallback canplay fires', async () => {
    const renderer = await makeRenderer();
    const back = videoInstances[1];
    expect(back).toBeDefined();

    const playPromise = crossFadeTo(
      renderer,
      '/avatars/p1/happy/listening.mp4',
      '/avatars/p1/neutral/listening.mp4',
    );

    // Primary error → triggers fallback load
    back.dispatch('error');

    // Flush microtasks so _crossFadeTo moves on to the fallback _loadVideo call
    await flushMicrotasks();

    // Fallback fires canplay
    back.dispatch('canplay');
    await playPromise;

    expect(back.style.opacity).toBe('1');
  });

  it('aborts swap when both primary and fallback fail (double error)', async () => {
    const renderer = await makeRenderer();
    const back = videoInstances[1];
    const front = videoInstances[0];
    expect(back).toBeDefined();
    expect(front).toBeDefined();

    // Set front as currently visible
    front.style.opacity = '1';

    const playPromise = crossFadeTo(
      renderer,
      '/avatars/p1/happy/listening.mp4',
      '/avatars/p1/neutral/listening.mp4',
    );

    back.dispatch('error'); // primary fails
    await flushMicrotasks(); // let fallback _loadVideo register listeners
    back.dispatch('error'); // fallback also fails
    await playPromise;

    // Back must NOT have been faded in
    expect(back.style.opacity).not.toBe('1');
    // Front must remain visible
    expect(front.style.opacity).toBe('1');
    expect(renderer.isVideoUnavailable).toBe(true);
  });

  it('aborts swap when primary times out and fallback also times out', async () => {
    vi.useFakeTimers();
    const renderer = await makeRenderer();
    const back = videoInstances[1];
    const front = videoInstances[0];
    expect(back).toBeDefined();

    front.style.opacity = '1';

    const playPromise = crossFadeTo(
      renderer,
      '/avatars/p1/happy/listening.mp4',
      '/avatars/p1/neutral/listening.mp4',
    );

    // Advance past both clip-load timeouts (primary + fallback)
    await vi.advanceTimersByTimeAsync(5001); // primary timeout
    await vi.advanceTimersByTimeAsync(5001); // fallback timeout
    await playPromise;

    expect(back.style.opacity).not.toBe('1');
    expect(front.style.opacity).toBe('1');
  });

  it('swaps after fallback canplay fires following primary timeout', async () => {
    vi.useFakeTimers();
    const renderer = await makeRenderer();
    const back = videoInstances[1];
    expect(back).toBeDefined();

    const playPromise = crossFadeTo(
      renderer,
      '/avatars/p1/happy/listening.mp4',
      '/avatars/p1/neutral/listening.mp4',
    );

    // Primary times out
    await vi.advanceTimersByTimeAsync(5001);

    // Switch to real timers so dispatch + await work normally
    vi.useRealTimers();
    back.dispatch('canplay');
    await playPromise;

    expect(back.style.opacity).toBe('1');
    expect(renderer.isVideoUnavailable).toBe(false);
  });

  it('clears the unavailable state when a later clip becomes playable', async () => {
    const renderer = await makeRenderer();
    const back = videoInstances[1];

    const failedPlayback = crossFadeTo(renderer, '/avatars/p1/neutral/listening.mp4');
    back.dispatch('error');
    await failedPlayback;
    expect(renderer.isVideoUnavailable).toBe(true);

    const recoveredPlayback = crossFadeTo(renderer, '/avatars/p1/neutral/listening.mp4');
    back.dispatch('canplay');
    await recoveredPlayback;
    expect(renderer.isVideoUnavailable).toBe(false);
  });

  it('does not swap when there is no fallback and primary times out', async () => {
    vi.useFakeTimers();
    const renderer = await makeRenderer();
    const back = videoInstances[1];
    const front = videoInstances[0];
    expect(back).toBeDefined();

    front.style.opacity = '1';

    // No fallback provided
    const playPromise = crossFadeTo(renderer, '/avatars/p1/happy/listening.mp4');

    await vi.advanceTimersByTimeAsync(5001);
    await playPromise;

    expect(back.style.opacity).not.toBe('1');
    expect(front.style.opacity).toBe('1');
  });
});

// ── resolveEmotionFolder ──────────────────────────────────────────────────────

describe('VideoAvatarRenderer.resolveEmotionFolder', () => {
  type Renderer = Awaited<ReturnType<typeof makeRenderer>>;
  type PrivateRenderer = Renderer & {
    resolveEmotionFolder: (id: string, e: string, s: string) => string;
    availabilityCache: Record<string, Record<string, Record<string, boolean | undefined>>>;
  };

  it('returns emotion optimistically when avatar is not in cache at all', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    expect(r.resolveEmotionFolder('p1', 'happy', 'listening')).toBe('happy');
  });

  it('returns emotion when probe confirmed it available', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    r.availabilityCache = { p1: { happy: { listening: true } } };
    expect(r.resolveEmotionFolder('p1', 'happy', 'listening')).toBe('happy');
  });

  it('falls back to neutral when emotion confirmed absent and neutral confirmed present', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    r.availabilityCache = {
      p1: {
        happy: { listening: false },
        neutral: { listening: true },
      },
    };
    expect(r.resolveEmotionFolder('p1', 'happy', 'listening')).toBe('neutral');
  });

  it('remains optimistic (returns emotion) when state is unprobed even if neutral is confirmed', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    // happy/listening is missing from cache (never probed), but neutral/listening is confirmed
    r.availabilityCache = {
      p1: {
        happy: {}, // listening not probed for this emotion
        neutral: { listening: true },
      },
    };
    // Must stay optimistic — do not fall back to neutral for unprobed behaviours
    expect(r.resolveEmotionFolder('p1', 'happy', 'listening')).toBe('happy');
  });
});

// ── playState ─────────────────────────────────────────────────────────────────

describe('VideoAvatarRenderer.playState', () => {
  it('calls _play with the correct state and emotion', async () => {
    const renderer = await makeRenderer();
    const playSpy = vi.spyOn(
      renderer as unknown as { _play: (s: string, e: string) => Promise<void> },
      '_play',
    ).mockResolvedValue(undefined);
    (renderer as unknown as { persona: { id: string } }).persona = { id: 'p1' };

    renderer.playState('speaking', 'happy');

    expect(playSpy).toHaveBeenCalledWith('speaking', 'happy');
  });

  it('updates overlayColor when emotion changes', async () => {
    const renderer = await makeRenderer();
    vi.spyOn(
      renderer as unknown as { _play: () => Promise<void> },
      '_play',
    ).mockResolvedValue(undefined);
    (renderer as unknown as { persona: { id: string } }).persona = { id: 'p1' };

    renderer.playState('idle', 'happy');

    expect(renderer.overlayColor).toBe('rgba(251, 191, 36, 0.18)');
  });

  it('does not call _play when state and emotion are both unchanged', async () => {
    const renderer = await makeRenderer();
    const playSpy = vi.spyOn(
      renderer as unknown as { _play: () => Promise<void> },
      '_play',
    ).mockResolvedValue(undefined);
    (renderer as unknown as { persona: { id: string } }).persona = { id: 'p1' };
    (renderer as unknown as { currentState: string; currentEmotionEn: string }).currentState = 'idle';
    (renderer as unknown as { currentState: string; currentEmotionEn: string }).currentEmotionEn = 'neutral';

    renderer.playState('idle', 'neutral');

    expect(playSpy).not.toHaveBeenCalled();
  });
});

describe('toVideoClipSlot', () => {
  it('maps all six avatar clip slots from behavior and emotion', () => {
    expect(toVideoClipSlot('listening', 'happy')).toBe('listening_positive');
    expect(toVideoClipSlot('listening', 'neutral')).toBe('listening_neutral');
    expect(toVideoClipSlot('listening', 'sad')).toBe('listening_negative');
    expect(toVideoClipSlot('speaking', 'happy')).toBe('speaking_positive');
    expect(toVideoClipSlot('speaking', 'neutral')).toBe('speaking_neutral');
    expect(toVideoClipSlot('speaking', 'sad')).toBe('speaking_negative');
  });

  it('maps transitional and inactive states to their underlying clip behavior', () => {
    expect(toVideoClipSlot('idle', 'neutral')).toBe('listening_neutral');
    expect(toVideoClipSlot('thinking', 'curious')).toBe('listening_positive');
    expect(toVideoClipSlot('listening_nod', 'concerned')).toBe('listening_negative');
    expect(toVideoClipSlot('speaking_pause', 'neutral')).toBe('speaking_neutral');
  });
});

// ── displayImageUrl normalization ─────────────────────────────────────────────

describe('VideoAvatarRenderer.initialize displayImageUrl', () => {
  it('normalizes a storage-key persona.image to a browser-ready URL', async () => {
    const renderer = await makeRenderer();
    // Stub preloadAssets and _play so initialize doesn't try to load videos
    vi.spyOn(renderer, 'preloadAssets').mockResolvedValue(undefined);
    vi.spyOn(
      renderer as unknown as { _play: () => Promise<void> },
      '_play',
    ).mockResolvedValue(undefined);

    renderer.initialize(
      { id: 'p1', name: 'Test', image: 'personas/infj/male/neutral.webp' },
      'conv1',
    );

    // toMediaUrl should convert "personas/..." to "/objects?key=personas/..."
    expect(renderer.displayImageUrl).toMatch(/^\/objects\?key=/);
    expect(renderer.displayImageUrl).toContain('personas');
  });

  it('keeps an already-absolute HTTPS URL unchanged', async () => {
    const renderer = await makeRenderer();
    vi.spyOn(renderer, 'preloadAssets').mockResolvedValue(undefined);
    vi.spyOn(
      renderer as unknown as { _play: () => Promise<void> },
      '_play',
    ).mockResolvedValue(undefined);

    const url = 'https://example.com/avatar.jpg';
    renderer.initialize({ id: 'p1', name: 'Test', image: url }, 'conv1');

    expect(renderer.displayImageUrl).toBe(url);
  });

  it('sets displayImageUrl to empty string when persona.image is absent', async () => {
    const renderer = await makeRenderer();
    vi.spyOn(renderer, 'preloadAssets').mockResolvedValue(undefined);
    vi.spyOn(
      renderer as unknown as { _play: () => Promise<void> },
      '_play',
    ).mockResolvedValue(undefined);

    renderer.initialize({ id: 'p1', name: 'Test' }, 'conv1');

    expect(renderer.displayImageUrl).toBe('');
  });
});

// ── _startPingPong / _stopPingPong ────────────────────────────────────────────

describe('VideoAvatarRenderer ping-pong loop', () => {
  type PrivateRenderer = Awaited<ReturnType<typeof makeRenderer>> & {
    _startPingPong: (v: unknown) => void;
    _stopPingPong: (v: unknown) => void;
    pingPongState: Map<unknown, {
      direction: 'forward' | 'reverse';
      rafId: number | null;
      lastTimestamp: number;
      endedListener: (() => void) | null;
      isPaused: boolean;
      tick: ((now: number) => void) | null;
    }>;
  };

  // Per-test RAF tracking
  let rafCallbacks: Map<number, (now: number) => void>;
  let nextRafId: number;
  let cancelledIds: Set<number>;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 0;
    cancelledIds = new Set();

    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      const id = ++nextRafId;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelledIds.add(id);
      rafCallbacks.delete(id);
    });
  });

  /** Run every currently-pending RAF callback with the given timestamp. */
  function flushRaf(now: number) {
    const entries = [...rafCallbacks.entries()];
    for (const [id, cb] of entries) {
      rafCallbacks.delete(id);
      cb(now);
    }
  }

  it('ended event triggers the reverse RAF loop and decrements currentTime', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 5.0;

    r._startPingPong(stub);

    // Fire ended → starts reverse pass
    stub.dispatch('ended');

    // Tick 1: reverse starts immediately, moving by one 16 ms frame.
    flushRaf(1000);
    expect(stub.currentTime).toBeCloseTo(4.984, 5);

    // Tick 2: 100 ms elapsed, but PING_PONG_MAX_DELTA_MS=50 clamps to 0.05 s.
    flushRaf(1100);
    expect(stub.currentTime).toBeCloseTo(4.934, 5);
  });

  it('forward play resumes when reverse reaches currentTime 0', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 0.05; // close to start so one big tick crosses zero

    const playSpy = vi.spyOn(stub as any, 'play').mockResolvedValue(undefined);

    r._startPingPong(stub);
    stub.dispatch('ended');

    // The immediate first reverse frame still leaves time before the boundary.
    flushRaf(1000);

    // Tick 2: the clamped step crosses the start boundary.
    flushRaf(1200);

    expect(stub.currentTime).toBe(0);
    expect(playSpy).toHaveBeenCalled();
  });

  it('after forward resumes at 0, a new ended listener is registered for the next cycle', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 0.05;

    vi.spyOn(stub as any, 'play').mockResolvedValue(undefined);

    r._startPingPong(stub);
    stub.dispatch('ended');

    flushRaf(1000); // immediate reverse frame
    flushRaf(1200); // boundary → forward resumes

    // The state should be back to 'forward'
    const st = r.pingPongState.get(stub);
    expect(st?.direction).toBe('forward');
    // A new endedListener must have been registered for the next cycle
    expect(st?.endedListener).not.toBeNull();
  });

  it('_stopPingPong cancels the active RAF and removes the ended listener', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 5.0;

    r._startPingPong(stub);

    // Fire ended → RAF loop starts
    stub.dispatch('ended');

    // First tick moves immediately and schedules the next frame.
    flushRaf(1000);

    // Capture which RAF ID is now pending
    const pendingIds = [...rafCallbacks.keys()];
    expect(pendingIds.length).toBeGreaterThan(0);

    r._stopPingPong(stub);

    // All pending RAF frames must have been cancelled
    for (const id of pendingIds) {
      expect(cancelledIds.has(id)).toBe(true);
    }
    // State entry must be removed
    expect(r.pingPongState.has(stub)).toBe(false);
    // ended listener must have been removed — dispatching again must not re-trigger reverse
    const prevCurrentTime = stub.currentTime;
    stub.dispatch('ended');
    flushRaf(2000);
    flushRaf(2100);
    // currentTime should be unchanged (no active reverse loop)
    expect(stub.currentTime).toBe(prevCurrentTime);
  });

  it('_stopPingPong removes the ended listener before reverse has started', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 5.0;

    r._startPingPong(stub);
    // Stop immediately (before ended fires)
    r._stopPingPong(stub);

    // Firing ended now should not schedule any RAF
    stub.dispatch('ended');
    expect(rafCallbacks.size).toBe(0);
  });

  it('calling _startPingPong twice does not create duplicate ended listeners', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo;

    r._startPingPong(stub);
    r._startPingPong(stub); // second call must clean up the first

    const endedListeners = (stub as any)._listeners['ended'] ?? [];
    expect(endedListeners.length).toBe(1);
  });

  it('calling _startPingPong twice does not create a duplicate RAF loop', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 5.0;

    r._startPingPong(stub);
    r._startPingPong(stub); // replaces first binding

    // Fire ended once
    stub.dispatch('ended');
    flushRaf(1000); // immediate reverse frame
    flushRaf(1100); // clamped reverse frame

    // Only one loop runs: 16 ms + the 50 ms-clamped step.
    expect(stub.currentTime).toBeCloseTo(4.934, 5);
  });

  // ── New edge-case tests ────────────────────────────────────────────────────

  it('pause() suspends the reverse RAF loop and resume() restarts it', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    // videoInstances[0] is videoA, which is the initial frontVideo (frontIsA = true)
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 5.0;

    r._startPingPong(stub);
    stub.dispatch('ended'); // start reverse pass

    // Reverse begins immediately without an empty RAF frame.
    flushRaf(1000);

    // Pause via the public API (operates on frontVideo = videoInstances[0])
    (r as unknown as { pause: () => void }).pause();

    const ppState = r.pingPongState.get(stub);
    expect(ppState?.isPaused).toBe(true);
    // RAF must have been cancelled — no pending callbacks
    expect(rafCallbacks.size).toBe(0);

    // currentTime must be unchanged while paused
    const timeAtPause = stub.currentTime;
    flushRaf(1100); // flushing nothing — should be a no-op
    expect(stub.currentTime).toBe(timeAtPause);

    // Resume: should reschedule the RAF
    (r as unknown as { resume: () => void }).resume();
    expect(ppState?.isPaused).toBe(false);
    expect(rafCallbacks.size).toBe(1);

    // The resumed loop also moves on its first frame.
    flushRaf(1300);
    flushRaf(1400); // 100 ms elapsed → clamped to 50 ms = 0.05 s decrement
    expect(stub.currentTime).toBeCloseTo(timeAtPause - 0.066, 5);
  });

  it('handles ended firing when currentTime is already 0 — calls play() without going negative', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 0; // already at start when ended fires

    const playSpy = vi.spyOn(stub as any, 'play').mockResolvedValue(undefined);

    r._startPingPong(stub);
    stub.dispatch('ended');

    // The first immediate reverse frame reaches the boundary.
    flushRaf(1000);

    // currentTime must not be negative
    expect(stub.currentTime).toBe(0);
    // play() must have been called to restart forward pass
    expect(playSpy).toHaveBeenCalled();
    // direction must be back to forward
    const st = r.pingPongState.get(stub);
    expect(st?.direction).toBe('forward');
  });

  it('rapid alternating _startPingPong / _stopPingPong calls do not crash or leak state', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    // Rapid interleaving — must not throw
    expect(() => {
      for (let i = 0; i < 10; i++) {
        r._startPingPong(stub);
        r._stopPingPong(stub);
      }
    }).not.toThrow();

    // After all that, no ping-pong state should remain
    expect(r.pingPongState.has(stub)).toBe(false);

    // No RAF callbacks should be pending
    expect(rafCallbacks.size).toBe(0);

    // Firing ended now must have no effect (all listeners cleaned up)
    stub.dispatch('ended');
    expect(rafCallbacks.size).toBe(0);
  });

  // ── Tick-level delta-clamp tests ────────────────────────────────────────────

  it('normal delta (< 50 ms): currentTime decrements by the exact elapsed amount', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    r._startPingPong(stub);
    stub.dispatch('ended');

    // Tick 1: the first reverse frame uses a 16 ms delta.
    flushRaf(2000);
    expect(stub.currentTime).toBeCloseTo(2.984, 5);

    // Tick 2: 30 ms elapsed — well under the 50 ms cap, no clamp applied.
    flushRaf(2030);
    // Expected: 3.0 - 0.016 - 0.030 = 2.954
    expect(stub.currentTime).toBeCloseTo(2.954, 5);
  });

  it('large delta (> 50 ms): clamp caps the step at 50 ms worth of time', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 10.0;

    r._startPingPong(stub);
    stub.dispatch('ended');

    // Tick 1: immediate 16 ms reverse movement.
    flushRaf(5000);
    expect(stub.currentTime).toBeCloseTo(9.984, 5);

    // Tick 2: 300 ms of elapsed wall-clock time (tab backgrounded, etc.)
    // Clamp fires: max step is 50 ms → 0.050 s decrement
    flushRaf(5300);
    expect(stub.currentTime).toBeCloseTo(9.934, 5);
  });

  it('delta that overshoots currentTime=0: clamps currentTime to 0 and flips direction to forward', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    // Place currentTime very close to the start so even a tiny step crosses zero
    stub.currentTime = 0.01;

    const playSpy = vi.spyOn(stub as any, 'play').mockResolvedValue(undefined);

    r._startPingPong(stub);
    stub.dispatch('ended');

    // Tick 1: immediate 16 ms reverse movement overshoots the boundary.
    flushRaf(3000);

    // currentTime must be clamped to exactly 0, not negative
    expect(stub.currentTime).toBe(0);

    // play() must have been called to restart forward playback
    expect(playSpy).toHaveBeenCalled();

    // direction must have flipped back to forward
    const st = r.pingPongState.get(stub);
    expect(st?.direction).toBe('forward');

    // No RAF frame should be pending (reverse loop exited)
    expect(rafCallbacks.size).toBe(0);
  });

  it('returns to native forward playback and immediately reverses again on consecutive cycles', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    const playSpy = vi.spyOn(stub as any, 'play').mockResolvedValue(undefined);

    r._startPingPong(stub);

    // Cycle one: end → reverse → start → forward.
    stub.currentTime = 0.01;
    stub.dispatch('ended');
    flushRaf(1000);
    expect(stub.currentTime).toBe(0);
    expect(r.pingPongState.get(stub)?.direction).toBe('forward');

    // Cycle two: native playback reaches the end again. The very first reverse
    // frame must move right away instead of visibly holding on the end frame.
    stub.currentTime = 5;
    stub.dispatch('ended');
    flushRaf(2000);
    expect(stub.currentTime).toBeCloseTo(4.984, 5);
    expect(r.pingPongState.get(stub)?.direction).toBe('reverse');

    // Finish the second reverse pass and confirm native forward playback resumes.
    stub.currentTime = 0.01;
    flushRaf(2016);
    expect(stub.currentTime).toBe(0);
    expect(r.pingPongState.get(stub)?.direction).toBe('forward');
    expect(playSpy).toHaveBeenCalledTimes(2);
  });
});

// ── pause / resume during reverse pass ───────────────────────────────────────

describe('VideoAvatarRenderer pause/resume', () => {
  type PrivateRenderer = Awaited<ReturnType<typeof makeRenderer>> & {
    _startPingPong: (v: unknown) => void;
    pingPongState: Map<unknown, {
      direction: 'forward' | 'reverse';
      rafId: number | null;
      lastTimestamp: number;
      endedListener: (() => void) | null;
      isPaused: boolean;
      tick: ((now: number) => void) | null;
    }>;
  };

  let rafCallbacks: Map<number, (now: number) => void>;
  let nextRafId: number;
  let cancelledIds: Set<number>;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 0;
    cancelledIds = new Set();

    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      const id = ++nextRafId;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelledIds.add(id);
      rafCallbacks.delete(id);
    });
  });

  function flushRaf(now: number) {
    const entries = [...rafCallbacks.entries()];
    for (const [id, cb] of entries) {
      rafCallbacks.delete(id);
      cb(now);
    }
  }

  it('pause() while direction is reverse sets isPaused, cancels the RAF, and resets lastTimestamp', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    // videoInstances[0] is videoA, which is the initial frontVideo
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    r._startPingPong(stub);
    stub.dispatch('ended'); // triggers startReverse → schedules first RAF

    // Immediate reverse tick schedules the next RAF.
    flushRaf(1000);

    const st = r.pingPongState.get(stub)!;
    expect(st.direction).toBe('reverse');
    const rafIdBeforePause = st.rafId;
    expect(rafIdBeforePause).not.toBeNull();

    r.pause();

    expect(st.isPaused).toBe(true);
    expect(st.rafId).toBeNull();
    expect(st.lastTimestamp).toBe(0); // reset so resume won't produce a huge delta
    expect(cancelledIds.has(rafIdBeforePause!)).toBe(true);
  });

  it('resume() while isPaused in reverse restarts the RAF with a zeroed lastTimestamp (no jump)', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    r._startPingPong(stub);
    stub.dispatch('ended');
    flushRaf(1000); // immediate reverse frame

    r.pause();

    const st = r.pingPongState.get(stub)!;
    expect(st.isPaused).toBe(true);

    r.resume();

    expect(st.isPaused).toBe(false);
    expect(st.lastTimestamp).toBe(0); // still zero — will be set on the first tick
    expect(st.rafId).not.toBeNull(); // RAF was rescheduled

    // The first tick after resume makes only a single 16 ms step, even after a
    // long pause, so the clip neither freezes nor makes a large jump.
    flushRaf(99999);
    expect(stub.currentTime).toBeCloseTo(2.968, 5);
  });

  it('pause() while direction is forward calls native video pause and does not cancel any RAF', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    // _startPingPong in forward mode: attaches ended listener, no RAF running yet
    r._startPingPong(stub);
    const st = r.pingPongState.get(stub)!;
    expect(st.direction).toBe('forward');

    const pauseSpy = vi.spyOn(stub as any, 'pause');

    r.pause();

    // Native pause must have been invoked
    expect(pauseSpy).toHaveBeenCalled();
    // No RAF should have been scheduled or cancelled — we're still in forward mode
    expect(cancelledIds.size).toBe(0);
    // isPaused flag must remain false (the special reverse-pause branch was not taken)
    expect(st.isPaused).toBe(false);
  });

  // ── New edge-case tests ────────────────────────────────────────────────────

  it('pause() suspends the reverse RAF loop and resume() restarts it', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    // videoInstances[0] is videoA, which is the initial frontVideo (frontIsA = true)
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 5.0;

    r._startPingPong(stub);
    stub.dispatch('ended'); // start reverse pass

    // Init tick — just records timestamp
    flushRaf(1000);

    // Pause via the public API (operates on frontVideo = videoInstances[0])
    (r as unknown as { pause: () => void }).pause();

    const ppState = r.pingPongState.get(stub);
    expect(ppState?.isPaused).toBe(true);
    // RAF must have been cancelled — no pending callbacks
    expect(rafCallbacks.size).toBe(0);

    // currentTime must be unchanged while paused
    const timeAtPause = stub.currentTime;
    flushRaf(1100); // flushing nothing — should be a no-op
    expect(stub.currentTime).toBe(timeAtPause);

    // Resume: should reschedule the RAF
    (r as unknown as { resume: () => void }).resume();
    expect(ppState?.isPaused).toBe(false);
    expect(rafCallbacks.size).toBe(1);

    // Flush the rescheduled ticks.
    // Resume first-tick: seeds 16 ms before `now`, applies 0.016 s decrement.
    flushRaf(1300); // first post-resume tick — seeds timestamp and applies 16 ms
    // Second tick: 100 ms elapsed → clamped to 50 ms → 0.050 s decrement
    flushRaf(1400); // 100 ms elapsed → clamped to 50 ms = 0.05 s decrement
    // Total decrement from timeAtPause: 0.016 (first tick) + 0.050 (second tick)
    expect(stub.currentTime).toBeCloseTo(timeAtPause - 0.016 - 0.05, 5);
  });

  it('handles ended firing when currentTime is already 0 — calls play() without going negative', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 0; // already at start when ended fires

    const playSpy = vi.spyOn(stub as any, 'play').mockResolvedValue(undefined);

    r._startPingPong(stub);
    stub.dispatch('ended');

    // Init tick
    flushRaf(1000);
    // Second tick: next = 0 − deltaSeconds ≤ 0 → immediate boundary
    flushRaf(1100);

    // currentTime must not be negative
    expect(stub.currentTime).toBe(0);
    // play() must have been called to restart forward pass
    expect(playSpy).toHaveBeenCalled();
    // direction must be back to forward
    const st = r.pingPongState.get(stub);
    expect(st?.direction).toBe('forward');
  });

  it('rapid alternating _startPingPong / _stopPingPong calls do not crash or leak state', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    // Rapid interleaving — must not throw
    expect(() => {
      for (let i = 0; i < 10; i++) {
        r._startPingPong(stub);
        r._stopPingPong(stub);
      }
    }).not.toThrow();

    // After all that, no ping-pong state should remain
    expect(r.pingPongState.has(stub)).toBe(false);

    // No RAF callbacks should be pending
    expect(rafCallbacks.size).toBe(0);

    // Firing ended now must have no effect (all listeners cleaned up)
    stub.dispatch('ended');
    expect(rafCallbacks.size).toBe(0);
  });

  // ── Tick-level delta-clamp tests ────────────────────────────────────────────

  it('normal delta (< 50 ms): currentTime decrements by the exact elapsed amount', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    r._startPingPong(stub);
    stub.dispatch('ended');

    // Tick 1: first frame seeds 16 ms before `now` so the renderer immediately
    // applies one frame's worth of movement (3.0 - 0.016 = 2.984)
    flushRaf(2000);
    expect(stub.currentTime).toBeCloseTo(2.984, 5);

    // Tick 2: 30 ms elapsed — well under the 50 ms cap, no clamp applied
    flushRaf(2030);
    // Expected: 2.984 - 0.030 = 2.954
    expect(stub.currentTime).toBeCloseTo(2.954, 5);
  });

  it('large delta (> 50 ms): clamp caps the step at 50 ms worth of time', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 10.0;

    r._startPingPong(stub);
    stub.dispatch('ended');

    // Tick 1: first frame seeds 16 ms before `now` → 10.0 - 0.016 = 9.984
    flushRaf(5000);
    expect(stub.currentTime).toBeCloseTo(9.984, 5);

    // Tick 2: 300 ms of elapsed wall-clock time (tab backgrounded, etc.)
    // Clamp fires: max step is 50 ms → 0.050 s decrement
    flushRaf(5300);
    // Expected: 9.984 - 0.050 = 9.934
    expect(stub.currentTime).toBeCloseTo(9.934, 5);
  });

  it('delta that overshoots currentTime=0: clamps currentTime to 0 and flips direction to forward', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    // Place currentTime very close to the start so even a tiny step crosses zero
    stub.currentTime = 0.01;

    const playSpy = vi.spyOn(stub as any, 'play').mockResolvedValue(undefined);

    r._startPingPong(stub);
    stub.dispatch('ended');

    // Tick 1: first frame seeds 16 ms before `now` → 0.01 - 0.016 = -0.006 → overshoots
    // currentTime is clamped to 0 and direction flips to forward immediately
    flushRaf(3000);

    // currentTime must be clamped to exactly 0, not negative
    expect(stub.currentTime).toBe(0);

    // play() must have been called to restart forward playback
    expect(playSpy).toHaveBeenCalled();

    // direction must have flipped back to forward
    const st = r.pingPongState.get(stub);
    expect(st?.direction).toBe('forward');

    // No RAF frame should be pending (reverse loop exited)
    expect(rafCallbacks.size).toBe(0);
  });
});

// ── pause / resume during reverse pass ───────────────────────────────────────

describe('VideoAvatarRenderer pause/resume', () => {
  type PrivateRenderer = Awaited<ReturnType<typeof makeRenderer>> & {
    _startPingPong: (v: unknown) => void;
    pingPongState: Map<unknown, {
      direction: 'forward' | 'reverse';
      rafId: number | null;
      lastTimestamp: number;
      endedListener: (() => void) | null;
      isPaused: boolean;
      tick: ((now: number) => void) | null;
    }>;
  };

  let rafCallbacks: Map<number, (now: number) => void>;
  let nextRafId: number;
  let cancelledIds: Set<number>;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 0;
    cancelledIds = new Set();

    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      const id = ++nextRafId;
      rafCallbacks.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelledIds.add(id);
      rafCallbacks.delete(id);
    });
  });

  function flushRaf(now: number) {
    const entries = [...rafCallbacks.entries()];
    for (const [id, cb] of entries) {
      rafCallbacks.delete(id);
      cb(now);
    }
  }

  it('pause() while direction is reverse sets isPaused, cancels the RAF, and resets lastTimestamp', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    // videoInstances[0] is videoA, which is the initial frontVideo
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    r._startPingPong(stub);
    stub.dispatch('ended'); // triggers startReverse → schedules first RAF

    // Init tick: records lastTimestamp, schedules next RAF
    flushRaf(1000);

    const st = r.pingPongState.get(stub)!;
    expect(st.direction).toBe('reverse');
    const rafIdBeforePause = st.rafId;
    expect(rafIdBeforePause).not.toBeNull();

    r.pause();

    expect(st.isPaused).toBe(true);
    expect(st.rafId).toBeNull();
    expect(st.lastTimestamp).toBe(0); // reset so resume won't produce a huge delta
    expect(cancelledIds.has(rafIdBeforePause!)).toBe(true);
  });

  it('resume() while isPaused in reverse restarts the RAF with a zeroed lastTimestamp (no jump)', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    r._startPingPong(stub);
    stub.dispatch('ended');
    flushRaf(1000); // init tick

    r.pause();

    const st = r.pingPongState.get(stub)!;
    expect(st.isPaused).toBe(true);

    r.resume();

    expect(st.isPaused).toBe(false);
    expect(st.lastTimestamp).toBe(0); // still zero — will be set on the first tick
    expect(st.rafId).not.toBeNull(); // RAF was rescheduled

    // First tick after resume seeds 16 ms before `now` and immediately applies one
    // frame's worth of movement (same as the initial reverse tick).
    // After the init tick at flushRaf(1000): currentTime = 3.0 - 0.016 = 2.984
    // After this resume tick: 2.984 - 0.016 = 2.968
    // The 16 ms seed means even a huge elapsed value doesn't produce a big jump.
    flushRaf(99999);
    expect(stub.currentTime).toBeCloseTo(2.968, 5);
  });

  it('pause() while direction is forward calls native video pause and does not cancel any RAF', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    const stub = videoInstances[0] as StubVideo & { currentTime: number };
    stub.currentTime = 3.0;

    // _startPingPong in forward mode: attaches ended listener, no RAF running yet
    r._startPingPong(stub);
    const st = r.pingPongState.get(stub)!;
    expect(st.direction).toBe('forward');

    const pauseSpy = vi.spyOn(stub as any, 'pause');

    r.pause();

    // Native pause must have been invoked
    expect(pauseSpy).toHaveBeenCalled();
    // No RAF should have been scheduled or cancelled — we're still in forward mode
    expect(cancelledIds.size).toBe(0);
    // isPaused flag must remain false (the special reverse-pause branch was not taken)
    expect(st.isPaused).toBe(false);
  });
});

// ── destroy ───────────────────────────────────────────────────────────────────

describe('VideoAvatarRenderer.destroy', () => {
  it('pauses both video elements and clears their src', async () => {
    const renderer = await makeRenderer();
    // videoInstances[0]=videoA, videoInstances[1]=videoB
    const vA = videoInstances[0];
    const vB = videoInstances[1];
    expect(vA).toBeDefined();
    expect(vB).toBeDefined();

    const pauseA = vi.spyOn(vA, 'pause');
    const pauseB = vi.spyOn(vB, 'pause');

    renderer.destroy();

    expect(pauseA).toHaveBeenCalled();
    expect(pauseB).toHaveBeenCalled();
    expect(vA.src).toBe('');
    expect(vB.src).toBe('');
  });

  it('clears listeners so no callbacks fire after destroy', async () => {
    const renderer = await makeRenderer();
    const cb = vi.fn();
    renderer.subscribe(cb);
    renderer.destroy();

    (renderer as unknown as { emit: () => void }).emit();
    expect(cb).not.toHaveBeenCalled();
  });
});
