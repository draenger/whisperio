# Whisperio iOS 1.4.1: community launch plan (dev / productivity / Apple + PL)

Scope: the first App Store release of Whisperio for iPhone, iPad and Apple Watch (1.4.1). The desktop app (Windows / macOS / Linux) stays on GitHub Releases (publish the current version there before D0; the latest release today is v1.3.0, so no copy names a desktop version); the Mac App Store build is not submitted yet, so no copy here promises it.

Gate: `node docs/launch/1.4.1/tools/check-copy.mjs` (and `--self-test`). Fenced blocks are copy to paste; `<!-- limit:N -->` above a block is the platform limit the gate enforces.

Placeholders filled on the day: `{{APP_STORE_LINK}}` (`https://apps.apple.com/app/id6781780531`, 404 until release), `{{DATA_PREMIERY}}`, `{{DATA_PH}}`.

## 0. Ground rules (all communities)

1. **Say who you are in the first line**: "I'm the developer" / "To moja aplikacja". Every community below punishes hidden promotion.
2. **One community per day**, each text adapted to the place. Never cross-post the same text on the same day.
3. **No vote requests** anywhere (HN, PH, Reddit, Wykop). Ask for feedback, not upvotes; don't send the link to friends asking them to vote (HN and PH both treat that as manipulation).
4. **Reply to every comment for the first 24 h**, including criticism, without arguing.
5. **Privacy claims stop at `docs/privacy.html`.** Allowed:
   - "we run no server and collect nothing";
   - "on-device by default";
   - "audio goes from your device straight to the provider you choose, or nowhere when you stay on-device".

   Not allowed:
   - `100% private`;
   - `nothing ever leaves your device`, which is false once a cloud provider is chosen, and for Apple's recognizer if online recognition is allowed;
   - `end-to-end encrypted`;
   - `GDPR/HIPAA compliant`;
   - `no data collected` as an absolute (the App Privacy label decision is still pending).
6. **License**: Whisperio is **source-available** (PolyForm Noncommercial 1.0.0), **not `open source`**. If asked, say so plainly (answer A4 below).
7. **No competitor bashing.** If someone asks "how is this different from X", answer about Whisperio's model (free, BYOK, on-device default, no server), not about X.

## 1. Where, rules, verdict

Reddit and its mirrors returned 403/502 from this machine on 2026-10-16. Rules marked *mirror* come from third-party summaries. **Re-read the sidebar / pinned post on the day of posting.**

| Community | Self-promo rule (source) | Verdict | When | Text |
|---|---|---|---|---|
| Hacker News, Show HN | "Show HN is for something you've made that other people can play with"; make it easy to try, ideally without sign-ups; routine version releases generally don't qualify; don't ask friends to upvote or comment. Source: https://news.ycombinator.com/showhn.html (read 2026-10-16) | **YES**. Whisperio is free, needs no account, works with no API key (on-device default), and the desktop app is downloadable. Frame it as the app, not "version 1.4.1". If Whisperio desktop was already a Show HN, post this as a regular submission instead | D+3, Tue–Thu, 14:00–16:00 CET (US morning) | H1, H2 |
| Product Hunt | Tagline ≤ 60, description ≤ 260, gallery 1270×760 (up to 8), thumbnail 240×240. Source: third-party guides (no official spec page found); check the live form | **YES** | Tue–Thu after D+7, 00:01 PT (09:01 CET) | P1–P4 |
| r/macapps | *Mirror* (2026 "App Pile" megathread): new **dictation / speech-to-text apps** and apps not on the Mac App Store are limited to the monthly megathread; promotion counts toward a 30-day limit (Rule 3); format "PCP": problem, comparison, pricing + link | **Megathread only.** Whisperio is both a dictation app and (on Mac) not yet on the Mac App Store. One comment in the current month's megathread | D+2 | R1 |
| r/iOSapps | *Mirror* (leadsrover.io, checked 2026-05-30): "Infrequent self-promotion is permitted; however, it is not permitted more than once per developer in 30 days." Developer flair ("Dev - Self Promotion") and a "[FREE]" title tag seen on mirrors | **YES**, once, with dev flair | D+1 | R2 |

