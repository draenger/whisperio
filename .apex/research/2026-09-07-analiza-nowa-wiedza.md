---
tags: [research, whisperio, portfolio, decision]
description: "Whisperio wobec nowej wiedzy — ship / park / kill"
date: 2026-09-07
---

# Whisperio — analiza wobec nowej wiedzy (2026-09-07)

Wiedza: metaesencja Akademii SaaS, PRINCIPLES z 275 live'ów i z 32 wideo o launchu iOS, 19 digestów
`app-store-launch`, `KNOWLEDGE.md`. Fakty: repo `whisperio@main` (0c7a873), `mobile/marketing/*`.

## Diagnoza

**Etap.** Whisperio jest między krokiem 5 playbooka (MVP) a 6 (pricing), ale **przeskoczył kroki 2–3**
— brak punktacji wg 17-punktowej listy i brak walidacji przed budową. Reguła #2 („validation ends only
at payment", M5) złamana wprost: apka darmowa, bez IAP, bez konta, bez umowy Paid Applications
(`app-store-listing.md`, „Free app — what does NOT apply"), więc liczba zwalidowanych płatników wynosi
**zero i konstrukcyjnie nie może być inna** (PRINCIPLES, *Validation before building*: Róg, Abel,
Duszczak). Reguła #6 („MVP w 3 tygodnie", M7) złamana w drugą stronę: cztery platformy, keyboard
extension, widget, App Intents, CloudKit i GitHub sync, Journal, rewrite-presety — ~roczny projekt
bez jednej transakcji.

**Wąskie gardło.** Nie technika — `docs/PARITY.md` pokazuje zielone gate'y i 0 sierot. Gardło jest
trójdzielne: (1) **brak powierzchni monetyzacji** (free/no-IAP = zero w każdej metryce RevenueCat);
(2) **pojemność foundera** — etat 08–16, rezme jako produkt główny, Zryw z oknem I–II 2027;
(3) **dwie niedomknięte blokady submisji** (akcja #1).

**Stan wysyłki.** Rekord ASC gotowy (app id `6781780531`, 1.4.1/build 74, free, 175 terytoriów, 4+,
review notes, zrzuty iPhone ×6 / iPad ×4 / Watch ×3). Brakuje trzech rzeczy w web UI: App Privacy,
status trader DSA, *Add for Review*. **Ship to godziny, nie tygodnie.**

**Brak danych o użyciu.** Repo nie ma telemetrii z założenia (KNOWLEDGE.md: „no server-side storage,
no telemetry"), ani SDK analitycznego, ani liczby testerów TestFlight. **Nie podaję żadnej liczby
o użytkownikach, bo jej nie ma** — i to samo jest ustaleniem: reguła #8 („track from day one, even
pre-revenue") niespełniona, decyzja ship/park nie ma dziś oparcia.

**Rynek (tylko to, co mówią dokumenty).** RevenueCat *State of Subscription Apps 2026*: **~14 700
nowych apek subskrypcyjnych miesięcznie** (I 2026) wobec ~2 000 w I 2022; **apki sprzed 2020 trzymają
69% przychodu, debiuty 2025+ — 3%**; mediana do 1 000 USD MRR to 58 dni, ale **tylko 17,3% apek tam
dociera w 2 lata**. Apki AI: +41% na płacącego, +30% churnu. Osobno **4.3(b) w wersji 2026** wymaga
„meaningful differentiation beyond UI improvements" (`appfollow-review-guidelines.md`) — realne ryzyko
odrzucenia. Lyttle: indie **nie walczy z incumbentami o tysiącach recenzji**, tylko o sloty podpowiedzi.

> **Moje wnioskowanie, nie cytat:** dokumenty **nie mówią nic** o wbudowanej transkrypcji w iOS ani
> o zalewie apek na Whisperze — nie mam źródła i go nie udaję. Z repo wynika jednak, że Whisperio samo
> definiuje się jako parytet wobec **Wispr Flow** (`docs/PARITY.md`) — dokładnie ta walka z finansowanym
> incumbentem, którą Lyttle każe omijać.

**Reguły fokusu wobec trzeciego produktu.** Metaesencja: nie rozpraszaj się, 1–2 kanały wg ICE
(M14/M15); M18 każe odróżniać *blokery* od *progów zwalniających* — Whisperio nie blokuje niczego,
jest kosztem alternatywnym wobec rezme i Zryw. Live'e: „niche-first beats going broad"; case Knapa
pokazuje, jak pivot niszczy fokus. **Kontrargument z korpusu:** Lyttle zaleca portfel („machine gun")
— wiele małych apek + reguła 3x-reuse. **Moje rozstrzygnięcie:** portfel Lyttle'a zakłada apki tanie,
składane z modułów, przy braku innego produktu głównego; Whisperio jest odwrotnością, a Daniel ma
rezme i twardą datę Zryw — wygrywa reguła fokusu. Portfel daje jedno: apka jest trzy kliknięcia od
store'a, więc koszt krańcowy wysyłki ≈ 0, a lekcja realna („willingness-to-pay is a question only
a live release answers").

## Top 5 akcji z nowej wiedzy

Budżet całości: **~10 h w 2 tygodnie**, potem twarda bramka liczbowa. Nic poza tym.

**1. Domknąć dwie twarde blokady submisji — S (~2 h).**
Dodać `PrivacyInfo.xcprivacy` do targetu iOS **i osobno** do watchOS/keyboard/widget (powód `CA92.1`
dla UserDefaults) oraz wystawić **w aplikacji** link do polityki prywatności.
*Dlaczego teraz:* brak manifestu = **automatyczne odrzucenie** od V 2024 (`privacy-manifest-guide.md`);
manifest w złym bundlu to nazwany failure pattern (`privacy-manifest-requirements.md`); polityka musi
być dostępna „within the app", nie tylko w metadanych (`apple-review-guidelines.md` 5.1.1(i)).
**Sprawdzone w repo: zero `*.xcprivacy` w `mobile/` i zero linków do polityki w 92 plikach Swift —
obie blokady otwarte.** *Sygnał:* `Archive → Validate App` bez błędów.

**2. Ustawić status trader DSA raz, dla całego konta — S (~1 h).**
*Dlaczego teraz:* status jest **na koncie `953Q6T2WTB`, nie na apce**; Zryw Pro wymusi tradera przy
premierze i Whisperio odziedziczy go automatycznie; bez zadeklarowanego statusu apka jest **ukryta
w witrynach EU**; przełączenie to zmiana ustawień, bez resubmisji (`release-runbook.md` §3.6.1
+ pamięć „Zryw: ramy prawne premiery" — trader z adresem usługowym). Dane są **publiczne** w EU →
dedykowany adres, telefon, skrzynka. *Sygnał:* obie apki widoczne w EU, zero pracy do powtórzenia.

**3. Wysłać wersję darmową **jak jest**, w oknie IX–X 2026 — S (~1 h + kolejka review).**
*Dlaczego teraz:* wrzesień–październik to okno *utilities/organization/productivity*, wzmacniane
premierą iPhone'a (`best-time-to-launch.md`); styczeń–luty to okno **Zryw** — dwie premiery w jednym
oknie u solo-foundera to rozproszenie zakazane przez M15. Dzień: wtorek/środa vs czwartek
(`launch-day-of-week.md`, lista featured) — **sprzeczność w korpusie, nierozstrzygnięta**; przy
zerowym UA kosmetyczna. *Sygnał:* „Ready for Sale" + ~tygodniowy boost w podpowiedziach.

**4. Przestawić tytuł/keywords pod slot podpowiedzi, przed submisją — S (~1 h).**
Tytuł (30 zn.) jako *keyword-first + unikalny token marki* zamiast samego „Whisperio"; keywords bez
powtórek z tytułu/podtytułu. *Dlaczego teraz:* zmiana „30-sekundowa" o największym udokumentowanym
zwrocie dla indie, a boost premierowy działa **głównie przez listę podpowiedzi** — po tygodniu za
późno (yt app-launch, *ASO*, adam-lyttle). Zrzuty mają już podpisy indeksowane OCR
(`aso-2026-guide.md`). *Sygnał:* fraza w type-ahead po ~7 dniach; wzrost impressions w ASC.

**5. Bramka decyzyjna 60 dni + procedura parkowania — M (~3 h).**
Miernik: darmowe **App Analytics w ASC** (impressions → page views → downloads; `twostraws`: niski
impression→page-view = problem discovery, niski page-view→download = problem strony produktu). Próg
go/no-go ustalony **przed** wysyłką: ≥300 organicznych pobrań w 60 dni bez promocji; poniżej → park.
*Dlaczego teraz:* reguła #8 metaesencji; RevenueCat — mediana do 1 000 USD MRR to 58 dni, a 82,7% apek
nigdy tam nie dociera, więc 60 dni to uczciwe okno.
*Parkowanie — co zostaje żywe:* (a) **bundle id `ai.whisperio.mobile` + app id 6781780531** — nigdy nie
usuwać apki ze store'a; (b) **build na TestFlight** odświeżany raz na ~90 dni, żeby nie wygasł;
(c) **dokumentacja** — `release-runbook.md` i `mobile/marketing/*` gotowe do odpalenia jedną komendą;
(d) **domena + GitHub Pages** (`privacy.html` musi zwracać 200 — zależność App Review); (e) **desktop**
w trybie utrzymaniowym; `PARITY.md` zamrożony z adnotacją „parked".

## Czego NIE robić

- **Nie dodawać teraz IAP/subskrypcji.** Reguła #2 nieprzeprowadzona, a monetyzacja uruchamia Paid
  Applications Agreement, formularze podatkowe i review IAP (`app-store-listing.md`). RevenueCat:
  debiuty 2025+ to 3% przychodu.
- **Nie kontynuować parytetu z Wispr Flow.** M7 (deadline bije kompletność) + Lyttle (nie walcz
  z incumbentem). 4.3(b) nie jest problemem liczby funkcji.
- **Nie wypuszczać teraz Mac App Store.** Repo: „not ready — no Mac screenshots"
  (`release-runbook.md` §4); `launch-checklist-2026.md` każe **opóźnić platformę zamiast wypuścić
  słabsze doświadczenie dla symetrii daty**.
- **Nie startować w styczniu–lutym** — kolizja z oknem Zryw (`best-time-to-launch.md`).
- **Nie kupować ruchu.** M14 daje na kanały płatne 1 000–2 000 PLN wyłącznie na naukę mechaniki —
  przy zerowym przychodzie CAC jest z definicji nieskończony.
- **Nie lokalizować poza EN.** Kubryński: nie tłumacz, dopóki płacący klient nie zażąda. Spór
  w korpusie — `aso-2026-guide.md` nazywa to „conversion killer"; tu wygrywa Kubryński.
- **Nie usuwać apki ze store'a ani repo przy parkowaniu** — product IDs i bundle id są u Apple
  permanentne i nieodzyskiwalne (yt app-launch, *Implementation stack*).

## Otwarte decyzje wymagające Daniela

1. **Ship / park / kill — rekomendacja: SHIP SMALL, potem PARK.** Wypuść 1.4.1 darmowo w oknie IX–X 2026
   za ~10 h, mierz 60 dni w ASC, zaparkuj do II kw. 2027 niezależnie od wyniku — chyba że próg 300
   pobrań zostanie przebity **dwukrotnie**. *Kill* odpada arytmetycznie: utrzymanie zaparkowanej apki
   ≈ 0, a skasowanie identyfikatorów nieodwracalne. *Rozwój* odpada — łamie każdą regułę fokusu.
2. **Trader status: teraz czy przy Zryw?** Rekomendacja: **teraz, trader, adres usługowy** — Zryw
   wymusi to za ~4 miesiące, a raz kosztuje godzinę zamiast dwóch. Argument za odroczeniem: dane
   kontaktowe stają się publiczne w EU natychmiast. Decyzja Daniela, bo dotyczy jego adresu.
3. **Czy Whisperio wolno kiedykolwiek monetyzować przy PolyForm Noncommercial?** *Moje wnioskowanie:*
   jako właściciel praw może relicencjonować, ale publiczne źródło pozwala każdemu zbudować darmową
   kopię — realne tarcie dla paywalla, nieopisane w żadnym dokumencie wiedzy. Rozstrzygnąć **przed**
   dodaniem IAP.
4. **Czy desktop (wg README „the main app") też idzie na parking?** Gardło (brak monetyzacji i pomiaru)
   jest wspólne. Rekomendacja: tak — tryb utrzymaniowy.

## Werdykt

Whisperio jest technicznie skończonym, uczciwie zbudowanym produktem, który nigdy nie przeszedł kroku
walidacyjnego — a wobec obu zestawów reguł (nie buduj przed walidacją, nie rozpraszaj się; płatność to
jedyny prawdziwy sygnał) jest dziś trzecim zakładem foundera z etatem, produktem głównym i twardą datą
premiery innej aplikacji za cztery miesiące. To nie znaczy, że należy go skasować: leży trzy kliknięcia
od App Store, koszt domknięcia to jakieś dziesięć godzin — więc **jedyny wariant kupujący realną
informację za realnie małą cenę to wypuścić go darmowo w oknie wrzesień–październik, ustawić status
tradera raz dla całego konta (i tak wymusi go Zryw), zmierzyć 60 dni darmowymi danymi z ASC
i — niezależnie od wyniku — zaparkować przed styczniem, żeby okno noworoczne należało wyłącznie do
Zryw.** Wszystko poza tym budżetem godzin jest, w języku M18, nie blokerem, tylko progiem
zwalniającym, który udaje pracę.

---

## Ranking portfelowy (Zryw + rezme + whisperio) — wpływ / wysiłek

Ranking zbiorczy z trzech analiz z 2026-09-07 (ten sam tekst w każdym z trzech dokumentów). Kryterium: ile
informacji o rynku kupuje godzina pracy foundera z etatem 08–16, przy regułach focus (metaesencja M13/M15:
jeden produkt główny, jeden szybki kanał) i walidacji (reguła 2: płatność jest jedynym prawdziwym sygnałem).

| # | Akcja | Apka | Wysiłek | Dlaczego ten stosunek |
|---|---|---|---|---|
| 1 | **Stripe live + PLN + Stripe Tax + jedna własna płatność end-to-end** | rezme | **S** (wieczór) | Produkt główny, a każdy inny ruch w rezme (reklamy, rozmowy, aktywacja) mierzy dziś blokadę ops zamiast rynku. Jeden wieczór odblokowuje sens wszystkiego poniżej. Zero ryzyka regresji. |
| 2 | **Paywall i cennik Zryw przed Submit**: roczny ~6× miesięcznego zamiast 9,5×, trial tylko na rocznym, 100% ekspozycji, cztery punkty compliance | Zryw | **S/M** (ASC + drobne UI) | Mnożnik na każdym przyszłym pobraniu (RevenueCat 2026: apki z dominacją planu rocznego ~2× RPI). Robione raz, przed pierwszym userem, więc bez kosztu migracji cen. |
| 3 | **Domknięcie pomiaru środka lejka** (rezme: `cv_first_generation_completed` + kroki onboardingu; Zryw: paywall_view → trial_start → purchase) | rezme + Zryw | **S + M** | Bez tego żadna z dalszych decyzji (cena, trial, kanał) nie ma liczby. W obu apkach dziś nie ma tej liczby wcale. Checklista premiery nazywa to stop condition. |
| 4 | **Submit Zryw 1.0 teraz — cicha premiera, kampania w styczniu** | Zryw | **M** (kroki ownera) | Jedyna droga do walidacji płatnością (IAP obowiązkowe), 4–5 miesięcy wcześniej niż plan. Wysiłek to głównie czas ownera na ASC, nie kod. Zużywa jednorazowy boost nowości — świadomie. |
| 5 | **Skrócenie drogi do AHA w rezme** do ≤5 akcji / ≤10 min | rezme | **M** | Największy pojedynczy wyciek konwersji w produkcie głównym (20–35 ekranów vs norma). Wchodzi dopiero po #1 i #3, bo bez płatności i pomiaru nie da się ocenić efektu. |
| 6 | **10 zimnych rozmów + 1 płatność wyciśnięta ręką** (rezme) i **lista 30 nazwanych osób** (Zryw) | rezme + Zryw | **M** | Pominięty krok 3 playbooka w obu apkach. Tani w pieniądzach, drogi w energii foundera — dlatego niżej niż automatyzowalne #1–#3. |
| 7 | **Whisperio: 10 h na domknięcie blokad + wysyłka darmowa + bramka 60 dni, potem parking** | whisperio | **S** (pakiet ~10 h) | Najtańsza informacja w portfelu, ale trzeci zakład. Nie wcześniej niż po #1 i nie w tym samym oknie co Submit Zryw (M15: jedna premiera naraz). Jeśli #4 idzie teraz, whisperio czeka na „Ready for Sale" Zryw albo idzie prosto do parkingu. |

**Najwyższy stosunek wpływu do wysiłku: #1, Stripe live w rezme.** To produkt główny, wysiłek to jeden
wieczór, a bez tego każda kolejna godzina w rezme, łącznie z napisaną już kampanią Ads, mierzy stan
konfiguracji zamiast rynku. Drugie miejsce, cennik Zryw, ma podobny koszt i działa jako mnożnik na
wszystkim, co Zryw kiedykolwiek sprzeda, ale sam w sobie nie daje sygnału, dopóki nie ma pobrań.

**Konflikt do rozstrzygnięcia przez Daniela:** analiza Zryw rekomenduje Submit teraz (wrzesień–październik),
analiza whisperio rekomenduje to samo okno dla whisperio. Reguła M15 wyklucza dwie premiery naraz u solo-foundera
z etatem. Rekomendacja: Zryw teraz (większy zakład, subskrypcja, gotowy pipeline), whisperio po „Ready for Sale"
Zryw albo od razu do parkingu z zachowaniem bundle id i builda TestFlight.
