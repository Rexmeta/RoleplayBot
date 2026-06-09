export interface RealtimeModelInfo {
  value: string;
  modelKey: string;
  provider: string;
  recommended: boolean;
  description?: string;
}

export const REALTIME_MODELS: RealtimeModelInfo[] = [
  {
    value: "gemini-2.0-flash-live-001",
    modelKey: "gemini20FlashLive001",
    provider: "Google Live",
    recommended: true,
  },
  {
    value: "gemini-2.5-flash-live-preview",
    modelKey: "gemini25FlashLivePreview",
    provider: "Google Live",
    recommended: false,
  },
  {
    value: "gemini-3.1-flash-live-preview",
    modelKey: "gemini31FlashLivePreview",
    provider: "Google Live",
    recommended: false,
    description: "선불 크레딧 필요",
  },
  {
    value: "gpt-4o-realtime-preview",
    modelKey: "gptRealtimePreview",
    provider: "OpenAI Realtime",
    recommended: false,
  },
  {
    value: "gpt-4o-mini-realtime-preview",
    modelKey: "gptMiniRealtimePreview",
    provider: "OpenAI Realtime",
    recommended: false,
  },
];

export const VALID_REALTIME_MODEL_VALUES: ReadonlySet<string> = new Set(
  REALTIME_MODELS.map((m) => m.value)
);
