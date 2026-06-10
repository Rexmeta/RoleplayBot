import { storage } from '../storage';
import type { InsertAiUsageLog } from '@shared/schema';

// Model pricing per 1M tokens (USD) - Updated December 2025
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini models (2025 pricing - unified thinking/non-thinking)
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 }, // ≤200K tokens
  'gemini-2.0-flash-live-preview-04-09': { input: 0.35, output: 1.50 }, // Gemini Live 2.0 Flash (v1alpha)
  'gemini-2.0-flash-live-001': { input: 0.35, output: 1.50 }, // Gemini Live (legacy alias)
  'gemini-live-2.5-flash': { input: 0.35, output: 1.50 }, // Gemini Live 2.5 Flash (v1alpha, fallback)
  'gemini-live-2.5-flash-preview': { input: 0.35, output: 1.50 }, // Deprecated (historical records only)
  'gemini-3.1-flash-live-preview': { input: 0.35, output: 1.50 }, // Gemini 3.1 Flash Live (recommended)
  'gemini-2.5-flash-native-audio-preview-09-2025': { input: 0.35, output: 1.50 }, // Deprecated (historical records only)
  'gemini-2.5-flash-image-preview': { input: 0.30, output: 2.50 }, // Image generation
  'gemini-2.0-flash-preview-image-generation': { input: 0.30, output: 2.50 }, // Image generation (legacy)
  'veo-3.1-generate-preview': { input: 0.00, output: 0.00 }, // Veo video generation (per-video pricing, not per-token)
  
  // OpenAI models
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o-realtime-preview': { input: 5.00, output: 20.00 }, // Realtime API (text tokens)
};

// Video generation pricing (per video, not per token)
export const VIDEO_PRICING: Record<string, number> = {
  'veo-3.1-generate-preview': 0.35, // USD per 8-second video (estimated)
};

// Feature types for categorization
export type AIFeature = 
  | 'conversation'
  | 'feedback'
  | 'strategy'
  | 'scenario'
  | 'realtime'
  | 'image'
  | 'video'
  | 'other';

export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'other';

interface TrackUsageParams {
  feature: AIFeature;
  model: string;
  provider: AIProvider;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  userId?: string;
  conversationId?: string;
  requestId?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
  /** True when token counts are heuristic estimates (provider returned no real token metadata) */
  tokensEstimated?: boolean;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Cache discount fraction for Gemini implicit caching (cached tokens billed at 25% of full input price)
const GEMINI_CACHE_DISCOUNT = 0.75; // 75% savings on cached tokens

// Calculate cost based on model and token usage
export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens?: number
): { inputCost: number; outputCost: number; totalCost: number; cacheSavingsUsd: number } {
  const pricing = MODEL_PRICING[model];
  
  if (!pricing) {
    console.warn(`Unknown model pricing: ${model}, using default pricing`);
    return { inputCost: 0, outputCost: 0, totalCost: 0, cacheSavingsUsd: 0 };
  }
  
  const cached = cachedTokens && cachedTokens > 0 ? cachedTokens : 0;
  const isGemini = model.startsWith('gemini');

  // Apply cache discount: cached tokens billed at 25% for Gemini models
  const cacheSavings = isGemini && cached > 0
    ? (cached / 1_000_000) * pricing.input * GEMINI_CACHE_DISCOUNT
    : 0;

  // Calculate costs (pricing is per 1M tokens), subtract cache savings from input
  const inputCostFull = (promptTokens / 1_000_000) * pricing.input;
  const inputCost = inputCostFull - cacheSavings;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;
  
  return { 
    inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
    outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    cacheSavingsUsd: Math.round(cacheSavings * 1_000_000) / 1_000_000,
  };
}

// Track AI usage asynchronously (fire and forget to not slow down API responses)
export async function trackUsage(params: TrackUsageParams): Promise<void> {
  try {
    const { inputCost, outputCost, totalCost, cacheSavingsUsd } = calculateCost(
      params.model,
      params.promptTokens,
      params.completionTokens,
      params.cachedTokens
    );
    
    const logEntry: InsertAiUsageLog = {
      feature: params.feature,
      model: params.model,
      provider: params.provider,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.promptTokens + params.completionTokens,
      cachedTokens: params.cachedTokens || 0,
      inputCostUsd: inputCost,
      outputCostUsd: outputCost,
      totalCostUsd: totalCost,
      userId: params.userId || null,
      conversationId: params.conversationId || null,
      requestId: params.requestId || null,
      durationMs: params.durationMs || null,
      metadata: { ...(params.metadata || {}), cacheSavingsUsd },
      tokensEstimated: params.tokensEstimated ?? false,
    };
    
    // Fire and forget — atomically log usage AND increment subscription counter in one DB transaction
    storage.logUsageAndIncrementSubscription(logEntry).catch((error) => {
      console.error('Failed to log AI usage + increment subscription:', error);
    });
  } catch (error) {
    console.error('Error in trackUsage:', error);
  }
}

