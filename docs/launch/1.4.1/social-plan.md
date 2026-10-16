# Whisperio iOS 1.4.1: social plan, 2 weeks after release

Channels:

- core: X, LinkedIn, Mastodon and Bluesky;
- optional: Instagram Reels and TikTok (vertical 15–25 s clips built from existing screenshots).

Every post exists in EN and PL. Same facts and limits as [community-plan.md](community-plan.md): the privacy claims stop at `docs/privacy.html`, and the license is source-available, never `open source`.

Gate: `node docs/launch/1.4.1/tools/check-copy.mjs`. The `<!-- limit:N -->` lines above the posts are the platform limits:

| Platform | Limit (characters) |
|---|---|
| X | 280 |
| Bluesky | 300 |
| Mastodon | 500 (default instance setting) |
| LinkedIn | 3000 |
| IG / TikTok captions | 2200 |

Link rules:

- X counts any link as 23 characters, and the limit annotations count the placeholder as written.
- `{{APP_STORE_LINK}}` is `https://apps.apple.com/app/id6781780531`, which returns 404 until the release.
- The site is `https://whisperio.danielkasprzyk.com`.

## 0. Message pillars (one per post, rotate)

1. **Free, no account, no in-app purchases.** You pay your provider directly, or nothing on-device.
2. **Your own AI key.** OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral, Replicate, or a self-hosted OpenAI-compatible URL. Keys stay in the Keychain on that device.
3. **On-device by default.** Apple's speech recognition runs on the device unless the user allows online recognition. Works with no key.
4. **No developer server.** Audio goes from the device straight to the chosen provider, or nowhere on-device. History syncs through the user's own private iCloud (transcripts only, no audio), or stays on-device.
5. **Everywhere you type.** Keyboard, widget, Control Center, Back Tap, Apple Watch. Raw text first, AI cleanup only when you ask.

## 1. Calendar

| Day | X | Bluesky | Mastodon | LinkedIn | IG/TikTok (optional) |
|---|---|---|---|---|---|
| D0 `{{DATA_PREMIERY}}` | S1 | S1 | M1 | L1 | C1 |
| D+1 | S2 | S2 | — | — | — |
| D+2 | S3 | S3 | M2 | — | C2 |
| D+3 | thread T1 (around Show HN day; never ask for votes) | — | — | — | — |
| D+4 | S4 | S4 | — | L2 | — |
| D+6 | S5 | S5 | M3 | — | C3 |
| D+8 | S6 | S6 | — | — | — |
| D+9 | — | — | — | L3 | — |
| D+10 | S7 | S7 | M4 | — | C4 |
| D+12 | S8 (feedback round-up) | S8 | — | — | — |
| D+13 | — | — | M5 (feedback round-up) | L4 | — |

PL versions go out on the same day from the same accounts as a separate post, or on LinkedIn as the PL paragraph under the EN one (see L1). Posting time: 15:00–17:00 CET (EU afternoon, US morning).

## 2. Short posts (X and Bluesky; S = same text on both)

### S1 — launch (EN)

<!-- limit:280 -->
```
Whisperio is on the App Store.

Dictate anywhere on iPhone, iPad and Apple Watch. On-device by default, or bring your own AI key. No account, no subscription, no server of mine.

{{APP_STORE_LINK}}
```

### S1 — premiera (PL)

<!-- limit:280 -->
```
Whisperio jest w App Store.

Dyktowanie wszędzie na iPhonie, iPadzie i Apple Watch. Domyślnie na urządzeniu albo z Twoim własnym kluczem AI. Bez konta, bez subskrypcji, bez mojego serwera.

{{APP_STORE_LINK}}
```

### S2 — keyboard (EN)

<!-- limit:280 -->
```
Whisperio's keyboard works in any app: Messages, Notes, Slack, mail.

Tap, speak, and the raw text lands right away. Want it cleaned up? Run AI cleanup or a template when you ask, not on every word.
```

### S2 — klawiatura (PL)

