import { VoiceOutputTrace } from '@shared/voiceOutputDiagnostic';

let armed = false;
let lastTrace: VoiceOutputTrace | undefined;
/** Explicit opt-in, consumed by exactly one websocket lifetime; reconnects are not armed. */
export const voiceOutputDiagnostic = {
  armNextSession() { lastTrace?.stop(); armed = true; },
  stop() { armed = false; lastTrace?.stop(); },
  snapshot() { return lastTrace?.snapshot() ?? null; },
};
export function takeVoiceOutputTrace(): VoiceOutputTrace | undefined {
  if (!armed) return undefined;
  armed = false;
  lastTrace = new VoiceOutputTrace();
  return lastTrace;
}
// No storage, timers, console logging, uploads or audio recording.
if (typeof window !== 'undefined') {
  Object.assign(window, { voiceOutputDiagnostic });
}