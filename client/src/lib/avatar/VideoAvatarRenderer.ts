/**
 * VideoAvatarRenderer
 *
 * Implements AvatarRenderer using looping MP4 clips selected by
 * behaviour (decided by the audio stream) × emotion (decided by the LLM).
 * Two <video> elements are used in a Double Buffer pattern for Cross Fade
 * transitions, eliminating black-frame flicker.
 *
 * Asset path convention:
 *   /avatars/{avatarId}/{emotion}/{behavior}.mp4
 * Fallback (when the emotion-specific asset is absent):
 *   /avatars/{avatarId}/neutral/{behavior}.mp4
 *
 * Activate via: VITE_AVATAR_RENDERER=video
 */

import type { AvatarState } from './types';
import type { AvatarRenderer, AvatarPersonaInfo } from './AvatarRenderer';
import { toMediaUrl } from '@/lib/mediaUrl';

const CROSS_FADE_DURATION_MS = 200;

/**
 * How long to wait for `canplay` before giving up on a clip.
 *
 * Cached clips settle in well under 50 ms, but a cold object-storage fetch of a
 * multi-megabyte clip needs noticeably longer than that; too tight a budget
 * reports a healthy clip as a timeout and drops the avatar back to the still.
 */
const CLIP_LOAD_TIMEOUT_MS = 5000;

/**
 * Maximum time delta (ms) applied per RAF tick during the reverse pass.
 * Clamping this prevents large jumps when the tab is backgrounded or the
 * device is slow and a single frame takes >50 ms to render.
 */
const PING_PONG_MAX_DELTA_MS = 50;

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
  // loop is intentionally NOT set — ping-pong looping is managed manually
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

export type VideoEmotionBucket = 'positive' | 'neutral' | 'negative';
export type VideoBehavior = 'listening' | 'speaking';

export const VIDEO_BEHAVIORS: readonly VideoBehavior[] = ['listening', 'speaking'];
export const VIDEO_EMOTION_BUCKETS: readonly VideoEmotionBucket[] = ['positive', 'neutral', 'negative'];

/** Build the asset URL for a given avatarId / emotion / behaviour */
function videoUrl(avatarId: string, emotion: string, behavior: VideoBehavior): string {
  return `/avatars/${avatarId}/${emotion}/${behavior}.mp4`;
}

const POSITIVE_EMOTIONS = new Set([
  'happy', 'excited', 'determined', 'curious', 'surprised', 'positive',
  '기쁨', '즐거움', '흥분', '호기심', '놀람', '단호',
]);
const NEGATIVE_EMOTIONS = new Set([
  'sad', 'angry', 'anxious', 'tired', 'disappointed', 'confused', 'concerned', 'negative',
  '슬픔', '분노', '불안', '피로', '실망', '당혹', '걱정',
]);

/**
 * Collapse the LLM's detailed emotion label into the initial commercial
 * release's three reusable video groups. This is deliberately separate from
 * the state machine: the audio stream owns behavior, while the LLM owns affect.
 */
export function toVideoEmotionBucket(emotion: string | undefined): VideoEmotionBucket {
  const normalized = (emotion ?? '').trim().toLowerCase();
  if (POSITIVE_EMOTIONS.has(normalized)) return 'positive';
  if (NEGATIVE_EMOTIONS.has(normalized)) return 'negative';
  return 'neutral';
}

/**
 * The audio stream has richer internal phases, but a first-release clip library
 * has two observable behaviors. User audio always maps to listening; AI audio
 * maps to speaking. Transitional/inactive phases use listening as a quiet,
 * neutral-safe visual fallback.
 */
export function toVideoBehavior(state: AvatarState): VideoBehavior {
  return state === 'speaking' || state === 'speaking_pause' ? 'speaking' : 'listening';
}

/** Resolve the six-slot clip identifier shown by the avatar diagnostics. */
export function toVideoClipSlot(
  state: AvatarState,
  emotion: string | undefined,
): `${VideoBehavior}_${VideoEmotionBucket}` {
  return `${toVideoBehavior(state)}_${toVideoEmotionBucket(emotion)}`;
}

/**
 * Resolve a clip URL for the requested behaviour × emotion.
 *
 * Fallback order: requested gender → male → female, then the behaviour's
 * neutral clip when that persona has no clip for the requested emotion.
 */
