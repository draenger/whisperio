import { useState, type CSSProperties, type ReactElement } from 'react'
import { normalizeSnippetPhrase } from '../../../shared/snippets'
import type { Theme } from '../../theme'
import { SectionHeader } from './SettingsForm'

/*
 * Snippets panel (Wispr-Flow parity). A snippet = spoken trigger phrase ->
 * replacement text. Matching itself lives in src/main/snippets.ts (whole
 * transcript, case-insensitive, edge punctuation ignored); this panel only
 * edits the `snippets` settings list. Colors come from `theme` (which mirrors
 * docs/design/tokens.css) — no literals here.
 */
export interface SnippetEntry {
  trigger: string
  text: string
}

/** Narrow local view of SettingsForm's makeStyles(theme) output (same pattern as ContextTonePanel). */
interface SettingsStyles {
  card: CSSProperties
  cardTitle: CSSProperties
  label: CSSProperties
  input: CSSProperties
  hint: CSSProperties
}

export interface SnippetsPanelProps {
  snippets: SnippetEntry[]
  setSnippets: (v: SnippetEntry[]) => void
  s: SettingsStyles
  theme: Theme
}

/** Uses the matcher canonicalization, so visually different equivalent triggers cannot coexist. */
function sameTrigger(a: string, b: string): boolean {
  return normalizeSnippetPhrase(a) === normalizeSnippetPhrase(b)
}

export function SnippetsPanel({ snippets, setSnippets, s, theme }: SnippetsPanelProps): ReactElement {
  const [newTrigger, setNewTrigger] = useState('')
  const [newText, setNewText] = useState('')

  const canAdd =
    newTrigger.trim().length > 0 &&
    newText.trim().length > 0 &&
    !snippets.some((sn) => sameTrigger(sn.trigger, newTrigger))

  const updateAt = (index: number, patch: Partial<SnippetEntry>): void => {
    const next = { ...snippets[index], ...patch }
    if (!next.text.trim() || snippets.some((sn, i) => i !== index && sameTrigger(sn.trigger, next.trigger))) return
    setSnippets(snippets.map((sn, i) => (i === index ? next : sn)))
  }
  const removeAt = (index: number): void => {
    setSnippets(snippets.filter((_, i) => i !== index))
  }
  const add = (): void => {
    if (!canAdd) return
    setSnippets([...snippets, { trigger: newTrigger.trim(), text: newText }])
    setNewTrigger('')
    setNewText('')
  }

  const buttonBase: CSSProperties = {
    background: 'transparent',
    borderRadius: '6px',
    fontWeight: 600,
    fontFamily: 'inherit',
    flexShrink: 0
  }
  const textareaStyle: CSSProperties = { ...s.input, flex: 1, minHeight: '56px', resize: 'vertical' }

  return (
    <div style={s.card}>
      <SectionHeader title="Snippets" s={s} theme={theme} />
      <span style={s.hint}>
        Say a trigger phrase on its own and Whisperio pastes the saved text instead — e.g. say
        &ldquo;my address&rdquo; to insert your full address. Matching ignores case and surrounding punctuation,
        and only fires when the whole dictation is the trigger.
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
        {snippets.map((sn, index) => (
          <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }} data-testid="snippet-row">
            <input
              type="text"
              value={sn.trigger}
              onChange={(e) => updateAt(index, { trigger: e.target.value })}
              style={{ ...s.input, width: '30%', flexShrink: 0 }}
              aria-label="Snippet trigger phrase"
            />
            <textarea
              value={sn.text}
              onChange={(e) => updateAt(index, { text: e.target.value })}
              style={textareaStyle}
              aria-label="Snippet text"
            />
            <button
              onClick={() => removeAt(index)}
              title={`Remove "${sn.trigger}"`}
              style={{
                ...buttonBase,
                border: `1px solid ${theme.border}`,
                padding: '4px 10px',
                fontSize: '11px',
                color: theme.danger,
                cursor: 'pointer'
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {snippets.length === 0 && <span style={s.hint}>No snippets yet — add one below.</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '10px' }}>
        <input
          type="text"
          value={newTrigger}
          onChange={(e) => setNewTrigger(e.target.value)}
          placeholder="trigger, e.g. my address"
          style={{ ...s.input, width: '30%', flexShrink: 0 }}
          aria-label="New snippet trigger phrase"
        />
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="text to insert"
          style={textareaStyle}
          aria-label="New snippet text"
        />
        <button
          onClick={add}
          disabled={!canAdd}
          aria-label="Add snippet"
          style={{
            ...buttonBase,
            border: `1px solid ${theme.inputBorder}`,
            padding: '6px 12px',
            fontSize: '12px',
            color: theme.accent,
            cursor: canAdd ? 'pointer' : 'default',
            opacity: canAdd ? 1 : 0.5
          }}
        >
          + Add
        </button>
      </div>
    </div>
  )
}
