# Whisperio - wpis w Google Play (polski)

Pola do wklejenia w Play Console (Rozwój > Obecność w sklepie > Główny wpis, język polski).
Limity Play: nazwa <=30, krótki opis <=80, pełny opis <=4000 znaków, informacje o wersji <=500.
Liczby znaków zmierzone w `node` (punkty kodowe); bramka `release-readiness` (check `play-listing`) mierzy je ponownie:
`node ~/.claude/skills/release-readiness/tools/check.mjs . --platform android`
Wersja angielska: `android/marketing/play/listing.en.md` (trzymać w parytecie; tabela dowodów i lista "czego nie pisać" są tam).

Zasada (CONTRACT 8.1): tekst NIE może twierdzić "brak zbieranych danych" - w Play nagranie głosu JEST zbieranym
rodzajem danych (opuszcza telefon i trafia do dostawcy wybranego przez użytkownika). Wolno pisać: bez konta, bez
serwera Whisperio, bez analityki, bez reklam.

## Nazwa aplikacji (<=30)

```
Whisperio: dyktowanie głosem
```
Znaków: 28/30

## Krótki opis (<=80)

```
Dyktuj w każdej aplikacji z własnym kluczem API. Bez konta, reklam i analityki.
```
Znaków: 79/80

## Pełny opis (<=4000)

```
Whisperio zamienia Twój głos w tekst w każdej aplikacji. Stukasz mikrofon, mówisz i gotowy tekst ląduje w polu, w którym akurat piszesz. Używasz własnego klucza API wybranego dostawcy rozpoznawania mowy, więc płacisz dostawcy bezpośrednio, a Whisperio jest za darmo.

JAK TO DZIAŁA
Przełącz się na klawiaturę dyktowania Whisperio, stuknij mikrofon, powiedz, co chcesz, i stuknij ponownie. Tekst wstawia się sam. Nie chcesz zmieniać klawiatury? Dodaj kafelek w szybkich ustawieniach albo skrót na ekranie głównym: nagrywasz z dowolnego miejsca, a wynik trafia do schowka i do historii.

TWÓJ KLUCZ, TWÓJ DOSTAWCA
Wybierz usługę, która Ci pasuje, i wklej własny klucz API:
- OpenAI (modele Whisper i GPT-4o do transkrypcji)
- Groq
- Mistral (Voxtral)
- ElevenLabs (Scribe)
- Deepgram
- AssemblyAI
- Własny serwer z API transkrypcji zgodnym z OpenAI (np. faster-whisper albo whisper.cpp)
Możesz ustawić kolejność dostawców i opcjonalnie przechodzić do następnego, gdy pierwszy zawiedzie. Klucz jest sprawdzany przed zapisem i trzymany na telefonie w postaci zaszyfrowanej w Android Keystore.

CO DOSTAJESZ
- Klawiatura do dyktowania z dużym mikrofonem, wskaźnikiem poziomu, backspace'em, spacją i enterem
- Kafelek w szybkich ustawieniach i skrót "Dyktuj" na ekranie głównym
- Język wykrywany automatycznie albo wybrany: polski, angielski, niemiecki, hiszpański, francuski, włoski, portugalski, niderlandzki, rosyjski, ukraiński
- Własny słownik na imiona i terminy (wysyłany do dostawców, którzy to obsługują)
- Opcjonalne porządkowanie tekstu: poprawia odstępy i powtórzone słowa, nie przepisuje tego, co powiedziałeś
- Lokalna historia dyktowań: wyszukiwanie, grupowanie po dniach, filtrowanie po źródle i nieudanych dyktowaniach, kopiowanie, udostępnianie, usuwanie
- Tygodniowe podsumowanie: słowa, notatki, zaoszczędzone minuty i serie, z kartą z samymi liczbami do udostępnienia
- Kategorie: sześć wbudowanych i własne, widoczne przy każdym nagraniu, z filtrem i wyszukiwaniem
- Liczba słów przy każdej transkrypcji
- Gesty na liście: usuwanie przesunięciem (z opcją Cofnij), kopiowanie dwukrotnym stuknięciem i usuwanie całego dnia
- Eksport transkrypcji do .txt lub .md przez systemowy wybór pliku
- Odtwarzanie zapisanego nagrania i ponawianie transkrypcji u innego dostawcy
- Widżet na ekranie głównym do szybkiego dyktowania
- Delikatna wibracja przy kopiowaniu, wstawieniu i gotowym tekście
- Opcjonalnie: pamiętanie języka dyktowania dla każdej aplikacji (domyślnie wyłączone, tylko na tym urządzeniu)
- Opcjonalne automatyczne zatrzymanie przy ciszy i czyszczenie historii po 1, 7 lub 30 dniach
- Ciemny i jasny motyw, interfejs po polsku i angielsku

PRYWATNOŚĆ BEZ OWIJANIA
- Za darmo. Bez zakupów, bez subskrypcji, bez reklam.
- Bez konta i logowania. Nie ma serwera Whisperio, analityki ani śledzenia.
- Gdy dyktujesz, nagranie (i Twój słownik, jeśli go ustawisz) leci prosto z telefonu do wybranego przez Ciebie dostawcy, na Twoim kluczu. Przed pierwszym wysłaniem Whisperio prosi o Twoją zgodę, a to, co dostawca dostaje, podlega jego regulaminowi i polityce prywatności.
- Historia, nagrania i klucze zostają na telefonie. Są wyłączone z kopii zapasowych Androida i przenoszenia na nowe urządzenie. Jedno stuknięcie "Usuń wszystkie dane" w ustawieniach kasuje je wszystkie.
- Klawiatura nie zapisuje ani nie wysyła tego, co piszesz. W polach z hasłem dyktowanie jest wyłączone.
- Mikrofon działa tylko wtedy, gdy nagrywasz, na widocznym ekranie.

WYMAGANIA
Android 8.0 lub nowszy, dostęp do internetu i klucz API jednego z powyższych dostawców (większość ma darmowy plan albo płatność za użycie). Whisperio nie ma własnej usługi rozpoznawania mowy.

Polityka prywatności: https://whisperio.danielkasprzyk.com/privacy.html
Regulamin: https://whisperio.danielkasprzyk.com/terms.html
Pomoc: https://whisperio.danielkasprzyk.com/support.html
```
Znaków: 3856/4000

