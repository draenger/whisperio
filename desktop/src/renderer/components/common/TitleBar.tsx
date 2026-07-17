import { type ReactElement } from 'react'
import { useTheme } from '../../ThemeContext'
import { Ghost } from './Ghost'

interface TitleBarProps {
  title: string
}

export function TitleBar({ title }: TitleBarProps): ReactElement {
  const { mode, theme, toggleTheme } = useTheme()
  // macOS shows native traffic-light controls on the left, so hide our custom
  // window buttons and leave room for them.
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

  const handleMinimize = (): void => {
    window.api.window.minimize()
  }

  const handleMaximize = (): void => {
    window.api.window.maximize()
  }

  const handleClose = (): void => {
    window.api.window.close()
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      height: '44px',
      background: mode === 'dark'
        ? 'rgba(8, 13, 21, 0.9)'
        : 'rgba(248, 250, 252, 0.94)',
      borderBottom: `1px solid ${theme.border}`,
      boxShadow: `0 8px 24px -18px ${theme.accentGlow}`,
      backdropFilter: 'blur(18px)',
      WebkitAppRegion: 'drag',
      userSelect: 'none',
      flexShrink: 0,
      paddingLeft: isMac ? '78px' : '12px',
      paddingRight: isMac ? '10px' : '8px',
      zIndex: 100
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        minWidth: 0,
        flex: 1
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 10px 5px 8px',
          borderRadius: '999px',
          background: mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
          border: `1px solid ${theme.border}`,
          flexShrink: 0
        }}>
          <Ghost size={16} />
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: theme.text
          }}>Whisperio</span>
        </div>

        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          color: theme.textSecondary,
          letterSpacing: '0.2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0
        }}>
          {title}
        </span>
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        style={{
          WebkitAppRegion: 'no-drag',
          background: mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
          border: `1px solid ${theme.border}`,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '34px',
          height: '34px',
          borderRadius: '999px',
          color: theme.textMuted,
          transition: 'background 0.15s, color 0.15s, border-color 0.15s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.bgTertiary
          e.currentTarget.style.color = theme.accent
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)'
          e.currentTarget.style.color = theme.textMuted
        }}
      >
        {mode === 'dark' ? (
          /* Sun icon */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          /* Moon icon */
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
      </button>

      {/* Window controls — Windows/Linux only; macOS uses native traffic lights */}
      {!isMac && (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        marginLeft: '8px',
        padding: '2px',
        borderRadius: '999px',
        background: mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
        border: `1px solid ${theme.border}`,
        WebkitAppRegion: 'no-drag'
      }}>
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          title="Minimize"
          style={controlButtonStyle(theme)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.bgTertiary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="5" x2="9" y2="5" stroke={theme.textMuted} strokeWidth="1.2" />
          </svg>
        </button>

        {/* Maximize */}
        <button
          onClick={handleMaximize}
          title="Maximize"
          style={controlButtonStyle(theme)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.bgTertiary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="1" width="8" height="8" rx="1" stroke={theme.textMuted} strokeWidth="1.2" fill="none" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          title="Close"
          style={controlButtonStyle(theme)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="1" x2="9" y2="9" stroke={theme.textMuted} strokeWidth="1.2" />
            <line x1="9" y1="1" x2="1" y2="9" stroke={theme.textMuted} strokeWidth="1.2" />
          </svg>
        </button>
      </div>
      )}
    </div>
  )
}

function controlButtonStyle(theme: { textMuted: string }): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '6px',
    color: theme.textMuted,
    transition: 'background 0.15s',
    WebkitAppRegion: 'no-drag' as unknown as string
  } as React.CSSProperties
}
