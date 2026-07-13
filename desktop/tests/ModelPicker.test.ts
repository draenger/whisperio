// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type CSSProperties } from 'react'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { ModelPicker, type ModelPickerProps } from '../src/renderer/components/settings/ModelPicker'
import { darkTheme } from '../src/renderer/theme'

/**
 * PACZKA UI: renderer coverage for the AI Cleanup model picker — dropdown vs.
 * free-text switching per provider/base-URL, per CleanupPanel.test.ts's
 * plain-createElement convention (this repo's *.test.ts files don't have the
 * JSX runtime wired up).
 */

const FAKE_STYLES: Record<'label' | 'input' | 'select' | 'hint', CSSProperties> = {
  label: {},
  input: {},
  select: {},
  hint: {}
}

function makeProps(overrides: Partial<ModelPickerProps> = {}): ModelPickerProps {
  return {
    aiProvider: 'openai',
    aiModel: '',
    setAiModel: vi.fn(),
    onDevice: false,
    s: FAKE_STYLES,
    theme: darkTheme,
    ...overrides
  }
}

afterEach(() => cleanup())

describe('ModelPicker', () => {
  it('renders a dropdown for a hosted provider not pointed at a private host', () => {
    render(createElement(ModelPicker, makeProps({ aiProvider: 'openai' })))
    expect(screen.getByTestId('model-select')).toBeTruthy()
    expect(screen.queryByTestId('model-freetext')).toBeNull()
  })

  it('lists the curated catalog plus a Custom… option for the given provider', () => {
    render(createElement(ModelPicker, makeProps({ aiProvider: 'anthropic' })))
    const select = screen.getByTestId('model-select') as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels.some((l) => l?.includes('Claude Haiku'))).toBe(true)
    expect(optionLabels).toContain('Custom…')
  })

  it('always renders free text for the local provider, even with an empty base URL', () => {
    render(createElement(ModelPicker, makeProps({ aiProvider: 'local', onDevice: false })))
    expect(screen.getByTestId('model-freetext')).toBeTruthy()
    expect(screen.queryByTestId('model-select')).toBeNull()
  })

  it('always renders free text when onDevice is true, even for a hosted provider', () => {
    render(createElement(ModelPicker, makeProps({ aiProvider: 'replicate', onDevice: true })))
    expect(screen.getByTestId('model-freetext')).toBeTruthy()
    expect(screen.queryByTestId('model-select')).toBeNull()
  })

  it('selecting a catalog model emits that model id', () => {
    const setAiModel = vi.fn()
    render(createElement(ModelPicker, makeProps({ aiProvider: 'openai', setAiModel })))
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'gpt-4o' } })
    expect(setAiModel).toHaveBeenCalledWith('gpt-4o')
  })

  it('selecting "Custom…" switches to a free-text field and clears the model', () => {
    const setAiModel = vi.fn()
    render(createElement(ModelPicker, makeProps({ aiProvider: 'openai', aiModel: 'gpt-4o', setAiModel })))
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: '__custom__' } })
    expect(setAiModel).toHaveBeenCalledWith('')
    expect(screen.getByTestId('model-freetext')).toBeTruthy()
  })

  it('starts in free-text mode when the current aiModel is not in the catalog', () => {
    render(createElement(ModelPicker, makeProps({ aiProvider: 'openai', aiModel: 'my-fine-tuned-model' })))
    expect(screen.getByTestId('model-freetext')).toBeTruthy()
  })

  it('"Choose from list" switches back from custom mode to the dropdown', () => {
    render(createElement(ModelPicker, makeProps({ aiProvider: 'openai', aiModel: 'my-fine-tuned-model' })))
    expect(screen.getByTestId('model-freetext')).toBeTruthy()
    fireEvent.click(screen.getByText('Choose from list'))
    expect(screen.getByTestId('model-select')).toBeTruthy()
  })

  it('typing in the free-text field emits the typed value', () => {
    const setAiModel = vi.fn()
    render(createElement(ModelPicker, makeProps({ aiProvider: 'local', setAiModel })))
    fireEvent.change(screen.getByTestId('model-freetext'), { target: { value: 'llama3:70b' } })
    expect(setAiModel).toHaveBeenCalledWith('llama3:70b')
  })

  it('re-derives dropdown vs. free-text when the provider prop changes', () => {
    const { rerender } = render(createElement(ModelPicker, makeProps({ aiProvider: 'local' })))
    expect(screen.getByTestId('model-freetext')).toBeTruthy()

    rerender(createElement(ModelPicker, makeProps({ aiProvider: 'openai' })))
    expect(screen.getByTestId('model-select')).toBeTruthy()
  })
})
