/* ============================================================================
 * WAYPOINTS — /api/draft  (Vercel serverless, Node)
 *
 * POST { action:'draft'|'commit', password, ... }
 *  - draft: turns an image / link / text into a Waypoints record (Claude),
 *           geocodes it (Nominatim), returns { record, suggestedImageUrl }.
 *  - commit: appends the record (and image) to data.json in the GitHub repo
 *           via the Contents API, so it persists and redeploys.
 *
 * Env vars (set in Vercel):
 *   ANTHROPIC_API_KEY    – required for drafting
 *   GITHUB_TOKEN         – fine-grained PAT, Contents: read+write on the repo
 *   WAYPOINTS_ADD_SECRET – the access key the modal must send (recommended)
 *   GITHUB_REPO          – optional, default 'dgbenner/waypoints'
 *   GITHUB_BRANCH        – optional, default 'main'
 * ========================================================================== */
const Anthropic = require('@anthropic-ai/sdk');

const CATS = ['personal', 'heritage', 'modern', 'nature'];
const THEMES = ['music', 'art', 'literary', 'chess', 'castle', 'cathedral',
  'monument', 'industrial', 'coast', 'mountain', 'wildlife', 'food'];
const UK = new Set(['united kingdom', 'uk', 'great britain', 'britain', 'scotland',
  'england', 'wales', 'northern ireland', 'ireland', 'republic of ireland',
  'isle of man', 'guernsey', 'jersey']);

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'country', 'region', 'category', 'themes', 'prominence', 'blurb', 'timeGated', 'lat', 'lng', 'approx'],
  properties: {
    name: { type: 'string' },
    country: { type: 'string' },
    region: { type: 'string' },
    subregion: { type: 'string' },
    category: { type: 'string', enum: CATS },
    themes: { type: 'array', items: { type: 'string', enum: THEMES } },
    prominence: { type: 'string', enum: ['signature', 'standard'] },
    blurb: { type: 'string' },
    timeGated: { type: 'boolean' },
    hours: { type: 'string' },
    officialUrl: { type: 'string' },
    lat: { type: 'number' },
    lng: { type: 'number' },
    approx: { type: 'boolean' }
  }
};

