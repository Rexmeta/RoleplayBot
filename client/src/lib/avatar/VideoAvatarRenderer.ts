/**
 * VideoAvatarRenderer
 *
 * Implements AvatarRenderer using looping MP4 video clips per avatar state.
 * Two <video> elements are used in a Double Buffer pattern for Cross Fade
 * transitions between states, eliminating black-frame flicker.
 *
 * Asset path convention:
 *   /avatars/{avatarId}/{emotion}/{state}.mp4
 * Fallback (when emotion-specific asset is absent):
 *   /avatars/{avatarId}/neutral/{state}.mp4
 *
 * Activate via: VITE_AVATAR_RENDERER=video
 */

import type { AvatarState } from './types';
import type { AvatarRenderer, AvatarPersonaInfo } from './AvatarRenderer';
import { toMediaUrl } from '@/lib/mediaUrl';

// ── Constants ─────────────────────────────────────────────────────────────────

const AVATAR_STATES: AvatarState[] = [
  'idle',
  'listening',
  'listening_nod',
  'thinking',
  'speaking',
  'speaking_pause',
];

const CROSS_FADE_DURATION_MS = 200;

// ── Emotion overlay colours (shared with ImageAvatarRenderer for consistency) ──

const emotionOverlayColors: Record<string, string> = {
  happy: 'rgba(251, 191, 36, 0.18)',
  angry: 'rgba(239, 68, 68, 0.18)',
  sad: 'rgba(59, 130, 246, 0.18)',
  anxious: 'rgba(139, 92, 246, 0.15)',
  surprised: 'rgba(249, 115, 22, 0.15)',
  curious: 'rgba(6, 182, 212, 0.12)',
  tired: 'rgba(100, 116, 139, 0.15)',
  disappointed: 'rgba(99, 102, 241, 0.12)',
  confused: 'rgba(168, 85, 247, 0.12)',
  determined: 'rgba(234, 88, 12, 0.12)',
  neutral: 'rgba(0, 0, 0, 0)',
};

const emotionToEnglish: Record<string, string> = {
  '중립': 'neutral', '기쁨': 'happy', '슬픔': 'sad', '분노': 'angry', '놀람': 'surprised',
  '호기심': 'curious', '불안': 'anxious', '피로': 'tired', '실망': 'disappointed', '당혹': 'confused',
  '단호': 'determined',
  'neutral': 'neutral', 'happy': 'happy', 'sad': 'sad', 'angry': 'angry', 'surprised': 'surprised',
  'curious': 'curious', 'anxious': 'anxious', 'tired': 'tired', 'disappointed': 'disappointed',
  'confused': 'confused', 'determined': 'determined',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function createVideoElement(): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.setAttribute('preload', 'auto');
  v.style.position = 'absolute';
  v.style.inset = '0';
  v.style.width = '100%';
  v.style.height = '100%';
  v.style.objectFit = 'cover';
  v.style.objectPosition = 'center 15%';
  v.style.transition = `opacity ${CROSS_FADE_DURATION_MS}ms ease`;
  v.style.opacity = '0';
  return v;
}

/** Build the asset URL for a given avatarId / emotion / state */
function videoUrl(avatarId: string, emotion: string, state: AvatarState): string {
  return `/avatars/${avatarId}/${emotion}/${state}.mp4`;
}

const CLIP_STATES_SET = new Set([
  'idle', 'listening', 'listening_nod', 'thinking', 'speaking', 'speaking_pause',
]);

/**
 * Resolve a URL from the explicit clips map.
 * Supports both the new gender-separated shape ({ male?: {...}, female?: {...} })
 * and the legacy flat shape ({ idle: url, ... }).
 * Fallback order: requested gender → male → female → legacy flat → idle
 */