<!-- limit:280 -->
```
Klawiatura Whisperio działa w każdej aplikacji: Wiadomości, Notatki, Slack, poczta.

Stukasz, mówisz, surowy tekst pojawia się od razu. Chcesz go wygładzić? Porządkowanie przez AI albo szablon uruchamiasz wtedy, kiedy chcesz.
```

### S3 — your own key (EN)

<!-- limit:280 -->
```
Why "bring your own key"?

Your audio goes from your phone straight to the provider you pick: OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral or Replicate. You see the real price. No middleman, no markup.
```

### S3 — własny klucz (PL)

<!-- limit:280 -->
```
Po co „własny klucz”?

Nagranie idzie z telefonu prosto do dostawcy, którego wybierzesz: OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral albo Replicate. Widzisz prawdziwą cenę. Bez pośrednika i bez marży.
```

### S4 — on-device (EN)

<!-- limit:280 -->
```
No API key? No problem.

By default Whisperio uses Apple's on-device speech recognition, so you can start dictating the minute you install it. No account, no setup.
```

### S4 — na urządzeniu (PL)

<!-- limit:280 -->
```
Nie masz klucza API? Nie szkodzi.

Domyślnie Whisperio korzysta z rozpoznawania mowy Apple na urządzeniu, więc dyktujesz od razu po instalacji. Bez konta i bez konfiguracji.
```

### S5 — Apple Watch (EN)

<!-- limit:280 -->
```
Dictate from your wrist.

Whisperio on Apple Watch: tap, speak, done. The note is waiting in your journal on iPhone.
```

### S5 — Apple Watch (PL)

<!-- limit:280 -->
```
Dyktuj z nadgarstka.

Whisperio na Apple Watch: stukasz, mówisz, gotowe. Notatka czeka w dzienniku na iPhonie.
```

### S6 — where your data goes (EN)

<!-- limit:280 -->
```
Where does your audio go in Whisperio?

• On-device engine: stays on your device
• Cloud engine: straight to the provider you chose
• History: your private iCloud, transcripts only (or on-device only)

I run no server. Details: https://whisperio.danielkasprzyk.com/privacy.html
```

### S6 — gdzie trafiają dane (PL)

<!-- limit:280 -->
```
Gdzie trafia nagranie w Whisperio?

• Silnik na urządzeniu: zostaje na urządzeniu
• Silnik w chmurze: prosto do wybranego dostawcy
• Historia: Twój prywatny iCloud, same transkrypcje (albo tylko urządzenie)

Nie mam serwera. Szczegóły: whisperio.danielkasprzyk.com/privacy.html
```

### S7 — journal + recap (EN)

<!-- limit:280 -->
```
Everything you dictate lands in a searchable journal, sorted into categories like Work, Ideas and To-do.

Optional: an AI daily digest of what you said, using the provider you chose.
```

### S7 — dziennik i podsumowanie (PL)

<!-- limit:280 -->
```
Wszystko, co podyktujesz, trafia do przeszukiwalnego dziennika z kategoriami: Praca, Pomysły, Do zrobienia.

Opcjonalnie: dzienne podsumowanie od AI, przez dostawcę, którego wybrałeś.
```

### S8 — feedback round-up (EN)

<!-- limit:280 -->
```
Two weeks of Whisperio on the App Store. Thank you for the feedback.

Top requests so far: {{TOP_REQUESTS}}

What should come next? Replies are read, every one.
```

### S8 — podsumowanie opinii (PL)

<!-- limit:280 -->
```
Dwa tygodnie Whisperio w App Store. Dziękuję za opinie.

Najczęstsze prośby: {{NAJCZESTSZE_PROSBY}}

Co dalej? Czytam każdą odpowiedź.
```

### T1 — X thread, build story (EN, 4 posts)

<!-- limit:280 -->
```
1/ I built a dictation app with one rule: no server of my own. Whisperio for iPhone, iPad and Apple Watch is now on the App Store. Here's what that rule forced. 🧵
```

