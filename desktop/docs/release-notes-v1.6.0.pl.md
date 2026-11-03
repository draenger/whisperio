# Whisperio v1.6.0 — prywatność z wyboru, stabilność na co dzień

**Opcjonalne szyfrowanie historii i nagrań, tryb „przytrzymaj, aby mówić” i długa lista poprawek niezawodności oraz bezpieczeństwa.**

Platformy: **Windows** i **Linux**. Wersja na macOS pojawi się osobno.

## ✨ Najważniejsze

**Szyfrowanie historii i nagrań (opcjonalne).** Settings → Privacy → *Encrypt history and recordings* (interfejs jest po angielsku). Po włączeniu historia transkrypcji i zachowane nagrania są zapisywane na dysku w postaci zaszyfrowanej, a klucz trzyma systemowy pęk kluczy. Domyślnie **wyłączone**: nic się nie zmienia, dopóki go nie włączysz. Po włączeniu dotychczasowe dane są szyfrowane w tle, a *Erase all history* niszczy klucz, więc usuniętych danych nie da się odzyskać.

**Przytrzymaj, aby mówić.** Nowy tryb skrótu: trzymasz klawisz, nagrywasz; puszczasz, dostajesz tekst. Działa też na układach klawiatury innych niż amerykański. W tym wydaniu tylko na Windowsie; na Linuksie zostaje tryb przełączania.

**Sterowanie ze Stream Decka i skryptów.** Dyktowanie można włączać i wyłączać z wiersza poleceń: `Whisperio --toggle | --start | --stop | --cancel`.

**Pomijanie ciszy.** Nagrania bez mowy w ogóle nie trafiają do dostawcy (bez pustego wklejenia i bez opłaty). Opcjonalnie można też przyciąć ciszę na początku i końcu przed wysłaniem.

**Twój schowek zostaje.** Opcjonalnie: po wklejeniu tekstu Whisperio przywraca poprzednią zawartość schowka.

## 🔧 Niezawodność
- Długie transkrypcje nie przepadają już po cichu po 60 s, gdy dostawca wciąż pracuje.
- Porządkowanie przez AI nie może już odrzucić dobrej transkrypcji ani drugi raz obciążyć kolejnego dostawcy rozpoznawania mowy.
- Każdy dostawca dostaje dźwięk w formacie, którego oczekuje (WAV nie jest już wysyłany jako WebM), a ponowne przetwarzanie lokalnym modelem znów działa.
- Lokalny serwer whisper uruchamia się ponownie na żądanie po wyładowaniu w bezczynności i zatrzymuje się przy zamknięciu aplikacji.
- Mikrofon zostaje zwolniony po szybkim zatrzymaniu lub anulowaniu; gdy wybranego mikrofonu nie ma, używany jest domyślny.
- Plik ustawień zablokowany przez inny program nie resetuje już ustawień do domyślnych, a zapis jest trwały.
- Dwa nagrania zapisane w tej samej sekundzie nie nadpisują już sobie dźwięku, a nieczytelny indeks nagrań jest odkładany na bok zamiast nadpisywany.

## 🔒 Bezpieczeństwo
- Klucze API dostawców są przechowywane wyłącznie w bezpiecznym magazynie systemu, bez awaryjnego zapisu otwartym tekstem. Na Linuksie bez pęku kluczy dostajesz jednorazowe ostrzeżenie, a klucze działają do końca sesji.
- Pobierany whisper-server i modele są sprawdzane względem przypiętych skrótów SHA-256.
- Ostrzejsza kontrola komunikacji między oknem aplikacji a procesem w tle (tylko dozwolone pola, ścieżki ograniczone do folderu nagrań).
- Klucz synchronizacji z GitHubem nie jest już po cichu podmieniany przy chwilowym błędzie pęku kluczy, a logowanie do GitHuba otwiera tylko strony weryfikacji github.com.
- Tekst transkrypcji i schowka trafia do porządkowania AI wyraźnie oznaczony jako dane, a nie polecenia.
- Electron 42 z aktualnymi poprawkami bezpieczeństwa Chromium.

## 📝 Uwagi
- Aktualizacja z 1.5.x zachowuje ustawienia, historię i klucze. Szyfrowanie pozostaje wyłączone, dopóki go nie włączysz.
- Pełna lista zmian: `desktop/CHANGELOG.md`
