# WAYPOINTS

> A zoomable, clickable cartographic map for gathering the places I want to see
> or do — color- and symbol-coded, populated over time. Great Britain first,
> built to extend across the EU. Stack: **Leaflet**. Spiritual successor to The
> Transmission Hypothesis, but trading the CRT/broadcast look for a survey-map
> aesthetic.

---

## 1. Concept

One map surface. Every place I collect becomes a pin. Tapping a pin opens a
**side panel** (drawer on desktop, bottom sheet on mobile) with what it is, why
it's interesting, coordinates, a link, and — for time-based places — opening
hours. My personal finds stand out as **signature** pins; the typical
everyone-goes-there stops sit quietly underneath as **standard** pins. Not an
itinerary. A gathering surface that I keep feeding, watching the collection take
geographic shape until trip loops suggest themselves.

---

## 2. Aesthetic — cartographic art direction

The break from the CRT era: swap *broadcast noise* for *paper grain*. The target
feel is **OS Explorer meets a 1930s Bartholomew touring map** — aged paper,
contour hairlines, engraved labels — but clean enough to scan fast.

**Base tiles (Leaflet), best fit first:**
- **Thunderforest "Outdoors" / "Landscape"** — contour lines + hill shading,
  very OS-like. Best match for a castles-and-fells GB collection. Free tier, API key.
- **Stadia Maps – Stamen "Terrain"** — relief shading, soft natural palette.
  Good consistent fallback for the EU layer where OS doesn't reach.
- **CARTO "Positron" / "Voyager"** — ultra-clean minimal, if I'd rather go
  modern-cartographic than vintage.
- **Ordnance Survey Maps API (Explorer/Leisure)** — the *real* OS look for GB
  only; needs an OS key, and you'd swap to Stadia/CARTO for the EU presets.
- Recommendation: **Thunderforest Outdoors for GB, Stadia Terrain for EU**, so
  the whole continent stays visually coherent.

**App palette (chrome + overlays, layered over the tiles):**
- Paper base `#F4ECD8`, warm ink `#3A3226`, contour/line accent `#B9824F` (low opacity), water `#6E8CA0`.
- Category colors re-tuned to **inked, paper-native** tones (the earlier neon set fights a paper basemap):
  - Personal `#B23A6E` (madder rose)
  - Heritage `#B07A2B` (ochre / burnt sienna)
  - Modern `#2E7D8A` (teal)
  - Nature `#5A7D4F` (moss)

**Type:** humanist serif with cartographic pedigree — *Spectral*, *Source Serif
4*, or *Fraunces* for more character. Region labels in letter-spaced small caps,
like graticule labels on a real map. Keep one nod to the old world: render
**coordinates in the side panel in monospace**.

**Markers — where prominence lives:**
- **Signature** (my personal picks): filled "survey-marker" disc in the
  category color, thin cream ring, theme glyph, slight drop shadow, a touch
  larger. These are the stars.
- **Standard** (typical tourist stops): ~60% size, ~60% opacity, hollow ring or
  faint dot, minimal or no glyph — they recede into the paper and brighten on
  hover. This is the "lesser iconography/color" for the obvious stops.
- Build both with Leaflet `divIcon` (pure SVG/CSS). Cluster at low zoom with a
  paper-toned bubble.

**Map furniture (the cartographic flourishes):** scale bar, small compass rose,
a legend styled as an engraved cartouche (small-caps "KEY"), an optional faint
lat/long graticule, a low-opacity **paper-grain texture** overlay (the analog
answer to CRT scanlines), and a soft edge vignette.

---

## 3. Category system (pin color)

One primary category per pin = its color. Secondary theme tags drive the symbol.

| Category | Color | What goes here |
|---|---|---|
| **Personal** | `#B23A6E` | Tied to my passions — music, art, literary, chess. |
| **Heritage** | `#B07A2B` | Well-known historic & tourist sites — castles, cathedrals, monuments, Stonehenge. |
| **Modern** | `#2E7D8A` | Contemporary/industrial-age — Mach Loop, Falkirk Wheel, GMT, modern architecture, urbex. |
| **Nature** | `#5A7D4F` | Landscape, coast, wildlife. |

*Food & Drink* isn't pin-able to one coordinate — it lives in a regional side
panel (section 8), not as markers.

## 4. Theme tags (pin symbol)

