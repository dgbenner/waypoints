/* ============================================================================
 * WAYPOINTS — Inbox: drafts sent from outside the site (Apple Shortcut, and
 * next the Claude connector). Shown only to Dan: every request carries the
 * access key, checked on the server by /api/drafts. Visitors see nothing.
 *
 * - a small number above the Add Waypoint bar when drafts are waiting (hidden at zero)
 * - Inbox tray, same look as Scout's: cards with Accept / Delete, inspector
 * - /?tray=inbox opens the tray on load
 * Accept opens the add form already filled in (no re-identifying or re-geocoding);
 * saving the pin removes the draft.
 * ========================================================================== */
(function () {
  'use strict';

  const API = '/api/drafts';
  const $ = (sel, el) => (el || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const W = () => window.Waypoints || {};
  const getKey = () => { try { return localStorage.getItem('wp_addkey') || ''; } catch (e) { return ''; } };
  const saveKey = k => { try { if (k) localStorage.setItem('wp_addkey', k); } catch (e) {} };

  let drafts = [], selected = 0, tray = null, layer = null;
  const images = {};               // draft id → data URL of its screenshot

  async function api(action, extra) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action, password: getKey() }, extra || {})) });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { const err = new Error((data && data.error) || 'HTTP ' + res.status); err.status = res.status; throw err; }
    return data;
  }

  /* ------------- the draft count, a small box above Add Waypoint ------------ */
  // Only a number, only when it's above zero: click it to open the Inbox tray.
  const stack = $('.lower-left__stack');
  const badge = document.createElement('button');
  badge.type = 'button'; badge.className = 'inbox-badge'; badge.hidden = true;
  badge.innerHTML = '<span class="inbox-badge__n"></span>';
  badge.addEventListener('click', () => open());
  if (stack) stack.insertBefore(badge, stack.firstChild);

  async function refreshCount() {
    if (!getKey()) { badge.hidden = true; return; }   // visitors: no request, nothing shown
    try {
      const { count } = await api('count');
      $('.inbox-badge__n', badge).textContent = count;
      badge.setAttribute('aria-label', count + ' draft' + (count === 1 ? '' : 's') + ' in your inbox');
      badge.title = count + ' draft' + (count === 1 ? '' : 's') + ' waiting in your inbox';
      badge.hidden = !(count > 0);                    // never shows zero
    } catch (e) { badge.hidden = true; }              // wrong key, or the store isn't set up
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCount(); });

  /* --------------------------------- tray --------------------------------- */
  function buildTray() {
    const el = document.createElement('section');
    el.className = 'scout-tray inbox-tray'; el.setAttribute('aria-label', 'Inbox'); el.hidden = true;
    el.innerHTML =
      '<div class="scout-tray__handle" aria-hidden="true"><span></span></div>' +
      '<header class="scout-tray__head">' +
        '<span class="scout-tray__label"></span>' +
        '<span class="scout-tray__mode">Places you sent from your phone or Claude</span>' +
        '<button type="button" class="scout-tray__close" aria-label="Close inbox">&times;</button>' +
      '</header>' +
      '<div class="scout-tray__body"><div class="scout-cards" role="list"></div><div class="scout-detail"></div></div>';
    document.body.appendChild(el);
    $('.scout-tray__close', el).addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || el.hidden) return;
      const modal = document.getElementById('aw-modal');
      if (modal && !modal.hidden) return;
      close();
    });
    return { el, label: $('.scout-tray__label', el), cards: $('.scout-cards', el), detail: $('.scout-detail', el) };
  }

  async function open() {
    if (!tray) tray = buildTray();
    if (window.ScoutUI && window.ScoutUI.closeTray) window.ScoutUI.closeTray();   // one tray at a time
    if (W().closePanel) W().closePanel();
    tray.el.hidden = false;
    requestAnimationFrame(() => tray.el.classList.add('is-open'));
    tray.label.textContent = 'Inbox';
    if (!getKey()) { askForKey(); return; }
    tray.cards.innerHTML = ''; tray.detail.innerHTML = '<div class="scout-nothing"><p class="scout-nothing__why">Loading…</p></div>';
    try {
      drafts = (await api('list')).drafts || [];
    } catch (e) {
      drafts = [];
      if (e.status === 401) {                     // wrong key saved: forget it and ask again
        try { localStorage.removeItem('wp_addkey'); } catch (x) {}
        askForKey('That access key didn’t work. Try again.');
        return;
      }
      tray.detail.innerHTML = '<div class="scout-nothing"><p class="scout-nothing__why">Couldn’t load the inbox right now.</p></div>';
      tray.el.classList.add('is-empty');
      return;
    }
    refreshCount();
    selected = 0;
    render(true);
  }

  // No saved access key yet: ask inside the tray (browser pop-ups can be blocked silently).
  function askForKey(msg) {
    tray.el.classList.add('is-empty');
    tray.cards.innerHTML = '';
    tray.detail.innerHTML =
      '<form class="scout-nothing inbox-key">' +
        '<p class="scout-nothing__why">' + esc(msg || 'Enter your access key to open your inbox.') + '</p>' +
        '<div class="inbox-key__row"><input type="password" class="aw-key" placeholder="Access key" autocomplete="current-password" aria-label="Access key">' +
        '<button type="submit" class="aw-btn aw-btn--primary">Open inbox</button></div>' +
      '</form>';
    const form = $('form', tray.detail), input = $('input', form);
    input.focus();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const k = input.value.trim();
      if (!k) return;
      saveKey(k);
      refreshCount();
      open();
    });
  }

  function close() {
    if (!tray || tray.el.hidden) return;
    tray.el.classList.remove('is-open');
    setTimeout(() => { tray.el.hidden = true; }, 280);
    if (layer) { layer.remove(); layer = null; }
    if (/[?&]tray=inbox\b/.test(location.search)) history.replaceState(null, '', location.pathname);
    refreshCount();
  }

  function render(fit) {
    tray.label.textContent = 'Inbox (' + drafts.length + ')';
    if (!drafts.length) {
      tray.el.classList.add('is-empty');
      tray.cards.innerHTML = '';
      tray.detail.innerHTML = '<div class="scout-nothing"><p class="scout-nothing__line">Your inbox is empty.</p>' +
        '<p class="scout-nothing__why">Places you send from the Share menu, Siri or Claude wait here until you accept or delete them.</p></div>';
      drawMarkers(false);
      return;
    }
    tray.el.classList.remove('is-empty');
    if (selected >= drafts.length) selected = 0;
    tray.cards.innerHTML = drafts.map(cardHtml).join('');
    tray.cards.querySelectorAll('.scout-card').forEach(c => {
      const i = +c.dataset.i;
      c.addEventListener('click', () => select(i, true));
      c.addEventListener('keydown', e => { if (e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(i, true); } });
      wireActions(c, i);
    });
    drafts.forEach(loadImage);
    renderDetail();
    drawMarkers(fit);
  }

  const sourceLabel = d => 'Via ' + (d.source === 'claude' ? 'Claude' : d.source.charAt(0).toUpperCase() + d.source.slice(1));
  const titleOf = d => d.proposed && d.proposed.name ? d.proposed.name : 'Couldn’t identify';
  const sentText = d => (d.input.text && d.input.text !== d.input.url ? d.input.text : '') || d.input.url || (d.input.image ? 'An image' : '');

  function photoHtml(d, cls) {
    const src = d.proposed.photo === 'screenshot' ? images[d.id] : d.proposed.photo;
    if (src) return '<img class="' + cls + '" src="' + esc(src) + '" alt="" loading="lazy">';
    return '<div class="' + cls + ' scout-noimg inbox-noimg" data-photo="' + esc(d.id) + '"></div>';
  }

  function cardHtml(d, i) {
    return '<div role="listitem" tabindex="0" class="scout-card inbox-card' + (i === selected ? ' is-selected' : '') + (d.status === 'needs_review' ? ' is-review' : '') + '" data-i="' + i + '">' +
      photoHtml(d, 'scout-card__img') +
      '<span class="scout-card__name">' + esc(titleOf(d)) + '</span>' +
      '<span class="inbox-via">' + esc(sourceLabel(d)) + '</span>' +
      '<span class="scout-card__sum">' + esc(d.status === 'possible_duplicate' ? 'Possible duplicate of ' + d.duplicate_name : (d.proposed.area || sentText(d))) + '</span>' +
      '<span class="scout-card__actions">' + actionButtons() + '</span>' +
    '</div>';
  }
  const actionButtons = () => '<button type="button" class="scout-mini scout-mini--primary" data-act="accept">Accept</button>' +
    '<button type="button" class="scout-mini" data-act="delete">Delete</button>';

  function wireActions(root, i) {
    root.querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (i !== selected) select(i, false);
        if (b.dataset.act === 'accept') accept(drafts[i]);
        else remove(drafts[i], 'delete');
      });
    });
  }

  function select(i, fly) {
    selected = i;
    tray.cards.querySelectorAll('.scout-card').forEach(c => c.classList.toggle('is-selected', +c.dataset.i === i));
    renderDetail();
    drawMarkers(false);
    const d = drafts[i];
    if (fly && d && typeof d.proposed.lat === 'number' && W().map) W().map.panTo([d.proposed.lat, d.proposed.lng], { animate: true });
  }

  function renderDetail() {
    const d = drafts[selected];
    if (!d) { tray.detail.innerHTML = ''; return; }
    const sent = d.input;
    const status = d.status === 'needs_review'
      ? '<p class="inbox-note">' + (d.proposed.name ? 'Waypoints couldn’t find where this is on the map.' : 'Waypoints couldn’t tell which place this is.') + ' Accept opens the add form with what you sent, so you can fix it.</p>'
      : d.status === 'possible_duplicate'
        ? '<p class="inbox-note">Possible duplicate of <a href="#" class="p-link" data-pin="' + esc(d.duplicate_of) + '">' + esc(d.duplicate_name) + '</a>.</p>'
        : '';
    tray.detail.innerHTML =
      '<div class="scout-detail__bar"><div class="scout-detail__barrow">' +
        '<h3 class="scout-detail__name">' + esc(titleOf(d)) + '</h3>' +
        '<span class="scout-detail__actions">' + actionButtons() + '</span>' +
      '</div></div>' +
      '<div class="scout-detail__pad">' +
        '<p class="scout-detail__place">' + esc([d.proposed.area, sourceLabel(d)].filter(Boolean).join(' · ')) + '</p>' +
        status +
        (d.proposed.notes && d.proposed.name ? '<h4>What it is</h4><p>' + esc(d.proposed.notes) + '</p>' : '') +
        '<h4>What you sent</h4>' +
        (sent.text && sent.text !== sent.url ? '<p>' + esc(sent.text) + '</p>' : '') +
        (sent.url ? '<p><a class="p-link" href="' + esc(sent.url) + '" target="_blank" rel="noopener">' + esc(sent.url) + '</a></p>' : '') +
        (sent.image ? '<p class="scout-muted">An image' + (d.proposed.photo === 'screenshot' ? ' (it becomes the pin’s photo)' : '') + '</p>' : '') +
        '<p class="inbox-when">' + esc(when(d.created_at)) + '</p>' +
      '</div>';
    wireActions($('.scout-detail__actions', tray.detail), selected);
    tray.detail.querySelectorAll('[data-pin]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); if (W().flyTo) W().flyTo(a.dataset.pin); }));
  }

  function when(iso) {
    const t = Date.parse(iso); if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    return 'Sent ' + (m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago');
  }

  async function loadImage(d) {
    if (d.proposed.photo !== 'screenshot' || images[d.id] !== undefined) return;
    images[d.id] = '';
    try {
      images[d.id] = (await api('image', { id: d.id })).image || '';
      if (images[d.id] && tray && !tray.el.hidden) {
        tray.el.querySelectorAll('[data-photo="' + d.id + '"]').forEach(ph => {
          const img = document.createElement('img'); img.className = ph.className.replace(/\s*scout-noimg|\s*inbox-noimg/g, ''); img.src = images[d.id]; img.alt = '';
          ph.replaceWith(img);
        });
      }
    } catch (e) { /* keep the colour block */ }
  }

  /* -------------------------------- actions ------------------------------- */
  async function accept(d) {
    if (!window.WaypointsAdd) return;
    const done = async () => {
      if (W().closePanel) W().closePanel();       // the add flow opens the new pin's panel
      await remove(d, 'accepted');
    };
    const located = d.status !== 'needs_review' && typeof d.proposed.lat === 'number';
    if (!located) {
      window.WaypointsAdd.openPrefilled({ text: sentText(d), fromInbox: true, onCommitted: done });
      return;
    }
    if (d.proposed.photo === 'screenshot' && !images[d.id]) await loadImage(d);
    window.WaypointsAdd.openPrefilled({
      record: d.proposed.record,
      imageDataUrl: d.proposed.photo === 'screenshot' ? images[d.id] : '',
      imageUrl: d.proposed.photo !== 'screenshot' ? d.proposed.photo : '',
      onCommitted: done
    });
  }

  async function remove(d, action) {
    try { await api(action, { id: d.id }); }
    catch (e) { alert('Couldn’t ' + (action === 'delete' ? 'delete' : 'clear') + ' that draft: ' + e.message); return; }
    drafts = drafts.filter(x => x.id !== d.id);
    delete images[d.id];
    if (tray && !tray.el.hidden) render(false);
    refreshCount();
  }

  /* ---------------------------- map markers ------------------------------- */
  function drawMarkers(fit) {
    const map = W().map;
    if (!map) return;
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const pts = [];
    drafts.forEach((d, i) => {
      if (typeof d.proposed.lat !== 'number') return;
      const m = L.marker([d.proposed.lat, d.proposed.lng], {
        icon: L.divIcon({ className: '', html: '<div class="scout-marker' + (i === selected ? ' is-selected' : '') + '"><span>' + (i + 1) + '</span></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: d.proposed.name, zIndexOffset: i === selected ? 1000 : 500
      }).addTo(layer);
      m.on('click', () => select(i, false));
      pts.push([d.proposed.lat, d.proposed.lng]);
    });
    if (fit && pts.length) {
      const trayH = tray.el.getBoundingClientRect().height || innerHeight * 0.45;
      map.fitBounds(pts, { paddingTopLeft: [60, 70], paddingBottomRight: [60, trayH + 30], maxZoom: 12 });
    }
  }

  window.InboxUI = { open, close, refresh: refreshCount };

  // Wait for the map, then show the count (and open the tray for /?tray=inbox).
  (function ready(n) {
    if (W().map) {
      refreshCount();
      if (/[?&]tray=inbox\b/.test(location.search)) open();
    } else if (n < 100) setTimeout(() => ready(n + 1), 100);
  })(0);
})();
