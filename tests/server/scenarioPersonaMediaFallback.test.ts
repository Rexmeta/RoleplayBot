/**
 * Scenario personas persisted through `normalisePersonaForDb` keep only a small set of
 * fields, so a stored persona regularly comes back with neither `videos` nor `image`.
 * Without a base portrait the chat window has no static layer behind the video buffers,
 * which is what produced a fully blank avatar whenever a clip failed to load.
 *
 * These tests lock in that `enrichScenarioPersonas` restores both from the MBTI persona
 * record, and that the base-portrait resolution ignores the empty-string placeholders the
 * DB stores for expressions that have not been generated yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
  readdir: vi.fn().mockResolvedValue([]),
  access: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs/promises', () => fsMock);

vi.mock('../../server/utils/mbtiLoader', () => ({
  enrichPersonaWithMBTI: vi.fn(async (p: unknown) => p),
  enrichPersonaWithBasicMBTI: vi.fn(async (p: unknown) => p),
}));

const storageMock = vi.hoisted(() => ({
  getScenario: vi.fn(),
  getMbtiPersona: vi.fn(),
  createScenario: vi.fn(),
}));

vi.mock('../../server/storage', () => ({ storage: storageMock }));

import { FileManagerService, resolveMbtiBaseImage } from '../../server/services/fileManager';

const MBTI_IMAGES = {
  base: 'personas/cp/male/neutral.webp',
  style: 'strict, perfectionist',
  male: {
    expressions: {
      '중립': 'personas/cp/male/neutral.webp',
      '기쁨': 'personas/cp/male/joy.webp',
    },
  },
  female: {
    expressions: {
      '중립': 'personas/cp/female/neutral.webp',
      '기쁨': '',
    },
  },
};

const MBTI_VIDEOS = {
  enabled: true,
  avatarId: 'cp',
  clips: {
    male: { listening_neutral: 'videos/avatar-cp-male-listening-neutral.mp4' },
    female: { listening_neutral: 'videos/avatar-cp-female-listening-neutral.mp4' },
  },
};

describe('resolveMbtiBaseImage', () => {
  it('prefers the requested gender neutral portrait', () => {
    expect(resolveMbtiBaseImage(MBTI_IMAGES, 'female')).toBe('personas/cp/female/neutral.webp');
    expect(resolveMbtiBaseImage(MBTI_IMAGES, 'male')).toBe('personas/cp/male/neutral.webp');
  });

  it('defaults to male when gender is missing', () => {
    expect(resolveMbtiBaseImage(MBTI_IMAGES, undefined)).toBe('personas/cp/male/neutral.webp');
  });

  it('accepts the English "neutral" key as well as the Korean label', () => {
    const images = { male: { expressions: { neutral: 'personas/x/male/neutral.webp' } } };
    expect(resolveMbtiBaseImage(images, 'male')).toBe('personas/x/male/neutral.webp');
  });

  it('falls back to the other gender when the requested one has only empty placeholders', () => {
    const images = {
      male: { expressions: { '중립': 'personas/x/male/neutral.webp' } },
      female: { expressions: { '중립': '', '기쁨': '' } },
    };
    expect(resolveMbtiBaseImage(images, 'female')).toBe('personas/x/male/neutral.webp');
  });

  it('falls back to `base` when no expression map yields a portrait', () => {
    const images = { base: 'personas/x/base.webp', male: { expressions: { '중립': '' } } };
    expect(resolveMbtiBaseImage(images, 'male')).toBe('personas/x/base.webp');
  });

  it('returns undefined when nothing usable is present', () => {
    expect(resolveMbtiBaseImage(undefined, 'male')).toBeUndefined();
    expect(resolveMbtiBaseImage(null, 'male')).toBeUndefined();
    expect(resolveMbtiBaseImage({ base: '   ' }, 'male')).toBeUndefined();
  });
});

describe('FileManagerService — scenario persona media enrichment', () => {
  let manager: FileManagerService;

  const dbScenario = (personas: unknown[]) => ({
    id: 'scenario-1',
    title: 'T',
    description: 'D',
    difficulty: 1,
    personas,
    useVideoAvatar: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new FileManagerService();
    storageMock.getMbtiPersona.mockResolvedValue({
      id: 'cp',
      images: MBTI_IMAGES,
      videos: MBTI_VIDEOS,
    });
  });

  it('restores both image and videos for a persona stored without media', async () => {
    storageMock.getScenario.mockResolvedValue(
      dbScenario([{ id: 'cp', name: '김민준', gender: 'male', personaRef: 'cp.json' }]),
    );

    const scenario = await manager.getScenarioById('scenario-1');
    const persona = scenario!.personas![0] as Record<string, unknown>;

    expect(persona.image).toBe('personas/cp/male/neutral.webp');
    expect(persona.videos).toEqual(MBTI_VIDEOS);
  });

  it('uses the persona gender when choosing the base portrait', async () => {
    storageMock.getScenario.mockResolvedValue(
      dbScenario([{ id: 'cp', name: '김민준', gender: 'female', personaRef: 'cp.json' }]),
    );

    const scenario = await manager.getScenarioById('scenario-1');
    const persona = scenario!.personas![0] as Record<string, unknown>;

    expect(persona.image).toBe('personas/cp/female/neutral.webp');
  });

  it('does not overwrite an image the scenario already defines', async () => {
    storageMock.getScenario.mockResolvedValue(
      dbScenario([
        { id: 'cp', name: '김민준', gender: 'male', personaRef: 'cp.json', image: 'scenarios/custom.webp' },
      ]),
    );

    const scenario = await manager.getScenarioById('scenario-1');
    const persona = scenario!.personas![0] as Record<string, unknown>;

    expect(persona.image).toBe('scenarios/custom.webp');
    expect(persona.videos).toEqual(MBTI_VIDEOS);
  });

  it('does not overwrite explicit clips already present on the persona', async () => {
    const ownClips = { enabled: true, clips: { male: { listening_neutral: 'videos/own-listening-neutral.mp4' } } };
    storageMock.getScenario.mockResolvedValue(
      dbScenario([{ id: 'cp', name: '김민준', gender: 'male', personaRef: 'cp.json', videos: ownClips }]),
    );

    const scenario = await manager.getScenarioById('scenario-1');
    const persona = scenario!.personas![0] as Record<string, unknown>;

    expect(persona.videos).toEqual(ownClips);
    expect(persona.image).toBe('personas/cp/male/neutral.webp');
  });

  it('leaves the persona untouched when the MBTI record has no media', async () => {
    storageMock.getMbtiPersona.mockResolvedValue({ id: 'cp', images: null, videos: null });
    storageMock.getScenario.mockResolvedValue(
      dbScenario([{ id: 'cp', name: '김민준', gender: 'male', personaRef: 'cp.json' }]),
    );

    const scenario = await manager.getScenarioById('scenario-1');
    const persona = scenario!.personas![0] as Record<string, unknown>;

    expect(persona.image).toBeUndefined();
    expect(persona.videos).toBeUndefined();
  });

  it('survives an MBTI lookup failure without dropping the persona', async () => {
    storageMock.getMbtiPersona.mockRejectedValue(new Error('db down'));
    storageMock.getScenario.mockResolvedValue(
      dbScenario([{ id: 'cp', name: '김민준', gender: 'male', personaRef: 'cp.json' }]),
    );

    const scenario = await manager.getScenarioById('scenario-1');
    const persona = scenario!.personas![0] as Record<string, unknown>;

    expect(persona.id).toBe('cp');
    expect(persona.image).toBeUndefined();
  });
});

// ── useVideoAvatar persistence ────────────────────────────────────────────────

/**
 * The video-avatar toggle lives on a column that defaults to false. If the create
 * path omits it, an admin who enables video avatars on a brand-new scenario sees
 * the switch flip itself off on the next reload, and chat silently falls back to
 * static images.
 */