## 1.2.0 (<=500)

```
Nowości w 1.2:
- Tygodniowe podsumowanie: słowa, notatki, zaoszczędzone minuty i serie, z kartą do udostępnienia
- Kategorie: sześć wbudowanych i własne, widoczne na liście, z filtrem i wyszukiwaniem
- Liczba słów przy każdej transkrypcji
- Usuwanie nagrania przesunięciem, z opcją Cofnij
- Kopiowanie tekstu dwukrotnym stuknięciem
- Usuwanie całego dnia z jego nagłówka
```
Znaków: 370/500

Plik: `android/marketing/play/release-notes/1.2.0/pl-PL.txt`

## Informacje o wersji 1.1.0 (<=500)

```
Nowości w 1.1:
- Wyszukiwanie w historii i grupowanie jej po dniach
- Filtrowanie po źródle i nieudanych dyktowaniach
- Eksport transkrypcji do .txt lub .md
- Odtwarzanie zapisanego nagrania
- Ponawianie transkrypcji u innego dostawcy
- Widżet na ekranie głównym do startu dyktowania
- Delikatna wibracja przy kopiowaniu, wstawieniu i gotowym tekście
- Opcjonalnie: pamiętanie języka klawiatury dla każdej aplikacji (domyślnie wyłączone)
```
Znaków: 437/500

Plik: `android/marketing/play/release-notes/1.1.0/pl-PL.txt`

## Informacje o wersji 1.0.0 (<=500)

```
Pierwsza wersja Whisperio na Androida.
- Klawiatura do dyktowania, kafelek w szybkich ustawieniach i skrót na ekranie głównym
- Własny klucz API: OpenAI, Groq, Mistral, ElevenLabs, Deepgram, AssemblyAI lub własny serwer
- Lokalna historia z kopiowaniem, udostępnianiem i ponawianiem
- Za darmo, bez konta, reklam i analityki
```
Znaków: 324/500

## Kategoria i kontakt

- Kategoria: Produktywność (alternatywnie: Narzędzia). Typ: Aplikacja. Bezpłatna.
- E-mail kontaktowy: daniel@danielkasprzyk.com (jak na `docs/support.html`). Strona: https://whisperio.danielkasprzyk.com/
- Pole polityki prywatności: https://whisperio.danielkasprzyk.com/privacy.html
