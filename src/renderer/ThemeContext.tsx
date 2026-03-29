import { createContext, useContext, useState, useEffect, useCallback, type ReactNode, type ReactElement } from 'react'
import { type ThemeMode, type Theme, darkTheme, lightTheme } from './theme'

interface ThemeContextValue {
  mode: ThemeMode
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  theme: darkTheme,
  toggleTheme: () => {}
})

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [mode, setMode] = useState<ThemeMode>('dark')

  useEffect(() => {
    window.api.settings.load().then((settings) => {
      if (settings.theme === 'light' || settings.theme === 'dark') {
        setMode(settings.theme)
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

  const theme = mode === 'dark' ? darkTheme : lightTheme

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
      textarea, pre, code {
        word-wrap: break-word;
        overflow-wrap: break-word;
      }
    `
  }, [theme])

  return (
    <ThemeContext.Provider value={{ mode, theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
