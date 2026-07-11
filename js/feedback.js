/* ============================================================================
 * WAYPOINTS — feedback tab/window. Open to all visitors; appends to the repo's
 * feedback.jsonl via /api/draft (action: feedback).
 * ========================================================================== */
(function () {
  'use strict';
  const API_BASE = ''; // same-origin on Vercel; set to the Vercel URL if hosting the map elsewhere
  const $ = id => document.getElementById(id);
  const modal = $('fb-modal'), backdrop = $('fb-backdrop');
  const textEl = $('fb-text'), countEl = $('fb-count'), statusEl = $('fb-status'), submitBtn = $('fb-submit');

  function open() { modal.hidden = false; backdrop.hidden = false; setStatus(''); }
  function close() { modal.hidden = true; backdrop.hidden = true; }
  function setStatus(m, err) { statusEl.textContent = m; statusEl.classList.toggle('is-error', !!err); }

  $('fb-tab').addEventListener('click', open);
  $('fb-close').addEventListener('click', close);
  $('fb-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  textEl.addEventListener('input', () => { countEl.textContent = textEl.value.length; });

  submitBtn.addEventListener('click', async () => {
    const cats = Array.from(modal.querySelectorAll('.fb-cat input:checked')).map(c => c.value);
    const message = textEl.value.trim();
    if (!cats.length && !message) { setStatus('Pick a category or add a note first.', true); return; }
    submitBtn.disabled = true; setStatus('Sending…');
    try {
      const res = await fetch(API_BASE + '/api/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'feedback', categories: cats, message })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setStatus('Thanks — got it! 🙏');
      modal.querySelectorAll('.fb-cat input:checked').forEach(c => (c.checked = false));
      textEl.value = ''; countEl.textContent = '0';
      setTimeout(close, 1200);
    } catch (err) {
      const m = String(err && err.message || err);
      setStatus(/HTTP 404|Failed to fetch/i.test(m) ? 'Backend not reachable — deploy /api to Vercel.' : ('Couldn’t send: ' + m), true);
    } finally { submitBtn.disabled = false; }
  });
})();
