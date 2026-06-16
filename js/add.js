/* ============================================================================
 * WAYPOINTS — add-a-place flow (frontend)
 * Talks to the /api/draft Vercel function: drafts a record from an image / link
 * / text, previews it, then commits it to data.json via the backend.
 * ========================================================================== */
(function () {
  'use strict';

  // Where the backend lives. '' = same origin (when the whole site is served
  // from Vercel). If the map stays on GitHub Pages, set this to your Vercel URL,
  // e.g. 'https://waypoints-xxxx.vercel.app'  (no trailing slash).
  const API_BASE = '';

  const $ = id => document.getElementById(id);
  const modal = $('aw-modal'), backdrop = $('aw-backdrop');
  const inputStep = $('aw-input-step'), previewStep = $('aw-preview-step');
  const drop = $('aw-drop'), fileInput = $('aw-file'), dropInner = $('aw-drop-inner');
  const textEl = $('aw-text'), keyEl = $('aw-key');
  const parentEl = $('aw-parent'), parentList = $('aw-parent-list');
  let parentMap = {}; // lowercased pin name -> id
  const draftBtn = $('aw-draft'), commitBtn = $('aw-commit');
  const status1 = $('aw-status'), status2 = $('aw-status2');
  const previewEl = $('aw-preview');

  let dropped = null;            // { base64, mediaType, name } for an uploaded image
  let currentRecord = null;      // drafted record awaiting commit
  let suggestedImageUrl = '';    // og:image from a link, if any

  /* ---------------------------------- open/close ------------------------- */
  function open() {
    modal.hidden = false; backdrop.hidden = false;
    showStep('input'); resetInput();
    keyEl.value = getKey();
    populateParents();
    textEl.focus();
  }
  function populateParents() {
    parentMap = {};
    const pins = (window.Waypoints && window.Waypoints.listPins) ? window.Waypoints.listPins() : [];
    parentList.innerHTML = pins.map(p => {
      parentMap[p.name.toLowerCase()] = p.id;
      return '<option value="' + esc(p.name) + '"></option>';
    }).join('');
  }
  function resolveParent() {
    const v = parentEl.value.trim();
    return v ? (parentMap[v.toLowerCase()] || '') : '';
  }
  function close() {
    modal.hidden = true; backdrop.hidden = true;
  }
  function showStep(which) {
    inputStep.hidden = which !== 'input';
    previewStep.hidden = which !== 'preview';
  }
  function resetInput() {
    dropped = null; currentRecord = null; suggestedImageUrl = '';
    textEl.value = ''; if (parentEl) parentEl.value = '';
    status1.textContent = ''; status1.classList.remove('is-error');
    status2.textContent = ''; status2.classList.remove('is-error');
    dropInner.innerHTML = '<span class="aw-drop-icon">⤓</span>' +
      '<span class="aw-drop-text">Drop an image here, or click to upload</span>';
    draftBtn.disabled = false; draftBtn.textContent = 'Draft it →';
  }

  $('add-waypoint').addEventListener('click', open);
  $('aw-close').addEventListener('click', close);
  $('aw-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });

  /* ---------------------------------- image upload ----------------------- */
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  // Downscale to ~480px long edge, export WebP to keep the upload small.
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) { reject(new Error('not-image')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 480, scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = c.toDataURL('image/webp', 0.82);
          resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/webp', name: 'upload.webp', dataUrl });
        };
        img.onerror = () => reject(new Error('bad-image'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('read-fail'));
      reader.readAsDataURL(file);
    });
  }

  function handleFile(file) {
    resizeImage(file)
      .then(img => { dropped = img; dropInner.innerHTML = '<img src="' + img.dataUrl + '" alt="preview">'; })
      .catch(() => setStatus(status1, 'That’s not a usable image.', true));
  }

  /* ------------------------- quick drag-drop on the button --------------- */
  // Drop an image straight onto the Add-waypoint button to auto-submit
  // (draft + commit), skipping the modal. Click still opens the modal.
  const addBtn = $('add-waypoint');
  ['dragenter', 'dragover'].forEach(ev => addBtn.addEventListener(ev, e => { e.preventDefault(); addBtn.classList.add('is-over'); }));
  ['dragleave', 'dragend'].forEach(ev => addBtn.addEventListener(ev, e => { e.preventDefault(); addBtn.classList.remove('is-over'); }));
  addBtn.addEventListener('drop', e => {
    e.preventDefault(); addBtn.classList.remove('is-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) quickDrop(f);
  });

  async function quickDrop(file) {
    let img;
    try { img = await resizeImage(file); } catch (e) { toast('That’s not a usable image.', true); return; }
    const key = getKey();
    if (!key) {
      // No saved access key yet — fall back to the modal with the image loaded.
      open(); dropped = img; dropInner.innerHTML = '<img src="' + img.dataUrl + '" alt="preview">';
      setStatus(status1, 'Enter your access key, then “Draft it”.', false); keyEl.focus();
      return;
    }
    toast('Reading image…');
    try {
      const d = await api({ action: 'draft', password: key, kind: 'image', imageBase64: img.base64, mediaType: img.mediaType });
      toast('Adding “' + d.record.name + '”…');
      const c = await api({ action: 'commit', password: key, record: d.record, imageBase64: img.base64, imageName: img.name, imageUrl: '' });
      const rec = (c && c.record) || d.record;
      if (window.Waypoints && window.Waypoints.addLive) window.Waypoints.addLive(rec, img.dataUrl);
      toast('Added: ' + rec.name);
    } catch (err) { toast(errMsg(err), true); }
  }

  /* ---------------------------------- draft ------------------------------ */
  draftBtn.addEventListener('click', draft);
  textEl.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') draft(); });

  function payloadKind() {
    const t = textEl.value.trim();
    if (dropped) return { kind: 'image', imageBase64: dropped.base64, mediaType: dropped.mediaType, text: t };
    if (/^https?:\/\/\S+/i.test(t)) return { kind: 'link', url: t };
    if (t) return { kind: 'text', text: t };
    return null;
  }

  async function draft() {
    const p = payloadKind();
    if (!p) { setStatus(status1, 'Drop an image, paste a link, or type a description first.', true); return; }
    draftBtn.disabled = true; draftBtn.textContent = 'Drafting…'; setStatus(status1, 'Asking Claude…');
    try {
      const res = await api({ action: 'draft', password: keyEl.value, parentId: resolveParent(), ...p });
      saveKey(keyEl.value);
      currentRecord = res.record;
      suggestedImageUrl = res.suggestedImageUrl || '';
      renderPreview();
      showStep('preview');
    } catch (err) {
      setStatus(status1, errMsg(err), true);
      draftBtn.disabled = false; draftBtn.textContent = 'Draft it →';
    }
  }

  function renderPreview() {
    const r = currentRecord;
    const cats = (window.Waypoints && window.Waypoints.categories) || {};
    const themes = (window.Waypoints && window.Waypoints.themes) || {};
    const cat = cats[r.category] || { label: r.category, color: '#666' };
    const imgSrc = dropped ? ('data:image/webp;base64,' + dropped.base64) : (suggestedImageUrl || '');
    const crumb = [r.country, r.region, r.subregion].filter(Boolean).join(' · ');
    const themeChips = (r.themes || []).map(t => {
      const th = themes[t]; return '<span class="aw-pv-chip aw-pv-chip--out">' + (th ? th.label : t) + '</span>';
    }).join('');
    previewEl.innerHTML =
      (imgSrc ? '<img src="' + imgSrc + '" alt="">' : '') +
      '<p class="aw-pv-name">' + esc(r.name) + '</p>' +
      '<p class="aw-pv-crumb">' + esc(crumb) + (r.macroRegion === 'uk' ? ' · UK&amp;IE' : ' · Europe') + '</p>' +
      '<div class="aw-pv-chips"><span class="aw-pv-chip" style="background:' + cat.color + '">' + esc(cat.label) + '</span>' + themeChips + '</div>' +
      '<p class="aw-pv-blurb">' + esc(r.blurb || '') + '</p>' +
      '<p class="aw-pv-coords">' + r.lat.toFixed(4) + ', ' + r.lng.toFixed(4) + (r.approx ? ' · ~approx' : '') +
        (r.timeGated ? ' · timed/ticketed' : '') + '</p>' +
      (resolveParent() ? '<p class="aw-pv-coords">↳ inside ' + esc(parentEl.value) + '</p>' : '');
  }

  /* ---------------------------------- commit ----------------------------- */
  $('aw-back').addEventListener('click', () => { showStep('input'); draftBtn.disabled = false; draftBtn.textContent = 'Draft it →'; });
  commitBtn.addEventListener('click', commit);

  async function commit() {
    commitBtn.disabled = true; setStatus(status2, 'Saving…');
    try {
      const res = await api({
        action: 'commit',
        password: keyEl.value,
        record: currentRecord,
        parentId: resolveParent(),
        imageBase64: dropped ? dropped.base64 : '',
        imageName: dropped ? dropped.name : '',
        imageUrl: dropped ? '' : suggestedImageUrl
      });
      saveKey(keyEl.value);
      const rec = res.record || currentRecord;
      const previewSrc = dropped ? dropped.dataUrl : (suggestedImageUrl || '');
      if (window.Waypoints && window.Waypoints.addLive) window.Waypoints.addLive(rec, previewSrc);
      close();
    } catch (err) {
      setStatus(status2, errMsg(err), true);
      commitBtn.disabled = false;
    }
  }

  /* ---------------------------------- helpers ---------------------------- */
  async function api(body) {
    const res = await fetch(API_BASE + '/api/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }
  function setStatus(el, msg, isErr) { el.textContent = msg; el.classList.toggle('is-error', !!isErr); }

  // Remember the access key so quick-drop can auto-submit without the modal.
  function getKey() { try { return localStorage.getItem('wp_addkey') || ''; } catch (e) { return ''; } }
  function saveKey(k) { try { if (k) localStorage.setItem('wp_addkey', k); } catch (e) {} }

  let toastEl;
  function toast(msg, isErr) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'aw-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.toggle('is-error', !!isErr); toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), isErr ? 5000 : 3500);
  }
  function errMsg(err) {
    const m = String(err && err.message || err);
    if (/HTTP 404|Failed to fetch|NetworkError/i.test(m)) return 'Backend not reachable yet — deploy /api to Vercel (see README).';
    if (/401/.test(m) || /access key/i.test(m)) return 'Access key missing or incorrect.';
    return m;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
})();
