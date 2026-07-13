import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Design tokens (--wsp-* custom properties) — see docs/design/README.md.
// DictationOverlay doesn't consume theme.ts (its recording/transcribing
// signal colors are theme-invariant by design — see tokens.css header), but
// loading tokens.css here makes --wsp-* available to this window too.
import '../../../docs/design/tokens.css'
import { DictationOverlay } from '../components/dictation/DictationOverlay'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DictationOverlay />
    </StrictMode>
  )
}
