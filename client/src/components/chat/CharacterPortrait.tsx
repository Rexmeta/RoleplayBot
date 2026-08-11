import type { AvatarState } from "@/lib/avatar/types";

interface CharacterPortraitProps {
  displayImageUrl: string;
  overlayColor: string;
  isTransitioning: boolean;
  isSessionEnding: boolean;
  isTextMode?: boolean;
  /** Avatar state from useAvatarStateMachine — used for future renderer integration */
  avatarState?: AvatarState;
}

export function CharacterPortrait({
  displayImageUrl,
  overlayColor,
  isTransitioning,
  isSessionEnding,
  isTextMode = false,
  avatarState: _avatarState,  // reserved for future renderer use
}: CharacterPortraitProps) {
  const portraitOpacity = isSessionEnding ? 0 : isTransitioning ? 0.85 : 1;
  const portraitTransition = isSessionEnding ? 'opacity 700ms ease' : 'opacity 150ms ease';

  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${displayImageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 15%',
          opacity: portraitOpacity,
          transition: portraitTransition,
          filter: isTextMode ? 'blur(2px)' : undefined,
        }}
        data-testid="character-portrait"
      />
      <div
        className="absolute inset-0 pointer-events-none z-[11]"
        style={{ backgroundColor: overlayColor, transition: 'background-color 300ms ease' }}
      />
      {isTextMode && (
        <div className="absolute inset-0 pointer-events-none z-[12] bg-black/55" />
      )}
    </>
  );
}
