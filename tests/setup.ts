import { vi } from 'vitest';

if (typeof globalThis.setImmediate === 'undefined') {
  (globalThis as any).setImmediate = (fn: (...args: any[]) => void, ...args: any[]) =>
    setTimeout(fn, 0, ...args);
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 16);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}

if (typeof globalThis.atob === 'undefined') {
  (globalThis as any).atob = (b64: string) =>
    Buffer.from(b64, 'base64').toString('binary');
}
