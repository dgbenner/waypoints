/* ============================================================================
 * WAYPOINTS — /api/config  (Vercel serverless, Node)
 * Tells the frontend which user this deployment serves. One codebase, many
 * users: each Vercel project sets WAYPOINTS_USER (+ its own WAYPOINTS_ADD_SECRET).
 *   unset / "dan"  -> data.json,            target/ghost flag model
 *   "<name>"       -> data-<name>.json,      auto flag model (populate as added)
 * ========================================================================== */
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const user = String(process.env.WAYPOINTS_USER || '').trim().toLowerCase();
  const isDan = !user || user === 'dan';
  res.status(200).json({
    user: user || 'dan',
    dataFile: isDan ? 'data.json' : 'data-' + user.replace(/[^a-z0-9-]/g, '') + '.json',
    flags: isDan ? 'targets' : 'auto'
  });
};
