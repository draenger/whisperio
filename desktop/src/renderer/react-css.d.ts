import 'react'

// Electron lets the renderer mark regions as OS window drag handles via the
// non-standard `-webkit-app-region` CSS property. React's CSSProperties type
// doesn't know it, so augment it here (covers every inline-style usage).
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}
