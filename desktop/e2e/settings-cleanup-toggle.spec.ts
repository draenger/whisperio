import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openSettingsWindow, openTab } from './helpers'

// P0.1 click-test (a): the AI Cleanup "Enable AI cleanup" toggle in Settings
// > Providers actually flips settings.json on disk, and the flip survives
// closing and reopening the Settings window (not just in-memory React state).

test('clicking the AI Cleanup toggle persists and survives window reopen', async () => {
  const launched = await launchApp()
  try {
    const page = await openSettingsWindow(launched.app)
    await openTab(page, 'Providers')

    // Confirms we actually navigated into the right section before clicking —
    // a real click-test, not just "the window opened".
    await expect(page.getByText('AI Cleanup', { exact: true })).toBeVisible()

    const before = await page.evaluate(() => window.api.settings.load())
    const initialEnabled = Boolean((before as unknown as { cleanupEnabled: boolean }).cleanupEnabled)

    // The real click: toggle the "Enable AI cleanup" row. It's a <label>
    // wrapping a hidden checkbox (ToggleRow in SettingsForm.tsx) — clicking
    // its visible text label fires the same click-forwarding a mouse user
    // gets, no test-only affordance needed.
    await page.getByText('Enable AI cleanup', { exact: true }).click()

    // Auto-save is debounced 400ms (SettingsForm.tsx) — poll the renderer's
    // own settings bridge (a second, independent read) until the write lands.
    await expect
      .poll(
        async () => {
          const settings = await page.evaluate(() => window.api.settings.load())
          return (settings as unknown as { cleanupEnabled: boolean }).cleanupEnabled
        },
        { timeout: 5000, message: 'settings.json never reflected the toggle click' }
      )
      .toBe(!initialEnabled)

    // Close the window entirely and reopen it (fresh React mount, fresh IPC
    // load) — the persisted value, not just React state, must still be flipped.
    await page.close()
    const reopened = await openSettingsWindow(launched.app)
    await openTab(reopened, 'Providers')

    const after = await reopened.evaluate(() => window.api.settings.load())
    expect((after as unknown as { cleanupEnabled: boolean }).cleanupEnabled).toBe(!initialEnabled)

    // And the toggle itself renders the persisted state, not just the API response.
    const toggleChecked = await reopened
      .locator('label', { hasText: 'Enable AI cleanup' })
      .locator('input[type="checkbox"]')
      .isChecked()
    expect(toggleChecked).toBe(!initialEnabled)
  } finally {
    await closeApp(launched)
  }
})
