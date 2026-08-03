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
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createAvatarRenderer } from '@/lib/avatar/AvatarRendererFactory';
import type { AvatarRenderer } from '@/lib/avatar/AvatarRenderer';
import type { ImageAvatarRenderer } from '@/lib/avatar/ImageAvatarRenderer';

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
}

export function useAvatarRenderer({
  persona,
  conversationId,
  onReady,
}: UseAvatarRendererOptions): UseAvatarRendererResult {
  // Keep a stable renderer reference across renders
  const rendererRef = useRef<AvatarRenderer | null>(null);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Force re-render when the renderer emits a change
  const [, forceUpdate] = useState(0);

  // Create the renderer once
  if (!rendererRef.current) {
    rendererRef.current = createAvatarRenderer();
  }

  // (Re-)initialize whenever persona / conversationId changes
  useEffect(() => {
    const renderer = rendererRef.current!;
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
    return () => {
      unsubscribe();
    };
  }, [persona.id, persona.name, persona.mbti, persona.gender, persona.expressions, conversationId]);

  // Destroy on unmount
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
    };
  }, []);

  const renderer = rendererRef.current;

  const setEmotion = useCallback((emotion: string) => {
    rendererRef.current?.setEmotion(emotion);
  }, []);

  const getCharacterImage = useCallback((emotion: string): string | null => {
    const r = rendererRef.current as ImageAvatarRenderer | null;
    return r?.getCharacterImage?.(emotion) ?? null;
  }, []);

  return {
    displayImageUrl: renderer.displayImageUrl,
    overlayColor: renderer.overlayColor,
    isTransitioning: renderer.isTransitioning,
    isInitialLoading: renderer.isInitialLoading,
    isOverlayFading: renderer.isOverlayFading,
    currentEmotion: renderer.currentEmotion,
    hasNoPersonaImages: (renderer as ImageAvatarRenderer).hasNoPersonaImages ?? false,
    getCharacterImage,
    setEmotion,
  };
}
