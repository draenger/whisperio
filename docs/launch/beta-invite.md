# Whisperio beta: tester invitations and feedback triage

Requirements (from `mobile/WhisperioKit/Package.swift`): iOS 17+, macOS 14+ (watchOS 10+ for the Watch app). No promises about release dates.

Send the TestFlight invitation from App Store Connect (or the public link once enabled, see `docs/release-runbook.md` 3.8 "TestFlight public link"), then this message.

## EN

Subject: Whisperio beta (build 77)

Hi,

Whisperio is a free dictation app for iPhone, iPad, Apple Watch and Mac. No account, no Whisperio server; it uses Apple's on-device speech recognition by default, and you can optionally add your own API key for a cloud provider.

To install: 1) install Apple's TestFlight app from the App Store, 2) open the invitation link on your device, 3) tap Accept, then Install. You need iOS 17 or later (macOS 14 or later on Mac).

What to test in build 77: dictate from the Home screen (mic button), the Whisperio keyboard (add it in Settings -> Keyboards), and Apple Watch if you have one. Known limitation: iCloud sync may not work yet in this beta.

Feedback: in TestFlight, tap "Send Beta Feedback" (it can include a screenshot), or write via https://whisperio.danielkasprzyk.com/support.html. Crashes are reported to me automatically if you allow it.

Thank you,
Daniel

## PL

Temat: Beta Whisperio (build 77)

Cześć,

Whisperio to darmowa aplikacja do dyktowania na iPhone, iPad, Apple Watch i Maca. Bez konta i bez serwera Whisperio; domyślnie używa rozpoznawania mowy Apple na urządzeniu, a opcjonalnie możesz dodać własny klucz API dostawcy w chmurze.

Instalacja: 1) zainstaluj aplikację TestFlight z App Store, 2) otwórz link z zaproszenia na urządzeniu, 3) Akceptuj, potem Zainstaluj. Wymagany iOS 17 lub nowszy (macOS 14 lub nowszy na Macu).

Co testować w buildzie 77: dyktowanie z ekranu głównego (przycisk mikrofonu), klawiatura Whisperio (dodaj w Ustawienia -> Klawiatury) oraz Apple Watch, jeśli masz. Znane ograniczenie: synchronizacja iCloud może jeszcze nie działać w tej becie.

Opinie: w TestFlight stuknij "Wyślij opinię o becie" (można dołączyć zrzut ekranu) albo napisz przez https://whisperio.danielkasprzyk.com/support.html. Awarie docierają do mnie automatycznie, jeśli na to pozwolisz.

Dziękuję,
Daniel

## Feedback triage

Where it lands:
- TestFlight feedback (with screenshots): App Store Connect -> the app -> TestFlight -> Feedback; also emailed to the feedback address set in TestFlight Test Information.
- Crash reports: App Store Connect -> TestFlight -> Crashes (per build).
- Support page / email: daniel@danielkasprzyk.com.

Who: the owner reads everything. bee files one GitHub issue per distinct problem in `draenger/whisperio` and applies a label (proposed: `beta-feedback`; create it if missing).

Promise wording (use verbatim): "We read everything, we answer what needs an answer."

Issue template:

Title: `[beta b77] <short symptom> (<device>, <OS>)`

Body:
```
Source: TestFlight feedback | crash report | email
Build: 1.0.0 (77)
Device / OS:
What happened:
What was expected:
Steps (if known):
Attachments: <screenshot / crash log link; no personal data, no transcript content>
Tester contacted: yes/no
```
