import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Design tokens (--wsp-* custom properties) — see docs/design/README.md.
// Must load before ThemeProvider stamps data-theme/data-accent so the
// [data-theme]/[data-accent] selectors below are already registered.
import '../../../docs/design/tokens.css'
import { ThemeProvider } from '../ThemeContext'
import { RecordingsPanel } from '../components/recordings/RecordingsPanel'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RecordingsPanel />
    </ThemeProvider>
  </StrictMode>
)
