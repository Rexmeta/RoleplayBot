import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageAvatarRenderer } from '../../client/src/lib/avatar/ImageAvatarRenderer';

vi.mock('../../client/src/lib/mediaUrl', () => ({ toMediaUrl: (value: string) => value }));
const images: Array<{ src: string; onload?: () => void; onerror?: () => void }> = [];
beforeEach(() => {
  vi.useFakeTimers();
  images.length = 0;
  vi.stubGlobal('Image', class {
    src = '';
    onload?: () => void;
    onerror?: () => void;
    constructor() { images.push(this); }
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const persona = (id: string) => ({
  id, name: id, image: `/${id}/base`,
  expressions: { neutral: `/${id}/neutral`, angry: `/${id}/angry`, happy: `/${id}/happy` },
});
const ready = (renderer: ImageAvatarRenderer, id: string) => {
  renderer.initialize(persona(id), 'run');
  images.at(-1)!.onload!();
  vi.advanceTimersByTime(500);
};
describe('expression loading generation fences', () => {
  it('rejects an older expression that loads after a more recent expression', () => {
    const renderer = new ImageAvatarRenderer();
    ready(renderer, 'a');
    renderer.setEmotion('angry');
    const old = images.at(-1)!;
    renderer.setEmotion('happy');
    images.at(-1)!.onload!();
    vi.advanceTimersByTime(100);
    old.onload!();
    vi.advanceTimersByTime(100);
    expect(renderer.displayImageUrl).toBe('/a/happy');
    renderer.destroy();
  });
  it('rejects an expression timer after persona replacement', () => {
    const renderer = new ImageAvatarRenderer();
    ready(renderer, 'a');
    renderer.setEmotion('angry');
    images.at(-1)!.onload!();
    renderer.initialize(persona('b'), 'run');
    vi.advanceTimersByTime(100);
    expect(renderer.displayImageUrl).toBe('/b/base');
    renderer.destroy();
  });
  it('does not let stale initialization cancel a new persona fallback deadline', () => {
    const renderer = new ImageAvatarRenderer();
    renderer.initialize(persona('a'), 'run');
    const old = images.at(-1)!;
    renderer.initialize(persona('b'), 'run');
    old.onload!();
    vi.advanceTimersByTime(3000);
    expect(renderer.displayImageUrl).toContain('name=b');
    renderer.destroy();
  });
  it('cancels a pending expression when output stops or renderer is destroyed', () => {
    const renderer = new ImageAvatarRenderer();
    ready(renderer, 'a');
    renderer.setEmotion('angry');
    const pending = images.at(-1)!;
    renderer.playState('listening');
    pending.onload!();
    vi.advanceTimersByTime(100);
    expect(renderer.displayImageUrl).toBe('/a/neutral');
    renderer.destroy();
    pending.onerror!();
    expect(renderer.isTransitioning).toBe(false);
  });
  it('loads the neutral fallback on an expression asset failure without applying a stale fallback', () => {
    const renderer = new ImageAvatarRenderer();
    ready(renderer, 'a');
    renderer.setEmotion('angry');
    images.at(-1)!.onerror!();
    const fallback = images.at(-1)!;
    expect(fallback.src).toBe('/a/neutral');
    renderer.setEmotion('happy');
    images.at(-1)!.onload!();
    vi.advanceTimersByTime(100);
    fallback.onload!();
    expect(renderer.displayImageUrl).toBe('/a/happy');
    renderer.destroy();
  });
});