> **r/iOSapps, sprawdzić w D-1:** świeży post modów („Post Policy Changes”, ok. 2–3 tygodnie temu wg review 2026-10-16) przenosi promocje i kody do cotygodniowego przypiętego megawątku, gdzie top-level piszą tylko deweloperzy, z obowiązkowym ujawnieniem. Jeśli to obowiązuje: post premierowy idzie do megawątku, bez tagu „[FREE]” (może być czytany jako promocja cenowa).
| r/apple | *Mirror*, conflicting: one summary says self-promotion only on **Sundays, developers only, self-post**, with an activity requirement; another says only in a dedicated thread | **Only if** the sidebar confirms the Sunday developer slot and the account has prior participation there. Otherwise skip | first Sunday after D0 | R3 |
| r/productivity | No current rule text found; similar subs ban referral links, several moved promotion to sister subs in 2026 | **Default NO.** Check the sidebar; post only in a designated self-promo thread if one exists | — | (R4 as a comment) |
| r/SideProject | *Guides*: the most promotion-friendly sub; bare landing-page drops get removed; build story + asking for feedback works | **YES** | D+4 | R4 |
| Wykop (Mikroblog) | wykop.pl/regulamin: no spam or vote manipulation (pt 5.8); commercial messages must be "easily recognisable" (annex 3 pt 1). Same reading as the Zryw plan, 2026-10-16 | **YES**, a Mikroblog entry opening with "to moja aplikacja" | D+5 | W1 |
| r/Polska | Official rules not readable (403); the community reacts hard to hidden ads | **Default NO.** Only if the sidebar allows "I made this" posts with disclosure | — | (W2) |

## 2. Texts

### H1 — Show HN title

<!-- limit:80 -->
```
Show HN: Whisperio – free dictation for iPhone, on-device or with your own key
```

### H2 — Show HN text / first comment (maker)

<!-- limit:2000 -->
```
Hi HN, I'm the developer.

Whisperio is a dictation app: press a hotkey (desktop) or use the Whisperio keyboard, a widget, Control Center, Back Tap or the Watch (iPhone) and speak. With the keyboard the text is inserted after one swipe back to your app; the widget, Control Center and Back Tap copy it to the clipboard; the Watch saves it to your journal.

Two decisions shaped it:

1. No server of my own. There is no Whisperio account and no backend. By default it uses Apple's on-device speech recognition, so you can try it without any API key. If you want a cloud model, you paste your own key for OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral or Replicate (or point it at a self-hosted OpenAI-compatible URL), and audio goes from your device straight to that provider under their terms. Keys stay in the Keychain on that device.

2. Raw text first, cleanup on demand. Dictation pastes immediately; AI cleanup (grammar, templates, your own instruction) runs only when you ask, with OpenAI or an on-device model.

The iOS app is free, no in-app purchases. History syncs through your own private iCloud database by default (transcripts only, no audio); you can keep it on the device instead, or also push it to your own GitHub repo. The desktop app (Windows, macOS, Linux) is on GitHub Releases: bring your own key, or run local Whisper models (one click on Windows; on macOS and Linux you install whisper-server yourself).

The source is available under PolyForm Noncommercial, so you can read exactly how audio and keys are handled.

App Store: {{APP_STORE_LINK}}
Desktop + source: https://github.com/draenger/whisperio

I'd love feedback on the keyboard flow and on which providers you'd want next.
```

### P1 — Product Hunt tagline

<!-- limit:60 -->
```
Free dictation, on-device or with your own AI key
```

### P2 — Product Hunt description