<!-- limit:280 -->
```
2/ No backend means no account. So the default engine had to work with zero setup: Apple's on-device speech recognition. Install, tap, talk.
```

<!-- limit:280 -->
```
3/ Cloud models? Bring your own key. Audio goes from your device straight to the provider, keys stay in the device Keychain, and you see the provider's real price.
```

<!-- limit:280 -->
```
4/ Sync without a server: your own private iCloud database, transcripts only, no audio. Or keep it all on-device.

Free, no in-app purchases: {{APP_STORE_LINK}}
```

## 3. Mastodon (EN; PL as a separate toot the same day)

### M1 — launch

<!-- limit:500 -->
```
Whisperio is now on the App Store for iPhone, iPad and Apple Watch.

It's a dictation app with no server behind it: Apple's on-device speech recognition by default, or your own API key for OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral or Replicate. No account, no subscription, no in-app purchases.

Source is available on GitHub under PolyForm Noncommercial.

{{APP_STORE_LINK}}

#iOS #Dictation #SpeechToText #Privacy #IndieDev
```

### M1 — premiera (PL)

<!-- limit:500 -->
```
Whisperio jest już w App Store na iPhone'a, iPada i Apple Watch.

To dyktowanie bez żadnego serwera po mojej stronie: domyślnie rozpoznawanie mowy Apple na urządzeniu albo Twój własny klucz API (OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral, Replicate). Bez konta, bez subskrypcji, bez zakupów w aplikacji.

Kod jest dostępny na GitHubie (licencja PolyForm Noncommercial).

{{APP_STORE_LINK}}

#iOS #dyktowanie #prywatność #IndieDev
```

### M2 — self-hosted

<!-- limit:500 -->
```
Running your own speech server (whisper.cpp, faster-whisper, LocalAI)? Whisperio can point at any OpenAI-compatible URL, and the audio goes only to the address you configured.

On iPhone the default is still Apple's on-device recognition, and the desktop app can run local Whisper models offline.

#SelfHosted #Whisper #iOS
```

### M3 — how audio is handled

<!-- limit:500 -->
```
Whisperio and your audio, in plain words:

• On-device engine (default): recognition on your device. If you turn on Apple's online recognition, Apple may process it on its servers.
• Cloud engine: straight from your device to the provider you picked, under its terms.
• History: your private iCloud (transcripts, no audio), or on-device only.

I run no server and collect nothing. Policy: https://whisperio.danielkasprzyk.com/privacy.html

#Privacy #iOS
```

### M4 — desktop sibling

<!-- limit:500 -->
```
Whisperio also runs on Windows, macOS and Linux: press a global hotkey, speak, and the text is pasted into the app you're in. Cloud or fully offline with local Whisper models.

Downloads (GitHub Releases) and source: https://github.com/draenger/whisperio

#Linux #Windows #macOS #Dictation
```

### M5 — feedback round-up

<!-- limit:500 -->
```
Two weeks of Whisperio on the App Store. Thank you to everyone who wrote in.

Most requested: {{TOP_REQUESTS}}

Fixed or in progress: {{STATUS}}

Keep it coming — replies here or issues on GitHub.

#IndieDev #iOS
```

## 4. LinkedIn

### L1 — launch (EN + PL paragraph)

<!-- limit:3000 -->
```
Whisperio is now on the App Store.

I built it because I dictate a lot of messages and notes, and I didn't want my voice to pass through yet another company's servers just to become text.

So Whisperio has no backend at all:
• By default it uses Apple's on-device speech recognition. No account, no API key, no setup.
• If you want a cloud model, you bring your own key (OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral, Replicate, or a self-hosted endpoint). Audio goes from your device straight to that provider.
• History syncs through your own private iCloud database, transcripts only, or stays on the device.

It works where you type: a keyboard extension, a Home Screen widget, Control Center, Back Tap and Apple Watch. Raw text first; AI cleanup and templates only when you ask.

Free, no in-app purchases. Source available on GitHub (PolyForm Noncommercial).

App Store: {{APP_STORE_LINK}}

—

PL: Whisperio jest w App Store. Dyktowanie na iPhone'a, iPada i Apple Watch bez mojego serwera: domyślnie rozpoznawanie mowy na urządzeniu, a modele w chmurze tylko z Twoim własnym kluczem API. Bez konta, bez subskrypcji. Chętnie przeczytam opinie.

#productivity #iOS #privacy #speechtotext #indiedev
```