🎵 Music · 🎨 Art · 📖 Literary · ♟️ Chess · 🏰 Castle · ⛪ Cathedral/kirk/abbey ·
🗿 Monument/stones · ✈️ Aviation/industrial/modern · 🌊 Coast/island ·
⛰️ Mountain/fell/glen · 🐾 Wildlife · 🍽️ Food & drink (panel only)

## 5. Prominence (signature vs standard)

- **Personal-category pins → `signature`** by default.
- **Marquee tourist sites → `standard`** (muted): Edinburgh Castle, Stonehenge,
  British Museum, Loch Ness, The Shambles, Warwick Castle, Bamburgh Castle,
  Arundel Castle, the Royal Mile.
- **Everything else → `signature`** by default — the offbeat finds (Caerlaverock,
  Craigmillar, St Conan's Kirk, Balintore, King Alfred's Tower, the Crooked
  House, the phone-box graveyard) are *my* discoveries, so they earn full color.
- Any pin can be flipped per-record; this is just the starting rule.

---

## 6. Region selector (EU-ready zoom presets)

A **segmented control** sets the view via `fitBounds`. Each pin carries a
`macroRegion` so the control doubles as a coarse filter. Boxes are rough starts
— refine later.

| Preset | `macroRegion` | Approx. bounds [S,W]→[N,E] |
|---|---|---|
| UK & Ireland | `uk` | [49.8, −11.0] → [60.9, 2.0] |
| Western Europe | `west-eu` | [43.0, −5.0] → [54.0, 10.0] |
| Southern Europe | `south-eu` | [36.0, −10.0] → [47.0, 28.0] |
| Northern Europe | `north-eu` | [54.0, 4.0] → [71.0, 31.0] |
| Eastern Europe | `east-eu` | [44.0, 12.0] → [56.0, 40.0] |
| All | — | fit everything |

Note: OS tiles cover GB only — switching to an EU preset should swap the base
layer to Stadia/CARTO automatically.

---

## 7. Data schema

One record per point. Coordinates are the main gap — geocode the seed list in a
batch (good first Claude Code job). Designed so I can keep adding by hand.

```json
{
  "id": "edinburgh-castle",
  "name": "Edinburgh Castle",
  "macroRegion": "uk",
  "region": "Edinburgh",
  "subregion": "Old Town",
  "country": "Scotland",
  "lat": 55.9486,
  "lng": -3.1999,
  "category": "heritage",
  "themes": ["castle"],
  "prominence": "standard",
  "blurb": "Gun at 1pm, Stone of Destiny, Crown Jewels, Scottish War Memorial.",
  "timeGated": true,
  "hours": "09:30–18:00 (seasonal — verify)",
  "officialUrl": "https://www.edinburghcastle.scot",
  "link": "",
  "image": "edinburgh-old-town.jpg",
  "source": "screenshot",
  "status": "want-to-see"
}
```

- `prominence`: `signature` | `standard`
- `status`: `want-to-see` | `maybe` | `done`
- `timeGated`: `true` for places with hours/tickets (castles, museums, houses,
  gardens, distillery tours) — the panel shows `hours` + `officialUrl`.
  `false` for always-open things (a bridge, a hill, open coast).
  **Gotchas:** Stonehenge *is* ticketed/timed; on Hadrian's Wall the wall is
  open but the forts (e.g. Housesteads) are ticketed.

**Registry / official-link sources** (for `officialUrl` + hours):
English Heritage, National Trust, Historic Environment Scotland, Cadw (Wales),
Manx National Heritage, plus individual museum/cathedral sites.

---

## 8. Side panel (desktop drawer / mobile sheet)

One responsive component:
- **Desktop:** right-hand drawer slides in on pin click.
- **Mobile:** bottom sheet with a drag handle; swipe down or tap backdrop to close.

Contents: thumbnail · name · region breadcrumb · category + theme chips · blurb ·
**coordinates (monospace, tap-to-copy)** · official link · hours (if `timeGated`)
· `// later:` **"distance from me"** via the browser Geolocation API + Haversine
to the pin (this is what makes it usable as a live website on the road).

---

## 9. Images — bundled (`/waypoints_images/`)

Since Claude Code struggles to source images, the images are pre-made and
shipped. Each is the **actual photo cropped out of its source screenshot**
(tweet/Facebook chrome removed), centered on a **transparent square PNG** so it
drops into any panel with no visible dead space regardless of the photo's
orientation. Kept at full crop resolution (square side ranges ~340–1080px) so no
detail is lost. **23 images covering 19 pins** (a few pins have two — `-1`/`-2`).
`manifest.json` maps `poi_id → image` (with `square_px`, `photo_w/h`). Wire pins
to images via that manifest rather than re-fetching anything.

