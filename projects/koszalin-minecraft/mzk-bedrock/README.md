# Koszalin MZK – Minecraft Bedrock / Android

Generator lekkiego, samowystarczalnego świata `.mcworld`, zbudowanego specjalnie wokół komunikacji miejskiej Koszalina.

## Zakres świata

- 20 rzeczywistych linii: `1S, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21S, 23S`;
- wszystkie aktywne przystanki kierunkowe z aktualnie pobranego pakietu GTFS;
- prawdziwe nazwy, kody, przypisane linie i kierunki;
- żółto-zielony model autobusu z osobną tablicą dla każdej linii;
- autobusy jadące po trasach, z miejscami dla graczy, oraz statek „Julek” na sezonowej linii 1S;
- polskie syntetyczne zapowiedzi „Następny przystanek…”;
- zielone wiaty inspirowane koszalińskimi ekoprzystankami;
- ręcznie stylizowane główne obiekty, m.in. Rynek i Ratusz, katedra, dworzec, amfiteatr, filharmonia, muzeum, teatr, Park Wodny, hala, Politechnika, Forum, zajezdnia MZK i Góra Chełmska.

Pozioma skala świata wynosi `0.35 bloku/metr`. To celowa optymalizacja dla telefonów. Świat używa pustej bazy i dobudowuje teren, odcinki tras, wiaty oraz obiekty w pobliżu gracza.

## Budowanie

Na Ubuntu wymagane są: Python 3, Pillow, `espeak-ng`, `ffmpeg`, `curl`, `zip` i `unzip`.

```bash
bash projects/koszalin-minecraft/build-bedrock.sh
```

Wynik: `build/koszalin-mzk-bedrock/dist/Koszalin_MZK_Android.mcworld`.

## Dane i walidacja

Generator pobiera bieżący pakiet GTFS z `https://files.girlc.at/gtfs/koszalin.zip`. Budowa zostaje przerwana, jeśli zestaw nie zawiera dokładnie 20 oczekiwanych numerów linii, mniej niż 340 aktywnych przystanków kierunkowych albo wybrane warianty tras nie pokrywają co najmniej 98% relacji linia–przystanek. Każdy plik JSON, liczba tekstur, liczba nagrań, nagłówek `level.dat` i końcowe archiwum ZIP są sprawdzane przed publikacją.

Oficjalna lista przystanków i rozkłady: `https://mzk.koszalin.pl/rozklad-jazdy/`.

Nagrania nie kopiują głosu ani plików MZK. Są od początku syntezowane w języku polskim z prawdziwych nazw przystanków.
