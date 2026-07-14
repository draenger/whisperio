import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openSettingsWindow, openTab } from './helpers'

// Context-aware tone (v1.5 Work Item B), P0.1-style click-tests:
//  (a) the main "Match tone to the app you're dictating into" toggle actually
//      flips settings.json on disk and survives a Settings window reopen.
//  (b) adding a row to the app -> tone table persists the new toneMap entry.

test('clicking the context-aware-tone toggle persists and survives window reopen', async () => {
  const launched = await launchApp()
  try {
    const page = await openSettingsWindow(launched.app)
    await openTab(page, 'Providers')

    // Confirms we actually navigated into the right section before clicking.
    await expect(page.getByText('Context-aware tone', { exact: true })).toBeVisible()

    // Honesty/privacy gate: the panel's own copy must be on screen, not just
    // in code comments — this is the user-facing promise backing the moat
    // ("we read the app name, never your screen"). Always visible regardless
    // of the toggle's state (it's the ToggleRow's own description).
    await expect(
      page.getByText('Whisperio reads only the app name — never your screen.', { exact: true })
    ).toBeVisible()

    const before = await page.evaluate(() => window.api.settings.load())
    const initialEnabled = Boolean((before as unknown as { contextAwareTone: boolean }).contextAwareTone)

    // The real click: toggle the "Match tone..." row (ToggleRow — a <label>
    // wrapping a hidden checkbox, same pattern as the AI Cleanup toggle).
    await page.getByText("Match tone to the app you're dictating into", { exact: true }).click()

    // Auto-save is debounced 400ms (SettingsForm.tsx) — poll the renderer's
    // own settings bridge until the write lands.
    await expect
      .poll(
        async () => {
          const settings = await page.evaluate(() => window.api.settings.load())
          return (settings as unknown as { contextAwareTone: boolean }).contextAwareTone
        },
        { timeout: 5000, message: 'settings.json never reflected the toggle click' }
      )
      .toBe(!initialEnabled)

    // Close the window entirely and reopen it — the persisted value, not just
    // React state, must still be flipped.
    await page.close()
    const reopened = await openSettingsWindow(launched.app)
    await openTab(reopened, 'Providers')

    const after = await reopened.evaluate(() => window.api.settings.load())
    expect((after as unknown as { contextAwareTone: boolean }).contextAwareTone).toBe(!initialEnabled)

    const toggleChecked = await reopened
      .locator('label', { hasText: "Match tone to the app you're dictating into" })
      .locator('input[type="checkbox"]')
      .isChecked()
    expect(toggleChecked).toBe(!initialEnabled)
  } finally {
    await closeApp(launched)
  }
})

test('adding an app -> tone table entry persists to settings.json', async () => {
  // Seed contextAwareTone: true so the table is already visible on open —
  // this test is about the table's add-row click, not the toggle above.
  const launched = await launchApp({
    settings: {
      contextAwareTone: true,
      toneMap: { slack: 'casual' }
    }
  })
  try {
    const page = await openSettingsWindow(launched.app)
    await openTab(page, 'Providers')

    await expect(page.getByText('Context-aware tone', { exact: true })).toBeVisible()

    // Honesty/privacy gate: with the feature on, the macOS window-title
    // caveat must be on screen too — the copy must not overclaim (it's a
    // screen-recording-permission opt-in for TEXT metadata, never a
    // screenshot) and must not underclaim (still names the OS prompt).
    await expect(page.getByText('Window-title matching (macOS)', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enable window-title matching' })).toBeVisible()

    // The real click path: type a new substring, pick nothing extra (default
    // profile), click "+ Add".
    await page.getByPlaceholder('app name substring, e.g. slack').fill('figma')
    await page.getByRole('button', { name: '+ Add', exact: true }).click()

    await expect
      .poll(
        async () => {
          const settings = await page.evaluate(() => window.api.settings.load())
          return (settings as unknown as { toneMap: Record<string, string> }).toneMap
        },
        { timeout: 5000, message: 'settings.json never reflected the added tone-map entry' }
      )
      .toMatchObject({ slack: 'casual', figma: 'neutral' })

    // Survives a reopen too, not just in-memory React state.
    await page.close()
    const reopened = await openSettingsWindow(launched.app)
    await openTab(reopened, 'Providers')
    const after = await reopened.evaluate(() => window.api.settings.load())
    expect((after as unknown as { toneMap: Record<string, string> }).toneMap).toMatchObject({
      slack: 'casual',
      figma: 'neutral'
    })
  } finally {
    await closeApp(launched)
  }
})
