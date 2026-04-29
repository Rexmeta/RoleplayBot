import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/client/**', 'happy-dom'],
      ['client/src/**/__tests__/**', 'happy-dom'],
    ],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'server/services/voice/geminiMessageHandler.ts',
        'server/services/voice/geminiReconnector.ts',
        'server/services/voice/clientMessageHandler.ts',
        'client/src/hooks/useAudioPlayback.ts',
        'client/src/hooks/useVoiceActivityDetection.ts',
        'client/src/components/report/generatePrintableContent.ts',
        'client/src/components/report/reportUtils.ts',
        'client/src/components/report/reportStyles.ts',
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
