#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_DIR="$ROOT/projects/koszalin-minecraft"
# shellcheck disable=SC1091
source "$PROJECT_DIR/config.env"

BUILD_DIR="${BUILD_DIR:-$ROOT/build/koszalin-bedrock}"
TOOLS_DIR="$BUILD_DIR/tools"
OUTPUT_DIR="$BUILD_DIR/output"
DIST_DIR="$BUILD_DIR/dist"
LOG_DIR="$BUILD_DIR/logs"

rm -rf "$OUTPUT_DIR" "$DIST_DIR" "$LOG_DIR"
mkdir -p "$TOOLS_DIR" "$OUTPUT_DIR" "$DIST_DIR" "$LOG_DIR"

ARCHIVE="arnis-linux-appimage.tar.gz"
ARNIS_URL="https://github.com/louis-e/arnis/releases/download/${ARNIS_VERSION}/${ARCHIVE}"

printf '== Koszalin 1:1 Minecraft Bedrock ==\n'
printf 'Arnis: %s\nBBOX: %s\nScale: %s block/m\n' "$ARNIS_VERSION" "$BBOX" "$SCALE"

if [[ ! -f "$TOOLS_DIR/$ARCHIVE" ]]; then
  curl --fail --location --retry 6 --retry-all-errors --connect-timeout 30 \
    --output "$TOOLS_DIR/$ARCHIVE" "$ARNIS_URL"
fi

echo "${ARNIS_LINUX_APPIMAGE_SHA256}  $TOOLS_DIR/$ARCHIVE" | sha256sum --check --status || {
  echo "ERROR: Arnis archive checksum mismatch" >&2
  rm -f "$TOOLS_DIR/$ARCHIVE"
  exit 20
}

rm -f "$TOOLS_DIR/arnis-linux.AppImage"
tar -xzf "$TOOLS_DIR/$ARCHIVE" -C "$TOOLS_DIR"
chmod +x "$TOOLS_DIR/arnis-linux.AppImage"

export APPIMAGE_EXTRACT_AND_RUN=1
export RUST_BACKTRACE=1

set +e
"$TOOLS_DIR/arnis-linux.AppImage" \
  --bedrock \
  --output-dir="$OUTPUT_DIR" \
  --bbox="$BBOX" \
  --terrain \
  --scale="$SCALE" \
  --spawn-lat="$SPAWN_LAT" \
  --spawn-lng="$SPAWN_LNG" \
  --gamemode=creative \
  --world-time=6000 \
  --map-preview \
  2>&1 | tee "$LOG_DIR/arnis-bedrock.log"
ARNIS_RC=${PIPESTATUS[0]}
set -e

if [[ $ARNIS_RC -ne 0 ]]; then
  echo "ERROR: Arnis Bedrock generation exited with code $ARNIS_RC" >&2
  exit "$ARNIS_RC"
fi

MCWORLD="$(find "$OUTPUT_DIR" -maxdepth 2 -type f -name '*.mcworld' -print -quit)"
if [[ -z "$MCWORLD" ]]; then
  echo "ERROR: generation finished but no .mcworld file was found" >&2
  find "$OUTPUT_DIR" -maxdepth 3 -type f | head -200 >&2 || true
  exit 30
fi

FINAL="$DIST_DIR/Koszalin_1_to_1_Bedrock.mcworld"
mv "$MCWORLD" "$FINAL"
sha256sum "$FINAL" > "$DIST_DIR/Koszalin_1_to_1_Bedrock.mcworld.sha256"

printf 'Bedrock world generated: %s\n' "$FINAL"
ls -lh "$DIST_DIR"