### L2 — the "no server" decision (EN)

<!-- limit:3000 -->
```
A product decision I'd make again: Whisperio has no server.

It removed whole categories of work and risk. No accounts to secure, no audio stored on my side, no billing system. The app talks directly to the provider each user chooses, with the user's own key, or stays on-device.

The trade-offs are real: users need to pick a provider if they want a cloud model, and I can't see crashes or usage beyond what Apple's own tools show. For a dictation app, that felt like the right side of the trade.

{{APP_STORE_LINK}}

#productmanagement #privacy #indiedev
```

### L3 — PL post

<!-- limit:3000 -->
```
Tydzień temu Whisperio trafiło do App Store.

To aplikacja do dyktowania na iPhone'a, iPada i Apple Watch, zbudowana z jednym założeniem: żadnego serwera po mojej stronie.
• Domyślnie mowa rozpoznawana jest przez Apple na urządzeniu, bez konta i bez klucza.
• Jeśli chcesz modelu w chmurze, wklejasz własny klucz API, a nagranie idzie z urządzenia prosto do wybranego dostawcy.
• Historia synchronizuje się przez Twój prywatny iCloud (same transkrypcje) albo zostaje na urządzeniu.

Darmowa, bez zakupów w aplikacji. Polskiego interfejsu jeszcze nie ma; jeśli to dla Ciebie ważne, napisz.

{{APP_STORE_LINK}}

#produktywność #iOS #prywatność #dyktowanie
```

### L4 — two weeks in (EN)

<!-- limit:3000 -->
```
Two weeks after launching Whisperio on the App Store, the most common questions were about privacy and providers, not features. That tells me the "no server, your own key" model is the part people care about.

What changed since launch: {{STATUS}}
What's next: {{NEXT}}

Thank you to everyone who tried it and wrote back.

#indiedev #iOS #productivity
```

## 5. Short clips (optional: IG Reels / TikTok, 9:16, 15–25 s)

Studio cuts them from the existing composed screenshots (`mobile/marketing/screenshots/{iphone,ipad,watch}/en/`) with simple motion: Ken Burns pans, a device-frame slide-in, and on-screen text in the brand style. No screen recording is needed. If a real screen recording of the keyboard is made later, it replaces the stills in C1/C2. No music with vocals (text-only story); use a royalty-free beat at low volume.

### C1 — "Dictate anywhere" (20 s)

| Time | Visual (source) | On-screen text EN / PL | Motion |
|---|---|---|---|
| 0–3 s | `iphone/en/01-home.png` | "Talk. It types." / „Mówisz. Pisze.” | zoom-in from 110% to 100% |
| 3–9 s | `iphone/en/02-keyboard.png` | "Keyboard in any app" / „Klawiatura w każdej aplikacji” | slide up from bottom, highlight pulse on the mic key |
| 9–15 s | `watch/en/watch-02-recording.png` → `watch-03-done.png` | "Or from your wrist" / „Albo z nadgarstka” | cross-fade between the two watch frames |
| 15–20 s | logo on a dark background | "Whisperio · free on the App Store" / „Whisperio · za darmo w App Store” | fade in |

Caption:

<!-- limit:2200 -->
```
Dictation on iPhone, iPad and Apple Watch: on-device by default, or bring your own AI key. Free, no account. Link in bio.

#dictation #speechtotext #iphone #applewatch #productivity
```

### C2 — "Your key, your provider" (20 s)

