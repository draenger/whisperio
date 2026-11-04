# CloudKit: wdrożenie schematu na Production (runbook, ok. 10 minut na Macu)

Kontener `iCloud.ai.whisperio.mobile`, zespół `953Q6T2WTB`. Teraz chodzi o pole
`CD_source` (STRING) w `CD_RecordingEntity`, wiersz PENDING z 2026-10-14 w
[CLOUDKIT_SCHEMA_PROMOTION.md](CLOUDKIT_SCHEMA_PROMOTION.md). Dopóki go nie ma na Production,
nagrania z buildów, które zapisują `source` (od 74), nie synchronizują się.

**Jedyny nieodwracalny krok to kliknięcie w punkcie 3.** Pól wdrożonych na Production nie da się
usunąć, dlatego kroki 1 i 2 pokazują dokładnie, co pójdzie, a skrypt nigdy nie pisze do Production.

Wszystkie polecenia uruchamiasz z katalogu repo na Macu.

## 0. Jednorazowo: token

```
xcrun cktool get-teams
```

Jeśli wypisuje `953Q6T2WTB`, token już jest i przejdź dalej. Jeśli nie, utwórz w CloudKit Console
token typu *management* (ustawienia konta, sekcja z tokenami) i zapisz go:

```
xcrun cktool save-token --type management
```

## 1. Podgląd (nic nie zmienia)

```
bash mobile/WhisperioKit/Scripts/cloudkit-schema.sh plan
```

Oczekiwany wynik, zarówno dla Development, jak i Production:

```
  missing in development:
    + CD_RecordingEntity.CD_source STRING
```

Jeśli Development już ma to pole, zobaczysz `development has every field of the repo schema`.
Wtedy pomiń krok 2.

**STOP**, jeśli lista zawiera cokolwiek innego niż ta jedna linia albo pojawia się `TYPE CONFLICTS`.
Wtedy niczego nie klikaj i wyślij wynik pszczole whisperio.

## 2. Dodanie pola do Development

```
bash mobile/WhisperioKit/Scripts/cloudkit-schema.sh import-dev
```

Skrypt eksportuje aktualny schemat Development i dokleja do niego tylko brakujące pola. Potem
sprawdza wynik przez `validate-schema` i pyta o potwierdzenie. Odpowiedz `y`. Na końcu musi być:

```
✔ Development has every field. Repo schema refreshed from the export: …/cloudkit/whisperio.ckdb (commit it).
```

Plik `mobile/WhisperioKit/cloudkit/whisperio.ckdb` jest wtedy dokładną kopią schematu Development.
Zostaw zmianę w repo, pszczoła ją zacommituje.

## 3. Kliknięcie: Deploy Schema Changes to Production

1. Otwórz https://icloud.developer.apple.com/dashboard i zaloguj się kontem zespołu `953Q6T2WTB`.
2. Wejdź w **CloudKit Database**.
3. W selektorze kontenera (lewy górny róg) wybierz **iCloud.ai.whisperio.mobile**.
4. Przełącznik środowiska u góry ustaw na **Development**.
5. Na dole lewego paska bocznego kliknij **Deploy Schema Changes…**.
6. W oknie, które się otworzy, lista zmian powinna zawierać tylko dodanie pola `CD_source` (String) w
   `CD_RecordingEntity`. Jeśli lista jest zgodna, kliknij **Deploy**. Jeśli widzisz cokolwiek
   innego, kliknij **Cancel** i wyślij zrzut ekranu.

`cktool import-schema --environment production` nie działa: Apple odpowiada „endpoint not
applicable”, dlatego ten krok jest kliknięciem.

## 4. Weryfikacja Production

```
bash mobile/WhisperioKit/Scripts/cloudkit-schema.sh verify-prod
```

Ostatnia linia ma brzmieć `✔ PASS: Production has every field of the repo schema.`. Skrypt robi
`cktool export-schema --environment production` i porównuje wynik ze schematem w repo.

Daj znać pszczole whisperio. Zmieni wiersz w CLOUDKIT_SCHEMA_PROMOTION.md z PENDING na PROMOTED
(z datą) i zacommituje odświeżony `whisperio.ckdb`. Dopiero potem bramka
`preflight-cloudkit.sh` przepuści release.

## Co sprawdzają testy

- `bash mobile/WhisperioKit/Scripts/tests/test-cloudkit-schema.sh` (działa bez Maca, na udawanym
  `xcrun`) sprawdza:
  - import dodaje dokładnie brakujące linie i nie zmienia niczego, co już jest w Development
    (indeksy, pola tylko na żywo);
  - konflikt typu zatrzymuje skrypt przed importem;
  - bez potwierdzenia nic się nie importuje;
  - Production nigdy nie jest celem importu;
  - `verify-prod` daje FAIL, dopóki brakuje pola.
- `CloudKitSchemaParityTests.repoSchemaFileDeclaresEveryAttribute` (Swift) pilnuje, że
  `whisperio.ckdb` ma każde pole modelu jako `CD_<nazwa>` z właściwym typem. Nowe pole w modelu
  bez wpisu w pliku daje czerwone testy.
