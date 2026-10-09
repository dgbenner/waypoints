/* ============================================================================
 * WAYPOINTS — /api/inbox  (Vercel serverless, Node)
 *
 * Places sent from outside the site (Apple Shortcut now; Claude connector next).
 * Runs the same steps as the add form and saves the result as a draft in the
 * private store. Nothing reaches the map until Dan accepts it in the tray.
 *
 * POST  Authorization: Bearer <INBOX_TOKEN>
 *       { text?, url?, image?, source }   (at least one of text / url / image)
 * →     { ok, draft_id, status, summary }  or  { ok:false, summary }
 * `summary` is one plain sentence; the Shortcut shows it (Siri reads it aloud).
 * ========================================================================== */
const { readBody, inboxAuthorized } = require('../_lib');
const { draftFromInput } = require('../_place');
const { prepareImage } = require('../_image');
const store = require('../_store');

const SOURCES = ['shortcut', 'email', 'telegram', 'claude'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const started = Date.now();
  const reply = (code, body) => res.status(code).json(body);

  if (!process.env.INBOX_TOKEN) return reply(503, { ok: false, summary: 'The inbox isn’t set up yet.' });
  if (!inboxAuthorized(req)) return reply(401, { ok: false, summary: 'Unauthorized.' });
  if (req.method !== 'POST') return reply(405, { ok: false, summary: 'Send places with POST.' });

  let body;
  try { body = await readBody(req); } catch (e) { return reply(400, { ok: false, summary: 'That request wasn’t valid JSON.' }); }
  const source = SOURCES.includes(body.source) ? body.source : 'shortcut';
  const log = extra => store.logInbox(Object.assign({ at: new Date().toISOString(), source, ms: Date.now() - started }, extra));

  try {
    if (!(await store.takeRateSlot())) {
      await log({ status: 'rate_limited' });
      return reply(429, { ok: false, summary: 'Inbox limit reached. Try again later.' });
    }

    const result = await createDraft(body, source);
    await log({ status: result.status || 'error', draft_id: result.draft_id || null,
      tokens_in: result.tokens_in || 0, tokens_out: result.tokens_out || 0, error: result.error || null });
    return reply(result.ok ? 200 : 400, { ok: result.ok, draft_id: result.draft_id, status: result.status, summary: result.summary });
  } catch (e) {
    await log({ status: 'error', error: String((e && e.message) || e).slice(0, 200) });
    return reply(500, { ok: false, summary: 'Something went wrong saving that. Try again.' });
  }
};

// Shared by the inbox and (next) the Claude connector.
async function createDraft(body, source) {
  // Shortcuts sends a link as both `url` and `text`; a list of urls is fine too.
  const text = typeof body.text === 'string' ? body.text.slice(0, 4000)
    : Array.isArray(body.text) ? body.text.join(' ').slice(0, 4000) : '';
  const url = body.url;

  let image = null;
  if (body.image && String(body.image).trim()) {
    image = await prepareImage(body.image);
    if (image.error === 'heic') return { ok: false, status: 'rejected_image', summary: 'That image is HEIC. Send a screenshot or a JPEG.', error: 'heic' };
    if (image.error) return { ok: false, status: 'rejected_image', summary: 'That image couldn’t be read. Send a screenshot or a JPEG.', error: image.error };
  }
  if (!text.trim() && !firstUrlOf(url) && !image) {
    return { ok: false, status: 'empty', summary: 'Send a place name, a link or an image.', error: 'empty' };
  }

  const d = await draftFromInput({
    text, url, image: image && image.b64, mediaType: image && image.mediaType,
    strictLocation: true, checkDuplicates: true
  });

  const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const r = d.record;
  const draft = {
    id, created_at: new Date().toISOString(), source,
    input: { text, url: firstUrlOf(url), image: !!image },
    proposed: {
      name: d.identified ? r.name : '', area: d.area,
      lat: typeof r.lat === 'number' ? r.lat : null, lng: typeof r.lng === 'number' ? r.lng : null,
      category: r.category, notes: r.blurb,
      photo: image ? 'screenshot' : (d.suggestedImageUrl || ''),
      record: r                                   // everything the add form needs to save the pin
    },
    status: d.status,
    duplicate_of: d.duplicate ? d.duplicate.id : null,
    duplicate_name: d.duplicate ? d.duplicate.name : null
  };
  await store.saveDraft(draft, image && image.b64);

  return {
    ok: true, draft_id: id, status: d.status, summary: summarize(draft),
    tokens_in: d.usage.input_tokens || 0, tokens_out: d.usage.output_tokens || 0
  };
}

function summarize(draft) {
  const p = draft.proposed, where = (p.area || '').split(',')[0].trim();
  if (draft.status === 'needs_review') {
    // identified but not found on the map, or not identified at all
    return p.name ? 'Draft saved for review: couldn’t find where ' + p.name + ' is.'
                  : 'Draft saved for review: couldn’t identify a place from that.';
  }
  const base = 'Draft saved: ' + p.name + (where && where !== p.name ? ', ' + where : '') + '.';
  return draft.status === 'possible_duplicate' ? base + ' Possible duplicate of ' + draft.duplicate_name + '.' : base;
}

function firstUrlOf(u) {
  const v = Array.isArray(u) ? u[0] : u;
  const s = String(v || '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : '';
}

module.exports.createDraft = createDraft;
