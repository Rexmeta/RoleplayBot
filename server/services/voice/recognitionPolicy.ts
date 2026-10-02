import { createHash } from 'node:crypto';

export interface RecognitionEvidence {
  id: string;
  status: string;
  revision: number;
  canonicalText: string | null;
  providerText?: string | null;
  providerFinal?: boolean;
  candidateText?: string | null;
}

/** No character-script or length heuristics: numbers, acronyms and mixing are valid. */
export function recognitionResolved(e: RecognitionEvidence): boolean {
  return (e.status === 'verified' || e.status === 'confirmed') &&
    typeof e.canonicalText === 'string' && e.canonicalText.trim().length > 0;
}

export function candidateStatus(providerText: string | null, providerFinal: boolean, candidate: string) {
  if (!candidate.trim()) return { status: 'needs_confirmation', reason: 'empty_stt_result' };
  // Ignore only whitespace in comparison; never alter the actual evidence text.
  const same = providerFinal && providerText !== null &&
    providerText.replace(/\s/g, '') === candidate.replace(/\s/g, '');
  return same
    ? { status: 'verified', reason: null }
    : { status: 'needs_confirmation', reason: providerFinal ? 'candidate_disagreement' : 'provider_incomplete' };
}

export function recognitionRevision(evidence: RecognitionEvidence[]): string {
  return createHash('sha256').update(JSON.stringify(
    [...evidence].sort((a, b) => a.id.localeCompare(b.id)).map(e =>
      [e.id, e.revision, e.status, e.canonicalText]),
  )).digest('hex');
}

export class RecognitionPendingError extends Error {
  constructor() {
    super('voice_recognition_confirmation_required');
  }
}