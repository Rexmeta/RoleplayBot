import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { AddressInfo } from 'net';

vi.mock('@google/genai', () => {
  const fakeBase64 = Buffer.from('fake-image').toString('base64');
  const generateContent = vi.fn().mockResolvedValue({
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: fakeBase64 } }],
        },
      },
    ],
  });

  class GoogleGenAI {
    models = { generateContent };
    constructor(_opts: unknown) {}
  }

  return { GoogleGenAI };
});

vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    getScenarioById: vi.fn().mockResolvedValue(null),
    updateScenario: vi.fn().mockResolvedValue(undefined),
    getAllScenarios: vi.fn().mockResolvedValue([]),
    getPersonaExpressionImages: vi.fn().mockResolvedValue([]),
    savePersonaExpressionImage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../server/services/mediaStorage', () => ({
  mediaStorage: {
    saveScenarioImage: vi.fn().mockResolvedValue({ imagePath: 'scenarios/test.webp' }),
    savePersonaImage: vi.fn().mockResolvedValue({ imagePath: 'personas/test/male/neutral.webp' }),
    readImageBuffer: vi.fn().mockResolvedValue(null),
    deleteMultipleFromStorage: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../server/services/gcsStorage', () => ({
  transformToSignedUrl: vi.fn().mockResolvedValue(null),
  isGCSAvailable: vi.fn().mockReturnValue(false),
  uploadToGCS: vi.fn().mockResolvedValue(''),
  deleteFromGCS: vi.fn().mockResolvedValue(undefined),
  normalizeObjectPath: vi.fn((p: string) => p),
  isCloudRun: vi.fn().mockReturnValue(false),
  downloadBufferFromGCS: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../server/services/aiUsageTracker', () => ({
  trackImageUsage: vi.fn(),
}));

vi.mock('sharp', () => {
  const chain = {
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake')),
  };
  return { default: vi.fn().mockReturnValue(chain) };
});

