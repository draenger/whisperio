import { useId, type ReactElement } from 'react'
import {
  GHOST_BODY,
  GHOST_MOUTH,
  GHOST_EYE_LEFT,
  GHOST_EYE_RIGHT,
  GHOST_ARM_CUT,
  GHOST_PIVOT_DISC
} from './ghostArt'

/** Animated Whisperio ghost mascot, ported from the design source
 * ("Whisperio Ghost Motion.html"). Always plays the subtle idle sway +
 * blink + mouth bob; `mode` layers a state animation on top:
 *  - 'idle'      — chrome/titlebar variant, sway only
 *  - 'listening' — curious head tilt (design option 10, "for the listening state")
 *  - 'thinking'  — ghostly phase in/out while work happens
 *  - 'wave'      — arm wave "hello/bye" (design option 2)
 * All state animations start and end at identity so they blend with the sway. */
export type GhostMode = 'idle' | 'listening' | 'thinking' | 'wave'

interface GhostProps {
  size?: number
  mode?: GhostMode
  bodyColor?: string
  faceColor?: string
}

export function Ghost({
  size = 32,
  mode = 'idle',
  // Rezme teal body + deep-teal face, from the canonical ghost design.
  bodyColor = '#1cc8b4',
  faceColor = '#0d3f39'
}: GhostProps): ReactElement {
  // useId can contain ':' which breaks url(#…) references inside SVG.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const bodyMaskId = `wspg-body-${uid}`
  const armClipId = `wspg-arm-${uid}`

  return (
    <div
      className={`wspg wspg--${mode}`}
      style={{
        width: size,
        height: size,
        // Phase blur scales with the rendered size (4px was tuned for 250px).
        ['--wspg-blur' as string]: `${Math.max(1, size * 0.016)}px`
      }}
      aria-hidden="true"
    >
      <div className="wspg-lift">
        <div className="wspg-actor">
          {/* Body with the hand region masked out */}
          <svg className="wspg-layer" viewBox="0 0 1024 1024" fill="none">
            <defs>
              <mask id={bodyMaskId}>
                <rect width="1024" height="1024" fill="white" />
                <path d={GHOST_ARM_CUT} fill="black" />
              </mask>
            </defs>
            <g mask={`url(#${bodyMaskId})`}>
              <path d={GHOST_BODY} fill={bodyColor} transform="translate(602,157)" />
              <g className="wspg-mouth">
                <path d={GHOST_MOUTH} fill={faceColor} transform="translate(619,385)" />
              </g>
              <g className="wspg-eye">
                <path d={GHOST_EYE_LEFT} fill={faceColor} transform="translate(502.902,303.75)" />
              </g>
              <g className="wspg-eye wspg-eye--r">
                <path d={GHOST_EYE_RIGHT} fill={faceColor} transform="translate(631.438,292.563)" />
              </g>
            </g>
          </svg>
          {/* The hand alone, rotating around the shoulder pivot */}
          <svg className="wspg-layer wspg-arm" viewBox="0 0 1024 1024" fill="none">
            <defs>
              <clipPath id={armClipId} clipPathUnits="userSpaceOnUse">
                <path d={GHOST_ARM_CUT} />
              </clipPath>
            </defs>
            <g clipPath={`url(#${armClipId})`}>
              <path d={GHOST_BODY} fill={bodyColor} transform="translate(602,157)" />
            </g>
          </svg>
          {/* Pivot disc patching the body/arm seam — rotation-invariant */}
          <svg className="wspg-layer" viewBox="0 0 1024 1024" fill="none">
            <path d={GHOST_PIVOT_DISC} fill={bodyColor} />
          </svg>
        </div>
      </div>
    </div>
  )
}

// Keyframes + layout injected once per window, same pattern as DictationOverlay.
const styleEl = document.createElement('style')
styleEl.textContent = `
  .wspg{position:relative;flex-shrink:0;transform-origin:50% 90%;animation:wspg-sway 5s ease-in-out infinite}
  .wspg-lift,.wspg-actor{width:100%;height:100%}
  .wspg-actor{position:relative}
  .wspg-layer{position:absolute;inset:0;width:100%;height:100%}
  .wspg-arm{transform-origin:75.3% 53.1%}
  .wspg-eye{transform-box:fill-box;transform-origin:center;animation:wspg-blink 4.6s ease-in-out infinite}
  .wspg-eye--r{animation-delay:.05s}
  .wspg-mouth{transform-box:fill-box;transform-origin:center;animation:wspg-mouthbob 7s ease-in-out infinite}

  .wspg--listening .wspg-actor{transform-origin:50% 62%;animation:wspg-tilt 5.2s ease-in-out infinite}
  .wspg--listening .wspg-mouth{animation:wspg-mouthbob 5.2s ease-in-out infinite}
  .wspg--thinking .wspg-lift{animation:wspg-phase 4.4s ease-in-out infinite}
  .wspg--wave .wspg-arm{animation:wspg-armwave 3.4s ease-in-out infinite}
  .wspg--wave .wspg-actor{transform-origin:50% 85%;animation:wspg-bodynudge 3.4s ease-in-out infinite}
  .wspg--wave .wspg-mouth{animation:wspg-mouthbob 3.4s ease-in-out infinite}

  @keyframes wspg-sway{0%,100%{transform:rotate(0) translateY(0)}25%{transform:rotate(2.5deg) translateY(-1.2%)}50%{transform:rotate(0) translateY(-2%)}75%{transform:rotate(-2.5deg) translateY(-1.2%)}}
  @keyframes wspg-blink{0%,7%,10.5%,58%,61.5%,100%{transform:scaleY(1)}8.6%,59.6%{transform:scaleY(.06)}}
  @keyframes wspg-mouthbob{0%,42%,100%{transform:scale(1) translateY(0)}10%{transform:scale(1.18) translateY(5px)}26%{transform:scale(1.12) translateY(3px)}}
  @keyframes wspg-tilt{0%,18%,100%{transform:rotate(0)}28%,40%{transform:rotate(10deg)}50%{transform:rotate(0)}62%,74%{transform:rotate(-9deg)}84%{transform:rotate(0)}}
  @keyframes wspg-phase{0%,20%,90%,100%{opacity:1;transform:translateX(0);filter:blur(0)}38%{opacity:.15;transform:translateX(-14%);filter:blur(var(--wspg-blur,2px))}50%{opacity:.1;transform:translateX(13%);filter:blur(var(--wspg-blur,2px))}66%{opacity:1;transform:translateX(0);filter:blur(0)}}
  @keyframes wspg-armwave{0%,42%,100%{transform:rotate(0)}6%{transform:rotate(11deg)}14%{transform:rotate(-7deg)}22%{transform:rotate(10deg)}30%{transform:rotate(-5deg)}38%{transform:rotate(4deg)}}
  @keyframes wspg-bodynudge{0%,42%,100%{transform:rotate(0)}10%{transform:rotate(-2.5deg)}26%{transform:rotate(2deg)}}

  @media (prefers-reduced-motion: reduce){
    .wspg,.wspg *{animation:none !important}
  }
`
document.head.appendChild(styleEl)
