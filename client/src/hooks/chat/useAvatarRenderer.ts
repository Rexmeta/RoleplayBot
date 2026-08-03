/**
 * useAvatarRenderer
 *
 * React lifecycle wrapper around an AvatarRenderer instance.
 * Creates the renderer via AvatarRendererFactory, initialises it when
 * persona / conversationId changes, and re-renders React whenever the
 * renderer emits a state-change notification.
 *
 * Returns:
 *  - displayImageUrl / overlayColor / isTransitioning  → feed directly into CharacterPortrait
 *  - isInitialLoading / isOverlayFading                → chat loading overlay
 *  - currentEmotion / getCharacterImage                → MessageList, header thumbnail
 *  - hasNoPersonaImages                                → "no images" notice
 *  - setEmotion                                        → call from message handlers
 *  - playState                                         → drive avatar state machine changes
 *  - renderer                                          → raw instance (VideoAvatarPortrait needs it)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createAvatarRenderer } from '@/lib/avatar/AvatarRendererFactory';
import { ImageAvatarRenderer } from '@/lib/avatar/ImageAvatarRenderer';
import type { AvatarRenderer } from '@/lib/avatar/AvatarRenderer';
import type { AvatarState } from '@/lib/avatar/types';

interface PersonaInfo {
  id: string;
  mbti?: string;
  gender?: string;
  name: string;
  image?: string;
  expressions?: Record<string, string>;
}

interface UseAvatarRendererOptions {
  persona: PersonaInfo;
  conversationId: string;
  onReady?: () => void;
}

export interface UseAvatarRendererResult {
  /** Current image URL to display in the portrait */
  displayImageUrl: string;
  /** CSS rgba() overlay colour reflecting the current emotion */
  overlayColor: string;
  /** True while an emotion cross-fade is in progress */
  isTransitioning: boolean;
  /** True until the very first usable image has loaded */
  isInitialLoading: boolean;
  /** True during the fade-out of the loading overlay */
  isOverlayFading: boolean;
  /** Raw emotion string as received from the AI (Korean or English) */
  currentEmotion: string;
  /** True when the persona has no expression images at all */
  hasNoPersonaImages: boolean;
  /** Look up the best image URL for any emotion key */
  getCharacterImage: (emotion: string) => string | null;
  /** Drive an emotion change (handles preload & overlay colour) */
  setEmotion: (emotion: string) => void;
  /** Drive a combined state + optional emotion change */
  playState: (state: AvatarState, emotion?: string) => void;
  /** Raw renderer instance — needed by VideoAvatarPortrait to mount containerEl */
  renderer: AvatarRenderer;
}

export function useAvatarRenderer({
  persona,
  conversationId,
  onReady,
}: UseAvatarRendererOptions): UseAvatarRendererResult {
  // `rendererInstance` is state so that a type swap (image → video) causes
  // the persona effect to re-run and re-initialize the new renderer.
  const [rendererInstance, setRendererInstance] = useState<AvatarRenderer>(
    () => new ImageAvatarRenderer(),
  );

  // Ref mirrors state for stable access in effects without stale closures.
  const rendererRef = useRef<AvatarRenderer>(rendererInstance);

  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // Force re-render when the renderer emits a change notification.
  const [, forceUpdate] = useState(0);

  // ── Step 1: Resolve the correct renderer type once on mount ────────────────
  // If VITE_AVATAR_RENDERER=image (the default) the factory returns
  // ImageAvatarRenderer which is the same type as the placeholder, so no swap
  // happens.  For "video" the dynamic import resolves and we swap in place.
  useEffect(() => {
    let cancelled = false;

    createAvatarRenderer().then(resolved => {
      if (cancelled) {
        resolved.destroy();
        return;
      }
      const current = rendererRef.current;
      if (resolved.constructor !== current.constructor) {
        // Different type — destroy placeholder, install the real renderer.
        current.destroy();
        rendererRef.current = resolved;
        setRendererInstance(resolved); // triggers persona effect below
      } else {
        // Same type — keep the existing instance; discard the duplicate.
        resolved.destroy();
      }
    });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 2: Initialize + subscribe on every relevant change ───────────────
  // Depends on `rendererInstance` so it automatically re-runs after a swap.
  useEffect(() => {
    const renderer = rendererInstance;
    renderer.initialize(
      {
        id: persona.id,
        mbti: persona.mbti,
        gender: persona.gender,
        name: persona.name,
        image: persona.image,
        expressions: persona.expressions,
      },
      conversationId,
      () => onReadyRef.current?.(),
    );

    const unsubscribe = renderer.subscribe(() => forceUpdate(n => n + 1));
    return unsubscribe; // React calls this on cleanup (dep change or unmount)
  }, [rendererInstance, persona.id, persona.name, persona.mbti, persona.gender, persona.expressions, conversationId]);

  // ── Step 3: Destroy on unmount ─────────────────────────────────────────────
  // Uses ref so it always reaches the most-recent renderer instance.
  useEffect(() => {
    return () => { rendererRef.current?.destroy(); };
  }, []);

  // ── Stable callbacks ───────────────────────────────────────────────────────

  const setEmotion = useCallback((emotion: string) => {
    rendererRef.current?.setEmotion(emotion);
  }, []);

  const playState = useCallback((state: AvatarState, emotion?: string) => {
    rendererRef.current?.playState(state, emotion);
  }, []);

  const getCharacterImage = useCallback((emotion: string): string | null => {
    const r = rendererRef.current as ImageAvatarRenderer | null;
    return r?.getCharacterImage?.(emotion) ?? null;
  }, []);

  return {
    displayImageUrl: rendererInstance.displayImageUrl,
    overlayColor: rendererInstance.overlayColor,
    isTransitioning: rendererInstance.isTransitioning,
    isInitialLoading: rendererInstance.isInitialLoading,
    isOverlayFading: rendererInstance.isOverlayFading,
    currentEmotion: rendererInstance.currentEmotion,
    hasNoPersonaImages: (rendererInstance as ImageAvatarRenderer).hasNoPersonaImages ?? false,
    getCharacterImage,
    setEmotion,
    playState,
    renderer: rendererInstance,
  };
}