import imageGenerationRouter from '../../server/routes/imageGeneration';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/image', imageGenerationRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (err instanceof Error && 'status' in err && typeof (err as NodeJS.ErrnoException).status === 'number')
      ? (err as NodeJS.ErrnoException).status as number
      : 500;
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    res.status(status).json({ error: message });
  });

  return app;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/image`;
});

afterAll(() => {
  server.close();
});

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, body: json };
}

describe('POST /generate-scenario-image', () => {
  it('escapes <script> XSS payload in customPrompt before embedding it in the prompt', async () => {
    const malicious = '<script>alert("xss")</script>';
    const { status, body } = await post('/generate-scenario-image', {
      scenarioTitle: 'Test Scenario',
      customPrompt: malicious,
    });

    expect(status).toBe(200);
    expect(body.prompt).toBeDefined();
    expect(body.prompt).not.toContain('<script>');
    expect(body.prompt).toContain('&lt;script&gt;');
    expect(body.prompt).not.toContain('"xss"');
    expect(body.prompt).toContain('&quot;xss&quot;');
  });

  it('escapes & in customPrompt', async () => {
    const { status, body } = await post('/generate-scenario-image', {
      scenarioTitle: 'Test',
      customPrompt: 'foo & bar',
    });

    expect(status).toBe(200);
    expect(body.prompt).toContain('&amp;');
    expect(body.prompt).not.toMatch(/(?<!&amp)&(?!amp;|lt;|gt;|quot;|#x27;)/);
  });

  it('returns 400 when scenarioTitle is missing', async () => {
    const { status } = await post('/generate-scenario-image', {});
    expect(status).toBe(400);
  });
});

describe('POST /generate-preview', () => {
  it('escapes HTML tags in scenarioTitle before embedding in the prompt', async () => {
    const malicious = '<b>bold</b> scenario';
    const { status, body } = await post('/generate-preview', { scenarioTitle: malicious });

    expect(status).toBe(200);
    expect(body.prompt).toBeDefined();
    expect(body.prompt).not.toContain('<b>');
    expect(body.prompt).toContain('&lt;b&gt;');
  });

  it('escapes single-quote XSS attempt in scenarioTitle', async () => {
    const malicious = "'; DROP TABLE users; --";
    const { status, body } = await post('/generate-preview', { scenarioTitle: malicious });

    expect(status).toBe(200);
    expect(body.prompt).toContain('&#x27;');
    expect(body.prompt).not.toContain("'");
  });

  it('returns 400 when scenarioTitle is missing', async () => {
    const { status } = await post('/generate-preview', {});
    expect(status).toBe(400);
  });
});

describe('POST /generate-persona-base', () => {
  it('escapes HTML tags in imageStyle before embedding in the prompt', async () => {
    const { status, body } = await post('/generate-persona-base', {
      personaId: 'persona-1',
      mbti: 'INTJ',
      gender: 'male',
      imageStyle: '<style>body{display:none}</style>',
    });

    expect(status).toBe(200);
    expect(body.prompt).toBeDefined();
    expect(body.prompt).not.toContain('<style>');
    expect(body.prompt).toContain('&lt;style&gt;');
  });

  it('escapes HTML tags in personalityTraits before embedding in the prompt', async () => {
    const { status, body } = await post('/generate-persona-base', {
      personaId: 'persona-1',
      mbti: 'ENFJ',
      gender: 'female',
      personalityTraits: ['<script>evil()</script>', 'kind'],
    });

    expect(status).toBe(200);
    expect(body.prompt).toBeDefined();
    expect(body.prompt).not.toContain('<script>');
    expect(body.prompt).toContain('&lt;script&gt;');
  });

  it('returns 400 when required fields are missing', async () => {
    const { status } = await post('/generate-persona-base', { personaId: 'persona-1' });
    expect(status).toBe(400);
  });
});

describe('POST /generate-persona-expressions', () => {
  it('returns 500 when personaId contains < (script injection attempt)', async () => {
    const { status, body } = await post('/generate-persona-expressions', {
      personaId: '<script>alert(1)</script>',
      mbti: 'INTJ',
      gender: 'male',
    });

    expect(status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it('returns 500 when personaId contains / (path traversal attempt)', async () => {
    const { status, body } = await post('/generate-persona-expressions', {
      personaId: '../../../etc/passwd',
      mbti: 'INTJ',
      gender: 'male',
    });

    expect(status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it('returns 500 when gender contains <', async () => {
    const { status, body } = await post('/generate-persona-expressions', {
      personaId: 'valid-persona',
      mbti: 'INTJ',
      gender: '<script>',
    });

    expect(status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when required fields are missing', async () => {
    const { status } = await post('/generate-persona-expressions', { personaId: 'valid-persona' });
    expect(status).toBe(400);
  });
});

describe('POST /generate-persona-single-expression', () => {
  it('returns 500 when personaId contains < (img onerror injection)', async () => {
    const { status, body } = await post('/generate-persona-single-expression', {
      personaId: '<img onerror=alert(1) src=x>',
      mbti: 'ENFP',
      gender: 'female',
      emotion: '중립',
    });

    expect(status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it('returns 500 when personaId contains spaces', async () => {
    const { status, body } = await post('/generate-persona-single-expression', {
      personaId: 'persona with spaces',
      mbti: 'ENFP',
      gender: 'female',
      emotion: '중립',
    });

    expect(status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it('returns 500 when gender contains <', async () => {
    const { status, body } = await post('/generate-persona-single-expression', {
      personaId: 'valid-id',
      mbti: 'ENFP',
      gender: '<evil>',
      emotion: '중립',
    });

    expect(status).toBe(500);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when required fields are missing', async () => {
    const { status } = await post('/generate-persona-single-expression', { personaId: 'valid-id' });
    expect(status).toBe(400);
  });
});
