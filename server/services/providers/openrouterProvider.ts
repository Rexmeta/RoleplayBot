import { OpenAIProvider } from './openaiProvider';

/**
 * OpenRouter's chat-completions API is OpenAI-compatible, but model slugs such
 * as anthropic/... must only be used when the provider was explicitly selected.
 */
export class OpenRouterProvider extends OpenAIProvider {
  static readonly DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

  constructor(apiKey: string, model: string, baseUrl = OpenRouterProvider.DEFAULT_BASE_URL) {
    if (!apiKey?.trim()) throw new Error('OPENROUTER_API_KEY is required for the OpenRouter provider');
    if (!model?.trim() || model.includes(' ')) throw new Error('A valid OpenRouter model slug is required');
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) throw new Error('unsupported protocol');
    } catch {
      throw new Error('OPENROUTER_BASE_URL must be a valid HTTP(S) URL');
    }

    const headers: Record<string, string> = {};
    if (process.env.OPENROUTER_HTTP_REFERER) headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
    if (process.env.OPENROUTER_APP_TITLE) headers['X-Title'] = process.env.OPENROUTER_APP_TITLE;
    super(apiKey, model, { baseUrl: parsedBaseUrl.toString().replace(/\/$/, ''), headers, usageProvider: 'openrouter', throwOnError: true });
  }
}

export default OpenRouterProvider;