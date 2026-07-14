// Editor-only ambient typing for `window.api` inside e2e specs (the
// contextBridge surface preload/index.ts exposes to every renderer window).
// Type-only import — erased entirely at compile time, so this carries none of
// preload/index.ts's `electron` runtime import into the plain-node Playwright
// test process. Not part of any tsconfig project (e2e/ is intentionally
// outside tsconfig.node.json / tsconfig.web.json — see vitest.config.ts's
// sibling exclude note), so this only helps IDE intellisense, never `npm run
// typecheck`.
import type { WhisperioAPI } from '../src/preload'

declare global {
  interface Window {
    api: WhisperioAPI
  }
}

export {}
