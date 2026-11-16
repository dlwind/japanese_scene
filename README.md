# Japanese Scenes 場面で学ぶ日本語

A small static website that hosts comics for learning Japanese. Each comic is a
set of scenes; every speech bubble shows the Japanese line with furigana, its
romaji and an English translation, and each scene has an "Other ways to say it"
(ほかの言い方) panel of related phrases.

The first comic, **Ordering at a Tonkatsu Restaurant** (とんかつ屋で注文), was
imported from a Claude Design canvas.

## Features

- **Library** (`index.html`): every comic as a card with a cover drawn from its
  own panels, plus search (English or Japanese) and tag filters.
- **Reader** (`read.html?comic=<id>&scene=<n>`): scene tabs, comic panels and a
  phrase sidebar, laid out in two columns on desktop and one on phones.
- **Study toggles**: turn furigana, romaji or English off. Hidden lines get a
  "Show English" / "Show romaji" button, so you can test yourself one bubble
  at a time. Your settings are remembered in the browser.
- ← / → keys change scenes, and the reader remembers the last scene you read
  in each comic.
- No build step and no dependencies: plain HTML, CSS and JavaScript.

## Run locally

The pages load JSON with `fetch`, so serve the folder over HTTP instead of
opening the files directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy

The site is static, so any static host works. For GitHub Pages: go to
Settings → Pages, choose "Deploy from a branch" and pick the branch with the
root folder. `.nojekyll` is already included.

## Layout

```
index.html            library page
read.html             reader page
assets/style.css      all styles
assets/app.js         library and reader logic
comics/index.json     catalog shown in the library
comics/<id>/comic.json  one comic
tools/import_dc.py    imports a Claude Design canvas as a comic
```

## Adding a comic

### Option A: import from a Claude Design canvas

Download the canvas's `project/` folder (`canvas.json` plus one `.dc.html`
per scene), then run:

```bash
pip install beautifulsoup4
python3 tools/import_dc.py path/to/project my-comic-id --summary "One-line description" --tags "food,travel"
```

This writes `comics/my-comic-id/comic.json` and adds the comic to
`comics/index.json`. The importer expects the same scene layout as the
tonkatsu comic: a header, `.panel` elements with one `.bubble` each, and an
`<aside>` of phrases.

### Option B: write the JSON by hand

1. Create `comics/<id>/comic.json`. Use letters, digits, `-` and `_` in `<id>`.
2. Add a matching entry to `comics/index.json`.

```jsonc
{
  "id": "konbini",
  "title": "At the Convenience Store",
  "titleJa": "コンビニで",                // may contain <ruby>…<rt>…</rt></ruby>
  "summary": "…",
  "level": "Beginner",
  "tags": ["shopping"],
  "scenes": [
    {
      "n": 1,
      "title": "<ruby>入<rt>はい</rt></ruby>る",    // Japanese scene title
      "subtitle": "Arriving",                       // English scene title
      "location": "コンビニ · Convenience store",   // optional pill
      "panels": [
        {
          "n": 1,
          "wide": false,          // true = spans both columns
          "bg": "#FFF1D6",        // panel background
          "bubble": {
            "side": "right",      // which side the tail points to
            "speaker": "staff",   // you | staff | other (sets the label colour)
            "label": "店員 · Staff",
            "ja": "いらっしゃいませ！",
            "romaji": "Irasshaimase!",
            "en": "Welcome!"
          },
          "art": {                // inline SVG strings, all optional
            "left": "<svg viewBox=\"0 0 200 230\">…</svg>",
            "right": "<svg viewBox=\"0 0 200 230\">…</svg>",
            "prop": "<svg viewBox=\"0 0 140 120\">…</svg>"
          }
        }
      ],
      "phrases": [
        { "speaker": "you", "label": "あなた · You", "ja": "…", "romaji": "…", "en": "…" }
      ]
    }
  ]
}
```

Library entry in `comics/index.json`:

```json
{ "id": "konbini", "title": "At the Convenience Store", "titleJa": "コンビニで",
  "summary": "…", "level": "Beginner", "tags": ["shopping"], "scenes": 1, "panels": 1 }
```

Text fields may use only basic inline markup (`ruby`, `rt`, `br`, `b`, `em`).
SVG art is filtered to plain drawing elements. Scripts, event handlers and
external links are removed when the page renders, so a contributed comic can't
run code.
