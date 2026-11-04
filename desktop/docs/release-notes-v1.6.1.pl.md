# Whisperio v1.6.1 — nowy wygląd, czytelniejsze błędy

**Aplikacja ma teraz turkusowego ducha z aplikacji na iOS, błędy offline mówią, co jest nie tak, a Erase all nie zostawia już po cichu nagrań na dysku.**

Platformy: **Windows** teraz. Wersja na macOS pojawi się osobno.

## ✨ Najważniejsze

**Turkusowy duch w ikonie.** Ikony aplikacji, instalatora, deinstalatora, okna i zasobnika to teraz turkusowy duch z aplikacji na iOS zamiast fioletowego. Ikona w zasobniku to wycięty duch na przezroczystym tle, dzięki czemu jest czytelna przy 16 px.

**Czytelne błędy sieci.** Gdy jesteś offline, dostawcy rozpoznawania mowy pokazują teraz *Network error. Check your connection.* zamiast surowego kodu, np. `net::ERR_INTERNET_DISCONNECTED` lub `ECONNRESET`. Zapytanie do Replicate, które trwa zbyt długo, informuje teraz o przekroczeniu czasu (55 s) zamiast *This operation was aborted*.

**Erase all zgłasza, czego nie udało się usunąć.** Przy wyłączonym szyfrowaniu historii nagrania, których nie dało się usunąć (np. zablokowane przez antywirusa), są teraz zgłaszane, a Whisperio ponawia próbę przy następnym uruchomieniu. Wcześniej zostawały na dysku bez żadnej informacji.

## 🔧 Niezawodność i bezpieczeństwo
- Sprawdzanie adresów sieci lokalnej ocenia teraz adresy IPv6 unique-local i link-local po wartości, a nie po przedrostku tekstowym.
- Nieudane sprawdzanie i pobieranie aktualizacji w tle nie powoduje już nieobsłużonych błędów; nieudany zapis zaszyfrowanego nagrania nie zostawia pustych plików.
- Wiele nowych testów obejmuje weryfikację podpisu aktualizacji, ścieżki nagrań, sumy użycia i eksperymentalny model lokalny.

## 📝 Uwagi
- **Pamięć podręczna ikon w Windows:** Windows trzyma ikony w pamięci podręcznej, więc po aktualizacji stara ikona może zostać na skrócie na pulpicie lub na pasku zadań do restartu Eksploratora (Menedżer zadań, Eksplorator Windows, Uruchom ponownie) albo do wylogowania i ponownego zalogowania.
- Aktualizacja z 1.6.0 zachowuje ustawienia, historię i klucze.
- Pełna lista zmian: `desktop/CHANGELOG.md`
