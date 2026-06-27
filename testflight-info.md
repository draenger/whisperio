# Whisperio — TestFlight info do skopiowania

> Plik prywatny. Jeśli commitujesz repo, dorzuć go do `.gitignore`.
> Tryb: Internal Testing (Friends&Family). Beta App Review Apple nie jest wymagany dla Internal, ale pola w UI App Store Connect i tak warto wypełnić — niektóre są obowiązkowe.

---

## 1. Test Information

### Beta App Description (EN — używaj tej, masz wklejoną starą desktopową)

```
Whisperio is a privacy-first voice dictation app for iPhone, iPad, and Apple Watch. Tap the mic (or use the Apple Watch shortcut), speak, and your transcribed text is ready to paste into any app.

What to test:
• Quick-dictate from iPhone / iPad — tap to start, tap to stop
• Apple Watch — dictate without unlocking the phone
• Auto-copy to clipboard, share sheet, "open in" to other apps
• STT providers: OpenAI (gpt-4o-transcribe) and ElevenLabs (Scribe v2), with automatic fallback
• Recording history — replay, re-transcribe with a different provider
• Background behavior — phone calls, music, audio interruption recovery
• Background dictation with screen locked (Watch flow)
• Light / dark mode, Dynamic Type, VoiceOver labels

Bring-your-own API key (OpenAI or ElevenLabs). No account, no telemetry, no data collection by Whisperio itself. Audio leaves the device only to the provider you configure.

Report bugs, crashes, or UX wishes through TestFlight Feedback (shake the device to send) or by email.
```

### Beta App Description (PL — alternatywa)

```
Whisperio to aplikacja do dyktowania głosem na iPhone'a, iPada i Apple Watch z naciskiem na prywatność. Stuknij mikrofon (albo użyj skrótu na Watchu), powiedz co chcesz, a tekst jest gotowy do wklejenia w dowolnej aplikacji.

Co przetestować:
• Szybkie dyktowanie z iPhone'a / iPada — tap start, tap stop
• Apple Watch — dyktowanie bez wyciągania telefonu
• Auto-copy do schowka, share sheet, "otwórz w" do innych aplikacji
• Dostawcy STT: OpenAI (gpt-4o-transcribe) i ElevenLabs (Scribe v2) z automatycznym fallbackiem
• Historia nagrań — odsłuch, re-transkrypcja innym providerem
• Zachowanie w tle — rozmowy, muzyka, przerwy audio
• Dyktowanie przy zablokowanym ekranie (Watch)
• Tryb jasny/ciemny, Dynamic Type, VoiceOver

Wymaga własnego klucza API (OpenAI lub ElevenLabs). Brak konta, brak telemetrii, brak zbierania danych przez Whisperio. Audio opuszcza urządzenie tylko do providera którego skonfigurujesz.

Bugi i sugestie zgłaszaj przez TestFlight Feedback (potrząśnij telefonem) albo mailem.
```

### Feedback Email

```
daniel@danielkasprzyk.com
```

### Marketing URL

```
https://whisperio.danielkasprzyk.com
```

### Privacy Policy URL

```
https://whisperio.danielkasprzyk.com/privacy.html
```

> ⚠️ Privacy URL musi zwracać 200. Wypchnij `docs/privacy.html` na GitHub Pages zanim wciśniesz Save w App Store Connect.

---

## 2. Beta App Review Information

> Te pola są **wymagane przy External Testing** (review Apple). Dla Internal Testing nie są obowiązkowe, ale możesz je wypełnić od razu — jak zechcesz przejść na External, będą gotowe.

### Contact Information

| Pole | Wartość |
|---|---|
| First Name | `Daniel` |
| Last Name | `Kasprzyk` |
| Phone number | `[WSTAW SWOJ NUMER W FORMACIE +48 XXX XXX XXX]` |
| Email | `daniel@danielkasprzyk.com` |

### Sign-In Information

Toggle **Sign-in required**: **OFF** (Whisperio nie ma loginu).

### Review Notes

