// Offline only: no URL, token, credential, or real-provider mode is accepted.
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const allowed = new Set(['steps', 'burst', 'reconnect', 'soak', 'all']);
let scenario = 'all';
let duration = 250;
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--scenario') scenario = args[i + 1];
  else if (args[i] === '--duration-ms') duration = Number(args[i + 1]);
  else throw new Error('Usage: node scripts/diagnostics/voice-load.mjs [--scenario steps|burst|reconnect|soak|all] [--duration-ms 250..7200000]');
}
if (!allowed.has(scenario) || !Number.isInteger(duration) || duration < 250 || duration > 7_200_000) {
  throw new Error('Invalid scenario/duration; this tool never connects to a deployed service.');
}
const result = spawnSync(process.execPath, [
  'node_modules/vitest/vitest.mjs', 'run', 'tests/diagnostics/voiceConcurrency.test.ts',
  'tests/client/useAudioPlayback.test.ts', 'tests/client/useRealtimeVoiceVadSensitivity.test.ts',
  '--maxWorkers=1', '--testTimeout', String(duration * 8 + 120_000),
], {
  stdio: 'inherit',
  env: { ...process.env, VOICE_DIAGNOSTIC_SCENARIO: scenario,
    VOICE_DIAGNOSTIC_DURATION_MS: String(duration), VOICE_DIAGNOSTIC_WRITE: '1' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);