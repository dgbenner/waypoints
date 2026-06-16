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
  "macroRegion": "uk",           // "uk" or "eu". Flag control: Ireland (country:"Ireland"),
                                 //   UK (macroRegion uk, not Ireland), Europe (macroRegion eu)
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

## In-app "Add a waypoint"

The corner-bracket **+ Add waypoint** button (lower-left, above the legend)
opens a modal: drop an image, paste a link, or type a description
(e.g. "Ian Curtis's grave, Macclesfield"). It calls `/api/draft`, which uses
Claude (`claude-opus-4-8`, structured output + vision) to draft the record,
Nominatim to geocode it, shows you a preview, then commits the pin (and image)
to `data.json` via the GitHub API. The new pin also drops on the map live.

**This needs a backend** — GitHub Pages can't run it. The function lives in
`api/draft.js` (Vercel). The map can stay on Pages and just call the Vercel URL.

### Backend setup (one time)

1. Import this repo as a project on [Vercel](https://vercel.com/new) (Framework
   preset: **Other**; no build command — it serves the static files and the
   `/api` function).
2. Add three Environment Variables in the Vercel project settings:
   - `ANTHROPIC_API_KEY` — your Anthropic key (drafting).
   - `GITHUB_TOKEN` — a fine-grained PAT with **Contents: Read and write** on
     `dgbenner/waypoints` (so it can commit the pin + image).
   - `WAYPOINTS_ADD_SECRET` — any passphrase; the modal's "Access key" must match
     it. (Stops strangers spending your API credits on the public URL.)
   - Optional: `GITHUB_REPO` (default `dgbenner/waypoints`), `GITHUB_BRANCH` (default `main`).
3. Deploy. Then either use the **Vercel URL** for the whole site, **or** keep the
   map on GitHub Pages and set `API_BASE` at the top of `js/add.js` to your
   Vercel URL (e.g. `https://waypoints-xxxx.vercel.app`).

Quick test once deployed:

```sh
curl -s -X POST https://<your-vercel-url>/api/draft \
  -H 'Content-Type: application/json' \
  -d '{"action":"draft","password":"<secret>","kind":"text","text":"Ian Curtis grave, Macclesfield"}'
```

Adding a pin by hand still works any time — edit `data.json` and push.

## Roadmap

- Geolocation "distance from me" (Haversine to each pin) for use on the road.
- EU base layer (Stadia Terrain) + EU data.
- The in-app add flow above.