<!-- limit:260 -->
```
Dictate anywhere on iPhone, iPad, Apple Watch and desktop. Apple on-device speech by default, or bring your own key for OpenAI, Groq, Deepgram and more. No account, no subscription, no server of ours: audio goes only to the provider you pick.
```

### P3 — Product Hunt first comment (maker)

<!-- limit:1200 -->
```
Hi Product Hunt, I'm Daniel, the developer.

I wanted dictation that doesn't route my voice through yet another company. Whisperio has no backend: it's on-device by default (Apple's speech recognition, no key needed), or you paste your own API key and audio goes straight from your device to that provider.

What's in the iOS app:
• Keyboard extension, Home Screen widget, Control Center, Back Tap and an Apple Watch trigger
• Raw text instantly; AI cleanup and templates only when you ask
• Personal dictionary, journal with categories, optional daily digest
• History in your private iCloud by default (transcripts only), or on-device only

It's free with no in-app purchases; you pay your provider directly, or nothing if you stay on-device.

Questions about privacy, providers or the license: ask away, I'll answer all day.
```

### P4 — Product Hunt gallery (1270×760, order)

1. Hero: `mobile/marketing/screenshots/iphone/en/01-home.png` on the brand background, tagline P1.
2. "Type with your voice in any app": `02-keyboard.png` **only after the screenshot headline is corrected** (current headline claims text lands where you type from Action Button/Back Tap/Watch, which is false); until then use the device frame without the headline.
3. "Your engine, your key": `03-models.png` **only after the headline is corrected** (current one says `Audio never leaves your iPhone`); it shows the on-device models screen (Whisper, Qwen), not the cloud provider list.
4. "A searchable journal": `04-journal.png`.
5. "Daily recap (optional)": `05-recap.png`.
6. Apple Watch: `mobile/marketing/screenshots/watch/en/watch-02-recording.png` + `watch-03-done.png` side by side.
7. iPad: `mobile/marketing/screenshots/ipad/en/01-library.png`.
8. Desktop: a capture of the desktop app with the global hotkey overlay (to be taken; no file in the repo yet).

Thumbnail 240×240: `icon.png` (repo root).

### R1 — r/macapps, comment in the monthly megathread (PCP format)

<!-- limit:1500 -->
```
Whisperio (I'm the developer) — dictation for Mac, iPhone, iPad and Apple Watch

Problem: I wanted system-wide dictation without a subscription and without my voice going through the app maker's servers.

How it compares: unlike dictation apps built around their own cloud account or a subscription, Whisperio runs no server at all: on-device by default on iPhone (Apple speech), or you bring your own API key (OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral, Replicate, or a self-hosted OpenAI-compatible URL) and audio goes straight to that provider. Raw text pastes instantly; AI cleanup only when you ask.

Pricing: free, no in-app purchases. You pay your provider directly, or nothing on-device.

iPhone/iPad/Watch: {{APP_STORE_LINK}}
Desktop (Windows/macOS/Linux, GitHub Releases) + source (PolyForm Noncommercial): https://github.com/draenger/whisperio
```

### R2 — r/iOSapps (flair: developer / self-promotion)

Title:

<!-- limit:300 -->
```
[FREE] Whisperio — dictation keyboard + widget + Watch, on-device by default or your own API key (I'm the dev)
```

Body:

<!-- limit:1500 -->
```
Hi, I'm the developer. Whisperio 1.4.1 just landed on the App Store.

• Dictate from a custom keyboard in any app, the Home Screen widget, Control Center, Back Tap or your Apple Watch
• Default engine: Apple's on-device speech recognition, so it works without any API key or account
• Want a cloud model? Paste your own key (OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral, Replicate) and audio goes from your phone straight to that provider. I run no server.
• Raw text first, AI cleanup and templates only when you ask
• Journal with categories, personal dictionary, optional daily digest; history syncs via your private iCloud (transcripts only) or stays on-device

Free, no in-app purchases. Feedback very welcome, especially on the keyboard.

{{APP_STORE_LINK}}
```

