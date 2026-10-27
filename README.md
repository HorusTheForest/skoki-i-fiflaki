# Skoki Olimpijskie: Synchro 10 m

Przeglądarkowa gra w stylu 16-bit o skokach synchronicznych z wieży 10 m. Wybicie, rotacja zależna od pozycji ciała, wejście do wody z „rip”, partner AI i 11 sędziów. Statyczne pliki, hosting na GitHub Pages.

## Uruchomienie lokalne

Wymagany Node.js 22 lub nowszy.

```bash
npm install
npm run dev        # serwer deweloperski: http://localhost:5173/skoki-i-fiflaki/
npm run build      # typecheck + build do dist/
npm run preview    # podgląd zbudowanej wersji: http://localhost:4173/skoki-i-fiflaki/
```

Testy:

```bash
npm test           # fizyka, punktacja, determinizm, kody skoków, zapis, replaye, dane kampanii
npm run bot        # bot przechodzi 50 poziomów i raportuje okna czasowe (ok. 2 min)
npm run test:e2e   # smoke test Playwright na zbudowanej wersji (najpierw npm run build)
npm run levels:gen # po zmianie scripts/levels.src.ts: przelicza src/levels/levels.json
```

Parametry URL: `?autoplay` (bot gra za gracza, używane w testach e2e), `#replay=…` (powtórka TV z linku).

## Sterowanie

Jeden przycisk AKCJA plus kierunki; wszystko można przemapować w Ustawieniach (klawiatura i pad).

| Faza | Wejście | Efekt |
| --- | --- | --- |
| Platforma (freestyle) | ← / → , ↑ / ↓ | wybór grupy i skoku |
| Wybicie | trzymaj AKCJĘ, puść w złotej strefie | PERFECT / GOOD / EARLY / LATE |
| Synchro | trzymaj na 3-2-1, puść na HEP | wspólne wybicie z partnerem |
| Przed wybiciem | złota zakrzywiona strzałka | pokazuje, w którą stronę obróci się skok |
| Lot | trzymaj strzałkę obrotu (→ lub ←, jak pokazuje strzałka) / puść | zwinięcie (kuczka albo łamana, zależnie od skoku) i szybki obrót / otwarcie |
| Lot | trzymaj AKCJĘ / puść | to samo co strzałka obrotu: kuczka / otwarcie |
| Lot | AKCJA + ↓ | pozycja łamana |
| Lot | ↑ (stuknięcie) | pół śruby (tylko w pozycji otwartej) |
| Lot | trzymaj strzałkę przeciwną do obrotu | ręce w górę: wolniejszy obrót (w pozycji otwartej strzałka obrotu opuszcza ręce i przyspiesza); działa do ok. 0,3 s przed wodą |
| Przed wodą | AKCJA ok. 120 ms przed kontaktem | rip |
| Ostatnie 200 ms | ← / → | korekta ±4° (kosztuje 0,5 pkt) |

Podpowiedzi: w każdej fazie napis na górze ekranu mówi, co nacisnąć teraz („PUŚĆ!”, „TRZYMAJ →”, „RIP: AKCJA!”). Wezwania do działania pojawiają się ok. 0,18 s wcześniej, żeby zdążyć zareagować (`src/ui/coach.ts`). Test `tests/coach.test.ts` sprawdza, że gracz, który robi tylko to, co mówią napisy, czysto wchodzi do wody. Wyłączane w Ustawieniach (PODPOWIEDZI) i w trybie Pro.

Dotyk: lewa/prawa krawędź ekranu to ←/→, dół to AKCJA + ↓, szybkie przesunięcie w górę to ↑, reszta ekranu to AKCJA.

## Tryby

- **Kampania synchro**: 50 poziomów (`src/levels/levels.json`), co 10. poziom finał z kilkoma seriami i rywalami. 3 gwiazdki, odblokowania partnerów, strojów i aren.
- **Freestyle**: dowolny skok, wybór wysokości platformy, rekordy i duch najlepszego skoku.
- **Synchro trening**: dowolny skok z wybranym partnerem.
- **Trening**: slow-mo i nakładka z ω, I i przewidywanym kątem wejścia.
- **Powtórki**: po skoku powtórka TV oraz link `#replay=` (wejścia + seed, skompresowane).

## Jak to działa

