/**
 * Avatar State Machine — types & constants
 *
 * AvatarState    : the renderable state of the avatar
 * AvatarEmotion  : the emotional expression the avatar should show
 * AvatarEvent    : events that drive state transitions
 */

// ── States ──────────────────────────────────────────────────────────────────

export type AvatarState =
  | 'idle'             // default / not actively doing anything
  | 'listening'        // user is speaking
  | 'listening_nod'    // user finished a short phrase; avatar gives a nod cue
  | 'thinking'         // LLM is processing (after user speech, before first TTS audio)
  | 'speaking'         // AI is producing TTS audio
  | 'speaking_pause';  // AI paused between sentences (0.3–1 s silence)

// ── Emotions ─────────────────────────────────────────────────────────────────

export type AvatarEmotion =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'curious'
  | 'anxious'
  | 'tired'
  | 'disappointed'
  | 'confused'
  | 'determined'
  | 'concerned'
  | 'excited';

// ── Events ───────────────────────────────────────────────────────────────────

export type AvatarEvent =
  | { type: 'UserSpeechStart' }
  | { type: 'UserSpeechEnd' }
  | { type: 'LLMThinkingStart' }
  | { type: 'LLMResponseStart' }
  | { type: 'TTSStart' }
  | { type: 'TTSPause' }
  | { type: 'TTSResume' }
  | { type: 'TTSEnd' }
  | { type: 'ConversationEnd' }
  | { type: 'EmotionChange'; emotion: AvatarEmotion };
