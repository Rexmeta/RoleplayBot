import { db, storage } from '../../storage';
import { voiceUtterances, personaRuns } from '@shared/schema';
import { and, eq, sql } from 'drizzle-orm';
import { candidateStatus, recognitionResolved, recognitionRevision, RecognitionPendingError } from './recognitionPolicy';

export async function listRecognitionEvidence(
  runId: string, connection: any = db,
): Promise<Array<typeof voiceUtterances.$inferSelect>> {
  return connection.select().from(voiceUtterances)
    .where(eq(voiceUtterances.personaRunId, runId));
}

export async function registerUtterance(values: typeof voiceUtterances.$inferInsert) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${values.personaRunId}))`);
    const inserted = await tx.insert(voiceUtterances).values(values).onConflictDoNothing().returning({ id: voiceUtterances.id });
    if (inserted.length) await tx.update(personaRuns).set({
      score: null, feedbackStatus: 'error', feedbackError: 'voice_transcript_revision_changed',
    }).where(eq(personaRuns.id, values.personaRunId));
  });
}

/** Same lock as publish: a confirmed revision cannot race an old worker publish. */
async function mutate(id: string, action: (row: typeof voiceUtterances.$inferSelect) => Record<string, any> | null) {
  return db.transaction(async tx => {
    const [identity] = await tx.select().from(voiceUtterances).where(eq(voiceUtterances.id, id)).limit(1);
    if (!identity) throw new Error('voice_utterance_not_found');
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${identity.personaRunId}))`);
    const [row] = await tx.select().from(voiceUtterances).where(eq(voiceUtterances.id, id)).limit(1);
    const patch = action(row);
    if (!patch) return row;
    const [updated] = await tx.update(voiceUtterances)
      .set({ ...patch, revision: row.revision + 1 }).where(eq(voiceUtterances.id, id)).returning();
    // Preserve existing reports, but do not let them remain a finalized score.
    await tx.update(personaRuns).set({
      score: null, feedbackError: 'voice_transcript_revision_changed',
      feedbackStatus: 'error',
    })
      .where(eq(personaRuns.id, row.personaRunId));
    return updated;
  });
}

export async function recordProviderEvidence(id: string, text: string, final: boolean) {
  const row = await mutate(id, row => {
    if (row.providerFinal) return null;
    // Only provider finality/disagreement can be resolved by a later provider
    // update. Capture/STT failure holds require explicit user confirmation.
    const captureHold = !!row.reason &&
      !['provider_incomplete', 'candidate_disagreement'].includes(row.reason);
    const decision = row.candidateText === null || captureHold ? null : candidateStatus(text, final, row.candidateText);
    return {
      providerText: text, providerFinal: final,
      ...(row.status === 'confirmed' ? {} : decision ? {
        ...decision, canonicalText: decision.status === 'verified' ? row.candidateText : null,
      } : {}),
    };
  });
  const messages = await storage.getChatMessagesByPersonaRun(row.personaRunId);
  await storage.upsertVoiceTranscript({
    personaRunId: row.personaRunId, voiceTurnId: id,
    voiceTranscriptFinal: row.providerFinal, sender: 'user',
    message: row.providerText ?? '', turnIndex: messages.length,
  });
  await import('../realtimeVoiceService').then(m => m.realtimeVoiceService.refreshRecognitionHistory(row.personaRunId));
  if (recognitionResolved(row)) {
    void import('./evaluateRecognition').then(m => m.evaluateRecognition(id)).catch(() => {
      console.warn('[voice-recognition-evaluation]', { status: 'not_published' });
    });
  }
  return row;
}

export async function recordSttEvidence(id: string, candidate: string | null, failure?: string, model?: string) {
  const updated = await mutate(id, row => {
    // Duplicate/late completions cannot demote user confirmation or replace an earlier candidate.
    if (row.status === 'confirmed' || row.candidateText !== null) return null;
    if (row.status === 'needs_confirmation' && row.reason) return null;
    const decision = failure || candidate === null
      ? { status: 'needs_confirmation', reason: failure || 'stt_failed' }
      : candidateStatus(row.providerText, row.providerFinal, candidate);
    return {
      ...decision, candidateText: candidate, source: model ? `openai_stt:${model}` : 'openai_stt',
      canonicalText: decision.status === 'verified' ? candidate : null,
    };
  });
  if (recognitionResolved(updated)) {
    void import('./evaluateRecognition').then(m => m.evaluateRecognition(id)).catch(() => {
      console.warn('[voice-recognition-evaluation]', { status: 'not_published' });
    });
  }
  await import('../realtimeVoiceService').then(m => m.realtimeVoiceService.refreshRecognitionHistory(updated.personaRunId));
  return updated;
}

