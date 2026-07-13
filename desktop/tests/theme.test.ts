import { describe, it, expect } from 'vitest'
import {
  ACCENTS,
  ACCENT_ORDER,
  ACCENT_LABELS,
  DEFAULT_ACCENT,
  buildTheme,
  darkTheme,
  lightTheme,
  violetLegacyTheme,
  type Theme,
  type ThemeMode,
  type AccentColor
} from '../src/renderer/theme'

const ACCENT_COLORS: AccentColor[] = ['graphite', 'blue', 'teal', 'emerald', 'amber', 'violet']

const MODES: ThemeMode[] = ['dark', 'light', 'violet-legacy']

const THEME_KEYS: (keyof Theme)[] = [
  'bg',
  'bgSecondary',
  'bgTertiary',
  'text',
  'textSecondary',
  'textMuted',
  'accent',
  'accentHover',
  'accentLight',
  'accentGlow',
  'accentInk',
  'accentRgb',
  'border',
  'borderHover',
  'inputBg',
  'inputBorder',
  'danger',
  'dangerGlow',
  'success',
  'successGlow',
  'shadow'
]

// STEP0 theming wiring: every Theme field is a var(--wsp-*) reference into
// docs/design/tokens.css. tokens.css itself owns the mode x accent
// cross-product (via [data-theme]/[data-accent] selectors on <html>,
// stamped by ThemeProvider), so buildTheme() no longer computes a literal
// color per mode/accent — the same var() reference is correct everywhere.
const EXPECTED_VAR: Record<keyof Theme, string> = {
  bg: 'var(--wsp-bg)',
  bgSecondary: 'var(--wsp-bg-secondary)',
  bgTertiary: 'var(--wsp-bg-tertiary)',
  text: 'var(--wsp-text)',
  textSecondary: 'var(--wsp-text-secondary)',
  textMuted: 'var(--wsp-text-muted)',
  accent: 'var(--wsp-accent)',
  accentHover: 'var(--wsp-accent-hover)',
  accentLight: 'var(--wsp-accent-light)',
  accentGlow: 'var(--wsp-accent-glow)',
  accentInk: 'var(--wsp-accent-ink)',
  accentRgb: 'var(--wsp-accent-rgb)',
  border: 'var(--wsp-border)',
  borderHover: 'var(--wsp-border-hover)',
  inputBg: 'var(--wsp-input-bg)',
  inputBorder: 'var(--wsp-input-border)',
  danger: 'var(--wsp-danger)',
  dangerGlow: 'var(--wsp-danger-glow)',
  success: 'var(--wsp-success)',
  successGlow: 'var(--wsp-success-glow)',
  shadow: 'var(--wsp-shadow)'
}

const VAR_LIKE = /^var\(--wsp-[a-z-]+\)$/

