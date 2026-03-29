import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '../ThemeContext'
import { SettingsForm } from '../components/settings/SettingsForm'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <SettingsForm />
    </ThemeProvider>
  </StrictMode>
)
