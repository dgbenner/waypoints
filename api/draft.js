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
const { github, appendJsonl, readBody } = require('./_lib');
const { draftFromInput, slug } = require('./_place');

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
// The add form: image, link or text → a record for the preview. The work itself is
// the shared draftFromInput (api/_place.js), which the inbox uses too.
async function draft(body) {
  const d = await draftFromInput({
    text: body.text,
    url: body.kind === 'link' ? body.url : '',
    image: body.kind === 'image' ? body.imageBase64 : '',
    mediaType: body.mediaType,
    fixedLat: body.fixedLat, fixedLng: body.fixedLng,
    imageUrl: body.imageUrl,
    parentId: body.parentId
  });
  return { record: d.record, suggestedImageUrl: d.suggestedImageUrl };
}

const DATA_FILE = 'data.json';

/* ------------------------------------ commit ------------------------------- */
async function commit(body) {
  const record = body.record;
  if (!record || !record.name) throw new Error('No record to commit');
  const { gh, branch } = github();

  // Load the current (per-user) data file
  const dataFile = DATA_FILE;
  const curRes = await gh(dataFile + '?ref=' + branch);
  if (!curRes.ok) throw new Error('Could not read ' + dataFile + ' (' + curRes.status + ')');
  const cur = await curRes.json();
  const data = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));

  // Ensure a unique id
  const ids = new Set(data.map(r => r.id));
  let id = record.id || slug(record.name), n = 2;
  while (ids.has(id)) id = (record.id || slug(record.name)) + '-' + (n++);
  record.id = id;

  // Date stamp — drives the "recently added" panel's relative dates
  record.addedAt = new Date().toISOString().slice(0, 10);

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
  const put = await gh(dataFile, {
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
  const { gh, branch } = github();
  const dataFile = DATA_FILE;
  const curRes = await gh(dataFile + '?ref=' + branch);
  if (!curRes.ok) throw new Error('Could not read ' + dataFile + ' (' + curRes.status + ')');
  const cur = await curRes.json();
  const data = JSON.parse(Buffer.from(cur.content, 'base64').toString('utf8'));
  const idx = data.findIndex(r => r.id === id);
  if (idx === -1) throw new Error('Pin not found: ' + id);
  const removed = data.splice(idx, 1)[0];
  const newContent = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const put = await gh(dataFile, {
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
  await appendJsonl('feedback.jsonl', { at: new Date().toISOString(), categories: cats, message }, 'Feedback');
  return { ok: true };
}
