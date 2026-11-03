// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type CSSProperties } from 'react'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { SnippetsPanel, type SnippetsPanelProps } from '../src/renderer/components/settings/SnippetsPanel'
import { darkTheme } from '../src/renderer/theme'

// No JSX (plain createElement) — same convention as tests/CleanupPanel.test.ts.
const FAKE_STYLES = { card: {}, cardTitle: {}, label: {}, input: {}, hint: {} } as unknown as Record<string, CSSProperties>

afterEach(() => cleanup())

function renderPanel(overrides: Partial<SnippetsPanelProps> = {}) {
  const setSnippets = vi.fn()
  const props: SnippetsPanelProps = {
    snippets: [],
    setSnippets,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s: FAKE_STYLES as any,
    theme: darkTheme,
    ...overrides
  }
  render(createElement(SnippetsPanel, props))
  return { setSnippets: (overrides.setSnippets as ReturnType<typeof vi.fn>) ?? setSnippets }
}

describe('SnippetsPanel', () => {
  it('shows an empty state and a disabled Add button until both fields are filled', () => {
    const { setSnippets } = renderPanel()
    expect(screen.getByText(/No snippets yet/)).toBeTruthy()
    const add = screen.getByText('+ Add') as HTMLButtonElement
    expect(add.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('New snippet trigger phrase'), { target: { value: '  my address ' } })
    expect(add.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('New snippet text'), { target: { value: '221B Baker St' } })
    expect(add.disabled).toBe(false)

    fireEvent.click(add)
    expect(setSnippets).toHaveBeenCalledWith([{ trigger: 'my address', text: '221B Baker St' }])
  })

  it('refuses to add a duplicate trigger using matcher normalization', () => {
    const { setSnippets } = renderPanel({ snippets: [{ trigger: 'my address', text: 'a' }] })
    fireEvent.change(screen.getByLabelText('New snippet trigger phrase'), { target: { value: ' "My  Address." ' } })
    fireEvent.change(screen.getByLabelText('New snippet text'), { target: { value: 'b' } })
    const add = screen.getByText('+ Add') as HTMLButtonElement
    expect(add.disabled).toBe(true)
    fireEvent.click(add)
    expect(setSnippets).not.toHaveBeenCalled()
  })

  it('edits trigger and text of an existing row in place', () => {
    const list = [{ trigger: 'a', text: 'A' }, { trigger: 'b', text: 'B' }]
    const { setSnippets } = renderPanel({ snippets: list })
    const triggers = screen.getAllByLabelText('Snippet trigger phrase')
    fireEvent.change(triggers[1], { target: { value: 'bee' } })
    expect(setSnippets).toHaveBeenLastCalledWith([{ trigger: 'a', text: 'A' }, { trigger: 'bee', text: 'B' }])

    const texts = screen.getAllByLabelText('Snippet text')
    fireEvent.change(texts[0], { target: { value: 'Alpha' } })
    expect(setSnippets).toHaveBeenLastCalledWith([{ trigger: 'a', text: 'Alpha' }, { trigger: 'b', text: 'B' }])
  })

  it('refuses duplicate triggers and blank replacement text while editing', () => {
    const list = [{ trigger: 'my address', text: 'A' }, { trigger: 'signature', text: 'B' }]
    const { setSnippets } = renderPanel({ snippets: list })
    const triggers = screen.getAllByLabelText('Snippet trigger phrase')
    const texts = screen.getAllByLabelText('Snippet text')

    fireEvent.change(triggers[1], { target: { value: 'My address.' } })
    fireEvent.change(texts[0], { target: { value: ' \n\t ' } })

    expect(setSnippets).not.toHaveBeenCalled()
  })

  it('deletes a row', () => {
    const list = [{ trigger: 'a', text: 'A' }, { trigger: 'b', text: 'B' }]
    const { setSnippets } = renderPanel({ snippets: list })
    fireEvent.click(screen.getByTitle('Remove "a"'))
    expect(setSnippets).toHaveBeenCalledWith([{ trigger: 'b', text: 'B' }])
  })
})
