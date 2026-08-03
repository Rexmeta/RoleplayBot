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

    const playPromise = crossFadeTo(renderer, '/avatars/p1/happy/idle.mp4');

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
      '/avatars/p1/happy/idle.mp4',
      '/avatars/p1/neutral/idle.mp4',
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
      '/avatars/p1/happy/idle.mp4',
      '/avatars/p1/neutral/idle.mp4',
    );

    back.dispatch('error'); // primary fails
    await flushMicrotasks(); // let fallback _loadVideo register listeners
    back.dispatch('error'); // fallback also fails
    await playPromise;

    // Back must NOT have been faded in
    expect(back.style.opacity).not.toBe('1');
    // Front must remain visible
    expect(front.style.opacity).toBe('1');
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
      '/avatars/p1/happy/idle.mp4',
      '/avatars/p1/neutral/idle.mp4',
    );

    // Advance past both 2 s timeouts (primary + fallback)
    await vi.advanceTimersByTimeAsync(2001); // primary timeout
    await vi.advanceTimersByTimeAsync(2001); // fallback timeout
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
      '/avatars/p1/happy/idle.mp4',
      '/avatars/p1/neutral/idle.mp4',
    );

    // Primary times out
    await vi.advanceTimersByTimeAsync(2001);

    // Switch to real timers so dispatch + await work normally
    vi.useRealTimers();
    back.dispatch('canplay');
    await playPromise;

    expect(back.style.opacity).toBe('1');
  });

  it('does not swap when there is no fallback and primary times out', async () => {
    vi.useFakeTimers();
    const renderer = await makeRenderer();
    const back = videoInstances[1];
    const front = videoInstances[0];
    expect(back).toBeDefined();

    front.style.opacity = '1';

    // No fallback provided
    const playPromise = crossFadeTo(renderer, '/avatars/p1/happy/idle.mp4');

    await vi.advanceTimersByTimeAsync(2001);
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
    expect(r.resolveEmotionFolder('p1', 'happy', 'idle')).toBe('happy');
  });

  it('returns emotion when probe confirmed it available', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    r.availabilityCache = { p1: { happy: { idle: true } } };
    expect(r.resolveEmotionFolder('p1', 'happy', 'idle')).toBe('happy');
  });

  it('falls back to neutral when emotion confirmed absent and neutral confirmed present', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    r.availabilityCache = {
      p1: {
        happy: { idle: false },
        neutral: { idle: true },
      },
    };
    expect(r.resolveEmotionFolder('p1', 'happy', 'idle')).toBe('neutral');
  });

  it('remains optimistic (returns emotion) when state is unprobed even if neutral is confirmed', async () => {
    const r = await makeRenderer() as unknown as PrivateRenderer;
    // happy/idle is missing from cache (never probed), but neutral/idle is confirmed
    r.availabilityCache = {
      p1: {
        happy: {}, // idle not probed for this emotion
        neutral: { idle: true },
      },
    };
    // Must stay optimistic — do not fall back to neutral for unprobed states
    expect(r.resolveEmotionFolder('p1', 'happy', 'idle')).toBe('happy');
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
