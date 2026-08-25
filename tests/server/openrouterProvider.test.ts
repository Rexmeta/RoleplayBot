import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAIInstances: any[] = [];
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: vi.fn() } };
    constructor(options: any) {
      (this as any).options = options;
      openAIInstances.push(this);
    }
  },
}));

vi.mock('../../server/services/aiUsageTracker', () => ({
  trackUsage: vi.fn(),
  extractOpenAITokens: vi.fn((response: any) => ({
    promptTokens: response?.usage?.prompt_tokens || 0,
    completionTokens: response?.usage?.completion_tokens || 0,
  })),
  getModelPricingKey: vi.fn((model: string) => model),
}));

import { OpenRouterProvider } from '../../server/services/providers/openrouterProvider';
import { AIServiceFactory, getAIServiceForFeature, parseAIModelPolicy } from '../../server/services/aiServiceFactory';

describe('OpenRouter provider core', () => {
  beforeEach(() => {
    openAIInstances.length = 0;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    delete process.env.AI_MODEL_CONVERSATION;
    delete process.env.OPENROUTER_API_KEY;
  });

  it('parses explicit policies without inferring provider from a namespaced slug', () => {
    expect(parseAIModelPolicy('anthropic/claude-3.5-sonnet')).toEqual({
      provider: 'gemini',
      model: 'anthropic/claude-3.5-sonnet',
    });
    expect(parseAIModelPolicy('openrouter|anthropic/claude-3.5-sonnet')).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
    });
    expect(parseAIModelPolicy('{"provider":"openrouter","model":"openai/gpt-4o-mini"}')).toEqual({
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
  });

  it('constructs an OpenRouter client with the configured endpoint and model', () => {
    const provider = new OpenRouterProvider('test-key', 'anthropic/claude-3.5-sonnet', 'https://router.test/v1');
    expect(provider.getModel?.()).toBe('anthropic/claude-3.5-sonnet');
    expect(openAIInstances[0].options).toMatchObject({
      apiKey: 'test-key',
      baseURL: 'https://router.test/v1',
      defaultHeaders: {},
    });
  });

  it('streams text and provider usage metadata through the shared contract', async () => {
    const provider = new OpenRouterProvider('test-key', 'openai/gpt-4o-mini');
    const create = openAIInstances[0].chat.completions.create;
    create.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: '안녕' } }] };
      yield { choices: [{ delta: { content: '하세요' } }], usage: { prompt_tokens: 12, completion_tokens: 4 } };
    })());
    const chunks: string[] = [];
    const persona = { name: '김민준', role: '팀장', personality: '차분함', responseStyle: '직접적', background: '경력', goals: ['성과'] } as any;
    for await (const chunk of await provider.generateStreamingResponse!({} as any, [], persona, '안녕', 'ko')) chunks.push(chunk);
    expect(chunks).toEqual(['안녕', '하세요', '[USAGE:{"inputTokens":12,"outputTokens":4}]']);
  });

  it('selects OpenRouter only when explicitly configured and rejects missing credentials', async () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.AI_MODEL_CONVERSATION = 'anthropic/claude-3.5-sonnet';
    process.env.OPENROUTER_API_KEY = 'test-key';
    expect(await getAIServiceForFeature('conversation')).toBeInstanceOf(OpenRouterProvider);

    delete process.env.OPENROUTER_API_KEY;
    await expect(getAIServiceForFeature('conversation')).rejects.toThrow('OPENROUTER_API_KEY');
  });

  it('keeps legacy GPT prefix routing on the OpenAI provider', () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    expect(AIServiceFactory.createServiceWithModel('gpt-4o')).not.toBeInstanceOf(OpenRouterProvider);
  });
});