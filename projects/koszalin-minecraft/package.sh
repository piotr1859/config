#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_DIR="$ROOT/projects/koszalin-minecraft"
# shellcheck disable=SC1091
source "$PROJECT_DIR/config.env"

BUILD_DIR="${BUILD_DIR:-$ROOT/build/koszalin-minecraft}"
WORLD_DIR="$BUILD_DIR/worlds/$WORLD_NAME"
DIST_DIR="$BUILD_DIR/dist"
mkdir -p "$DIST_DIR"

if [[ ! -f "$WORLD_DIR/level.dat" ]]; then
  echo "ERROR: world is missing: $WORLD_DIR" >&2
  exit 40
fi

ARCHIVE="$DIST_DIR/${WORLD_NAME}.zip"
rm -f "$ARCHIVE" "$ARCHIVE".part-*

(
  cd "$(dirname "$WORLD_DIR")"
  zip -r -9 -q "$ARCHIVE" "$WORLD_NAME"
)

sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
SIZE_BYTES="$(stat -c '%s' "$ARCHIVE")"
SIZE_MIB="$(( SIZE_BYTES / 1024 / 1024 ))"
printf 'ZIP size: %s MiB\n' "$SIZE_MIB"

cat > "$DIST_DIR/README_DOWNLOAD.txt" <<INFO
KOSZALIN 1:1 - MINECRAFT JAVA

Normal case:
1. Download ${WORLD_NAME}.zip.
2. Extract the folder ${WORLD_NAME} into the Minecraft Java saves directory.
3. Start Minecraft Java Edition and open the world.

If the release contains files named ${WORLD_NAME}.zip.part-01, part-02, etc.,
all parts belong to one ZIP. On Linux/macOS they can be reassembled with:
  cat ${WORLD_NAME}.zip.part-* > ${WORLD_NAME}.zip
On Windows PowerShell:
  Get-Content ${WORLD_NAME}.zip.part-* -AsByteStream | Set-Content ${WORLD_NAME}.zip -AsByteStream

SHA-256 is included for integrity verification.
INFO

# GitHub release assets must stay below 2 GiB. Keep a safety margin.
LIMIT=$((1900 * 1024 * 1024))
if (( SIZE_BYTES > LIMIT )); then
  split --bytes="$LIMIT" --numeric-suffixes=1 --suffix-length=2 \
    "$ARCHIVE" "$ARCHIVE.part-"
  rm -f "$ARCHIVE"
fi

printf 'Release files:\n'
ls -lh "$DIST_DIR"
