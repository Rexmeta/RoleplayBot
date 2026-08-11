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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AvatarState } from '@/lib/avatar/types';
import { toVideoClipSlot, type VideoAvatarRenderer } from '@/lib/avatar/VideoAvatarRenderer';
import { toMediaUrl } from '@/lib/mediaUrl';

/** Development-only diagnostics: never rendered in a production build. */
const IS_DEV = import.meta.env.DEV;

interface DebugGeometry {
  boxWidth: number;
  boxHeight: number;
  boxTop: number;
  videoWidth: number;
  videoHeight: number;
}

interface VideoAvatarPortraitProps {
  /** The VideoAvatarRenderer instance managing the video elements */
  renderer: VideoAvatarRenderer;
  overlayColor: string;
  isTransitioning: boolean;
  isSessionEnding: boolean;
  isTextMode?: boolean;
  /** Avatar state from useAvatarStateMachine — forwarded to renderer */
  avatarState?: AvatarState;
  /** Stable first-paint fallback, available before renderer initialization runs */
  fallbackImageUrl?: string;
}

export function VideoAvatarPortrait({
  renderer,
  overlayColor,
  isTransitioning: _isTransitioning,
  isSessionEnding,
  isTextMode = false,
  avatarState,
  fallbackImageUrl,
}: VideoAvatarPortraitProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [geometry, setGeometry] = useState<DebugGeometry | null>(null);

  // Mount the renderer's native container element into the React-managed div
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const container = renderer.containerEl;
    wrapper.appendChild(container);
    renderer.mount();

    return () => {
      renderer.unmount();
      if (container.parentNode === wrapper) {
        wrapper.removeChild(container);
      }
    };
  }, [renderer]);

  // Measure the mounted portrait box so the debug overlay can reveal layout
  // problems (e.g. the video area pushed below the top of the panel) that are
  // impossible to tell apart from a badly framed clip by eye.
  useEffect(() => {
    if (!IS_DEV) return;
    const measure = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const video = renderer.containerEl.querySelector<HTMLVideoElement>('video[style*="opacity: 1"]')
        ?? renderer.containerEl.querySelector('video');
      setGeometry({
        boxWidth: Math.round(rect.width),
        boxHeight: Math.round(rect.height),
        boxTop: Math.round(rect.top),
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
      });
    };
    measure();
    const timer = window.setInterval(measure, 1000);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [renderer, avatarState]);

  const portraitOpacity = isSessionEnding ? 0 : 1;
  const portraitTransition = isSessionEnding ? 'opacity 700ms ease' : undefined;

  const backgroundImageUrl = renderer.displayImageUrl || toMediaUrl(fallbackImageUrl);
  const isVideoUnavailable = renderer.isVideoUnavailable;

  return (
    <>
      {/* Static image fallback — visible behind the video when clips haven't loaded */}
      {backgroundImageUrl && (
        <div
          className="absolute inset-0"
          data-avatar-static-bg=""
          style={{
            backgroundImage: `url(${backgroundImageUrl})`,
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

      {/* A successful static image remains visible if the active clip cannot play. */}
      {isVideoUnavailable && (
        <div
          className="absolute left-1/2 bottom-3 z-[12] -translate-x-1/2 rounded-full bg-black/65 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
          role="status"
          aria-live="polite"
          data-testid="video-avatar-fallback-notice"
        >
          영상 재생을 일시적으로 사용할 수 없습니다
        </div>
      )}

      {/* Development-only playback diagnostics — stripped from production builds */}
      {IS_DEV && (
        <div
          className="absolute left-2 top-16 z-[30] max-w-[80%] rounded-md bg-black/70 px-2 py-1 font-mono text-[10px] leading-tight text-emerald-300 pointer-events-none"
          data-testid="video-avatar-debug"
        >
          <div>
            slot:{toVideoClipSlot(avatarState ?? 'idle', renderer.currentEmotion)} · {renderer.activeClipSource}
          </div>
          <div className="truncate text-white/70">
            {renderer.activeClipUrl
              ? decodeURIComponent(renderer.activeClipUrl).split('/').pop()
              : '(no clip)'}
          </div>
          {geometry && (
            <div className="text-white/50">
              box {geometry.boxWidth}×{geometry.boxHeight} @top {geometry.boxTop} · src{' '}
              {geometry.videoWidth}×{geometry.videoHeight}
            </div>
          )}
        </div>
      )}

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
