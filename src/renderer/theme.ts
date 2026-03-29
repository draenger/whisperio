export type ThemeMode = 'dark' | 'light'

export interface Theme {
  bg: string
  bgSecondary: string
  bgTertiary: string
  text: string
  textSecondary: string
  textMuted: string
  accent: string
  accentHover: string
  accentGlow: string
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

export const darkTheme: Theme = {
  bg: '#0a0a14',
  bgSecondary: '#12122a',
  bgTertiary: '#1a1a3a',
  text: '#e8e8f0',
  textSecondary: '#a0a0c0',
  textMuted: '#606080',
  accent: '#8b5cf6',
  accentHover: '#a78bfa',
  accentGlow: 'rgba(139, 92, 246, 0.3)',
  border: '#2a2a4a',
  borderHover: '#3a3a6a',
  inputBg: '#0e0e1e',
  inputBorder: '#2a2a4a',
  danger: '#ef4444',
  dangerGlow: 'rgba(239, 68, 68, 0.3)',
  success: '#22c55e',
  successGlow: 'rgba(34, 197, 94, 0.3)',
  shadow: '0 8px 32px rgba(0, 0, 0, 0.6)'
}

export const lightTheme: Theme = {
  bg: '#f8f8fc',
  bgSecondary: '#ffffff',
  bgTertiary: '#f0f0f8',
  text: '#1a1a2e',
  textSecondary: '#4a4a6a',
  textMuted: '#8888a0',
  accent: '#7c3aed',
  accentHover: '#6d28d9',
  accentGlow: 'rgba(124, 58, 237, 0.2)',
  border: '#e0e0f0',
  borderHover: '#c0c0e0',
  inputBg: '#ffffff',
  inputBorder: '#d0d0e0',
  danger: '#dc2626',
  dangerGlow: 'rgba(220, 38, 38, 0.2)',
  success: '#16a34a',
  successGlow: 'rgba(22, 163, 74, 0.2)',
  shadow: '0 4px 16px rgba(0, 0, 0, 0.1)'
}
