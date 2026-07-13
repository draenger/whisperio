// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type CSSProperties } from 'react'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { UsagePanel } from '../src/renderer/components/settings/UsagePanel'
import { darkTheme } from '../src/renderer/theme'

/**
 * PACZKA UI: renderer coverage for the "Usage" settings panel, against the
 * real `window.api.usage` contract landed by the parallel "PACZKA METERING"
 * package (preload's UsageAPI/UsageStore/UsageMonthly — see
 * src/main/usageTracker.ts). No JSX (plain createElement calls) — same
 * convention as tests/CleanupPanel.test.ts / tests/RecordingsPanel.test.ts.
 */

const FAKE_STYLES: Record<'card' | 'cardTitle' | 'hint', CSSProperties> = {
  card: {},
  cardTitle: {},
  hint: {}
}

function currentMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function usageMonthly(overrides: Partial<{
  requests: number
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  estimatedCostUsd: number
  credits: number
}> = {}): {
  requests: number
  inputTokens: number
  outputTokens: number
  audioSeconds: number
  estimatedCostUsd: number
  credits: number
} {
  return { requests: 0, inputTokens: 0, outputTokens: 0, audioSeconds: 0, estimatedCostUsd: 0, credits: 0, ...overrides }
}

function mockUsageApi(
  store: Record<string, ReturnType<typeof usageMonthly>>
): { get: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> } {
  const month = currentMonthKey()
  const fullStore: Record<string, Record<string, ReturnType<typeof usageMonthly>>> = {}
  for (const [provider, monthly] of Object.entries(store)) {
    fullStore[provider] = { [month]: monthly }
  }
  const get = vi.fn().mockResolvedValue(fullStore)
  const reset = vi.fn().mockResolvedValue({})
  // @ts-expect-error minimal test double — only usage.get/reset are exercised
  window.api = { usage: { get, reset } }
  return { get, reset }
}

afterEach(() => cleanup())

describe('UsagePanel', () => {
  it('shows a loading state, then an empty-state message when there is no usage this month', async () => {
    mockUsageApi({})
    render(createElement(UsagePanel, { s: FAKE_STYLES, theme: darkTheme }))
    await waitFor(() => expect(screen.getByText('No usage recorded yet this month.')).toBeTruthy())
  })

  it('omits a provider that only has past-month data (no bucket for the current month)', async () => {
    const get = vi.fn().mockResolvedValue({ openai: { '2020-01': usageMonthly({ requests: 99 }) } })
    // @ts-expect-error minimal test double
    window.api = { usage: { get, reset: vi.fn() } }
    render(createElement(UsagePanel, { s: FAKE_STYLES, theme: darkTheme }))
    await waitFor(() => expect(screen.getByText('No usage recorded yet this month.')).toBeTruthy())
  })

  it('renders a row per provider with requests, tokens, audio minutes, and cost', async () => {
    mockUsageApi({
      openai: usageMonthly({ requests: 12, inputTokens: 4000, outputTokens: 900, estimatedCostUsd: 1.2345 })
    })
    render(createElement(UsagePanel, { s: FAKE_STYLES, theme: darkTheme }))
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeTruthy())
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('4000 / 900')).toBeTruthy()
    expect(screen.getByText('$1.23')).toBeTruthy()
  })

  it('shows the on-device badge alongside the (already-zeroed) cost for a free/local provider', async () => {
    mockUsageApi({
      local: usageMonthly({ requests: 5, audioSeconds: 300, estimatedCostUsd: 0 })
    })
    render(createElement(UsagePanel, { s: FAKE_STYLES, theme: darkTheme }))
    await waitFor(() => expect(screen.getByText('Local')).toBeTruthy())
    expect(screen.getByText('$0.00')).toBeTruthy()
    expect(screen.getByTestId('ondevice-badge')).toBeTruthy()
    expect(screen.getByText('5.0')).toBeTruthy() // 300s -> 5.0 audio minutes
  })

  it('shows credits (not a dollar cost) for a provider that reports them, e.g. ElevenLabs', async () => {
    mockUsageApi({
      elevenlabs: usageMonthly({ requests: 3, audioSeconds: 120, estimatedCostUsd: 0, credits: 450 })
    })
    render(createElement(UsagePanel, { s: FAKE_STYLES, theme: darkTheme }))
    await waitFor(() => expect(screen.getByText('ElevenLabs')).toBeTruthy())
    expect(screen.getByText('450 credits')).toBeTruthy()
  })

  it('Reset calls usage.reset() and re-renders from its response', async () => {
    const { get, reset } = mockUsageApi({
      openai: usageMonthly({ requests: 1, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01 })
    })
    render(createElement(UsagePanel, { s: FAKE_STYLES, theme: darkTheme }))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('OpenAI')).toBeTruthy())

    fireEvent.click(screen.getByText('Reset'))
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('No usage recorded yet this month.')).toBeTruthy())
    // Reset renders straight from reset()'s own response — no extra get() call needed.
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('fails soft to an empty table if the usage bridge rejects', async () => {
    // @ts-expect-error minimal test double — only usage.get/reset are exercised
    window.api = { usage: { get: vi.fn().mockRejectedValue(new Error('not wired yet')), reset: vi.fn() } }
    render(createElement(UsagePanel, { s: FAKE_STYLES, theme: darkTheme }))
    await waitFor(() => expect(screen.getByText('No usage recorded yet this month.')).toBeTruthy())
  })
})
