/**
 * ImageAvatarRenderer
 *
 * Implements AvatarRenderer using static expression images.
 * Encapsulates all the asset-discovery, preload, fallback, and
 * overlay-colour logic that previously lived in useEmotionState.
 */

import type { AvatarState } from './types';
import type { AvatarRenderer, AvatarPersonaInfo } from './AvatarRenderer';
import { toMediaUrl } from '@/lib/mediaUrl';

// ── Emotion helpers (re-exported for callers that still need them) ──────────

export const emotionToEnglish: Record<string, string> = {
  '중립': 'neutral', '기쁨': 'happy', '슬픔': 'sad', '분노': 'angry', '놀람': 'surprised',
  '호기심': 'curious', '불안': 'anxious', '피로': 'tired', '실망': 'disappointed', '당혹': 'confused',
  '단호': 'determined',
  'neutral': 'neutral', 'happy': 'happy', 'sad': 'sad', 'angry': 'angry', 'surprised': 'surprised',
  'curious': 'curious', 'anxious': 'anxious', 'tired': 'tired', 'disappointed': 'disappointed',
  'confused': 'confused', 'determined': 'determined',
  '中立': 'neutral', '喜悦': 'happy', '悲伤': 'sad', '愤怒': 'angry', '惊讶': 'surprised',
  '好奇': 'curious', '焦虑': 'anxious', '疲劳': 'tired', '失望': 'disappointed', '困惑': 'confused',
  '喜び': 'happy', '悲しみ': 'sad', '怒り': 'angry', '驚き': 'surprised',
  '好奇心': 'curious', '不安': 'anxious',
};

const UNIQUE_EMOTION_ENS = Array.from(new Set(Object.values(emotionToEnglish)));
const UNIQUE_EMOTION_COUNT = UNIQUE_EMOTION_ENS.length;

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

// ── ImageAvatarRenderer ────────────────────────────────────────────────────

export class ImageAvatarRenderer implements AvatarRenderer {
  // ── Observable state (read by the hook) ──────────────────────────────────
  displayImageUrl = '';
  overlayColor = 'rgba(0, 0, 0, 0)';
  isTransitioning = false;
  isInitialLoading = true;
  isOverlayFading = false;
  currentEmotion = '중립';

  // ── Internal ─────────────────────────────────────────────────────────────
  private persona: AvatarPersonaInfo | null = null;
  private personaImagesAvailable: Record<string, boolean> = {};
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private initialLoadCompleted = false;
  private destroyed = false;
  private onReadyCb?: () => void;
  private listeners = new Set<() => void>();
  private initGeneration = 0; // guard against stale async callbacks
  private expressionGeneration = 0;
  private expressionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Diagnostic status; does not imply that an expression asset was displayed. */
  expressionAssetStatus: 'ready' | 'loading' | 'fallback' | 'unavailable' = 'ready';

