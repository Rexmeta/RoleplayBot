import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockStorage = vi.hoisted(() => ({
  getOriginalScenarioTranslation: vi.fn(),
  getScenarioTranslationWithFallback: vi.fn(),
  getAllScenarioTranslationLocales: vi.fn().mockResolvedValue([]),
  getAllMbtiPersonas: vi.fn().mockResolvedValue([]),
  getActiveSupportedLanguages: vi.fn().mockResolvedValue([{ code: 'ko' }]),
  getScenarioTranslations: vi.fn().mockResolvedValue([]),
  upsertScenarioTranslation: vi.fn(),
}));

const mockFileManager = vi.hoisted(() => ({
  getAllScenarios: vi.fn(),
  updateScenario: vi.fn(),
}));

const mockValidateScenario = vi.hoisted(() => vi.fn().mockReturnValue({
  score: 100,
  issues: [],
  hasFatalErrors: false,
}));

vi.mock('../../server/storage', () => ({ storage: mockStorage }));
vi.mock('../../server/services/fileManager', () => ({ fileManager: mockFileManager }));
vi.mock('../../server/services/scenarios/scenarioValidator', () => ({
  validateScenario: mockValidateScenario,
}));
vi.mock('../../server/middleware/authMiddleware', () => ({
  isOperatorOrAdmin: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../../server/routes/routerHelpers', () => ({
  asyncHandler: (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next),
  createHttpError: (status: number, message: string) => Object.assign(new Error(message), { status }),
  getOperatorAccessibleCategoryIds: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../server/services/aiScenarioGenerator', () => ({
  generateScenarioWithAI: vi.fn(),
  enhanceScenarioWithAI: vi.fn(),
  fillScenarioFieldsWithAI: vi.fn(),
  generateEvaluationHarnessWithAI: vi.fn(),
  generatePlayerConstraintsWithAI: vi.fn(),
  generateNpcBehaviorHarnessWithAI: vi.fn(),
}));
vi.mock('../../server/services/gemini-video-generator', () => ({
  generateIntroVideo: vi.fn(),
  deleteIntroVideo: vi.fn(),
  getVideoGenerationStatus: vi.fn(),
  getDefaultVideoPrompt: vi.fn(),
}));
vi.mock('../../server/routes/imageGeneration', () => ({ generateImagePrompt: vi.fn() }));
vi.mock('../../server/services/gcsStorage', () => ({
  transformScenariosMedia: vi.fn(async (scenarios: any[]) => scenarios),
  transformScenarioMedia: vi.fn(async (scenario: any) => scenario),
  transformToSignedUrl: vi.fn(),
  listGCSFiles: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../server/services/mediaStorage', () => ({
  mediaStorage: { saveToFixedPath: vi.fn() },
}));
vi.mock('../../server/utils/videoJobStore', () => ({
  videoJobStore: {
    create: vi.fn(),
    setRunning: vi.fn(),
    setDone: vi.fn(),
    setError: vi.fn(),
    get: vi.fn(),
  },
}));
vi.mock('../../server/services/videoAvatarAccess', () => ({
  requireVideoAvatarManagementAccess: vi.fn(),
}));

import createAdminScenariosRouter from '../../server/routes/adminScenarios';

const SCENARIO_ID = 'scenario-title-test';

function makeScenario(overrides: Record<string, any> = {}) {
  return {
    id: SCENARIO_ID,
    title: '기존 제목',
    description: '기존 설명',
    sourceLocale: 'ko',
    difficulty: 3,
    skills: [],
    categoryId: 'category-1',
    context: null,
    objectives: [],
    successCriteria: null,
    personas: [],
    recommendedFlow: [],
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: 'admin-1', role: 'admin', preferredLanguage: 'ko' };
    next();
  });
  app.use(createAdminScenariosRouter((_req: any, _res: any, next: any) => next()));
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.status || 500).json({ message: error.message });
  });
  return app;
}

describe('admin scenario title editing', () => {
  let currentScenario: ReturnType<typeof makeScenario>;
  let currentOriginalTranslation: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    currentScenario = makeScenario();
    currentOriginalTranslation = {
      scenarioId: SCENARIO_ID,
      locale: 'ko',
      sourceLocale: 'ko',
      isOriginal: true,
      title: currentScenario.title,
    };

    mockFileManager.getAllScenarios.mockImplementation(async () => [currentScenario]);
    mockFileManager.updateScenario.mockImplementation(async (_id: string, updates: Record<string, any>) => {
      currentScenario = { ...currentScenario, ...updates };
      return currentScenario;
    });
    mockStorage.getOriginalScenarioTranslation.mockImplementation(async () => currentOriginalTranslation);
    mockStorage.getScenarioTranslationWithFallback.mockImplementation(async () => currentOriginalTranslation);
    mockStorage.upsertScenarioTranslation.mockImplementation(async (translation: Record<string, any>) => {
      currentOriginalTranslation = { ...currentOriginalTranslation, ...translation };
      return currentOriginalTranslation;
    });
  });

  it('stores a trimmed title in the scenario and its original-language translation', async () => {
    const res = await request(buildApp())
      .put(`/api/admin/scenarios/${SCENARIO_ID}`)
      .send({ title: '  새 제목  ' });

    expect(res.status).toBe(200);
    expect(mockFileManager.updateScenario).toHaveBeenCalledWith(SCENARIO_ID, { title: '새 제목' });
    expect(mockStorage.upsertScenarioTranslation).toHaveBeenCalledWith(expect.objectContaining({
      scenarioId: SCENARIO_ID,
      locale: 'ko',
      sourceLocale: 'ko',
      isOriginal: true,
      title: '새 제목',
    }));
    expect(currentScenario.title).toBe('새 제목');
    expect(currentOriginalTranslation.title).toBe('새 제목');
  });

  it('shows the new title when the original edit data is fetched again', async () => {
    await request(buildApp())
      .put(`/api/admin/scenarios/${SCENARIO_ID}`)
      .send({ title: '수정된 제목' });

    const res = await request(buildApp())
      .get('/api/admin/scenarios?mode=edit');

    expect(res.status).toBe(200);
    expect(res.body[0].title).toBe('수정된 제목');
  });

  it.each(['', '   '])('rejects a %j title without changing either record', async (title) => {
    const res = await request(buildApp())
      .put(`/api/admin/scenarios/${SCENARIO_ID}`)
      .send({ title });

    expect(res.status).toBe(400);
    expect(mockFileManager.updateScenario).not.toHaveBeenCalled();
    expect(mockStorage.upsertScenarioTranslation).not.toHaveBeenCalled();
    expect(currentScenario.title).toBe('기존 제목');
    expect(currentOriginalTranslation.title).toBe('기존 제목');
  });

  it('keeps translated list data from being saved as the original scenario', async () => {
    const res = await request(buildApp())
      .put(`/api/admin/scenarios/${SCENARIO_ID}`)
      .send({ title: 'Translated title', _translated: true });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Cannot save translated content');
    expect(mockFileManager.updateScenario).not.toHaveBeenCalled();
    expect(mockStorage.upsertScenarioTranslation).not.toHaveBeenCalled();
  });
});