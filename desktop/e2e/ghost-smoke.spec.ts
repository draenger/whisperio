import { test, expect } from '@playwright/test'
import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from './helpers'

// Smoke check for the animated ghost mascot (Ghost.tsx): the layered SVG
// (masked body + clipped arm + pivot disc) must actually render in the
// settings TitleBar, with the idle-sway animation attached.
test.describe('ghost mascot', () => {
  let launched: LaunchedApp

  test.afterEach(async () => {
    await closeApp(launched)
  })

  test('renders animated ghost in the settings title bar', async () => {
    launched = await launchApp()
    const page = await openSettingsWindow(launched.app)

    const ghost = page.locator('.wspg').first()
    await expect(ghost).toBeVisible()

    // All three SVG layers present (body, arm, pivot disc).
    await expect(ghost.locator('svg.wspg-layer')).toHaveCount(3)

    // Idle sway keyframe animation is attached and running.
    const animation = await ghost.evaluate((el) => getComputedStyle(el).animationName)
    expect(animation).toContain('wspg-sway')

    await page.screenshot({ path: 'test-results/ghost-titlebar.png' })
  })
})
