/* ============================================================================
 * WAYPOINTS — Scout Agent card (modal, opened from the right-edge tab)
 * Content lives in data/scout-card.json; the live numbers come from
 * scout-log.jsonl through /api/scout (action: cardstats, public, counts only).
 *
 * Two views behind the tabs in the header: Scout Rules (the parameters) and
 * Agent Story (purpose, permissions, limits, success test, plus the template).
 *
 * Open it from another page with a link to  /?card=scout  on this site
 * (add &view=story to open on the Agent Story), or call window.ScoutCard.open()
 * / window.ScoutCard.open('story') from a script on this page.
 * ========================================================================== */
(function () {
  'use strict';

  // Claude Sonnet 5.5, $ per million tokens. Cost per run uses the cost_usd each
  // run logged (which already applies cache rates); these are the fallback.
  const PRICE_IN = 2, PRICE_OUT = 10;

  const $ = (sel, el) => (el || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tab = document.getElementById('sa-tab');
  const modal = document.getElementById('sa-modal');
  const backdrop = document.getElementById('sa-backdrop');
  const body = document.getElementById('sa-body');
  let card = null, openStep = 0;   // opens on the first step, Reads
  let view = 'rules';              // 'rules' | 'story'

  const STEP_ICONS = [
    '<path d="M4 5h11a3 3 0 0 1 3 3v11H7a3 3 0 0 1-3-3z"/><path d="M8 9h6M8 13h6"/>',
    '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    '<rect x="3" y="12" width="18" height="8" rx="1"/><path d="M7 16h4"/>'
  ];
  const svg = (paths, size, sw) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.6) + '" aria-hidden="true">' + paths + '</svg>';
  const ICON = {
    lock: STEP_ICONS[2], eye: STEP_ICONS[3],
    pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    area: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 10h18M9 5v14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>'
  };

  /* ------------------------------ open / close ---------------------------- */
  async function open(which) {
    view = which === 'story' ? 'story' : 'rules';
    if (window.Waypoints && window.Waypoints.closePanel) window.Waypoints.closePanel();
    modal.hidden = false; backdrop.hidden = false;
    tab.setAttribute('aria-expanded', 'true');
    if (!card) {
      body.innerHTML = '<p class="sa-loading">Loading…</p>';
      try { card = await (await fetch('data/scout-card.json', { cache: 'no-store' })).json(); }
      catch (e) { body.innerHTML = '<p class="sa-loading">Couldn’t load the card.</p>'; return; }
    }
    render();
    modal.focus();
  }
  function close() {
    if (modal.hidden) return;
    modal.hidden = true; backdrop.hidden = true;
    tab.setAttribute('aria-expanded', 'false');
    tab.focus();
    // opened from a ?card=scout link: drop the flag so a refresh shows the plain map
    if (/[?&]card=scout\b/.test(location.search) || /^#scout-card/.test(location.hash)) {
      history.replaceState(null, '', location.pathname);
    }
  }
  tab.addEventListener('click', () => open('rules'));
  backdrop.addEventListener('click', close);
  document.getElementById('sa-close').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });

  window.ScoutCard = { open, close };
  if (/[?&]card=scout\b/.test(location.search) || /^#scout-card/.test(location.hash)) {
    open(/[?&]view=story\b/.test(location.search) || location.hash === '#scout-card-story' ? 'story' : 'rules');
  }

  /* -------------------------------- render -------------------------------- */
  function render() {
    const c = card;
    body.innerHTML =
      '<div class="sa-top">' +
      '<header class="sa-head">' +
        '<span class="sa-badge"><img src="images/scout-icon.png" alt=""></span>' +
        '<div class="sa-head__text">' +
          '<div class="sa-tabs" role="tablist" aria-label="Card views">' +
            tabBtn('rules', 'Scout Rules') + '<span class="sa-tabs__dot" aria-hidden="true">·</span>' + tabBtn('story', 'Agent Story') +
          '</div>' +
          '<h2 class="aw-h" id="sa-title">' + esc(c.name) + '</h2><p>' + esc(c.job) + '</p></div>' +
        '<div class="sa-status"><span class="sa-chip sa-chip--live">Live</span><span class="sa-chip">Updated ' + esc(c.updated) + '</span></div>' +
      '</header>' +

      (view === 'rules' ? '<div class="sa-glance">' + c.glance.map(g => '<div class="sa-g"><b>' + esc(g.n) + '</b><span>' + esc(g.label) + '</span></div>').join('') + '</div>' : '') +
      '</div>' +
      '<div class="sa-scroll" tabindex="-1" role="tabpanel">' +
      (view === 'story' ? storyHtml(c) + '</div>' : rulesHtml(c));

    body.querySelectorAll('.sa-tab').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.view === view) return;
      view = b.dataset.view; render();
      const t = body.querySelector('.sa-tab[data-view="' + view + '"]'); if (t) t.focus();
    }));
    if (view === 'rules') wireRules();
  }

  function tabBtn(v, label) {
    return '<button type="button" role="tab" class="sa-tab" data-view="' + v + '" aria-selected="' + (view === v) + '">' + esc(label) + '</button>';
  }

  /* ----------------------------- Agent Story view ------------------------- */
  // "**when**" inside a template line marks an inline label
  const inlineLabels = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b class="sa-lbl">$1</b>');
  function storyHtml(c) {
    const st = c.story, tp = c.template;
    return '<div class="sa-story">' +
      '<p class="sa-story__intro">' + esc(st.intro) + '</p>' +
      '<p class="sa-story__lead"><b class="sa-lbl">As</b> ' + esc(st.as) + ', <b class="sa-lbl">when</b> ' + esc(st.when) +
        ', <b class="sa-lbl">I want</b> ' + esc(st.want) + ', <b class="sa-lbl">so that</b> ' + esc(st.so_that) + '.</p>' +
      '<dl class="sa-story__rows">' + st.rows.map(r => '<div><dt class="sa-lbl">' + esc(r.label) + '</dt><dd>' + esc(r.text) + '</dd></div>').join('') + '</dl>' +
      '</div>' +
      // the template, laid out exactly like the real story above, with [placeholders]
      '<section class="sa-template"><h3 class="sa-template__title">Agent Story Template</h3>' +
        '<p class="sa-story__lead sa-story__lead--blank"><b class="sa-lbl">' + esc(tp.lines[0].label) + '</b> ' + inlineLabels(tp.lines[0].text) + '</p>' +
        '<dl class="sa-story__rows sa-story__rows--blank">' + tp.lines.slice(1).map(r => '<div><dt class="sa-lbl">' + esc(r.label) + '</dt><dd>' + inlineLabels(r.text) + '</dd></div>').join('') + '</dl>' +
        '<h4 class="sa-template__h">How to Use It</h4>' +
        '<ul class="sa-log">' + tp.howto.map(h => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
      '</section>';
  }

  /* ----------------------------- Scout Rules view ------------------------- */
  function rulesHtml(c) {
    return '' +

      section('How a Run Works', 'Click a step.',
        '<div class="sa-pipe">' + c.steps.map((s, i) =>
          '<button type="button" class="sa-node" data-i="' + i + '" aria-expanded="' + (i === openStep) + '" aria-controls="sa-stepdetail">' +
          '<span class="sa-dot">' + svg(STEP_ICONS[i], 18) + '</span><b>' + esc(s.t) + '</b><span>' + esc(s.s) + '</span></button>').join('') + '</div>' +
        '<div class="sa-stepdetail" id="sa-stepdetail" aria-live="polite"></div>') +

      section('What’s Locked and What’s Judged', '',
        '<div class="sa-col sa-col--lock"><div class="sa-col__h">' + svg(ICON.lock, 18, 1.7) + '<h3>Locked by Code</h3><small>same every run</small></div>' +
          '<p>Measurable things. Code checks them and moves anything that fails to Rejected.</p>' + items(c.locked, true) + '</div>' +
        '<div class="sa-col sa-col--judge"><div class="sa-col__h">' + svg(ICON.eye, 18, 1.7) + '<h3>Judged by the Model</h3><small>can vary</small></div>' +
          '<p>Meaning and taste. The model decides, and has to show its sources and the pins that make the case.</p>' + items(c.judged, false) + '</div>') +

      section('Where Candidates Go', '<span class="sa-runlabel" id="sa-runlabel">Last run</span>',
        '<div id="sa-funnel"><p class="sa-muted">Loading the last run…</p></div>') +

      section('Two Modes', '',
        '<div class="sa-modes">' + c.modes.map(m =>
          '<div class="sa-mode"><h3>' + svg(ICON[m.icon], 15, 1.8) + esc(m.name) + '</h3><p>' + esc(m.d) + '</p>' +
          '<p class="sa-muted">' + esc(m.where) + '</p>' +
          '<div class="sa-lanes">' + m.lanes.map(l => '<span class="sa-lane' + (l.later ? ' sa-lane--later' : '') + '">' + esc(l.t) + '</span>').join('') + '</div></div>').join('') + '</div>') +

      section('Never', '',
        '<div class="sa-nevers">' + c.never.map(n => '<span class="sa-never">' + svg(ICON.x, 13, 2.2) + esc(n) + '</span>').join('') + '</div>') +

      section('How We Know It’s Good', '',
        '<div class="sa-health">' +
          health('sa-h-accept', 'Accept Rate', 'accepted ÷ shown') +
          health('sa-h-overrule', 'Overrule Rate', 'you disagree with a rejection') +
          health('sa-h-wrong', 'Wrong Facts', 'target: 0') +
          health('sa-h-cost', 'Cost per Run', 'tokens + searches') +
        '</div>') +

      '<div class="sa-more">' +
        '<details><summary>Changelog</summary><ul class="sa-log">' + c.changelog.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul></details>' +
        '<details><summary>Tools It Can Use</summary><ul class="sa-log">' + c.tools.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul></details>' +
      '</div>' +
      '<div class="sa-foot"><span>Spec: ' + esc(c.foot.spec) + '</span><span>Owner: ' + esc(c.foot.owner) + '</span></div>' +
      '</div>';
  }

  function wireRules() {
    body.querySelectorAll('.sa-node').forEach(n => n.addEventListener('click', () => { openStep = +n.dataset.i; renderStep(); }));
    body.querySelectorAll('.sa-it').forEach(b => b.addEventListener('click', () => {
      const more = $('.sa-it__more', b), opening = more.hidden;
      more.hidden = !opening; b.setAttribute('aria-expanded', opening);
      $('.sa-it__plus', b).textContent = opening ? '−' : '+';
    }));
    renderStep();
    loadStats();
  }

  function section(title, aside, inner) {
    return '<section class="sa-sect"><div class="sa-sect__h"><h3>' + esc(title) + '</h3>' +
      (aside ? (aside.charAt(0) === '<' ? aside : '<p>' + esc(aside) + '</p>') : '') + '</div>' + inner + '</section>';
  }
  function items(rows, locked) {
    return '<div class="sa-items">' + rows.map(r =>
      '<button type="button" class="sa-it" aria-expanded="false"><span>' + esc(r.t) + '</span><span class="sa-it__plus" aria-hidden="true">+</span>' +
      '<span class="sa-it__more" hidden>' + esc(r.d) + (locked ? ' <span class="sa-code">→ ' + esc(r.code) + '</span>' : '') + '</span></button>').join('') + '</div>';
  }
  function health(id, label, sub) {
    return '<div class="sa-h"><b id="' + id + '">—</b><span>' + esc(label) + '</span><small>' + esc(sub) + '</small></div>';
  }
  function renderStep() {
    body.querySelectorAll('.sa-node').forEach(n => n.setAttribute('aria-expanded', +n.dataset.i === openStep));
    const s = card.steps[openStep];
    $('#sa-stepdetail', body).innerHTML = '<b>' + esc(s.t) + ':</b> ' + s.d;   // d carries trusted <b> markup from our own JSON
  }

  /* ------------------------------ live numbers ---------------------------- */
  // Every number without data shows "—", never 0.
  async function loadStats() {
    const funnel = $('#sa-funnel', body), label = $('#sa-runlabel', body);
    let stats = null;
    try {
      const r = await fetch('/api/scout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cardstats' }) });
      if (r.ok) stats = await r.json();
    } catch (e) { /* offline: leave the dashes */ }
    if (!stats) { label.textContent = ''; funnel.innerHTML = '<p class="sa-muted">Live numbers aren’t reachable right now.</p>'; return; }

    const runs = stats.runs || [];
    const last = runs[runs.length - 1];
    if (!last) {
      label.textContent = '';
      funnel.innerHTML = '<p class="sa-muted">No runs logged yet. The next Scout run will fill this in.</p>';
    } else {
      const total = last.rejected_rule + last.rejected_judgment + last.shown;
      label.textContent = 'Last run · ' + (last.mode === 'area' ? 'Area Scout' : 'Pin Scout') + ' · ' + scopeName(last) + ' · ' + shortDate(last.at);
      // segments carry just the count (labels don't fit a 1-wide slice); the legend names them
      const seg = (cls, n, text) => n ? '<div class="sa-seg ' + cls + '" style="flex:' + n + '" title="' + n + ' ' + esc(text) + '">' + n + '</div>' : '';
      funnel.innerHTML = total
        ? '<div class="sa-bar" role="img" aria-label="' + esc(last.rejected_rule + ' failed a rule, ' + last.rejected_judgment + ' rejected by judgment, ' + last.shown + ' shown to you') + '">' +
            seg('sa-seg--rule', last.rejected_rule, 'failed a rule') + seg('sa-seg--judge', last.rejected_judgment, 'judged weak') + seg('sa-seg--shown', last.shown, 'shown') + '</div>' +
          '<div class="sa-legend"><span><i class="sa-seg--rule"></i>Rejected by code: duplicate, too far, no coordinates</span>' +
            '<span><i class="sa-seg--judge"></i>Rejected by judgment: weak fit, tourist trap</span><span><i class="sa-seg--shown"></i>In your tray</span></div>' +
          (last.considered ? '<p class="sa-muted">' + plural(last.considered, 'place') + ' considered · ' + plural(last.searches, 'search', 'searches') + '</p>' : '')
        : '<p class="sa-muted">The last run came back empty.</p>';
    }

    // Rates count only decisions made since runs started being logged (the server
    // counts those), so "shown" lines up.
    const shown = runs.reduce((a, r) => a + r.shown, 0);
    const rejections = runs.reduce((a, r) => a + r.rejected_rule + r.rejected_judgment, 0);
    const accepted = stats.accepted || 0, overruled = stats.overruled || 0;
    const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';
    $('#sa-h-accept', body).textContent = pct(accepted, shown);
    $('#sa-h-overrule', body).textContent = pct(overruled, rejections);
    // TODO: "Wrong facts" stays "—" until Dan starts marking suggestions as wrong.
    const costs = runs.map(r => r.cost_usd || ((r.tokens_in * PRICE_IN + r.tokens_out * PRICE_OUT) / 1e6 + r.searches * 0.01));
    $('#sa-h-cost', body).textContent = costs.length ? '$' + (costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(2) : '—';
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function scopeName(run) {
    if (run.mode === 'area') return run.scope;
    const p = window.Waypoints && window.Waypoints.pins && window.Waypoints.pins().find(x => x.id === run.scope);
    return p ? p.name : run.scope;
  }
  function shortDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }
})();
