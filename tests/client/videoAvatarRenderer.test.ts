/**
 * Integration tests for video-avatar persona rendering.
 *
 * Covers:
 * 1. AvatarRendererFactory: `hint='video'` → VideoAvatarRenderer; `undefined` → ImageAvatarRenderer
 * 2. VideoAvatarRenderer: explicit `persona.videos.clips` URLs (gender → behaviour_emotion slot)
 *    are used directly (with toMediaUrl normalization) instead of convention-based
 *    /avatars/{id}/{emotion}/{behaviour}.mp4 paths.
 * 3. VideoAvatarRenderer: falls back to convention path when clips is absent.
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Minimal DOM stubs needed by VideoAvatarRenderer ─────────────────────────

function makeVideoEl() {
  let _src = '';
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  return {
    get src() { return _src; },
    set src(v: string) { _src = v; },
    muted: false,
    loop: false,
    playsInline: false,
    style: {} as CSSStyleDeclaration,
    setAttribute: vi.fn(),
    addEventListener(e: string, cb: (...args: any[]) => void) {
      listeners[e] = listeners[e] ?? [];
      listeners[e].push(cb);
    },
    removeEventListener(e: string, cb: (...args: any[]) => void) {
      listeners[e] = (listeners[e] ?? []).filter(fn => fn !== cb);
    },
    load: vi.fn(function(this: any) {
      // Simulate immediate canplay so tests are not stuck waiting
      setTimeout(() => {
        (listeners['canplay'] ?? []).forEach(fn => fn());
      }, 0);
    }),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    _listeners: listeners,
  };
}

function makeDiv() {
  const children: any[] = [];
  return {
    style: {} as CSSStyleDeclaration,
    appendChild: vi.fn((child: any) => children.push(child)),
    removeChild: vi.fn((child: any) => {
      const i = children.indexOf(child);
      if (i !== -1) children.splice(i, 1);
    }),
    get children() { return children; },
  };
}

function makeLink() {
  return { rel: '', as: '', href: '', parentNode: { removeChild: vi.fn() } };
}

beforeEach(() => {
  let callCount = 0;
  (globalThis as any).document = {
    createElement(tag: string) {
      if (tag === 'video') return makeVideoEl();
      if (tag === 'div') return makeDiv();
      if (tag === 'link') return makeLink();
      return {};
    },
    head: { appendChild: vi.fn() },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).document;
});

// ── Mock toMediaUrl ──────────────────────────────────────────────────────────

vi.mock('../../client/src/lib/mediaUrl', () => ({
  toMediaUrl(path: string | null | undefined): string | null {
    if (!path) return null;
    // Simulate storage-key → URL conversion
    if (path.startsWith('videos/')) return `/objects?key=${encodeURIComponent(path)}`;
    return path;
  },
}));

// ── 1. AvatarRendererFactory routing ─────────────────────────────────────────

describe('createAvatarRenderer — hint parameter routing', () => {
  it('returns ImageAvatarRenderer when hint is undefined', async () => {
    const { createAvatarRenderer } = await import('../../client/src/lib/avatar/AvatarRendererFactory');
    const { ImageAvatarRenderer } = await import('../../client/src/lib/avatar/ImageAvatarRenderer');
    const renderer = await createAvatarRenderer(undefined);
    expect(renderer).toBeInstanceOf(ImageAvatarRenderer);
    renderer.destroy();
  });

  it('returns VideoAvatarRenderer when hint is "video"', async () => {
    const { createAvatarRenderer } = await import('../../client/src/lib/avatar/AvatarRendererFactory');
    const { VideoAvatarRenderer } = await import('../../client/src/lib/avatar/VideoAvatarRenderer');
    const renderer = await createAvatarRenderer('video');
    expect(renderer).toBeInstanceOf(VideoAvatarRenderer);
    renderer.destroy();
  });

  it('returns ImageAvatarRenderer when hint is "image"', async () => {
    const { createAvatarRenderer } = await import('../../client/src/lib/avatar/AvatarRendererFactory');
    const { ImageAvatarRenderer } = await import('../../client/src/lib/avatar/ImageAvatarRenderer');
    const renderer = await createAvatarRenderer('image');
    expect(renderer).toBeInstanceOf(ImageAvatarRenderer);
    renderer.destroy();
  });
});

// ── 2. VideoAvatarRenderer — explicit clips URL path ─────────────────────────

describe('VideoAvatarRenderer — explicit clips URL support', () => {
  async function makeRenderer() {
    const { VideoAvatarRenderer } = await import('../../client/src/lib/avatar/VideoAvatarRenderer');
    return new VideoAvatarRenderer();
  }

  it('uses the explicit clip URL (after toMediaUrl normalization) instead of convention path', async () => {
    const renderer = await makeRenderer();
    const crossFadeSpy = vi.spyOn(renderer as any, '_crossFadeTo').mockResolvedValue(undefined);

    renderer.initialize(
      {
        id: 'intp',
        name: 'Test',
        gender: 'male',
        videos: {
          enabled: true,
          avatarId: 'intp',
          clips: { male: { listening_neutral: 'videos/avatar-intp-listening-neutral.mp4' } },
        },
      },
      'conv-1',
    );

    // _play is called inside initialize for the idle state; give it a tick to resolve
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(crossFadeSpy).toHaveBeenCalledWith(
      '/objects?key=videos%2Favatar-intp-listening-neutral.mp4',
      undefined,
      'explicit',
    );

    renderer.destroy();
  });

  it('falls back to the behaviour neutral clip for emotions without their own clip', async () => {
    const renderer = await makeRenderer();
    const crossFadeSpy = vi.spyOn(renderer as any, '_crossFadeTo').mockResolvedValue(undefined);

    renderer.initialize(
      {
        id: 'intp',
        name: 'Test',
        gender: 'male',
        videos: {
          enabled: true,
          avatarId: 'intp',
          // Only the neutral listening clip exists for this persona.
          clips: { male: { listening_neutral: 'videos/avatar-intp-listening-neutral.mp4' } },
        },
      },
      'conv-1',
    );
    await new Promise(resolve => setTimeout(resolve, 10));

    // 'thinking' collapses to the listening behaviour; 'happy' has no positive clip.
    renderer.playState('thinking', 'happy');
    await new Promise(resolve => setTimeout(resolve, 10));

    const calls = crossFadeSpy.mock.calls.map(c => c[0]);
    expect(calls.every(u => u.includes('avatar-intp-listening-neutral'))).toBe(true);

    renderer.destroy();
  });

  it('falls back to the other gender map when the requested gender has no clips', async () => {
    const renderer = await makeRenderer();
    const crossFadeSpy = vi.spyOn(renderer as any, '_crossFadeTo').mockResolvedValue(undefined);

    renderer.initialize(
      {
        id: 'intp',
        name: 'Test',
        gender: 'female',
        videos: {
          enabled: true,
          avatarId: 'intp',
          clips: { male: { listening_neutral: 'videos/avatar-intp-male-listening-neutral.mp4' } },
        },
      },
      'conv-1',
    );
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(crossFadeSpy).toHaveBeenLastCalledWith(
      '/objects?key=videos%2Favatar-intp-male-listening-neutral.mp4',
      undefined,
      'explicit',
    );

    renderer.destroy();
  });

  it('uses convention-based path when clips is absent', async () => {
    const renderer = await makeRenderer();
    const crossFadeSpy = vi.spyOn(renderer as any, '_crossFadeTo').mockResolvedValue(undefined);

    renderer.initialize(
      {
        id: 'intp',
        name: 'Test',
        // no videos field
      },
      'conv-1',
    );
    await new Promise(resolve => setTimeout(resolve, 10));

    // Should use /avatars/intp/neutral/listening.mp4 convention
    // (neutral emotion → no separate fallback, so 2nd arg is undefined)
    expect(crossFadeSpy).toHaveBeenCalledWith(
      '/avatars/intp/neutral/listening.mp4',
      undefined,
    );

    renderer.destroy();
  });

  it('selects the clip for the collapsed behaviour × emotion bucket', async () => {
    const renderer = await makeRenderer();
    const crossFadeSpy = vi.spyOn(renderer as any, '_crossFadeTo').mockResolvedValue(undefined);

    renderer.initialize(
      {
        id: 'intp',
        name: 'Test',
        gender: 'male',
        videos: {
          enabled: true,
          clips: {
            male: {
              listening_positive: 'videos/intp-listening-positive.mp4',
              listening_neutral: 'videos/intp-listening-neutral.mp4',
              speaking_negative: 'videos/intp-speaking-negative.mp4',
            },
          },
        },
      },
      'conv-1',
    );
    await new Promise(resolve => setTimeout(resolve, 10));

    renderer.playState('listening', 'happy');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(crossFadeSpy).toHaveBeenLastCalledWith(
      '/objects?key=videos%2Fintp-listening-positive.mp4',
      undefined,
      'explicit',
    );

    renderer.playState('speaking', 'angry');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(crossFadeSpy).toHaveBeenLastCalledWith(
      '/objects?key=videos%2Fintp-speaking-negative.mp4',
      undefined,
      'explicit',
    );

    renderer.destroy();
  });

  it('uses the behavior-neutral clip when the detailed LLM emotion has no specific group clip', async () => {
    const renderer = await makeRenderer();
    const crossFadeSpy = vi.spyOn(renderer as any, '_crossFadeTo').mockResolvedValue(undefined);

    renderer.initialize(
      {
        id: 'intp',
        name: 'Test',
        gender: 'female',
        videos: {
          enabled: true,
          clips: { female: { listening_neutral: 'videos/intp-listening-neutral.mp4' } },
        },
      },
      'conv-1',
    );
    await new Promise(resolve => setTimeout(resolve, 10));

    renderer.playState('thinking', 'curious');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(crossFadeSpy).toHaveBeenLastCalledWith(
      '/objects?key=videos%2Fintp-listening-neutral.mp4',
      undefined,
      'explicit',
    );
    renderer.destroy();
  });
});
