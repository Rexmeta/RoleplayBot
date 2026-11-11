import type { CharacterEmotion } from '@shared/duplexMode';
import { normalizePresentationEmotion } from '@shared/emotionPresentation';

export function reduceCharacterEmotion(current: CharacterEmotion, proposed: CharacterEmotion): CharacterEmotion | null {
  if (proposed.personaGeneration !== current.personaGeneration ||
      proposed.cause.sequence <= current.cause.sequence) return null;
  const clamp = (n: number, fallback: number) => Number.isFinite(n) ? Math.max(0, Math.min(0.85, n)) : fallback;
  const confidence = clamp(proposed.confidence, 0);
  const nextIntensity = clamp(proposed.intensity, current.intensity);
  const nextEmotion = normalizePresentationEmotion(proposed.emotion);
  return {
    ...proposed,
    // Inertia is presentation/character state only; never write these values
    // back to the Simulation Engine or use them as evaluation adjustments.
    emotion: confidence < 0.35 ? current.emotion : nextEmotion,
    intensity: clamp(current.intensity * 0.65 + nextIntensity * 0.35, current.intensity),
    confidence, revision: current.revision + 1,
  };
}
