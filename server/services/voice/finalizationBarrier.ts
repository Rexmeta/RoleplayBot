export const FINALIZATION_TIMEOUT_MS = 10_000;
export interface FinalizationBarrierResult {
  startedAt: number;
  deadlineAt: number;
  timeoutMs: number;
  outcome: 'settled' | 'timeout' | 'connection_lost';
}

/** The first close request owns the deadline; repeated requests cannot extend it. */
export async function waitForVoiceFinalization(
  ready: () => Promise<boolean>,
  disconnected: () => boolean,
  timeoutMs = FINALIZATION_TIMEOUT_MS,
): Promise<FinalizationBarrierResult> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  return new Promise<FinalizationBarrierResult>(resolve => {
    const finish = (outcome: FinalizationBarrierResult['outcome']) => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      if (poll) clearTimeout(poll);
      resolve({ startedAt, deadlineAt, timeoutMs, outcome });
    };
    // Independent deadline: a hung storage/provider promise cannot hang close.
    timer = setTimeout(() => finish('timeout'), timeoutMs);
    const check = async () => {
      if (stopped) return;
      if (disconnected()) { finish('connection_lost'); return; }
      try {
        if (await ready()) { finish('settled'); return; }
      } catch { finish('connection_lost'); return; }
      if (!stopped) poll = setTimeout(check, 20);
    };
    void check();
  });
}