Notes:
- Full-resolution untouched originals are kept in `/originals/` (same names) for
  archive / a future "view larger".
- These are personally collected reference images for a private, unpublished
  build — `kenna-power-stations.png` (Michael Kenna) is fine for that use; swap
  for a licensed image only if this ever goes public.
- A couple of crops carry a thin sliver of edge (e.g. the Ian Curtis book page
  is slightly tilted); harmless against a transparent background.

---

## 10. Seeded dataset (GB)

`[category · symbol]` per item; ★ = `signature`, ° = `standard`. (img) = thumbnail exists.

### SCOTLAND — Edinburgh (Old Town)
Edinburgh Castle ° `[Heritage·🏰]` · Mary King's Close ★ `[Heritage·🏰]` ·
Royal Mile/Cockburn St ° `[Heritage·🏰]` · Princes St & Gardens ° `[Heritage·🗿]` ·
Camera Obscura ★ `[Heritage·🗿]` · Scott Monument ★ `[Personal·📖]` ·
Royal Botanic Garden ★ `[Nature·⛰️]` · Heart of Midlothian ★ `[Heritage·🗿]` ·
Edinburgh Zoo ° `[Nature·🐾]` · Canongate Kirkyard (Scrooge grave) ★ `[Personal·📖]` (img)

### Edinburgh (New Town)
National Museum of Scotland / Lewis Chess Pieces ★ `[Personal·♟️]` (img) ·
St Giles' Cathedral ★ `[Heritage·⛪]` · Holyrood Palace & Abbey ° `[Heritage·🏰]` ·
Scottish National Gallery ★ `[Personal·🎨]` · Whisky cluster ★ `[Heritage·🍽️]` ·
Literary Walking Tour ★ `[Personal·📖]`

### Edinburgh (Outskirts)
Arthur's Seat ° `[Nature·⛰️]` · Calton Hill/National Monument ★ `[Heritage·🗿]` ·
Craigmillar Castle ★ `[Heritage·🏰]` · Royal Yacht Britannia ° `[Heritage·🌊]` ·
Scottish Parliament ★ `[Modern·✈️]` · Dean Village ★ `[Nature·⛰️]`

### West / Southwest Scotland
Isle of Skye (Fairy Glen, Sligachan) ★ `[Nature·🌊]` · St Conan's Kirk ★ `[Heritage·⛪]` ·
Dunure Castle ★ `[Heritage·🏰]` · Caerlaverock Castle ★ `[Heritage·🏰]` ·
Machir Bay (Islay) ★ `[Nature·🌊]` · Cove Harbour · Limekilns ★ `[Nature·🌊]`

### Central Scotland
National Wallace Monument ° `[Heritage·🗿]` · The Kelpies ★ `[Modern·🎨]` ·
Falkirk Wheel ★ `[Modern·✈️]` · Black Watch Castle/Museum ★ `[Heritage·🏰]` ·
Glasgow ° `[Heritage·🗿]` · Carlowrie Castle ★ `[Heritage·🏰]`

### Highlands / North & East
Loch Ness ° `[Nature·⛰️]` · Balintore Castle ★ `[Heritage·🏰]` (img) ·
Highland coos ★ `[Nature·🐾]` · Aberdeen ° `[Heritage·🗿]`

### NORTHERN ENGLAND
Hadrian's Wall ° `[Heritage·🗿]` (img) · Bamburgh Castle ° `[Heritage·🏰]` (img) ·
The Shambles, York ° `[Heritage·🏰]` (img) · Newcastle (Black Gate, Dog Leap Stairs) ★ `[Heritage·⛪]` ·
Lake District (Keswick, Scafell Pike) ° `[Nature·⛰️]`

### NORTHWEST ENGLAND — music cluster
Manchester Bridge (Joy Division footbridge, Cummins shoot) ★ `[Personal·🎵]` (img) ·
Haçienda site (demolished 2002 — pilgrimage) ★ `[Personal·🎵]` ·
Salford Lads Club (the Smiths) ★ `[Personal·🎵]` ·
Macclesfield — Ian Curtis house/mural/grave ★ `[Personal·🎵]` (img) ·
Liverpool ★ `[Personal·🎵]`

### MIDLANDS
Warwick Castle (the oubliette) ° `[Heritage·🏰]` ·
Worcestershire churches — Cradley, Colwall, Kempsey ★ `[Heritage·⛪]` (img)

