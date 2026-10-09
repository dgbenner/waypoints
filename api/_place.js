/* ============================================================================
 * WAYPOINTS — shared "turn an input into a place" step.
 * Used by the add form (/api/draft) and the inbox (/api/inbox).
 *
 *   draftFromInput({ text, url, image, mediaType, ... }) → { record, status, ... }
 *
 * Identify (Claude) → locate (Nominatim) → photo (the sent image, or
 * Wikipedia/Commons) → duplicate check against the pins on the map.
 * Leading underscore keeps Vercel from serving this file as a route.
 * ========================================================================== */
const Anthropic = require('@anthropic-ai/sdk');
const { findImage, geocode } = require('./_lib');

const MODEL = 'claude-opus-4-8';
const CATS = ['personal', 'heritage', 'modern', 'nature'];
const THEMES = ['music', 'art', 'literary', 'chess', 'castle', 'cathedral',
  'monument', 'industrial', 'coast', 'mountain', 'wildlife', 'food'];
const UK = new Set(['united kingdom', 'uk', 'great britain', 'britain', 'scotland',
  'england', 'wales', 'northern ireland', 'ireland', 'republic of ireland',
  'isle of man', 'guernsey', 'jersey']);

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['identified', 'name', 'country', 'region', 'category', 'themes', 'prominence', 'blurb', 'timeGated', 'lat', 'lng', 'approx'],
  properties: {
    identified: { type: 'boolean' },
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
- identified: true only if you can tell which specific real place this is. If the input is too vague, nonsense, or doesn't point to one place, set false (fill the other fields with your best effort).
- category (pin colour): personal (music/art/literary/chess/personal passions), heritage (castles, cathedrals, historic/tourist sites), modern (contemporary/industrial/architecture/urbex), nature (landscape, coast, wildlife).
- themes: array from [music,art,literary,chess,castle,cathedral,monument,industrial,coast,mountain,wildlife,food]; first theme is the most important (it becomes the pin glyph). Use "mountain" for general landscape/gardens/forests, "monument" for stones/memorials/statues/towers.
- prominence: "signature" for offbeat/personal finds; "standard" for marquee mainstream tourist stops.
- name: Title Case. Never use "&" in any field; write "and".
- blurb: one concise factual line (<=160 chars).
- timeGated: true if it has tickets/opening hours (museums, toured castles, churches with paid entry, gardens, operas); false for open streets/coast/free memorials/ruins.
- lat/lng: your best WGS84 estimate. Set approx:true unless you are confident of the exact point.
- hours/officialUrl: "" unless you are certain — never invent.
Output ONLY the JSON object.`;

/* ---------------------------- identify (Claude) ---------------------------- */
// Returns { d (the model's record), usage }. Exported so local tests can stub it.
async function identifyPlace({ blocks }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const Client = Anthropic.default || Anthropic;
  const client = new Client();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: blocks }]
  });
  const textOut = (msg.content.find(b => b.type === 'text') || {}).text || '{}';
  return { d: JSON.parse(textOut), usage: msg.usage || {} };
}

/* ------------------------------ the shared step --------------------------- */
// text, url (string or list), image (base64, already a supported type), mediaType.
// Options:
//   strictLocation — inbox: never fall back to the model's coordinates; a place
//                    that can't be geocoded becomes needs_review.
//   fixedLat/fixedLng — keep a point that's already verified (Scout); skip geocoding.
//   imageUrl  — a photo already found elsewhere (Scout).
//   parentId  — nest under an existing pin (add form).
//   checkDuplicates — compare against the pins on the map.
async function draftFromInput(input) {
  const text = String(input.text || '').trim();
  const url = firstUrl(input.url);
  const image = input.image || '';
  if (!text && !url && !image) throw new Error('Nothing to draft from');

  const blocks = [];
  const context = [];
  let suggestedImageUrl = '';
  if (image) {
    blocks.push({ type: 'image', source: { type: 'base64', media_type: input.mediaType || 'image/webp', data: image } });
    context.push('Identify the place shown in this image.');
  }
  if (url) {
    const page = await fetchPage(url).catch(() => null);
    if (page) {
      suggestedImageUrl = page.ogImage || '';
      context.push(`From this web page:\nTITLE: ${page.title}\nDESCRIPTION: ${page.desc}\nURL: ${url}\nPAGE TEXT (truncated): ${page.text}`);
    } else {
      context.push('Link the user sent (could not be fetched): ' + url);
    }
  }
  if (text && text !== url) context.push((image || url ? 'User note: ' : 'Place described by the user: ') + text);
  blocks.push({ type: 'text', text: PROMPT + '\n\n' + context.join('\n\n') });

  const { d, usage } = await module.exports.identifyPlace({ blocks });
  const identified = d.identified !== false && !!String(d.name || '').trim();

  // Location: a verified point wins; otherwise geocode. The add form may fall back to
  // the model's estimate (you review it in the preview); the inbox never does.
  let lat = d.lat, lng = d.lng, approx = d.approx !== false, located = false, locality = '';
  if (typeof input.fixedLat === 'number' && typeof input.fixedLng === 'number') {
    lat = input.fixedLat; lng = input.fixedLng; approx = false; located = true;
  } else if (identified) {
    const geo = await geocode([d.name, d.subregion, d.region, d.country].filter(Boolean).join(', '))
      || await geocode([d.name, d.country].filter(Boolean).join(', '));
    if (geo) { lat = geo.lat; lng = geo.lng; approx = false; located = true; locality = geo.locality || ''; }
  }
  if (input.strictLocation && !located) { lat = null; lng = null; }

  const record = buildRecord(d, { lat, lng, approx, link: url });
  if (input.parentId) record.parent = input.parentId;

  if (input.imageUrl) suggestedImageUrl = input.imageUrl;
  if (!image && !suggestedImageUrl && identified) {
    suggestedImageUrl = await findImage(record.name, record.region, record.country);
  }

  let status = 'ready', duplicate = null;
  if (!identified || (input.strictLocation && !located)) status = 'needs_review';
  else if (input.checkDuplicates) {
    duplicate = await findDuplicate(record.name, record.lat, record.lng);
    if (duplicate) status = 'possible_duplicate';
  }

  return {
    record, suggestedImageUrl, status, identified, located,
    area: [locality || record.subregion || record.region, record.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '),
    duplicate, usage
  };
}

function buildRecord(d, { lat, lng, approx, link }) {
  const noAmp = t => String(t || '').replace(/\s*&\s*/g, ' and ');
  // Title Case keeps small joining words lowercase mid-name: "Studios and Zebra", not "Studios And Zebra"
  const SMALL = /^(a|an|and|as|at|but|by|for|from|in|into|nor|of|on|or|the|to|with|de|du|des|la|le|les|del|della|di|da|van|von|der|den|et)$/i;
  const name = noAmp(d.name).split(' ').map((w, i, all) => (i > 0 && i < all.length - 1 && SMALL.test(w)) ? w.toLowerCase() : w).join(' ');
  const record = {
    id: slug(name),
    name,
    macroRegion: UK.has(String(d.country || '').toLowerCase()) ? 'uk' : 'eu',
    region: d.region || '', subregion: d.subregion || '', country: d.country || '',
    lat, lng, approx,
    category: CATS.includes(d.category) ? d.category : 'heritage',
    themes: (d.themes || []).filter(t => THEMES.includes(t)),
    prominence: 'signature', // your adds are personal picks → always the prominent (large) marker
    blurb: noAmp(d.blurb),
    timeGated: !!d.timeGated, hours: d.hours || '', officialUrl: d.officialUrl || '',
    link: link || '',
    images: [], source: 'manual', status: 'want-to-see'
  };
  if (!record.themes.length) record.themes = ['monument'];
  return record;
}

/* ----------------------------- duplicate check ---------------------------- */
// Same rule as Scout: within 500 m, or the same normalized name.
let pinsCache = { at: 0, pins: [] };
async function currentPins() {
  if (Date.now() - pinsCache.at < 5 * 60 * 1000 && pinsCache.pins.length) return pinsCache.pins;
  const repo = process.env.GITHUB_REPO || 'dgbenner/waypoints';
  const branch = process.env.GITHUB_BRANCH || 'main';
  try {
    const r = await fetch('https://raw.githubusercontent.com/' + repo + '/' + branch + '/data.json', { headers: { 'User-Agent': 'Waypoints' } });
    if (r.ok) pinsCache = { at: Date.now(), pins: await r.json() };
  } catch (e) { /* no duplicate check this time */ }
  return pinsCache.pins;
}
function normName(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`]/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && w !== 'the').join(' ');
}
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371.0088, t = x => x * Math.PI / 180;
  const h = Math.sin(t(lat2 - lat1) / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(t(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
async function findDuplicate(name, lat, lng) {
  const pins = await currentPins(), n = normName(name), has = typeof lat === 'number' && typeof lng === 'number';
  const hit = pins.find(p => (n && normName(p.name) === n) ||
    (has && typeof p.lat === 'number' && distanceKm(lat, lng, p.lat, p.lng) <= 0.5));
  return hit ? { id: hit.id, name: hit.name } : null;
}

/* --------------------------------- helpers -------------------------------- */
function firstUrl(u) {
  const v = Array.isArray(u) ? u[0] : u;
  const s = String(v || '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : '';
}

async function fetchPage(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Waypoints)' }, signal: AbortSignal.timeout(10000) });
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

function slug(s) {
  return String(s || 'place').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'place';
}

module.exports = { draftFromInput, identifyPlace, findDuplicate, firstUrl, slug, normName };