  private cancelExpression(): void {
    this.expressionGeneration++;
    if (this.expressionTimer) clearTimeout(this.expressionTimer);
    this.expressionTimer = null;
    this.isTransitioning = false;
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(): void {
    this.listeners.forEach(cb => cb());
  }

  // ── Public helpers ───────────────────────────────────────────────────────

  get hasNoPersonaImages(): boolean {
    return (
      Object.keys(this.personaImagesAvailable).length === UNIQUE_EMOTION_COUNT &&
      Object.values(this.personaImagesAvailable).every(v => v === false)
    );
  }

  /** Return the URL for a given emotion, respecting the current persona type. */
  getCharacterImage(emotion: string): string | null {
    const p = this.persona;
    if (!p) return null;

    const emotionEn = emotionToEnglish[emotion] || 'neutral';

    // 1. expressions prop (API-provided)
    if (p.expressions) {
      const url = p.expressions[emotionEn];
      if (url) return toMediaUrl(url);
      const neutralUrl = p.expressions['neutral'];
      if (neutralUrl) return toMediaUrl(neutralUrl);
      if (p.image) return p.image;
      return null;
    }

    const isUserPersona = !p.mbti && !!p.id;

    // 2. User persona — HTTP-checked availability
    if (isUserPersona) {
      if (this.personaImagesAvailable[emotionEn]) {
        return toMediaUrl(`user-personas/${p.id}/${emotionEn}.webp`);
      }
      if (this.personaImagesAvailable['neutral']) {
        return toMediaUrl(`user-personas/${p.id}/neutral.webp`);
      }
      if (p.image) return p.image;
      return null;
    }

    // 3. MBTI persona — HTTP-checked availability
    const genderFolder = p.gender || 'male';
    const mbtiId = p.mbti?.toLowerCase() || p.id;
    if (this.personaImagesAvailable[emotionEn]) {
      return toMediaUrl(`personas/${mbtiId}/${genderFolder}/${emotionEn}.webp`);
    }
    if (this.personaImagesAvailable['neutral']) {
      return toMediaUrl(`personas/${mbtiId}/${genderFolder}/neutral.webp`);
    }
    return null;
  }

  // ── AvatarRenderer interface ─────────────────────────────────────────────

  initialize(
    persona: AvatarPersonaInfo,
    _conversationId: string,
    onReady?: () => void,
  ): void {
    // Cancel any previous in-flight initialization
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.initGeneration++;
    this.cancelExpression();
    const generation = this.initGeneration;

    this.destroyed = false;
    this.persona = persona;
    this.onReadyCb = onReady;
    this.initialLoadCompleted = false;
    this.isInitialLoading = true;
    this.isOverlayFading = false;
    this.personaImagesAvailable = {};
    this.currentEmotion = '중립';
    this.overlayColor = 'rgba(0, 0, 0, 0)';

    // Show base image immediately to avoid a blank gap while expressions load
    const immediateBase = persona.image
      ? (toMediaUrl(persona.image) || persona.image)
      : '';
    this.displayImageUrl = immediateBase;
    this.emit();

    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=400`;

    const guard = () => !this.destroyed && this.initGeneration === generation;

    const completeFallback = () => {
      if (!guard() || this.initialLoadCompleted) return;
      this.initialLoadCompleted = true;
      this.displayImageUrl = fallbackUrl;
      this.isOverlayFading = true;
      this.onReadyCb?.();
      this.emit();
      setTimeout(() => {
        if (!guard()) return;
        this.isInitialLoading = false;
        this.emit();
      }, 500);
    };

    const completeWithImage = (url: string) => {
      if (!guard() || this.initialLoadCompleted) return;
      this.initialLoadCompleted = true;
      this.displayImageUrl = url;
      this.isOverlayFading = true;
      this.onReadyCb?.();
      this.emit();
      setTimeout(() => {
        if (!guard()) return;
        this.isInitialLoading = false;
        this.emit();
      }, 500);
    };

    this.fallbackTimer = setTimeout(completeFallback, 3000);
    // Capture this initialization's timer. A stale image callback must never
    // clear the fallback timer belonging to a subsequently selected persona.
    const fallbackTimer = this.fallbackTimer;

    if (persona.expressions) {
      // Case 1 — expressions provided by API
      const availability: Record<string, boolean> = {};
      for (const emotionEn of UNIQUE_EMOTION_ENS) {
        availability[emotionEn] = !!(persona.expressions[emotionEn]);
      }
      this.personaImagesAvailable = availability;
      this.emit();

      const neutralUrl = persona.expressions['neutral'];
      if (neutralUrl) {
        const fullUrl = toMediaUrl(neutralUrl);
        const img = new Image();
        img.onload = () => { clearTimeout(fallbackTimer); completeWithImage(fullUrl); };
        img.onerror = () => { clearTimeout(fallbackTimer); completeFallback(); };
        img.src = fullUrl;
      } else {
        clearTimeout(fallbackTimer);
        completeFallback();
      }
    } else if (!persona.mbti && !!persona.id) {
      // Case 2 — user persona: check via HTTP
      const baseObjectPath = `user-personas/${persona.id}`;
      this._checkAvailabilityAndLoad(
        UNIQUE_EMOTION_ENS,
        (emotionEn) => toMediaUrl(`${baseObjectPath}/${emotionEn}.webp`),
        (availability) => {
          if (!guard()) return;
          this.personaImagesAvailable = availability;
          this.emit();
          // Retry any emotion set while probing was in progress
          this._reapplyCurrentEmotion();
          const neutralAvail = availability['neutral'];
          if (neutralAvail) {
            const imgUrl = toMediaUrl(`${baseObjectPath}/neutral.webp`);
            const img = new Image();
            img.onload = () => { clearTimeout(fallbackTimer); completeWithImage(imgUrl); };
            img.onerror = () => {
              if (persona.image) {
                const fb = new Image();
                fb.onload = () => { clearTimeout(fallbackTimer); completeWithImage(persona.image!); };
                fb.onerror = () => { clearTimeout(fallbackTimer); completeFallback(); };
                fb.src = persona.image;
              } else {
                clearTimeout(fallbackTimer);
                completeFallback();
              }
            };
            img.src = imgUrl;
          } else if (persona.image) {
            const img = new Image();
            img.onload = () => { clearTimeout(fallbackTimer); completeWithImage(persona.image!); };
            img.onerror = () => { clearTimeout(fallbackTimer); completeFallback(); };
            img.src = persona.image;
          } else {
            clearTimeout(fallbackTimer);
            completeFallback();
          }
        },
      );
    } else {
      // Case 3 — MBTI persona: check via HTTP
      const genderFolder = persona.gender || 'male';
      const mbtiId = persona.mbti?.toLowerCase() || persona.id;
      this._checkAvailabilityAndLoad(
        UNIQUE_EMOTION_ENS,
        (emotionEn) => toMediaUrl(`personas/${mbtiId}/${genderFolder}/${emotionEn}.webp`),
        (availability) => {
          if (!guard()) return;
          this.personaImagesAvailable = availability;
          this.emit();
          // Retry any emotion set while probing was in progress
          this._reapplyCurrentEmotion();
          const neutralAvail = availability['neutral'];
          if (neutralAvail) {
            const imgUrl = toMediaUrl(`personas/${mbtiId}/${genderFolder}/neutral.webp`);
            const img = new Image();
            img.onload = () => { clearTimeout(fallbackTimer); completeWithImage(imgUrl); };
            img.onerror = () => { clearTimeout(fallbackTimer); completeFallback(); };
            img.src = imgUrl;
          } else {
            clearTimeout(fallbackTimer);
            completeFallback();
          }
        },
      );
    }
  }

  /** Parallel HTTP-probe for all emotion images; calls onDone once all settle. */
  private _checkAvailabilityAndLoad(
    emotions: string[],
    urlFor: (emotionEn: string) => string,
    onDone: (availability: Record<string, boolean>) => void,
  ): void {
    let checkedCount = 0;
    const availability: Record<string, boolean> = {};
    const total = emotions.length;

    for (const emotionEn of emotions) {
      const img = new Image();
      img.onload = () => {
        availability[emotionEn] = true;
        if (++checkedCount === total) onDone(availability);
      };
      img.onerror = () => {
        availability[emotionEn] = false;
        if (++checkedCount === total) onDone(availability);
      };
      img.src = urlFor(emotionEn);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelExpression();
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    this.listeners.clear();
  }

  setEmotion(emotion: string): void {
    if (this.destroyed) return;
    this.cancelExpression();
    this.currentEmotion = emotion;
    const emotionEn = emotionToEnglish[emotion] || 'neutral';
    this.overlayColor = emotionOverlayColors[emotionEn] ?? 'rgba(0, 0, 0, 0)';
    this.isTransitioning = true;
    this.emit();

    const newUrl = this.getCharacterImage(emotion);
    if (newUrl) {
      this._preloadImage(newUrl);
    }
    // If no URL resolved yet (async availability probing still in progress),
    // keep isTransitioning=true.  _reapplyCurrentEmotion() will resolve it
    // once _checkAvailabilityAndLoad() completes.
  }

  /**
   * Re-apply the current emotion after personaImagesAvailable has been
   * populated (or updated).  Mirrors the useEmotionState effect that fired
   * on [currentEmotion, personaImagesAvailable] changes.
   */
  private _reapplyCurrentEmotion(): void {
    const url = this.getCharacterImage(this.currentEmotion);
    if (url) {
      this._preloadImage(url);
    } else if (this.isTransitioning) {
      // No expression image available for this emotion — clear the pending transition
      this.isTransitioning = false;
      this.emit();
    }
  }

  private _preloadImage(url: string): void {
    const initialization = this.initGeneration;
    const expression = ++this.expressionGeneration;
    const valid = () => !this.destroyed && initialization === this.initGeneration &&
      expression === this.expressionGeneration;
    this.expressionAssetStatus = 'loading';
    const img = new Image();
    img.onload = () => {
      if (!valid()) return;
      this.expressionTimer = setTimeout(() => {
        if (!valid()) return;
        this.expressionTimer = null;
        this.displayImageUrl = url;
        this.expressionAssetStatus = 'ready';
        this.isTransitioning = false;
        this.emit();
      }, 100);
    };
    img.onerror = () => {
      if (!valid()) return;
      const fallback = this.getCharacterImage('neutral');
      this.expressionAssetStatus = fallback && fallback !== url ? 'fallback' : 'unavailable';
      console.warn('[ImageAvatar] Expression asset unavailable', { generation: expression });
      if (fallback && fallback !== url) {
        // This is still the same expression request; a later request invalidates it.
        const neutral = new Image();
        neutral.onload = () => {
          if (!valid()) return;
          this.displayImageUrl = fallback;
          this.isTransitioning = false;
          this.emit();
        };
        neutral.onerror = () => {
          if (!valid()) return;
          this.expressionAssetStatus = 'unavailable';
          this.isTransitioning = false;
          this.emit();
        };
        neutral.src = fallback;
      }
      this.isTransitioning = false;
      this.emit();
    };
    img.src = url;
  }

  playState(state: AvatarState, emotion?: string): void {
    // A stopped output may not install its pending expression after listening
    // has resumed. This cancels presentation only, not server emotion state.
    if (state === 'listening' || state === 'idle') this.cancelExpression();
    if (emotion && emotion !== this.currentEmotion) this.setEmotion(emotion);
  }

  async preloadAssets(): Promise<void> {
    // Assets are probed during initialize(); this is a no-op for now
    return Promise.resolve();
  }

  pause(): void { /* no-op for static images */ }
  resume(): void { /* no-op for static images */ }
}
