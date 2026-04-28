import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/client/**', 'happy-dom'],
    ],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'server/services/voice/geminiMessageHandler.ts',
        'server/services/voice/geminiReconnector.ts',
        'client/src/hooks/useAudioPlayback.ts',
        'client/src/hooks/useVoiceActivityDetection.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve('./client/src'),
      '@shared': path.resolve('./shared'),
    },
  },
});
