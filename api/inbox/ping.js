/* ============================================================================
 * WAYPOINTS — /api/inbox/ping: lets the Shortcut check its token.
 * GET  Authorization: Bearer <INBOX_TOKEN>  →  { ok, summary }
 * ========================================================================== */
const { inboxAuthorized } = require('../_lib');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.INBOX_TOKEN) return res.status(503).json({ ok: false, summary: 'The inbox isn’t set up yet.' });
  if (!inboxAuthorized(req)) return res.status(401).json({ ok: false, summary: 'Unauthorized.' });
  return res.status(200).json({ ok: true, summary: 'Connected to Waypoints.' });
};
