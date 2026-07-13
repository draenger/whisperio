import { createContext, useContext, useState, useEffect, useCallback, type ReactNode, type ReactElement } from 'react'
import { type ThemeMode, type Theme, type AccentColor, buildTheme, DEFAULT_ACCENT } from './theme'

/* Known theme modes, in the order the settings Segmented control renders them.
   Anything else coming out of persisted settings (old build, corrupted JSON,
   a future mode this build doesn't know about yet) falls back to 'dark' —
   never throws, never leaves the UI in an undefined-var(--wsp-*) state. */
const KNOWN_MODES: ThemeMode[] = ['dark', 'light', 'violet-legacy']

function coerceMode(value: unknown): ThemeMode {
  return KNOWN_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'dark'
}

interface ThemeContextValue {
  mode: ThemeMode
  accent: AccentColor
  theme: Theme
  toggleTheme: () => void
  setMode: (mode: ThemeMode) => void
  setAccent: (accent: AccentColor) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  accent: DEFAULT_ACCENT,
  theme: buildTheme('dark', DEFAULT_ACCENT),
  toggleTheme: () => {},
  setMode: () => {},
  setAccent: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [mode, setModeState] = useState<ThemeMode>('dark')
  const [accent, setAccentState] = useState<AccentColor>(DEFAULT_ACCENT)

  useEffect(() => {
    window.api.settings.load().then((settings) => {
      if (settings.theme) {
        setModeState(coerceMode(settings.theme))
      }
      if (settings.accentColor) {
        setAccentState(settings.accentColor as AccentColor)
      }
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      window.api.settings.save({ theme: next })
      return next
    })
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    window.api.settings.save({ theme: next })
  }, [])

  const setAccent = useCallback((next: AccentColor) => {
    setAccentState(next)
    window.api.settings.save({ accentColor: next })
  }, [])

  const theme = buildTheme(mode, accent)

  // Stamp <html data-theme/data-accent> so tokens.css's [data-theme]/[data-accent]
  // selectors resolve the right --wsp-* literal for the CSS-var Theme above.
  useEffect(() => {
    document.documentElement.dataset.theme = mode
    document.documentElement.dataset.accent = accent
  }, [mode, accent])

  // Update background and global styles to match theme
  useEffect(() => {
    document.body.style.background = theme.bg
    document.documentElement.style.background = theme.bg

    const styleId = 'whisperio-global-styles'
    let style = document.getElementById(styleId) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    // violet-legacy is dark-only (see tokens.css) — treat it as dark for the
    // native color-scheme hint (scrollbars, form controls, etc).
    const colorScheme = mode === 'light' ? 'light' : 'dark'
    style.textContent = `
      html, body, #root {
        min-height: 100%;
      }
      body {
        margin: 0;
        background: ${theme.bg};
        color: ${theme.text};
        font-family: "IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: geometricPrecision;
        color-scheme: ${colorScheme};
      }
      ::selection {
        background: rgba(${theme.accentRgb}, 0.28);
        color: ${theme.text};
      }
      * {
        scrollbar-width: thin;
        scrollbar-color: ${theme.border} transparent;
      }
      *::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      *::-webkit-scrollbar-track {
        background: transparent;
      }
      *::-webkit-scrollbar-thumb {
        background: ${theme.border};
        border-radius: 3px;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: ${theme.borderHover};
      }
      button, input, textarea, select {
        font: inherit;
      }
      button {
        -webkit-tap-highlight-color: transparent;
      }
      textarea, pre, code {
        word-wrap: break-word;
        overflow-wrap: break-word;
      }
      input, textarea, select {
        color: ${theme.text};
      }
      input::placeholder, textarea::placeholder {
        color: ${theme.textMuted};
        opacity: 1;
      }
      input:focus-visible, select:focus-visible, textarea:focus-visible {
        border-color: rgba(${theme.accentRgb}, 0.6) !important;
        box-shadow: 0 0 0 3px rgba(${theme.accentRgb}, 0.16) !important;
      }
      select {
        -webkit-appearance: none;
        appearance: none;
        /* Per-theme literal-color data-URI baked into tokens.css — var() can't
           be resolved inside a data-URI, so this can't be theme.textMuted. */
        background-image: var(--wsp-select-arrow);
        background-repeat: no-repeat;
        background-position: right 11px center;
        padding-right: 32px !important;
      }
    `
  }, [theme, mode])

  return (
    <ThemeContext.Provider value={{ mode, accent, theme, toggleTheme, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