describe('FileManagerService — useVideoAvatar survives create → reload', () => {
  let manager: FileManagerService;

  const baseScenario = {
    title: '영상 아바타 시나리오',
    description: 'D',
    difficulty: 3,
    personas: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new FileManagerService();
    storageMock.createScenario.mockImplementation(async (row: Record<string, unknown>) => row);
  });

  it('writes useVideoAvatar: true to the DB insert when the toggle is on', async () => {
    await manager.createScenario({ ...baseScenario, useVideoAvatar: true } as never);

    expect(storageMock.createScenario).toHaveBeenCalledTimes(1);
    expect(storageMock.createScenario.mock.calls[0][0]).toMatchObject({ useVideoAvatar: true });
  });

  it('writes useVideoAvatar: false rather than omitting it when the toggle is off', async () => {
    await manager.createScenario({ ...baseScenario, useVideoAvatar: false } as never);

    const row = storageMock.createScenario.mock.calls[0][0];
    expect(row).toHaveProperty('useVideoAvatar', false);
  });

  it('defaults to false when the caller does not send the field at all', async () => {
    await manager.createScenario(baseScenario as never);

    expect(storageMock.createScenario.mock.calls[0][0]).toMatchObject({ useVideoAvatar: false });
  });

  it('reads the flag back on reload so the admin toggle stays on', async () => {
    await manager.createScenario({ ...baseScenario, useVideoAvatar: true } as never);
    const storedRow = storageMock.createScenario.mock.calls[0][0];

    // Simulate the reload: the DB hands the stored row straight back.
    storageMock.getScenario.mockResolvedValue(storedRow);
    const reloaded = await manager.getScenarioById(storedRow.id as string);

    expect(reloaded?.useVideoAvatar).toBe(true);
  });
});
