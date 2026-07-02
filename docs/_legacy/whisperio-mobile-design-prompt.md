# Whisperio Mobile — Claude Design prompt (sent to designer)

> Prompt handed to Claude Design to iterate on the existing "Whisperio Apple Concept.html".
> Brand tokens + buildability constraints (from the feasibility research) are baked in so the
> concept stays honest. Companion to `whisperio-mobile-research.md` and
> `whisperio-mobile-implementation-plan.md`.

```
Open and iterate on my existing design file "Whisperio Apple Concept.html" (read its
README first). Don't restart from scratch — critique what's there, keep what works, and
push the quality up. Whisperio is an open-source, privacy-first voice-dictation app; this
is its Apple-mobile (iPhone + iPad + Apple Watch) concept.

LOCK THE BRAND (already established on desktop):
- Accent: violet #8b5cf6 / #a78bfa (switchable palettes allowed). Friendly purple ghost mascot.
- Type: Space Grotesk (display) + IBM Plex Sans (UI) + JetBrains Mono (mono/code).
- Mood: dark "aurora," calm, minimal, gets out of the way. Ship BOTH dark and light.
- Must feel native-Apple (SF-grade spacing, system gestures, Dynamic Island, large titles)
  while keeping the violet/ghost identity. Use real iOS device frames.

GROUND THE DESIGN IN WHAT'S ACTUALLY BUILDABLE (this is the key improvement — make the
concept honest, not magic):
- Privacy-first is the hero. On-device transcription is the default; the headline promise
  is "works fully offline — your audio never leaves the device." Sell this hard in onboarding.
- Tiered engine, shown as a clean control: (1) On-device (default, "Private / Offline" badge),
  (2) optional on-device AI cleanup, (3) Cloud (OpenAI / ElevenLabs) as explicit opt-in with a
  clear data-sharing consent moment. OLD/!AI-capable iPhones fall back to Cloud automatically —
  design the "this device uses Cloud" state, not an error.
- Action Button / Back Tap / Lock Screen quick-capture → transcript to clipboard. Show a
  Live Activity / Dynamic Island recording state with a stop control.
- Apple Watch: capture a voice memo on the wrist, "syncs to iPhone when nearby," transcribe
  later. Local-first, capture-now-use-later (Obsidian-for-voice vibe).
- Custom keyboard: a mic key that inserts text inline — but be honest about the iOS reality
  (it bounces to the app to record, then returns; design a smooth one-time explainer for the
  swipe-back, not a fake seamless loop).
- Do NOT depict impossible magic: no silent background paste into arbitrary apps.

SCREENS TO REFINE / ADD (keep a coherent flow):
1. Onboarding (sells offline + privacy, picks engine, mic permission)
2. Home / recordings list (the "second brain" — searchable, status chips)
3. Live recording + waveform (on-device partial-results feel; Dynamic Island variant)
4. Transcript detail (edit / copy / share, provider + on-device badge)
5. Engine & privacy settings (the tier control + consent state)
6. Action Button / Lock Screen quick-capture moment
7. Keyboard extension in action (with the bounce explainer)
8. Apple Watch capture + "sync when nearby" state
9. iPad layout (split view: list + detail)
10. Empty states, error/offline states, the "old device → cloud" state

WHAT I WANT IMPROVED specifically:
- Stronger visual hierarchy and a more confident, less generic layout system.
- Purposeful motion (recording pulse, waveform, transcript settle, ghost micro-interactions).
- A crisp, reusable component set (cards, chips, the engine selector, badges) shown on a
  components/style page.
- Make privacy legible at a glance (on-device vs cloud iconography).

DELIVERABLE: a clickable, interactive HTML prototype across iPhone + iPad + Watch frames,
dark and light, with a short README explaining the screens and the engine/privacy model.
Explore 2–3 directions for the home screen and the engine selector before settling.
```
