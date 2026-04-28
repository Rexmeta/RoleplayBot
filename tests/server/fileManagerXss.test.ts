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

vi.mock('../../server/storage', () => ({
  storage: {
    getAllScenarios: vi.fn().mockResolvedValue([]),
    getScenario: vi.fn().mockResolvedValue(null),
    createScenario: vi.fn().mockResolvedValue(undefined),
    updateScenario: vi.fn().mockResolvedValue({}),
    deleteScenario: vi.fn().mockResolvedValue(undefined),
    getAllMbtiPersonas: vi.fn().mockResolvedValue([]),
    getMbtiPersona: vi.fn().mockResolvedValue(null),
    createMbtiPersona: vi.fn().mockResolvedValue(undefined),
    updateMbtiPersona: vi.fn().mockResolvedValue(undefined),
    deleteMbtiPersona: vi.fn().mockResolvedValue(undefined),
  },
}));

import { FileManagerService } from '../../server/services/fileManager';

describe('FileManagerService — assertSafePathSegment enforcement', () => {
  let manager: FileManagerService;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new FileManagerService();
  });

  describe('savePersonaExpressionImage', () => {
    it('throws when personaId contains < (script injection attempt)', async () => {
      await expect(
        manager.savePersonaExpressionImage(
          '<script>alert(1)</script>',
          '중립',
          'data:image/png;base64,abc123'
        )
      ).rejects.toThrow(/Invalid persona ID|disallowed characters/i);
    });

    it('throws when personaId contains / (path traversal attempt)', async () => {
      await expect(
        manager.savePersonaExpressionImage(
          '../../../etc/passwd',
          '중립',
          'data:image/png;base64,abc123'
        )
      ).rejects.toThrow(/Invalid persona ID|disallowed characters/i);
    });

    it('throws when personaId contains spaces', async () => {
      await expect(
        manager.savePersonaExpressionImage(
          'persona with spaces',
          '중립',
          'data:image/png;base64,abc123'
        )
      ).rejects.toThrow(/Invalid persona ID|disallowed characters/i);
    });

    it('does not call fs.mkdir or fs.writeFile when personaId contains <', async () => {
      await expect(
        manager.savePersonaExpressionImage(
          '<img onerror=alert(1) src=x>',
          '중립',
          'data:image/png;base64,abc123'
        )
      ).rejects.toThrow();

      expect(fsMock.mkdir).not.toHaveBeenCalled();
      expect(fsMock.writeFile).not.toHaveBeenCalled();
    });

    it('proceeds normally for a safe personaId', async () => {
      const validBase64 = 'data:image/png;base64,' + Buffer.from('fake-image').toString('base64');
      const result = await manager.savePersonaExpressionImage('valid-persona-01', '중립', validBase64);

      expect(result).toMatch(/\/personas\/valid-persona-01\//);
      expect(fsMock.mkdir).toHaveBeenCalled();
      expect(fsMock.writeFile).toHaveBeenCalled();
    });
  });

  describe('getPersonaExpressionImages', () => {
    it('returns empty object when personaId contains < (error is handled internally)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await manager.getPersonaExpressionImages('<script>xss</script>');

      expect(result).toEqual({});
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('returns empty object when personaId contains / (path traversal)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await manager.getPersonaExpressionImages('../../etc/passwd');

      expect(result).toEqual({});
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not call fs.access when personaId contains <', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await manager.getPersonaExpressionImages('<evil>');

      expect(fsMock.access).not.toHaveBeenCalled();
    });

    it('proceeds normally for a safe personaId (directory not found returns empty object)', async () => {
      fsMock.access.mockRejectedValueOnce(new Error('ENOENT'));

      const result = await manager.getPersonaExpressionImages('safe-persona-id');

      expect(typeof result).toBe('object');
    });
  });

  describe('deletePersonaExpressionImages', () => {
    it('does not throw when personaId contains < (error is handled internally)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        manager.deletePersonaExpressionImages('<script>xss</script>')
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not call fs.rm when personaId contains <', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await manager.deletePersonaExpressionImages('<img src=x onerror=alert(1)>');

      expect(fsMock.rm).not.toHaveBeenCalled();
    });

    it('does not call fs.rm when personaId contains path traversal characters', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await manager.deletePersonaExpressionImages('../../../etc');

      expect(fsMock.rm).not.toHaveBeenCalled();
    });

    it('calls fs.rm when personaId is safe', async () => {
      await manager.deletePersonaExpressionImages('safe-persona-01');

      expect(fsMock.rm).toHaveBeenCalledWith(
        expect.stringContaining('safe-persona-01'),
        expect.objectContaining({ recursive: true })
      );
    });
  });
});