const PROMPT = `You convert one place into a single JSON record for a "Waypoints" travel map.
Fill every required field. Rules:
- category (pin colour): personal (music/art/literary/chess/personal passions), heritage (castles, cathedrals, historic/tourist sites), modern (contemporary/industrial/architecture/urbex), nature (landscape, coast, wildlife).
- themes: array from [music,art,literary,chess,castle,cathedral,monument,industrial,coast,mountain,wildlife,food]; first theme is the most important (it becomes the pin glyph). Use "mountain" for general landscape/gardens/forests, "monument" for stones/memorials/statues/towers.
- prominence: "signature" for offbeat/personal finds; "standard" for marquee mainstream tourist stops.
- blurb: one concise factual line (<=160 chars).
- timeGated: true if it has tickets/opening hours (museums, toured castles, churches with paid entry, gardens, operas); false for open streets/coast/free memorials/ruins.
- lat/lng: your best WGS84 estimate. Set approx:true unless you are confident of the exact point.
- hours/officialUrl: "" unless you are certain — never invent.
Output ONLY the JSON object.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body;
  try { body = await readBody(req); } catch (e) { return res.status(400).json({ error: 'Bad JSON' }); }

  // Feedback is open (no access key) so any visitor can submit.
  if (body.action === 'feedback') {
    try { return res.status(200).json(await feedback(body)); }
    catch (e) { return res.status(500).json({ error: String((e && e.message) || e) }); }
  }

  const secret = process.env.WAYPOINTS_ADD_SECRET;
  if (secret && body.password !== secret) return res.status(401).json({ error: 'Bad access key' });

  try {
    if (body.action === 'delete') {
      return res.status(200).json(await del(body));
    }
    if (body.action === 'commit') {
      return res.status(200).json(await commit(body));
    }
    return res.status(200).json(await draft(body));
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};

/* ------------------------------------ draft -------------------------------- */
async function draft(body) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const Client = Anthropic.default || Anthropic;
  const client = new Client();

  const blocks = [];
  let context = '';
  let suggestedImageUrl = '';

  if (body.kind === 'image' && body.imageBase64) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: body.mediaType || 'image/webp', data: body.imageBase64 } });
    context = body.text ? ('User note: ' + body.text) : 'Identify the place shown in this image.';
  } else if (body.kind === 'link' && body.url) {
    const page = await fetchPage(body.url);
    suggestedImageUrl = page.ogImage || '';
    context = `From this web page:\nTITLE: ${page.title}\nDESCRIPTION: ${page.desc}\nURL: ${body.url}\nPAGE TEXT (truncated): ${page.text}`;
  } else if (body.text) {
    context = 'Place described by the user: ' + body.text;
  } else {
    throw new Error('Nothing to draft from');
  }
  blocks.push({ type: 'text', text: PROMPT + '\n\n' + context });

  const msg = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1500,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: blocks }]
  });
  const textOut = (msg.content.find(b => b.type === 'text') || {}).text || '{}';
  const d = JSON.parse(textOut);

  // Prefer a real geocode over the model's estimate.
  let lat = d.lat, lng = d.lng, approx = d.approx !== false;
  const geo = await geocode([d.name, d.subregion, d.region, d.country].filter(Boolean).join(', '));
  if (geo) { lat = geo.lat; lng = geo.lng; approx = false; }

  const record = {
    id: slug(d.name),
    name: d.name,
    macroRegion: UK.has(String(d.country || '').toLowerCase()) ? 'uk' : 'eu',
    region: d.region || '', subregion: d.subregion || '', country: d.country || '',
    lat, lng, approx,
    category: CATS.includes(d.category) ? d.category : 'heritage',
    themes: (d.themes || []).filter(t => THEMES.includes(t)),
    prominence: 'signature', // your adds are personal picks → always the prominent (large) marker
    blurb: d.blurb || '',
    timeGated: !!d.timeGated, hours: d.hours || '', officialUrl: d.officialUrl || '',
    link: body.kind === 'link' ? body.url : '',
    images: [], source: 'manual', status: 'want-to-see'
  };
  if (!record.themes.length) record.themes = ['monument'];

  // No image yet (typed text, or a link with no preview image)? Auto-find one
  // from Wikipedia's lead photo for the place — big time-saver for text adds.
  if (body.kind !== 'image' && !suggestedImageUrl) {
    suggestedImageUrl = await findImage(record.name, record.region, record.country);
  }
  if (body.parentId) record.parent = body.parentId; // nested under an existing pin
  return { record, suggestedImageUrl };
}

/* ------------------------------------ commit ------------------------------- */
async function commit(body) {
  const record = body.record;
  if (!record || !record.name) throw new Error('No record to commit');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const repo = process.env.GITHUB_REPO || 'dgbenner/waypoints';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const base = 'https://api.github.com/repos/' + repo + '/contents/';
  const gh = (path, opts = {}) => fetch(base + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'Waypoints' }, opts.headers || {})
  }));

  // Load current data.json
  const curRes = await gh('data.json?ref=' + branch);
  if (!curRes.ok) throw new Error('Could not read data.json (' + curRes.status + ')');
  const cur = await curRes.json();
  const data = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));

  // Ensure a unique id
  const ids = new Set(data.map(r => r.id));
  let id = record.id || slug(record.name), n = 2;
  while (ids.has(id)) id = (record.id || slug(record.name)) + '-' + (n++);
  record.id = id;

  // Image: uploaded base64, or fetch a suggested URL (link og:image)
  let imageBase64 = body.imageBase64 || '';
  let ext = (body.imageName && body.imageName.split('.').pop() || '').toLowerCase();
  if (!imageBase64 && body.imageUrl) {
    try {
      const ir = await fetch(body.imageUrl);
      if (ir.ok) {
        imageBase64 = Buffer.from(await ir.arrayBuffer()).toString('base64');
        const ct = ir.headers.get('content-type') || '';
        ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
      }
    } catch (e) { /* image is best-effort */ }
  }
  if (imageBase64) {
    if (!/^(png|jpg|jpeg|webp)$/.test(ext)) ext = 'webp';
    const file = id + '.' + ext;
    const put = await gh('images/' + file, {
      method: 'PUT',
      body: JSON.stringify({ message: 'Add image for ' + id, content: imageBase64, branch })
    });
    if (put.ok) { record.images = [file]; record.source = 'screenshot'; }
  }

  // Nesting: cluster the child around its parent in a small golden-angle spiral
  // so siblings group at the parent and fan out (don't overlap) when zoomed in.
  const parentId = record.parent || body.parentId;
  if (parentId) {
    const parent = data.find(r => r.id === parentId);
    if (parent && typeof parent.lat === 'number') {
      record.parent = parentId;
      const sibs = data.filter(r => r.parent === parentId).length;
      const ang = sibs * 2.39996323;            // golden angle (rad)
      const radM = 25 + sibs * 6;               // metres from parent
      record.lat = +(parent.lat + (radM * Math.cos(ang)) / 111320).toFixed(6);
      record.lng = +(parent.lng + (radM * Math.sin(ang)) / (111320 * Math.cos(parent.lat * Math.PI / 180))).toFixed(6);
      record.approx = false;
    } else {
      delete record.parent;                     // parent not found — keep as a normal pin
    }
  }

  data.push(record);
  const newContent = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const put = await gh('data.json', {
    method: 'PUT',
    body: JSON.stringify({ message: 'Add waypoint: ' + record.name, content: newContent, sha: cur.sha, branch })
  });
  if (!put.ok) throw new Error('Commit failed (' + put.status + '): ' + (await put.text()).slice(0, 200));
  return { ok: true, record };
}

/* ------------------------------------ delete ------------------------------- */
async function del(body) {
  const id = body.id;
  if (!id) throw new Error('No id to delete');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const repo = process.env.GITHUB_REPO || 'dgbenner/waypoints';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const base = 'https://api.github.com/repos/' + repo + '/contents/';
  const gh = (path, opts = {}) => fetch(base + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'Waypoints' }, opts.headers || {})
  }));
  const curRes = await gh('data.json?ref=' + branch);
  if (!curRes.ok) throw new Error('Could not read data.json (' + curRes.status + ')');
  const cur = await curRes.json();
  const data = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
  const idx = data.findIndex(r => r.id === id);
  if (idx === -1) throw new Error('Pin not found: ' + id);
  const removed = data.splice(idx, 1)[0];
  const newContent = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const put = await gh('data.json', {
    method: 'PUT',
    body: JSON.stringify({ message: 'Remove duplicate: ' + (removed.name || id), content: newContent, sha: cur.sha, branch })
  });
  if (!put.ok) throw new Error('Delete failed (' + put.status + '): ' + (await put.text()).slice(0, 200));
  return { ok: true, id };
}

/* ----------------------------------- feedback ------------------------------ */
async function feedback(body) {
  const cats = Array.isArray(body.categories)
    ? body.categories.filter(c => typeof c === 'string').slice(0, 8) : [];
  const message = String(body.message || '').slice(0, 500).trim();
  if (!cats.length && !message) throw new Error('Empty feedback');
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const repo = process.env.GITHUB_REPO || 'dgbenner/waypoints';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const base = 'https://api.github.com/repos/' + repo + '/contents/';
  const gh = (path, opts = {}) => fetch(base + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'Waypoints' }, opts.headers || {})
  }));
  const entry = JSON.stringify({ at: new Date().toISOString(), categories: cats, message }) + '\n';
  let existing = '', sha;
  const cur = await gh('feedback.jsonl?ref=' + branch);
  if (cur.ok) { const j = await cur.json(); sha = j.sha; existing = Buffer.from(j.content, 'base64').toString('utf8'); }
  const putBody = { message: 'Feedback', content: Buffer.from(existing + entry).toString('base64'), branch };
  if (sha) putBody.sha = sha;
  const put = await gh('feedback.jsonl', { method: 'PUT', body: JSON.stringify(putBody) });
  if (!put.ok) throw new Error('Feedback save failed (' + put.status + ')');
  return { ok: true };
}

/* ------------------------------------ helpers ------------------------------ */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

async function fetchPage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Waypoints)' } });
  const html = await r.text();
  const pick = re => { const m = html.match(re); return m ? m[1].trim() : ''; };
  const meta = (prop) => pick(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'))
    || pick(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + prop + '["\']', 'i'));
  const title = meta('og:title') || pick(/<title[^>]*>([^<]+)<\/title>/i);
  const desc = meta('description') || meta('og:description');
  const ogImage = meta('og:image');
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2500);
  return { title, desc, ogImage, text };
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
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': 'Waypoints/1.0 (personal map)' } });
    const j = await r.json();
    if (j && j[0] && j[0].lat) return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon) };
  } catch (e) { /* fall back to model estimate */ }
  return null;
}

function slug(s) {
  return String(s || 'place').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'place';
}