function resolveClipUrl(
  clips: Record<string, any>,
  state: AvatarState,
  gender?: string,
): string | undefined {
  if (!clips) return undefined;

  // Detect shape: flat if any top-level key is a clip-state name
  const isFlat = Object.keys(clips).some(k => CLIP_STATES_SET.has(k));

  if (!isFlat) {
    // New gender-separated shape
    const preferredGender = gender === 'female' ? 'female' : 'male';
    const genderMap: Partial<Record<string, string>> | undefined =
      clips[preferredGender] ?? clips['male'] ?? clips['female'];
    if (genderMap && typeof genderMap === 'object') {
      return (genderMap as Partial<Record<string, string>>)[state]
        ?? (genderMap as Partial<Record<string, string>>)['idle']
        ?? undefined;
    }
    return undefined;
  }

  // Legacy flat shape
  return (clips as Partial<Record<string, string>>)[state]
    ?? (clips as Partial<Record<string, string>>)['idle']
    ?? undefined;
}

// ── VideoAvatarRenderer ───────────────────────────────────────────────────────

export class VideoAvatarRenderer implements AvatarRenderer {
  // ── Observable state ──────────────────────────────────────────────────────
  /** Not meaningful for video mode; kept for interface compatibility. */
  displayImageUrl = '';
  overlayColor = 'rgba(0, 0, 0, 0)';
  isTransitioning = false;
  isInitialLoading = true;
  isOverlayFading = false;
  currentEmotion = 'neutral';

  // ── Internal ──────────────────────────────────────────────────────────────
  private persona: AvatarPersonaInfo | null = null;
  private destroyed = false;
  private listeners = new Set<() => void>();
  private initGeneration = 0;

  /** The container element that consumers must mount in the DOM */
  readonly containerEl: HTMLDivElement;

  /** Double-buffer video elements */
  private videoA: HTMLVideoElement;
  private videoB: HTMLVideoElement;

  /** Which buffer is currently the "front" (visible) one */
  private frontIsA = true;

  private currentState: AvatarState = 'idle';
  private currentEmotionEn = 'neutral';

  /**
   * Availability cache: avatarId → emotion → state → boolean | undefined
   * undefined = not yet probed; true = available; false = absent
   */
  private availabilityCache: Record<string, Record<string, Record<string, boolean | undefined>>> = {};

  /** Active cross-fade timer */
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  /** <link rel="preload"> elements injected into <head> for cleanup */
  private preloadLinks: HTMLLinkElement[] = [];

