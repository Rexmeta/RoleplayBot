import { OpenAIProvider } from './openaiProvider';

export interface OpenRouterCatalogModel {
  id: string;
  name: string;
  description: string | null;
  contextLength: number | null;
  pricing: { input: number | null; output: number | null; unit: "per_token" };
  modalities: { input: string[]; output: string[] };
  capabilities: string[];
  provider: string | null;
}

export interface OpenRouterEndpoint {
  provider: string | null;
  contextLength: number | null;
  pricing: { input: number | null; output: number | null; unit: "per_token" };
  capabilities: string[];
  latencyMs: number | null;
  uptime: number | null;
}

const asNumber = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
};

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 50) : [];

export function normalizeOpenRouterModel(raw: any): OpenRouterCatalogModel | null {
  if (!raw || typeof raw.id !== "string" || !raw.id.trim()) return null;
  const input = asStrings(raw.architecture?.input_modalities);
  const output = asStrings(raw.architecture?.output_modalities);
  const capabilities = asStrings(raw.supported_parameters);
  const isText = input.length === 0 || input.includes("text");
  const producesText = output.length === 0 || output.includes("text");
  if (!isText || !producesText) return null;
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : raw.id,
    description: typeof raw.description === "string" ? raw.description : null,
    contextLength: asNumber(raw.context_length),
    pricing: {
      input: asNumber(raw.pricing?.prompt),
      output: asNumber(raw.pricing?.completion),
      unit: "per_token",
    },
    modalities: { input, output },
    capabilities,
    provider: typeof raw.top_provider?.name === "string" ? raw.top_provider.name : null,
  };
}

export function normalizeOpenRouterEndpoint(raw: any): OpenRouterEndpoint {
  return {
    provider: typeof raw?.provider_name === "string" ? raw.provider_name :
      (typeof raw?.name === "string" ? raw.name :
        (typeof raw?.provider === "string" ? raw.provider : null)),
    contextLength: asNumber(raw?.context_length),
    pricing: {
      input: asNumber(raw?.pricing?.prompt),
      output: asNumber(raw?.pricing?.completion),
      unit: "per_token",
    },
    capabilities: asStrings(raw?.supported_parameters),
    latencyMs: asNumber(raw?.latency),
    uptime: asNumber(raw?.uptime),
  };
}

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