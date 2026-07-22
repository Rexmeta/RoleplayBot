export type ModelStatus = 'active' | 'deprecated' | 'removed';

export type ModelCategory =
  | 'conversation'
  | 'feedback'
  | 'strategy'
  | 'scenario'
  | 'realtime'
  | 'emotion'
  | 'translation'
  | 'image'
  | 'video'
  | 'evaluation'
  | 'summarization';

export interface ModelEntry {
  value: string;
  modelKey: string;
  provider: string;
  recommended: boolean;
  categories: ModelCategory[];
  status: ModelStatus;
  description?: string;
  deprecatedAt?: string;
  sunsetAt?: string;
  replacedBy?: string;
  disabled?: boolean;
}

export const MODEL_REGISTRY: ModelEntry[] = [
  // ──────────────────────────────────────────────────
  // Active Google Gemini models
  // ──────────────────────────────────────────────────
  {
    value: "gemini-2.5-flash",
    modelKey: "gemini25flash",
    provider: "Google",
    recommended: true,
    categories: ["conversation", "feedback", "strategy", "scenario", "emotion", "translation", "evaluation", "summarization"],
    status: "active",
  },
  {
    value: "gemini-2.5-flash-lite",
    modelKey: "gemini25flashLite",
    provider: "Google",
    recommended: false,
    categories: ["conversation", "feedback", "strategy", "scenario", "emotion", "translation", "evaluation", "summarization"],
    status: "active",
  },
  {
    value: "gemini-2.5-pro",
    modelKey: "gemini25pro",
    provider: "Google",
    recommended: false,
    categories: ["conversation", "feedback", "strategy", "scenario", "emotion", "translation", "evaluation", "summarization"],
    status: "active",
  },
  {
    value: "gemini-3-flash-preview",
    modelKey: "gemini3flashPreview",
    provider: "Google",
    recommended: false,
    categories: ["conversation", "feedback", "strategy", "scenario", "emotion", "translation", "evaluation", "summarization"],
    status: "active",
  },
  {
    value: "gemini-3.1-pro-preview",
    modelKey: "gemini31proPreview",
    provider: "Google",
    recommended: false,
    categories: ["conversation", "feedback", "strategy", "scenario", "emotion", "translation", "evaluation", "summarization"],
    status: "active",
  },
  {
    value: "gemini-3.1-flash-lite-preview",
    modelKey: "gemini31flashLitePreview",
    provider: "Google",
    recommended: false,
    categories: ["conversation", "feedback", "strategy", "scenario", "emotion", "translation", "evaluation", "summarization"],
    status: "active",
  },
  // ──────────────────────────────────────────────────
  // Deprecated Google Gemini models (with sunset dates & replacements)
  // ──────────────────────────────────────────────────
  {
    value: "gemini-1.5-flash",
    modelKey: "gemini15flash",
    provider: "Google",
    recommended: false,
    categories: ["conversation", "feedback", "strategy", "scenario", "emotion", "translation", "evaluation", "summarization"],
    status: "deprecated",
    deprecatedAt: "2025-06-01",
    sunsetAt: "2025-09-24",
    replacedBy: "gemini-2.5-flash",
    description: "Replaced by Gemini 2.5 Flash",
  },
  {
    value: "gemini-1.5-pro",
    modelKey: "gemini15pro",
    provider: "Google",
    recommended: false,
    categories: ["conversation", "feedback", "strategy", "scenario", "emotion", "translation", "evaluation", "summarization"],
    status: "deprecated",
    deprecatedAt: "2025-06-01",
    sunsetAt: "2025-09-24",
    replacedBy: "gemini-2.5-pro",
    description: "Replaced by Gemini 2.5 Pro",
  },
  // ──────────────────────────────────────────────────
  // Removed Google Gemini models
  // ──────────────────────────────────────────────────
  {
    value: "gemini-1.0-pro",
    modelKey: "gemini10pro",
    provider: "Google",
    recommended: false,
    categories: ["conversation", "feedback"],
    status: "removed",
    deprecatedAt: "2024-04-09",
    sunsetAt: "2025-02-15",
    replacedBy: "gemini-2.5-flash",
    description: "End of life — no longer available",
  },
  // ──────────────────────────────────────────────────
  // Active OpenAI models
  // ──────────────────────────────────────────────────
  {
    value: "gpt-4o",
    modelKey: "gpt4o",
    provider: "OpenAI",
    recommended: false,
    categories: ["conversation", "feedback", "translation"],
    status: "active",
  },
  {
    value: "gpt-4o-mini",
    modelKey: "gpt4omini",
    provider: "OpenAI",
    recommended: false,
    categories: ["conversation", "feedback", "translation"],
    status: "active",
  },
  {
    value: "gpt-4.1",
    modelKey: "gpt41",
    provider: "OpenAI",
    recommended: false,
    categories: ["conversation", "feedback", "translation"],
    status: "active",
  },
  {
    value: "gpt-4.1-mini",
    modelKey: "gpt41mini",
    provider: "OpenAI",
    recommended: false,
    categories: ["conversation", "feedback", "translation"],
    status: "active",
  },
  {
    value: "o3",
    modelKey: "o3",
    provider: "OpenAI",
    recommended: false,
    categories: ["conversation", "feedback"],
    status: "active",
  },
  {
    value: "o4-mini",
    modelKey: "o4mini",
    provider: "OpenAI",
    recommended: false,
    categories: ["conversation", "feedback"],
    status: "active",
  },
  // ──────────────────────────────────────────────────
  // Deprecated OpenAI models
  // ──────────────────────────────────────────────────
  {
    value: "gpt-4-turbo",
    modelKey: "gpt4turbo",
    provider: "OpenAI",
    recommended: false,
    categories: ["conversation", "feedback"],
    status: "deprecated",
    deprecatedAt: "2025-01-01",
    sunsetAt: "2025-04-01",
    replacedBy: "gpt-4.1",
    description: "Replaced by GPT-4.1",
  },
  // ──────────────────────────────────────────────────
  // Active realtime models
  // ──────────────────────────────────────────────────
  {
    value: "gemini-3.1-flash-live-preview",
    modelKey: "gemini31FlashLivePreview",
    provider: "Google Live",
    recommended: true,
    categories: ["realtime"],
    status: "active",
    description: "v1beta — Google AI 공식 지원",
  },
  {
    value: "gpt-4o-realtime-preview",
    modelKey: "gptRealtimePreview",
    provider: "OpenAI Realtime",
    recommended: false,
    categories: ["realtime"],
    status: "active",
  },
  {
    value: "gpt-4o-mini-realtime-preview",
    modelKey: "gptMiniRealtimePreview",
    provider: "OpenAI Realtime",
    recommended: false,
    categories: ["realtime"],
    status: "active",
  },
  // ──────────────────────────────────────────────────
  // Deprecated realtime models
  // ──────────────────────────────────────────────────
  {
    value: "gemini-2.0-flash-live-001",
    modelKey: "gemini20flashLive001",
    provider: "Google Live",
    recommended: false,
    categories: ["realtime"],
    status: "deprecated",
    deprecatedAt: "2025-07-01",
    sunsetAt: "2025-10-01",
    replacedBy: "gemini-3.1-flash-live-preview",
    description: "Replaced by Gemini 3.1 Flash Live Preview",
  },
  // ──────────────────────────────────────────────────
  // Image models
  // ──────────────────────────────────────────────────
  {
    value: "gemini-2.5-flash-image",
    modelKey: "geminiFlashImage",
    provider: "Google",
    recommended: true,
    categories: ["image"],
    status: "active",
  },
  // ──────────────────────────────────────────────────
  // Video models
  // ──────────────────────────────────────────────────
  {
    value: "veo-3.1-generate-preview",
    modelKey: "geminiVeo31",
    provider: "Google",
    recommended: true,
    categories: ["video"],
    status: "active",
  },
];

export function getModelsForCategory(category: ModelCategory): ModelEntry[] {
  return MODEL_REGISTRY.filter(m => m.categories.includes(category));
}

export function getModelByValue(value: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find(m => m.value === value);
}

export const REALTIME_REGISTRY_ENTRIES = MODEL_REGISTRY.filter(m =>
  m.categories.includes("realtime")
);

export const VALID_REALTIME_MODEL_VALUES_FROM_REGISTRY: ReadonlySet<string> = new Set(
  REALTIME_REGISTRY_ENTRIES.map(m => m.value)
);
