# HANDOFF: workerbee launch (Whisperio 1.4.1), stan 2026-10-16

Pełny handoff: zryw `docs/launch/HANDOFF-launch.md` (zasady pszczoły, kolejka ciężkich zadań, zużycie). W tym repo nie ma PR-ów: gałąź, review, `git merge --no-ff`, `git push origin HEAD:main`. Bramki sprawdzaj po kodzie wyjścia.

## Zrobione (main)

| Co | Commit | Bramka |
|---|---|---|
| Plan społeczności (r/macapps, r/iOSapps, Show HN, PH) + social 2 tyg. | 0b780a3 | `node docs/launch/1.4.1/tools/check-copy.mjs` |
| ASO EN + PL (`docs/launch/1.4.1/aso/`) | d198d0a | `node docs/launch/1.4.1/tools/check-aso.mjs` (+ `--self-test`, 48) |
| Wejście uploadera = ASO po bramce, bez Maca (`mobile/marketing/listing/{en-US,pl}.json`) | cc7e500 | `check-aso`: `listing-sync`, `ios-first` |
| Sekcja iOS na stronie za flagą, strony prawne bez twierdzeń o dostępności przed premierą | 789849e | `node docs/launch/1.4.1/tools/check-site.mjs` (+ `--self-test`, 30) |
| Metadane (title/description/og/twitter): Mac/Windows/Linux teraz, iOS „coming” | 8d70f6f, 2369964 | `check-site` |

## Otwarte

- **App Store Connect (pszczoła mac, tylko Mac ma klucz):**
  1. `python3 mobile/marketing/pipeline/asc_listing.py --dry-run`
  2. dodać lokalizację `pl` w ASC dla iOS 1.4.1
  3. `--apply` (IOS, nie MAC_OS)
  4. `--dry-run` ma pokazać 0 zmian
- **Do pszczoły mac/legal:** Mac App Store ma własny przegląd sformułowań (runbook §4.1).

## Dzień premiery iOS

`docs/release-runbook.md` §3.8, kroki 1–6:
1. flaga `data-appstore-live="true"`
2. meta `apple-itunes-app`
3. statyczny link i `installUrl`
4. usunąć „coming soon” w `privacy.html`/`terms.html`
5. metadane `<head>`
6. `check-site` = PASS

Bramka pilnuje obu stanów flagi. Po włączeniu flagi oblewa każde pozostałe „coming”.

## Dzień premiery Mac App Store

Runbook §4.1. W tym samym commicie przestaw `MAC_APP_STORE_LIVE = true` w `docs/launch/1.4.1/tools/check-aso.mjs`. Mac potrzebuje własnego tekstu listingu; nie wysyłaj tekstu iPhone'a do `MAC_OS`.

## Fakty do tekstów

- Domyślnie rozpoznawanie mowy Apple na urządzeniu. Serwery Apple tylko po włączeniu rozpoznawania online. Język niedostępny na urządzeniu daje błąd, chyba że użytkownik sam ustawi chmurowy silnik zapasowy.
- Klucze w Keychain tylko na tym urządzeniu (015e621).
- Koszt to szacunek.
- Klawiatura otwiera aplikację, tekst trafia do pola po powrocie. Widżet, Centrum sterowania i Back Tap kopiują do schowka. Watch zapisuje do historii.
- Licencja source-available, nie open source. UI tylko po angielsku.
- Nie piszemy „100% private”. Nic ponad `privacy.html`.