| Time | Visual (source) | On-screen text EN / PL | Motion |
|---|---|---|---|
| 0–4 s | `iphone/en/03-models.png` (top) | "Pick your engine" / „Wybierz silnik” | slow pan down |
| 4–12 s | same, provider list area | "On-device · OpenAI · Groq · Deepgram · …" / „Na urządzeniu · OpenAI · Groq · Deepgram · …” | names appear one by one as text overlays |
| 12–17 s | plain card | "Your key. Straight to the provider." / „Twój klucz. Prosto do dostawcy.” | type-on text |
| 17–20 s | logo | "No server of ours" / „Bez naszego serwera” | fade in |

Caption:

<!-- limit:2200 -->
```
Whisperio has no server of its own. Use Apple's on-device recognition, or paste your own API key and your audio goes straight to that provider.

#privacy #ai #speechtotext #iosapps
```

### C3 — "Your journal" (15 s)

| Time | Visual (source) | On-screen text EN / PL | Motion |
|---|---|---|---|
| 0–5 s | `iphone/en/04-journal.png` | "Every dictation, searchable" / „Każde dyktowanie do znalezienia” | pan across categories |
| 5–11 s | `iphone/en/05-recap.png` | "Optional daily recap" / „Opcjonalne podsumowanie dnia” | slide in from the right |
| 11–15 s | `ipad/en/01-library.png` | "Also on iPad" / „Także na iPadzie” | zoom-out |

Caption:

<!-- limit:2200 -->
```
Everything you dictate lands in a searchable journal, with an optional AI daily recap. iPhone, iPad, Apple Watch.

#productivity #notes #journaling #ipad
```

### C4 — "Where your audio goes" (20 s)

| Time | Visual (source) | On-screen text EN / PL | Motion |
|---|---|---|---|
| 0–5 s | `iphone/en/06-onboarding.png` | "Where does your voice go?" / „Gdzie trafia Twój głos?” | zoom-in |
| 5–10 s | plain card, phone icon | "On-device: stays on the device" / „Na urządzeniu: zostaje na urządzeniu” | icon pulse |
| 10–15 s | plain card, arrow to a cloud icon labelled "your provider" | "Cloud: straight to the provider you chose" / „Chmura: prosto do dostawcy, którego wybrałeś” | arrow draw |
| 15–20 s | logo | "We run no server" / „Nie mamy serwera” | fade in |

Caption:

<!-- limit:2200 -->
```
On-device by default. Cloud only with your own key, straight to the provider you chose. History in your private iCloud, transcripts only. Details on our privacy page (link in bio).

#privacy #iphone #speechtotext
```

## 6. Hashtags

| Platform | EN | PL |
|---|---|---|
| X | 1–2 max: `#iOS` `#Dictation` / `#SpeechToText` | `#iOS` `#dyktowanie` |
| Bluesky | none or 1 (`#iOS`) | none |
| Mastodon | 3–5, CamelCase for screen readers: `#iOS` `#Dictation` `#SpeechToText` `#Privacy` `#IndieDev` `#SelfHosted` | `#iOS` `#dyktowanie` `#prywatność` |
| LinkedIn | 3–5 at the end: `#productivity` `#iOS` `#privacy` `#speechtotext` `#indiedev` | `#produktywność` `#iOS` `#prywatność` `#dyktowanie` |
| IG / TikTok | 4–5: `#dictation` `#speechtotext` `#iphone` `#applewatch` `#productivity` `#iosapps` | `#dyktowanie` `#iphone` `#produktywność` `#aplikacje` |

## 7. Not verified / to fill

- The Mastodon 500 limit is the default; some instances allow more or less.
- `{{TOP_REQUESTS}}`, `{{NAJCZESTSZE_PROSBY}}`, `{{STATUS}}` and `{{NEXT}}` are filled from real feedback on D+12/D+13. Do not post them with invented content.
- The clips use only the existing screenshots. A desktop clip needs a new capture (no desktop asset in the repo).
- L3 says the UI has no Polish yet: true on 2026-10-16 (no `.lproj` / `.xcstrings` in `mobile/`). Re-check before posting; if Polish ships, delete that sentence.
