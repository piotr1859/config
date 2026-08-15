#!/usr/bin/env python3
"""Convert the current Koszalin GTFS feed into compact Bedrock Script data.

The output is JavaScript rather than JSON because Bedrock's script loader does
not consistently support JSON module imports on every Android release.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


ORIGIN_LAT = 54.190278
ORIGIN_LON = 16.181667
BLOCKS_PER_METRE = 0.35
EXPECTED_LINES = {
    "1S", "1", "2", "3", "4", "6", "8", "9", "10", "11",
    "12", "13", "14", "15", "16", "17", "18", "20", "21S", "23S",
}


LANDMARKS = [
    {"kind": "town_hall", "name": "Rynek Staromiejski i Ratusz", "lat": 54.190278, "lon": 16.181667},
    {"kind": "cathedral", "name": "Katedra Niepokalanego Poczęcia NMP", "lat": 54.189535, "lon": 16.180581},
    {"kind": "station", "name": "Dworzec PKP i centrum przesiadkowe", "lat": 54.187080, "lon": 16.171760},
    {"kind": "amphitheatre", "name": "Amfiteatr im. I. J. Paderewskiego", "lat": 54.195650, "lon": 16.183250},
    {"kind": "philharmonic", "name": "Filharmonia Koszalińska", "lat": 54.191110, "lon": 16.187770},
    {"kind": "museum", "name": "Muzeum w Koszalinie i Park Młynarski", "lat": 54.193300, "lon": 16.181650},
    {"kind": "theatre", "name": "Bałtycki Teatr Dramatyczny", "lat": 54.188850, "lon": 16.177420},
    {"kind": "water_park", "name": "Park Wodny Koszalin", "lat": 54.206950, "lon": 16.199650},
    {"kind": "sports_hall", "name": "Hala Widowiskowo-Sportowa", "lat": 54.201930, "lon": 16.202650},
    {"kind": "university", "name": "Politechnika Koszalińska", "lat": 54.201000, "lon": 16.174550},
    {"kind": "mall", "name": "Forum Koszalin", "lat": 54.195600, "lon": 16.207950},
    {"kind": "depot", "name": "Zajezdnia MZK – Gnieźnieńska 9", "lat": 54.170720, "lon": 16.188920},
    {"kind": "chelm", "name": "Góra Chełmska", "lat": 54.211950, "lon": 16.250250},
]


def read_csv_from_zip(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    raw = zf.read(name).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(raw)))


def world_xy(lat: float, lon: float) -> tuple[int, int]:
    metres_x = (lon - ORIGIN_LON) * 111_320.0 * math.cos(math.radians(ORIGIN_LAT))
    metres_z = -(lat - ORIGIN_LAT) * 111_320.0
    return round(metres_x * BLOCKS_PER_METRE), round(metres_z * BLOCKS_PER_METRE)


def natural_line_key(value: str) -> tuple[int, str]:
    match = re.match(r"(\d+)", value)
    return (int(match.group(1)) if match else 999, value)


def base_stop_name(name: str) -> str:
    return re.sub(r"\s+\d{2}$", "", name).strip()


def sound_slug(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "_", normalized.lower()).strip("_")[:46]
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:7]
    return f"{slug or 'przystanek'}_{digest}"


def choose_route_patterns(
    route_id: str,
    trips: list[dict[str, str]],
    stop_times_by_trip: dict[str, list[dict[str, str]]],
) -> list[dict[str, object]]:
    pattern_counts: Counter[tuple[str, tuple[str, ...]]] = Counter()
    for trip in trips:
        ordered = sorted(stop_times_by_trip.get(trip["trip_id"], []), key=lambda row: int(row["stop_sequence"]))
        sequence = tuple(row["stop_id"] for row in ordered)
        if len(sequence) >= 2:
            headsign = trip.get("trip_headsign", "").strip() or "Trasa"
            pattern_counts[(headsign, sequence)] += 1

    candidates = [
        {"headsign": key[0], "sequence": key[1], "frequency": frequency}
        for key, frequency in pattern_counts.items()
    ]
    all_stops = {stop_id for candidate in candidates for stop_id in candidate["sequence"]}
    uncovered = set(all_stops)
    selected: list[dict[str, object]] = []
    # Greedy coverage keeps uncommon real variants without creating every timetable trip.
    while candidates and len(selected) < 4:
        best = max(
            candidates,
            key=lambda candidate: (
                len(set(candidate["sequence"]) & uncovered),
                candidate["frequency"],
                len(candidate["sequence"]),
            ),
        )
        selected.append(best)
        uncovered.difference_update(best["sequence"])
        candidates.remove(best)
        if not uncovered and len(selected) >= 2:
            break
    if len(selected) == 1:
        # Circular routes still get a second vehicle, offset by half a lap.
        selected.append(dict(selected[0]))

    patterns: list[dict[str, object]] = []
    for index, selected_pattern in enumerate(selected):
        headsign = selected_pattern["headsign"]
        sequence = selected_pattern["sequence"]
        patterns.append({
            "headsign": headsign,
            "stopIds": list(sequence),
            "phase": 0.5 if index == 1 and selected[0]["sequence"] == sequence else (index * 0.23) % 1.0,
        })
    return patterns


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gtfs", required=True, type=Path)
    parser.add_argument("--output-js", required=True, type=Path)
    parser.add_argument("--voice-list", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()

    with zipfile.ZipFile(args.gtfs) as zf:
        routes_rows = read_csv_from_zip(zf, "routes.txt")
        stops_rows = read_csv_from_zip(zf, "stops.txt")
        trips_rows = read_csv_from_zip(zf, "trips.txt")
        stop_times_rows = read_csv_from_zip(zf, "stop_times.txt")
        feed_info_rows = read_csv_from_zip(zf, "feed_info.txt")

    routes_by_id = {row["route_id"]: row for row in routes_rows}
    line_names = {row.get("route_short_name", "").strip() for row in routes_rows}
    if line_names != EXPECTED_LINES:
        missing = sorted(EXPECTED_LINES - line_names, key=natural_line_key)
        extra = sorted(line_names - EXPECTED_LINES, key=natural_line_key)
        raise SystemExit(f"GTFS line set changed; missing={missing}, extra={extra}")

    stop_times_by_trip: dict[str, list[dict[str, str]]] = defaultdict(list)
    active_stop_ids: set[str] = set()
    for row in stop_times_rows:
        stop_times_by_trip[row["trip_id"]].append(row)
        active_stop_ids.add(row["stop_id"])

    if len(active_stop_ids) < 340:
        raise SystemExit(f"GTFS contains only {len(active_stop_ids)} active directional stops")

    trips_by_route: dict[str, list[dict[str, str]]] = defaultdict(list)
    trip_to_route: dict[str, str] = {}
    for row in trips_rows:
        trips_by_route[row["route_id"]].append(row)
        trip_to_route[row["trip_id"]] = row["route_id"]

    stop_lines: dict[str, set[str]] = defaultdict(set)
    for row in stop_times_rows:
        route_id = trip_to_route.get(row["trip_id"])
        if route_id:
            stop_lines[row["stop_id"]].add(routes_by_id[route_id]["route_short_name"])

    stop_index: dict[str, int] = {}
    stops: list[dict[str, object]] = []
    voice_records: dict[str, dict[str, str]] = {}
    for row in stops_rows:
        stop_id = row["stop_id"]
        if stop_id not in active_stop_ids:
            continue
        x, z = world_xy(float(row["stop_lat"]), float(row["stop_lon"]))
        base_name = base_stop_name(row["stop_name"])
        slug = sound_slug(base_name)
        voice_records.setdefault(slug, {
            "slug": slug,
            "name": base_name,
            "text": f"Następny przystanek: {base_name}",
        })
        stop_index[stop_id] = len(stops)
        stops.append({
            "id": stop_id,
            "code": row.get("stop_code", ""),
            "name": row["stop_name"],
            "x": x,
            "z": z,
            "lines": sorted(stop_lines.get(stop_id, ()), key=natural_line_key),
            "sound": slug,
        })

    routes: list[dict[str, object]] = []
    total_route_stop_pairs = 0
    covered_route_stop_pairs = 0
    for route_id, route_row in sorted(routes_by_id.items(), key=lambda item: natural_line_key(item[1]["route_short_name"])):
        patterns = choose_route_patterns(route_id, trips_by_route[route_id], stop_times_by_trip)
        converted_patterns: list[dict[str, object]] = []
        selected_stop_ids: set[str] = set()
        for pattern in patterns:
            indices = [stop_index[stop_id] for stop_id in pattern["stopIds"] if stop_id in stop_index]
            if len(indices) >= 2:
                selected_stop_ids.update(stop_id for stop_id in pattern["stopIds"] if stop_id in stop_index)
                converted_patterns.append({
                    "headsign": pattern["headsign"],
                    "stops": indices,
                    "phase": pattern["phase"],
                })
        route_stop_ids = {
            row["stop_id"]
            for trip in trips_by_route[route_id]
            for row in stop_times_by_trip.get(trip["trip_id"], [])
            if row["stop_id"] in stop_index
        }
        total_route_stop_pairs += len(route_stop_ids)
        covered_route_stop_pairs += len(route_stop_ids & selected_stop_ids)
        routes.append({
            "line": route_row["route_short_name"],
            "color": route_row.get("route_color", "FFD200") or "FFD200",
            "vehicle": "ferry" if route_row.get("route_type") == "4" else "bus",
            "patterns": converted_patterns,
        })

    landmarks = []
    for landmark in LANDMARKS:
        x, z = world_xy(landmark["lat"], landmark["lon"])
        landmarks.append({"kind": landmark["kind"], "name": landmark["name"], "x": x, "z": z})

    feed_info = feed_info_rows[0] if feed_info_rows else {}
    meta = {
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "blocksPerMetre": BLOCKS_PER_METRE,
        "feedVersion": feed_info.get("feed_version", "unknown"),
        "feedStartDate": feed_info.get("feed_start_date", ""),
        "feedEndDate": feed_info.get("feed_end_date", ""),
        "activeDirectionalStops": len(stops),
        "uniqueAnnouncements": len(voice_records),
        "lines": len(routes),
        "routeStopCoverage": round(covered_route_stop_pairs / max(1, total_route_stop_pairs), 4),
    }

    args.output_js.parent.mkdir(parents=True, exist_ok=True)
    args.voice_list.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    compact = dict(ensure_ascii=False, separators=(",", ":"))
    args.output_js.write_text(
        "// Generated from the Koszalin GTFS feed. Do not edit by hand.\n"
        f"export const META={json.dumps(meta, **compact)};\n"
        f"export const STOPS={json.dumps(stops, **compact)};\n"
        f"export const ROUTES={json.dumps(routes, **compact)};\n"
        f"export const LANDMARKS={json.dumps(landmarks, **compact)};\n",
        encoding="utf-8",
    )
    args.voice_list.write_text(
        "\n".join(json.dumps(record, ensure_ascii=False) for record in sorted(voice_records.values(), key=lambda r: r["slug"])) + "\n",
        encoding="utf-8",
    )
    args.report.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    main()
