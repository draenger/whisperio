import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DictationOverlay } from '../components/dictation/DictationOverlay'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DictationOverlay />
    </StrictMode>
  )
}
