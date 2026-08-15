#!/usr/bin/env python3
"""Generate original Koszalin MZK-inspired pack art and bus texture variants."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


LINES = ["1S", "1", "2", "3", "4", "6", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "20", "21S", "23S"]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def center_text(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, text_font, fill) -> None:
    x1, y1, x2, y2 = box
    bounds = draw.textbbox((0, 0), text, font=text_font)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    draw.text(((x1 + x2 - width) / 2, (y1 + y2 - height) / 2 - bounds[1]), text, font=text_font, fill=fill)


def bus_texture(line: str, destination: Path) -> None:
    image = Image.new("RGBA", (256, 256), (247, 192, 0, 255))
    draw = ImageDraw.Draw(image)
    yellow = (247, 192, 0, 255)
    bright_yellow = (255, 216, 0, 255)
    green = (44, 126, 69, 255)
    dark_green = (22, 87, 44, 255)
    glass = (20, 42, 50, 255)
    glass_light = (61, 104, 116, 255)
    black = (7, 10, 11, 255)
    white = (245, 247, 235, 255)
    red = (185, 23, 27, 255)

    # Face atlas: front, rear, left, right, roof and floor.
    faces = [(0, 0, 48, 40), (48, 0, 96, 40), (0, 40, 128, 80), (0, 80, 128, 120), (128, 40, 176, 168), (176, 40, 224, 168)]
    for box in faces:
        draw.rectangle(box, fill=yellow)

    # Front.
    draw.rectangle((2, 5, 45, 20), fill=glass)
    draw.rectangle((5, 8, 18, 17), fill=glass_light)
    draw.rectangle((21, 7, 42, 16), fill=black)
    center_text(draw, (21, 7, 42, 16), line, font(9, True), (255, 224, 64, 255))
    draw.rectangle((0, 23, 47, 27), fill=green)
    draw.rectangle((4, 33, 11, 36), fill=white)
    draw.rectangle((36, 33, 43, 36), fill=white)

    # Rear.
    draw.rectangle((51, 6, 93, 19), fill=glass)
    draw.rectangle((61, 8, 82, 17), fill=black)
    center_text(draw, (61, 8, 82, 17), line, font(9, True), (255, 224, 64, 255))
    draw.rectangle((48, 23, 95, 27), fill=green)
    draw.rectangle((51, 32, 56, 36), fill=red)
    draw.rectangle((87, 32, 92, 36), fill=red)

    for top in (40, 80):
        # Side windows and pillars.
        draw.rectangle((4, top + 4, 123, top + 19), fill=glass)
        for pillar in (26, 51, 76, 101):
            draw.rectangle((pillar, top + 4, pillar + 3, top + 19), fill=yellow)
        draw.rectangle((0, top + 23, 127, top + 28), fill=green)
        draw.rectangle((87, top + 4, 104, top + 38), outline=dark_green, width=2)
        draw.rectangle((91, top + 7, 100, top + 19), fill=glass_light)
        draw.ellipse((13, top + 29, 27, top + 43), fill=black)
        draw.ellipse((101, top + 29, 115, top + 43), fill=black)
        draw.ellipse((17, top + 33, 23, top + 39), fill=(125, 128, 126, 255))
        draw.ellipse((105, top + 33, 111, top + 39), fill=(125, 128, 126, 255))
        draw.rectangle((8, top + 20, 30, top + 27), fill=black)
        center_text(draw, (8, top + 20, 30, top + 27), line, font(7, True), (255, 224, 64, 255))
        draw.text((55, top + 29), "MZK", font=font(7, True), fill=dark_green)

    # Roof, floor and a small generic dark swatch for wheel cubes.
    draw.rectangle((130, 42, 173, 165), fill=bright_yellow)
    draw.rectangle((137, 65, 166, 141), fill=(221, 221, 205, 255))
    draw.rectangle((178, 42, 221, 165), fill=(55, 58, 55, 255))
    draw.rectangle((224, 0, 255, 31), fill=black)
    draw.rectangle((224, 32, 255, 63), fill=(130, 132, 130, 255))
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def ferry_texture(destination: Path) -> None:
    image = Image.new("RGBA", (256, 256), (242, 242, 232, 255))
    draw = ImageDraw.Draw(image)
    white = (242, 242, 232, 255)
    blue = (28, 91, 148, 255)
    yellow = (247, 192, 0, 255)
    glass = (22, 52, 70, 255)
    # Hull faces.
    for box in ((0, 0, 64, 20), (64, 0, 128, 20), (0, 20, 160, 40), (0, 40, 160, 60), (160, 20, 224, 180)):
        draw.rectangle(box, fill=white)
    draw.rectangle((0, 11, 127, 19), fill=blue)
    draw.rectangle((0, 31, 159, 39), fill=blue)
    draw.rectangle((0, 51, 159, 59), fill=blue)
    draw.rectangle((0, 8, 127, 11), fill=yellow)
    draw.rectangle((0, 28, 159, 31), fill=yellow)
    draw.rectangle((0, 48, 159, 51), fill=yellow)
    # Cabin faces.
    for box in ((0, 64, 48, 96), (48, 64, 96, 96), (0, 96, 96, 128), (0, 128, 96, 160), (96, 96, 144, 192)):
        draw.rectangle(box, fill=white)
    for y in (69, 101, 133):
        draw.rectangle((5, y, 91 if y > 90 else 43, y + 13), fill=glass)
        for pillar in range(19, 90, 22):
            draw.rectangle((pillar, y, pillar + 3, y + 13), fill=white)
    center_text(draw, (3, 2, 61, 12), "1S", font(10, True), blue)
    center_text(draw, (67, 2, 125, 12), "JULEK", font(9, True), blue)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, optimize=True)


def icon(destination: Path, jpeg: bool = False) -> None:
    image = Image.new("RGB", (512, 512), (244, 202, 26))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 512, 90), fill=(31, 105, 57))
    draw.rectangle((0, 422, 512, 512), fill=(31, 105, 57))
    # Original simplified yellow-and-green city bus illustration.
    draw.rounded_rectangle((65, 145, 447, 355), radius=36, fill=(255, 213, 18), outline=(26, 73, 45), width=10)
    draw.rectangle((94, 174, 418, 250), fill=(21, 48, 57))
    for x in (165, 238, 311, 384):
        draw.rectangle((x, 174, x + 8, 250), fill=(255, 213, 18))
    draw.rectangle((65, 270, 447, 300), fill=(38, 125, 66))
    draw.ellipse((105, 316, 175, 386), fill=(15, 18, 18), outline=(235, 235, 220), width=8)
    draw.ellipse((337, 316, 407, 386), fill=(15, 18, 18), outline=(235, 235, 220), width=8)
    draw.rectangle((320, 184, 407, 231), fill=(5, 9, 9))
    center_text(draw, (320, 184, 407, 231), "MZK", font(27, True), (255, 221, 49))
    center_text(draw, (0, 10, 512, 84), "KOSZALIN", font(58, True), (255, 255, 245))
    center_text(draw, (0, 430, 512, 500), "AUTOBUSY • PRZYSTANKI", font(28, True), (255, 255, 245))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if jpeg:
        image.save(destination, quality=92, optimize=True)
    else:
        image.save(destination, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resource-pack", required=True, type=Path)
    parser.add_argument("--behavior-pack", required=True, type=Path)
    parser.add_argument("--world", required=True, type=Path)
    args = parser.parse_args()

    textures = args.resource_pack / "textures" / "entity"
    for index, line in enumerate(LINES):
        bus_texture(line, textures / f"bus_{index}.png")
    ferry_texture(textures / "ferry.png")
    transparent = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    transparent.save(textures / "transparent.png")
    icon(args.resource_pack / "pack_icon.png")
    icon(args.behavior_pack / "pack_icon.png")
    icon(args.world / "world_icon.jpeg", jpeg=True)


if __name__ == "__main__":
    main()
