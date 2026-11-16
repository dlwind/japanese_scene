#!/usr/bin/env python3
"""Import a comic drawn as Claude Design canvas artboards (.dc.html) into the
site's JSON format.

Usage:
    python3 tools/import_dc.py <project_dir> <comic_id> [--title-ja ...] [--title-en ...]

<project_dir> holds canvas.json and one .dc.html per scene, as downloaded from
a Design canvas. The comic is written to comics/<comic_id>/comic.json and
registered in comics/index.json.

Each artboard is expected to follow the "scene page" layout: a header with the
scene number, Japanese title and English subtitle; a grid of .panel elements,
each with a numbered badge, one speech .bubble and absolutely-positioned SVG
art; and an <aside> of alternative phrases.
"""
import argparse
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
SVG_CAMEL = ("viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform",
             "patternUnits", "clipPathUnits", "textLength", "lengthAdjust")


def inner(tag):
    return "".join(str(c) for c in tag.contents).strip()


def style_of(tag):
    out = {}
    for part in (tag.get("style") or "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def speaker_of(chip):
    """Return (role, label_html) from a speaker chip like 'あなた · You'."""
    bg = style_of(chip).get("background", "").upper()
    role = "you" if bg == "#2A8C82" else "staff" if bg == "#23395B" else "other"
    return role, inner(chip)


def parse_line(box):
    """A bubble or phrase card: chip, Japanese, romaji, English."""
    chip = box.find("span")
    ps = box.find_all("p", recursive=False)
    role, label = speaker_of(chip)
    return {
        "speaker": role,
        "label": label,
        "ja": inner(ps[0]),
        "romaji": ps[1].get_text(strip=True),
        "en": ps[2].get_text(strip=True),
    }


def clean_svg(tag):
    svg = tag if tag.name == "svg" else tag.find("svg")
    svg = BeautifulSoup(str(svg), "html.parser").svg
    for attr in ("style", "width", "height"):
        svg.attrs.pop(attr, None)
    out = re.sub(r"\n\s*\n+", "\n", str(svg))
    # html.parser lowercases attribute names; SVG needs these camelCased.
    for name in SVG_CAMEL:
        out = re.sub(rf"(\s){name.lower()}=", rf"\1{name}=", out)
    return out


def parse_scene(path, meta):
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    header = soup.find("header")
    num = header.find("span", string=re.compile(r"^\d+$"))
    h1 = header.find("h1")
    subtitle = h1.find_next_sibling("p")
    location = header.find_all("p")[-1]

    panels = []
    for el in soup.select("div.panel"):
        st = style_of(el)
        bubble = el.select_one("div.bubble")
        badge = el.find("div", recursive=False)
        panel = {
            "n": int(badge.get_text(strip=True)),
            "wide": "span 2" in st.get("grid-column", ""),
            "bg": st.get("background-color", "#FFF1D6"),
            "bubble": dict(parse_line(bubble), side="right" if "r" in bubble["class"] else "left"),
        }
        art = {}
        for child in el.find_all(["div", "svg"], recursive=False):
            if child in (badge, bubble):
                continue
            cs = style_of(child)
            slot = "prop" if "50%" in cs.get("left", "") else "left" if "left" in cs else "right"
            art[slot] = clean_svg(child)
        panel["art"] = art
        panels.append(panel)

    aside = soup.find("aside")
    phrases = [parse_line(card) for card in aside.find_all("div", recursive=False)]

    return {
        "n": int(num.get_text()),
        "title": inner(h1),
        "subtitle": subtitle.get_text(strip=True),
        "location": inner(location),
        "caption": meta.get("title", ""),
        "panels": panels,
        "phrases": phrases,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project_dir", type=Path)
    ap.add_argument("comic_id")
    ap.add_argument("--title-ja")
    ap.add_argument("--title-en")
    ap.add_argument("--summary", default="")
    ap.add_argument("--level", default="Beginner")
    ap.add_argument("--tags", default="")
    args = ap.parse_args()

    canvas = json.loads((args.project_dir / "canvas.json").read_text(encoding="utf-8"))
    scenes = [parse_scene(args.project_dir / name, canvas["boards"].get(name, {}))
              for name in canvas["order"]]

    title_note = canvas.get("notes", {}).get("title", {}).get("text", "")
    ja, _, en = title_note.partition(" — ")
    comic = {
        "id": args.comic_id,
        "title": args.title_en or en or canvas.get("title", args.comic_id),
        "titleJa": args.title_ja or ja,
        "summary": args.summary,
        "level": args.level,
        "tags": [t.strip() for t in args.tags.split(",") if t.strip()],
        "scenes": scenes,
    }

    out_dir = ROOT / "comics" / args.comic_id
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "comic.json").write_text(json.dumps(comic, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    index_path = ROOT / "comics" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"comics": []}
    entry = {
        "id": comic["id"], "title": comic["title"], "titleJa": comic["titleJa"],
        "summary": comic["summary"], "level": comic["level"], "tags": comic["tags"],
        "scenes": len(scenes), "panels": sum(len(s["panels"]) for s in scenes),
    }
    index["comics"] = [c for c in index["comics"] if c["id"] != comic["id"]] + [entry]
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {out_dir / 'comic.json'}: {len(scenes)} scenes, {entry['panels']} panels", file=sys.stderr)


if __name__ == "__main__":
    main()
