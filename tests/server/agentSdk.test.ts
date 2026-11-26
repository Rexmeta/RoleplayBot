import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import { AgentApiClient, AgentApiError, verifyWebhookSignature, parseWebhook } from '../../sdk/agent-api/client';

const sign = (b: string, s: string) => 'sha256=' + createHmac('sha256', s).update(b).digest('hex');

describe('agent SDK webhook verification', () => {
  const body = JSON.stringify({ event: 'feedback.completed', deliveryId: 'd', timestamp: 't', data: { sessionId: 's' } });
  it('accepts valid and rejects tampered/missing signatures', () => {
    expect(verifyWebhookSignature(body, sign(body, 'sec'), 'sec')).toBe(true);
    expect(verifyWebhookSignature(body + ' ', sign(body, 'sec'), 'sec')).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, 'other'), 'sec')).toBe(false);
    expect(verifyWebhookSignature(body, undefined, 'sec')).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=zz', 'sec')).toBe(false);
    expect(parseWebhook(body, sign(body, 'sec'), 'sec').event).toBe('feedback.completed');
    expect(() => parseWebhook(body, 'sha256=' + '0'.repeat(64), 'sec')).toThrow();
  });
});

describe('agent SDK client', () => {
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
  it('startRoleplay creates session then play link', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(201, { sessionId: 'ags_1' }))
      .mockResolvedValueOnce(json(201, { playUrl: 'https://h/play/x', expiresAt: 'e' }));
    const c = new AgentApiClient({ apiKey: 'k', baseUrl: 'https://h/', fetch: f as any });
    const r = await c.startRoleplay({ scenarioId: 's', personaId: 'p', externalUserId: 'u', gameContext: { contextId: 'c' } });
    expect(r.playUrl).toBe('https://h/play/x');
    expect(f.mock.calls[0][0]).toBe('https://h/api/v1/agent/sessions');
    expect(f.mock.calls[1][0]).toBe('https://h/api/v1/agent/sessions/ags_1/play-link');
  });
  it('polls until completed and surfaces failures', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { status: 'in_progress', result: null }))
      .mockResolvedValueOnce(json(200, { status: 'completed', result: { narrativeHook: 'h' } }));
    const c = new AgentApiClient({ apiKey: 'k', baseUrl: 'https://h', fetch: f as any });
    expect((await c.waitForResult('s', { intervalMs: 1 })).result.narrativeHook).toBe('h');
    const f2 = vi.fn().mockResolvedValue(json(200, { status: 'failed', error: { code: 'feedback_failed', message: 'x' } }));
    await expect(new AgentApiClient({ apiKey: 'k', baseUrl: 'https://h', fetch: f2 as any }).waitForResult('s', { intervalMs: 1 })).rejects.toBeInstanceOf(AgentApiError);
  });
  it('maps error envelope', async () => {
    const f = vi.fn().mockResolvedValue(json(404, { error: { code: 'session_not_found', message: 'nope' }, requestId: 'r' }));
    const c = new AgentApiClient({ apiKey: 'k', baseUrl: 'https://h', fetch: f as any });
    await expect(c.getResult('x')).rejects.toMatchObject({ status: 404, code: 'session_not_found', requestId: 'r' });
  });
});

import { existsSync, readFileSync } from 'fs';
import { decideOutcome, applyOutcome } from '../../examples/agent-web-game/gameLogic';

describe('example game logic', () => {
  it('uses a neutral branch with no penalty when score is null', () => {
    const o = decideOutcome({ passed: null, overallScore: null });
    expect(o).toBe('neutral');
    expect(applyOutcome({ reputation: 10, gold: 40 }, o)).toEqual({ reputation: 10, gold: 40 });
  });
  it('branches on passed, then score', () => {
    expect(decideOutcome({ passed: true, overallScore: 10 })).toBe('win');
    expect(decideOutcome({ passed: false, overallScore: 99 })).toBe('lose');
    expect(decideOutcome({ passed: null, overallScore: 80 })).toBe('win');
    expect(decideOutcome({ passed: null, overallScore: 40 })).toBe('lose');
  });
});

describe('hosted integration assets', () => {
  it('exist and are copied into the production image', () => {
    const docker = readFileSync('Dockerfile', 'utf8');
    for (const f of ['docs/integrations/agent-api-integration-guide.md', 'sdk/agent-api/embed.js']) {
      expect(existsSync(f)).toBe(true);
      expect(docker).toContain(f);
    }
  });
});
