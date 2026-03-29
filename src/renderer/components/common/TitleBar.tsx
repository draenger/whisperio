import { type ReactElement } from 'react'
import { useTheme } from '../../ThemeContext'

interface TitleBarProps {
  title: string
}

export function TitleBar({ title }: TitleBarProps): ReactElement {
  const { mode, theme, toggleTheme } = useTheme()

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
      height: '38px',
      background: mode === 'dark'
        ? 'rgba(10, 10, 20, 0.85)'
        : 'rgba(248, 248, 252, 0.92)',
      borderBottom: `1px solid ${theme.border}`,
      boxShadow: `0 1px 8px ${theme.accentGlow}`,
      WebkitAppRegion: 'drag' as unknown as string,
      userSelect: 'none',
      flexShrink: 0,
      paddingLeft: '14px',
      paddingRight: '4px',
      zIndex: 100
    }}>
      {/* App icon — Whisperio logo */}
      <svg width="16" height="16" viewBox="0 0 1024 1024" fill="none" style={{ marginRight: '8px', flexShrink: 0 }}>
        <path d="M0 0 C0.656 0.343 1.311 0.685 1.987 1.038 C54.704 28.638 88.215 79.593 106.125 135.063 C107.462 139.362 108.74 143.677 110 148 C110.467 149.569 110.467 149.569 110.943 151.17 C123.555 194.253 132.278 241.217 136 286 C138.305 286.801 139.56 287.153 141.9 286.338 C142.551 285.971 143.201 285.605 143.871 285.227 C144.604 284.818 145.337 284.41 146.092 283.99 C146.866 283.539 147.64 283.089 148.438 282.625 C149.239 282.168 150.04 281.711 150.865 281.241 C170.995 269.603 190.585 254.179 205.25 236 C211.869 228.336 221.79 221.278 232 220 C241.223 219.704 248.153 222.999 255 229 C264.052 240.73 266.99 252.558 265.375 267.188 C264.128 275.426 261.805 283.168 259 291 C258.63 292.039 258.26 293.078 257.879 294.148 C251.233 311.303 239.829 327.223 227.289 340.559 C225.343 342.634 223.509 344.753 221.688 346.938 C208.054 362.505 190.763 374.617 173 385 C172.383 385.361 171.766 385.722 171.13 386.093 C161.167 391.836 150.783 396.047 140 400 C139.935 400.869 139.871 401.738 139.804 402.633 C137.106 437.795 130.573 471.271 117 504 C116.685 504.763 116.369 505.527 116.044 506.313 C102.042 539.795 82.542 569.887 58.102 596.68 C56.277 598.694 54.509 600.741 52.75 602.813 C45.117 611.542 36.822 619.644 27.723 626.832 C25.865 628.311 24.04 629.832 22.246 631.387 C5.488 645.91 -16.712 661.279 -39.91 660.285 C-46.652 659.365 -51.648 657.439 -56 652 C-57.758 646.725 -57.921 641.311 -55.563 636.188 C-53.542 632.538 -50.994 629.351 -48.438 626.063 C-43.689 619.852 -41 614.995 -41 607.125 C-41.708 603.916 -41.708 603.916 -44.094 602.332 C-52.541 598.46 -64.262 600.626 -72.723 603.617 C-87.805 609.981 -99.777 619.316 -112.115 629.883 C-117.901 634.821 -123.933 639.415 -130 644 C-130.682 644.53 -131.364 645.06 -132.066 645.605 C-151.901 660.899 -174.396 674.486 -199 680 C-200.183 680.286 -200.183 680.286 -201.391 680.578 C-220.465 683.662 -241.202 679.19 -257 668 C-261.163 663.815 -263.88 659.005 -264.152 653.023 C-263.32 641.966 -255.636 635.566 -248.168 628.23 C-227.977 608.836 -227.977 608.836 -219.688 583.063 C-219.65 582.022 -219.613 580.982 -219.574 579.91 C-220.105 576.283 -221.115 575.193 -224 573 C-235.451 569.947 -247.915 575.661 -258.847 578.994 C-276.59 584.366 -292.225 587.239 -310.75 587.375 C-311.45 587.383 -312.15 587.391 -312.871 587.4 C-330.487 587.553 -348.155 584.586 -362 573 C-364.222 570.802 -366.155 568.519 -368 566 C-368.578 565.237 -369.155 564.474 -369.75 563.688 C-373.506 555.613 -374.08 546.7 -371.023 538.324 C-366.49 528.454 -359.667 525.118 -350.125 520.813 C-318.805 506.23 -292.504 485.726 -280.074 452.527 C-277.642 445.254 -275.655 436.496 -278 429 C-279.276 429.818 -279.276 429.818 -280.578 430.652 C-308.028 447.886 -342.383 460.969 -375.086 454.039 C-383.797 451.915 -391.521 447.136 -397 440 C-402.283 431.243 -403.448 422.353 -401.457 412.242 C-396.686 398.31 -384.51 391.156 -372.063 385.008 C-370.044 384.042 -368.023 383.081 -366 382.125 C-364.965 381.627 -363.93 381.13 -362.863 380.617 C-355.261 377 -355.261 377 -353 377 C-352.67 376.34 -352.34 375.68 -352 375 C-350.346 374.303 -348.676 373.642 -347 373 C-322.483 360.155 -303.709 341.627 -295.035 315.043 C-290.692 299.772 -293.929 284.222 -296 268.813 C-296.432 265.579 -296.862 262.346 -297.284 259.112 C-297.545 257.113 -297.811 255.115 -298.085 253.118 C-298.88 247.042 -299.157 241.126 -299 235 C-299.66 234.67 -300.32 234.34 -301 234 C-304.039 177.456 -304.039 177.456 -300 151 C-299.782 149.54 -299.782 149.54 -299.56 148.051 C-293.87 111.524 -279.965 79.788 -257 51 C-255.888 49.579 -255.888 49.579 -254.754 48.129 C-249.332 41.315 -243.534 34.775 -237 29 C-236.34 29 -235.68 29 -235 29 C-235 28.34 -235 27.68 -235 27 C-232.976 25.224 -230.947 23.572 -228.813 21.938 C-228.173 21.444 -227.534 20.951 -226.875 20.443 C-159.944 -30.799 -74.981 -40.183 0 0 Z" fill="#9577FE" transform="translate(602,157)"/>
        <path d="M0 0 C2.87 1.794 4.491 2.983 6 6 C6.83 12.56 5.782 17.581 2 23 C-8.174 35.774 -25.852 44.487 -41.87 46.773 C-61.75 48.892 -84.358 46.35 -100.484 33.492 C-102.891 31.123 -104.763 29.195 -105.434 25.816 C-105.441 21.726 -105.346 19.554 -103.125 16 C-99.661 12.74 -96.979 12.438 -92.336 12.438 C-85.449 13.599 -79.172 17.085 -72.948 20.152 C-62.26 24.805 -45.921 23.596 -35.25 19.5 C-25.92 15.618 -18.115 10.026 -12 2 C-7.981 -0.679 -4.724 -0.696 0 0 Z" fill="#311F69" transform="translate(619,385)"/>
        <path d="M0 0 C8.231 4.905 12.085 11.213 15.098 20.25 C16.028 30.138 14.22 38.079 9.098 46.563 C4.049 51.89 -3.788 55.556 -11.09 55.875 C-19.213 55.302 -26.552 51.351 -31.902 45.25 C-35.818 38.977 -37.102 33.367 -37.152 26 C-37.173 25.261 -37.194 24.523 -37.215 23.762 C-37.272 15.686 -34.466 10.04 -28.98 4.117 C-20.385 -3.606 -10.308 -5.236 0 0 Z" fill="#311F69" transform="translate(502.902,303.75)"/>
        <path d="M0 0 C6.119 3.748 11.24 8.852 13.898 15.59 C16.015 24.666 16.14 35.194 11.254 43.352 C6.45 49.276 0.216 53.925 -7.488 54.773 C-15.697 54.872 -21.095 54.235 -27.336 48.777 C-33.75 42.188 -36.578 34.439 -36.938 25.313 C-36.554 15.731 -32.301 8.934 -25.438 2.438 C-18.529 -3.202 -8.127 -3.667 0 0 Z" fill="#311F68" transform="translate(631.438,292.563)"/>
      </svg>

      {/* Title */}
      <span style={{
        fontSize: '12px',
        fontWeight: 500,
        color: theme.textSecondary,
        letterSpacing: '0.3px',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {title}
      </span>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        style={{
          WebkitAppRegion: 'no-drag' as unknown as string,
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
          transition: 'background 0.15s, color 0.15s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.bgTertiary
          e.currentTarget.style.color = theme.accent
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
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

      {/* Window controls */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        marginLeft: '4px',
        WebkitAppRegion: 'no-drag' as unknown as string
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
