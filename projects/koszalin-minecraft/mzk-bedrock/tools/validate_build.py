#!/usr/bin/env python3
"""Fail the release if the embedded world/add-on is incomplete or inconsistent."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path


BP_UUID = "09e3e483-86a7-4d2a-b1c7-1f3536600010"
RP_UUID = "09e3e483-86a7-4d2a-b1c7-1f3536600020"


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--world", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()

    report = load(args.report)
    if report["lines"] != 20:
        raise SystemExit(f"expected 20 lines, got {report['lines']}")
    if report["activeDirectionalStops"] < 340:
        raise SystemExit(f"too few active stops: {report['activeDirectionalStops']}")
    if report["uniqueAnnouncements"] < 150:
        raise SystemExit(f"too few announcements: {report['uniqueAnnouncements']}")
    if report.get("routeStopCoverage", 0) < 0.98:
        raise SystemExit(f"route pattern coverage too low: {report.get('routeStopCoverage')}")

    bp = args.world / "behavior_packs" / "KoszalinMZK_BP"
    rp = args.world / "resource_packs" / "KoszalinMZK_RP"
    bp_manifest = load(bp / "manifest.json")
    rp_manifest = load(rp / "manifest.json")
    world_bp = load(args.world / "world_behavior_packs.json")
    world_rp = load(args.world / "world_resource_packs.json")
    if bp_manifest["header"]["uuid"] != BP_UUID or world_bp[0]["pack_id"] != BP_UUID:
        raise SystemExit("behavior pack UUID mismatch")
    if rp_manifest["header"]["uuid"] != RP_UUID or world_rp[0]["pack_id"] != RP_UUID:
        raise SystemExit("resource pack UUID mismatch")

    for path in list(bp.rglob("*.json")) + list(rp.rglob("*.json")):
        load(path)

    sounds = list((rp / "sounds" / "mzk").glob("*.ogg"))
    textures = list((rp / "textures" / "entity").glob("bus_*.png"))
    if len(sounds) != report["uniqueAnnouncements"]:
        raise SystemExit(f"sound count mismatch: {len(sounds)} != {report['uniqueAnnouncements']}")
    if len(textures) != 20:
        raise SystemExit(f"expected 20 bus textures, got {len(textures)}")
    if not (rp / "textures" / "entity" / "ferry.png").is_file():
        raise SystemExit("Julek ferry texture missing")
    if not (bp / "entities" / "ferry.json").is_file():
        raise SystemExit("Julek ferry behavior missing")

    level = (args.world / "level.dat").read_bytes()
    if len(level) < 16:
        raise SystemExit("level.dat is truncated")
    storage_version, payload_length = struct.unpack("<II", level[:8])
    if storage_version != 10 or payload_length != len(level) - 8:
        raise SystemExit("invalid Bedrock level.dat header")
    if not (args.world / "world_icon.jpeg").is_file():
        raise SystemExit("world icon missing")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
