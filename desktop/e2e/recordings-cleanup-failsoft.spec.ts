import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openSettingsWindow, openTab } from './helpers'

// P0.1 click-test (c): the RecordingsPanel "Clean up" action, clicked with NO
// AI provider reachable, must fail SOFT — raw transcript kept, a quiet inline
// hint shown — never an error dialog, never a hang. This is the real click
// path for the offline-fail-soft invariant, not a unit test of the guard.
//
// aiProvider is pinned to 'local' with no local server running, so the
// provider-selection call never touches the network (see
// src/main/transcribe.ts's buildCleanupCandidates + llm/provider.ts's
// selectProvider — a same-id 'local' target with no other local candidate
// short-circuits to `provider: null` without an HTTP call). That keeps this
// test deterministic in CI regardless of outbound network availability.
const SEEDED_TRANSCRIPT = 'this is a seeded e2e test transcript for the clean up click path'

test('Clean up with no reachable AI provider fails soft (raw kept, inline hint)', async () => {
  const launched = await launchApp({
    settings: {
      cleanupEnabled: true,
      aiProvider: 'local',
      aiBaseUrl: ''
    },
    recordings: [
      {
        id: 'rec-e2e-failsoft-1',
        filename: 'seed.webm',
        filepath: '/nonexistent/seed.webm',
        timestamp: Date.now(),
        duration: 3.2,
        status: 'completed',
        provider: 'openai',
        transcription: SEEDED_TRANSCRIPT,
        size: 1234
      }
    ]
  })
  try {
    const page = await openSettingsWindow(launched.app)
    await openTab(page, 'Recordings')

    // Open the seeded recording's detail view.
    await page.getByText(SEEDED_TRANSCRIPT, { exact: true }).click()

    // Real click: open the Clean up menu, pick the default rule-based mode.
    await page.getByRole('button', { name: 'Clean up' }).click()
    await expect(page.getByTestId('cleanup-menu')).toBeVisible()
    await page.getByRole('button', { name: 'Clean up (full)' }).click()

    // Fail-soft result: inline hint, never a native dialog / thrown error.
    const hint = page.getByTestId('cleanup-hint')
    await expect(hint).toBeVisible({ timeout: 10_000 })
    await expect(hint).toHaveText('AI unreachable — raw kept.')

    // The raw transcript is untouched — the fail-soft path never mutates it.
    await expect(page.getByText(SEEDED_TRANSCRIPT, { exact: true })).toBeVisible()

    // And the on-disk recording reflects the same fail-soft outcome (ok:
    // false, no cleanedText persisted) via a fresh IPC read, not just the
    // in-memory renderer state.
    const rec = await page.evaluate(() => window.api.recordings.get('rec-e2e-failsoft-1'))
    expect((rec as unknown as { cleanedText?: string })?.cleanedText).toBeUndefined()
  } finally {
    await closeApp(launched)
  }
})
