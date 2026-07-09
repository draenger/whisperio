import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'html'],
      // Measure coverage across the whole source tree...
      include: ['src/**/*.{ts,tsx}'],
      // ...but exclude code that can't be meaningfully unit-tested without a live
      // Electron main/renderer runtime (window/tray/IPC wiring, the preload bridge,
      // native auto-paste) or a full DOM + preload bridge (the React UI components).
      // These are exercised by manual/smoke testing, not unit tests, so counting them
      // would only produce noise. Everything with real, isolatable logic stays in.
      exclude: [
        'src/main/index.ts',
        'src/main/tray.ts',
        'src/main/settingsWindow.ts',
        'src/main/recordingsWindow.ts',
        'src/main/dictation/index.ts',
        'src/main/dictation/overlayWindow.ts',
        'src/main/dictation/autoPaste.ts',
        // Electron-runtime-only: safeStorage/Keychain, net, shell — exercised via
        // manual/smoke testing. The pure crypto core (secretCrypto.ts) IS tested.
        'src/main/secretVault.ts',
        'src/main/githubStore.ts',
        'src/main/githubSync.ts',
        'src/preload/**',
        'src/renderer/**/*.tsx',
        'src/renderer/**/*.d.ts',
        'src/renderer/hooks/**'
      ],
      // Release gate: tests must keep the testable logic well covered. CI runs
      // `npm run test:coverage`, which fails the build if any metric drops below this.
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 90,
        lines: 90
      }
    }
  }
})
