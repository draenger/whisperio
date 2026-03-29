import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '../ThemeContext'
import { RecordingsPanel } from '../components/recordings/RecordingsPanel'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RecordingsPanel />
    </ThemeProvider>
  </StrictMode>
)
