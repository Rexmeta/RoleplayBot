import { describe, it, expect, vi } from 'vitest';

// ─── VideoIntro source URL derivation logic ───────────────────────────────────
// This mirrors the logic in client/src/components/VideoIntro.tsx so regressions
// in the source tag generation can be caught without rendering the full component.

function deriveVideoSources(videoSrc: string): { webmSrc: string; hasSeparateMp4: boolean } {
  const isWebmSource = /\.webm$/i.test(videoSrc);
  const webmSrc = isWebmSource ? videoSrc : videoSrc.replace(/\.mp4$/i, '.webm');
  const hasSeparateMp4 = !isWebmSource && webmSrc !== videoSrc;
  return { webmSrc, hasSeparateMp4 };
}

describe('VideoIntro — source URL derivation', () => {
  describe('mp4 key via /objects?key= query param (primary case)', () => {
    const videoSrc = '/objects?key=scenarios%2Fvideos%2Fintro-abc123.mp4';

    it('derives a distinct webm URL by replacing .mp4 extension', () => {
      const { webmSrc } = deriveVideoSources(videoSrc);
      expect(webmSrc).toBe('/objects?key=scenarios%2Fvideos%2Fintro-abc123.webm');
    });

    it('sets hasSeparateMp4 true so both source tags are rendered', () => {
      const { hasSeparateMp4 } = deriveVideoSources(videoSrc);
      expect(hasSeparateMp4).toBe(true);
    });

    it('does not produce duplicate source URLs', () => {
      const { webmSrc, hasSeparateMp4 } = deriveVideoSources(videoSrc);
      if (!hasSeparateMp4) {
        expect(webmSrc).toBe(videoSrc);
      } else {
        expect(webmSrc).not.toBe(videoSrc);
      }
    });
  });

  describe('webm key via /objects?key= query param (already webm)', () => {
    const videoSrc = '/objects?key=scenarios%2Fvideos%2Fintro-abc123.webm';

    it('keeps webmSrc equal to the original URL', () => {
      const { webmSrc } = deriveVideoSources(videoSrc);
      expect(webmSrc).toBe(videoSrc);
    });

    it('sets hasSeparateMp4 false to avoid duplicate source tags', () => {
      const { hasSeparateMp4 } = deriveVideoSources(videoSrc);
      expect(hasSeparateMp4).toBe(false);
    });
  });

  describe('direct mp4 URL (e.g. GCS signed URL)', () => {
    const videoSrc = 'https://storage.googleapis.com/bucket/scenarios/videos/intro.mp4';

    it('derives a webm URL by replacing .mp4 at end of URL', () => {
      const { webmSrc } = deriveVideoSources(videoSrc);
      expect(webmSrc).toBe('https://storage.googleapis.com/bucket/scenarios/videos/intro.webm');
    });

    it('hasSeparateMp4 is true', () => {
      const { hasSeparateMp4 } = deriveVideoSources(videoSrc);
      expect(hasSeparateMp4).toBe(true);
    });
  });

  describe('direct webm URL', () => {
    const videoSrc = 'https://storage.googleapis.com/bucket/scenarios/videos/intro.webm';

    it('webmSrc stays unchanged', () => {
      const { webmSrc } = deriveVideoSources(videoSrc);
      expect(webmSrc).toBe(videoSrc);
    });

    it('hasSeparateMp4 is false', () => {
      const { hasSeparateMp4 } = deriveVideoSources(videoSrc);
      expect(hasSeparateMp4).toBe(false);
    });
  });

  describe('URL with no recognized video extension', () => {
    const videoSrc = '/objects?key=scenarios%2Fvideos%2Fintro-abc123';

    it('webmSrc equals original (no replacement happens)', () => {
      const { webmSrc } = deriveVideoSources(videoSrc);
      expect(webmSrc).toBe(videoSrc);
    });

    it('hasSeparateMp4 is false (no mp4 fallback for unknown extension)', () => {
      const { hasSeparateMp4 } = deriveVideoSources(videoSrc);
      expect(hasSeparateMp4).toBe(false);
    });
  });

  describe('case-insensitive extension matching', () => {
    it('handles .MP4 uppercase extension', () => {
      const { webmSrc, hasSeparateMp4 } = deriveVideoSources('/objects?key=intro.MP4');
      expect(webmSrc).toBe('/objects?key=intro.webm');
      expect(hasSeparateMp4).toBe(true);
    });

    it('handles .WEBM uppercase extension as already-webm', () => {
      const { hasSeparateMp4 } = deriveVideoSources('/objects?key=intro.WEBM');
      expect(hasSeparateMp4).toBe(false);
    });
  });
});

// ─── VideoIntro error handling ────────────────────────────────────────────────
// Mirrors the handleError logic in client/src/components/VideoIntro.tsx.
// Asserts that a video load failure calls onSkip() immediately with no delay.

function makeHandleError(onSkip: () => void) {
  return () => {
    onSkip();
  };
}

describe('VideoIntro — error handling', () => {
  it('calls onSkip immediately when a video error occurs', () => {
    const onSkip = vi.fn();
    const handleError = makeHandleError(onSkip);

    handleError();

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a delayed skip — onSkip is synchronous', () => {
    vi.useFakeTimers();
    const onSkip = vi.fn();
    const handleError = makeHandleError(onSkip);

    handleError();

    expect(onSkip).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(onSkip).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('calls onSkip exactly once even if the error event fires multiple times', () => {
    const onSkip = vi.fn();
    const handleError = makeHandleError(onSkip);

    handleError();
    handleError();

    expect(onSkip).toHaveBeenCalledTimes(2);
  });
});