// Synchronous version for when you need to ensure logging completes
export async function trackUsageSync(params: TrackUsageParams): Promise<void> {
  const { inputCost, outputCost, totalCost, cacheSavingsUsd } = calculateCost(
    params.model,
    params.promptTokens,
    params.completionTokens,
    params.cachedTokens
  );
  
  const logEntry: InsertAiUsageLog = {
    feature: params.feature,
    model: params.model,
    provider: params.provider,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    totalTokens: params.promptTokens + params.completionTokens,
    cachedTokens: params.cachedTokens || 0,
    inputCostUsd: inputCost,
    outputCostUsd: outputCost,
    totalCostUsd: totalCost,
    userId: params.userId || null,
    conversationId: params.conversationId || null,
    requestId: params.requestId || null,
    durationMs: params.durationMs || null,
    metadata: { ...(params.metadata || {}), cacheSavingsUsd },
    tokensEstimated: params.tokensEstimated ?? false,
  };
  
  // Atomically log usage AND increment subscription counter in one DB transaction
  await storage.logUsageAndIncrementSubscription(logEntry);
}

// Helper to extract token usage from Gemini response
export function extractGeminiTokens(response: any): TokenUsage {
  try {
    const usageMetadata = response?.usageMetadata;
    if (usageMetadata) {
      return {
        promptTokens: usageMetadata.promptTokenCount || 0,
        completionTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      };
    }
  } catch (error) {
    console.error('Error extracting Gemini tokens:', error);
  }
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

// Helper to extract token usage from OpenAI response
export function extractOpenAITokens(response: any): TokenUsage {
  try {
    const usage = response?.usage;
    if (usage) {
      return {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      };
    }
  } catch (error) {
    console.error('Error extracting OpenAI tokens:', error);
  }
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

// Map model ID to pricing key
export function getModelPricingKey(model: string): string {
  const modelMappings: Record<string, string> = {
    'gemini-2.5-flash': 'gemini-2.5-flash',
    'gemini-2.5-pro': 'gemini-2.5-pro',
    'gemini-2.0-flash-live-preview-04-09': 'gemini-2.0-flash-live-preview-04-09',
    'gemini-live-2.5-flash-preview': 'gemini-live-2.5-flash-preview',
    'gemini-2.0-flash-live-001': 'gemini-2.0-flash-live-001',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'gpt-4o-realtime-preview-2024-12-17': 'gpt-4o-realtime-preview',
  };
  
  return modelMappings[model] || model;
}

// Get provider from model name
export function getProviderFromModel(model: string): AIProvider {
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('gpt') || model.startsWith('o1')) return 'openai';
  if (model.startsWith('claude')) return 'anthropic';
  return 'other';
}

// Track video generation usage (fixed cost per video, not per token)
export async function trackVideoUsage(params: {
  model: string;
  provider: AIProvider;
  userId?: string;
  conversationId?: string;
  requestId?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    const videoCost = VIDEO_PRICING[params.model] || 0.35; // Default cost per video
    
    const logEntry: InsertAiUsageLog = {
      feature: 'video',
      model: params.model,
      provider: params.provider,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      inputCostUsd: 0,
      outputCostUsd: videoCost,
      totalCostUsd: videoCost,
      userId: params.userId || null,
      conversationId: params.conversationId || null,
      requestId: params.requestId || null,
      durationMs: params.durationMs || null,
      metadata: params.metadata || null,
    };
    
    storage.createAiUsageLog(logEntry).catch((error) => {
      console.error('Failed to log video usage:', error);
    });
  } catch (error) {
    console.error('Error in trackVideoUsage:', error);
  }
}

// Track image generation usage (estimate tokens based on image generation)
export async function trackImageUsage(params: {
  model: string;
  provider: AIProvider;
  userId?: string;
  requestId?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}): Promise<void> {
  try {
    // Image generation typically uses ~500-1000 input tokens for prompt
    // and ~1000-2000 output tokens for image data
    const estimatedPromptTokens = 800;
    const estimatedCompletionTokens = 1500;
    
    const { inputCost, outputCost, totalCost } = calculateCost(
      params.model,
      estimatedPromptTokens,
      estimatedCompletionTokens
    );
    
    const logEntry: InsertAiUsageLog = {
      feature: 'image',
      model: params.model,
      provider: params.provider,
      promptTokens: estimatedPromptTokens,
      completionTokens: estimatedCompletionTokens,
      totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
      inputCostUsd: inputCost,
      outputCostUsd: outputCost,
      totalCostUsd: totalCost,
      userId: params.userId || null,
      conversationId: null,
      requestId: params.requestId || null,
      durationMs: params.durationMs || null,
      metadata: params.metadata || null,
      tokensEstimated: true,
    };
    
    storage.createAiUsageLog(logEntry).catch((error) => {
      console.error('Failed to log image usage:', error);
    });
  } catch (error) {
    console.error('Error in trackImageUsage:', error);
  }
}

export default {
  trackUsage,
  trackUsageSync,
  trackVideoUsage,
  trackImageUsage,
  calculateCost,
  extractGeminiTokens,
  extractOpenAITokens,
  getModelPricingKey,
  getProviderFromModel,
  MODEL_PRICING,
  VIDEO_PRICING,
};
