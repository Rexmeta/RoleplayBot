import { unzipSync, zipSync } from 'fflate';

/**
 * The external scenario interchange contract.
 *
 * Keep this type deliberately independent from ComplexScenario and the database
 * row.  Adding a column to either of those types must not make it exportable.
 */
export interface PortableScenarioPersona {
  id: string;
  name: string;
  department?: string;
  position?: string;
  experience?: string;
  personaRef?: string;
  stance?: string;
  goal?: string;
  tradeoff?: string;
  gender?: string;
  mbti?: string;
  isPrimary?: boolean;
  triggerHints?: string[];
  entryLine?: string;
  voiceId?: string | null;
  npcBehaviorHarness?: Record<string, unknown>;
}

export interface PortableScenario {
  title: string;
  description?: string;
  sourceLocale?: string;
  estimatedTime?: string;
  skills?: string[];
  objectiveType?: string;
  context?: Record<string, unknown>;
  objectives?: string[];
  successCriteria?: Record<string, unknown>;
  personas?: PortableScenarioPersona[];
  recommendedFlow?: string[];
  flowGraph?: Record<string, unknown>;
  personaSwitchRules?: Record<string, unknown>;
  image?: string;
  introVideoUrl?: string;
}

/**
 * A scenario as it may be received from the admin API.  The extra properties
 * are intentionally accepted here only so safeScenarioFileName can continue
 * to use the database ID and legacy callers can be typed.  They are never
 * returned by serializeScenario.
 */
export interface ExportableScenario extends Partial<PortableScenario> {
  id?: string | number;
  // Legacy/internal source fields. Never add these to PortableScenario.
  difficulty?: number;
  imagePrompt?: string;
  introVideoMode?: string;
  modelVideoOverride?: string;
  videoPrompt?: string;
  isDemo?: boolean;
  isPublic?: boolean;
  categoryId?: string | number;
  evaluationCriteriaSetId?: string | number;
  useVideoAvatar?: boolean;
  targetDurationMinutes?: number;
  targetTurns?: number;
  minValidTurns?: number;
  simulationHarness?: unknown;
  evaluationHarness?: unknown;
  terminationRules?: unknown;
  playerConstraints?: unknown;
  difficultyProfile?: unknown;
  analyticsSpec?: unknown;
  storeListed?: boolean;
  storePriceUsd?: number;
  storePackId?: string;
}

const PORTABLE_SCENARIO_FIELDS = [
  'title',
  'description',
  'sourceLocale',
  'estimatedTime',
  'skills',
  'objectiveType',
  'context',
  'objectives',
  'successCriteria',
  'personas',
  'recommendedFlow',
  'flowGraph',
  'personaSwitchRules',
  'image',
  'introVideoUrl',
] as const;

const PORTABLE_PERSONA_FIELDS = [
  'id',
  'name',
  'department',
  'position',
  'experience',
  'personaRef',
  'stance',
  'goal',
  'tradeoff',
  'gender',
  'mbti',
  'isPrimary',
  'triggerHints',
  'entryLine',
  'voiceId',
  'npcBehaviorHarness',
] as const;

function pickDefined(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  return result;
}

function serializePersona(persona: unknown): Record<string, unknown> {
  if (!persona || typeof persona !== 'object' || Array.isArray(persona)) return {};
  return pickDefined(persona as Record<string, unknown>, PORTABLE_PERSONA_FIELDS);
}

/**
 * Project any scenario-shaped object onto the portable contract.  This is the
 * only serializer used by both individual JSON and ZIP exports.
 */
export function serializeScenario(scenario: ExportableScenario): Record<string, unknown> {
  const source = scenario as Record<string, unknown>;
  const result = pickDefined(source, PORTABLE_SCENARIO_FIELDS);
  if (Array.isArray(source.personas)) {
    result.personas = source.personas.map(serializePersona);
  }
  return result;
}

export function scenarioJson(scenario: ExportableScenario): string {
  return JSON.stringify(serializeScenario(scenario), null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringArray(
  value: unknown,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value;
}

function readObject(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function normalizePersona(value: unknown, index: number): PortableScenarioPersona {
  if (!isRecord(value)) throw new Error(`personas[${index}] must be an object`);

  const result: Record<string, unknown> = {};
  for (const field of PORTABLE_PERSONA_FIELDS) {
    if (value[field] !== undefined) result[field] = value[field];
  }

  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error(`personas[${index}] requires string id and name`);
  }
  for (const field of [
    'department',
    'position',
    'experience',
    'personaRef',
    'stance',
    'goal',
    'tradeoff',
    'gender',
    'mbti',
    'entryLine',
  ]) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new Error(`personas[${index}].${field} must be a string`);
    }
  }
  if (value.isPrimary !== undefined && typeof value.isPrimary !== 'boolean') {
    throw new Error(`personas[${index}].isPrimary must be a boolean`);
  }
  readStringArray(value.triggerHints, `personas[${index}].triggerHints`);
  if (value.voiceId !== undefined && value.voiceId !== null && typeof value.voiceId !== 'string') {
    throw new Error(`personas[${index}].voiceId must be a string or null`);
  }
  readObject(value.npcBehaviorHarness, `personas[${index}].npcBehaviorHarness`);
  return result as unknown as PortableScenarioPersona;
}

/**
 * Normalize legacy or portable input before it is sent to the create API.
 * Unknown and internal fields are ignored rather than copied through.
 */
export function normalizeScenarioImport(value: unknown): PortableScenario {
  if (!isRecord(value)) throw new Error('Scenario must be an object');
  if (typeof value.title !== 'string' || value.title.trim().length === 0) {
    throw new Error('Scenario title is required');
  }

  const result: Record<string, unknown> = { title: value.title };
  const stringFields = [
    'description',
    'sourceLocale',
    'estimatedTime',
    'objectiveType',
    'image',
    'introVideoUrl',
  ] as const;
  for (const field of stringFields) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new Error(`${field} must be a string`);
    }
    if (value[field] !== undefined) result[field] = value[field];
  }

  for (const field of ['skills', 'objectives', 'recommendedFlow'] as const) {
    const items = readStringArray(value[field], field);
    if (items !== undefined) result[field] = items;
  }
  for (const field of ['context', 'successCriteria', 'flowGraph', 'personaSwitchRules'] as const) {
    const objectValue = readObject(value[field], field);
    if (objectValue !== undefined) result[field] = objectValue;
  }
  if (value.personas !== undefined) {
    if (!Array.isArray(value.personas)) throw new Error('personas must be an array');
    result.personas = value.personas.map(normalizePersona);
  }

  return result as unknown as PortableScenario;
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