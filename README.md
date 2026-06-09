# Waypoints

A zoomable, clickable cartographic map for gathering places worth visiting —
color- and symbol-coded, populated over time. Great Britain first, built to
extend across the EU. Personal project; single user.

Survey-map aesthetic (OS Explorer meets a 1930s Bartholomew touring map): aged
paper, contour hairlines, engraved labels, inked category tones.

## Stack

Vanilla HTML/CSS/JS + [Leaflet](https://leafletjs.com/). No build step. Base
tiles are keyless **Esri World Topographic** (English labels incl. seas/oceans;
terrain/touring-map look). CARTO Voyager is kept in `js/app.js` as an
alternative.

## Run locally

`fetch()` won't work over `file://`, so serve the folder:

```sh
cd waypoints
python3 -m http.server 8000
# open http://localhost:8000
```

Deployed (e.g. Vercel static hosting) it just works — no server command needed.

## Data — `data.json` is the single source of truth

One record per place. **To add or change a pin, edit `data.json`** (by hand or
push to it) and redeploy. The map reads it at load.

```jsonc
{
  "id": "edinburgh-castle",      // kebab-case unique key
  "name": "Edinburgh Castle",
  "macroRegion": "uk",           // "uk" or "eu" — drives the UK/Europe segmented control
  "region": "Edinburgh",
  "subregion": "Old Town",
  "country": "Scotland",
  "lat": 55.9486,                // WGS84
  "lng": -3.1999,
  "approx": false,               // true = loosely geocoded; shows a panel flag. omit if exact
  "category": "heritage",        // personal | heritage | modern | nature  (= pin color)
  "themes": ["castle"],          // first theme drives the pin glyph (see below)
  "prominence": "standard",      // signature (filled disc) | standard (faint ring)
  "blurb": "Gun at 1pm, Stone of Destiny, Crown Jewels.",
  "timeGated": true,             // true -> panel shows hours + officialUrl
  "hours": "09:30–18:00 (seasonal — verify)",
  "officialUrl": "https://www.edinburghcastle.scot",
  "link": "",                    // freeform reference link
  "images": ["edinburgh-old-town.png"],  // filenames in /images ([] if none)
  "source": "manual",
  "status": "want-to-see"        // want-to-see | maybe | done
}
```

**Categories (pin color):** `personal` (madder rose), `heritage` (ochre),
`modern` (teal), `nature` (moss).

**Themes (pin glyph):** `music`, `art`, `literary`, `chess`, `castle`,
`cathedral`, `monument`, `industrial`, `coast`, `mountain`, `wildlife`, `food`.

Pins with `"approx": true` are region-level/multi-site coordinates worth
nudging — `grep '"approx": true' data.json` to find them.

## Base tiles — swapping in Thunderforest

Keyless Esri World Topographic renders now. When a Thunderforest key is
available, paste it into `THUNDERFOREST_KEY` at the top of `js/app.js` — GB
automatically switches to OS-style Outdoors tiles. `STADIA_KEY` does the same
for the EU presets.

## Images

23 cropped thumbnails live in `/images`, referenced by filename from each
record's `images` array.

⚠️ `images/kenna-power-stations.png` is © **Michael Kenna** (living photographer).
Fine for personal use; **replace before any public/commercial publish.**

## Planned (stubbed, not built) — in-app "add a place"

Deferred by choice. The intended flow, when built:

- A password-gated `add.html` where you drop a **link / image / text** (any
  combination).
- A serverless `/api/draft.js` (Vercel, `@anthropic-ai/sdk`, `claude-opus-4-8`,
  structured output + vision) drafts the record fields from the input.
- Nominatim (keyless) geocodes the name → `lat`/`lng`.
- The function commits the new record to `data.json` (and the image into
  `/images`) via the GitHub API; Vercel redeploys and the pin goes live.

Until then, adding a pin = editing `data.json` and redeploying.

## Roadmap

- Geolocation "distance from me" (Haversine to each pin) for use on the road.
- EU base layer (Stadia Terrain) + EU data.
- The in-app add flow above.
