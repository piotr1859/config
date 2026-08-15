#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8"))
    text = f"""# Koszalin MZK – główne obiekty, autobusy i przystanki

Lekki świat `.mcworld` przeznaczony do bezpośredniego importu w Minecraft Bedrock na Androidzie.

- **{report['lines']} rzeczywistych linii MZK**: 1S, 1, 2, 3, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21S i 23S
- **{report['activeDirectionalStops']} aktywnych przystanków kierunkowych** z nazwami i obsługującymi je liniami
- **{report['uniqueAnnouncements']} nowych polskich zapowiedzi głosowych** prawdziwych nazw
- wybrane rzeczywiste warianty tras obejmujące **{report['routeStopCoverage'] * 100:.2f}%** relacji linia–przystanek w źródłowym rozkładzie
- żółto-zielone autobusy z tablicami linii oraz statek „Julek” na sezonowej linii 1S; pojazdy są dostępne do jazdy
- koszalińskie zielone wiaty oraz ręcznie stylizowane główne obiekty miasta
- skala 0,35 bloku na metr i dobudowywanie miasta przy graczu dla płynniejszego działania na telefonie

Źródło rozkładu: oficjalna strona MZK oraz pakiet GTFS w wersji `{report['feedVersion']}` (zakres `{report['feedStartDate']}–{report['feedEndDate']}`).

## Android

Pobierz `Koszalin_MZK_Android.mcworld`, dotknij pliku i wybierz Minecraft. Świat ma już wbudowane oba wymagane pakiety — nie instaluj osobnego moda.

Pierwsze otwarcie może przez chwilę dobudowywać Rynek, najbliższe drogi i wiaty. Kolejne fragmenty powstają automatycznie podczas podróży.
"""
    args.output.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
