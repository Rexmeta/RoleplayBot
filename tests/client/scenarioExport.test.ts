import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  serializeScenario,
  scenarioJson,
  safeScenarioFileName,
  uniqueScenarioFileNames,
  createScenariosZip,
  parseScenarioImportFile,
  type ExportableScenario,
} from '../../client/src/lib/scenarioExport';
import { unzipSync } from 'fflate';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeScenario(overrides: Partial<ExportableScenario> = {}): ExportableScenario {
  return {
    id: 42,
    title: 'Test Scenario',
    description: 'A test',
    difficulty: 3,
    estimatedTime: '30',
    skills: ['negotiation'],
    context: { situation: 'office' },
    objectives: ['goal1'],
    successCriteria: { optimal: 'ok' },
    personas: [{ id: 'p1', name: 'Alice' }],
    recommendedFlow: ['step1'],
    image: 'img.png',
    imagePrompt: 'prompt',
    introVideoUrl: 'vid.mp4',
    introVideoMode: 'default',
    modelVideoOverride: '',
    videoPrompt: 'vprompt',
    objectiveType: 'negotiation',
    isDemo: false,
    isPublic: true,
    categoryId: 'cat1',
    evaluationCriteriaSetId: 'eval1',
    ...overrides,
  };
}

function makeFile(content: string, name: string, type = 'application/json'): File {
  return new File([content], name, { type });
}

// ── serializeScenario ─────────────────────────────────────────────────────────

describe('serializeScenario', () => {
  it('includes all expected fields', () => {
    const s = makeScenario();
    const out = serializeScenario(s);
    expect(out.id).toBe(42);
    expect(out.title).toBe('Test Scenario');
    expect(out.categoryId).toBe('cat1');
    expect(out.evaluationCriteriaSetId).toBe('eval1');
    expect(out.isPublic).toBe(true);
  });

  it('preserves undefined values for omitted optional fields', () => {
    const s = makeScenario({ imagePrompt: undefined });
    const out = serializeScenario(s);
    expect(Object.prototype.hasOwnProperty.call(out, 'imagePrompt')).toBe(true);
    expect(out.imagePrompt).toBeUndefined();
  });
});

// ── scenarioJson ──────────────────────────────────────────────────────────────

describe('scenarioJson', () => {
  it('produces valid JSON with 2-space indent', () => {
    const json = scenarioJson(makeScenario());
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe('Test Scenario');
    expect(json).toMatch(/  "title"/);   // 2-space indent
  });
});

// ── safeScenarioFileName ──────────────────────────────────────────────────────

describe('safeScenarioFileName', () => {
  it('produces title-id filename with .json extension', () => {
    const name = safeScenarioFileName({ title: 'Hello World', id: 7 });
    expect(name).toBe('Hello World-7.json');
  });

  it('strips forbidden filesystem characters', () => {
    const name = safeScenarioFileName({ title: 'A/B:C*D?', id: 1 });
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
    expect(name.endsWith('.json')).toBe(true);
  });

  it('handles blank title by falling back to "scenario"', () => {
    const name = safeScenarioFileName({ title: '', id: 5 });
    expect(name).toBe('scenario-5.json');
  });

  it('handles missing id by falling back to "scenario"', () => {
    const name = safeScenarioFileName({ title: 'My Scenario' });
    expect(name).toBe('My Scenario-scenario.json');
  });

  it('strips trailing dots and spaces from title part', () => {
    const name = safeScenarioFileName({ title: 'Trailing...', id: 3 });
    // Title part should not end with dots
    const base = name.replace(/-3\.json$/, '');
    expect(base).not.toMatch(/[. ]$/);
  });
});

// ── uniqueScenarioFileNames ───────────────────────────────────────────────────

describe('uniqueScenarioFileNames', () => {
  it('returns distinct names for distinct scenarios', () => {
    const names = uniqueScenarioFileNames([
      makeScenario({ title: 'Alpha', id: 1 }),
      makeScenario({ title: 'Beta', id: 2 }),
    ]);
    expect(names).toEqual(['Alpha-1.json', 'Beta-2.json']);
  });

  it('suffixes duplicate base names with -2, -3, etc.', () => {
    // Two scenarios that produce identical file names (same title AND same id → same base)
    const scenarios = [
      makeScenario({ title: 'Same', id: 99 }),
      makeScenario({ title: 'Same', id: 99 }),
    ];
    const names = uniqueScenarioFileNames(scenarios);
    expect(names[0]).toBe('Same-99.json');
    expect(names[1]).toBe('Same-99-2.json');
  });

  it('handles an empty list', () => {
    expect(uniqueScenarioFileNames([])).toEqual([]);
  });
});

