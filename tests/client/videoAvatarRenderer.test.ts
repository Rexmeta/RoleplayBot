/**
 * Integration tests for video-avatar persona rendering.
 *
 * Covers integration boundaries not exercised by VideoAvatarRenderer's focused
 * unit suite: factory selection and persona-provided clip URL resolution.
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

});
