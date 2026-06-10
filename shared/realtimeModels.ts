export interface RealtimeModelInfo {
  value: string;
  modelKey: string;
  provider: string;
  recommended: boolean;
  description?: string;
}

export const REALTIME_MODELS: RealtimeModelInfo[] = [
  {
    value: "gemini-live-2.5-flash-preview",
    modelKey: "geminiLive25FlashPreview",
    provider: "Google Live",
    recommended: true,
    description: "v1beta (프로덕션 안정)",
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
