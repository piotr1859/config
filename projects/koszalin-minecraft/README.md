# Koszalin → Minecraft

## Bedrock / Android: Koszalin MZK

Aktualna wersja mobilna rezygnuje z ciężkiej, automatycznej kopii całej zabudowy. Koncentruje się na rozpoznawalnych głównych obiektach oraz pełnej sieci MZK: rzeczywistych liniach, aktywnych przystankach, poruszających się autobusach i polskich zapowiedziach. Szczegóły i instrukcja budowania: [`mzk-bedrock/README.md`](mzk-bedrock/README.md).

## Starszy generator Java 1:1

Automatyczny generator świata **Koszalin 1:1**. Nie wymaga ręcznego używania QGIS, WorldPaintera ani pobierania danych GIS.

## Co robi automat

1. Pobiera przypięte wydanie Arnis i weryfikuje SHA-256.
2. Generuje rzeczywisty teren oraz obiekty geograficzne dla Koszalina w skali 1 blok = 1 metr.
3. Ustawia spawn na Rynku Staromiejskim.
4. Tworzy świat Minecraft Java w trybie Creative oraz mapę podglądową.
5. Pakuje świat do ZIP i oblicza SHA-256.
6. Workflow publikuje wynik jako GitHub Release. Jeśli ZIP przekroczy 1,9 GiB, jest automatycznie dzielony na części.

## Parametry

- BBOX: `54.1367,16.1090,54.2791,16.3260`
- skala: `1.0` blok/metr
- spawn: `54.190278,16.181667`
- silnik: Arnis v3.0.0
- tryb Arnis: `geo-terrain`
- format: Minecraft Java Edition

## Źródła i licencje

Arnis: Apache-2.0, projekt `louis-e/arnis`.
Geometria miasta i obiektów jest pobierana przez Arnis m.in. z OpenStreetMap; obowiązuje atrybucja OpenStreetMap contributors i ODbL dla danych OSM.

To nie jest oficjalny produkt Minecraft, Mojang ani Microsoft.