// ── createScenariosZip ────────────────────────────────────────────────────────

describe('createScenariosZip', () => {
  it('returns a Uint8Array', () => {
    const zip = createScenariosZip([makeScenario()]);
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(zip.length).toBeGreaterThan(0);
  });

  it('contains one file per scenario', () => {
    const scenarios = [
      makeScenario({ title: 'A', id: 1 }),
      makeScenario({ title: 'B', id: 2 }),
    ];
    const zip = createScenariosZip(scenarios);
    const files = unzipSync(zip);
    const keys = Object.keys(files);
    expect(keys).toHaveLength(2);
  });

  it('each file parses to the serialized scenario', () => {
    const s = makeScenario({ title: 'ZIP Test', id: 77 });
    const zip = createScenariosZip([s]);
    const files = unzipSync(zip);
    const [[, bytes]] = Object.entries(files);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    expect(parsed.id).toBe(77);
    expect(parsed.title).toBe('ZIP Test');
  });

  it('file names inside ZIP match uniqueScenarioFileNames', () => {
    const scenarios = [
      makeScenario({ title: 'One', id: 10 }),
      makeScenario({ title: 'Two', id: 11 }),
    ];
    const zip = createScenariosZip(scenarios);
    const files = unzipSync(zip);
    const keys = Object.keys(files).sort();
    expect(keys).toContain('One-10.json');
    expect(keys).toContain('Two-11.json');
  });
});

// ── parseScenarioImportFile ───────────────────────────────────────────────────

describe('parseScenarioImportFile', () => {
  it('parses a JSON array file into items', async () => {
    const json = JSON.stringify([{ title: 'A' }, { title: 'B' }]);
    const file = makeFile(json, 'scenarios.json');
    const result = await parseScenarioImportFile(file);
    expect(result.items).toHaveLength(2);
    expect(result.invalidEntries).toBe(0);
  });

  it('parses a single JSON object file as one item', async () => {
    const json = JSON.stringify({ title: 'Single' });
    const file = makeFile(json, 'single.json');
    const result = await parseScenarioImportFile(file);
    expect(result.items).toHaveLength(1);
    expect(result.invalidEntries).toBe(0);
  });

  it('throws on a non-JSON file', async () => {
    const file = makeFile('not json!', 'bad.json');
    await expect(parseScenarioImportFile(file)).rejects.toThrow();
  });

  it('parses a ZIP with multiple JSON files', async () => {
    const s1 = makeScenario({ title: 'A', id: 1 });
    const s2 = makeScenario({ title: 'B', id: 2 });
    const zipBytes = createScenariosZip([s1, s2]);
    const zipFile = new File([zipBytes], 'scenarios.zip', { type: 'application/zip' });
    const result = await parseScenarioImportFile(zipFile);
    expect(result.items).toHaveLength(2);
    expect(result.invalidEntries).toBe(0);
    const titles = (result.items as any[]).map((i) => i.title);
    expect(titles).toContain('A');
    expect(titles).toContain('B');
  });

  it('counts corrupt ZIP JSON entries as invalidEntries', async () => {
    // Build a ZIP that contains one valid JSON and one invalid JSON file
    const { zipSync } = await import('fflate');
    const enc = new TextEncoder();
    const zipBytes = zipSync({
      'good.json': enc.encode(JSON.stringify({ title: 'Good' })),
      'bad.json': enc.encode('not valid json'),
    });
    const file = new File([zipBytes], 'mixed.zip', { type: 'application/zip' });
    const result = await parseScenarioImportFile(file);
    expect(result.items).toHaveLength(1);
    expect(result.invalidEntries).toBe(1);
  });

  it('throws when ZIP contains no JSON files', async () => {
    const { zipSync } = await import('fflate');
    const zipBytes = zipSync({ 'readme.txt': new TextEncoder().encode('hello') });
    const file = new File([zipBytes], 'empty.zip', { type: 'application/zip' });
    await expect(parseScenarioImportFile(file)).rejects.toThrow('JSON');
  });
});
