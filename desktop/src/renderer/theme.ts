export type ThemeMode = 'dark' | 'light' | 'violet-legacy'

export type AccentColor = 'graphite' | 'blue' | 'teal' | 'emerald' | 'amber' | 'violet'

export interface Theme {
  bg: string
  bgSecondary: string
  bgTertiary: string
  text: string
  textSecondary: string
  textMuted: string
  accent: string
  accentHover: string
  accentLight: string
  accentGlow: string
  accentInk: string
  accentRgb: string
  border: string
  borderHover: string
  inputBg: string
  inputBorder: string
  danger: string
  dangerGlow: string
  success: string
  successGlow: string
  shadow: string
}

/* Switchable accent palettes — matches the redesigned site & app preview. */
interface AccentPalette {
  base: string
  light: string
  deep: string
  ink: string
  rgb: string
}

export const ACCENTS: Record<AccentColor, AccentPalette> = {
  graphite: { base: '#94a3b8', light: '#cbd5e1', deep: '#475569', ink: '#0b0e16', rgb: '148,163,184' },
  blue: { base: '#4a8cf7', light: '#6ea9fb', deep: '#2f7df0', ink: '#ffffff', rgb: '74,140,247' },
  // Rezme teal — the redesign default. dark: accent #1cc8b4 / light #5ee0d0 ; light: accent #0f8478 / light #1cc8b4
  // Original teal (pre-Rezme): { base: '#2dd4bf', light: '#5eead4', deep: '#0d9488', ink: '#04241f', rgb: '45,212,191' }
  teal: { base: '#1cc8b4', light: '#5ee0d0', deep: '#0f8478', ink: '#02110f', rgb: '28,200,180' },
  emerald: { base: '#34d399', light: '#6ee7b7', deep: '#059669', ink: '#04231a', rgb: '52,211,153' },
  amber: { base: '#f59e0b', light: '#fbbf24', deep: '#b45309', ink: '#241600', rgb: '245,158,11' },
  violet: { base: '#8b5cf6', light: '#a78bfa', deep: '#7c3aed', ink: '#ffffff', rgb: '139,92,246' }
}

/* The default accent for the Rezme redesign. Revert to 'violet' (or 'blue') to restore the pre-Rezme look. */
export const DEFAULT_ACCENT: AccentColor = 'teal'

export const ACCENT_ORDER: AccentColor[] = ['graphite', 'blue', 'teal', 'emerald', 'amber', 'violet']

export const ACCENT_LABELS: Record<AccentColor, string> = {
  graphite: 'Graphite',
  blue: 'Blue',
  teal: 'Teal',
  emerald: 'Emerald',
  amber: 'Amber',
  violet: 'Violet'
}

/* Accent-neutral surface palettes for each mode. */
/* --- Original violet "aurora" surfaces (pre-Rezme). Swap these back into darkBase/lightBase to revert. ---
const darkBaseAurora = {
  bg: '#0a0911', bgSecondary: '#15121f', bgTertiary: '#221d33',
  text: '#ECEBF4', textSecondary: '#9d9bb4', textMuted: '#6a6880',
  border: 'rgba(255,255,255,0.08)', borderHover: 'rgba(255,255,255,0.16)',
  inputBg: '#1c1830', inputBorder: 'rgba(255,255,255,0.08)',
  danger: '#f0556b', dangerGlow: 'rgba(240,85,107,0.3)',
  success: '#34d399', successGlow: 'rgba(52,211,153,0.3)',
  shadow: '0 40px 90px -30px rgba(0,0,0,.85)'
}
const lightBaseAurora = {
  bg: '#f6f5fc', bgSecondary: '#ffffff', bgTertiary: '#efedf8',
  text: '#1b1830', textSecondary: '#5b5870', textMuted: '#9b98ad',
  border: 'rgba(20,18,40,0.10)', borderHover: 'rgba(20,18,40,0.20)',
  inputBg: '#f6f5fc', inputBorder: 'rgba(20,18,40,0.12)',
  danger: '#dc2626', dangerGlow: 'rgba(220,38,38,0.2)',
  success: '#16a34a', successGlow: 'rgba(22,163,74,0.2)',
  shadow: '0 40px 90px -34px rgba(40,30,90,.35)'
}
--- end original aurora surfaces --- */

/* --- Pre-tokens.css literal surfaces (Rezme teal, ported 1:1 from buildRezmeTheme('teal')).
   Superseded by docs/design/tokens.css --wsp-* custom properties (STEP0 theming wiring).
   Kept here only as a historical reference for the literal values each var replaces.
const darkBase = {
  bg: '#070d15', bgSecondary: '#101b2a', bgTertiary: '#16243a',
  text: '#ecf2f9', textSecondary: '#b4c1d0', textMuted: '#7e91a4',
  border: '#202b3b', borderHover: '#2c3a4e',
  inputBg: '#0c1826', inputBorder: '#243244',
  danger: '#ef4444', dangerGlow: 'rgba(239,68,68,0.3)',
  success: '#22c55e', successGlow: 'rgba(34,197,94,0.3)',
  shadow: '0 40px 90px -30px rgba(0,0,0,.85)'
}
const lightBase = {
  bg: '#f6f8fa', bgSecondary: '#ffffff', bgTertiary: '#eef2f6',
  text: '#0c1822', textSecondary: '#3f4f5e', textMuted: '#74859a',
  border: '#e3e9ef', borderHover: '#d2dbe4',
  inputBg: '#ffffff', inputBorder: '#d2dbe4',
  danger: '#dc2626', dangerGlow: 'rgba(220,38,38,0.2)',
  success: '#16a34a', successGlow: 'rgba(22,163,74,0.2)',
  shadow: '0 40px 90px -34px rgba(20,40,50,.28)'
}
--- end pre-tokens.css literal surfaces --- */

/*
 * CSS-var Theme (STEP0 theming wiring).
 *
 * Every Theme field is now a `var(--wsp-*)` reference into
 * docs/design/tokens.css instead of a literal color. tokens.css already
 * encodes the full mode × accent cross-product via the `[data-theme]` /
 * `[data-accent]` attribute selectors on <html> (stamped by ThemeProvider —
 * see ThemeContext.tsx), so the browser's CSS cascade resolves the right
 * literal color at paint time. That means buildTheme() no longer needs to
 * branch on `mode`/`accent` to pick a literal value — the same var()
 * reference is correct in every mode/accent combination. The (mode, accent)
 * signature is kept unchanged so existing callers (and the ACCENTS-driven
 * accent-swatch UI, which still needs literal hex for the picker dots) don't
 * need to change.
 */
const VAR_THEME: Theme = {
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildTheme(mode: ThemeMode, accent: AccentColor): Theme {
  return { ...VAR_THEME }
}

/* Default exports for any direct importers. Identical across modes now that
   colors are resolved by the CSS cascade rather than computed here — the
   (mode, accent) args are retained for API compatibility. */
export const darkTheme: Theme = buildTheme('dark', DEFAULT_ACCENT)
export const lightTheme: Theme = buildTheme('light', DEFAULT_ACCENT)
export const violetLegacyTheme: Theme = buildTheme('violet-legacy', DEFAULT_ACCENT)