function resolveClipUrl(
  clips: Record<string, any>,
  state: AvatarState,
  emotion: string | undefined,
  gender?: string,
): string | undefined {
  if (!clips) return undefined;

  const preferredGender = gender === 'female' ? 'female' : 'male';
  const genderMap = clips[preferredGender] ?? clips['male'] ?? clips['female'];
  if (!genderMap || typeof genderMap !== 'object') return undefined;

  const slots = genderMap as Partial<Record<string, string>>;
  const behavior = toVideoBehavior(state);
  const bucket = toVideoEmotionBucket(emotion);

  return slots[`${behavior}_${bucket}`] ?? slots[`${behavior}_neutral`] ?? undefined;
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
  /**
   * True when the current clip and its fallback could not be made playable.
   * Consumers retain the static portrait behind the video buffers and use this
   * flag to explain that the animation is temporarily unavailable.
   */
  isVideoUnavailable = false;
  /**
   * URL of the clip currently visible in the front buffer, and which
   * resolution path produced it.  Purely diagnostic — the development-only
   * debug overlay reads these to show what is actually playing.
   */
  activeClipUrl = '';
  activeClipSource: 'explicit' | 'convention' | 'convention-fallback' | 'none' = 'none';

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

  /** The state the renderer is currently playing (read by the debug overlay). */
  currentState: AvatarState = 'idle';
  private currentEmotionEn = 'neutral';

  /**
   * Availability cache: avatarId → emotion → state → boolean | undefined
   * undefined = not yet probed; true = available; false = absent
   */
  private availabilityCache: Record<string, Record<string, Record<string, boolean | undefined>>> = {};

  /** Active cross-fade timer */
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Ping-pong state ───────────────────────────────────────────────────────
  /**
   * Per-video ping-pong tracking.
   * direction:  'forward' — native browser playback is active.
   *             'reverse' — RAF loop is stepping currentTime backwards.
   * isPaused:   true when the renderer has been externally paused while in
   *             reverse; RAF is suspended but state is kept so resume() can
   *             restart it.
   * tick:       stored so resume() can reschedule the RAF frame directly.
   */
  private pingPongState = new Map<HTMLVideoElement, {
    direction: 'forward' | 'reverse';
    rafId: number | null;
    lastTimestamp: number;
    endedListener: (() => void) | null;
    isPaused: boolean;
    tick: ((now: number) => void) | null;
  }>();

  /** <link rel="preload"> elements injected into <head> for cleanup */
  private preloadLinks: HTMLLinkElement[] = [];
  /** True once the React portrait has connected containerEl to the document. */
  private isMounted = false;
  /** Idle playback requested by initialize before the container was mounted. */
  private pendingInitialPlayback = false;

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

  /**
   * Called by VideoAvatarPortrait after it attaches containerEl to React's DOM.
   * Video loading is deliberately deferred until this point: starting it while
   * detached produces inconsistent canplay/autoplay behaviour across browsers.
   */
  mount(): void {
    if (this.destroyed || this.isMounted) return;
    this.isMounted = true;
    if (this.pendingInitialPlayback) {
      this.pendingInitialPlayback = false;
      void this._play('idle', 'neutral');
    }
  }

  /** Mark the native container as detached without disposing the renderer. */
  unmount(): void {
    this.isMounted = false;
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
  private resolveEmotionFolder(avatarId: string, emotion: string, behavior: VideoBehavior): string {
    const avatarCache = this.availabilityCache[avatarId];
    if (!avatarCache) return emotion; // nothing probed yet — be optimistic

    const emotionCache = avatarCache[emotion];
    if (emotionCache !== undefined) {
      // This emotion has been probed at some point
      if (emotionCache[behavior] === true) return emotion;        // confirmed present
      if (emotionCache[behavior] === false) {
        // Confirmed absent — fall back to neutral if available
        if (avatarCache['neutral']?.[behavior] === true) return 'neutral';
        return 'neutral'; // last resort even if neutral probe hasn't confirmed it
      }
      // emotionCache[behavior] === undefined: not probed yet for this emotion
      // → optimistic: try emotion
    }
    // emotion not in cache at all, or behaviour not probed → optimistic
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
  private async _crossFadeTo(
    src: string,
    fallbackSrc?: string,
    sourceKind: 'explicit' | 'convention' = 'convention',
  ): Promise<void> {
    if (this.destroyed) return;

    const back = this.backVideo;
    let usedSrc = src;
    let usedFallback = false;

    // ── Attempt primary source ────────────────────────────────────────────
    let result = await this._loadVideo(back, src, CLIP_LOAD_TIMEOUT_MS);
    if (this.destroyed) return;

    // ── Fallback to neutral on error or timeout ───────────────────────────
    if (result !== 'ready' && fallbackSrc && fallbackSrc !== src) {
      if (result === 'error') this._markUnavailable(src);

      result = await this._loadVideo(back, fallbackSrc, CLIP_LOAD_TIMEOUT_MS);
      if (this.destroyed) return;
      usedSrc = fallbackSrc;
      usedFallback = true;
    }

    // ── Abort if nothing is playable — keep current front video visible ───
    if (result !== 'ready') {
      back.pause();
      back.removeAttribute('src');
      back.load();
      this.isVideoUnavailable = true;
      this.activeClipUrl = '';
      this.activeClipSource = 'none';
      console.warn('[VideoAvatar] Clip unavailable; showing the static portrait instead.', {
        src,
        fallbackSrc,
        result,
        state: this.currentState,
      });
      this.emit();
      return;
    }

    // ── Perform cross-fade ────────────────────────────────────────────────
    this.activeClipUrl = usedSrc;
    this.activeClipSource = usedFallback ? 'convention-fallback' : sourceKind;
    if (this.isVideoUnavailable) {
      this.isVideoUnavailable = false;
    }
    this.emit();
    back.play().catch(() => { /* autoplay may be blocked — silent fail */ });
    // Attach ping-pong loop to the newly active back buffer
    this._startPingPong(back);

    back.style.opacity = '1';
    this.frontVideo.style.opacity = '0';

    this.isTransitioning = true;
    this.emit();

    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    // Capture current front reference before the async timer fires
    const prevFront = this.frontVideo;
    this.fadeTimer = setTimeout(() => {
      if (this.destroyed) return;
      // Stop ping-pong on the now-hidden video before clearing it
      this._stopPingPong(prevFront);
      // Pause and clear the now-hidden video to save resources
      prevFront.pause();
      prevFront.removeAttribute('src');
      prevFront.load();
      // Swap buffers
      this.frontIsA = !this.frontIsA;
      this.isTransitioning = false;
      this.emit();
    }, CROSS_FADE_DURATION_MS + 50);
  }

  /**
   * Parse a video URL back to emotion/behaviour and mark it absent in the cache.
   * URL pattern: /avatars/{id}/{emotion}/{behavior}.mp4
   */
  private _markUnavailable(src: string): void {
    const match = src.match(/\/avatars\/([^/]+)\/([^/]+)\/([^/]+)\.mp4$/);
    if (!match) return;
    const [, avatarId, emotion, behavior] = match;
    if (!this.availabilityCache[avatarId]) this.availabilityCache[avatarId] = {};
    if (!this.availabilityCache[avatarId][emotion]) this.availabilityCache[avatarId][emotion] = {};
    this.availabilityCache[avatarId][emotion][behavior] = false;
  }

  /**
   * Start playing a behaviour × emotion combination.
   *
   * Priority:
   * 1. If persona.videos.clips has a behaviour+emotion entry → use it directly.
   * 2. Fall back to the convention-based avatarId/emotion/behavior.mp4 path.
   * Neutral is always the fallback for the convention path.
   */
  private async _play(state: AvatarState, emotionEn: string): Promise<void> {
    if (!this.persona || this.destroyed) return;

    const behavior = toVideoBehavior(state);

    // ── Explicit clips (persona-level video URLs) ──────────────────────────
    const clips = this.persona.videos?.clips;
    if (clips) {
      const rawUrl = resolveClipUrl(clips as Record<string, any>, state, emotionEn, this.persona.gender);
      if (rawUrl) {
        // Normalize storage-key style refs (e.g. "videos/avatar-xxx-listening-neutral.mp4")
        // to browser-playable URLs, using the same policy as other media assets.
        const explicitUrl = toMediaUrl(rawUrl) || rawUrl;
        await this._crossFadeTo(explicitUrl, undefined, 'explicit');
        return;
      }
    }

    // ── Convention-based path ──────────────────────────────────────────────
    const avatarId = this.persona.videos?.avatarId ?? this.persona.id;
    const bucket = toVideoEmotionBucket(emotionEn);
    const resolvedEmotion = this.resolveEmotionFolder(avatarId, bucket, behavior);
    const src = videoUrl(avatarId, resolvedEmotion, behavior);

    // Provide neutral as a fallback whenever we're trying a non-neutral clip
    const fallbackSrc = resolvedEmotion !== 'neutral'
      ? videoUrl(avatarId, 'neutral', behavior)
      : undefined;

    await this._crossFadeTo(src, fallbackSrc);
  }

  // ── Ping-pong methods ─────────────────────────────────────────────────────

  /**
   * Attach ping-pong looping to `videoEl`.
   *
   * Forward playback is left to the browser.  When the video reaches its end
   * (`ended` event) we switch to a reverse RAF loop that steps `currentTime`
   * backwards using real elapsed wall-clock time (ms → seconds).  When
   * `currentTime` reaches 0 we flip back to forward and call `play()` again.
   */
  private _startPingPong(videoEl: HTMLVideoElement): void {
    // Clean up any previous binding on this element first
    this._stopPingPong(videoEl);

    const state = {
      direction: 'forward' as 'forward' | 'reverse',
      rafId: null as number | null,
      lastTimestamp: 0,
      endedListener: null as (() => void) | null,
      isPaused: false,
      tick: null as ((now: number) => void) | null,
    };
    this.pingPongState.set(videoEl, state);

    const startReverse = () => {
      state.direction = 'reverse';
      state.lastTimestamp = 0; // reset; will be initialised on first RAF tick

      const tick = (now: number) => {
        // Check if this RAF loop is still the active one for this element,
        // and bail out if the renderer has been paused externally.
        const current = this.pingPongState.get(videoEl);
        if (!current || current.rafId === null || current.isPaused) return;

        if (state.lastTimestamp === 0) {
          // First tick — seed 16 ms before `now` so this tick immediately
          // applies one frame's worth of movement rather than freezing for
          // a full frame before reverse begins.
          state.lastTimestamp = now - 16;
        }

        const rawDeltaMs = now - state.lastTimestamp;
        state.lastTimestamp = now;

        // Clamp the delta to avoid large time jumps on slow devices or after
        // the tab has been backgrounded.  PING_PONG_MAX_DELTA_MS controls the
        // maximum step size and can be tuned at the top of this file.
        const deltaMs = Math.min(rawDeltaMs, PING_PONG_MAX_DELTA_MS);
        const deltaSeconds = deltaMs / 1000;
        const next = videoEl.currentTime - deltaSeconds;

        if (next <= 0) {
          // Reached the start — switch back to forward
          videoEl.currentTime = 0;
          state.direction = 'forward';
          state.rafId = null;
          state.tick = null;
          if (!state.isPaused) {
            // Re-attach ended listener for the next forward pass
            videoEl.addEventListener('ended', startReverse, { once: true });
            state.endedListener = startReverse;
            videoEl.play().catch(() => { /* autoplay policy — silent fail */ });
          } else {
            // Paused at the boundary — re-attach listener so resume() triggers
            // the next forward pass when the user unpauses.
            videoEl.addEventListener('ended', startReverse, { once: true });
            state.endedListener = startReverse;
          }
        } else {
          videoEl.currentTime = next;
          state.rafId = requestAnimationFrame(tick);
        }
      };

      // Store tick on state so resume() can reschedule it after a pause
      state.tick = tick;
      state.rafId = requestAnimationFrame(tick);
    };

    // Kick off: listen for the first `ended` event to begin reverse pass
    videoEl.addEventListener('ended', startReverse, { once: true });
    state.endedListener = startReverse;
  }

  /**
   * Cancel any active RAF loop and remove the `ended` listener for `videoEl`.
   * Safe to call even if ping-pong was never started on the element.
   */
  private _stopPingPong(videoEl: HTMLVideoElement): void {
    const state = this.pingPongState.get(videoEl);
    if (!state) return;

    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    if (state.endedListener) {
      videoEl.removeEventListener('ended', state.endedListener);
      state.endedListener = null;
    }
    this.pingPongState.delete(videoEl);
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
    this.isVideoUnavailable = false;
    this.activeClipUrl = '';
    this.activeClipSource = 'none';
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

    // The React portrait attaches containerEl after this initialization effect.
    // Start the normal optimistic load now (preserving the renderer contract),
    // then have mount() retry once the element is in the document.  That retry
    // covers browsers which do not reliably load a detached <video>.
    this.pendingInitialPlayback = true;
    void this._play('idle', 'neutral');
  }

  destroy(): void {
    this.destroyed = true;
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    // Stop ping-pong loops before clearing video elements
    [this.videoA, this.videoB].forEach(v => this._stopPingPong(v));
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
      // State changes can be received after a mounted renderer is temporarily
      // detached during a React update. Preserve the existing immediate
      // behaviour here; only initialize() defers its first idle load until mount.
      void this._play(state, emotionEn);
    }
  }

  setEmotion(emotion: string): void {
    const emotionEn = emotionToEnglish[emotion] ?? emotion;
    if (emotionEn === this.currentEmotionEn) return;

    this.currentEmotionEn = emotionEn;
    this.currentEmotion = emotionEn;
    this.overlayColor = emotionOverlayColors[emotionEn] ?? 'rgba(0, 0, 0, 0)';
    this.emit();

    void this._play(this.currentState, emotionEn);
  }

  async preloadAssets(): Promise<void> {
    if (!this.persona) return;

    // If explicit clips are provided, preload those and skip convention probing.
    const clips = this.persona.videos?.clips;
    if (clips) {
      const allUrls: string[] = [];
      for (const genderMap of Object.values(clips as Record<string, any>)) {
        if (genderMap && typeof genderMap === 'object') {
          allUrls.push(
            ...Object.values(genderMap as Partial<Record<string, string>>)
              .filter((v): v is string => typeof v === 'string' && !!v),
          );
        }
      }
      const probes = allUrls.map(rawSrc => {
        // Convert storage-key paths (e.g. "videos/avatar-cp-male-listening-neutral.mp4")
        // to browser-accessible URLs before probing and preloading.
        const url = toMediaUrl(rawSrc) || rawSrc;
        return this._probeVideo(url).then(available => {
          if (available) this._injectPreloadLink(url);
        });
      });
      await Promise.allSettled(probes);
      return;
    }

    const avatarId = this.persona.videos?.avatarId ?? this.persona.id;

    // Probe both behaviours for the current emotion bucket + neutral fallback.
    const emotionsToProbe = Array.from(
      new Set([toVideoEmotionBucket(this.currentEmotionEn), 'neutral']),
    );

    if (!this.availabilityCache[avatarId]) {
      this.availabilityCache[avatarId] = {};
    }
    const cache = this.availabilityCache[avatarId];

    const probes: Promise<void>[] = [];

    for (const emotion of emotionsToProbe) {
      if (!cache[emotion]) cache[emotion] = {};

      for (const behavior of VIDEO_BEHAVIORS) {
        if (cache[emotion][behavior] !== undefined) continue; // already probed

        const src = videoUrl(avatarId, emotion, behavior);
        const p = this._probeVideo(src).then(available => {
          cache[emotion][behavior] = available;
          if (available) this._injectPreloadLink(src);
        });
        probes.push(p);
      }
    }

    await Promise.allSettled(probes);
  }

  pause(): void {
    this.frontVideo.pause();
    // Also suspend the reverse RAF loop if it's running on the front video
    const ppState = this.pingPongState.get(this.frontVideo);
    if (ppState && ppState.direction === 'reverse') {
      ppState.isPaused = true;
      if (ppState.rafId !== null) {
        cancelAnimationFrame(ppState.rafId);
        ppState.rafId = null;
      }
      // Reset lastTimestamp so we don't get a huge delta on resume
      ppState.lastTimestamp = 0;
    }
  }

  resume(): void {
    const ppState = this.pingPongState.get(this.frontVideo);
    if (ppState && ppState.direction === 'reverse' && ppState.isPaused) {
      // Resume the reverse RAF loop
      ppState.isPaused = false;
      ppState.lastTimestamp = 0; // avoid big delta from pause gap
      if (ppState.tick) {
        ppState.rafId = requestAnimationFrame(ppState.tick);
      }
    } else {
      // Forward direction — resume native video playback
      this.frontVideo.play().catch(() => { /* autoplay policy */ });
    }
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
