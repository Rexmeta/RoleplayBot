/** Labelled synthetic envelopes, not recordings or real-device evidence. */
export const duplexVadCases = [
  { id: 'valid-short', label: 'valid', durationMs: 800 },
  { id: 'valid-long', label: 'valid', durationMs: 1000 },
  { id: 'ack-short', label: 'acknowledgement', durationMs: 150 },
  { id: 'ack-long', label: 'acknowledgement', durationMs: 250 },
  { id: 'noise-short', label: 'noise', durationMs: 50 },
  { id: 'noise-long', label: 'noise', durationMs: 100 },
  { id: 'echo-medium', label: 'echo', durationMs: 450 },
  { id: 'echo-long', label: 'echo', durationMs: 650 },
] as const;
