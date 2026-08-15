#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_DIR="$ROOT/projects/koszalin-minecraft"
MZK_DIR="$PROJECT_DIR/mzk-bedrock"
BUILD_DIR="${BUILD_DIR:-$ROOT/build/koszalin-mzk-bedrock}"
DOWNLOAD_DIR="$BUILD_DIR/downloads"
WORK_DIR="$BUILD_DIR/work"
WORLD_DIR="$WORK_DIR/world"
BP_DIR="$WORLD_DIR/behavior_packs/KoszalinMZK_BP"
RP_DIR="$WORLD_DIR/resource_packs/KoszalinMZK_RP"
DIST_DIR="$BUILD_DIR/dist"
REPORT_DIR="$BUILD_DIR/reports"
GTFS_URL="${GTFS_URL:-https://files.girlc.at/gtfs/koszalin.zip}"
FINAL="$DIST_DIR/Koszalin_MZK_Android.mcworld"

rm -rf "$WORK_DIR" "$DIST_DIR" "$REPORT_DIR"
mkdir -p "$DOWNLOAD_DIR" "$WORLD_DIR/db" "$WORLD_DIR/behavior_packs" "$WORLD_DIR/resource_packs" "$DIST_DIR" "$REPORT_DIR"

printf '== Koszalin MZK – Bedrock / Android ==\n'
printf 'GTFS: %s\n' "$GTFS_URL"

curl --fail --location --retry 7 --retry-all-errors --connect-timeout 30 \
  --output "$DOWNLOAD_DIR/koszalin.zip" "$GTFS_URL"
unzip -tq "$DOWNLOAD_DIR/koszalin.zip"

cp -R "$MZK_DIR/behavior_pack" "$BP_DIR"
cp -R "$MZK_DIR/resource_pack" "$RP_DIR"
cp "$MZK_DIR/world_template/world_behavior_packs.json" "$WORLD_DIR/world_behavior_packs.json"
cp "$MZK_DIR/world_template/world_resource_packs.json" "$WORLD_DIR/world_resource_packs.json"
cp "$MZK_DIR/world_template/metadata.json" "$WORLD_DIR/metadata.json"
base64 --decode "$MZK_DIR/world_template/level.dat.b64" > "$WORLD_DIR/level.dat"
printf '%s\n' 'Koszalin MZK - Glowne obiekty' > "$WORLD_DIR/levelname.txt"

python3 "$MZK_DIR/tools/prepare_gtfs.py" \
  --gtfs "$DOWNLOAD_DIR/koszalin.zip" \
  --output-js "$BP_DIR/scripts/data.js" \
  --voice-list "$WORK_DIR/voice-list.jsonl" \
  --report "$REPORT_DIR/gtfs-report.json"

python3 "$MZK_DIR/tools/generate_assets.py" \
  --resource-pack "$RP_DIR" \
  --behavior-pack "$BP_DIR" \
  --world "$WORLD_DIR"

python3 "$MZK_DIR/tools/generate_tts.py" \
  --voice-list "$WORK_DIR/voice-list.jsonl" \
  --resource-pack "$RP_DIR"

python3 "$MZK_DIR/tools/validate_build.py" \
  --world "$WORLD_DIR" \
  --report "$REPORT_DIR/gtfs-report.json"

cat > "$WORLD_DIR/KOSZALIN_MZK_INFO.txt" <<EOF_INFO
KOSZALIN MZK – MINECRAFT BEDROCK / ANDROID

Zakres:
- ręcznie stylizowane główne obiekty Koszalina,
- komplet aktywnych przystanków kierunkowych z aktualnego pakietu GTFS,
- rzeczywiste numery 20 linii MZK i kierunki z rozkładu,
- poruszające się, możliwe do zajęcia autobusy,
- nowe polskie syntetyczne zapowiedzi prawdziwych nazw przystanków,
- zielone wiaty inspirowane koszalińskimi ekoprzystankami.

Skala pozioma: 0.35 bloku na metr (optymalizacja dla Androida).
Punkt odniesienia i start: Rynek Staromiejski.
Teren, drogi, wiaty i obiekty są dobudowywane w pobliżu gracza, dzięki czemu plik pozostaje lekki.

Źródła danych:
- oficjalny rozkład MZK Koszalin: https://mzk.koszalin.pl/rozklad-jazdy/
- lista przystanków MZK: https://mzk.koszalin.pl/timetable_files/przystanki.html
- pakiet GTFS Koszalin: $GTFS_URL

Modele, tekstury, konstrukcje i nagrania syntetyczne utworzono specjalnie dla tego świata.
To nie jest oficjalny produkt MZK, Mojang ani Microsoft.
EOF_INFO

(
  cd "$WORLD_DIR"
  zip -q -r -9 "$FINAL" .
)

sha256sum "$FINAL" > "$FINAL.sha256"
cp "$REPORT_DIR/gtfs-report.json" "$DIST_DIR/Koszalin_MZK_build_report.json"
python3 "$MZK_DIR/tools/release_notes.py" \
  --report "$REPORT_DIR/gtfs-report.json" \
  --output "$DIST_DIR/RELEASE_NOTES.md"

unzip -tq "$FINAL"
python3 - "$FINAL" <<'PY'
import sys, zipfile
path = sys.argv[1]
with zipfile.ZipFile(path) as archive:
    names = set(archive.namelist())
    required = {
        "level.dat", "levelname.txt", "world_icon.jpeg",
        "world_behavior_packs.json", "world_resource_packs.json",
        "behavior_packs/KoszalinMZK_BP/scripts/main.js",
        "behavior_packs/KoszalinMZK_BP/scripts/data.js",
        "resource_packs/KoszalinMZK_RP/entity/bus.entity.json",
        "resource_packs/KoszalinMZK_RP/entity/ferry.entity.json",
        "resource_packs/KoszalinMZK_RP/sounds/sound_definitions.json",
    }
    missing = sorted(required - names)
    if missing:
        raise SystemExit(f"mcworld is missing: {missing}")
    sounds = [name for name in names if name.endswith(".ogg")]
    if len(sounds) < 150:
        raise SystemExit(f"mcworld contains only {len(sounds)} announcements")
    print(f"mcworld entries={len(names)}, announcements={len(sounds)}")
PY

printf 'Generated files:\n'
ls -lh "$DIST_DIR"
