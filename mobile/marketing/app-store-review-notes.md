# Whisperio — App Store review notes (source of truth for ASC "App Review Information")

Pushed to ASC with `pipeline/asc_review.py --apply` (iOS + macOS versions). Contact fields
live in the same script; keep both in sync when editing.

Sign-in required: **No** (no accounts). Demo account: none.

```
Whisperio is a privacy-first dictation app for iPhone, iPad, Apple Watch and Mac. No account, no sign-in, no Whisperio server.

HOW TO TEST (no API key needed)
1. Launch the app. The default speech-to-text engine is Apple's ON-DEVICE speech recognition, so dictation works immediately without any key or network.
2. On Home, tap the big microphone button, speak a sentence, tap again to stop. The transcript appears in the list and is copied to the clipboard.
3. Optional: Settings → Models lets you add your own API key for a cloud provider (OpenAI, ElevenLabs, Anthropic, Replicate, Deepgram, AssemblyAI, Groq, Mistral) or download a local Whisper/GGUF model. All optional; the reviewer does not need any key.
4. Apple Watch: open Whisperio on the watch, tap the mic, speak, tap to stop — the audio is transcribed via the paired iPhone.
5. Keyboard: Settings → Keyboards → add "Whisperio". The keyboard types normally without Full Access. Full Access (RequestsOpenAccess) is only needed for the mic key to hand the recording to the main app through the shared App Group and, if the user picked a cloud provider, to reach that provider; the keyboard asks for it in place and works as a plain keyboard without it.

PERMISSIONS
• Microphone — records the audio that is transcribed.
• Speech Recognition — the default on-device engine (SFSpeechRecognizer).
• Background audio — lets a dictation in progress finish when the screen locks / on the watch.
• remote-notification background mode — CloudKit silent pushes for the optional iCloud history sync; there are no user-facing push notifications.

DATA / PRIVACY
• Whisperio operates no backend. Audio is sent only to the provider the user configured, or nowhere when the on-device engine is used.
• API keys are stored in the Keychain; settings and history in the app sandbox. Optional iCloud sync uses the user's private CloudKit database only.
• No analytics SDK, no ads, no tracking, no third-party SDKs that collect data.
• Privacy policy: https://whisperio.danielkasprzyk.com/privacy.html

ENCRYPTION
Standard HTTPS/TLS via URLSession only. ITSAppUsesNonExemptEncryption = NO.

Source-available: https://github.com/draenger/whisperio
Contact: Daniel Kasprzyk · daniel@danielkasprzyk.com
```
