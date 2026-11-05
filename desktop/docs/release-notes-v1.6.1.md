# Whisperio v1.6.1 — A new look, clearer errors

**The app now wears the teal ghost from the iOS app, offline errors say what is wrong, and Erase all no longer leaves recordings behind unnoticed.**

Platforms: **Windows** now. The macOS build follows separately.

## ✨ Highlights

**Teal ghost icon.** The app, installer, uninstaller, window and tray icons are now the teal ghost from the iOS app instead of the purple one. The tray icon is a cut-out ghost on a transparent background so it stays readable at 16 px.

**Clear network errors.** When you are offline, speech-to-text providers now show *Network error. Check your connection.* instead of a raw code such as `net::ERR_INTERNET_DISCONNECTED` or `ECONNRESET`. A Replicate request that takes too long now says it timed out after 55 s instead of *This operation was aborted*.

**Erase all reports what it could not delete.** With history encryption off, recordings that could not be deleted (for example locked by antivirus) are now reported, and Whisperio retries them at the next start. Before, they stayed on disk unnoticed.

## 🔧 Reliability and security
- Local-network address checks now judge IPv6 unique-local and link-local addresses by their value, not by a text prefix.
- Failed background update checks and downloads no longer raise unhandled errors; failed sealed saves leave no empty placeholder files.
- Many new tests cover update signature checks, recordings paths, usage totals and the experimental on-device model.

## 📝 Notes
- **Windows icon cache:** Windows caches app icons, so after updating the old purple icon may stay on the desktop shortcut or taskbar until you restart Explorer (Task Manager, Windows Explorer, Restart) or sign out and back in.
- Updating from 1.6.0 keeps your settings, history and keys.
- Full changelog: `desktop/CHANGELOG.md`