  constructor() {
    this.containerEl = document.createElement('div');
    this.containerEl.style.position = 'relative';
    this.containerEl.style.width = '100%';
    this.containerEl.style.height = '100%';
    this.containerEl.style.overflow = 'hidden';

    this.videoA = createVideoElement();
    this.videoB = createVideoElement();
    this.containerEl.appendChild(this.videoA);
    this.containerEl.appendChild(this.videoB);
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(): void {
    this.listeners.forEach(cb => cb());
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private get frontVideo(): HTMLVideoElement {
    return this.frontIsA ? this.videoA : this.videoB;
  }

  private get backVideo(): HTMLVideoElement {
    return this.frontIsA ? this.videoB : this.videoA;
  }

  /**
   * Resolve which emotion folder to use, with correct fallback logic:
   * - If the emotion has been probed and confirmed available → use it.
   * - If the emotion has been probed and confirmed absent → fall back to neutral
   *   (only if neutral itself is confirmed available).
   * - If the emotion has NOT been probed yet → try it optimistically; the
   *   video's onerror handler will retry with neutral if it 404s.
   */
  private resolveEmotionFolder(avatarId: string, emotion: string, state: AvatarState): string {
    const avatarCache = this.availabilityCache[avatarId];
    if (!avatarCache) return emotion; // nothing probed yet — be optimistic

    const emotionCache = avatarCache[emotion];
    if (emotionCache !== undefined) {
      // This emotion has been probed at some point
      if (emotionCache[state] === true) return emotion;           // confirmed present
      if (emotionCache[state] === false) {
        // Confirmed absent — fall back to neutral if available
        if (avatarCache['neutral']?.[state] === true) return 'neutral';
        return 'neutral'; // last resort even if neutral probe hasn't confirmed it
      }
      // emotionCache[state] === undefined: state not probed yet for this emotion
      // → optimistic: try emotion
    }
    // emotion not in cache at all, or state not probed → optimistic
    return emotion;
  }

  /**
   * Attempt to load `src` into `videoEl`, returning an explicit readiness result.
   *
   * `'ready'`   — `canplay` fired; the video is confirmed playable.
   * `'error'`   — `error` event fired; the resource is definitively unavailable.
   * `'timeout'` — neither fired within `timeoutMs`; state is unknown.
   *
   * Only `'ready'` authorises a buffer swap; both `'error'` and `'timeout'`
   * leave the current front video untouched.
   */
  private _loadVideo(
    videoEl: HTMLVideoElement,
    src: string,
    timeoutMs: number,
  ): Promise<'ready' | 'error' | 'timeout'> {
    return new Promise(resolve => {
      let settled = false;
      const settle = (result: 'ready' | 'error' | 'timeout') => {
        if (settled) return;
        settled = true;
        videoEl.removeEventListener('canplay', onCanPlay);
        videoEl.removeEventListener('error', onError);
        clearTimeout(timer);
        resolve(result);
      };
      const onCanPlay = () => settle('ready');
      const onError = () => settle('error');
      const timer = setTimeout(() => settle('timeout'), timeoutMs);
      videoEl.addEventListener('canplay', onCanPlay);
      videoEl.addEventListener('error', onError);
      videoEl.src = src;
      videoEl.load();
    });
  }

  /**
   * Cross-fade to a new video src on the back buffer, then swap.
   *
   * Strategy:
   * 1. Try the primary `src`.  Only swap on `'ready'`.
   * 2. On `'error'`: mark the asset unavailable, then try `fallbackSrc` (neutral).
   * 3. On `'timeout'`: try `fallbackSrc` as well (the asset may still be loading
   *    but we don't want to block indefinitely).
   * 4. If the fallback is also not `'ready'`, abort the whole swap — the current
   *    front video (or static image background) stays visible; no blank frame.
   */
  private async _crossFadeTo(src: string, fallbackSrc?: string): Promise<void> {
    if (this.destroyed) return;

    const back = this.backVideo;

    // ── Attempt primary source ────────────────────────────────────────────
    // 2 s for initial/uncached loads; cached clips fire canplay in < 50 ms.
    let result = await this._loadVideo(back, src, 2000);
    if (this.destroyed) return;

    // ── Fallback to neutral on error or timeout ───────────────────────────
    if (result !== 'ready' && fallbackSrc && fallbackSrc !== src) {
      if (result === 'error') this._markUnavailable(src);

      result = await this._loadVideo(back, fallbackSrc, 2000);
      if (this.destroyed) return;
    }

    // ── Abort if nothing is playable — keep current front video visible ───
    if (result !== 'ready') {
      back.pause();
      back.removeAttribute('src');
      back.load();
      return;
    }

    // ── Perform cross-fade ────────────────────────────────────────────────
    back.play().catch(() => { /* autoplay may be blocked — silent fail */ });

    back.style.opacity = '1';
    this.frontVideo.style.opacity = '0';

    this.isTransitioning = true;
    this.emit();

    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => {
      if (this.destroyed) return;
      // Pause and clear the now-hidden video to save resources
      this.frontVideo.pause();
      this.frontVideo.removeAttribute('src');
      this.frontVideo.load();
      // Swap buffers
      this.frontIsA = !this.frontIsA;
      this.isTransitioning = false;
      this.emit();
    }, CROSS_FADE_DURATION_MS + 50);
  }

  /**
   * Parse a video URL back to emotion/state and mark it absent in the cache.
   * URL pattern: /avatars/{id}/{emotion}/{state}.mp4
   */
  private _markUnavailable(src: string): void {
    const match = src.match(/\/avatars\/([^/]+)\/([^/]+)\/([^/]+)\.mp4$/);
    if (!match) return;
    const [, avatarId, emotion, state] = match;
    if (!this.availabilityCache[avatarId]) this.availabilityCache[avatarId] = {};
    if (!this.availabilityCache[avatarId][emotion]) this.availabilityCache[avatarId][emotion] = {};
    this.availabilityCache[avatarId][emotion][state] = false;
  }

  /**
   * Start playing a state + emotion combination.
   *
   * Priority:
   * 1. If persona.videos.clips has an entry for this state → use it directly.
   * 2. Fall back to the convention-based avatarId/emotion/state.mp4 path.
   * Neutral is always the fallback for the convention path.
   */
  private async _play(state: AvatarState, emotionEn: string): Promise<void> {
    if (!this.persona || this.destroyed) return;

    // ── Explicit clips override (persona-level video URLs) ─────────────────
    const clips = this.persona.videos?.clips;
    if (clips) {
      const rawUrl = resolveClipUrl(clips as Record<string, any>, state, this.persona.gender);
      if (rawUrl) {
        // Normalize storage-key style refs (e.g. "videos/avatar-xxx-idle.webm")
        // to browser-playable URLs, using the same policy as other media assets.
        const explicitUrl = toMediaUrl(rawUrl) || rawUrl;
        await this._crossFadeTo(explicitUrl);
        return;
      }
    }

    // ── Convention-based path ──────────────────────────────────────────────
    const avatarId = this.persona.videos?.avatarId ?? this.persona.id;
    const resolvedEmotion = this.resolveEmotionFolder(avatarId, emotionEn, state);
    const src = videoUrl(avatarId, resolvedEmotion, state);

    // Provide neutral as a fallback whenever we're trying a non-neutral clip
    const fallbackSrc = resolvedEmotion !== 'neutral'
      ? videoUrl(avatarId, 'neutral', state)
      : undefined;

    await this._crossFadeTo(src, fallbackSrc);
  }

  // ── AvatarRenderer interface ──────────────────────────────────────────────

  initialize(
    persona: AvatarPersonaInfo,
    _conversationId: string,
    onReady?: () => void,
  ): void {
    this.initGeneration++;
    const generation = this.initGeneration;
    const guard = () => !this.destroyed && this.initGeneration === generation;

    this.destroyed = false;
    this.persona = persona;
    this.currentState = 'idle';
    this.currentEmotionEn = 'neutral';
    this.currentEmotion = 'neutral';
    this.isInitialLoading = true;
    this.isOverlayFading = false;
    this.overlayColor = 'rgba(0, 0, 0, 0)';

    // Normalize persona.image through toMediaUrl so storage-key-style refs
    // (e.g. "personas/abc/neutral.webp") become browser-ready URLs, matching
    // the same policy used by ImageAvatarRenderer and legacy emotion state.
    this.displayImageUrl = persona.image ? (toMediaUrl(persona.image) || persona.image) : '';
    this.emit();

    // Kick off preload in the background; signal ready after probing completes.
    this.preloadAssets().then(() => {
      if (!guard()) return;
      this.isOverlayFading = true;
      onReady?.();
      this.emit();
      setTimeout(() => {
        if (!guard()) return;
        this.isInitialLoading = false;
        this.emit();
      }, 500);
    });

    // Start playing idle immediately (optimistic — may 404 and retry with neutral).
    this._play('idle', 'neutral');
  }

  destroy(): void {
    this.destroyed = true;
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    // Clean up video elements
    [this.videoA, this.videoB].forEach(v => {
      v.pause();
      v.src = '';
      v.load();
    });
    // Remove injected preload links
    this._clearPreloadLinks();
    this.listeners.clear();
  }

  playState(state: AvatarState, emotion?: string): void {
    const emotionEn = emotion
      ? (emotionToEnglish[emotion] ?? emotion)
      : this.currentEmotionEn;

    const stateChanged = state !== this.currentState;
    const emotionChanged = emotionEn !== this.currentEmotionEn;

    if (emotionEn !== this.currentEmotionEn) {
      this.currentEmotionEn = emotionEn;
      this.overlayColor = emotionOverlayColors[emotionEn] ?? 'rgba(0, 0, 0, 0)';
      this.currentEmotion = emotionEn;
      this.emit();
    }

    if (stateChanged || emotionChanged) {
      this.currentState = state;
      this._play(state, emotionEn);
    }
  }

  setEmotion(emotion: string): void {
    const emotionEn = emotionToEnglish[emotion] ?? emotion;
    if (emotionEn === this.currentEmotionEn) return;

    this.currentEmotionEn = emotionEn;
    this.currentEmotion = emotionEn;
    this.overlayColor = emotionOverlayColors[emotionEn] ?? 'rgba(0, 0, 0, 0)';
    this.emit();

    this._play(this.currentState, emotionEn);
  }

  async preloadAssets(): Promise<void> {
    if (!this.persona) return;

    // If explicit clips are provided, preload those and skip convention probing.
    const clips = this.persona.videos?.clips;
    if (clips) {
      // Collect all clip URLs regardless of flat vs gender-separated shape
      const allUrls: string[] = [];
      const isFlat = Object.keys(clips).some(k => CLIP_STATES_SET.has(k));
      if (isFlat) {
        allUrls.push(
          ...Object.values(clips as Partial<Record<string, string>>)
            .filter((v): v is string => typeof v === 'string' && !!v),
        );
      } else {
        for (const genderMap of Object.values(clips as Record<string, any>)) {
          if (genderMap && typeof genderMap === 'object') {
            allUrls.push(
              ...Object.values(genderMap as Partial<Record<string, string>>)
                .filter((v): v is string => typeof v === 'string' && !!v),
            );
          }
        }
      }
      const probes = allUrls.map(src =>
        this._probeVideo(src).then(available => {
          if (available) this._injectPreloadLink(src);
        }),
      );
      await Promise.allSettled(probes);
      return;
    }

    const avatarId = this.persona.videos?.avatarId ?? this.persona.id;

    // Probe all state assets for the current emotion + neutral fallback.
    const emotionsToProbe = Array.from(
      new Set([this.currentEmotionEn, 'neutral']),
    );

    if (!this.availabilityCache[avatarId]) {
      this.availabilityCache[avatarId] = {};
    }
    const cache = this.availabilityCache[avatarId];

    const probes: Promise<void>[] = [];

    for (const emotion of emotionsToProbe) {
      if (!cache[emotion]) cache[emotion] = {};

      for (const state of AVATAR_STATES) {
        if (cache[emotion][state] !== undefined) continue; // already probed

        const src = videoUrl(avatarId, emotion, state);
        const p = this._probeVideo(src).then(available => {
          cache[emotion][state] = available;
          if (available) this._injectPreloadLink(src);
        });
        probes.push(p);
      }
    }

    await Promise.allSettled(probes);
  }

  pause(): void {
    this.frontVideo.pause();
  }

  resume(): void {
    this.frontVideo.play().catch(() => { /* autoplay policy */ });
  }

  // ── Preload helpers ───────────────────────────────────────────────────────

  private _probeVideo(src: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const done = (ok: boolean) => {
        v.src = '';
        v.load();
        resolve(ok);
      };
      v.addEventListener('loadedmetadata', () => done(true), { once: true });
      v.addEventListener('error', () => done(false), { once: true });
      setTimeout(() => done(false), 3000); // 3 s safety timeout
      v.src = src;
      v.load();
    });
  }

  private _injectPreloadLink(src: string): void {
    if (typeof document === 'undefined') return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'video';
    link.href = src;
    document.head.appendChild(link);
    this.preloadLinks.push(link);
  }

  private _clearPreloadLinks(): void {
    this.preloadLinks.forEach(l => l.parentNode?.removeChild(l));
    this.preloadLinks = [];
  }
}
