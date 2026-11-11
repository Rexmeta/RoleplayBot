import { z } from 'zod';

export const duplexConfigSchema = z.object({
  interaction: z.boolean(),
  playbackLifecycle: z.boolean(),
  characterEmotion: z.boolean(),
  expressionSync: z.boolean(),
  evaluationSnapshot: z.boolean(),
  silentReactions: z.boolean(),
  bargeInPolicy: z.enum(['baseline', 'candidate', 'confirmed']),
  voiceBackchannel: z.boolean(),
}).strict().superRefine((config, ctx) => {
  const require = (feature: boolean, prerequisite: boolean, name: string) => {
    if (feature && !prerequisite) ctx.addIssue({ code: 'custom', message: name });
  };
  require(config.playbackLifecycle, config.interaction, 'playback_requires_interaction');
  require(config.characterEmotion, config.interaction, 'character_requires_interaction');
  require(config.expressionSync, config.characterEmotion && config.playbackLifecycle, 'expression_requires_character_and_playback');
  require(config.evaluationSnapshot, config.interaction && config.playbackLifecycle, 'evaluation_requires_interaction_and_playback');
  require(config.silentReactions, config.interaction, 'reactions_require_interaction');
  require(config.bargeInPolicy !== 'baseline', config.playbackLifecycle, 'barge_in_policy_requires_playback');
  // Neither configured provider has a verified application-level spoken
  // backchannel primitive. Never substitute an extra session or paid TTS.
  if (config.voiceBackchannel) ctx.addIssue({ code: 'custom', message: 'voice_backchannel_not_verified' });
});
export type DuplexConfig = z.infer<typeof duplexConfigSchema>;
export const BASELINE_DUPLEX_CONFIG: Readonly<DuplexConfig> = Object.freeze({
  interaction: false, playbackLifecycle: false, characterEmotion: false,
  expressionSync: false, evaluationSnapshot: false, silentReactions: false,
  bargeInPolicy: 'baseline', voiceBackchannel: false,
});

export interface CharacterEmotion {
  emotion: string;
  intensity: number;
  confidence: number;
  source: 'initial' | 'character_response_analysis' | 'simulation';
  revision: number;
  personaGeneration: number;
  cause: {
    kind: 'initial' | 'output' | 'scenario';
    id: string;
    sequence: number;
    userTurnId?: string;
    outputGeneration?: number;
    providerConnectionGeneration?: number;
    scenarioVersion?: number;
  };
}

export interface DuplexRuntime {
  version: 1;
  config: DuplexConfig;
  /** Server-owned connection epoch, persists through browser reconnections. */
  epoch: number;
  personaId: string;
  personaIndex: number;
  personaGeneration: number;
  character: CharacterEmotion;
  lastScenarioVersion?: number;
  finalization?: {
    startedAt: number; deadlineAt: number; timeoutMs: number;
    outcome: 'settled' | 'timeout' | 'connection_lost';
    watermark: number; snapshotId: string;
  };
}

export function initialCharacterEmotion(personaGeneration = 0): CharacterEmotion {
  return {
    emotion: 'neutral', intensity: 0.2, confidence: 1, source: 'initial',
    revision: 0, personaGeneration,
    cause: { kind: 'initial', id: 'initial', sequence: 0 },
  };
}
