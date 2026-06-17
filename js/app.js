/* ============================================================================
 * WAYPOINTS — app
 * Vanilla Leaflet, no build step. Data comes from window.WAYPOINTS (data.js).
 * ========================================================================== */
(function () {
  'use strict';

  // Single source of truth: data.json in the repo. Edit it (or push to it) and
  // redeploy to add/change pins. Loaded over HTTP — run a local server for dev
  // (`python3 -m http.server`); opening index.html via file:// will not fetch.
  fetch('data.json')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (err) {
      console.error('Waypoints: could not load data.json —', err);
      var m = document.getElementById('map');
      if (m) m.innerHTML = '<div style="padding:48px;max-width:520px;margin:60px auto;' +
        'font-family:Georgia,serif;color:#3A3226;line-height:1.5">' +
        '<strong>Could not load data.json.</strong><br>If you opened this file directly, ' +
        'run a local server (<code>python3 -m http.server</code>) and reload — ' +
        'browsers block fetch() over file://.</div>';
    });

  function init(RAW) {

  /* ----------------------------------------------------------------------- *
   * TILE PROVIDERS
   * Keyless CARTO Voyager now. When the Thunderforest key lands, paste it
   * into THUNDERFOREST_KEY below — GB then swaps to OS-style Outdoors tiles
   * automatically. STADIA_KEY does the same for the EU presets later.
   * ----------------------------------------------------------------------- */
  const THUNDERFOREST_KEY = '';   // ← paste key here (one-line swap to OS look)
  const STADIA_KEY        = '';   // ← optional, for the EU layer (Stamen Terrain)

  const TILES = {
    // Keyless default: Esri World Topographic — English labels everywhere
    // (incl. seas/oceans), terrain/relief, touring-map feel.
    esriTopo: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      opts: { maxZoom: 19,
        attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, USGS, NOAA, and the GIS community' }
    },
    // Alternative keyless base (labels in local language): CARTO Voyager.
    cartoVoyager: {
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      opts: { subdomains: 'abcd', maxZoom: 20,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' }
    },
    thunderforestOutdoors: {
      url: 'https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=' + THUNDERFOREST_KEY,
      opts: { subdomains: 'abc', maxZoom: 22,
        attribution: 'Maps &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, Data &copy; OpenStreetMap contributors' }
    },
    stadiaTerrain: {
      url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png' + (STADIA_KEY ? '?api_key=' + STADIA_KEY : ''),
      opts: { maxZoom: 18,
        attribution: '&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; Stamen, OpenStreetMap' }
    }
  };

  function makeLayer(key) {
    const t = TILES[key];
    return L.tileLayer(t.url, t.opts);
  }
  // OS-style tiles for GB if a key exists; Stadia for EU if a key exists; else CARTO.
  function baseLayerFor(macroRegion) {
    if (macroRegion === 'uk' && THUNDERFOREST_KEY) return makeLayer('thunderforestOutdoors');
    if (macroRegion && macroRegion !== 'uk' && STADIA_KEY) return makeLayer('stadiaTerrain');
    return makeLayer('esriTopo');
  }

  /* ----------------------------------------------------------------------- *
   * CATEGORIES, THEMES, REGIONS
   * ----------------------------------------------------------------------- */
  const CATEGORIES = {
    personal: { label: 'Personal', color: '#B23A6E' },
    heritage: { label: 'Heritage', color: '#B07A2B' },
    modern:   { label: 'Modern',   color: '#2E7D8A' },
    nature:   { label: 'Nature',   color: '#5A7D4F' }
  };

  // Inked, single-colour SVG glyphs (fill = currentColor / cream on discs).
  const G = {
    music:      '<svg viewBox="0 0 24 24"><path d="M9 17.5a3 3 0 1 1-2-2.83V5l10-2v2.6L9 7.4z"/></svg>',
    art:        '<svg viewBox="0 0 24 24"><path d="M12 3a9 8 0 0 0 0 16 2 2 0 0 0 2-2 2 2 0 0 1 2-2h2a3 3 0 0 0 3-3c0-4.5-4.5-7-9-7zM6.5 12a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm3-3.6a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm5 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/></svg>',
    literary:   '<svg viewBox="0 0 24 24"><path d="M11 5C9 3.7 5.5 3.5 3 4.3V19c2.5-.8 6-.6 8 .9V5zm2 0v14.9c2-1.5 5.5-1.7 8-.9V4.3c-2.5-.8-6-.6-8 .7z"/></svg>',
    chess:      '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-2 5.2C9 9 8.6 10 9.1 11h5.8c.5-1 .1-2-.9-2.8A3 3 0 0 0 12 3zM8.6 12l-1 5.5h8.8l-1-5.5zM6 18.5h12V21H6z"/></svg>',
    castle:     '<svg viewBox="0 0 24 24"><path d="M4 21v-9l2 1.2V8h2v2.2h2V8h2v2.2h2V8h2v5.2L22 12v9z"/></svg>',
    cathedral:  '<svg viewBox="0 0 24 24"><path d="M11 2h2v3h2v2h-2v3h-2V7H9V5h2zM5 22V11l7-3 7 3v11h-5v-5h-4v5z"/></svg>',
    monument:   '<svg viewBox="0 0 24 24"><path d="M6 21V7q0-2.2 2-2.2T10 7v14zM14 21V7q0-2.2 2-2.2T18 7v14zM9 7h6v3H9zM3 21h18v2H3z"/></svg>',
    industrial: '<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.4a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.4V18l-2 1.4V21l3.5-1 3.5 1v-1.6L13 18v-4.4z"/></svg>',
    coast:      '<svg viewBox="0 0 24 24"><path d="M2 14c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2v3c-2 0-2 2-4 2s-2-2-4-2-2 2-4 2-2-2-4-2-2 2-4 2zm0-6c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2v3c-2 0-2 2-4 2s-2-2-4-2-2 2-4 2-2-2-4-2-2 2-4 2z"/></svg>',
    mountain:   '<svg viewBox="0 0 24 24"><path d="M2 20 8.5 7l4 7 3-4L22 20z"/></svg>',
    wildlife:   '<svg viewBox="0 0 24 24"><path d="M12 13.5c-2.6 0-4.6 2.1-4.6 4.2 0 1.6 1.6 2.1 4.6 2.1s4.6-.5 4.6-2.1c0-2.1-2-4.2-4.6-4.2z"/><circle cx="6.4" cy="10.6" r="1.9"/><circle cx="17.6" cy="10.6" r="1.9"/><circle cx="9.4" cy="7.2" r="1.9"/><circle cx="14.6" cy="7.2" r="1.9"/></svg>',
    food:       '<svg viewBox="0 0 24 24"><path d="M7 2v7a2 2 0 0 0 1 1.7V22h2V10.7A2 2 0 0 0 11 9V2H9.6v5.5h-.8V2H8v5.5H7.2V2zm9 0c-1.7 0-2.8 2.6-2.8 5.6 0 2 .8 3.3 1.8 3.8V22h2V2z"/></svg>'
  };

  const THEMES = {
    music:      { label: 'Music',              glyph: G.music },
    art:        { label: 'Art',                glyph: G.art },
    literary:   { label: 'Literary',           glyph: G.literary },
    chess:      { label: 'Chess',              glyph: G.chess },
    castle:     { label: 'Castle',             glyph: G.castle },
    cathedral:  { label: 'Cathedral / kirk',   glyph: G.cathedral },
    monument:   { label: 'Monument / stones',  glyph: G.monument },
    industrial: { label: 'Modern / aviation',  glyph: G.industrial },
    coast:      { label: 'Coast / island',     glyph: G.coast },
    mountain:   { label: 'Mountain / fell',    glyph: G.mountain },
    wildlife:   { label: 'Wildlife',           glyph: G.wildlife },
    food:       { label: 'Food & drink',       glyph: G.food }
  };

  // Flag strip, west → east. Target countries (full colour); other countries
  // that have pins show as ghosted flags (dimmed, still clickable). REGIONS is
  // assembled once DATA is known (active + ghosts) — see below.
  const ACTIVE_FLAGS = [
    { id: 'ie', flag: 'ie.svg', label: 'Ireland', bounds: [[51.3, -10.8], [55.5, -5.3]], match: p => p.country === 'Ireland' },
    { id: 'uk', flag: 'gb.svg', label: 'United Kingdom', bounds: [[49.5, -7.6], [58.9, 1.9]], match: p => p.macroRegion === 'uk' && p.country !== 'Ireland' },
    { id: 'fr', flag: 'fr.svg', label: 'France', bounds: [[42.3, -4.8], [51.1, 8.3]], match: p => p.country === 'France' },
    { id: 'be', flag: 'be.svg', label: 'Belgium', bounds: [[49.5, 2.5], [51.5, 6.4]], match: p => p.country === 'Belgium' },
    { id: 'nl', flag: 'nl.svg', label: 'Netherlands', bounds: [[50.7, 3.3], [53.6, 7.2]], match: p => p.country === 'Netherlands' },
    { id: 'lu', flag: 'lu.svg', label: 'Luxembourg', bounds: [[49.4, 5.7], [50.2, 6.5]], match: p => p.country === 'Luxembourg' },
    { id: 'ch', flag: 'ch.svg', label: 'Switzerland', bounds: [[45.8, 5.9], [47.8, 10.5]], match: p => p.country === 'Switzerland' },
    { id: 'de', flag: 'de.svg', label: 'Germany', bounds: [[47.2, 5.9], [55.1, 15.0]], match: p => p.country === 'Germany' },
    { id: 'it', flag: 'it.svg', label: 'Italy', bounds: [[36.6, 6.6], [47.1, 18.5]], match: p => p.country === 'Italy' }
  ];
  const COVERED = new Set(['Ireland', 'Scotland', 'England', 'Wales', 'Isle of Man', 'United Kingdom',
    'France', 'Belgium', 'Netherlands', 'Luxembourg', 'Switzerland', 'Germany', 'Italy', '']);
  const GHOST_META = {
    'Spain': { flag: 'es.svg', bounds: [[36.0, -9.5], [43.8, 3.4]] },
    'Portugal': { flag: 'pt.svg', bounds: [[36.9, -9.6], [42.2, -6.1]] },
    'Morocco': { flag: 'ma.svg', bounds: [[27.6, -13.2], [35.9, -1.0]] },
    'Czech Republic': { flag: 'cz.svg', bounds: [[48.5, 12.0], [51.1, 18.9]] }
  };

  const SCOTLAND_FOOD = ['Haggis, neeps & tatties', 'Cock-a-leekie', 'Cullen skink', 'Cranachan',
    'Clootie dumpling', 'Rumbledethumps', 'Arbroath smokies', 'Stovies', 'Scotch pie',
    'Full Scottish breakfast', 'Grouse', 'Shortbread', 'Irn-Bru'];

  const DATA = (RAW || []).filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');

  // Ghost flags: any country with pins that isn't a target gets a dimmed,
  // still-clickable flag at the end of the strip.
  const ghostGroups = {};
  DATA.forEach(p => { const c = p.country; if (c && !COVERED.has(c)) (ghostGroups[c] = ghostGroups[c] || []).push(p); });
  const GHOST_FLAGS = Object.keys(ghostGroups).map(c => {
    const meta = GHOST_META[c];
    let bounds = meta && meta.bounds;
    if (!bounds) {
      const ps = ghostGroups[c], la = ps.map(p => p.lat), ln = ps.map(p => p.lng), pad = 0.6;
      bounds = [[Math.min(...la) - pad, Math.min(...ln) - pad], [Math.max(...la) + pad, Math.max(...ln) + pad]];
    }
    return { id: 'ghost-' + c.toLowerCase().replace(/[^a-z]+/g, '-'), flag: meta && meta.flag, label: c, bounds, ghost: true, match: p => p.country === c };
  });
  const REGIONS = ACTIVE_FLAGS.concat(GHOST_FLAGS);

  /* ----------------------------------------------------------------------- *
   * MAP
   * ----------------------------------------------------------------------- */
  const map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 4 })
    .setView([54.5, -3.5], 6);

  let baseLayer = baseLayerFor('uk').addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ position: 'bottomright', imperial: true, metric: true, maxWidth: 140 }).addTo(map);

  // Compass rose (map furniture)
  const compass = document.createElement('div');
  compass.className = 'compass';
  compass.setAttribute('aria-hidden', 'true');
  compass.innerHTML =
    '<svg viewBox="0 0 100 100"><g fill="none" stroke="#3A3226" stroke-width="1.4">' +
    '<circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="24" stroke-width="0.6"/></g>' +
    '<path d="M50 16 L56 50 L50 46 L44 50 Z" fill="#B23A6E"/>' +
    '<path d="M50 84 L44 50 L50 54 L56 50 Z" fill="#3A3226"/>' +
    '<path d="M16 50 L50 44 L46 50 L50 56 Z" fill="#3A3226" opacity="0.5"/>' +
    '<path d="M84 50 L50 56 L54 50 L50 44 Z" fill="#3A3226" opacity="0.5"/>' +
    '<text x="50" y="13" text-anchor="middle" font-family="Spectral,serif" font-size="12" fill="#3A3226">N</text>' +
    '</svg>';
  document.body.appendChild(compass);

  /* ----------------------------------------------------------------------- *
   * MARKERS
   * ----------------------------------------------------------------------- */
  function markerIcon(poi) {
    const color = (CATEGORIES[poi.category] || {}).color || '#666';
    const glyph = THEMES[poi.themes && poi.themes[0]] ? THEMES[poi.themes[0]].glyph : '';
    // All pins render the same (no signature/standard hierarchy).
    return L.divIcon({
      className: '',
      html: '<div class="wp-marker wp-marker--signature wp-marker--' + poi.status + '">' +
            '<div class="wp-marker__disc" style="background:' + color + '">' + glyph + '</div></div>',
      iconSize: [30, 30], iconAnchor: [15, 15]
    });
  }

  const cluster = L.markerClusterGroup({
    maxClusterRadius: 46,
    disableClusteringAtZoom: 10,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: function (c) {
      const n = c.getChildCount();
      const size = n < 10 ? 34 : n < 30 ? 42 : 50;
      return L.divIcon({
        className: '',
        html: '<div class="wp-cluster" style="width:' + size + 'px;height:' + size + 'px"><div>' + n + '</div></div>',
        iconSize: [size, size]
      });
    }
  });

  // Build all markers once; keep refs for filtering.
  const ENTRIES = DATA.map(poi => {
    const m = L.marker([poi.lat, poi.lng], { icon: markerIcon(poi), title: poi.name, riseOnHover: true });
    m.on('click', () => openPanel(poi));
    return { poi, marker: m };
  });

  /* ----------------------------------------------------------------------- *
   * FILTERS  (legend toggles + region macro filter)
   * ----------------------------------------------------------------------- */
  const activeCats   = new Set(Object.keys(CATEGORIES));
  const presentThemes = Array.from(new Set(DATA.flatMap(p => p.themes || [])))
    .filter(t => THEMES[t])
    .sort((a, b) => Object.keys(THEMES).indexOf(a) - Object.keys(THEMES).indexOf(b));
  const activeThemes = new Set(presentThemes);
  let activeRegion = REGIONS.find(r => r.id === 'uk') || REGIONS[0]; // UK by default

  function passes(poi) {
    if (!activeCats.has(poi.category)) return false;
    if (!activeRegion.match(poi)) return false;
    const themes = poi.themes && poi.themes.length ? poi.themes : [];
    if (themes.length && !themes.some(t => activeThemes.has(t))) return false;
    return true;
  }

  function applyFilters() {
    cluster.clearLayers();
    const visible = ENTRIES.filter(e => passes(e.poi)).map(e => e.marker);
    cluster.addLayers(visible);
  }

  map.addLayer(cluster);
  applyFilters();

  /* ----------------------------------------------------------------------- *
   * REGION SEGMENTED CONTROL
   * ----------------------------------------------------------------------- */
  const regionEl = document.getElementById('region-control');
  const rcActive = document.createElement('div'); rcActive.className = 'rc-active';
  const rcGhosts = document.createElement('div'); rcGhosts.className = 'rc-ghosts';
  function makeFlagBtn(r) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = r.flag
      ? '<img src="images/' + r.flag + '" alt="' + r.label + '">'
      : '<span class="rc-mono">' + r.label.slice(0, 2).toUpperCase() + '</span>';
    btn.dataset.id = r.id;
    btn.title = r.label + (r.ghost ? ' (not a target area yet)' : '');
    btn.setAttribute('aria-label', r.label);
    if (r.ghost) btn.classList.add('is-ghost');
    if (r.id === 'uk') btn.classList.add('is-active');
    btn.addEventListener('click', () => selectRegion(r, btn));
    return btn;
  }
  REGIONS.forEach(r => (r.ghost ? rcGhosts : rcActive).appendChild(makeFlagBtn(r)));
  regionEl.appendChild(rcActive);
  if (rcGhosts.children.length) {
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'rc-toggle';
    toggle.setAttribute('aria-label', 'Show other countries');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="rc-arrow">›</span>';
    toggle.addEventListener('click', () => {
      const open = regionEl.classList.toggle('ghosts-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    regionEl.appendChild(toggle);
    regionEl.appendChild(rcGhosts);
  }

  function selectRegion(r, btn) {
    regionEl.querySelectorAll('button').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');

    // Swap base layer if this region wants a different tile provider.
    const next = baseLayerFor((r.id === 'ie' || r.id === 'uk') ? 'uk' : 'eu');
    if (next.options.attribution !== baseLayer.options.attribution) {
      map.removeLayer(baseLayer);
      baseLayer = next.addTo(map);
      baseLayer.bringToBack();
    }

    activeRegion = r;                 // segmented control doubles as a coarse filter
    applyFilters();
    // Fit the bounds, then optionally zoom one whole level tighter (zoomBump).
    const b = L.latLngBounds(r.bounds);
    let z = map.getBoundsZoom(b, false, L.point(20, 20));
    if (r.zoomBump) z += r.zoomBump;
    map.setView(b.getCenter(), z, { animate: true });
  }

  /* ----------------------------------------------------------------------- *
   * LEGEND  (key + filter)
   * ----------------------------------------------------------------------- */
  const legendEl = document.getElementById('legend');
  legendEl.innerHTML = '<h2 class="legend__title">Key</h2>';

  // A group = items column on the left + a rotated heading down the right edge.
  function legendGroup(headingText) {
    const group = document.createElement('div');
    group.className = 'legend__group';
    const items = document.createElement('div');
    items.className = 'legend__items';
    const heading = document.createElement('div');
    heading.className = 'legend__heading';
    heading.textContent = headingText;
    group.appendChild(items);
    group.appendChild(heading);
    legendEl.appendChild(group);
    return items;
  }

  // Categories
  const catItems = legendGroup('Category');
  Object.entries(CATEGORIES).forEach(([key, c]) => {
    const item = document.createElement('button');
    item.className = 'legend__item';
    item.innerHTML = '<span class="legend__swatch" style="background:' + c.color + '"></span>' + c.label;
    item.addEventListener('click', () => {
      toggle(activeCats, key); item.classList.toggle('is-off'); applyFilters();
    });
    catItems.appendChild(item);
  });

  // Themes
  const themeItems = legendGroup('Theme');
  presentThemes.forEach(key => {
    const t = THEMES[key];
    const item = document.createElement('button');
    item.className = 'legend__item';
    item.innerHTML = '<span class="legend__glyph">' + t.glyph + '</span>' + t.label;
    item.addEventListener('click', () => {
      toggle(activeThemes, key); item.classList.toggle('is-off'); applyFilters();
    });
    themeItems.appendChild(item);
  });

  function toggle(set, key) { set.has(key) ? set.delete(key) : set.add(key); }

  /* ----------------------------------------------------------------------- *
   * SIDE PANEL
   * ----------------------------------------------------------------------- */
  const panel    = document.getElementById('panel');
  const panelBody = document.getElementById('panel-body');
  const backdrop = document.getElementById('panel-backdrop');
  document.getElementById('panel-close').addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function openPanel(poi) {
    const cat = CATEGORIES[poi.category] || { label: poi.category, color: '#666' };
    const crumb = [poi.country, poi.region, poi.subregion].filter(Boolean).map(esc).join(' &middot; ');

    // thumbnails
    let thumbs = '';
    const imgs = poi.images || [];
    if (poi._previewSrc) {
      thumbs = '<img class="p-thumb" src="' + poi._previewSrc + '" alt="' + esc(poi.name) + '" loading="lazy">';
    } else if (imgs.length === 1) {
      thumbs = '<img class="p-thumb" src="images/' + esc(imgs[0]) + '" alt="' + esc(poi.name) + '" loading="lazy">';
    } else if (imgs.length > 1) {
      thumbs = '<div class="p-thumb-strip">' + imgs.map(f =>
        '<img class="p-thumb" src="images/' + esc(f) + '" alt="' + esc(poi.name) + '" loading="lazy">').join('') + '</div>';
    }

    // chips
    const catChip = '<span class="p-chip p-chip--cat" style="background:' + cat.color + '">' + esc(cat.label) + '</span>';
    const themeChips = (poi.themes || []).map(t => {
      const th = THEMES[t]; if (!th) return '';
      return '<span class="p-chip" style="color:' + cat.color + '">' + th.glyph + esc(th.label) + '</span>';
    }).join('');

    const statusLabel = { 'want-to-see': 'Want to see', maybe: 'Maybe', done: 'Done' }[poi.status] || poi.status;

    // rows
    let rows = '';
    const coordStr = poi.lat.toFixed(4) + ', ' + poi.lng.toFixed(4);
    rows += '<div class="p-row"><span class="p-row__label">Coords</span>' +
            '<span class="p-coords" data-coords="' + coordStr + '" title="Tap to copy">' + coordStr +
            (poi.approx ? ' <span style="color:var(--ink-soft)">~approx</span>' : '') + '</span></div>';
    if (poi.timeGated && poi.hours) {
      rows += '<div class="p-row"><span class="p-row__label">Hours</span><span>' + esc(poi.hours) + '</span></div>';
    }
    if (poi.officialUrl) {
      rows += '<div class="p-row"><span class="p-row__label">Official</span>' +
              '<a class="p-link" href="' + esc(poi.officialUrl) + '" target="_blank" rel="noopener">Tickets &amp; hours &rarr;</a></div>';
    }
    if (poi.link) {
      rows += '<div class="p-row"><span class="p-row__label">More</span>' +
              '<a class="p-link" href="' + esc(poi.link) + '" target="_blank" rel="noopener">Reference &rarr;</a></div>';
    }

    // flags
    let flags = '';
    if (/^kenna-/.test(poi.id) || /Kenna/.test(poi.name)) {
      flags += '<p class="p-flag">&copy; Michael Kenna (living artist) — replace this image before any public publish.</p>';
    }
    if (poi.approx) {
      flags += '<p class="p-flag">Coordinates are approximate (region-level or multi-site) — nudge in data.js.</p>';
    }

    // food sidebar for Scotland
    let food = '';
    if (poi.country === 'Scotland') {
      food = '<div class="p-food"><p class="p-food__title">Eat nearby — Scotland</p>' +
             '<p class="p-food__list">' + SCOTLAND_FOOD.map(esc).join(' &middot; ') + '</p></div>';
    }

    // nested relationships (children clustered at this pin, or its parent)
    const kids = ENTRIES.filter(e => e.poi.parent === poi.id);
    const parentEntry = poi.parent ? ENTRIES.find(e => e.poi.id === poi.parent) : null;
    let nest = '';
    if (parentEntry) nest += '<p class="p-partof"><span class="p-row__label">Part of</span> ' +
      '<a href="#" class="p-link p-nav" data-id="' + esc(parentEntry.poi.id) + '">' + esc(parentEntry.poi.name) + ' &uarr;</a></p>';
    if (kids.length) nest += '<div class="p-inside"><p class="p-inside__title">Inside (' + kids.length + ')</p>' +
      kids.map(k => '<a href="#" class="p-inside__item p-nav" data-id="' + esc(k.poi.id) + '">' +
        ((k.poi.images && k.poi.images.length) ? '<img src="images/' + esc(k.poi.images[0]) + '" alt="">'
          : '<span class="p-inside__dot" style="background:' + ((CATEGORIES[k.poi.category] || {}).color || '#888') + '"></span>') +
        '<span>' + esc(k.poi.name) + '</span></a>').join('') + '</div>';

    panelBody.innerHTML =
      thumbs +
      '<div class="p-pad">' +
        '<p class="p-breadcrumb">' + crumb + '</p>' +
        '<h2 class="p-name">' + esc(poi.name) + '</h2>' +
        '<div class="p-chips">' + catChip + themeChips +
          '<span class="p-status">' + esc(statusLabel) + '</span></div>' +
        (poi.blurb ? '<p class="p-blurb">' + esc(poi.blurb) + '</p>' : '') +
        rows + nest +
      '</div>' +
      flags + food +
      '<button class="p-dup" type="button" title="Remove this pin">&#9873; Flag as duplicate</button>';

    // tap-to-copy coordinates
    const cEl = panelBody.querySelector('.p-coords');
    if (cEl) cEl.addEventListener('click', () => {
      const txt = cEl.dataset.coords;
      navigator.clipboard && navigator.clipboard.writeText(txt).then(() => {
        cEl.classList.add('copied');
        const orig = cEl.firstChild;
        setTimeout(() => cEl.classList.remove('copied'), 1100);
      });
    });

    // navigate to a nested child / parent
    panelBody.querySelectorAll('.p-nav').forEach(a => a.addEventListener('click', ev => {
      ev.preventDefault();
      const t = ENTRIES.find(e => e.poi.id === a.dataset.id);
      if (t) { map.setView([t.poi.lat, t.poi.lng], Math.max(map.getZoom(), 14), { animate: true }); openPanel(t.poi); }
    }));

    // flag-as-duplicate → remove this pin (no review; uses the saved access key)
    const dupBtn = panelBody.querySelector('.p-dup');
    if (dupBtn) dupBtn.addEventListener('click', () => deletePin(poi));

    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('is-open'));
    panel.scrollTop = 0;
    panel.focus();
    map.panTo([poi.lat, poi.lng], { animate: true });
  }

  function closePanel() {
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    backdrop.classList.remove('is-open');
    setTimeout(() => { backdrop.hidden = true; }, 320);
  }

  function getStoredKey() { try { return localStorage.getItem('wp_addkey') || ''; } catch (e) { return ''; } }
  function saveStoredKey(k) { try { if (k) localStorage.setItem('wp_addkey', k); } catch (e) {} }
  let _toastEl;
  function toast(msg, isErr) {
    if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.className = 'aw-toast'; document.body.appendChild(_toastEl); }
    _toastEl.textContent = msg; _toastEl.classList.toggle('is-error', !!isErr); _toastEl.classList.add('show');
    clearTimeout(_toastEl._t); _toastEl._t = setTimeout(() => _toastEl.classList.remove('show'), isErr ? 5000 : 3000);
  }
  async function deletePin(poi) {
    let key = getStoredKey();
    if (!key) { key = (window.prompt('Access key to remove this pin:') || '').trim(); if (key) saveStoredKey(key); }
    if (!key) return;
    toast('Removing…');
    try {
      const res = await fetch('/api/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', password: key, id: poi.id })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      const idx = ENTRIES.findIndex(e => e.poi.id === poi.id);
      if (idx !== -1) { cluster.removeLayer(ENTRIES[idx].marker); ENTRIES.splice(idx, 1); }
      closePanel();
      toast('Removed “' + poi.name + '”');
    } catch (err) { toast('Remove failed: ' + (err.message || err), true); }
  }

  // Expose a hook so the add-flow (add.js) can drop a newly-created pin live,
  // without waiting for the data.json redeploy.
  window.Waypoints = {
    categories: CATEGORIES,
    themes: THEMES,
    listPins: () => ENTRIES.map(e => ({ id: e.poi.id, name: e.poi.name })),
    addLive: function (rec, previewSrc) {
      try {
        if (!rec || typeof rec.lat !== 'number' || typeof rec.lng !== 'number') return;
        if (previewSrc) rec._previewSrc = previewSrc; // show the just-uploaded image before redeploy
        // Switch to the segment that contains this pin so it isn't filtered out.
        const region = REGIONS.find(r => r.match(rec));
        if (region && region !== activeRegion) {
          activeRegion = region;
          regionEl.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.id === region.id));
        }
        const m = L.marker([rec.lat, rec.lng], { icon: markerIcon(rec), title: rec.name, riseOnHover: true });
        m.on('click', () => openPanel(rec));
        ENTRIES.push({ poi: rec, marker: m });
        applyFilters();                        // rebuild cluster incl. the new pin
        map.setView([rec.lat, rec.lng], Math.max(map.getZoom(), 11), { animate: true });
        openPanel(rec);
      } catch (e) { console.error('addLive failed', e); }
    }
  };

  // Fit to the default region (UK & Ireland) on load.
  const startFG = L.featureGroup(ENTRIES.filter(e => passes(e.poi)).map(e => e.marker));
  if (startFG.getLayers().length) map.fitBounds(startFG.getBounds(), { padding: [40, 40] });

  } // end init(RAW)

})();
