# ASO: Whisperio 1.4.1 (App Store, EN + PL)

iOS 1.4.1 is Whisperio's first App Store release. The current listing (`mobile/marketing/listing/en-US.json`) is complete, so this is a set of improvements to it plus a new Polish localization. Both files use the same schema as the uploader input.

| File | Goes to | How |
|---|---|---|
| [app-store.en-US.json](app-store.en-US.json) | `mobile/marketing/listing/en-US.json` | copy 1:1, then `mobile/marketing/pipeline/asc_listing.py --dry-run` → `--apply` |
| [app-store.pl.json](app-store.pl.json) | `mobile/marketing/listing/pl.json` (new locale) | as above. The locale must first be added in ASC (App Information → Localizations → Polish) |

`whatsNew` is deliberately absent. ASC rejects "What's New" on an app's first version, and `asc_listing.py` would send it.

## Gate

```
node docs/launch/1.4.1/tools/check-aso.mjs              # 48 checks + comparison with the current listing
node docs/launch/1.4.1/tools/check-aso.mjs --self-test  # 29 planted defects must all be caught
```

It runs deterministically and offline on Windows and macOS. It checks:

- **Limits:** read from `asc_listing.py`.
- **Keywords:** bytes, spaces, duplicates, repeats of the name or subtitle.
- **Trademarks:** no third-party names in the name, subtitle or keywords (2.3.7). The provider list stays in the description, where it is factual.
- **Pricing words:** none in the name or subtitle.
- **Privacy over-claims** beyond `docs/privacy.html`.
- **License:** no "open source", because PolyForm Noncommercial is source-available.
- **Desktop-only providers:** no Anthropic or Claude.
- **Other banned claims:** "forever", superlatives, medical or legal transcription claims.
- **Required sentences:** the cloud-provider caveat, the license, and the Apple online-recognition caveat. The PL listing also needs the English-only UI disclosure and the on-device language caveat.
- **Privacy link** and **PL/EN parity**.

## Comparison with the current listing (en-US)

| Field | Now | Proposed | Why |
|---|---|---|---|
| Name (30) | `Whisperio` (9) | `Whisperio – AI Dictation` (24) | The name is the strongest-weighted field, and 21 characters were unused. "AI Dictation" is the core search phrase. |
| Subtitle (30) | `AI Dictation, Your Own Keys` (27) | `Voice Typing with Your AI Key` (29) | "AI Dictation" moved to the name. The subtitle now covers "voice typing" and keeps the BYOK hook. |
| Keywords (100 B) | 98 B, with spaces and repeats | 97 B, no spaces | See the keyword changes below. |
| Promo (170) | 102 | 146 | Leads with what is true and different: on-device by default, BYOK, no account, no subscription, no Whisperio server. |
| Description (4000) | 1950 | 2414 | Changes listed below. |

Keyword changes:

- **Removed:**
  - `dictation`: now in the name.
  - `speech to text`, `voice typing`, `ai writing`: the spaces waste bytes, and "voice typing" / "AI" are now in the subtitle.
  - `whisper`: OpenAI's model name (2.3.7 trademark risk).
  - `productivity`: the category already covers it.
- **Added:** `speech`, `text`, `transcribe`, `offline`, `memo`, `journal`, `stt`, `speak`, `meeting`, `writer`. Apple combines words across fields, so `speech` + `text` also match "speech to text".

Description changes:

- **New ON-DEVICE BY DEFAULT section.** This is the main claim queenbee asked to highlight. It also carries the exact caveat from privacy.html §4.1: Apple's servers are used if you allow online recognition, or if your language is not available on-device.
- **Second paragraph:** "No account. No subscription. No Whisperio server."
- **Keys:** "Keys stay in your device's Keychain and are sent only to their own provider" (privacy.html §3, legal note §a).
- **iCloud:** "(transcripts and metadata, no audio)" (verified in d0539f2).
- **Removed** "Whisperio never reads your screen". It isn't stated in privacy.html, so it can't be backed by the policy.
- **Wording fixes:** "real predictive suggestions" became "predictive suggestions", and "speaker diarization" became "speaker labels" (plain language).
- **Privacy Policy link** added at the end.

## Polish localization (new)

- The app UI is English-only (`knownRegions = en, Base`). The PL description says so outright ("Interfejs aplikacji jest po angielsku. Dyktować możesz po polsku."). Journal categories keep their English UI names.
- It doesn't promise on-device Polish recognition: whether a language is available on-device depends on iOS. If you need to be sure audio never leaves the phone, the listing points you to a local model (privacy.html §4.1).

## Not changed (needs a decision)

- **Category, age rating, price:** unchanged (free, 4+).
- **Screenshot headlines:** these live in `compose_ios.py` → `COPY`. A PL screenshot set doesn't exist; until it does, ASC shows the EN set for PL.
- **Mac App Store listing:** it has no Mac screenshots yet, so it is out of scope. Ship iOS first.
