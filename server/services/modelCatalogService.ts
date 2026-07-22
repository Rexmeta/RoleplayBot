import { storage } from "../storage";
import { MODEL_REGISTRY, type ModelEntry } from "../../shared/modelRegistry";
import type { ModelCategory } from "../../shared/modelRegistry";

export interface CatalogEntry extends ModelEntry {
  confirmedByProvider: boolean;
}

export interface ModelCatalog {
  models: CatalogEntry[];
  refreshedAt: string;
}

const CATALOG_SETTING_KEY = "model_catalog_cache";
const REFRESHED_AT_KEY = "model_catalog_refreshed_at";
const CATEGORY = "ai";
const DAILY_MS = 24 * 60 * 60 * 1000;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let cachedCatalog: ModelCatalog | null = null;

interface GeminiModelRaw {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

async function fetchGeminiModels(): Promise<Map<string, GeminiModelRaw>> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return new Map();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`
    );
    if (!res.ok) {
      console.warn(`[modelCatalog] Gemini API returned ${res.status}`);
      return new Map();
    }
    const data = await res.json();
    const result = new Map<string, GeminiModelRaw>();
    for (const m of data.models ?? []) {
      const id: string = (m.name ?? "").replace(/^models\//, "");
      if (id) result.set(id, m);
    }
    return result;
  } catch (err) {
    console.warn("[modelCatalog] Failed to fetch Gemini models:", err);
    return new Map();
  }
}

interface OpenAIModelRaw {
  id: string;
  object?: string;
  owned_by?: string;
}

async function fetchOpenAIModels(): Promise<Map<string, OpenAIModelRaw>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return new Map();
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.warn(`[modelCatalog] OpenAI API returned ${res.status}`);
      return new Map();
    }
    const data = await res.json();
    const result = new Map<string, OpenAIModelRaw>();
    for (const m of (data.data ?? []) as OpenAIModelRaw[]) {
      if (m.id) result.set(m.id, m);
    }
    return result;
  } catch (err) {
    console.warn("[modelCatalog] Failed to fetch OpenAI models:", err);
    return new Map();
  }
}

function isUsableGeminiModel(raw: GeminiModelRaw): boolean {
  const methods = raw.supportedGenerationMethods ?? [];
  return methods.includes("generateContent") || methods.includes("streamGenerateContent");
}

function isUsableOpenAIModel(id: string): boolean {
  return id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4");
}

function deriveProviderOnlyKey(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

function inferCategoriesFromModelId(id: string, provider: string): ModelCategory[] {
  if (provider === "OpenAI Realtime" || id.includes("realtime")) return ["realtime"];
  if (id.includes("image") || id.includes("imagen")) return ["image"];
  if (id.includes("veo") || id.includes("video")) return ["video"];
  if (id.includes("tts") || id.includes("whisper") || id.includes("speech")) return [];
  if (id.includes("embed")) return [];
  return ["conversation", "feedback", "translation"];
}

async function runSunsetMigrations(models: CatalogEntry[]): Promise<void> {
  const now = new Date();
  const sunsetted = models.filter(
    m => m.status !== 'removed' && m.sunsetAt && new Date(m.sunsetAt) <= now && m.replacedBy
  );
  if (sunsetted.length === 0) return;

  const settingKeys = [
    "model_conversation", "model_feedback", "model_strategy", "model_scenario",
    "model_realtime", "model_emotion", "model_translation", "model_image",
    "model_video", "model_evaluation", "model_summarization",
  ];

  for (const key of settingKeys) {
    try {
      const setting = await storage.getSystemSetting(CATEGORY, key);
      if (!setting?.value) continue;
      const deprecated = sunsetted.find(m => m.value === setting.value);
      if (!deprecated || !deprecated.replacedBy) continue;

      console.log(`[modelCatalog] 🔄 Auto-migrating ${key}: "${deprecated.value}" → "${deprecated.replacedBy}" (sunset: ${deprecated.sunsetAt})`);
      await storage.upsertSystemSetting({
        category: CATEGORY,
        key,
        value: deprecated.replacedBy,
        description: `Auto-migrated from deprecated model "${deprecated.value}" on ${now.toISOString()}`,
      });
      await storage.upsertSystemSetting({
        category: "ai_audit",
        key: `sunset_migration_${key}_${Date.now()}`,
        value: JSON.stringify({
          key,
          from: deprecated.value,
          to: deprecated.replacedBy,
          reason: "sunset_date_passed",
          migratedAt: now.toISOString(),
        }),
        description: "Automatic model sunset migration record",
      });
    } catch (err) {
      console.error(`[modelCatalog] Failed to migrate setting ${key}:`, err);
    }
  }
}

export async function refreshCatalog(): Promise<ModelCatalog> {
  console.log("[modelCatalog] Refreshing model catalog...");
  const [geminiMap, openaiMap] = await Promise.all([
    fetchGeminiModels(),
    fetchOpenAIModels(),
  ]);

  const hasGeminiData = geminiMap.size > 0;
  const hasOpenAIData = openaiMap.size > 0;

  const now = new Date().toISOString();
  const registryModelIds = new Set(MODEL_REGISTRY.map(m => m.value));

  // Step 1: Map curated registry entries, annotating confirmedByProvider.
  const curatedEntries: CatalogEntry[] = MODEL_REGISTRY.map(m => {
    let confirmedByProvider: boolean;
    if (m.provider.startsWith("Google") && hasGeminiData) {
      confirmedByProvider = geminiMap.has(m.value);
    } else if (m.provider.startsWith("OpenAI") && hasOpenAIData) {
      confirmedByProvider = openaiMap.has(m.value);
    } else {
      confirmedByProvider = true;
    }
    return { ...m, confirmedByProvider };
  });

  // Step 2: Add provider-discovered models that are NOT in the curated registry.
  const discoveredEntries: CatalogEntry[] = [];

  if (hasGeminiData) {
    Array.from(geminiMap.entries()).forEach(([id, raw]) => {
      if (registryModelIds.has(id)) return;
      if (!isUsableGeminiModel(raw)) return;
      const cats = inferCategoriesFromModelId(id, "Google");
      if (cats.length === 0) return;
      discoveredEntries.push({
        value: id,
        modelKey: deriveProviderOnlyKey(id),
        provider: "Google",
        recommended: false,
        categories: cats,
        status: "active",
        description: raw.displayName ?? id,
        confirmedByProvider: true,
      });
    });
  }

  if (hasOpenAIData) {
    Array.from(openaiMap.keys()).forEach(id => {
      if (registryModelIds.has(id)) return;
      if (!isUsableOpenAIModel(id)) return;
      const cats = inferCategoriesFromModelId(id, "OpenAI");
      if (cats.length === 0) return;
      discoveredEntries.push({
        value: id,
        modelKey: deriveProviderOnlyKey(id),
        provider: "OpenAI",
        recommended: false,
        categories: cats,
        status: "active",
        description: id,
        confirmedByProvider: true,
      });
    });
  }

  const entries: CatalogEntry[] = [...curatedEntries, ...discoveredEntries];

  await runSunsetMigrations(entries);

  const catalog: ModelCatalog = { models: entries, refreshedAt: now };
  cachedCatalog = catalog;

  try {
    await storage.upsertSystemSetting({
      category: CATEGORY,
      key: CATALOG_SETTING_KEY,
      value: JSON.stringify(catalog),
      description: "Cached AI model catalog with live provider confirmation",
    });
    await storage.upsertSystemSetting({
      category: CATEGORY,
      key: REFRESHED_AT_KEY,
      value: now,
      description: "Timestamp of last model catalog refresh",
    });
  } catch (err) {
    console.error("[modelCatalog] Failed to persist catalog to DB:", err);
  }

  console.log(
    `[modelCatalog] Catalog refreshed — ${curatedEntries.length} curated + ${discoveredEntries.length} discovered = ${entries.length} total models, refreshedAt=${now}`
  );
  return catalog;
}

export async function getCatalog(): Promise<ModelCatalog> {
  if (cachedCatalog) return cachedCatalog;

  try {
    const cached = await storage.getSystemSetting(CATEGORY, CATALOG_SETTING_KEY);
    if (cached?.value) {
      const parsed = JSON.parse(cached.value) as ModelCatalog;
      cachedCatalog = parsed;
      return parsed;
    }
  } catch (err) {
    console.warn("[modelCatalog] Failed to load catalog from DB, falling back to registry:", err);
  }

  const fallback: ModelCatalog = {
    models: MODEL_REGISTRY.map(m => ({ ...m, confirmedByProvider: true })),
    refreshedAt: new Date(0).toISOString(),
  };
  return fallback;
}

export function startCatalogScheduler(): void {
  const run = async () => {
    try {
      await refreshCatalog();
    } catch (err) {
      console.error("[modelCatalog] Scheduled refresh failed:", err);
    }
    refreshTimer = setTimeout(run, DAILY_MS);
  };

  if (refreshTimer) clearTimeout(refreshTimer);
  run();
}

export function stopCatalogScheduler(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}