### SOUTHWEST ENGLAND
Stonehenge ° `[Heritage·🗿]` (timeGated!) · Castle Combe / Cotswolds ★ `[Heritage·🏰]` (img) ·
King Alfred's Tower, Stourhead ★ `[Heritage·🗿]` (img) ·
Little Solsbury Hill, Bath (Peter Gabriel) ★ `[Personal·🎵]` (img)

### SOUTHEAST / SUSSEX & HOME COUNTIES
Crawley (Robert Smith / The Cure) ★ `[Personal·🎵]` (no img — NME link only) ·
Arundel Castle ° `[Heritage·🏰]` · Merstham phone-box graveyard ★ `[Modern·🎨]` (img) ·
Crooked House of Windsor (teahouse, 1592) ★ `[Heritage·🍽️]` · Oxfordshire ° `[Heritage·🗿]`

### LONDON
British Museum / Rosetta Stone ° `[Heritage·🗿]` (img) · Tate Britain / Turner ★ `[Personal·🎨]` (img) ·
Black Friar pub ★ `[Heritage·🍽️]` (img) · Camden ★ `[Personal·🎵]` · Greenwich / GMT ★ `[Modern·✈️]`

### WALES
Mach Loop, Machynlleth (RAF jet valley) ★ `[Modern·✈️]` · MOMA Machynlleth ★ `[Personal·🎨]` ·
St David's Head ponies, Pembrokeshire ★ `[Nature·🐾]` · Skomer (puffins) ★ `[Nature·🐾]` ·
Denbigh Asylum (urbex) ★ `[Modern·🏰]` (img)

### CROSS-BORDER
Isle of Man — Castle Rushen, Snaefell, Manx wallabies, steam railways ★ `[Heritage·🌊]` ·
Michael Kenna power stations — Chapelcross/Ratcliffe/Didcot (photo ref) ★ `[Personal·🎨]` (img, ©)

---

## 11. Food & Drink panel (Scotland)
Haggis/neeps/tatties · Cock-a-leekie · Cullen Skink · Cranachan · Clootie
Dumpling · Rumbledethumps · Arbroath Smokies · Stovies · Scotch pie · Full
Scottish breakfast · Grouse · Shortbread · Irn-Bru. Surface as a regional
sidebar when a pin's region is Scotland.

---

## 12. Approximate travel reference
Rough **road** distances/times between major hubs — verify before real planning;
Highland and Welsh roads run slower than the mileage implies.

| Leg | ~Miles | ~Drive |
|---|---|---|
| Edinburgh ↔ Glasgow | 47 | 1h |
| Edinburgh ↔ Loch Ness (Inverness) | 155 | 3h15 |
| Edinburgh ↔ Newcastle | 120 | 2h15 |
| Newcastle ↔ York | 85 | 1h30 |
| Edinburgh ↔ Lake District (Keswick) | 150 | 2h45 |
| Lake District ↔ Manchester | 100 | 2h |
| Manchester ↔ Liverpool | 35 | 0h45 |
| Manchester ↔ Macclesfield | 17 | 0h40 |
| Manchester ↔ York | 70 | 1h30 |
| Manchester ↔ Snowdonia / N. Wales | 80 | 2h |
| Manchester ↔ Machynlleth (Mach Loop) | 110 | 2h45 |
| Wales (Machynlleth) ↔ Cotswolds | 120 | 2h45 |
| Cotswolds / Bath ↔ Stonehenge | 40 | 1h |
| Bath ↔ London | 115 | 2h15 |
| London ↔ Sussex (Crawley / Arundel) | 30–55 | 1h–1h30 |
| Isle of Man | ferry from Liverpool/Heysham | ~2h45–3h45 sea |

Spine for scale: **Edinburgh → London ≈ 405 mi / ~7h** straight through.

---

## 13. Build order
1. Geocode the seed list → fill `lat`/`lng`.
2. Leaflet map + Thunderforest base + paper-grain overlay + map furniture.
3. JSON data loader (external file, mirrors the WCAG-auditor pattern).
4. Signature/standard `divIcon` markers + clustering.
5. Responsive side panel (drawer/sheet) + coordinates + official links/hours.
6. Region segmented control with `fitBounds` presets + base-layer swap.
7. Wire the 23 bundled thumbnails via `manifest.json`.
8. Legend-as-filter (category + theme toggles).
9. `// later:` geolocation "distance from me"; EU base layer + data.
