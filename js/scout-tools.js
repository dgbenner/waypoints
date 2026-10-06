/* ============================================================================
 * WAYPOINTS — Scout client tools
 * The tools the Scout agent calls that run in the browser, plus the rules
 * submit_findings enforces. No DOM here, so it also loads in Node for tests.
 * ========================================================================== */
(function (root) {
  'use strict';

  const DUP_RADIUS_KM = 0.5;
  const GEOCODE_MATCH_KM = 0.3;   // a suggestion's point must sit this close to a geocode result
  const CAP = { pin: 3, area: 10 };
  const REASONS = ['unverified_location', 'sources_disagree', 'duplicate', 'too_far',
    'outside_view', 'vague_thread', 'no_thread', 'closed_or_gone', 'tourist_trap', 'weak_fit',
    'already_decided'];

  /* ------------------------------- helpers -------------------------------- */
  // lowercase, no accents, no apostrophes or punctuation, no "the"
  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/['’‘`]/g, '').replace(/[^a-z0-9]+/g, ' ')
      .split(' ').filter(w => w && w !== 'the').join(' ');
  }

  // House style: never "&", and place names in Title Case.
  const noAmp = t => String(t == null ? '' : t).replace(/\s*(&amp;|&)\s*/g, ' and ');
  const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on',
    'or', 'over', 'the', 'to', 'upon', 'with', 'vs', 'de', 'du', 'des', 'la', 'le', 'les', 'del', 'della', 'di', 'da',
    'van', 'von', 'der', 'den', 'y', 'e', 'et', 'au', 'aux']);
  function titleCase(name) {
    const words = noAmp(name).trim().split(/\s+/);
    return words.map((w, i) => {
      // leave words that already carry capitals or digits after the first letter: BMW, SR-71, McDonald's
      if (/[A-Z0-9]/.test(w.slice(1))) return w;
      const bare = w.toLowerCase().replace(/^[^a-z\u00c0-\u024f]+|[^a-z\u00c0-\u024f]+$/g, '');
      if (i > 0 && i < words.length - 1 && SMALL.has(bare)) return w.toLowerCase();
      return w.split('-').map(part => part.replace(/^([^A-Za-z\u00c0-\u024f]*)([A-Za-z\u00c0-\u024f])/, (m, pre, c) => pre + c.toUpperCase())).join('-');
    }).join(' ');
  }

  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371.0088, t = x => x * Math.PI / 180;
    const dLat = t(lat2 - lat1), dLng = t(lng2 - lng1);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const round1 = n => Math.round(n * 10) / 10;
  const isNum = n => typeof n === 'number' && isFinite(n);

  function normUrl(u) {
    try {
      const x = new URL(String(u).trim());
      x.hash = '';
      return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase();
    } catch (e) { return ''; }
  }

  function pinSummary(p) {
    return { id: p.id, name: p.name, country: p.country, themes: p.themes || [], blurb: p.blurb || '' };
  }

  // Pins already on the map that share a normalized name (e.g. the Salford pair).
  function duplicatePinGroups(pins) {
    const groups = {};
    pins.forEach(p => { const k = normName(p.name); if (k) (groups[k] = groups[k] || []).push(p); });
    return Object.keys(groups).filter(k => groups[k].length > 1).map(k => {
      const g = groups[k];
      return { ids: g.map(p => p.id), names: g.map(p => p.name), km: round1(distanceKm(g[0].lat, g[0].lng, g[1].lat, g[1].lng)) };
    });
  }

  function findDuplicates(pins, name, lat, lng) {
    const n = normName(name);
    return pins.filter(p => (n && normName(p.name) === n) ||
      (isNum(lat) && isNum(lng) && distanceKm(lat, lng, p.lat, p.lng) <= DUP_RADIUS_KM))
      .map(p => ({ id: p.id, name: p.name, km: isNum(lat) ? round1(distanceKm(lat, lng, p.lat, p.lng)) : null }));
  }

  function matchDecision(decisions, name, lat, lng) {
    const n = normName(name);
    return decisions.find(d => (d.decision === 'accepted' || d.decision === 'rejected') &&
      ((n && normName(d.name) === n) ||
       (isNum(lat) && isNum(d.lat) && distanceKm(lat, lng, d.lat, d.lng) <= DUP_RADIUS_KM)));
  }

  /* ------------------------------- the run -------------------------------- */
  // ctx: { mode: 'pin'|'area', pins, server(action, body) → Promise,
  //        pin mode:  anchor (the open pin), detourKm
  //        area mode: area { name, bounds: { s, w, n, e } } }
  function createRun(ctx) {
    const mode = ctx.mode || 'pin';
    const pins = ctx.pins;
    const anchor = ctx.anchor;
    const area = ctx.area;
    const detourKm = ctx.detourKm || 60;
    const inView = (lat, lng) => area && lat >= area.bounds.s && lat <= area.bounds.n && lng >= area.bounds.w && lng <= area.bounds.e;
    const state = {
      geocodes: [],                 // { query, lat, lng, display_name }
      searchUrls: new Set(),        // normalized URLs seen in web_search results
      decisions: null,
      submits: 0,
      firstResult: null,            // validated result of a submission that moved items
      result: null                  // final validated result
    };

    function noteSearchResults(content) {
      (content || []).forEach(b => {
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
          b.content.forEach(r => { if (r && r.url) state.searchUrls.add(normUrl(r.url)); });
        }
        if (b.type === 'text' && Array.isArray(b.citations)) {
          b.citations.forEach(c => { if (c && c.url) state.searchUrls.add(normUrl(c.url)); });
        }
      });
    }

    async function loadDecisions() {
      if (!state.decisions) {
        const r = await ctx.server('decisions', {});
        state.decisions = (r && r.decisions) || [];
      }
      return state.decisions;
    }

    // Returns { content, isError?, done? }
    async function exec(name, input) {
      input = input || {};
      switch (name) {
        case 'search_my_pins': {
          const words = normName(input.query).split(' ').filter(Boolean);
          const country = String(input.country || '').toLowerCase();
          let hits = pins.filter(p => {
            if (input.theme && !(p.themes || []).includes(input.theme)) return false;
            if (country && String(p.country || '').toLowerCase() !== country) return false;
            if (!words.length) return true;
            const hay = normName([p.name, p.blurb, p.region, p.subregion, p.country].join(' '));
            return words.every(w => hay.includes(w));
          });
          const limit = Math.min(40, Math.max(1, input.limit || 15));
          return { content: { total: hits.length, pins: hits.slice(0, limit).map(pinSummary) } };
        }
        case 'pins_in_view': {
          if (!area) return { content: 'Only Area Scout has a view.', isError: true };
          const hits = pins.filter(p => inView(p.lat, p.lng));
          return { content: { place: area.name, bounds: area.bounds, total: hits.length, pins: hits.slice(0, 60).map(pinSummary) } };
        }
        case 'get_pin': {
          const p = pins.find(x => x.id === input.id);
          if (!p) return { content: 'No pin with id ' + input.id, isError: true };
          const out = Object.assign({}, p); delete out._previewSrc;
          return { content: out };
        }
        case 'geocode': {
          const q = String(input.query || '').trim();
          if (!q) return { content: 'Empty query', isError: true };
          const g = await ctx.server('geocode', { query: q });
          if (!g || g.error || !isNum(g.lat)) return { content: (g && g.error) || 'No match', isError: true };
          state.geocodes.push({ query: q, lat: g.lat, lng: g.lng, display_name: g.display_name || '', locality: g.locality || '', country: g.country || '' });
          return { content: { lat: g.lat, lng: g.lng, display_name: g.display_name || '' } };
        }
        case 'distance_km': {
          let fLat = input.from_lat, fLng = input.from_lng;
          if (input.from_id) {
            const p = pins.find(x => x.id === input.from_id);
            if (!p) return { content: 'No pin with id ' + input.from_id, isError: true };
            fLat = p.lat; fLng = p.lng;
          }
          if (![fLat, fLng, input.to_lat, input.to_lng].every(isNum)) return { content: 'Need from and to coordinates', isError: true };
          return { content: { km: round1(distanceKm(fLat, fLng, input.to_lat, input.to_lng)) } };
        }
        case 'check_duplicate': {
          const d = findDuplicates(pins, input.name, input.lat, input.lng);
          return { content: d.length ? { duplicate: true, matches: d } : { duplicate: false } };
        }
        case 'past_decisions': {
          const d = (await loadDecisions()).filter(x => ['accepted', 'rejected', 'overruled'].includes(x.decision));
          return { content: d.map(x => ({ name: x.name, lat: x.lat, lng: x.lng, decision: x.decision, reason: x.reason, at: x.at })) };
        }
        case 'submit_findings':
          return submit(input);
        default:
          return { content: 'Unknown tool ' + name, isError: true };
      }
    }

    async function validate(input) {
      const decisions = await loadDecisions();
      const pinIds = new Set(pins.map(p => p.id));
      const kept = [], moved = [];
      const reject = (s, reason, note) => moved.push({ name: s.name || '(unnamed)', reason, note, suggestion: s });

      (input.suggestions || []).forEach(raw => {
        const s = Object.assign({}, raw, {
          name: titleCase(raw.name), summary: noAmp(raw.summary), about: noAmp(raw.about), why_chosen: noAmp(raw.why_chosen),
          evidence: (raw.evidence || []).map(e => Object.assign({}, e, { claim: noAmp(e && e.claim) }))
        });
        s.fits_pins = (s.fits_pins || []).filter(id => pinIds.has(id));
        const want = mode === 'area' ? 'area' : 'nearby';
        if (s.kind !== want) return reject(s, 'weak_fit', (mode === 'area' ? 'Area Scout' : 'Pin Scout') + ' only takes "' + want + '" suggestions for now.');

        const geo = isNum(s.lat) && isNum(s.lng) &&
          state.geocodes.find(g => distanceKm(s.lat, s.lng, g.lat, g.lng) <= GEOCODE_MATCH_KM);
        if (!geo) return reject(s, 'unverified_location', 'Its coordinates did not come from a geocode in this run.');
        s.place = geo.display_name; s.locality = geo.locality; s.country = geo.country;

        if (mode === 'area') {
          if (!inView(s.lat, s.lng)) return reject(s, 'outside_view', 'Outside the map view of ' + area.name + '.');
        } else {
          s.km = round1(distanceKm(anchor.lat, anchor.lng, s.lat, s.lng));
          if (s.km > detourKm) return reject(s, 'too_far', s.km + ' km away; the detour limit is ' + detourKm + ' km.');
        }

        const dup = findDuplicates(pins, s.name, s.lat, s.lng);
        if (dup.length) return reject(s, 'duplicate', 'Already on the map as ' + dup.map(d => d.name).join(', ') + '.');

        const past = matchDecision(decisions, s.name, s.lat, s.lng);
        if (past) return reject(s, 'already_decided', 'You ' + past.decision + ' this on ' + String(past.at || '').slice(0, 10) + '.');

        const ev = (s.evidence || []).filter(e => e && e.url && state.searchUrls.has(normUrl(e.url)));
        if (ev.length < 1) return reject(s, 'vague_thread', "None of its evidence links came from this run's searches.");
        s.evidence = ev;

        kept.push(s);
      });

      kept.splice(CAP[mode]).forEach(s => reject(s, 'weak_fit', 'Over the cap of ' + CAP[mode] + ' suggestions.'));

      const modelRejected = (input.rejected || []).map(r => ({
        name: titleCase(r.name) || '(unnamed)', reason: REASONS.includes(r.reason) ? r.reason : 'weak_fit', note: noAmp(r.note)
      }));
      return {
        headline_facts: input.headline_facts || { searched: 0, considered: 0 },
        suggestions: kept,
        rejected: moved.concat(modelRejected),
        moved,
        nothing_reason: String(input.nothing_reason || '').trim()
      };
    }

    async function submit(input) {
      state.submits++;
      const v = await validate(input);
      const missingReason = !v.suggestions.length && !v.nothing_reason;

      if (state.submits === 1 && (v.moved.length || missingReason)) {
        state.firstResult = v;
        const lines = v.moved.map(m => m.name + ' (' + m.reason + ': ' + m.note + ')');
        let msg = v.moved.length
          ? 'Moved ' + v.moved.length + ' item' + (v.moved.length > 1 ? 's' : '') + ' to rejected: ' + lines.join('; ') + '.'
          : '';
        if (missingReason) msg += (msg ? ' ' : '') + 'No suggestions survived, so nothing_reason is required.';
        msg += ' You may resubmit once with the full final list.';
        return { content: msg, isError: true };
      }

      if (state.firstResult) {
        // keep the first pass's rejections that the resubmission dropped
        const seen = new Set(v.rejected.map(r => normName(r.name)).concat(v.suggestions.map(s => normName(s.name))));
        state.firstResult.rejected.forEach(r => { if (!seen.has(normName(r.name))) v.rejected.push(r); });
      }
      if (!v.suggestions.length && !v.nothing_reason) v.nothing_reason = 'Nothing passed the checks.';
      state.result = v;
      return { content: 'Findings recorded. ' + v.suggestions.length + ' suggestion(s), ' + v.rejected.length + ' rejected.', done: true };
    }

    // If the model stops without a clean final submission, fall back to the
    // first validated pass, if there was one.
    function finalResult() {
      const r = state.result || state.firstResult;
      if (r && !r.suggestions.length && !r.nothing_reason) r.nothing_reason = 'Nothing passed the checks.';
      return r;
    }

    return { exec, noteSearchResults, finalResult, state };
  }

  const api = { createRun, titleCase, noAmp, normName, distanceKm, normUrl, findDuplicates, duplicatePinGroups, matchDecision, REASONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScoutTools = api;
})(typeof window !== 'undefined' ? window : this);
