import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openSettingsWindow, openTab } from './helpers'

// P0.1 click-test (b): UsagePanel renders seeded usage, and clicking Reset
// actually zeroes it — both in the rendered table and in a fresh usage:get
// read (main-process usage.json), not just the button's own optimistic state.

/** "YYYY-MM" (local time) — mirrors UsagePanel.tsx's currentMonthKey() /
 * usageTracker.ts's monthKey(), so the seeded bucket lands in the month the
 * panel actually reads. */
function currentMonthKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${month}`
}

test('Reset zeroes seeded usage, on-screen and on disk', async () => {
  // Seed usage.json with a non-zero OpenAI bucket for the current month, so
  // the panel has something real to reset — a fresh install would already
  // show the empty state, which wouldn't exercise the Reset click at all.
  const launched = await launchApp({
    usage: {
      openai: {
        [currentMonthKey()]: {
          requests: 7,
          inputTokens: 1200,
          outputTokens: 340,
          audioSeconds: 90,
          estimatedCostUsd: 0.42,
          credits: 0
        }
      }
    }
  })
  try {
    const page = await openSettingsWindow(launched.app)
    await openTab(page, 'Usage')

    // Seeded row is actually rendered before we touch Reset. Scoped to the
    // usage table specifically — "OpenAI" also appears in the STT provider
    // chain chip above the tab content (StatusHeader), which is unrelated.
    const usageTable = page.locator('table')
    await expect(usageTable.getByRole('cell', { name: 'OpenAI' })).toBeVisible()
    await expect(usageTable.getByText('$0.42', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Reset' }).click()

    // Table collapses to the empty state...
    await expect(page.getByText('No usage recorded yet this month.')).toBeVisible()
    await expect(usageTable).toHaveCount(0)

    // ...and a fresh IPC read agrees usage.json is actually empty, not just
    // that the button's own optimistic UI cleared.
    const usage = await page.evaluate(() => window.api.usage.get())
    expect(Object.keys(usage as Record<string, unknown>)).toHaveLength(0)
  } finally {
    await closeApp(launched)
  }
})