```
Whisperio is a privacy-first voice dictation app. To exercise the dictation flow, an API key from a third-party speech-to-text provider is required (OpenAI or ElevenLabs).

How to test:
1. Launch the app and skip onboarding.
2. Settings → Provider → OpenAI → paste this test key: [PASTE_TEST_OPENAI_KEY_HERE] → Save.
3. On the main screen, tap and hold (or tap) the mic button, speak a short sentence, release / tap again to stop.
4. The transcript appears on screen and is auto-copied to the clipboard. Use the Share button to send it to Notes or Messages.
5. For Apple Watch testing, launch the Whisperio Watch app and use the dictation shortcut.

The test key above has a $5 hard limit allocated for App Review.

ACCOUNT / SIGN-IN
No sign-in. The app does not require an account. Users provide their own API key.

PERMISSIONS
• Microphone — required to record the audio that is then transcribed by the selected provider.
• Background audio (Watch) — to allow dictation to complete after the watch screen turns off.

DATA / PRIVACY
• No backend server is operated by us.
• Audio is sent only to the STT provider configured by the user.
• API keys, settings, and recording history are stored locally (Keychain for keys; app sandbox for the rest).
• No analytics SDK, no third-party tracker, no crash-reporting SDK other than Apple's own TestFlight feedback.
• Privacy policy: https://whisperio.danielkasprzyk.com/privacy.html

ENCRYPTION (export compliance)
Whisperio uses only standard HTTPS (TLS) via system APIs (URLSession). No proprietary cryptography. ITSAppUsesNonExemptEncryption = NO in Info.plist.

CONTACT
Daniel Kasprzyk · daniel@danielkasprzyk.com
GitHub: https://github.com/draenger/whisperio
```

> Przed wklejeniem: wygeneruj test key na https://platform.openai.com/api-keys, ustaw **hard limit $5** w Limits, podmień `[PASTE_TEST_OPENAI_KEY_HERE]` w Review Notes.

---

## 3. Checklist przed Save / Submit

- [ ] Privacy URL live: `curl -I https://whisperio.danielkasprzyk.com/privacy.html` zwraca `200`
- [ ] Marketing URL live: jw. `200`
- [ ] Telefon w Contact Information uzupełniony
- [ ] Beta App Description podmieniona z desktopowej na mobilną (powyżej)
- [ ] (jeśli External) test OpenAI key z $5 hard limitem wklejony do Review Notes
- [ ] `ITSAppUsesNonExemptEncryption = false` w `mobile/Info.plist` (uniknie pytania o export compliance)
- [ ] Build z TestFlight ma działający mikrofon (uprawnienia + reason string w Info.plist) i działający share sheet

---

## 4. License Agreement

W ASC na ekranie aplikacji jest sekcja **License Agreement**. Dwie opcje:

| Opcja | Kiedy używać |
|---|---|
| **Use Apple's Standard License Agreement** ✅ (Recommended) | Domyślnie. Działa dla 99% indie apps, w tym open source MIT. Apple's default obejmuje ochronę userów + jurysdykcje + zakaz reverse engineering binarki. Nie musisz nic uploadować. |
| Use a Custom End User License Agreement | Tylko jeśli prawnik wymaga (firma, B2B kontrakt, EULA z dodatkowymi warunkami). Musi być zgodny z Apple's requirements. |

**Dla Whisperio (MIT, indie, dictation app):**
- ✅ Zostaw **Apple's Standard License Agreement**.
- MIT to licencja na **kod źródłowy** w repo GitHub. Apple's default EULA dotyczy używania **binarki z App Store** przez end usera — to dwie różne warstwy, nie kolidują.
- Jeśli chcesz podkreślić open source, wystarczy linia w Beta App Description ("Open source, MIT licensed — code at github.com/draenger/whisperio") albo w opisie produkcyjnym.

**Co widzą testerzy z TestFlight:**
- TestFlight Beta Test Agreement Apple — akceptują automatycznie przy join, nic nie musisz robić.
- License Agreement w ASC dotyczy dopiero pełnej dystrybucji App Store.

### TL;DR
Klik **Use Apple's Standard License Agreement** i jedź dalej. Zero uploadu, zero ryzyka prawnego.

---

## 5. Co jeszcze App Store Connect może spytać (na potem)

Jak budujesz **External** distribution:
- **App Privacy** (osobny ekran w App Store Connect → app → App Privacy) — musisz odpowiedzieć jakie dane app zbiera. Whisperio: "Data Not Collected" we wszystkich kategoriach (poza ewentualnym Audio Data jeśli zaznaczasz że nagrania są zapisywane lokalnie — to nie liczy się jako "collected" jeśli nie opuszczają device, więc nadal "Data Not Collected").
- **Age Rating** — 4+ (brak treści dla dorosłych)
- **Pricing** — Free albo Paid
- **App Category** — Primary: Productivity. Secondary: Utilities.

---

Po skopiowaniu możesz ten plik wyrzucić.
