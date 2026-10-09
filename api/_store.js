/* ============================================================================
 * WAYPOINTS — private store for inbox drafts (Upstash Redis, REST API).
 * Drafts and their screenshots live here, not in the public repo: they're
 * temporary, and anything committed stays in git history.
 *
 * Env (added to Vercel by the Upstash integration; either naming works):
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *   KV_REST_API_URL        / KV_REST_API_TOKEN
 * Leading underscore keeps Vercel from serving this file as a route.
 * ========================================================================== */
const P = 'wp:';                    // key prefix
const KEY = {
  draft: id => P + 'draft:' + id,   // JSON
  image: id => P + 'draftimg:' + id, // base64 WebP screenshot
  index: P + 'drafts',              // sorted set of ids, scored by created time
  rate: hour => P + 'inbox:rate:' + hour,
  log: P + 'inbox:log'              // newest-first list of request log lines
};
const RATE_LIMIT = 30;              // inbox requests per hour, all sources together

function conf() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Draft store not configured (Upstash Redis env vars missing)');
  return { url: url.replace(/\/+$/, ''), token };
}

async function pipeline(cmds) {
  const { url, token } = conf();
  const r = await fetch(url + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error('Draft store error (' + r.status + ')');
  const out = await r.json();
  const bad = out.find(x => x && x.error);
  if (bad) throw new Error('Draft store error: ' + bad.error);
  return out.map(x => x.result);
}
const one = async cmd => (await pipeline([cmd]))[0];

/* --------------------------------- drafts --------------------------------- */
async function saveDraft(draft, imageB64) {
  const cmds = [
    ['SET', KEY.draft(draft.id), JSON.stringify(draft)],
    ['ZADD', KEY.index, String(Date.parse(draft.created_at) || Date.now()), draft.id]
  ];
  if (imageB64) cmds.push(['SET', KEY.image(draft.id), imageB64]);
  await pipeline(cmds);
}

async function listDrafts() {
  const ids = await one(['ZRANGE', KEY.index, '0', '-1', 'REV']) || [];
  if (!ids.length) return [];
  const rows = await one(['MGET'].concat(ids.map(KEY.draft)));
  return rows.map(r => { try { return r ? JSON.parse(r) : null; } catch (e) { return null; } }).filter(Boolean);
}

async function countDrafts() { return Number(await one(['ZCARD', KEY.index])) || 0; }

async function getDraftImage(id) { return await one(['GET', KEY.image(id)]); }

// Accepting or deleting a draft removes it and its screenshot.
async function deleteDraft(id) {
  await pipeline([['DEL', KEY.draft(id), KEY.image(id)], ['ZREM', KEY.index, id]]);
}

/* ------------------------------ limits and log ---------------------------- */
// Returns true when this request is within the hourly limit.
async function takeRateSlot() {
  const hour = new Date().toISOString().slice(0, 13);
  const [n] = await pipeline([['INCR', KEY.rate(hour)], ['EXPIRE', KEY.rate(hour), '7200']]);
  return Number(n) <= RATE_LIMIT;
}

async function logInbox(entry) {
  try { await pipeline([['LPUSH', KEY.log, JSON.stringify(entry)], ['LTRIM', KEY.log, '0', '999']]); }
  catch (e) { /* logging never breaks a request */ }
}

module.exports = { saveDraft, listDrafts, countDrafts, getDraftImage, deleteDraft, takeRateSlot, logInbox, RATE_LIMIT };
