# Backlog

Ideas assessed but not scheduled. Priority: P1 next up, P2 later / low value, P3 parked.

## P2 — "Sign in with ChatGPT" for AI rewrite (desktop only)

**Idea.** Let a user with ChatGPT Plus/Pro power Whisperio's text features from their ChatGPT plan instead
of an API key (OpenAI DevDay 2026-09-29: plan usage in third-party apps, per-app weekly cap set by the user).

**Assessed 2026-10-20 — why only P2.**

- **No transcription.** OpenAI's preview limitations: "Audio/video input, the Files upload API, and the
  transcription API are not supported by this flow." Dictation (gpt-4o-transcribe / whisper) still needs a
  provider key (OpenAI, Groq, ElevenLabs) or a local model, so this is *not* a "No API key?" onboarding path.
- **Text only.** Plan usage covers `POST https://api.openai.com/v1/responses` with `store: false` and
  `stream: true`, history sent in `input` (no `previous_response_id`); no file search, image generation or
  hosted tools. For Whisperio that is the rewrite / cleanup / conversation layer
  (`desktop/src/main/dictation/conversation.ts`, [rewrite presets](features/rewrite-presets.md)).
- **Eligibility.** Commercial apps: waitlist via the interest form. Open-source and locally hosted apps:
  plan usage without a client secret, via dynamic registration. Whisperio's repo is public, so the desktop
  app likely qualifies; confirm with OpenAI (the docs do not define "open-source" precisely).
- **Platforms.** The documented redirect is loopback only (`http://127.0.0.1:<port>/auth/callback`, not
  `localhost`). Android/iOS custom-scheme redirects are not documented, so mobile waits for OpenAI.

**Shape if picked up (~1–2 days, desktop).**

- Settings → AI rewrite: "Use your ChatGPT plan" next to the OpenAI key; onboarding unchanged.
- OAuth in the main process: OIDC + PKCE S256, first sign-in with `client_id=dynamic_agent_client` plus a
  stable `ext_agent_host_id` and `agent_name_hint=Whisperio`, then persist the issued `oaiapp_…` client id.
  Scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, resource
  `https://api.openai.com/v1`; check `chatgpt.tokens.use.direct` was granted before any inference.
- Tokens in the existing key store (safeStorage), refresh on expiry; a streaming Responses client for rewrite.
- Free app: the user's own plan and weekly cap, no payments on our side.
- First step: Daniel submits the interest form / confirms OSS eligibility.

**Sources.**

- [Quickstart](https://developers.openai.com/siwc/quickstart)
- [Request a client ID](https://developers.openai.com/siwc/request-client-id)
- [Plan usage for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source)
- [Sign in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [The AI Insider, DevDay recap 2026-09-30](https://theaiinsider.tech/2026/09/30/openai-devday-turns-chatgpt-into-a-hub-for-agents-apps-and-office-work/)
