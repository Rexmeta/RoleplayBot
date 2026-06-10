export interface RealtimeModelInfo {
  value: string;
  modelKey: string;
  provider: string;
  recommended: boolean;
  description?: string;
}

export const REALTIME_MODELS: RealtimeModelInfo[] = [
  {
    value: "gemini-live-2.5-flash-native-audio",
    modelKey: "geminiLive25FlashNativeAudio",
    provider: "Google Live",
    recommended: true,
    description: "GA — 엔터프라이즈 안정 버전",
  },
  {
    value: "gemini-3.1-flash-live",
    modelKey: "gemini31FlashLive",
    provider: "Google Live",
    recommended: false,
    description: "프리뷰 — 최신 대화형 음성 AI",
  },
  {
    value: "gemini-3.5-live-translate",
    modelKey: "gemini35LiveTranslate",
    provider: "Google Live",
    recommended: false,
    description: "프리뷰 — 실시간 통역 전용",
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
