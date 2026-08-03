/**
 * VideoAvatarPortrait
 *
 * Renders the video double-buffer container managed by VideoAvatarRenderer.
 * Maintains the same external Props interface as CharacterPortrait so that
 * the two components can be swapped without changes to the parent.
 *
 * The renderer owns the actual <video> DOM elements; this component mounts
 * the renderer's container div into the React tree via a callback ref.
 *
 * A static `displayImageUrl` is rendered as a background layer so the
 * portrait is never blank if both video buffers fail to load.
 */

import { useEffect, useRef } from 'react';
import type { AvatarState } from '@/lib/avatar/types';
import type { VideoAvatarRenderer } from '@/lib/avatar/VideoAvatarRenderer';

interface VideoAvatarPortraitProps {
  /** The VideoAvatarRenderer instance managing the video elements */
  renderer: VideoAvatarRenderer;
  overlayColor: string;
  isTransitioning: boolean;
  isSessionEnding: boolean;
  isTextMode?: boolean;
  /** Avatar state from useAvatarStateMachine — forwarded to renderer */
  avatarState?: AvatarState;
}

export function VideoAvatarPortrait({
  renderer,
  overlayColor,
  isTransitioning: _isTransitioning,
  isSessionEnding,
  isTextMode = false,
  avatarState: _avatarState,
}: VideoAvatarPortraitProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Mount the renderer's native container element into the React-managed div
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const container = renderer.containerEl;
    wrapper.appendChild(container);

    return () => {
      if (container.parentNode === wrapper) {
        wrapper.removeChild(container);
      }
    };
  }, [renderer]);

  const portraitOpacity = isSessionEnding ? 0 : 1;
  const portraitTransition = isSessionEnding ? 'opacity 700ms ease' : undefined;

  return (
    <>
      {/* Static image fallback — visible behind the video when clips haven't loaded */}
      {renderer.displayImageUrl && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${renderer.displayImageUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center 15%',
            opacity: portraitOpacity,
            transition: portraitTransition,
          }}
        />
      )}

      {/* Video double-buffer container */}
      <div
        ref={wrapperRef}
        className="absolute inset-0"
        style={{
          opacity: portraitOpacity,
          transition: portraitTransition,
          filter: isTextMode ? 'blur(2px)' : undefined,
        }}
        data-testid="character-portrait"
      />

      {/* Emotion overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-[11]"
        style={{ backgroundColor: overlayColor, transition: 'background-color 300ms ease' }}
      />

      {/* Text-mode dark veil */}
      {isTextMode && (
        <div className="absolute inset-0 pointer-events-none z-[12] bg-black/55" />
      )}
    </>
  );
}