### R3 — r/apple (only the developer Sunday self-post, if the sidebar confirms it)

<!-- limit:1500 -->
```
[Dev] I built a free dictation app with no server behind it: on-device by default, or bring your own API key

I'm the developer. Whisperio is a dictation keyboard, widget and Apple Watch app. By default it uses Apple's on-device speech recognition; if you want a cloud model you paste your own key and the audio goes from your device directly to that provider. There's no account and no backend of mine; history can sync through your own private iCloud database (transcripts only, no audio) or stay on the device.

Free, no in-app purchases. The source is available on GitHub (PolyForm Noncommercial).

App Store: {{APP_STORE_LINK}}
Happy to answer anything about how it handles audio and keys.
```

### R4 — r/SideProject

<!-- limit:2500 -->
```
I built a dictation app with no backend at all — here's what that forced me to do (I'm the dev)

Whisperio started as a desktop hotkey app: press, speak, text gets pasted. This week the iPhone/iPad/Watch version hit the App Store (1.4.1).

The constraint I set: no server of my own, ever. That meant:
• On iPhone, on-device by default (Apple speech), so a new user needs no key and no account
• "Bring your own key" for cloud models: OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral, Replicate or a self-hosted endpoint; keys live in the Keychain on that device
• Sync through the user's own private iCloud database instead of a backend (transcripts only)
• A free app with no in-app purchases, because there's nothing for me to bill for

Hardest part: a system-wide keyboard extension that feels instant while the transcription runs elsewhere.

App Store: {{APP_STORE_LINK}}
Desktop + source (PolyForm Noncommercial): https://github.com/draenger/whisperio

What would make you switch your dictation setup?
```

### W1 — Wykop, Mikroblog (PL)

<!-- limit:2000 -->
```
To moja aplikacja, jestem jej jedynym autorem. Wrzucam po opinię.

Whisperio to dyktowanie na iPhone'a, iPada i Apple Watch (plus wersja na Windows, macOS i Linux). Interfejs jest po angielsku, dyktować można po polsku. Z klawiaturą Whisperio tekst trafia do pola po jednym przesunięciu z powrotem do aplikacji; widżet, Centrum sterowania i stuknięcie w tył telefonu kopiują go do schowka, a zegarek zapisuje w dzienniku.

Założenie: zero mojego serwera.
• Domyślnie rozpoznawanie mowy Apple na urządzeniu, więc działa bez klucza i bez konta
• Chcesz model w chmurze? Wklejasz własny klucz API (OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Mistral, Replicate) i nagranie idzie z telefonu prosto do tego dostawcy, na jego zasadach
• Historia synchronizuje się przez Twój prywatny iCloud (same transkrypcje, bez nagrań) albo zostaje tylko na urządzeniu
• Darmowa, bez zakupów w aplikacji. Płacisz dostawcy za to, co zużyjesz, albo nic, jeśli zostajesz przy rozpoznawaniu na urządzeniu

Kod jest publicznie dostępny na GitHubie (licencja PolyForm Noncommercial).

App Store: {{APP_STORE_LINK}}

Co byście chcieli dalej: polski interfejs, więcej dostawców, coś innego?

#aplikacje #ios #programowanie #chwalesie
```

### W2 — r/Polska (only if the sidebar allows it)

<!-- limit:300 -->
```
Zrobiłem darmową aplikację do dyktowania na iPhone'a, która domyślnie działa na urządzeniu, a chmury używa tylko z Twoim własnym kluczem API. Bez mojego serwera. Szukam szczerej krytyki (to moja apka)
```

## 3. Answers to expected questions

### A1 — "Is it private? Does my audio go to you?"