- Fizyka (`src/physics/diver.ts`): stały krok 120 Hz z akumulatorem, renderowanie z interpolacją, pełny determinizm. Środek masy leci balistycznie, moment pędu L jest ustalany przy wybiciu, a ω = L / I(pozy). Stawy prowadzą regulatory PD (ok. 160 ms). Grawitacja jest celowo niższa od ziemskiej (6,5 m/s²), żeby skok był czytelny. ←/→ w locie przesuwają cel barku, więc zmieniają moment bezwładności, a z nim prędkość obrotu; L dalej jest stałe.
- Ragdoll (`src/physics/ragdoll.ts`, Planck.js): uderzenie w platformę, płaskie wejście, wejście w kuczce. Każdy segment dostaje prędkość v + ω×r.
- Woda: opór kwadratowy względem kierunku ruchu. Ciało ustawione wzdłuż toru (czyste wejście) wbija się na 2–3 m, ciało poprzeczne (płaskacz, kuczka) staje po ok. pół metra; wypór tylko trochę większy od grawitacji, więc wypływanie jest powolne. W ragdollu ten sam opór liczony osobno wzdłuż i w poprzek każdego segmentu.
- Woda (`src/physics/water.ts`): siatka sprężyn 1D, kolumna na piksel.
- Punktacja (`src/scoring`): synchro 11 sędziów (3 + 3 + 5), skreślanie skrajnych, suma × WT × 0,6; indywidualnie 7 sędziów, suma 3 × WT. Noty wynikają z mierzalnych parametrów skoku plus seedowany rozrzut.
- Partner AI (`src/ai/partner.ts`): ta sama fizyka, wejścia z bota z „osobowością” (tempo, rozrzut, nawyki otwarcia i ripu).
- Bot kampanii (`tests/levels.bot.test.ts`): gra każdy poziom przez te same wejścia co gracz i musi go zaliczyć; mierzy, o ile można się spóźnić lub pospieszyć z otwarciem i z wybiciem.

## Znane ograniczenia

- **Współczynnik trudności (WT) jest przybliżony.** Liczony wzorem A + B + C + D + E z uproszczonymi składnikami, bo nie udało się zweryfikować oficjalnych tabel World Aquatics. W grze oznaczony „≈”. Podmiana na tabele: `src/scoring/dd.ts`.
- Grupa 6 (stanie na rękach) nie jest obsługiwana.
- Najtrudniejsze poziomy (4½ salta, 3½ śruby) mają okna rzędu kilkudziesięciu milisekund; bot je przechodzi, człowiekowi może to zająć sporo prób.

## Grafika i dźwięk

Rozdzielczość zależy od okna: gra wybiera całkowitą liczbę pikseli urządzenia na piksel gry (k = min(szerokość/640, wysokość/360), w dół) i dopasowuje bufor do całego ekranu, minimum 640×360 (`viewFor` w `src/config.ts`). Dzięki temu skalowanie jest zawsze całkowite, także przy skalowaniu Windows 125/150%. Menu i ekrany wyników są układane w środkowym polu 640×360.

Font to stała bitmapa 8×8 z Press Start 2P (`src/render/fontAtlas.ts`, generowana przez `node scripts/font-atlas.mjs`), więc tekst wygląda tak samo w każdej przeglądarce i systemie.

Wszystko inne generowane w kodzie: paleta 32 kolorów (`src/render/palette.ts`), sprite'y z map pikseli (`src/render/sprites.ts`, z nazwami klatek gotowymi pod atlas Aseprite: `ASEPRITE_ATLAS` w `src/config.ts`), efekty ZzFX, muzyka 16-bit z własnego syntezatora (`src/audio/music.ts`, utwory w `src/audio/songs.ts`: lead z echem, slap-bas, dęciaki, perkusja, pogłos; ściszana w trakcie skoku), szum publiczności z filtrowanego szumu (słyszalny tylko na hali).

## Prawa

- Font: Press Start 2P (SIL Open Font License 1.1), dołączony lokalnie przez `@fontsource/press-start-2p`.
- Zawodnicy, partnerzy i areny są fikcyjne. Brak logotypów World Aquatics. Flagi państw w pixel-arcie są uproszczone.
- Koła olimpijskie i słowo „olimpijskie” są oznaczeniami chronionymi przez MKOl; zostały użyte na wyraźne życzenie właściciela projektu. Można je wyłączyć w `src/config.ts` (`SHOW_RINGS`, `GAME_TITLE`).
- Poprzednia gra z tego repozytorium („Skoki i fikoły”) jest dostępna pod `/legacy/`.

## Deploy

`.github/workflows/deploy.yml` buduje i publikuje `dist/` na GitHub Pages przy każdym pushu do `main`. Jednorazowo w repozytorium: **Settings → Pages → Source: GitHub Actions**. `base` w `vite.config.ts` musi odpowiadać nazwie repozytorium (`/skoki-i-fiflaki/`).

`.github/workflows/ci.yml` uruchamia na PR build, testy jednostkowe, bota kampanii i smoke test e2e.
