import { describe, it, expect } from 'vitest';
import { getVideoIntroSources } from '../../client/src/components/VideoIntro';

describe('VideoIntro — source URL derivation', () => {
  describe('mp4 key via /objects?key= query param (primary case)', () => {
    const videoSrc = '/objects?key=scenarios%2Fvideos%2Fintro-abc123.mp4';

    it('derives a distinct webm URL by replacing .mp4 extension', () => {
      const { webmSrc } = getVideoIntroSources(videoSrc);
      expect(webmSrc).toBe('/objects?key=scenarios%2Fvideos%2Fintro-abc123.webm');
    });

    it('sets hasSeparateMp4 true so both source tags are rendered', () => {
      const { hasSeparateMp4 } = getVideoIntroSources(videoSrc);
      expect(hasSeparateMp4).toBe(true);
    });

    it('does not produce duplicate source URLs', () => {
      const { webmSrc, hasSeparateMp4 } = getVideoIntroSources(videoSrc);
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
      const { webmSrc } = getVideoIntroSources(videoSrc);
      expect(webmSrc).toBe(videoSrc);
    });

    it('sets hasSeparateMp4 false to avoid duplicate source tags', () => {
      const { hasSeparateMp4 } = getVideoIntroSources(videoSrc);
      expect(hasSeparateMp4).toBe(false);
    });
  });

  describe('direct mp4 URL (e.g. GCS signed URL)', () => {
    const videoSrc = 'https://storage.googleapis.com/bucket/scenarios/videos/intro.mp4';

    it('derives a webm URL by replacing .mp4 at end of URL', () => {
      const { webmSrc } = getVideoIntroSources(videoSrc);
      expect(webmSrc).toBe('https://storage.googleapis.com/bucket/scenarios/videos/intro.webm');
    });

    it('hasSeparateMp4 is true', () => {
      const { hasSeparateMp4 } = getVideoIntroSources(videoSrc);
      expect(hasSeparateMp4).toBe(true);
    });
  });

  describe('direct webm URL', () => {
    const videoSrc = 'https://storage.googleapis.com/bucket/scenarios/videos/intro.webm';

    it('webmSrc stays unchanged', () => {
      const { webmSrc } = getVideoIntroSources(videoSrc);
      expect(webmSrc).toBe(videoSrc);
    });

    it('hasSeparateMp4 is false', () => {
      const { hasSeparateMp4 } = getVideoIntroSources(videoSrc);
      expect(hasSeparateMp4).toBe(false);
    });
  });

  describe('URL with no recognized video extension', () => {
    const videoSrc = '/objects?key=scenarios%2Fvideos%2Fintro-abc123';

    it('webmSrc equals original (no replacement happens)', () => {
      const { webmSrc } = getVideoIntroSources(videoSrc);
      expect(webmSrc).toBe(videoSrc);
    });

    it('hasSeparateMp4 is false (no mp4 fallback for unknown extension)', () => {
      const { hasSeparateMp4 } = getVideoIntroSources(videoSrc);
      expect(hasSeparateMp4).toBe(false);
    });
  });

  describe('case-insensitive extension matching', () => {
    it('handles .MP4 uppercase extension', () => {
      const { webmSrc, hasSeparateMp4 } = getVideoIntroSources('/objects?key=intro.MP4');
      expect(webmSrc).toBe('/objects?key=intro.webm');
      expect(hasSeparateMp4).toBe(true);
    });

    it('handles .WEBM uppercase extension as already-webm', () => {
      const { hasSeparateMp4 } = getVideoIntroSources('/objects?key=intro.WEBM');
      expect(hasSeparateMp4).toBe(false);
    });
  });
});
