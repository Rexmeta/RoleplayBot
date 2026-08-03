/**
 * AvatarRenderer — core interface for all avatar rendering strategies.
 *
 * Implementations: ImageAvatarRenderer (default), VideoAvatarRenderer (upcoming).
 * The factory `AvatarRendererFactory` selects the implementation at runtime via
 * the `VITE_AVATAR_RENDERER` environment variable.
 */

import type { AvatarState } from './types';

// ── Persona descriptor passed to initialize() ────────────────────────────────

export interface AvatarPersonaInfo {
  id: string;
  mbti?: string;
  gender?: string;
  name: string;
  /** Base avatar image URL (used as a fallback) */
  image?: string;
  /** Emotion-keyed expression URLs returned by the API (optional) */
  expressions?: Record<string, string>;
}

// ── Renderer interface ────────────────────────────────────────────────────────

export interface AvatarRenderer {
  /**
   * Attach this renderer to a persona + conversation.
   * Triggers asset discovery / preloading and calls `onReady` when the first
   * image is ready to display.
   */
  initialize(
    persona: AvatarPersonaInfo,
    conversationId: string,
    onReady?: () => void,
  ): void;

  /** Release all resources and cancel pending async work. */
  destroy(): void;

  /**
   * Drive the avatar to a new state (idle / speaking / thinking …) with an
   * optional emotion override.  Both arguments are taken from the avatar state
   * machine; renderers that do not distinguish machine states may ignore
   * `state` and focus on `emotion`.
   */
  playState(state: AvatarState, emotion?: string): void;

  /** Change only the emotional expression without altering the machine state. */
  setEmotion(emotion: string): void;

  /**
   * Pre-fetch all expression assets in the background.
   * Resolves when every discoverable asset has been attempted (success or failure).
   */
  preloadAssets(): Promise<void>;

  /** Pause any ongoing animation / video playback. */
  pause(): void;

  /** Resume after a pause. */
  resume(): void;

  // ── Observable render state ─────────────────────────────────────────────

  /** URL that should be shown in the portrait right now. */
  readonly displayImageUrl: string;

  /** CSS `rgba(…)` colour for the emotion overlay div. */
  readonly overlayColor: string;

  /** True while an emotion-transition cross-fade is in progress. */
  readonly isTransitioning: boolean;

  /** True until the very first usable image has been loaded. */
  readonly isInitialLoading: boolean;

  /** True during the fade-out transition of the initial loading overlay. */
  readonly isOverlayFading: boolean;

  /** Current emotion key (English canonical, e.g. "happy"). */
  readonly currentEmotion: string;

  // ── State-change subscription ───────────────────────────────────────────

  /**
   * Register a callback that fires whenever any observable property changes.
   * Returns an unsubscribe function; call it in `useEffect` cleanup.
   */
  subscribe(callback: () => void): () => void;
}
