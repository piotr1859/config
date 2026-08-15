#!/usr/bin/env python3
"""Create original Polish synthetic stop announcements for the resource pack."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise SystemExit(f"required executable not found: {name}")
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice-list", required=True, type=Path)
    parser.add_argument("--resource-pack", required=True, type=Path)
    args = parser.parse_args()

    espeak = require_tool("espeak-ng")
    ffmpeg = require_tool("ffmpeg")
    records = [json.loads(line) for line in args.voice_list.read_text(encoding="utf-8").splitlines() if line.strip()]
    sounds_dir = args.resource_pack / "sounds" / "mzk"
    sounds_dir.mkdir(parents=True, exist_ok=True)
    definitions: dict[str, object] = {}

    with tempfile.TemporaryDirectory(prefix="koszalin-tts-") as temp_name:
        temp = Path(temp_name)
        for number, record in enumerate(records, start=1):
            wav = temp / f"{record['slug']}.wav"
            ogg = sounds_dir / f"{record['slug']}.ogg"
            subprocess.run(
                [espeak, "-v", "pl", "-s", "148", "-p", "43", "-a", "155", "-w", str(wav), record["text"]],
                check=True,
                stdout=subprocess.DEVNULL,
            )
            filter_graph = (
                "[0:a]volume=0.34,afade=t=out:st=0.13:d=0.10[chime];"
                "[1:a]adelay=360|360,highpass=f=90,lowpass=f=9200[voice];"
                "[chime][voice]amix=inputs=2:duration=longest:normalize=0,"
                "loudnorm=I=-18:TP=-2:LRA=9[out]"
            )
            subprocess.run(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "sine=frequency=784:duration=0.24:sample_rate=48000",
                    "-i", str(wav), "-filter_complex", filter_graph, "-map", "[out]",
                    "-ac", "1", "-ar", "48000", "-c:a", "libvorbis", "-q:a", "2", str(ogg),
                ],
                check=True,
            )
            definitions[f"mzk.stop.{record['slug']}"] = {
                "category": "neutral",
                "max_distance": 26.0,
                "min_distance": 1.0,
                "sounds": [{"name": f"sounds/mzk/{record['slug']}", "stream": False}],
            }
            if number % 25 == 0 or number == len(records):
                print(f"generated announcements: {number}/{len(records)}")

    sound_definitions = {
        "format_version": "1.20.20",
        "sound_definitions": definitions,
    }
    (args.resource_pack / "sounds" / "sound_definitions.json").write_text(
        json.dumps(sound_definitions, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (args.resource_pack / "sounds.json").write_text(
        json.dumps({"individual_event_sounds": {"events": {}}}, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
