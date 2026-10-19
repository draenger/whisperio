import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Playwright's click-test harness lives in desktop/e2e/*.spec.ts, run via
    // its own `playwright.config.ts` (testDir 'e2e') — NOT vitest. Without this
    // exclude, vitest's default include glob (`**/*.{test,spec}.*`) would also
    // try to collect and run those specs as plain node tests, where
    // `_electron.launch()` has no business executing (see e2e/helpers.ts).
    exclude: [...configDefaults.exclude, 'e2e/**'],
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
      // Vitest 4's v8 provider remaps by AST (2026-10-19): same 928 tests, but it counts 476 functions where
      // Vitest 3 counted 285, so statements/functions read ~3-8 points lower for identical code
      // (Vitest 3: 92.8/87.8/97.2/92.8, Vitest 4: 89.4/82.7/89.3/90.8). Thresholds re-based to the new measure.
      thresholds: {
        statements: 89,
        branches: 82,
        functions: 89,
        lines: 90
      }
    }
  }
})