describe('theme constants', () => {
  describe('ACCENTS palette map', () => {
    it('contains every AccentColor', () => {
      expect(Object.keys(ACCENTS).sort()).toEqual([...ACCENT_COLORS].sort())
    })

    it('every accent palette is fully populated with well-formed values', () => {
      const COLOR_LIKE = /^(#|rgb|hsl)/
      const RGB_TUPLE = /^\d{1,3},\d{1,3},\d{1,3}$/
      for (const accent of ACCENT_COLORS) {
        const pal = ACCENTS[accent]
        expect(pal, accent).toBeDefined()
        for (const key of ['base', 'light', 'deep', 'ink'] as const) {
          expect(pal[key], `${accent}.${key}`).toMatch(COLOR_LIKE)
        }
        expect(pal.rgb, `${accent}.rgb`).toMatch(RGB_TUPLE)
      }
    })
  })

  describe('ACCENT_ORDER', () => {
    it('lists every accent exactly once', () => {
      expect([...ACCENT_ORDER].sort()).toEqual([...ACCENT_COLORS].sort())
      expect(ACCENT_ORDER).toHaveLength(ACCENT_COLORS.length)
      expect(new Set(ACCENT_ORDER).size).toBe(ACCENT_ORDER.length)
    })

    it('only references accents present in ACCENTS', () => {
      for (const accent of ACCENT_ORDER) {
        expect(ACCENTS[accent]).toBeDefined()
      }
    })
  })

  describe('ACCENT_LABELS', () => {
    it('has a non-empty label for every accent', () => {
      expect(Object.keys(ACCENT_LABELS).sort()).toEqual([...ACCENT_COLORS].sort())
      for (const accent of ACCENT_COLORS) {
        expect(ACCENT_LABELS[accent]).toBeTruthy()
        expect(typeof ACCENT_LABELS[accent]).toBe('string')
      }
    })
  })
})

describe('buildTheme', () => {
  it('returns the full set of theme tokens for every mode/accent combo', () => {
    for (const mode of MODES) {
      for (const accent of ACCENT_COLORS) {
        const theme = buildTheme(mode, accent)
        expect(Object.keys(theme).sort(), `${mode}/${accent}`).toEqual([...THEME_KEYS].sort())
        for (const key of THEME_KEYS) {
          expect(theme[key], `${mode}/${accent}.${key}`).toBeDefined()
          expect(typeof theme[key], `${mode}/${accent}.${key}`).toBe('string')
        }
      }
    }
  })

  it('returns a var(--wsp-*) reference for every token, matching tokens.css naming', () => {
    for (const mode of MODES) {
      for (const accent of ACCENT_COLORS) {
        const theme = buildTheme(mode, accent)
        for (const key of THEME_KEYS) {
          expect(theme[key], `${mode}/${accent}.${key}`).toMatch(VAR_LIKE)
          expect(theme[key], `${mode}/${accent}.${key}`).toBe(EXPECTED_VAR[key])
        }
      }
    }
  })

  it('is invariant across mode and accent — the CSS cascade in tokens.css resolves the literal color', () => {
    // Once colors are var() refs, tokens.css's [data-theme]/[data-accent]
    // selectors (not buildTheme's JS branching) decide the final literal
    // value at paint time. buildTheme keeps the (mode, accent) signature for
    // API compatibility but no longer needs the args to pick a value.
    const reference = buildTheme('dark', 'teal')
    for (const mode of MODES) {
      for (const accent of ACCENT_COLORS) {
        expect(buildTheme(mode, accent), `${mode}/${accent}`).toEqual(reference)
      }
    }
  })

  it('exposes accentRgb as a var() reference usable inside rgba(...)', () => {
    // A hard invariant from the ThemeContext global-style wiring:
    // `rgba(${theme.accentRgb}, 0.3)` must stay valid CSS.
    const theme = buildTheme('dark', 'blue')
    expect(theme.accentRgb).toBe('var(--wsp-accent-rgb)')
    expect(`rgba(${theme.accentRgb}, 0.3)`).toBe('rgba(var(--wsp-accent-rgb), 0.3)')
  })

  it('accepts violet-legacy as a mode without throwing', () => {
    expect(() => buildTheme('violet-legacy', DEFAULT_ACCENT)).not.toThrow()
  })
})

describe('default theme exports', () => {
  it('darkTheme equals the default-accent dark build', () => {
    expect(darkTheme).toEqual(buildTheme('dark', DEFAULT_ACCENT))
  })

  it('lightTheme equals the default-accent light build', () => {
    expect(lightTheme).toEqual(buildTheme('light', DEFAULT_ACCENT))
  })

  it('violetLegacyTheme equals the default-accent violet-legacy build', () => {
    expect(violetLegacyTheme).toEqual(buildTheme('violet-legacy', DEFAULT_ACCENT))
  })

  it('dark, light and violet-legacy themes expose identical key sets', () => {
    expect(Object.keys(darkTheme).sort()).toEqual(Object.keys(lightTheme).sort())
    expect(Object.keys(darkTheme).sort()).toEqual(Object.keys(violetLegacyTheme).sort())
  })

  it('are structurally identical var()-reference objects (literal colors now live in tokens.css)', () => {
    // Pre-STEP0 this asserted darkTheme.bg !== lightTheme.bg (literal hex).
    // Now both are 'var(--wsp-bg)' — the actual different literal per mode is
    // resolved by tokens.css's :root vs :root[data-theme='light'] blocks.
    expect(darkTheme).toEqual(lightTheme)
    expect(darkTheme).toEqual(violetLegacyTheme)
    expect(darkTheme.bg).toBe('var(--wsp-bg)')
  })
})
