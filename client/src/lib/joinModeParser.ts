export interface SpeakerSegment {
  personaName: string;
  text: string;
}

/**
 * Parses join-mode AI response content that contains `[Name]: text` speaker blocks.
 *
 * Example input:
 *   "[Alice]: Hello, how can I help?\n[Bob]: Yes, let me add to that."
 *
 * Returns an array of { personaName, text } segments in order of appearance.
 * Returns null when no speaker blocks are found (single-persona response).
 */
export function parseJoinModeSpeakerSegments(content: string): SpeakerSegment[] | null {
  const pattern = /\[([^\]]+)\]:\s*([\s\S]*?)(?=\n\[[^\]]+\]:|$)/g;
  const segments: SpeakerSegment[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const personaName = match[1].trim();
    const text = match[2].trim();
    if (personaName && text) {
      segments.push({ personaName, text });
    }
  }
  return segments.length > 0 ? segments : null;
}
