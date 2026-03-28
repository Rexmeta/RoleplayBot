import { toMediaUrl } from "@/lib/mediaUrl";
import { emotionToEnglish } from "@/hooks/chat/useEmotionState";

interface CharacterPortraitProps {
  loadedImageUrl: string;
  personaName: string;
  personaImage?: string;
  currentEmotion: string;
  isEmotionTransitioning: boolean;
  isSessionEnding: boolean;
}

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

export function CharacterPortrait({
  loadedImageUrl,
  personaName,
  personaImage,
  currentEmotion,
  isEmotionTransitioning,
  isSessionEnding,
}: CharacterPortraitProps) {
  const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(personaName)}&background=6366f1&color=fff&size=400`;
  const displayUrl = loadedImageUrl || toMediaUrl(personaImage || '') || fallbackUrl;
  const englishEmotion = emotionToEnglish[currentEmotion] || 'neutral';
  const overlayColor = emotionOverlayColors[englishEmotion] || 'rgba(0, 0, 0, 0)';

  const portraitOpacity = isSessionEnding ? 0 : isEmotionTransitioning ? 0.85 : 1;
  const portraitTransition = isSessionEnding ? 'opacity 700ms ease' : 'opacity 150ms ease';

  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${displayUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 15%',
          opacity: portraitOpacity,
          transition: portraitTransition,
        }}
        data-testid="character-portrait"
      />
      <div
        className="absolute inset-0 pointer-events-none z-[11]"
        style={{ backgroundColor: overlayColor, transition: 'background-color 300ms ease' }}
      />
    </>
  );
}
