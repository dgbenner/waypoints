/* ============================================================================
 * WAYPOINTS — shared helpers for the /api functions (draft, scout).
 * Leading underscore keeps Vercel from serving this file as a route.
 * ========================================================================== */

// GitHub Contents API client for the repo this deployment commits to.
function github() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const repo = process.env.GITHUB_REPO || 'dgbenner/waypoints';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const base = 'https://api.github.com/repos/' + repo + '/contents/';
  const gh = (path, opts = {}) => fetch(base + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'Waypoints' }, opts.headers || {})
  }));
  return { gh, branch };
}

// Append one JSON line to a .jsonl file in the repo (creates it if missing).
async function appendJsonl(file, entry, message) {
  const { gh, branch } = github();
  let existing = '', sha;
  const cur = await gh(file + '?ref=' + branch);
  if (cur.ok) { const j = await cur.json(); sha = j.sha; existing = Buffer.from(j.content, 'base64').toString('utf8'); }
  const putBody = { message, content: Buffer.from(existing + JSON.stringify(entry) + '\n').toString('base64'), branch };
  if (sha) putBody.sha = sha;
  const put = await gh(file, { method: 'PUT', body: JSON.stringify(putBody) });
  if (!put.ok) throw new Error('Save to ' + file + ' failed (' + put.status + ')');
}

// Read a .jsonl file from the repo (live, not the deployed copy). [] if missing.
async function readJsonl(file) {
  const { gh, branch } = github();
  const cur = await gh(file + '?ref=' + branch);
  if (cur.status === 404) return [];
  if (!cur.ok) throw new Error('Could not read ' + file + ' (' + cur.status + ')');
  const j = await cur.json();
  return Buffer.from(j.content, 'base64').toString('utf8').split('\n')
    .filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

// Wikipedia lead image for a place name (keyless). Returns a rendered raster
// thumbnail URL, or '' if the page has none.
async function wikiImage(query) {
  if (!query) return '';
  try {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1' +
      '&prop=pageimages&piprop=thumbnail&pithumbsize=640&titles=' + encodeURIComponent(query);
    const r = await fetch(url, { headers: { 'User-Agent': 'Waypoints/1.0 (personal map)' } });
    const j = await r.json();
    const pages = j && j.query && j.query.pages;
    if (pages) for (const k in pages) {
      const p = pages[k];
      if (p && p.thumbnail && p.thumbnail.source) return p.thumbnail.source;
    }
  } catch (e) { /* best-effort */ }
  return '';
}

// Wikipedia full-text search → lead image of the top result (keyless).
async function wikiSearch(q) {
  if (!q) return '';
  try {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json' +
      '&generator=search&gsrlimit=1&gsrsearch=' + encodeURIComponent(q) +
      '&prop=pageimages&piprop=thumbnail&pithumbsize=640';
    const r = await fetch(url, { headers: { 'User-Agent': 'Waypoints/1.0 (personal map)' } });
    const j = await r.json();
    const pages = j && j.query && j.query.pages;
    if (pages) for (const k in pages) {
      const p = pages[k];
      if (p && p.thumbnail && p.thumbnail.source) return p.thumbnail.source;
    }
  } catch (e) { /* best-effort */ }
  return '';
}

// Robust image finder: try title variants, then a search fallback. The user
// reviews the result in the preview, so an approximate hit is fine.
function titleCandidates(name) {
  const base = String(name || '').replace(/\s*\([^)]*\)/g, '').trim();
  const out = [];
  const add = s => { s = (s || '').trim(); if (s.length > 2 && !out.includes(s)) out.push(s); };
  if (base.includes(' — ')) { const [a, b] = base.split(' — '); add(b); add(a); }
  add(base.split(' / ')[0]);
  add(base);
  out.slice().forEach(c => { if (c.includes(',')) add(c.split(',')[0]); });
  return out;
}
// Wikimedia Commons file search → top image (keyless). The broadest source:
// has photos for graves, statues, small towns, etc. that lack a Wikipedia page.
async function wikiCommons(query) {
  if (!query) return '';
  try {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json' +
      '&generator=search&gsrnamespace=6&gsrlimit=1&gsrsearch=' + encodeURIComponent(query) +
      '&prop=imageinfo&iiprop=url&iiurlwidth=720';
    const r = await fetch(url, { headers: { 'User-Agent': 'Waypoints/1.0 (personal map)' } });
    const j = await r.json();
    const pages = j && j.query && j.query.pages;
    if (pages) for (const k in pages) {
      const p = pages[k];
      if (p && p.imageinfo && p.imageinfo[0] && p.imageinfo[0].thumburl) return p.imageinfo[0].thumburl;
    }
  } catch (e) { /* best-effort */ }
  return '';
}

async function findImage(name, region, country) {
  const ctx = region ? ' ' + region : country ? ' ' + country : '';
  const tryWiki = async () => {
    for (const c of titleCandidates(name)) { const img = await wikiImage(c); if (img) return img; }
    return await wikiSearch(name + ctx);
  };
  const tryCommons = async () => (await wikiCommons(name + ctx)) || (await wikiCommons(name));
  // For specific objects, Commons (an actual photo of the thing) beats the
  // Wikipedia article image (often a portrait or generic city shot).
  const specific = /grave|tomb|cemeter|statue|sculptur|memorial|mural|relic|colossus|fountain|obelisk/i.test(name);
  if (specific) return (await tryCommons()) || (await tryWiki());
  return (await tryWiki()) || (await tryCommons());
}

async function geocode(q) {
  if (!q) return null;
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&accept-language=en&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': 'Waypoints/1.0 (personal map)' } });
    const j = await r.json();
    if (j && j[0] && j[0].lat) {
      const a = j[0].address || {};
      return {
        lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), display_name: j[0].display_name || '',
        locality: a.city || a.town || a.village || a.hamlet || a.suburb || a.municipality || a.county || '',
        country: a.country || ''
      };
    }
  } catch (e) { /* fall back to model estimate */ }
  return null;
}

// Name a map view: Nominatim reverse at a detail level matched to the map zoom.
async function reverseGeocode(lat, lng, mapZoom) {
  const z = mapZoom <= 6 ? 3 : mapZoom <= 8 ? 5 : mapZoom <= 10 ? 8 : mapZoom <= 12 ? 10 : 14;
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&accept-language=en&zoom=' + z +
      '&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng), { headers: { 'User-Agent': 'Waypoints/1.0 (personal map)' } });
    const j = await r.json();
    const a = (j && j.address) || {};
    const name = z <= 3 ? a.country
      : z <= 5 ? (a.state || a.region || a.country)
      : z <= 8 ? (a.county || a.state_district || a.city || a.state)
      : z <= 10 ? (a.city || a.town || a.village || a.county)
      : (a.suburb || a.city_district || a.neighbourhood || a.city || a.town || a.village);
    return { name: name || a.country || '', country: a.country || '' };
  } catch (e) { return { name: '', country: '' }; }
}

module.exports = { github, appendJsonl, readJsonl, readBody, findImage, geocode, reverseGeocode };
