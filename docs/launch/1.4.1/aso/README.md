# ASO: Whisperio 1.4.1 (App Store, EN + PL)

iOS 1.4.1 is Whisperio's first App Store release. The current listing (`mobile/marketing/listing/en-US.json`) is complete, so this is a set of improvements to it plus a new Polish localization. Both files use the same schema as the uploader input.

> **Merge on hold.** The listing says API keys stay in the device Keychain. That will only be true once workerbee mac's P0 fix lands: `replicateKey` and `selfHostedKey` currently sit in plain UserDefaults (`WhisperioKit/Settings.swift:168,175`). This branch merges only after mac reports the fix merged (queenbee decision, 2026-10-16).

| File | Goes to | How |
|---|---|---|
| [app-store.en-US.json](app-store.en-US.json) | `mobile/marketing/listing/en-US.json` | copy 1:1, then run `mobile/marketing/pipeline/asc_listing.py --dry-run`, then `--apply` (on the Mac: the script reads files without `encoding="utf-8"`, which breaks Polish letters on Windows) |
| [app-store.pl.json](app-store.pl.json) | `mobile/marketing/listing/pl.json` (new locale) | same as above; first add the Polish locale in ASC (App Information → Localizations) |

`whatsNew` is left out on purpose: ASC rejects "What's New" on an app's first version, and `asc_listing.py` would send it.

## Gate

```
node docs/launch/1.4.1/tools/check-aso.mjs              # 53 checks + comparison with the current listing
node docs/launch/1.4.1/tools/check-aso.mjs --self-test  # 40 planted defects + 1 clean case, incl. the 9 adversarial strings from the Opus review
```

It is deterministic, runs offline, and works on Windows and macOS. It checks:

- **Limits:** taken from `asc_listing.py`.
- **Keywords:** bytes, spaces, duplicates, repeats of the name or subtitle.
- **Trademarks:** none in the name, subtitle or keywords (OpenAI/GPT/Whisper/Gemini…, 2.3.7).
- **Price words:** none in the name or subtitle (diacritics folded: darmowe, bezpłatne).
- **Privacy over-claims:** nothing beyond `docs/privacy.html`.
- **License:** no "open source" in any spelling. The license is source-available.
- **Not yet available:** no Anthropic/Claude (desktop only), no Mac app (Mac App Store not shipped).
- **Banned wording:** "forever", superlatives, medical or legal transcription.
- **Required sentences:**
  - cloud-provider caveat;
  - license;
  - Apple online-speech caveat;
  - cost is an estimate (`ProviderPricing.swift`);
  - PL only: English-only UI and the on-device language caveat.
- **Also:** the privacy link and PL/EN parity.

## Comparison with the current listing (en-US)

| Field | Now | Proposed | Why |
|---|---|---|---|
| Name (30) | `Whisperio` (9) | `Whisperio – AI Dictation` (24) | The name is the strongest-weighted field, and 21 characters were unused. "AI Dictation" is the core phrase. Allowed under 2.3.7 (brand + short descriptor). |
| Subtitle (30) | `AI Dictation, Your Own Keys` (27) | `Voice Typing, Your Own API Key` (30) | "AI Dictation" moved to the name; the subtitle adds "voice typing" and a concrete BYOK hook. |
| Keywords (100 B) | 98 B, with spaces and repeats | 93 B, no spaces | Removed: `dictation` (in the name), `speech to text` / `voice typing` / `ai writing` (spaces waste bytes; now covered by name and subtitle), `whisper` (OpenAI's model name), `productivity` (category). Added: `speech,text,transcribe,transcription,offline,notes,memo,journal,dictate,talk,meeting`. Apple combines words across fields, giving "speech to text", "talk to text" and "voice memo". |
| Promo (170) | 102 | 141 | On-device by default, BYOK, no account, no subscription, no Whisperio server. Mac removed. |
| Description (4000) | 1950 | 2610 | Changes listed below. |

### Description changes, and corrections after the Opus review

- **ON-DEVICE BY DEFAULT** (new): Apple's servers are used only when the user turns on Apple online speech in the app. If a language isn't available on-device, the app shows an error; it does not fall back silently (`AppleSpeechProvider.swift:48-51`). This matches privacy.html §4.1.
- **Cost:** "see exactly what it costs" is wrong. The app shows an estimate from the provider's list price (`ProviderPricing.swift:3-6`). New wording: "you pay the provider directly at its own rates, and Whisperio shows an estimate".
- **Mac:** removed from the promo, the sync line and the bullets. The Mac App Store version isn't released yet (release-runbook §4), and an iOS listing must not advertise it.
- **Text insertion:** text goes directly into the field only with the Whisperio keyboard. The widget, Back Tap and Control Center copy it to the clipboard (review notes, step 2).
- **Speaker labels:** they only work "with cloud engines that support it".
- **Removed** "Whisperio never reads your screen", which privacy.html doesn't state.
- **Keys:** "Keys stay in your device's Keychain" stays, and becomes true after the P0 fix (see the merge hold at the top).

## Polish localization (new)

- The app UI is English-only (`knownRegions = en, Base`). The PL description says so outright ("Interfejs aplikacji jest po angielsku. Dyktować możesz po polsku."), and journal categories keep their English UI names.
- It doesn't promise Polish recognition on-device. If Polish isn't available on-device, the listing tells the user to turn on Apple online speech or download a local model.
- Keywords: `mowy,zamiana` + "mowa", "na" and "tekst" from the subtitle cover "zamiana mowy na tekst"; `głos` keeps its diacritic.
- Wording follows Apple's PL terms ("ekran początkowy") and plain Polish ("Prywatność z założenia", "Szybko i wygodnie", "Własny słownik").

## Not changed (needs a decision)

- Category, age rating (4+) and price (free) are unchanged.
- There is no PL screenshot set (headlines are in `compose_ios.py` → `COPY`). Until one exists, ASC shows the EN set for PL.
- An en-GB localization could add keyword bytes in EU storefronts. Check Apple's storefront-to-locale table before deciding.
- After a merge, nothing gates `mobile/marketing/listing/*.json` itself. The 1:1 copy is a separate PR on release day, and this gate should be run against the copied files before `--apply`.
