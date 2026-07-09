import { createContext, useContext, useState, useEffect, useCallback, type ReactNode, type ReactElement } from 'react'
import { type ThemeMode, type Theme, type AccentColor, buildTheme, DEFAULT_ACCENT } from './theme'

interface ThemeContextValue {
  mode: ThemeMode
  accent: AccentColor
  theme: Theme
  toggleTheme: () => void
  setAccent: (accent: AccentColor) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  accent: DEFAULT_ACCENT,
  theme: buildTheme('dark', DEFAULT_ACCENT),
  toggleTheme: () => {},
  setAccent: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [mode, setMode] = useState<ThemeMode>('dark')
  const [accent, setAccentState] = useState<AccentColor>(DEFAULT_ACCENT)

  useEffect(() => {
    window.api.settings.load().then((settings) => {
      if (settings.theme === 'light' || settings.theme === 'dark') {
        setMode(settings.theme)
      }
      if (settings.accentColor) {
        setAccentState(settings.accentColor as AccentColor)
      }
    })
  }, [])

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      window.api.settings.save({ theme: next })
      return next
    })
  }, [])

  const setAccent = useCallback((next: AccentColor) => {
    setAccentState(next)
    window.api.settings.save({ accentColor: next })
  }, [])

  const theme = buildTheme(mode, accent)

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
        color-scheme: ${theme.bg === '#070d15' ? 'dark' : 'light'};
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
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(theme.textMuted)}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>");
        background-repeat: no-repeat;
        background-position: right 11px center;
        padding-right: 32px !important;
      }
    `
  }, [theme])

  return (
    <ThemeContext.Provider value={{ mode, accent, theme, toggleTheme, setAccent }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
