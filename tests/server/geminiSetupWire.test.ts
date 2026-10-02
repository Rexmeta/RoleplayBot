import { describe, expect, it } from 'vitest';
import { GoogleGenAI, Modality } from '@google/genai';

describe('installed Gemini SDK setup transmission boundary (no network)', () => {
  it('serializes transcription as empty objects, dropping unsupported languageCode', async () => {
    const ai = new GoogleGenAI({ apiKey: 'non-secret-test-key', httpOptions: { apiVersion: 'v1beta' } });
    const sent: any[] = [];
    // Replace only the socket factory. Real SDK Live.connect and serializers run.
    (ai.live as any).webSocketFactory = {
      create(_url: string, _headers: unknown, callbacks: any) {
        return {
          connect() { callbacks.onopen(); },
          send(payload: string) { sent.push(JSON.parse(payload)); },
          close() {},
        };
      },
    };
    const session = await ai.live.connect({
      model: 'gemini-3.1-flash-live-preview',
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: { languageCode: 'ko-KR' },
        outputAudioTranscription: { languageCode: 'ko-KR' },
      } as any,
      callbacks: { onmessage() {} },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].setup.model).toContain('gemini-3.1-flash-live-preview');
    expect(sent[0].setup.inputAudioTranscription).toEqual({});
    expect(sent[0].setup.outputAudioTranscription).toEqual({});
    expect(JSON.stringify(sent[0])).not.toContain('ko-KR');
    session.sendRealtimeInput({ event: 'END_OF_TURN' } as any);
    expect(sent[1].realtimeInput).toEqual({});
    session.sendRealtimeInput({ audioStreamEnd: true });
    expect(sent[2].realtimeInput.audioStreamEnd).toBe(true);
    session.close();
  });
});