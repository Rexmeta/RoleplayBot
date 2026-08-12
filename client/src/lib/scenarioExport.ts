import { unzipSync, zipSync } from 'fflate';

export interface ExportableScenario {
  id?: string | number;
  title?: string;
  description?: string;
  difficulty?: number;
  estimatedTime?: string;
  skills?: unknown[];
  context?: unknown;
  objectives?: unknown[];
  successCriteria?: unknown;
  personas?: unknown[];
  recommendedFlow?: unknown[];
  image?: string;
  imagePrompt?: string;
  introVideoUrl?: string;
  introVideoMode?: string;
  modelVideoOverride?: string;
  videoPrompt?: string;
  objectiveType?: string;
  isDemo?: boolean;
  isPublic?: boolean;
  categoryId?: string | number;
  evaluationCriteriaSetId?: string | number;
}

/**
 * Keep this projection in sync with the legacy scenario export format.
 * Media files are intentionally represented by their existing URLs only.
 */
export function serializeScenario(scenario: ExportableScenario): Record<string, unknown> {
  const {
    id,
    title,
    description,
    difficulty,
    estimatedTime,
    skills,
    context,
    objectives,
    successCriteria,
    personas,
    recommendedFlow,
    image,
    imagePrompt,
    introVideoUrl,
    introVideoMode,
    modelVideoOverride,
    videoPrompt,
    objectiveType,
    isDemo,
    isPublic,
  } = scenario;

  return {
    id,
    title,
    description,
    difficulty,
    estimatedTime,
    skills,
    context,
    objectives,
    successCriteria,
    personas,
    recommendedFlow,
    image,
    imagePrompt,
    introVideoUrl,
    introVideoMode,
    modelVideoOverride,
    videoPrompt,
    objectiveType,
    isDemo,
    isPublic,
    categoryId: scenario.categoryId,
    evaluationCriteriaSetId: scenario.evaluationCriteriaSetId,
  };
}

export function scenarioJson(scenario: ExportableScenario): string {
  return JSON.stringify(serializeScenario(scenario), null, 2);
}

function normalizeFileNamePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Produce a portable name. The ID is always included so a blank title still
 * produces a useful name and two similarly titled scenarios remain distinct.
 */
export function safeScenarioFileName(scenario: ExportableScenario): string {
  const title = normalizeFileNamePart(String(scenario.title ?? ''));
  const id = normalizeFileNamePart(String(scenario.id ?? 'scenario'));
  const base = title || 'scenario';
  return `${base}-${id || 'scenario'}.json`;
}

export function uniqueScenarioFileNames(scenarios: ExportableScenario[]): string[] {
  const used = new Map<string, number>();
  return scenarios.map((scenario) => {
    const original = safeScenarioFileName(scenario);
    const extensionIndex = original.lastIndexOf('.json');
    const base = extensionIndex >= 0 ? original.slice(0, extensionIndex) : original;
    const occurrence = (used.get(original) ?? 0) + 1;
    used.set(original, occurrence);
    return occurrence === 1 ? original : `${base}-${occurrence}.json`;
  });
}

export function createScenariosZip(scenarios: ExportableScenario[]): Uint8Array {
  const names = uniqueScenarioFileNames(scenarios);
  const files: Record<string, Uint8Array> = {};
  scenarios.forEach((scenario, index) => {
    files[names[index]] = new TextEncoder().encode(scenarioJson(scenario));
  });
  return zipSync(files);
}

export interface ParsedScenarioImport {
  items: unknown[];
  invalidEntries: number;
}

function addParsedValue(value: unknown, result: ParsedScenarioImport): void {
  if (Array.isArray(value)) {
    result.items.push(...value);
  } else if (value && typeof value === 'object') {
    result.items.push(value);
  } else {
    result.invalidEntries += 1;
  }
}

export async function parseScenarioImportFile(file: File): Promise<ParsedScenarioImport> {
  const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip';
  if (!isZip) {
    const result: ParsedScenarioImport = { items: [], invalidEntries: 0 };
    addParsedValue(JSON.parse(await file.text()), result);
    return result;
  }

  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const jsonEntries = Object.entries(archive).filter(([name]) => name.toLowerCase().endsWith('.json'));
  if (jsonEntries.length === 0) {
    throw new Error('ZIP 파일 안에 JSON 시나리오 파일이 없습니다');
  }

  const result: ParsedScenarioImport = { items: [], invalidEntries: 0 };
  for (const [, bytes] of jsonEntries) {
    try {
      addParsedValue(JSON.parse(new TextDecoder().decode(bytes)), result);
    } catch {
      result.invalidEntries += 1;
    }
  }
  return result;
}