<!-- limit:900 -->
```
I run no server and collect nothing — there's no Whisperio account or backend. By default recognition happens on your device with Apple's speech framework (if you turn on online recognition, Apple may process it on their servers). If you pick a cloud provider, audio goes from your device straight to that provider under their terms — so pick one you trust, or stay on-device. History syncs through your own private iCloud database by default (transcripts, no audio); you can keep it on-device only, or turn on sync to your own GitHub repo. Full details: https://whisperio.danielkasprzyk.com/privacy.html
```

### A2 — "How do you make money? What's the catch?"

<!-- limit:600 -->
```
There isn't a business model inside the app: it's free with no in-app purchases and no ads. I built it for myself. You pay your speech/AI provider directly for what you use, or nothing if you stay on-device.
```

### A3 — "Why bring-your-own-key instead of a subscription?"

<!-- limit:700 -->
```
A subscription would mean running a server that sees your audio and marking up API costs. With your own key, you choose the provider and its privacy terms, you see the real price, and you can switch any time. If you don't want any provider, the on-device engine works with no key at all.
```

### A4 — `Is it open source?`

<!-- limit:600 -->
```
Not in the OSI sense. The source is publicly available on GitHub under the PolyForm Noncommercial license: you can read, build and use it for non-commercial purposes, and audit how audio and keys are handled, but commercial use and redistribution need permission.
```

### A5 — "Android?" / "Mac App Store?"

<!-- limit:500 -->
```
There is no Android version. On the Mac, the desktop app (also Windows and Linux) is on GitHub Releases today; a Mac App Store build is in progress but not out yet.
```

### A6 — `Which provider is best / most accurate?`

<!-- limit:500 -->
```
It depends on language, accent and budget, so Whisperio lets you switch per need. I'd rather you try two with your own voice than take my word for it; the on-device engine is a good free baseline.
```

### A7 (PL) — „Czy to jest prywatne? Czy nagrania trafiają do Ciebie?”

<!-- limit:900 -->
```
Nie mam żadnego serwera i niczego nie zbieram: nie ma konta ani backendu Whisperio. Domyślnie mowa jest rozpoznawana na urządzeniu przez Apple (jeśli włączysz rozpoznawanie online, Apple może przetwarzać ją na swoich serwerach). Jeśli wybierzesz dostawcę w chmurze, nagranie idzie z telefonu prosto do niego, na jego zasadach. Historia domyślnie synchronizuje się przez Twój prywatny iCloud (transkrypcje, bez nagrań); możesz ją zostawić tylko na urządzeniu albo włączyć synchronizację do własnego repozytorium GitHub. Szczegóły: https://whisperio.danielkasprzyk.com/privacy.html
```

## 4. Schedule

| Day | Where | Text |
|---|---|---|
| D0 `{{DATA_PREMIERY}}` | release; links checked (App Store 200, privacy 200) | — |
| D+1 | r/iOSapps | R2 |
| D+2 | r/macapps megathread | R1 |
| D+3 (Tue–Thu) | Show HN | H1, H2 |
| D+4 | r/SideProject | R4 |
| D+5 | Wykop Mikroblog | W1 |
| first Sunday | r/apple (only if confirmed) | R3 |
| `{{DATA_PH}}` (Tue–Thu after D+7) | Product Hunt | P1–P4 |

## 5. Not verified

- All Reddit rules: reddit.com and the mirrors returned 403 / 502 from this machine. r/macapps (dictation apps → megathread), r/iOSapps (1 per 30 days), r/apple (Sunday dev self-post) come from third-party summaries. Read each sidebar on the day.
- Product Hunt field limits and gallery size come from guides, not official docs.
- Whether Whisperio (desktop) was already posted as a Show HN; if so, the iOS release is a regular submission.
- Wykop: the same reading of the regulamin as the Zryw plan (2026-10-16).

## 6. Note for the docs/ site (lane 1, not this PR)

`docs/index.html` `<title>`, meta description, og/twitter descriptions and keywords say `Open-Source`; the license is PolyForm Noncommercial (source-available). Every community answer above says "source-available", so the site should match before launch.
