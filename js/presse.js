/* Presse: fertige Ergebnis-Posts (PNG, 4:5 = 1080 × 1350) für den Insta-Kanal der SMV.
   Nach jedem Abpfiff erscheint das Spiel hier automatisch; auf Wunsch wird das Bild sofort heruntergeladen. */
(function () {
  'use strict';
  const { esc, STAGES } = PT;
  const app = document.getElementById('app');
  const W = 1080, HH = 1350;
  const FD = '"Barlow Condensed","Arial Narrow",Impact,sans-serif', FB = '"Barlow",system-ui,sans-serif';
  let S = null, H = null;
  const cache = {}; // match id -> { sig, url, blob }
  const LS = { get(k, d) { try { const v = localStorage.getItem('pt-presse-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('pt-presse-' + k, JSON.stringify(v)); } catch (e) { /* egal */ } } };

  async function api(url, body) {
    const r = await fetch(url, body ? { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Status ' + r.status); return j;
  }
  let toastT = null;
  function toast(msg) { let el = document.getElementById('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3500); }

  /* ---------- Zeichnen ---------- */
  const imgs = {};
  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    if (!imgs[src]) imgs[src] = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    return imgs[src];
  }
  function whiteLogo(img) {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); return c;
  }
  function rr(x, cx, cy, w, h, r) { x.beginPath(); x.moveTo(cx + r, cy); x.arcTo(cx + w, cy, cx + w, cy + h, r); x.arcTo(cx + w, cy + h, cx, cy + h, r); x.arcTo(cx, cy + h, cx, cy, r); x.arcTo(cx, cy, cx + w, cy, r); x.closePath(); }
  // Text mit Buchstabenabstand und automatischem Verkleinern auf maxW
  function txt(x, s, px, py, o) {
    o = o || {}; let size = o.size || 40; const ls = o.ls || 0;
    const font = (sz) => `${o.it === false ? '' : 'italic '}${o.w || 800} ${sz}px ${o.f || FD}`;
    const width = () => { x.font = font(size); return x.measureText(s).width + ls * Math.max(0, s.length - 1); };
    if (o.max) while (size > 12 && width() > o.max) size -= 2;
    x.font = font(size); x.fillStyle = o.c || '#fff';
    const w = width(); let sx = o.al === 'center' ? px - w / 2 : o.al === 'right' ? px - w : px;
    x.textBaseline = o.bl || 'alphabetic'; x.textAlign = 'left';
    if (!ls) { x.fillText(s, sx, py); return w; }
    for (const ch of s) { x.fillText(ch, sx, py); sx += x.measureText(ch).width + ls; }
    return w;
  }
  function ball(x, cx, cy, r, fill, ink) {
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); x.lineWidth = Math.max(2, r * 0.12); x.strokeStyle = ink; x.stroke();
    const pr = r * 0.4, pts = [];
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; pts.push([cx + pr * Math.cos(a), cy + pr * Math.sin(a)]); }
    x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fillStyle = ink; x.fill();
    x.lineWidth = Math.max(1.5, r * 0.09); pts.forEach((p) => { const dx = p[0] - cx, dy = p[1] - cy; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(cx + dx * 2.35, cy + dy * 2.35); x.stroke(); });
    x.restore();
  }
  function icon(x, type, cx, cy, s) {
    if (type === 'goal') return ball(x, cx, cy, s * 0.46, '#fff', '#0A0F1E');
    if (type === 'og') return ball(x, cx, cy, s * 0.46, '#FF5C7A', '#fff');
    const w = s * 0.6, h = s * 0.82;
    x.save(); x.translate(cx, cy); x.rotate(0.12); rr(x, -w / 2, -h / 2, w, h, s * 0.08);
    x.fillStyle = type === 'yellow' ? '#FFD23F' : '#FF8A3D'; x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = 6; x.fill(); x.shadowBlur = 0;
    if (type === 'red') txt(x, "2'", 0, h * 0.14, { size: s * 0.42, w: 900, c: '#1A0A00', al: 'center' });
    x.restore();
  }
  const nameShort = (n) => { const p = String(n || '').trim().split(/\s+/); return (p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : p[0] || '').toUpperCase(); };
  const ANON = { goal: 'TOR', og: 'EIGENTOR', yellow: 'GELBE KARTE', red: '2 MINUTEN' };
  // Ereignisse je Seite: gleicher Spieler + gleiche Art = eine Zeile (Minuten nebeneinander)
  function rows(m, side) {
    const out = [], by = {};
    m.events.filter((e) => e.side === side).slice().sort((a, b) => (a.min || 0) - (b.min || 0) || (a.at || 0) - (b.at || 0)).forEach((e) => {
      const k = (e.player || 'anon-' + e.id) + '|' + e.type;
      if (!by[k]) { const x = H.P(e.player); by[k] = { type: e.type, name: x ? nameShort(x.p.name) + (e.type === 'og' ? ' (ET)' : '') : ANON[e.type], mins: [] }; out.push(by[k]); }
      by[k].mins.push(e.min);
    });
    return out;
  }
  async function teamBox(x, t, ph, bx, by, bw) {
    x.save(); rr(x, bx, by, bw, bw, 30); x.fillStyle = 'rgba(6,12,32,.88)'; x.shadowColor = t ? t.color : '#2E6BFF'; x.shadowBlur = 40; x.fill(); x.shadowBlur = 0;
    x.lineWidth = 5; x.strokeStyle = t ? t.color : '#2A3560'; x.stroke(); x.restore();
    const img = t && t.logo ? await loadImg(t.logo) : null;
    const pad = bw * 0.14, inner = bw - 2 * pad;
    if (img) {
      x.save(); rr(x, bx + pad, by + pad, inner, inner, 22); x.fillStyle = '#fff'; x.fill(); x.clip();
      const k = Math.min((inner - 24) / img.naturalWidth, (inner - 24) / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
      x.drawImage(img, bx + bw / 2 - w / 2, by + bw / 2 - h / 2, w, h); x.restore();
    } else {
      x.beginPath(); x.arc(bx + bw / 2, by + bw / 2, inner / 2, 0, Math.PI * 2); x.fillStyle = t ? t.color : '#2A3560'; x.fill();
      x.lineWidth = 6; x.strokeStyle = 'rgba(255,255,255,.3)'; x.stroke();
      txt(x, t ? PT.short(t) : '?', bx + bw / 2, by + bw / 2 + inner * 0.13, { size: inner * 0.36, w: 900, al: 'center', max: inner * 0.8 });
    }
    txt(x, (t ? t.name : ph || '').toUpperCase(), bx + bw / 2, by + bw + 62, { size: 46, w: 900, al: 'center', max: bw + 40 });
  }
  async function draw(m) {
    const c = document.createElement('canvas'); c.width = W; c.height = HH; const x = c.getContext('2d');
    const s = S.settings, r = H.sc(m), h = H.teamOf(m, 'h'), a = H.teamOf(m, 'a');
    // Hintergrund
    let g = x.createLinearGradient(0, 0, 0, HH); g.addColorStop(0, '#0E2257'); g.addColorStop(0.55, '#081129'); g.addColorStop(1, '#04060D'); x.fillStyle = g; x.fillRect(0, 0, W, HH);
    g = x.createRadialGradient(540, 400, 40, 540, 400, 640); g.addColorStop(0, 'rgba(46,107,255,.55)'); g.addColorStop(1, 'rgba(46,107,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, HH);
    x.save(); x.strokeStyle = 'rgba(255,255,255,.035)'; x.lineWidth = 2; for (let i = -HH; i < W; i += 26) { x.beginPath(); x.moveTo(i, HH); x.lineTo(i + HH * 0.6, 0); x.stroke(); } x.restore();
    // Kopf
    const [sch, smv] = await Promise.all([loadImg('/img/schule.png'), loadImg('/img/smv.png')]);
    if (sch) { const k = 112 / sch.naturalHeight; x.drawImage(whiteLogo(sch), 56, 40, sch.naturalWidth * k, 112); }
    if (smv) { const k = 118 / smv.naturalHeight; x.drawImage(whiteLogo(smv), W - 56 - smv.naturalWidth * k, 37, smv.naturalWidth * k, 118); }
    const title = String(s.title || 'Oberstufen-Turnier').toUpperCase() + (s.season ? ' ' + s.season : '');
    txt(x, title, 540, 78, { size: 30, w: 700, ls: 5, c: '#9EC9FF', al: 'center', max: 700 });
    const head = H.isTest(m) ? 'TESTSPIEL' : 'SPIEL ' + String(m.no).padStart(2, '0') + ' · ' + String(m.label || STAGES[m.stage].l).toUpperCase();
    txt(x, head, 540, 150, { size: 76, w: 900, al: 'center', max: 700 });
    // Score
    await teamBox(x, h, H.phOf(m, 'h'), 50, 250, 270);
    await teamBox(x, a, H.phOf(m, 'a'), W - 50 - 270, 250, 270);
    x.save(); rr(x, 350, 230, 380, 310, 34); x.fillStyle = 'rgba(5,10,30,.92)'; x.shadowColor = '#2E6BFF'; x.shadowBlur = 60; x.fill(); x.shadowBlur = 0; x.lineWidth = 6; x.strokeStyle = '#2E6BFF'; x.stroke(); x.restore();
    const sc = r.h + ':' + r.a;
    x.save(); x.shadowColor = 'rgba(92,194,255,.9)'; x.shadowBlur = 36;
    g = x.createLinearGradient(0, 250, 0, 520); g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#7CC4FF');
    txt(x, sc, 540, 466, { size: 230, w: 900, al: 'center', max: 340, c: g }); x.restore();
    const sub = m.pen && (m.pen.h || m.pen.a) ? 'N. E. ' + m.pen.h + ':' + m.pen.a : m.status === 'done' ? 'ENDSTAND' : m.status === 'live' ? 'LIVE · ZWISCHENSTAND' : 'NOCH NICHT GESPIELT';
    txt(x, sub, 540, 612, { size: 34, w: 800, ls: 4, c: m.pen ? '#5CC2FF' : '#A3B3DA', al: 'center' });
    // Ereignisse
    const L = rows(m, 'h'), R = rows(m, 'a'), n = Math.max(L.length, R.length);
    const top = 690, bottom = 1225;
    x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(60, top - 26, W - 120, 2);
    if (!n) txt(x, r.h + r.a ? '' : 'KEINE TORE', 540, top + 90, { size: 44, w: 800, c: '#6F80AD', al: 'center' });
    const rh = n ? Math.min(66, (bottom - top) / n) : 66, fs = Math.round(rh * 0.56), is = Math.round(rh * 0.66);
    if (n) { x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(539, top, 2, n * rh); }
    // Symbole an der Mittellinie; ab 4 gleichen: ein Symbol + „×4“. Gibt die belegte Breite zurück.
    const icons = (row, x0, dir, cy) => {
      const n4 = row.mins.length > 3, k = n4 ? 1 : row.mins.length;
      for (let i = 0; i < k; i++) icon(x, row.type, x0 + dir * (i * (is + 6) + is / 2), cy, is);
      let used = k * is + (k - 1) * 6;
      if (n4) used += 8 + txt(x, '×' + row.mins.length, x0 + dir * (is + 8), cy + fs * 0.36, { size: fs, w: 900, c: '#5CC2FF', al: dir > 0 ? 'left' : 'right' });
      return used;
    };
    const minTxt = (row) => row.mins.filter((v) => v).map((v) => v + "'").join(', ');
    const MIN = 130, NAME_L = 60 + MIN + 14, NAME_R = W - 60 - MIN - 14;
    L.forEach((row, i) => {
      const cy = top + i * rh + rh / 2, base = cy + fs * 0.36;
      txt(x, minTxt(row), 60, base, { size: fs, w: 800, c: '#5CC2FF', max: MIN });
      const used = icons(row, 515, -1, cy);
      txt(x, row.name, NAME_L, base, { size: fs, w: 800, max: 515 - used - 18 - NAME_L });
    });
    R.forEach((row, i) => {
      const cy = top + i * rh + rh / 2, base = cy + fs * 0.36;
      const used = icons(row, 565, 1, cy);
      txt(x, row.name, NAME_R, base, { size: fs, w: 800, al: 'right', max: NAME_R - (565 + used + 18) });
      txt(x, minTxt(row), W - 60, base, { size: fs, w: 800, c: '#5CC2FF', al: 'right', max: MIN });
    });
    // Fuß
    x.fillStyle = 'rgba(4,6,13,.85)'; x.fillRect(0, HH - 92, W, 92); x.fillStyle = '#2E6BFF'; x.fillRect(0, HH - 92, W, 4);
    const day = (m && m.day) || s.day, dt = day ? new Date(day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase() : '';
    txt(x, 'SMV PARLER-GYMNASIUM', 56, HH - 34, { size: 32, w: 800 });
    txt(x, [dt, s.location ? String(s.location).toUpperCase() : ''].filter(Boolean).join(' · '), W - 56, HH - 34, { size: 30, w: 700, c: '#A3B3DA', al: 'right', max: 520 });
    return c;
  }

  /* ---------- Seite ---------- */
  const sig = (m) => [m.id, m.status, m.home, m.away, m.events.map((e) => e.id + e.type + e.side + (e.player || '') + e.min).join(','), m.pen ? m.pen.h + '-' + m.pen.a : '', S.teams.map((t) => t.id + t.name + t.logo + t.color).join(',').length].join('|');
  const done = () => S.matches.filter((m) => m.status === 'done').sort((x, y) => (y.endedAt || 0) - (x.endedAt || 0));
  const fileName = (m) => (H.isTest(m) ? 'Testspiel' : 'Spiel-' + String(m.no).padStart(2, '0')) + '_' + (H.tName(m, 'h') + '_' + H.sc(m).h + '-' + H.sc(m).a + '_' + H.tName(m, 'a')).replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, '-') + '.png';
  async function ensure(m) {
    const k = sig(m), c = cache[m.id];
    if (c && c.sig === k) return c;
    const cv = await draw(m);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (c && c.url) URL.revokeObjectURL(c.url);
    cache[m.id] = { sig: k, blob, url: URL.createObjectURL(blob) };
    return cache[m.id];
  }
  function download(m) { const c = cache[m.id]; if (!c) return; const a = document.createElement('a'); a.href = c.url; a.download = fileName(m); document.body.appendChild(a); a.click(); a.remove(); }
  async function share(m) {
    const c = cache[m.id]; if (!c) return;
    const f = new File([c.blob], fileName(m), { type: 'image/png' });
    try { await navigator.share({ files: [f], title: H.tName(m, 'h') + ' ' + H.sc(m).h + ':' + H.sc(m).a + ' ' + H.tName(m, 'a') }); } catch (e) { if (e.name !== 'AbortError') download(m); }
  }
  const canShare = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] })); } catch (e) { return false; } })();

  async function render() {
    const list = done();
    const seen = LS.get('seen', null), auto = LS.get('auto', false);
    const fresh = LS.get('fresh', {});
    app.innerHTML = `<div class="ps"><div class="pr-top"><h1>Insta-<span>Posts</span></h1><span class="pr-sp"></span><a class="pr-b" href="/" target="_blank" rel="noopener">Website</a><button class="pr-b" data-act="logout">Abmelden</button></div>
      <div class="pr-opt"><label><input type="checkbox" id="auto"${auto ? ' checked' : ''}> Neue Ergebnisse automatisch herunterladen</label><span class="pr-sp"></span><button class="pr-b pri" data-act="all"${list.length ? '' : ' disabled'}>⬇ Alle herunterladen (${list.length})</button>
        <div class="pr-hint" style="flex-basis:100%">Nach jedem Abpfiff erscheint das Spiel hier von selbst (Format 4:5, 1080 × 1350 px). Diese Seite offen lassen, damit neue Ergebnisse automatisch kommen.${canShare ? ' „Teilen“ öffnet direkt Instagram & Co.' : ''}</div></div>
      ${list.length ? `<div class="pr-grid">${list.map((m) => `<div class="pr-card${fresh[m.id] ? ' neu' : ''}" data-id="${m.id}"><img alt="Ergebnis-Post ${esc(H.tName(m, 'h'))} gegen ${esc(H.tName(m, 'a'))}" src="${cache[m.id] && cache[m.id].sig === sig(m) ? cache[m.id].url : ''}">
        <div class="meta">${esc(H.tName(m, 'h'))} ${H.sc(m).h}:${H.sc(m).a} ${esc(H.tName(m, 'a'))}${fresh[m.id] ? '<span class="pr-tag">Neu</span>' : ''}<small>${H.isTest(m) ? 'Testspiel · ' + esc(H.dayText(m)) : 'Spiel ' + m.no + ' · ' + esc(m.label || STAGES[m.stage].l)}</small></div>
        <div class="act"><button class="pr-b pri" data-act="dl" data-id="${m.id}">⬇ PNG</button>${canShare ? `<button class="pr-b" data-act="share" data-id="${m.id}">Teilen</button>` : ''}</div></div>`).join('')}</div>` : '<div class="pr-empty">Noch kein Spiel beendet. Nach dem ersten Abpfiff erscheint der Post hier automatisch.</div>'}</div>`;
    // Bilder erzeugen (und neue automatisch herunterladen)
    const newSeen = Object.assign({}, seen || {});
    for (const m of list) {
      const c = await ensure(m);
      const img = app.querySelector(`.pr-card[data-id="${m.id}"] img`); if (img && img.src !== c.url) img.src = c.url;
      if (seen && seen[m.id] !== c.sig) { fresh[m.id] = 1; markFresh(m); if (auto) { download(m); toast('Neuer Post heruntergeladen: ' + H.tName(m, 'h') + ' ' + H.sc(m).h + ':' + H.sc(m).a + ' ' + H.tName(m, 'a')); } }
      newSeen[m.id] = c.sig;
    }
    LS.set('seen', newSeen); LS.set('fresh', fresh);
  }
  function markFresh(m) { const el = app.querySelector(`.pr-card[data-id="${m.id}"]`); if (!el || el.classList.contains('neu')) return; el.classList.add('neu'); const mt = el.querySelector('.meta'); if (mt && mt.firstChild) mt.insertBefore(Object.assign(document.createElement('span'), { className: 'pr-tag', textContent: 'Neu' }), mt.querySelector('small')); }
  let lastKey = null;
  async function load() {
    try {
      const n = await PT.fetchState(false);
      S = n; H = PT.make(S);
      const key = done().map(sig).join('#');
      if (key !== lastKey) { lastKey = key; await render(); }
    } catch (e) { console.error(e); if (!S) app.innerHTML = '<div class="ps pr-empty">Keine Verbindung – wird erneut versucht …</div>'; }
  }
  function showLogin(msg) {
    app.innerHTML = `<form class="pr-login" id="lf"><h1>Insta-Posts</h1><div class="pr-hint">Ergebnis-Bilder für den Insta-Kanal der SMV. Bitte das Presse-Passwort eingeben.</div>
      <input id="pw" type="password" autocomplete="current-password" placeholder="Passwort" required><div class="pr-err" id="err">${esc(msg || '')}</div><button class="pr-b pri" style="width:100%;justify-content:center">Anmelden</button></form>`;
    document.getElementById('pw').focus();
    document.getElementById('lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/api/auth?action=press-login', { pass: document.getElementById('pw').value }); begin(); }
      catch (x) { document.getElementById('err').textContent = x.message; }
    });
  }
  let timer = null;
  async function begin() {
    // Beim allerersten Besuch: vorhandene Spiele gelten als bekannt (kein Download-Schwall)
    await Promise.all([document.fonts.load('italic 900 80px "Barlow Condensed"'), document.fonts.load('italic 800 40px "Barlow Condensed"'), document.fonts.load('italic 700 30px "Barlow Condensed"')]).catch(() => {});
    await load();
    if (!timer) timer = setInterval(() => { if (!document.hidden || LS.get('auto', false)) load(); }, 4000);
  }
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, m = b.dataset.id && S.matches.find((x) => x.id === b.dataset.id);
    if (a === 'dl' && m) { await ensure(m); download(m); clearFresh(m.id); }
    if (a === 'share' && m) { await ensure(m); share(m); clearFresh(m.id); }
    if (a === 'all') { for (const x of done()) { await ensure(x); download(x); await new Promise((r) => setTimeout(r, 350)); } LS.set('fresh', {}); app.querySelectorAll('.pr-card.neu').forEach((c) => c.classList.remove('neu')); app.querySelectorAll('.pr-tag').forEach((t) => t.remove()); }
    if (a === 'logout') { await api('/api/auth?action=press-logout', {}).catch(() => {}); clearInterval(timer); timer = null; showLogin(); }
  });
  function clearFresh(id) { const f = LS.get('fresh', {}); delete f[id]; LS.set('fresh', f); const c = app.querySelector(`.pr-card[data-id="${id}"]`); if (c) { c.classList.remove('neu'); const t = c.querySelector('.pr-tag'); if (t) t.remove(); } }
  app.addEventListener('change', (e) => { if (e.target.id === 'auto') { LS.set('auto', e.target.checked); toast(e.target.checked ? 'Neue Ergebnisse werden automatisch heruntergeladen.' : 'Automatischer Download aus.'); } });

  (async () => {
    try { const me = await api('/api/auth?action=press-me'); if (me.ok) begin(); else showLogin(); }
    catch (e) { showLogin('Keine Verbindung zum Server.'); }
  })();
  window.PT_POST = { draw: (id) => draw(S.matches.find((m) => m.id === id)) };
})();
