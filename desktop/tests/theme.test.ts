import { describe, it, expect } from 'vitest'
import {
  ACCENTS,
  ACCENT_ORDER,
  ACCENT_LABELS,
  DEFAULT_ACCENT,
  buildTheme,
  darkTheme,
  lightTheme,
  type Theme,
  type ThemeMode,
  type AccentColor
} from '../src/renderer/theme'

const ACCENT_COLORS: AccentColor[] = ['graphite', 'blue', 'teal', 'emerald', 'amber', 'violet']

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

// Matches any plausible CSS color/value token: hex, rgb(a), hsl, or a shadow/rgb-tuple string.
const COLOR_LIKE = /^(#|rgb|hsl)/
const RGB_TUPLE = /^\d{1,3},\d{1,3},\d{1,3}$/

describe('theme constants', () => {
  describe('ACCENTS palette map', () => {
    it('contains every AccentColor', () => {
      expect(Object.keys(ACCENTS).sort()).toEqual([...ACCENT_COLORS].sort())
    })

    it('every accent palette is fully populated with well-formed values', () => {
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
  const MODES: ThemeMode[] = ['dark', 'light']

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

  it('produces color-like values for color tokens', () => {
    const colorTokens: (keyof Theme)[] = THEME_KEYS.filter((k) => k !== 'accentRgb' && k !== 'shadow')
    for (const mode of MODES) {
      for (const accent of ACCENT_COLORS) {
        const theme = buildTheme(mode, accent)
        for (const key of colorTokens) {
          expect(theme[key], `${mode}/${accent}.${key}`).toMatch(COLOR_LIKE)
        }
        expect(theme.accentRgb, `${mode}/${accent}.accentRgb`).toMatch(RGB_TUPLE)
        expect(theme.shadow).toContain('rgba')
      }
    }
  })

  describe('dark mode branch', () => {
    it('uses accent base as accent and light as accentLight', () => {
      const pal = ACCENTS.teal
      const theme = buildTheme('dark', 'teal')
      expect(theme.accent).toBe(pal.base)
      expect(theme.accentLight).toBe(pal.light)
      expect(theme.accentHover).toBe(pal.light)
    })

    it('uses the accent ink color for accentInk', () => {
      expect(buildTheme('dark', 'teal').accentInk).toBe(ACCENTS.teal.ink)
    })

    it('uses 0.3 alpha for the accent glow', () => {
      expect(buildTheme('dark', 'blue').accentGlow).toBe(`rgba(${ACCENTS.blue.rgb},0.3)`)
    })

    it('uses the dark surface base tokens', () => {
      expect(buildTheme('dark', 'blue').bg).toBe('#070d15')
    })
  })

  describe('light mode branch', () => {
    it('uses accent deep as accent and base as accentLight', () => {
      const pal = ACCENTS.teal
      const theme = buildTheme('light', 'teal')
      expect(theme.accent).toBe(pal.deep)
      expect(theme.accentLight).toBe(pal.base)
      expect(theme.accentHover).toBe(pal.base)
    })

    it('always uses white ink in light mode regardless of accent', () => {
      expect(buildTheme('light', 'graphite').accentInk).toBe('#ffffff')
      expect(buildTheme('light', 'teal').accentInk).toBe('#ffffff')
    })

    it('uses 0.2 alpha for the accent glow', () => {
      expect(buildTheme('light', 'blue').accentGlow).toBe(`rgba(${ACCENTS.blue.rgb},0.2)`)
    })

    it('uses the light surface base tokens', () => {
      expect(buildTheme('light', 'blue').bg).toBe('#f6f8fa')
    })
  })

  it('carries the accent rgb tuple through unchanged', () => {
    for (const accent of ACCENT_COLORS) {
      expect(buildTheme('dark', accent).accentRgb).toBe(ACCENTS[accent].rgb)
    }
  })

  it('falls back to the blue accent for an unknown accent value', () => {
    const unknown = 'chartreuse' as AccentColor
    const fallback = buildTheme('dark', unknown)
    const blue = buildTheme('dark', 'blue')
    expect(fallback).toEqual(blue)
  })
})

describe('default theme exports', () => {
  it('darkTheme equals the default-accent dark build', () => {
    expect(darkTheme).toEqual(buildTheme('dark', DEFAULT_ACCENT))
  })

  it('lightTheme equals the default-accent light build', () => {
    expect(lightTheme).toEqual(buildTheme('light', DEFAULT_ACCENT))
  })

  it('dark and light themes expose identical key sets', () => {
    expect(Object.keys(darkTheme).sort()).toEqual(Object.keys(lightTheme).sort())
  })

  it('default themes differ in their surface background', () => {
    expect(darkTheme.bg).not.toBe(lightTheme.bg)
  })
})