export async function confirmRecognition(runId: string, id: string, revision: number, text: string) {
  const [owned] = await db.select().from(voiceUtterances).where(and(
    eq(voiceUtterances.id, id), eq(voiceUtterances.personaRunId, runId),
  )).limit(1);
  if (!owned) throw new Error('voice_utterance_not_found');
  if (!text.trim() || text.length > 10000) throw new Error('invalid_confirmation_text');
  const updated = await mutate(id, row => {
    if (row.revision !== revision) throw new Error('voice_revision_conflict');
    return { status: 'confirmed', canonicalText: text, source: 'user_confirmation', reason: null };
  });
  const messages = await storage.getChatMessagesByPersonaRun(runId);
  if (!messages.some(m => m.voiceTurnId === id)) {
    await storage.upsertVoiceTranscript({
      personaRunId: runId, voiceTurnId: id, voiceTranscriptFinal: updated.providerFinal,
      sender: 'user', message: updated.providerText ?? '', turnIndex: messages.length,
    });
  }
  void import('./evaluateRecognition').then(m => m.evaluateRecognition(id)).catch(() => {
    console.warn('[voice-recognition-evaluation]', { status: 'not_published' });
  });
  await import('../realtimeVoiceService').then(m => m.realtimeVoiceService.refreshRecognitionHistory(runId));
  return updated;
}

export async function prepareRecognitionConversation(runId: string, conversation: any) {
  const evidence = await listRecognitionEvidence(runId);
  if (!evidence.length) {
    const run = await storage.getPersonaRun(runId);
    if (run?.voiceRecognitionRequired) {
      const persisted = await storage.getChatMessagesByPersonaRun(runId);
      if (persisted.some(m => m.voiceTurnId) || conversation.messages?.some((m: any) => m.voiceTurnId)) {
        throw new RecognitionPendingError();
      }
    }
    return { conversation, revision: recognitionRevision([]) };
  }
  if (evidence.some((e: any) => !recognitionResolved(e))) throw new RecognitionPendingError();
  const persisted = await storage.getChatMessagesByPersonaRun(runId);
  const byId = new Map(evidence.map((e: any) => [e.id, e]));
  // Server history is authoritative; do not trust a client's eligibility or canonical claims.
  const messages = persisted.map(m => {
    const e: any = m.voiceTurnId ? byId.get(m.voiceTurnId) : null;
    if (m.sender === 'user' && m.voiceTurnId && !e) throw new RecognitionPendingError();
    return e ? { ...m, message: e.canonicalText } : m;
  });
  const present = new Set(persisted.map(m => m.voiceTurnId));
  if (evidence.some((e: any) => !present.has(e.id))) throw new RecognitionPendingError();
  return { conversation: { ...conversation, messages }, revision: recognitionRevision(evidence) };
}

/** Serve an affected report as a hold, never as a failed assessment. DB original stays intact. */
export async function guardRecognitionReport<T extends Record<string, any>>(report: T): Promise<T> {
  if (!report?.personaRunId) return report;
  const evidence = await listRecognitionEvidence(report.personaRunId);
  if (!evidence.length) {
    const run = await storage.getPersonaRun(report.personaRunId);
    if (!run?.voiceRecognitionRequired) return report;
    const messages = await storage.getChatMessagesByPersonaRun(report.personaRunId);
    if (!messages.some(m => m.voiceTurnId)) return report;
  }
  const stamp = report.evaluationPromptSnapshot?.recognitionRevision;
  if (evidence.length && evidence.every(recognitionResolved) && stamp === recognitionRevision(evidence)) return report;
  return {
    id: report.id, personaRunId: report.personaRunId, conversationId: report.conversationId,
    createdAt: report.createdAt, overallScore: null, confidence: null, scores: [],
    reportStatus: 'recognition_pending', metricSnapshot: null,
    detailedFeedback: {
      recognitionPending: true,
      reason: '인식 확인 필요: 전사 확인 또는 최신 전사로 재평가하기 전에는 점수와 합격 여부를 확정하지 않습니다.',
    },
  } as unknown as T;
}