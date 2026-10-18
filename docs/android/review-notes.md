# Google Play - App access / review notes (Whisperio for Android, `ai.whisperio.mobile`)

Paste the "Instructions for reviewers" block (section 2) into Play Console > Policy > App content > **App access**
(choose "All or some functionality is restricted" > add instructions). Android has its own file; the iOS review notes
do not apply (the release-readiness gate reads `platforms.android.reviewNotes`).

## 1. Why App access is needed

Whisperio has **no account and no login**, so there is no username/password. But it is a bring-your-own-key app: it
cannot transcribe anything until a speech-to-text provider API key is entered. Without a key a reviewer would see an
app that only shows an error on first dictation. The reviewer therefore needs a working **demo API key**.

## 2. Owner action - the demo key (never in the repo)

**Daniel must create a low-limit reviewer key and enter it in the Console App access field.** Never commit it, never put
it in this file, in `release.json` or in a chat log.

1. Create a dedicated key at a provider with a free tier, ideally **Groq** (free key at https://console.groq.com/keys,
   Whisper `whisper-large-v3-turbo`), or an OpenAI key with a hard monthly budget of a few dollars.
2. Prefer a throw-away key created only for the review; set the lowest usage/budget limit the provider allows.
3. Paste it into the Console field (below) as `WHISPERIO_REVIEW_API_KEY`. The name is only a label for the gate
   (`release.json` `demoAccount.envVars`); the value lives only in the Console and in Daniel's password manager.
4. After approval, **rotate/delete the key** at the provider.

## 3. Text to paste into the Console "Instructions for reviewers"

```
Whisperio is a free voice-dictation app (keyboard, Quick Settings tile) that sends your recording to a speech-to-text
provider the USER chooses, using the user's OWN API key. There is no account, no sign-in and no Whisperio server, so
there is no username or password. To try the app you need an API key. A demo key for review:

  Provider: Groq
  Demo API key: <PASTE WHISPERIO_REVIEW_API_KEY HERE>

Steps
1. Open Whisperio. Onboarding starts (7 steps). Tap Next on the welcome screen.
2. "Your audio, your provider": tick the consent box ("I agree that my recordings are sent to the provider I choose")
   and tap Next. Nothing is ever uploaded before this consent.
3. "Pick a provider": choose Groq, paste the demo key into the "Groq API key" field and tap "Check and save". The key
   is validated against the provider; when it shows "The key works and is saved on this device", tap Next.
4. Pick a language (or Auto-detect) and tap Next.
5. Microphone: tap "Allow microphone" and accept the system prompt.
6. Keyboard and tile: tap "Enable the keyboard" (opens system keyboard settings), switch on "Whisperio dictation"
   and come back. Tap "Add Quick Settings tile" and accept (Android 13+). This step can be skipped.
7. Tap "Start dictating".

Try it
- In the app: on Home tap "Start dictation", say a sentence, tap "Stop and transcribe". The text appears on screen and
  in History (bottom bar > History). It is stored on the device only.
- Keyboard: open any app with a text field (e.g. Messages or Notes), tap the field, switch to the "Whisperio dictation"
  keyboard (keyboard icon bottom right of the navigation bar, or long-press the space bar of your current keyboard),
  tap the big mic, speak, tap again. The transcript is inserted into the field. In a password field the mic is
  deliberately disabled.
- Quick Settings tile: swipe down twice, tap the pencil/edit icon, drag the "Dictate" tile into the active tiles
  (if step 6 did not add it), tap it, speak, tap stop. The text is copied to the clipboard and saved to History.
- Launcher shortcut: long-press the Whisperio icon > "Dictate".

Where things are
- Settings > Providers: add/replace/remove keys, provider order, models, fallback.
- Settings > Privacy and storage: consent switch, keep audio, auto-delete, "Delete all audio", "Erase all data"
  (removes history, recordings, keys and settings from the device).
- About: privacy policy, terms, support links.

Permissions: RECORD_AUDIO (only while the user is recording on a visible screen) and INTERNET (to reach the chosen
provider). No other permissions, no foreground service, no background recording.
Data: the recording (and the optional custom vocabulary) goes to the provider the user picked; Whisperio collects
nothing itself. See the Data safety section and the privacy policy: https://whisperio.danielkasprzyk.com/privacy.html
```

## 4. Reviewer notes for the "Notes to reviewer" / policy questions

- **Permission justification, RECORD_AUDIO:** core function is dictation. Recording starts only on an explicit tap,
  on a visible surface (app screen, keyboard panel, or the translucent Dictate activity from the tile/shortcut) and
  stops when the surface is left. No foreground service (`android/app/src/main/AndroidManifest.xml:6`, no
  `FOREGROUND_SERVICE_*`). No Permissions Declaration form is required for `RECORD_AUDIO`.
- **Input method (keyboard):** `WhisperioImeService` (`AndroidManifest.xml:48-59`) is a dictation panel, not a full
  QWERTY keyboard. It does not store or send typed text, reads only the field type (password detection) and the single
  character before the cursor (`ime/ImeCommitPolicy.kt:19-37`, `ime/WhisperioImeService.kt:192`). Mic is disabled in
  password fields.
- **Network:** only the endpoints of the providers the user configured plus a user-typed self-hosted URL
  (`android/core/src/main/kotlin/ai/whisperio/core/ProviderCatalog.kt:18-53`). Cleartext `http` is possible only for
  a user-typed private-network address (see `release.json` notes and `docs/android/CONTRACT.md` 4.3).
- **No account, so no account deletion URL.** Local deletion: Settings > Erase all data.
- **Free:** no purchases, subscriptions, ads or Play Billing.
- If the demo key is rate-limited or expired when you test, contact daniel@danielkasprzyk.com and a fresh key will be
  supplied. Size the key's budget for a few dozen short clips.

## 5. Checks before submitting

- [ ] Demo key created, tested end-to-end with a real dictation on a release build, and pasted into the Console field.
- [ ] The placeholder `<PASTE WHISPERIO_REVIEW_API_KEY HERE>` is replaced in the Console, not in this file.
- [ ] Key budget/limit set; reminder to rotate after approval.
