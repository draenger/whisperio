# Whisperio v1.6.0 — Private by choice, steadier every day

**Opt-in encryption for your history and recordings, hold-to-talk, and a long list of reliability and security fixes.**

Platforms: **Windows** and **Linux**. The macOS build follows separately.

## ✨ Highlights

**Encrypt your history and recordings (opt-in).** Settings → Privacy → *Encrypt history and recordings*. When it is on, the transcript history and kept audio clips are stored encrypted on disk, with the key held in your OS keychain. It is **off by default**: nothing changes until you turn it on. Turning it on encrypts what you already have in the background; *Erase all history* destroys the key, so erased data cannot be recovered.

**Hold-to-talk.** A new hotkey mode: hold the key to record, release to transcribe. Works on non-US keyboard layouts. Windows only in this release; Linux keeps toggle mode.

**Stream Deck / script control.** Start and stop dictation from the command line: `Whisperio --toggle | --start | --stop | --cancel`.

**Skip silence.** Recordings with no speech are not sent to your provider at all (no empty paste, no bill), and you can optionally trim silence at the start and end before upload.

**Keep your clipboard.** Optional: after Whisperio pastes, your previous clipboard content comes back.

## 🔧 Reliability
- Long transcriptions no longer get dropped silently after 60 s while the provider is still working.
- AI cleanup can no longer throw away a good transcript or bill the next speech-to-text provider again.
- Each provider gets the audio format it expects (WAV is no longer sent labelled as WebM); reprocessing with the local model works again.
- The local whisper server restarts on demand after it was unloaded while idle, and stops when you quit.
- The microphone is released after a quick stop or cancel; if the selected mic is gone, the default one is used.
- A settings file locked by another program no longer resets your settings to defaults; saves are durable.
- Two recordings saved in the same second no longer overwrite each other's audio, and an unreadable recordings index is moved aside instead of overwritten.

## 🔒 Security
- Provider API keys are stored only in OS secure storage — there is no plain-text fallback any more. On Linux without a keyring you get a one-time warning and the keys are kept for the session.
- Downloaded whisper-server and models get a SHA-256 check: the checksum of the first download is recorded and a later download that differs is rejected.
- Stricter checks on messages between the app window and the background process (allowed fields only, paths confined to the recordings folder).
- The GitHub sync key is never silently replaced on a temporary keychain failure; GitHub sign-in only opens github.com verification pages.
- Transcript and clipboard text are passed to AI cleanup clearly marked as data, not instructions.
- Electron 42 with current Chromium security fixes.

## 📝 Notes
- Updating from 1.5.x keeps your settings, history and keys. Encryption stays off until you turn it on.
- Full changelog: `desktop/CHANGELOG.md`
