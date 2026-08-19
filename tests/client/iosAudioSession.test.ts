// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isIOSWebKitAudioPlatform,
  setIOSRealtimeAudioSessionActive,
} from '../../client/src/lib/iosAudioSession';

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as any).audioSession;
});

describe('iOS realtime audio session', () => {
  it('keeps the iPhone audio route in play-and-record until the conversation ends', () => {
    vi.spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
    const audioSession = { type: 'auto' };
    Object.defineProperty(navigator, 'audioSession', {
      configurable: true,
      value: audioSession,
    });

    expect(setIOSRealtimeAudioSessionActive(true)).toBe(true);
    expect(audioSession.type).toBe('play-and-record');
    expect(setIOSRealtimeAudioSessionActive(false)).toBe(true);
    expect(audioSession.type).toBe('auto');
  });

  it('detects iPadOS when Safari uses a desktop Mac user-agent', () => {
    vi.spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(5);

    expect(isIOSWebKitAudioPlatform()).toBe(true);
  });

  it('does not fail older iOS Safari when the Audio Session API is unavailable', () => {
    vi.spyOn(navigator, 'userAgent', 'get')
      .mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15');

    expect(setIOSRealtimeAudioSessionActive(true)).toBe(false);
  });
});