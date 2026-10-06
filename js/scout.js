/* ============================================================================
 * WAYPOINTS — Pin Scout + Area Scout (buttons, agent loop, tray)
 * The loop runs here; each step is one POST to /api/scout, which holds the key
 * and pins the model. Client tools + the submit_findings rules live in
 * js/scout-tools.js. Nothing reaches the map unless Dan accepts it, and Accept
 * goes through the normal Add Waypoint form.
 * ========================================================================== */
(function () {
  'use strict';

  const API = '/api/scout';
  const STEP_LIMIT = 20;
  const DETOUR_KM = 60;
  const ICON = 'images/scout-icon.png';
  // Claude Sonnet 5.5, $ per million tokens; web search $10 per 1,000
  const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10, search: 0.01 };
  const REJECT_CHIPS = ['Not my taste', 'Too far', 'Been there', 'Wrong info', 'Other'];
  const REASON_LABEL = {
    unverified_location: 'Unverified location', sources_disagree: 'Sources disagree', duplicate: 'Already pinned',
    too_far: 'Too far', outside_view: 'Outside view', vague_thread: 'Weak evidence', no_thread: 'No thread',
    closed_or_gone: 'Closed or gone', tourist_trap: 'Tourist trap', weak_fit: 'Weak fit', already_decided: 'Already decided'
  };
  const FUN = {
    found: [
      'Scout went out with a lantern and came back with {n}.',
      'Scout knocked on {c} doors. {n} answered.',
      "Scout read {s} pages so you don't have to. {n} worth the detour.",
      'Scout wandered {place} and brought back {n} souvenirs.',
      'Scout checked {c} leads and believed {n} of them.'
    ],
    nothing: [
      "Scout came back empty-handed and isn't embarrassed about it.",
      'Scout looked under every rock in {place}. Just rocks.',
      'Nothing here good enough for your map. Scout has standards.'
    ]
  };

  const $ = (sel, el) => (el || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const W = () => window.Waypoints || {};

  let run = null;        // the active or last-finished run
  let tray = null;       // tray DOM refs

  /* ============================== the button ============================== */
  // Fill the #p-scout slot every time a pin panel opens.
  document.addEventListener('waypoints:panel', e => renderPanelSlot(e.detail));

  function iconHtml() {
    return '<img class="scout-btn__icon" src="' + ICON + '" alt="" ' +
      'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'scout-btn__glyph\',textContent:\'✣\'}))">';
  }

  function renderPanelSlot(poi) {
    const slot = $('#p-scout');
    if (!slot || !poi) return;
    slot.dataset.pin = poi.id;
    const busyHere = run && run.running && run.mode === 'pin' && run.anchor.id === poi.id;
    const busyElsewhere = run && run.running && !busyHere;
    const tip = busyHere ? 'Stop Pin Scout' : busyElsewhere ? label() + ' is busy ' + scopeText() : 'Scout around this pin';
    slot.innerHTML =
      '<button type="button" class="scout-btn' + (busyHere ? ' is-running' : '') + '" ' +
        'aria-label="' + esc(tip) + '" title="' + esc(tip) + '"' + (busyElsewhere ? ' disabled' : '') + '>' +
        iconHtml() + '<span class="scout-btn__stop">Stop</span></button>' +
      '<div class="scout-slot__text">' +
        '<span class="scout-slot__label">Pin Scout</span>' +
        '<span class="scout-slot__status" aria-live="polite">' +
          esc(busyHere ? run.status : busyElsewhere ? 'Busy ' + scopeText() : 'Places worth a detour near here') +
        '</span>' +
      '</div>';
    $('.scout-btn', slot).addEventListener('click', () => {
      if (run && run.running) { stopRun(); return; }
      startRun({ mode: 'pin', anchor: poi });
    });
  }

  const label = () => (run && run.mode === 'area') ? 'Area Scout' : 'Pin Scout';
  const scopeText = () => run ? (run.mode === 'area' ? 'across ' : 'around ') + run.anchor.name : '';

  /* ---------------------- Area Scout: the map button ---------------------- */
  // Always on the map, under the zoom control and compass. Scouts the view.
  const mapBtn = document.createElement('div');
  mapBtn.className = 'scout-map';
  mapBtn.innerHTML =
    '<button type="button" class="scout-btn" aria-label="Scout this area" title="Scout this area">' +
      iconHtml() + '<span class="scout-btn__stop">Stop</span></button>' +
    '<span class="scout-map__status" aria-live="polite" hidden></span>' +
    '<button type="button" class="scout-map__last" hidden></button>';
  document.body.appendChild(mapBtn);
  $('.scout-btn', mapBtn).addEventListener('click', async () => {
    if (run && run.running) { stopRun(); return; }
    if (!W().map) return;
    startRun({ mode: 'area', area: await viewArea() });
  });

  $('.scout-map__last', mapBtn).addEventListener('click', () => { if (run && run.result && !run.running) openTray(true); });

  function renderMapBtn(trayClosed) {
    const b = $('.scout-btn', mapBtn), st = $('.scout-map__status', mapBtn);
    const last = $('.scout-map__last', mapBtn);
    const trayOpen = !trayClosed && tray && !tray.el.hidden;
    const showLast = run && !run.running && run.result && !trayOpen;
    last.hidden = !showLast;
    if (showLast) {
      const open = run.result.suggestions.filter(x => !x._decided).length;
      last.textContent = 'Last results' + (open ? ' (' + open + ' to decide)' : '');
      last.title = (run.mode === 'area' ? 'Area Scout across ' : 'Pin Scout around ') + run.anchor.name;
    }
    const mine = run && run.running && run.mode === 'area';
    const other = run && run.running && !mine;
    b.classList.toggle('is-running', !!mine);
    b.disabled = !!other;
    const tip = mine ? 'Stop Area Scout' : other ? label() + ' is busy ' + scopeText() : 'Scout this area';
    b.title = tip; b.setAttribute('aria-label', tip);
    st.hidden = !mine;
    if (mine) st.textContent = run.status;
  }

  // The view Dan is looking at: its bounds plus a name. If the active flag's
  // country fills most of the view, use its name; otherwise ask Nominatim.
  async function viewArea() {
    const map = W().map, b = map.getBounds(), c = b.getCenter(), z = map.getZoom();
    const bounds = { s: +b.getSouth().toFixed(4), w: +b.getWest().toFixed(4), n: +b.getNorth().toFixed(4), e: +b.getEast().toFixed(4) };
    const reg = W().activeRegion ? W().activeRegion() : null;
    let name = '', country = '';
    if (reg && !reg.all && reg.bounds) {
      // the country counts as "the view" until you zoom more than one level past fitting it
      const rb = L.latLngBounds(reg.bounds);
      if (b.contains(rb.getCenter()) && z <= map.getBoundsZoom(rb) + 1) { name = reg.label; country = reg.label; }
    }
    if (!name && ScoutTools.distanceKm(bounds.s, bounds.w, bounds.n, bounds.e) > 2500) name = 'the map view';
    if (!name) {
      try {
        const key = getKey() || (window.prompt('Access key for Area Scout:') || '').trim();
        if (key) saveKey(key);
        const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reverse', password: key, lat: c.lat, lng: c.lng, zoom: z }) });
        const j = r.ok ? await r.json() : {};
        name = j.name || ''; country = j.country || '';
      } catch (e) { /* fall through */ }
    }
    return { name: name || 'the map view', country, bounds, center: { lat: c.lat, lng: c.lng }, zoom: z };
  }

  function setStatus(text) {
    if (!run) return;
    run.status = text;
    const slot = $('#p-scout');
    if (slot && slot.isConnected) {
      const st = $('.scout-slot__status', slot); if (st) st.textContent = text;
    }
    renderMapBtn();
    // Pin Scout: the pill stands in for the panel's status line when the panel is closed.
    // Area Scout shows its status under the map button instead.
    const pill = pillEl();
    const panel = document.getElementById('panel');
    pill.hidden = !run.running || run.mode === 'area' ||
      (panel && panel.classList.contains('is-open') && slot && slot.dataset.pin === run.anchor.id);
    $('.scout-pill__text', pill).textContent = text;
  }

  let _pill;
  function pillEl() {
    if (_pill) return _pill;
    _pill = document.createElement('div');
    _pill.className = 'scout-pill'; _pill.hidden = true;
    _pill.innerHTML = '<span class="scout-pill__dot"></span><span class="scout-pill__text"></span>' +
      '<button type="button" class="scout-pill__stop">Stop</button>';
    $('.scout-pill__stop', _pill).addEventListener('click', stopRun);
    document.body.appendChild(_pill);
    return _pill;
  }

  /* ============================== access key ============================== */
  function getKey() { try { return localStorage.getItem('wp_addkey') || ''; } catch (e) { return ''; } }
  function saveKey(k) { try { if (k) localStorage.setItem('wp_addkey', k); } catch (e) {} }
  function forgetKey() { try { localStorage.removeItem('wp_addkey'); } catch (e) {} }

  async function server(action, body) {
    const res = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action, password: run ? run.key : getKey() }, body))
    });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (res.status === 401) { forgetKey(); throw new Error('Access key missing or incorrect.'); }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  /* ================================ the loop ============================== */
  async function startRun(opts) {
    const mode = opts.mode;
    let key = getKey();
    if (!key) { key = (window.prompt('Access key for ' + (mode === 'area' ? 'Area' : 'Pin') + ' Scout:') || '').trim(); if (!key) return; }
    saveKey(key);

    const pins = W().pins();
    // Area Scout has no pin; a stand-in anchor carries the view's name and centre.
    const anchor = mode === 'pin' ? opts.anchor : {
      id: 'area', name: opts.area.name, region: opts.area.name, country: opts.area.country,
      lat: opts.area.center.lat, lng: opts.area.center.lng
    };
    run = {
      mode, area: opts.area, anchor, key, pins,
      running: true, stopped: false,
      status: 'Scout is reading your pins…',
      startedAt: Date.now(),
      log: [], steps: 0, searches: 0,
      tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
      models: new Set(), bytesSent: 0,
      tools: ScoutTools.createRun({ mode, pins, anchor, area: opts.area, detourKm: DETOUR_KM, server }),
      result: null, outcome: null, error: ''
    };
    closeTray();
    if (mode === 'area' && W().closePanel) W().closePanel();
    refreshSlotFor(anchor);
    setStatus('Scout is reading your pins…');

    logLine('start', mode === 'pin'
      ? 'Pin Scout around ' + anchor.name + ' (' + anchor.id + '), detour limit ' + DETOUR_KM + ' km.'
      : 'Area Scout across ' + anchor.name + ' (zoom ' + opts.area.zoom + ', bounds ' + JSON.stringify(opts.area.bounds) + ').');
    ScoutTools.duplicatePinGroups(pins).forEach(g =>
      logLine('flag', 'Existing duplicate pins on the map: ' + g.ids.join(' ↔ ') + ' (' + g.names.join(' / ') + ', ' + g.km + ' km apart). Not fixed; flagged for you.'));

    let intro;
    if (mode === 'pin') {
      const pinCopy = Object.assign({}, anchor); delete pinCopy._previewSrc;
      intro = 'Mode: Pin Scout around ' + anchor.name + ' (pin id "' + anchor.id + '").\n' +
        'Detour limit: ' + DETOUR_KM + ' km from this pin.\n\nThe pin:\n' + JSON.stringify(pinCopy, null, 2);
    } else {
      const b = opts.area.bounds;
      intro = 'Mode: Area Scout across ' + anchor.name + '.\n' +
        'View bounds: south ' + b.s + ', west ' + b.w + ', north ' + b.n + ', east ' + b.e + '. Every suggestion must sit inside them.\n' +
        'Up to 10 places. Start with pins_in_view.';
    }
    const messages = [{ role: 'user', content: intro }];

    let nudged = false;
    try {
      while (run.steps < STEP_LIMIT && !run.stopped) {
        run.steps++;
        setStatus(run.steps === 1 ? 'Scout is reading your pins…' : 'Scout is following a lead…');
        const payload = JSON.stringify({ messages, searchesUsed: run.searches });
        run.bytesSent = Math.max(run.bytesSent, payload.length);
        const r = await server('step', { messages, mode, searchesUsed: run.searches });
        tally(r);
        run.tools.noteSearchResults(r.content);
        messages.push({ role: 'assistant', content: r.content });
        logAssistant(r.content);

        if (r.stop_reason === 'refusal') {
          run.error = 'Scout declined this one' + (r.stop_details && r.stop_details.category ? ' (' + r.stop_details.category + ')' : '') + '.';
          logLine('error', run.error); break;
        }
        if (r.stop_reason === 'pause_turn') continue;    // server-side search loop paused; resend as-is
        if (r.stop_reason === 'max_tokens') { run.error = 'Scout ran out of room mid-step.'; logLine('error', run.error); break; }

        const calls = r.content.filter(b => b.type === 'tool_use');
        if (!calls.length) {
          if (run.tools.finalResult() || nudged) break;
          nudged = true;
          messages.push({ role: 'user', content: 'Finish by calling submit_findings.' });
          logLine('note', 'Nudged Scout to call submit_findings.');
          continue;
        }

        const results = [];
        let done = false;
        for (const c of calls) {
          setStatus(statusFor(c.name));
          let out;
          try { out = await run.tools.exec(c.name, c.input); }
          catch (err) { out = { content: String(err.message || err), isError: true }; }
          logTool(c, out);
          results.push({
            type: 'tool_result', tool_use_id: c.id,
            content: typeof out.content === 'string' ? out.content : JSON.stringify(out.content),
            is_error: !!out.isError
          });
          if (out.done) done = true;
        }
        if (!done && run.searches >= r.searchCap) {
          results.push({ type: 'text', text: 'Search budget used (' + run.searches + '/' + r.searchCap + '). Do not search again; verify what you have and call submit_findings.' });
        }
        messages.push({ role: 'user', content: results });
        if (done) break;
      }
      if (!run.stopped && run.steps >= STEP_LIMIT && !run.tools.finalResult()) {
        run.error = 'Scout hit the ' + STEP_LIMIT + '-step limit before finishing.';
        logLine('error', run.error);
      }
    } catch (err) {
      run.error = String(err.message || err);
      logLine('error', run.error);
    }

    run.result = run.tools.finalResult();
    if (run.stopped) logLine('note', 'Stopped by you after step ' + run.steps + '.');

    if (run.result && run.result.suggestions.length) {
      setStatus('Scout is finding photos…');
      await Promise.all(run.result.suggestions.map(fetchImage));
    }
    run.running = false;
    run.finishedAt = Date.now();
    pillEl().hidden = true;
    renderMapBtn();
    refreshSlotFor(anchor);
    logLine('end', totalsLine() + ' · largest request ' + Math.round(run.bytesSent / 1024) + ' KB');
    openTray();
  }

  function stopRun() {
    if (!run || !run.running) return;
    run.stopped = true;
    setStatus('Stopping after this step…');
  }

  function refreshSlotFor(anchor) {
    const slot = $('#p-scout');
    const pin = slot && slot.isConnected && slot.dataset.pin && W().pins().find(p => p.id === slot.dataset.pin);
    if (pin) renderPanelSlot(pin);
  }

  function statusFor(tool) {
    return {
      search_my_pins: 'Scout is reading your pins…', get_pin: 'Scout is reading your pins…',
      geocode: 'Scout is checking a lead…', check_duplicate: 'Scout is checking a lead…',
      distance_km: 'Scout is checking a lead…', past_decisions: 'Scout is checking your past decisions…',
      submit_findings: 'Scout is writing it up…'
    }[tool] || 'Scout is working…';
  }

  async function fetchImage(s) {
    if (s.image !== undefined) return;
    try {
      const ctx = run.mode === 'area' ? shortPlace(s.place).split(', ') : [run.anchor.region, run.anchor.country];
      const r = await server('image', { name: s.name, region: ctx[0] || '', country: ctx[1] || run.anchor.country || '' });
      s.image = (r && r.url) || '';
    } catch (e) { s.image = ''; }
  }

  /* ================================ the log =============================== */
  function logLine(kind, text) { run.log.push({ t: Date.now() - run.startedAt, kind, text }); }

  function tally(r) {
    const u = r.usage || {};
    run.tokens.input += u.input_tokens || 0;
    run.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
    run.tokens.cacheRead += u.cache_read_input_tokens || 0;
    run.tokens.output += u.output_tokens || 0;
    const s = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    run.searches += s;
    if (r.model) run.models.add(r.model);
    logLine('step', 'Step ' + run.steps + ': ' + (u.input_tokens || 0) + ' in (+' + (u.cache_read_input_tokens || 0) + ' cached), ' +
      (u.output_tokens || 0) + ' out' + (s ? ', ' + s + ' search' + (s > 1 ? 'es' : '') : '') + ' · ' + r.stop_reason);
  }

  function logAssistant(content) {
    content.forEach(b => {
      if (b.type === 'server_tool_use' && b.name === 'web_search') logLine('search', 'Searched: ' + ((b.input && b.input.query) || ''));
      else if (b.type === 'web_search_tool_result') {
        if (Array.isArray(b.content)) logLine('result', b.content.length + ' results: ' + b.content.slice(0, 4).map(x => x.title || x.url).join(' · '));
        else logLine('error', 'Search error: ' + ((b.content && b.content.error_code) || 'unknown'));
      } else if (b.type === 'text' && b.text && b.text.trim()) logLine('say', b.text.trim().slice(0, 400));
    });
  }

  function logTool(call, out) {
    const inp = JSON.stringify(call.input || {});
    let res = typeof out.content === 'string' ? out.content : JSON.stringify(out.content);
    if (res.length > 300) res = res.slice(0, 300) + '…';
    logLine(out.isError ? 'tool-err' : 'tool', call.name + ' ' + (inp.length > 200 ? inp.slice(0, 200) + '…' : inp) + ' → ' + res);
  }

  function cost() {
    const t = run.tokens;
    return (t.input * PRICE.input + t.cacheWrite * PRICE.cacheWrite + t.cacheRead * PRICE.cacheRead + t.output * PRICE.output) / 1e6
      + run.searches * PRICE.search;
  }
  function totalsLine() {
    const t = run.tokens;
    return run.steps + ' steps · ' + run.searches + ' searches · ' +
      (t.input + t.cacheWrite + t.cacheRead).toLocaleString() + ' tokens in (' + t.cacheRead.toLocaleString() + ' cached) · ' +
      t.output.toLocaleString() + ' out · ~$' + cost().toFixed(3) + ' · ' + Math.round(((run.finishedAt || Date.now()) - run.startedAt) / 1000) + 's' +
      (run.models.size ? ' · ' + Array.from(run.models).join(', ') : '');
  }
  function logText() {
    return label() + ' log: ' + run.anchor.name + '\n' + run.log.map(l =>
      '[' + (l.t / 1000).toFixed(1).padStart(6) + 's] ' + l.kind.padEnd(8) + ' ' + l.text).join('\n') + '\n\nTotals: ' + totalsLine();
  }

  /* =============================== decisions ============================= */
  async function decide(item, decision, reason) {
    const s = item.suggestion || item;
    try {
      await server('decide', {
        mode: run.mode, scope: run.mode === 'area' ? run.anchor.name : run.anchor.id, name: s.name,
        lat: typeof s.lat === 'number' ? s.lat : undefined, lng: typeof s.lng === 'number' ? s.lng : undefined,
        decision, reason: reason || ''
      });
      return true;
    } catch (err) { toast('Could not save that decision: ' + (err.message || err), true); return false; }
  }

  /* ================================ the tray ============================== */
  function buildTray() {
    const el = document.createElement('section');
    el.className = 'scout-tray'; el.setAttribute('aria-label', 'Scout results'); el.hidden = true;
    el.innerHTML =
      '<div class="scout-tray__handle" role="separator" aria-label="Drag to resize" tabindex="0"><span></span></div>' +
      '<header class="scout-tray__head">' +
        '<span class="scout-tray__label"></span>' +
        '<span class="scout-tray__fun"></span>' +
        '<span class="scout-tray__mode"></span>' +
        '<div class="scout-seg" role="tablist">' +
          '<button type="button" role="tab" data-seg="suggestions"></button>' +
          '<button type="button" role="tab" data-seg="rejected"></button>' +
        '</div>' +
        '<button type="button" class="scout-tray__close" aria-label="Close Scout results">&times;</button>' +
      '</header>' +
      '<div class="scout-tray__body">' +
        '<div class="scout-cards" role="list"></div>' +
        '<div class="scout-detail"></div>' +
      '</div>' +
      '<footer class="scout-tray__foot"><button type="button" class="scout-howlink">How Scout got here</button><span class="scout-tray__totals"></span></footer>' +
      '<div class="scout-log" hidden>' +
        '<div class="scout-log__bar"><strong>How Scout got here</strong><span class="scout-log__totals"></span>' +
        '<button type="button" class="aw-btn aw-btn--ghost scout-log__copy">Copy log</button>' +
        '<button type="button" class="scout-tray__close scout-log__close" aria-label="Close log">&times;</button></div>' +
        '<ol class="scout-log__list"></ol>' +
      '</div>';
    document.body.appendChild(el);
    const t = {
      el, fun: $('.scout-tray__fun', el), mode: $('.scout-tray__mode', el), seg: $('.scout-seg', el),
      cards: $('.scout-cards', el), detail: $('.scout-detail', el), totals: $('.scout-tray__totals', el),
      log: $('.scout-log', el), logList: $('.scout-log__list', el), logTotals: $('.scout-log__totals', el),
      segName: 'suggestions', selected: 0, layer: null, markers: []
    };
    $('.scout-tray__close', el).addEventListener('click', closeTray);
    t.seg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { t.segName = b.dataset.seg; t.selected = 0; renderTray(); } });
    $('.scout-howlink', el).addEventListener('click', openLog);
    $('.scout-log__close', el).addEventListener('click', () => { t.log.hidden = true; });
    $('.scout-log__copy', el).addEventListener('click', () => {
      navigator.clipboard && navigator.clipboard.writeText(logText()).then(() => toast('Log copied'));
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || el.hidden) return;
      const modal = document.getElementById('aw-modal');
      if (modal && !modal.hidden) return;                 // let the add form close first
      if (!t.log.hidden) { t.log.hidden = true; return; }
      closeTray();
    });
    wireHandle(t, $('.scout-tray__handle', el));
    return t;
  }

  // Drag the handle to resize; a tap toggles between half and nearly full height.
  function wireHandle(t, handle) {
    let startY = 0, startH = 0, moved = false;
    const clamp = h => Math.max(innerHeight * 0.2, Math.min(innerHeight * 0.92, h));
    handle.addEventListener('pointerdown', e => {
      startY = e.clientY; startH = t.el.getBoundingClientRect().height; moved = false;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 4) moved = true;
      if (moved) t.el.style.height = clamp(startH + dy) + 'px';
    });
    handle.addEventListener('pointerup', e => {
      handle.releasePointerCapture(e.pointerId);
      if (!moved) toggleHeight(t);
    });
    handle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHeight(t); } });
  }
  function toggleHeight(t) {
    const tall = t.el.getBoundingClientRect().height > innerHeight * 0.6;
    t.el.style.height = tall ? '' : '85vh';
  }

  function openTray(restoring) {
    if (!tray) tray = buildTray();
    const r = run.result;
    if (!restoring || !run.fun) {
      run.outcome = r && r.suggestions.length ? 'found' : 'nothing';
      run.fun = funLine();
    }
    tray.segName = 'suggestions'; tray.selected = 0;
    tray.log.hidden = true;
    if (W().closePanel) W().closePanel();
    tray.el.hidden = false;
    requestAnimationFrame(() => tray.el.classList.add('is-open'));
    renderTray();
    drawMarkers(true);
    saveRun(true);
    renderMapBtn();
  }

  function closeTray() {
    if (!tray || tray.el.hidden) return;
    tray.el.classList.remove('is-open');
    setTimeout(() => { tray.el.hidden = true; tray.el.style.height = ''; }, 280);
    if (tray.layer) { tray.layer.remove(); tray.layer = null; }
    saveRun(false);
    renderMapBtn(true);
  }

  /* ===================== keep the last run across reloads ================= */
  // Per-browser convenience: the last run (results, decisions so far, log) is
  // kept so a refresh doesn't lose undecided suggestions.
  const STORE = 'wp_scout_last';
  let trayWasOpen = false;
  function saveRun(open) {
    if (!run || run.running || !run.result) return;
    if (typeof open === 'boolean') trayWasOpen = open;
    const anchor = Object.assign({}, run.anchor); delete anchor._previewSrc;
    try {
      localStorage.setItem(STORE, JSON.stringify({
        v: 1, mode: run.mode, area: run.area, anchor, result: run.result, fun: run.fun, outcome: run.outcome,
        steps: run.steps, searches: run.searches, tokens: run.tokens, log: run.log, models: Array.from(run.models || []),
        startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error, stopped: run.stopped, trayOpen: trayWasOpen
      }));
    } catch (e) { /* storage full or blocked: results just won't survive a reload */ }
  }
  function restoreRun() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) {}
    if (!saved || saved.v !== 1 || !saved.result || run) return;
    run = Object.assign({}, saved, {
      running: false, models: new Set(saved.models || []), pins: W().pins(), key: getKey(), bytesSent: 0,
      tools: null
    });
    trayWasOpen = !!saved.trayOpen;
    if (trayWasOpen) openTray(true); else renderMapBtn(true);
  }
  // app.js loads data asynchronously; restore once the map exists
  (function waitForMap(n) {
    if (W().map && W().pins) restoreRun();
    else if (n < 100) setTimeout(() => waitForMap(n + 1), 100);
  })(0);

  function funLine() {
    const r = run.result;
    const set = FUN[run.outcome];
    const line = set[Math.floor(Math.random() * set.length)];
    return line.replace('{n}', r ? r.suggestions.length : 0)
      .replace('{c}', r ? (r.headline_facts.considered || 0) : 0)
      .replace('{s}', run.searches)
      .replace('{place}', placeName(run.anchor));
  }
  function placeName(p) { return p.region || p.subregion || p.name; }

  function items() {
    const r = run.result;
    if (!r) return [];
    return tray.segName === 'suggestions' ? r.suggestions : r.rejected;
  }

  function renderTray() {
    const r = run.result;
    tray.fun.textContent = run.error && !r ? run.error : run.fun;
    $('.scout-tray__label', tray.el).textContent = label();
    tray.mode.textContent = (run.mode === 'area' ? 'Across ' : 'Around ') + run.anchor.name;
    const nS = r ? r.suggestions.length : 0, nR = r ? r.rejected.length : 0;
    const [bS, bR] = tray.seg.querySelectorAll('button');
    bS.textContent = 'Suggestions (' + nS + ')'; bR.textContent = 'Rejected (' + nR + ')';
    bS.classList.toggle('is-active', tray.segName === 'suggestions');
    bR.classList.toggle('is-active', tray.segName === 'rejected');
    bS.setAttribute('aria-selected', tray.segName === 'suggestions');
    bR.setAttribute('aria-selected', tray.segName === 'rejected');
    tray.totals.textContent = run.steps + ' steps · ' + run.searches + ' searches · ~$' + cost().toFixed(2);

    const list = items();
    if (!list.length) {
      tray.el.classList.add('is-empty');
      tray.cards.innerHTML = '';
      tray.detail.innerHTML = tray.segName === 'suggestions' ? nothingHtml() :
        '<div class="scout-nothing"><p class="scout-nothing__line">Scout rejected nothing on this run.</p></div>';
      return;
    }
    tray.el.classList.remove('is-empty');
    if (tray.selected >= list.length) tray.selected = 0;
    tray.cards.innerHTML = list.map((it, i) => cardHtml(it, i)).join('');
    tray.cards.querySelectorAll('.scout-card').forEach(c => {
      const i = +c.dataset.i;
      c.addEventListener('click', () => select(i, true));
      c.addEventListener('keydown', e => { if (e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(i, true); } });
      wireActions(c, list[i], i);
    });
    renderDetail();
  }

  function nothingHtml() {
    const r = run.result;
    const considered = r ? (r.headline_facts.considered || 0) : 0;
    const why = r ? r.nothing_reason : (run.stopped ? 'You stopped the run before Scout finished.' : (run.error || 'Scout did not finish.'));
    return '<div class="scout-nothing">' +
      '<p class="scout-nothing__line">' + esc(run.fun) + '</p>' +
      '<p class="scout-nothing__why">' + esc(why) + '</p>' +
      '<p class="scout-nothing__meta">' + considered + ' place' + (considered === 1 ? '' : 's') + ' considered · ' + run.searches + ' searches</p>' +
      '</div>';
  }

  function sug(it) { return it.suggestion || (tray.segName === 'suggestions' ? it : null); }

  function colorBlock() {
    const cats = W().categories || {};
    return (cats[run.anchor.category] || {}).color || '#B9824F';
  }

  function photoHtml(s, cls) {
    if (s && s.image) return '<img class="' + cls + '" src="' + esc(s.image) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;' + cls + ' scout-noimg&quot; style=&quot;background:' + colorBlock() + '&quot;></div>\'">';
    return '<div class="' + cls + ' scout-noimg" style="background:' + colorBlock() + '"></div>';
  }

  function cardHtml(it, i) {
    const s = sug(it);
    const rejectedSeg = tray.segName === 'rejected';
    const chip = rejectedSeg
      ? '<span class="scout-chip scout-chip--reason">' + esc(REASON_LABEL[it.reason] || it.reason) + '</span>'
      : '<span class="scout-chip">' + esc(s && typeof s.km === 'number' ? s.km + ' km' : s ? (s.locality || shortPlace(s.place).split(', ')[0]) : '') + '</span>';
    const status = it._decided ? '<span class="scout-card__badge scout-card__badge--' + it._decided + '">' + esc(it._decided) + '</span>' : '';
    return '<div role="listitem" tabindex="0" class="scout-card' + (i === tray.selected ? ' is-selected' : '') + '" data-i="' + i + '">' +
      photoHtml(s, 'scout-card__img') + status +
      '<span class="scout-card__name">' + esc(it.name) + '</span>' + chip +
      '<span class="scout-card__sum">' + esc(rejectedSeg ? it.note : (s && s.summary) || '') + '</span>' +
      '<span class="scout-card__actions">' + actionButtons(it) + '</span>' +
      '</div>';
  }

  // Small Accept / Reject (or Overrule) buttons, shared by the cards and the inspector.
  function actionButtons(it) {
    if (it._decided) return '<span class="scout-card__done">' + esc(decidedText(it)) + '</span>';
    if (tray.segName === 'rejected') return '<button type="button" class="scout-mini" data-act="overrule">Overrule</button>';
    return '<button type="button" class="scout-mini scout-mini--primary" data-act="accept">Accept</button>' +
      '<button type="button" class="scout-mini" data-act="reject">Reject</button>';
  }
  function decidedText(it) {
    return it._decided === 'accepted' ? 'Accepted' : it._decided === 'rejected' ? 'Rejected' + (it._reason ? ': ' + it._reason : '') : 'Overruled';
  }

  // Wire the action buttons inside one card or the inspector bar.
  function wireActions(root, it, i) {
    root.querySelectorAll('[data-act]').forEach(b => {
      // don't let the press move focus: in some browsers that scrolls the row and the click misses
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (i !== tray.selected) select(i, false);
        if (b.dataset.act === 'accept') accept(it);
        else if (b.dataset.act === 'overrule') overrule(it);
        else if (b.dataset.act === 'reject') reject(it, '');
      });
    });
  }

  function select(i, fly) {
    tray.selected = i;
    tray.cards.querySelectorAll('.scout-card').forEach(c => c.classList.toggle('is-selected', +c.dataset.i === i));
    renderDetail();
    drawMarkers(false);
    const s = sug(items()[i]);
    if (fly && s && typeof s.lat === 'number' && W().map) W().map.panTo([s.lat, s.lng], { animate: true });
  }

  function renderDetail() {
    const it = items()[tray.selected];
    if (!it) { tray.detail.innerHTML = ''; return; }
    const s = sug(it) || {};
    const pinsById = {}; run.pins.forEach(p => { pinsById[p.id] = p; });
    const fits = (s.fits_pins || []).filter(id => pinsById[id]).map(id =>
      '<button type="button" class="scout-chip scout-chip--pin" data-pin="' + esc(id) + '">' + esc(pinsById[id].name) + '</button>').join('');
    const sources = (s.evidence || []).map(e =>
      '<li><a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(hostOf(e.url)) + '</a> ' + esc(e.claim) + '</li>').join('');
    const place = s.locality ? [s.locality, s.country].filter(Boolean).join(', ') : shortPlace(s.place);
    const reasons = (it._decided === 'rejected' && !it._reason && tray.segName === 'suggestions')
      ? '<div class="scout-reasons"><span class="scout-reasons__label">Why? (optional)</span>' +
        REJECT_CHIPS.map(c => '<button type="button" class="scout-chip scout-chip--reason-pick" data-reason="' + esc(c) + '">' + esc(c) + '</button>').join('') +
        '</div>'
      : '';
    tray.detail.innerHTML =
      photoHtml(s, 'scout-detail__img') +
      // name + small actions stay pinned at the top while the inspector scrolls
      '<div class="scout-detail__bar">' +
        '<div class="scout-detail__barrow">' +
          '<h3 class="scout-detail__name">' + esc(it.name) + '</h3>' +
          '<span class="scout-detail__actions">' + actionButtons(it) + '</span>' +
        '</div>' + reasons +
      '</div>' +
      '<div class="scout-detail__pad">' +
        (place || typeof s.km === 'number' ? '<p class="scout-detail__place">' + esc(place) + (typeof s.km === 'number' ? ' · ' + s.km + ' km from ' + esc(run.anchor.name) : '') + '</p>' : '') +
        (tray.segName === 'rejected' ? '<p class="scout-detail__why"><span class="scout-chip scout-chip--reason">' + esc(REASON_LABEL[it.reason] || it.reason) + '</span> ' + esc(it.note) + '</p>' : '') +
        (s.about ? '<h4>What it is</h4><p>' + esc(s.about) + '</p>' : '') +
        (s.why_chosen ? '<h4>Why Scout chose it</h4><p>' + esc(s.why_chosen) + '</p>' : '') +
        (fits ? '<h4>Fits your pins</h4><div class="scout-fits">' + fits + '</div>' : '') +
        (sources ? '<details class="scout-sources"><summary>Sources (' + s.evidence.length + ')</summary><ul>' + sources + '</ul></details>' : '') +
      '</div>';
    tray.detail.scrollTop = 0;

    tray.detail.querySelectorAll('[data-pin]').forEach(b => b.addEventListener('click', () => W().flyTo(b.dataset.pin)));
    wireActions($('.scout-detail__actions', tray.detail), it, tray.selected);
    tray.detail.querySelectorAll('[data-reason]').forEach(b => b.addEventListener('click', () => addReason(it, b.dataset.reason)));
  }

  function hostOf(u) { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u; } }
  // "Abbaye de Fontfroide, Route de Fontfroide, Narbonne, Aude, …, France" → "Narbonne, France"
  const ROAD = /^(route|rue|chemin|avenue|av\.|boulevard|bd|place|impasse|allée|road|street|st\.?|lane|way|drive|via|viale|strada|calle|camino|straße|strasse|weg|platz)\b|\b(road|street|lane|straße|strasse|weg)$/i;
  function shortPlace(d) {
    if (!d) return '';
    const parts = d.split(',').map(x => x.trim()).filter(x => x && !/\d/.test(x));
    const country = parts.length > 1 ? parts[parts.length - 1] : '';
    const town = parts.slice(1, -1).find(x => !ROAD.test(x)) || '';
    return [town, country].filter(Boolean).join(', ');
  }

  function accept(it) {
    const s = sug(it);
    if (!window.WaypointsAdd) { toast('The add form is not available.', true); return; }
    window.WaypointsAdd.openPrefilled({
      text: s.name + ' (' + (run.mode === 'area'
        ? ([s.locality, s.country].filter(Boolean).join(', ') || shortPlace(s.place) || run.anchor.name)
        : 'near ' + run.anchor.name + ', ' + (run.anchor.country || '')) + '). ' + (s.summary || ''),
      lat: s.lat, lng: s.lng, imageUrl: s.image || '',
      onCommitted: async () => {
        // the add flow opens the new pin's panel; close it so the tray stays usable
        if (W().closePanel) W().closePanel();
        it._decided = 'accepted';
        renderTray(); drawMarkers(false); saveRun();
        await decide(it, 'accepted', '');
      }
    });
  }

  async function reject(it, reason) {
    it._decided = 'rejected'; it._reason = reason;
    renderTray(); drawMarkers(false); saveRun();
    if (!(await decide(it, 'rejected', reason))) { it._decided = null; renderTray(); saveRun(); }
  }

  // Optional reason after a reject: logged as a second entry carrying the reason.
  async function addReason(it, reason) {
    it._reason = reason;
    renderTray(); saveRun();
    if (!(await decide(it, 'rejected', reason))) { it._reason = ''; renderTray(); saveRun(); }
  }

  async function overrule(it) {
    const r = run.result;
    const s = it.suggestion || { kind: 'nearby', name: it.name, summary: it.note, about: '', why_chosen: '', fits_pins: [], evidence: [] };
    r.rejected.splice(r.rejected.indexOf(it), 1);
    const moved = Object.assign({}, s, { _overruled: true });
    r.suggestions.push(moved);
    tray.segName = 'suggestions'; tray.selected = r.suggestions.length - 1;
    await fetchImage(moved);
    renderTray(); drawMarkers(false); saveRun();
    decide(moved, 'overruled', it.reason);
  }

  /* ========================= temporary map markers ======================= */
  function drawMarkers(fit) {
    const map = W().map;
    if (!map || !run || !run.result) return;
    if (tray.layer) tray.layer.remove();
    tray.layer = L.layerGroup().addTo(map);
    const list = run.result.suggestions;
    const selected = tray.segName === 'suggestions' ? tray.selected : -1;
    const pts = run.mode === 'pin' ? [[run.anchor.lat, run.anchor.lng]] : [];
    list.forEach((s, i) => {
      if (typeof s.lat !== 'number') return;
      const cls = 'scout-marker' + (i === selected ? ' is-selected' : '') + (s._decided ? ' is-' + s._decided : '');
      const m = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: '', html: '<div class="' + cls + '"><span>' + (i + 1) + '</span></div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
        title: s.name, zIndexOffset: i === selected ? 1000 : 500
      }).addTo(tray.layer);
      m.on('click', () => { if (tray.segName !== 'suggestions') { tray.segName = 'suggestions'; renderTray(); } select(i, false); });
      pts.push([s.lat, s.lng]);
    });
    if (fit && pts.length > (run.mode === 'pin' ? 1 : 0)) {
      const trayH = tray.el.getBoundingClientRect().height || innerHeight * 0.45;
      map.fitBounds(pts, { paddingTopLeft: [60, 70], paddingBottomRight: [60, trayH + 30], maxZoom: 12 });
    }
  }

  /* ================================= misc ================================ */
  let _toast;
  function toast(msg, isErr) {
    if (!_toast) { _toast = document.createElement('div'); _toast.className = 'aw-toast'; document.body.appendChild(_toast); }
    _toast.textContent = msg; _toast.classList.toggle('is-error', !!isErr); _toast.classList.add('show');
    clearTimeout(_toast._t); _toast._t = setTimeout(() => _toast.classList.remove('show'), isErr ? 5000 : 3000);
  }

  function openLog() {
    tray.logList.innerHTML = run.log.map(l =>
      '<li class="scout-log__item scout-log__item--' + l.kind + '"><span class="scout-log__t">' + (l.t / 1000).toFixed(1) + 's</span>' + esc(l.text) + '</li>').join('');
    tray.logTotals.textContent = totalsLine();
    tray.log.hidden = false;
  }
})();
