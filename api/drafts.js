/* ============================================================================
 * WAYPOINTS — /api/drafts  (Vercel serverless, Node)
 * The site's side of the inbox: everything here needs the access key
 * (WAYPOINTS_ADD_SECRET), checked on the server, so only Dan sees drafts.
 *
 * POST { action, password, id? }
 *   count            → { count }
 *   list             → { drafts }           (no images; fetch those one at a time)
 *   image    { id }  → { image }            (data URL of the saved screenshot, or "")
 *   delete   { id }  → { ok }               (removes the draft and its screenshot)
 *   accepted { id }  → { ok }               (same, after the pin has been saved)
 * ========================================================================== */
const { readBody } = require('./_lib');
const store = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body;
  try { body = await readBody(req); } catch (e) { return res.status(400).json({ error: 'Bad JSON' }); }

  const secret = process.env.WAYPOINTS_ADD_SECRET;
  if (!secret) return res.status(503).json({ error: 'Access key not configured' });   // never open by default
  if (body.password !== secret) return res.status(401).json({ error: 'Bad access key' });

  const id = String(body.id || '').replace(/[^a-z0-9]/gi, '');
  try {
    switch (body.action) {
      case 'count': return res.status(200).json({ count: await store.countDrafts() });
      case 'list': return res.status(200).json({ drafts: await store.listDrafts() });
      case 'image': {
        if (!id) return res.status(400).json({ error: 'No id' });
        const b64 = await store.getDraftImage(id);
        return res.status(200).json({ image: b64 ? 'data:image/webp;base64,' + b64 : '' });
      }
      case 'delete':
      case 'accepted':
        if (!id) return res.status(400).json({ error: 'No id' });
        await store.deleteDraft(id);
        return res.status(200).json({ ok: true });
      default: return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
