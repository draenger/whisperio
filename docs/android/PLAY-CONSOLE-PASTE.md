# Whisperio Android - Play Console: zakładanie aplikacji krok po kroku (do wklejania)

Dla Daniela. Kolejność = kolejność w Play Console. Pełne uzasadnienia: `docs/android/RELEASE.md` §6,
`docs/android/play-data-safety.md`, `docs/android/review-notes.md`. Aplikacja jest **DARMOWA** - bez płatności,
IAP, Play Billing, reklam, subskrypcji i bez merchant account.

## 1. Utwórz aplikację (Wszystkie aplikacje > Utwórz aplikację)

| Pole | Wartość |
|---|---|
| Nazwa aplikacji | `Whisperio: Voice Dictation` |
| Język domyślny | English (United States) - en-US (polski dodasz jako tłumaczenie w kroku 3) |
| Aplikacja czy gra | **Aplikacja** |
| Bezpłatna czy płatna | **Bezpłatna** (na stałe - nie da się potem zmienić na płatną; tak ma być) |
| Deklaracje | zaznacz: Zasady programu dla deweloperów + przepisy eksportowe USA |

Nazwa pakietu ustali się przy pierwszym AAB: `ai.whisperio.mobile`.

## 2. Podpisywanie (Testowanie i publikowanie > Konfiguracja > Integralność aplikacji)

Zostaw **"Użyj klucza podpisywania aplikacji wygenerowanego przez Google"**. Nasz `whisperio-upload.jks` to tylko klucz
przesyłania (SHA-256 `CF:F7:B7:15:FF:B9:EF:79:7D:EE:B4:FF:56:BA:6F:87:92:A0:33:6B:9A:87:61:82:11:9E:A8:9E:0D:AE:D0:3D`).

## 3. Główny wpis w sklepie (Rozwój > Obecność w sklepie > Główny wpis)

EN (domyślny) - pełny opis i informacje o wersji: `android/marketing/play/listing.en.md`.

| Pole | EN | PL (Dodaj tłumaczenie > polski) |
|---|---|---|
| Nazwa (<=30) | `Whisperio: Voice Dictation` | `Whisperio: dyktowanie głosem` |
| Krótki opis (<=80) | `Dictate into any app with your own API key. No account, no ads, no analytics.` | `Dyktuj w każdej aplikacji z własnym kluczem API. Bez konta, reklam i analityki.` |
| Pełny opis (<=4000) | blok "Full description" z `listing.en.md` | blok "Pełny opis" z `listing.pl.md` |

Grafiki (19.10: kolory teal, bramka `verify.mjs` PASS 18/18; zobacz je zanim wgrasz). Wszystko w jednym folderze
`C:/Users/dkwar/bees/whisperio-play-assets/`:
- Ikona 512x512: `icon-512.png`
- Grafika promocyjna 1024x500: `screenshots/play-feature/{en,pl}/feature.png`
- Zrzuty telefonu 1080x1920 (4 na język): `screenshots/play-phone/{en,pl}/`
- Zrzuty tabletu 1920x1080 (4 na język) - wgraj te same do sekcji **7-calowy tablet** i **10-calowy tablet**:
  `screenshots/play-tablet/{en,pl}/`
- (źródło w repo: `android/marketing/play/screenshots/`, README tam mówi jak odtworzyć)

Kategoria i kontakt (Obecność w sklepie > Ustawienia sklepu):

| Pole | Wartość |
|---|---|
| Kategoria | **Produktywność** (Productivity) |
| Tagi | Productivity, Tools (do wyboru w Console) |
| E-mail | `daniel@danielkasprzyk.com` |
| Witryna | `https://whisperio.danielkasprzyk.com/` |

## 4. Zawartość aplikacji (Zasady > Zawartość aplikacji)

| Sekcja | Odpowiedź |
|---|---|
| Polityka prywatności | `https://whisperio.danielkasprzyk.com/privacy.html` |
| Reklamy | **Nie**, aplikacja nie zawiera reklam |
| Dostęp do aplikacji | "Wszystkie lub niektóre funkcje są ograniczone" > wklej blok z `docs/android/review-notes.md` §3, w miejsce `<PASTE ...>` wpisz **klucz dla recenzenta** (nowy darmowy klucz Groq z niskim limitem; tylko w Console i w menedżerze haseł, nigdy w czacie/repo) |
| Klasyfikacja treści (IARC) | kategoria: Narzędzia/Produktywność; przemoc, seks, hazard, wulgaryzmy: **nie**; komunikacja między użytkownikami: **nie**; udostępnianie lokalizacji: **nie**; zakupy cyfrowe: **nie**. Oczekiwany wynik: PEGI 3 / Everyone |
| Grupa docelowa | **13-15, 16-17, 18+**; nie zaznaczaj dzieci poniżej 13; nie "skierowana głównie do dzieci" |
| Aplikacja informacyjna | Nie |
| Aplikacje rządowe | Nie |
| Funkcje finansowe | Brak |
| Zdrowie | Nie jest aplikacją zdrowotną |
| Identyfikator wyświetlania reklam | **Nie** (brak `AD_ID` w manifeście) |

### Bezpieczeństwo danych (Data safety) - dokładnie tak

| Pytanie | Odpowiedź |
|---|---|
| Czy aplikacja zbiera lub udostępnia dane wymaganych typów? | **Tak** |
| Czy wszystkie dane są szyfrowane podczas przesyłania? | **Tak** |
| Czy użytkownik może poprosić o usunięcie danych? | **Tak** (usuwanie lokalne "Usuń wszystkie dane" + odinstalowanie; nic nie trzymamy na serwerze) |
| Tworzenie konta | **Aplikacja nie pozwala tworzyć kont** (brak URL usuwania konta) |

Typy danych (zaznacz dokładnie te trzy):

| Typ | Zbierane | Udostępniane | Przetwarzane efemerycznie | Wymagane/opcjonalne | Cel |
|---|---|---|---|---|---|
| Pliki audio > **Nagrania głosu lub dźwięku** | Tak | **Nie** | **Nie** | Wymagane | Funkcje aplikacji |
| Aktywność w aplikacji > **Inne treści generowane przez użytkownika** (własny słownik) | Tak | **Nie** | **Nie** | Opcjonalne | Funkcje aplikacji |
| Dane osobowe > **Identyfikatory użytkownika** (własny klucz API dostawcy) | Tak | **Nie** | **Nie** | Wymagane | Funkcje aplikacji |

Sprawdź podgląd: **NIE** może pokazywać "Brak zbieranych danych" (w Play nagranie wysyłane do dostawcy = dane zbierane;
w App Store jest inaczej i tam "Data Not Collected" jest poprawne).

## 5. Testy wewnętrzne (Testowanie > Testy wewnętrzne)

Utwórz ścieżkę, dodaj listę testerów (Twój e-mail + kilka urządzeń), wgraj gotowy AAB
`C:/Users/dkwar/bees/whisperio-play-assets/whisperio-1.0.0-10000.aab` (1.0.0 / versionCode 10000, podpisany kluczem
przesyłania, `jarsigner` OK), potwierdź podpisywanie przez Play, informacje o wersji z `android/marketing/play/release-notes/`,
opublikuj. Po instalacji z linku opt-in: smoke z `docs/android/CONTRACT.md` §9.

## 6. Później

- Konto osobiste założone po 13.11.2023: przed produkcją test zamknięty **12 testerów x 14 dni** (Dashboard pokaże wymóg).
- Produkcja dopiero **po premierze iOS** (jedna premiera naraz).
