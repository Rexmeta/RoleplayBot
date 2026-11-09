import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../storage/db';
import { storage } from '../../storage';
import { personaRuns } from '@shared/schema/conversations';
import { conversationLedgerRuns } from '@shared/schema/conversationLedger';
import {
  BASELINE_DUPLEX_CONFIG, duplexConfigSchema, initialCharacterEmotion,
  type CharacterEmotion, type DuplexRuntime,
} from '@shared/duplexMode';
import type { VoiceOutputIdentity } from '@shared/voiceInteraction';
import type { RealtimeSession } from './types';
import { reduceCharacterEmotion } from './characterEmotionPolicy';

/** Settings affect only an unpinned run, never a running/reconnected session. */
type Connection = Pick<typeof db, 'transaction'>;
export async function pinDuplexRuntime(
  session: RealtimeSession, connection: Connection = db,
  loadSettings: () => Promise<Array<{ key: string; value: string }>> =
    () => storage.getSystemSettingsByCategory('voice_duplex'),
): Promise<void> {
  const settings = await loadSettings();
  const setting = settings.find(row => row.key === 'config');
  const runtime = await connection.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${session.personaRunId}))`);
    const [run] = await tx.select({
      id: personaRuns.id, status: personaRuns.status,
      transcriptProtocol: personaRuns.transcriptProtocol, duplexRuntime: personaRuns.duplexRuntime,
    }).from(personaRuns).where(eq(personaRuns.id, session.personaRunId));
    if (!run || run.status !== 'active') throw new Error('duplex_active_run_required');
    const previous = run.duplexRuntime;
    // Parent runs can remain active while feedback is pending. The Ledger
    // closure/frozen input, not parent status, is the authority to reject a
    // new voice connection. This check shares the close transaction's lock.
    if (previous?.finalization) throw new Error('duplex_run_finalized');
    if (run.transcriptProtocol === 'ledger-v1') {
      const [ledger] = await tx.select({ status: conversationLedgerRuns.status })
        .from(conversationLedgerRuns)
        .where(eq(conversationLedgerRuns.personaRunId, session.personaRunId));
      if (ledger?.status === 'closed') throw new Error('duplex_ledger_closed');
    }
    const config = duplexConfigSchema.parse(run.duplexRuntime?.config ??
      (setting ? JSON.parse(setting.value) : BASELINE_DUPLEX_CONFIG));
    if (config.evaluationSnapshot && run.transcriptProtocol !== 'ledger-v1') {
      throw new Error('duplex_evaluation_requires_ledger');
    }
    const replaced = previous && (previous.personaId !== session.personaId || previous.personaIndex !== session.activePersonaIndex);
    const personaGeneration = (previous?.personaGeneration ?? 0) + (replaced ? 1 : 0);
    const next: DuplexRuntime = {
      version: 1, config, epoch: (previous?.epoch ?? 0) + 1,
      personaId: session.personaId, personaIndex: session.activePersonaIndex, personaGeneration,
      character: previous && !replaced ? previous.character : initialCharacterEmotion(personaGeneration),
      lastScenarioVersion: replaced ? undefined : previous?.lastScenarioVersion,
      finalization: previous?.finalization,
    };
    await tx.update(personaRuns).set({ duplexRuntime: next }).where(eq(personaRuns.id, run.id));
    return next;
  });
  session.duplexRuntime = runtime;
  session.characterCauseSequence = runtime.character.cause.sequence;
}

/** CAS under the same per-run lock used for transcript/evaluation publication. */
export async function acceptCharacterEmotion(
  session: RealtimeSession, origin: VoiceOutputIdentity | null, proposal: CharacterEmotion, connection: Connection = db,
): Promise<CharacterEmotion | null> {
  const bound = session.duplexRuntime;
  if (!bound?.config.characterEmotion) return null;
  if (origin && session.cancelledOutputKeys?.includes(
    `${origin.providerConnectionGeneration}:${origin.outputGeneration}`,
  )) return null;
  return connection.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${session.personaRunId}))`);
    const [run] = await tx.select({ runtime: personaRuns.duplexRuntime, status: personaRuns.status })
      .from(personaRuns).where(eq(personaRuns.id, session.personaRunId));
    const runtime = run?.runtime;
    if (!runtime || runtime.finalization || run.status !== 'active' || runtime.epoch !== bound.epoch ||
        runtime.personaId !== session.personaId || runtime.personaGeneration !== proposal.personaGeneration ||
        (origin && ((session.providerConnectionGeneration ?? 0) !== origin.providerConnectionGeneration ||
          session.personaId !== origin.personaId || session.cancelledOutputKeys?.includes(
            `${origin.providerConnectionGeneration}:${origin.outputGeneration}`,
          )))) return null;
    if (proposal.cause.kind === 'output' && origin && session.turnSeq - origin.outputGeneration > 256) return null;
    if (proposal.cause.kind === 'scenario' &&
        (proposal.cause.scenarioVersion ?? -1) <= (runtime.lastScenarioVersion ?? -1)) return null;
    const character = reduceCharacterEmotion(runtime.character, proposal);
    if (!character) return null;
    const next = { ...runtime, character, lastScenarioVersion: proposal.cause.scenarioVersion ?? runtime.lastScenarioVersion };
    await tx.update(personaRuns).set({ duplexRuntime: next }).where(and(
      eq(personaRuns.id, session.personaRunId), eq(personaRuns.status, 'active'),
    ));
    if (session.duplexRuntime?.epoch === next.epoch) session.duplexRuntime = next;
    return character;
  });
}

export async function resetCharacterPersona(session: RealtimeSession, connection: Connection = db): Promise<void> {
  const runtime = session.duplexRuntime;
  if (!runtime || (runtime.personaId === session.personaId && runtime.personaIndex === session.activePersonaIndex)) return;
  const personaGeneration = runtime.personaGeneration + 1;
  const next: DuplexRuntime = {
    ...runtime, personaId: session.personaId, personaIndex: session.activePersonaIndex, personaGeneration,
    character: initialCharacterEmotion(personaGeneration),
  };
  session.duplexRuntime = next;
  session.characterCauseSequence = 0;
  await connection.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${session.personaRunId}))`);
    const [row] = await tx.select({ runtime: personaRuns.duplexRuntime, status: personaRuns.status }).from(personaRuns)
      .where(eq(personaRuns.id, session.personaRunId));
    if (row?.runtime?.epoch !== runtime.epoch || row.runtime.finalization || row.status !== 'active') return;
    await tx.update(personaRuns).set({ duplexRuntime: next }).where(eq(personaRuns.id, session.personaRunId));
  });
}
