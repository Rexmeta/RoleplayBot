/**
 * Integration tests for translation route AI SDK calls.
 *
 * Background
 * ----------
 * The wrong SDK method (`getGenerativeModel`) was silently swallowing errors in
 * production for all 6 translation call sites, causing auto-translate to always
 * report 0 translations. These tests verify the correct `GoogleGenAI.models.generateContent`
 * path is used and that translated counts / response shapes are correct.
 *
 * Endpoints covered
 * -----------------
 * POST /api/admin/scenarios/:id/auto-translate
 * POST /api/admin/scenarios/:id/generate-translation
 * POST /api/admin/personas/:id/generate-translation
 * POST /api/admin/generate-all-translations (contentType=personas)
 * POST /api/admin/generate-all-translations (contentType=categories)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Hoisted mocks (must be declared before vi.mock factories run) ────────────
const mockGenerateContent = vi.hoisted(() => vi.fn());

const mockStorage = vi.hoisted(() => ({
  getActiveSupportedLanguages: vi.fn(),
  getScenarioTranslation: vi.fn().mockResolvedValue(null),
  upsertScenarioTranslation: vi.fn().mockResolvedValue({}),
  getAllScenarios: vi.fn().mockResolvedValue([]),
  getAllMbtiPersonas: vi.fn().mockResolvedValue([]),
  getPersonaTranslation: vi.fn().mockResolvedValue(null),
  upsertPersonaTranslation: vi.fn().mockResolvedValue({}),
  getAllCategories: vi.fn().mockResolvedValue([]),
  getCategoryTranslation: vi.fn().mockResolvedValue(null),
  upsertCategoryTranslation: vi.fn().mockResolvedValue({}),
}));

const mockFileManager = vi.hoisted(() => ({
  getAllScenarios: vi.fn(),
  getAllPersonas: vi.fn().mockResolvedValue([]),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return { models: { generateContent: mockGenerateContent } };
  }),
}));

vi.mock('../../server/middleware/authMiddleware', () => ({
  isOperatorOrAdmin: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../server/storage', () => ({
  storage: mockStorage,
}));

vi.mock('../../server/services/fileManager', () => ({
  fileManager: mockFileManager,
}));

// ─── Import router after mocks ────────────────────────────────────────────────
import createTranslationsRouter from '../../server/routes/translations';

// ─── Test fixtures ────────────────────────────────────────────────────────────
const SCENARIO_ID = 'scenario-test-1';
const PERSONA_ID = 'persona-test-1';

const MOCK_SCENARIO = {
  id: SCENARIO_ID,
  title: 'Test Scenario',
  description: 'A test scenario description',
  context: {
    situation: 'A difficult meeting',
    timeline: 'Immediate',
    stakes: 'High',
    playerRole: {
      position: 'Manager',
      department: 'Sales',
      experience: '3 years',
      responsibility: 'Team lead',
    },
  },
  objectives: ['Resolve conflict', 'Build rapport'],
  skills: ['Communication', 'Empathy'],
  successCriteria: {
    optimal: 'Full resolution',
    good: 'Partial resolution',
    acceptable: 'Maintained relationship',
    failure: 'Escalation occurred',
  },
  personas: [
    {
      id: 'persona-1',
      name: 'Kim Ji-won',
      position: 'Senior Developer',
      department: 'Engineering',
      role: 'Subordinate',
      stance: 'Resistant',
      goal: 'Protect team morale',
      tradeoff: 'May compromise on timeline',
    },
  ],
};

const MOCK_PERSONA = {
  id: PERSONA_ID,
  mbti: 'INTJ',
  personalityTraits: ['Strategic', 'Independent', 'Decisive'],
  communicationStyle: 'A strategic thinker who values efficiency.',
};

const MOCK_CATEGORY = {
  id: 1,
  name: 'Conflict Resolution',
  description: 'Scenarios involving workplace conflicts',
};

const ACTIVE_LANGUAGES = [
  { code: 'ko', name: 'Korean', nativeName: '한국어', isActive: true, isDefault: true },
  { code: 'en', name: 'English', nativeName: 'English', isActive: true, isDefault: false },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', isActive: true, isDefault: false },
];

function makeTranslationJson(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    title: 'Translated Title',
    description: 'Translated description',
    situation: 'Translated situation',
    timeline: 'Translated timeline',
    stakes: 'Translated stakes',
    playerRole: 'Translated player role',
    objectives: ['Translated objective 1'],
    skills: ['Translated skill 1'],
    successCriteriaOptimal: 'Translated optimal',
    successCriteriaGood: 'Translated good',
    successCriteriaAcceptable: 'Translated acceptable',
    successCriteriaFailure: 'Translated failure',
    ...overrides,
  });
}

function makePersonaTranslationJson(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    name: 'Translated INTJ',
    personalityTraits: ['Translated trait 1', 'Translated trait 2'],
    communicationStyle: 'Translated communication style',
    motivation: 'Translated motivation',
    fears: ['Translated fear 1'],
    personalityDescription: 'Translated personality description',
    education: 'Translated education',
    previousExperience: 'Translated experience',
    majorProjects: ['Translated project 1'],
    expertise: ['Translated expertise 1'],
    ...overrides,
  });
}

function makeCategoryTranslationJson(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    name: 'Translated Category',
    description: 'Translated category description',
    ...overrides,
  });
}

function isAuthenticated(_req: any, _res: any, next: any) {
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', role: 'admin' };
    next();
  });
  app.use(createTranslationsRouter(isAuthenticated));
  return app;
}

// ─── Tests: auto-translate ────────────────────────────────────────────────────

describe('POST /api/admin/scenarios/:id/auto-translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_API_KEY = 'test-api-key';
    mockFileManager.getAllScenarios.mockResolvedValue([MOCK_SCENARIO]);
    mockStorage.getActiveSupportedLanguages.mockResolvedValue(ACTIVE_LANGUAGES);
    mockStorage.upsertScenarioTranslation.mockResolvedValue({});
  });

  it('returns 404 when scenario is not found', async () => {
    mockFileManager.getAllScenarios.mockResolvedValue([]);
    const res = await request(buildApp())
      .post('/api/admin/scenarios/nonexistent/auto-translate')
      .send({ sourceLocale: 'ko' });
    expect(res.status).toBe(404);
  });

  it('calls GoogleGenAI.models.generateContent (not getGenerativeModel) for each target locale', async () => {
    mockGenerateContent.mockResolvedValue({ text: makeTranslationJson() });

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/auto-translate`)
      .send({ sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    // en and ja are the two non-ko locales
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('returns translatedCount matching the number of successful AI translations', async () => {
    mockGenerateContent.mockResolvedValue({ text: makeTranslationJson() });

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/auto-translate`)
      .send({ sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.translatedCount).toBe(2); // en + ja
    expect(res.body.targetLocales).toEqual(expect.arrayContaining(['en', 'ja']));
  });

  it('returns translatedCount 0 when AI call fails for all locales', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI service unavailable'));

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/auto-translate`)
      .send({ sourceLocale: 'ko' });

    // Route catches individual errors and continues; overall request still succeeds
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.translatedCount).toBe(0);
  });

  it('returns translatedCount 0 when AI returns non-JSON text', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Sorry, I cannot help with that.' });

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/auto-translate`)
      .send({ sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.translatedCount).toBe(0);
  });

  it('upserts the source locale translation before translating targets', async () => {
    mockGenerateContent.mockResolvedValue({ text: makeTranslationJson() });

    await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/auto-translate`)
      .send({ sourceLocale: 'ko' });

    // First upsert call should be for the source locale (ko)
    const firstCall = mockStorage.upsertScenarioTranslation.mock.calls[0][0];
    expect(firstCall.locale).toBe('ko');
    expect(firstCall.isOriginal).toBe(true);
    expect(firstCall.isMachineTranslated).toBe(false);
  });

  it('marks machine-translated entries with isMachineTranslated: true', async () => {
    mockGenerateContent.mockResolvedValue({ text: makeTranslationJson() });

    await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/auto-translate`)
      .send({ sourceLocale: 'ko' });

    // All non-source upserts should be machine translated
    const translationCalls = mockStorage.upsertScenarioTranslation.mock.calls.slice(1);
    expect(translationCalls.length).toBeGreaterThan(0);
    for (const [call] of translationCalls) {
      expect(call.isMachineTranslated).toBe(true);
      expect(call.isReviewed).toBe(false);
    }
  });

  it('returns success with fatalError when GOOGLE_API_KEY is missing', async () => {
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/auto-translate`)
      .send({ sourceLocale: 'ko' });

    // Factory detects missing API key as a fatal credential error — returns 200 with fatalError
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.translatedCount).toBe(0);
    expect(res.body.fatalError).toBeTruthy();
  });
});

// ─── Tests: generate-translation ─────────────────────────────────────────────

describe('POST /api/admin/scenarios/:id/generate-translation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_API_KEY = 'test-api-key';
    mockFileManager.getAllScenarios.mockResolvedValue([MOCK_SCENARIO]);
    mockStorage.getActiveSupportedLanguages.mockResolvedValue(ACTIVE_LANGUAGES);
    mockStorage.getScenarioTranslation.mockResolvedValue(null);
  });

  it('returns 400 when targetLocale is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when sourceLocale equals targetLocale', async () => {
    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'ko', sourceLocale: 'ko' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when scenario is not found', async () => {
    mockFileManager.getAllScenarios.mockResolvedValue([]);
    const res = await request(buildApp())
      .post('/api/admin/scenarios/nonexistent/generate-translation')
      .send({ targetLocale: 'en' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when targetLocale is not in supported languages', async () => {
    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'fr' }); // fr is not in ACTIVE_LANGUAGES
    expect(res.status).toBe(400);
  });

  it('calls GoogleGenAI.models.generateContent exactly once', async () => {
    mockGenerateContent.mockResolvedValue({ text: makeTranslationJson() });

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('returns success: true and translation object when AI responds correctly', async () => {
    const translationPayload = {
      title: 'Translated Title EN',
      description: 'Translated description EN',
      situation: 'Translated situation EN',
      timeline: 'Immediately',
      stakes: 'Very high',
      playerRole: 'Senior Manager / Sales / 3 years / Team lead',
      objectives: ['Resolve conflict EN'],
      skills: ['Communication EN'],
      successCriteriaOptimal: 'Full resolution EN',
      successCriteriaGood: 'Partial resolution EN',
      successCriteriaAcceptable: 'Maintained relationship EN',
      successCriteriaFailure: 'Escalation occurred EN',
    };

    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(translationPayload) });

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.translation).toBeDefined();
    expect(res.body.translation.title).toBe('Translated Title EN');
    expect(res.body.translation.objectives).toEqual(['Resolve conflict EN']);
  });

  it('returns 500 when AI returns non-JSON text', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'I cannot help with that.' });

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(500);
  });

  it('returns 500 when AI call throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'));

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(500);
  });

  it('returns 500 when GOOGLE_API_KEY is missing', async () => {
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(500);
  });

  it('extracts JSON embedded in surrounding prose via regex', async () => {
    const jsonPart = makeTranslationJson({ title: 'Extracted Title' });
    mockGenerateContent.mockResolvedValue({
      text: `Here is the translation:\n${jsonPart}\nEnd of translation.`,
    });

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.translation.title).toBe('Extracted Title');
  });

  it('fetches source translation from DB when sourceLocale is not ko', async () => {
    const sourceTranslation = {
      title: 'English Title',
      description: 'English description',
      situation: 'English situation',
      timeline: 'English timeline',
      stakes: 'English stakes',
      playerRole: 'English role',
      objectives: ['English objective'],
      skills: ['English skill'],
      successCriteriaOptimal: 'English optimal',
      successCriteriaGood: 'English good',
      successCriteriaAcceptable: 'English acceptable',
      successCriteriaFailure: 'English failure',
      personaContexts: [],
    };
    mockStorage.getScenarioTranslation.mockResolvedValue(sourceTranslation);
    mockGenerateContent.mockResolvedValue({ text: makeTranslationJson({ title: 'Japanese Title' }) });

    const res = await request(buildApp())
      .post(`/api/admin/scenarios/${SCENARIO_ID}/generate-translation`)
      .send({ targetLocale: 'ja', sourceLocale: 'en' });

    expect(res.status).toBe(200);
    expect(mockStorage.getScenarioTranslation).toHaveBeenCalledWith(SCENARIO_ID, 'en');
    expect(res.body.translation.title).toBe('Japanese Title');
  });
});

// ─── Tests: personas/:id/generate-translation ────────────────────────────────

describe('POST /api/admin/personas/:id/generate-translation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_API_KEY = 'test-api-key';
    mockStorage.getAllMbtiPersonas.mockResolvedValue([MOCK_PERSONA]);
    mockStorage.getPersonaTranslation.mockResolvedValue(null);
  });

  it('returns 400 when targetLocale is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/generate-translation`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when persona is not found', async () => {
    mockStorage.getAllMbtiPersonas.mockResolvedValue([]);
    const res = await request(buildApp())
      .post('/api/admin/personas/nonexistent/generate-translation')
      .send({ targetLocale: 'en' });
    expect(res.status).toBe(404);
  });

  it('calls GoogleGenAI.models.generateContent exactly once', async () => {
    mockGenerateContent.mockResolvedValue({ text: makePersonaTranslationJson() });

    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('returns success: true and translation object with name and personalityDescription', async () => {
    mockGenerateContent.mockResolvedValue({
      text: makePersonaTranslationJson({
        name: 'INTJ EN',
        personalityDescription: 'A strategic thinker in English.',
      }),
    });

    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.translation).toBeDefined();
    expect(res.body.translation.name).toBe('INTJ EN');
    expect(res.body.translation.personalityDescription).toBe('A strategic thinker in English.');
  });

  it('returns 500 when AI returns non-JSON text', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'I cannot help with that.' });

    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(500);
  });

  it('returns 500 when AI call throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'));

    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(500);
  });

  it('returns 500 when GOOGLE_API_KEY is missing', async () => {
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(500);
  });

  it('fetches source translation from DB when sourceLocale is not ko', async () => {
    const sourceTranslation = {
      name: 'INTJ EN',
      personalityDescription: 'English description of INTJ',
    };
    mockStorage.getPersonaTranslation.mockResolvedValue(sourceTranslation);
    mockGenerateContent.mockResolvedValue({
      text: makePersonaTranslationJson({ name: 'INTJ JA', personalityDescription: 'Japanese INTJ desc' }),
    });

    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/generate-translation`)
      .send({ targetLocale: 'ja', sourceLocale: 'en' });

    expect(res.status).toBe(200);
    expect(mockStorage.getPersonaTranslation).toHaveBeenCalledWith(PERSONA_ID, 'en');
    expect(res.body.translation.name).toBe('INTJ JA');
  });

  it('extracts JSON embedded in surrounding prose via regex', async () => {
    const jsonPart = makePersonaTranslationJson({ name: 'Extracted INTJ' });
    mockGenerateContent.mockResolvedValue({
      text: `Here is the translation:\n${jsonPart}\nEnd.`,
    });

    const res = await request(buildApp())
      .post(`/api/admin/personas/${PERSONA_ID}/generate-translation`)
      .send({ targetLocale: 'en', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.translation.name).toBe('Extracted INTJ');
  });
});

// ─── Tests: generate-all-translations (contentType=personas) ─────────────────

describe('POST /api/admin/generate-all-translations (contentType=personas)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_API_KEY = 'test-api-key';
    mockStorage.getActiveSupportedLanguages.mockResolvedValue(ACTIVE_LANGUAGES);
    mockStorage.getAllMbtiPersonas.mockResolvedValue([MOCK_PERSONA]);
    mockStorage.getPersonaTranslation.mockResolvedValue(null);
    mockStorage.upsertPersonaTranslation.mockResolvedValue({});
  });

  it('returns 400 when targetLocale is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ contentType: 'personas' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when contentType is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when sourceLocale equals targetLocale', async () => {
    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'ko', sourceLocale: 'ko', contentType: 'personas' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when targetLocale is not in supported languages', async () => {
    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'fr', contentType: 'personas', sourceLocale: 'ko' });
    expect(res.status).toBe(400);
  });

  it('calls GoogleGenAI.models.generateContent for each persona without existing translation', async () => {
    mockGenerateContent.mockResolvedValue({ text: makePersonaTranslationJson() });

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'personas', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('returns count matching the number of successful persona translations', async () => {
    const personas = [
      { id: 'p-1', mbti: 'INTJ', personalityTraits: ['Strategic'], communicationStyle: '' },
      { id: 'p-2', mbti: 'ENFP', personalityTraits: ['Creative'], communicationStyle: '' },
    ];
    mockStorage.getAllMbtiPersonas.mockResolvedValue(personas);
    mockGenerateContent.mockResolvedValue({ text: makePersonaTranslationJson() });

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'personas', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
  });

  it('skips personas that already have a translation', async () => {
    mockStorage.getPersonaTranslation.mockResolvedValue({ name: 'Existing', personalityDescription: 'Exists' });

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'personas', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns count 0 when AI call fails for all personas', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI unavailable'));

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'personas', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(0);
  });

  it('upserts persona translation with isMachineTranslated: true', async () => {
    mockGenerateContent.mockResolvedValue({ text: makePersonaTranslationJson() });

    await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'personas', sourceLocale: 'ko' });

    expect(mockStorage.upsertPersonaTranslation).toHaveBeenCalledTimes(1);
    const upsertArg = mockStorage.upsertPersonaTranslation.mock.calls[0][0];
    expect(upsertArg.isMachineTranslated).toBe(true);
    expect(upsertArg.isReviewed).toBe(false);
    expect(upsertArg.locale).toBe('en');
    expect(upsertArg.personaId).toBe(MOCK_PERSONA.id);
  });
});

// ─── Tests: generate-all-translations (contentType=categories) ───────────────

describe('POST /api/admin/generate-all-translations (contentType=categories)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_API_KEY = 'test-api-key';
    mockStorage.getActiveSupportedLanguages.mockResolvedValue(ACTIVE_LANGUAGES);
    mockStorage.getAllCategories.mockResolvedValue([MOCK_CATEGORY]);
    mockStorage.getCategoryTranslation.mockResolvedValue(null);
    mockStorage.upsertCategoryTranslation.mockResolvedValue({});
  });

  it('calls GoogleGenAI.models.generateContent for each category without existing translation', async () => {
    mockGenerateContent.mockResolvedValue({ text: makeCategoryTranslationJson() });

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'categories', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('returns count matching the number of successful category translations', async () => {
    const categories = [
      { id: 1, name: 'Conflict', description: 'Conflict scenarios' },
      { id: 2, name: 'Leadership', description: 'Leadership scenarios' },
    ];
    mockStorage.getAllCategories.mockResolvedValue(categories);
    mockGenerateContent.mockResolvedValue({ text: makeCategoryTranslationJson() });

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'categories', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
  });

  it('skips categories that already have a translation', async () => {
    mockStorage.getCategoryTranslation.mockResolvedValue({ name: 'Existing', description: 'Exists' });

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'categories', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns count 0 when AI call fails for all categories', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI unavailable'));

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'categories', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(0);
  });

  it('upserts category translation with isMachineTranslated: true', async () => {
    mockGenerateContent.mockResolvedValue({ text: makeCategoryTranslationJson() });

    await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'categories', sourceLocale: 'ko' });

    expect(mockStorage.upsertCategoryTranslation).toHaveBeenCalledTimes(1);
    const upsertArg = mockStorage.upsertCategoryTranslation.mock.calls[0][0];
    expect(upsertArg.isMachineTranslated).toBe(true);
    expect(upsertArg.isReviewed).toBe(false);
    expect(upsertArg.locale).toBe('en');
    expect(upsertArg.categoryId).toBe(String(MOCK_CATEGORY.id));
  });

  it('returns count 0 when AI returns non-JSON text', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'Not a JSON response' });

    const res = await request(buildApp())
      .post('/api/admin/generate-all-translations')
      .send({ targetLocale: 'en', contentType: 'categories', sourceLocale: 'ko' });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});
