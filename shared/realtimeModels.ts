export interface RealtimeModelInfo {
  value: string;
  modelKey: string;
  provider: string;
  recommended: boolean;
  description?: string;
}

export { REALTIME_REGISTRY_ENTRIES as REALTIME_MODELS, VALID_REALTIME_MODEL_VALUES_FROM_REGISTRY as VALID_REALTIME_MODEL_VALUES } from "./modelRegistry";
