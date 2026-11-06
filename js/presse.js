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
  const photos = {}; // match id -> eigenes Foto (nur in diesem Browser)
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
  // Fußball mit Schattierung, Mittel-Fünfeck, Rand-Fünfecken und Nähten
  function ball(x, cx, cy, r, red) {
    const ink = red ? '#4A0716' : '#141A2B', P = (ox, oy, rad, rot) => { const out = []; for (let i = 0; i < 5; i++) { const a = rot + i * 2 * Math.PI / 5; out.push([ox + rad * Math.cos(a), oy + rad * Math.sin(a)]); } return out; };
    const poly = (pts) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); };
    x.save();
    // Trennring zum Nachbarball + Schatten
    x.beginPath(); x.arc(cx, cy, r + Math.max(2, r * 0.09), 0, Math.PI * 2); x.fillStyle = '#060B1C'; x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = r * 0.5; x.shadowOffsetY = r * 0.12; x.fill();
    x.shadowColor = 'transparent';
    const g = x.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r * 1.05);
    if (red) { g.addColorStop(0, '#FFB3C1'); g.addColorStop(0.45, '#FF4D6D'); g.addColorStop(1, '#9E1030'); }
    else { g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.55, '#E9EDF5'); g.addColorStop(1, '#8F99AE'); }
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = g; x.fill(); x.clip();
    const top = -Math.PI / 2, c = P(cx, cy, r * 0.34, top);
    const outer = c.map((v, i) => { const a = top + i * 2 * Math.PI / 5; return P(cx + r * 1.0 * Math.cos(a), cy + r * 1.0 * Math.sin(a), r * 0.36, a + Math.PI); });
    x.lineWidth = Math.max(1.2, r * 0.07); x.strokeStyle = ink; x.lineCap = 'round';
    // Nähte: Mitte → Rand-Fünfeck, und zwischen benachbarten Rand-Fünfecken
    c.forEach((v, i) => { const o = outer[i][0]; x.beginPath(); x.moveTo(v[0], v[1]); x.lineTo(o[0], o[1]); x.stroke(); });
    outer.forEach((o, i) => { const n = outer[(i + 1) % 5]; x.beginPath(); x.moveTo(o[4][0], o[4][1]); x.lineTo(n[1][0], n[1][1]); x.stroke(); });
    x.fillStyle = ink; poly(c); x.fill(); outer.forEach((o) => { poly(o); x.fill(); });
    // Glanzlicht und Rand
    const hl = x.createRadialGradient(cx - r * 0.4, cy - r * 0.45, 0, cx - r * 0.4, cy - r * 0.45, r * 0.6);
    hl.addColorStop(0, 'rgba(255,255,255,.65)'); hl.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = hl; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    x.restore();
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.lineWidth = Math.max(1, r * 0.05); x.strokeStyle = 'rgba(0,0,0,.35)'; x.stroke();
  }
  function icon(x, type, cx, cy, s) {
    if (type === 'goal' || type === 'og') return ball(x, cx, cy, s * 0.47, type === 'og');
    const w = s * 0.62, h = s * 0.86;
    x.save(); x.translate(cx, cy); x.rotate(0.12);
    rr(x, -w / 2 - 3, -h / 2 - 3, w + 6, h + 6, s * 0.1); x.fillStyle = '#060B1C'; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 8; x.fill(); x.shadowBlur = 0;
    const g = x.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    if (type === 'yellow') { g.addColorStop(0, '#FFE680'); g.addColorStop(1, '#F2B705'); } else { g.addColorStop(0, '#FFB36B'); g.addColorStop(1, '#E8590C'); }
    rr(x, -w / 2, -h / 2, w, h, s * 0.08); x.fillStyle = g; x.fill();
    if (type === 'red') txt(x, "2'", 0, h * 0.16, { size: s * 0.44, w: 900, c: '#2A0E00', al: 'center' });
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
  // Spielbild füllt das ganze Bild (4:5) und wird abgedunkelt – oben leicht, unten stark. Ergebnis unten wie eine Bauchbinde.
  function cover(x, img, dx, dy, dw, dh) { const k = Math.max(dw / img.naturalWidth, dh / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k; x.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h); }
  async function crest(x, t, cx, cy, rad) {
    const img = t && t.logo ? await loadImg(t.logo) : null;
    x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 30; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2);
    x.fillStyle = img ? '#fff' : (t ? t.color : '#2A3560'); x.fill(); x.shadowBlur = 0;
    x.lineWidth = 6; x.strokeStyle = t ? t.color : '#2E6BFF'; x.stroke(); x.restore();
    if (img) {
      x.save(); x.beginPath(); x.arc(cx, cy, rad - 4, 0, Math.PI * 2); x.clip();
      const k = Math.min(rad * 1.45 / img.naturalWidth, rad * 1.45 / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
      x.drawImage(img, cx - w / 2, cy - h / 2, w, h); x.restore();
    } else txt(x, t ? PT.short(t) : '?', cx, cy + rad * 0.27, { size: rad * 0.78, w: 900, al: 'center', max: rad * 1.6 });
  }
  // Name und Minuten in zwei Farben, gemeinsam verkleinert, bis sie in maxW passen
  function pair(x, name, mins, px, base, dir, size, maxW) {
    const gap = mins ? size * 0.32 : 0; let s = size, wN, wM;
    const meas = () => { x.font = `italic 800 ${s}px ${FD}`; wN = x.measureText(name).width; wM = mins ? x.measureText(mins).width : 0; return wN + gap + wM; };
    while (s > 14 && meas() > maxW) s -= 1;
    x.font = `italic 800 ${s}px ${FD}`; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    if (dir < 0) { // rechtsbündig: … NAME 4', 5'
      if (mins) { x.fillStyle = '#7CC8FF'; x.fillText(mins, px - wM, base); }
      x.fillStyle = '#fff'; x.fillText(name, px - wM - gap - wN, base);
    } else { // linksbündig: 4', 5' NAME …
      if (mins) { x.fillStyle = '#7CC8FF'; x.fillText(mins, px, base); }
      x.fillStyle = '#fff'; x.fillText(name, px + wM + gap, base);
    }
  }
  async function draw(m) {
    const c = document.createElement('canvas'); c.width = W; c.height = HH; const x = c.getContext('2d');
    const s = S.settings, r = H.sc(m), h = H.teamOf(m, 'h'), a = H.teamOf(m, 'a');
    const photo = photos[m.id] || null;
    if (photo) cover(x, photo, 0, 0, W, HH);
    else {
      let g = x.createLinearGradient(0, 0, 0, HH); g.addColorStop(0, '#173A86'); g.addColorStop(0.6, '#0A1430'); g.addColorStop(1, '#04060D'); x.fillStyle = g; x.fillRect(0, 0, W, HH);
      g = x.createRadialGradient(540, 380, 30, 540, 380, 640); g.addColorStop(0, 'rgba(46,107,255,.6)'); g.addColorStop(1, 'rgba(46,107,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, HH);
      x.save(); x.strokeStyle = 'rgba(255,255,255,.04)'; x.lineWidth = 2; for (let i = -HH; i < W; i += 26) { x.beginPath(); x.moveTo(i, HH); x.lineTo(i + HH * 0.6, 0); x.stroke(); } x.restore();
      const big = await loadImg('/img/smv.png');
      if (big) { x.save(); x.globalAlpha = 0.1; const k = 480 / big.naturalHeight; x.drawImage(whiteLogo(big), 540 - big.naturalWidth * k / 2, 150, big.naturalWidth * k, 480); x.restore(); }
    }
    // Abdunkeln: oben leicht, nach unten immer stärker
    let g = x.createLinearGradient(0, 0, 0, HH);
    g.addColorStop(0, 'rgba(4,8,20,.50)'); g.addColorStop(0.16, 'rgba(4,8,20,.16)'); g.addColorStop(0.40, 'rgba(4,8,20,.22)');
    g.addColorStop(0.56, 'rgba(4,8,20,.62)'); g.addColorStop(0.72, 'rgba(4,8,20,.86)'); g.addColorStop(1, 'rgba(4,8,20,.95)');
    x.fillStyle = g; x.fillRect(0, 0, W, HH);
    // Kopf: Logos + Turnier
    const [sch, smv] = await Promise.all([loadImg('/img/schule.png'), loadImg('/img/smv.png')]);
    if (sch) { const k = 86 / sch.naturalHeight; x.drawImage(whiteLogo(sch), 48, 38, sch.naturalWidth * k, 86); }
    if (smv) { const k = 92 / smv.naturalHeight; x.drawImage(whiteLogo(smv), W - 48 - smv.naturalWidth * k, 35, smv.naturalWidth * k, 92); }
    x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 12;
    txt(x, (String(s.title || 'Oberstufen-Turnier') + (s.season ? ' ' + s.season : '')).toUpperCase(), 540, 92, { size: 30, w: 700, ls: 6, c: '#E6EEFF', al: 'center', max: 640 }); x.restore();
    // Rahmen wie im Beispiel: Ecken oben, Seitenlinien laufen nach unten aus
    const FT = 760, FL = 96, FR = W - 96, FB = 1245, BLUE = '#2E6BFF';
    x.save(); x.lineWidth = 3; x.strokeStyle = BLUE; x.shadowColor = BLUE; x.shadowBlur = 12;
    x.beginPath(); x.moveTo(FL + 240, FT); x.lineTo(FL, FT); x.stroke(); x.beginPath(); x.moveTo(FR - 240, FT); x.lineTo(FR, FT); x.stroke();
    [FL, FR].forEach((fx) => { const lg = x.createLinearGradient(0, FT, 0, FB); lg.addColorStop(0, BLUE); lg.addColorStop(1, 'rgba(46,107,255,0)'); x.strokeStyle = lg; x.beginPath(); x.moveTo(fx, FT); x.lineTo(fx, FB); x.stroke(); });
    x.restore();
    // Spieltitel klein über dem Ergebnis
    const head = H.isTest(m) ? 'TESTSPIEL' : 'SPIEL ' + String(m.no).padStart(2, '0') + ' · ' + String(m.label || STAGES[m.stage].l).toUpperCase();
    x.save(); x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 14; txt(x, head, 540, 712, { size: 38, w: 800, ls: 4, c: '#DCE6FF', al: 'center', max: 760 }); x.restore();
    // Wappen + großes Ergebnis
    await crest(x, h, 250, 870, 92); await crest(x, a, W - 250, 870, 92);
    x.save(); x.shadowColor = 'rgba(46,107,255,.9)'; x.shadowBlur = 40;
    txt(x, r.h + ':' + r.a, 540, 958, { size: 250, w: 900, al: 'center', max: 400, c: '#fff' }); x.restore();
    const sub = m.pen && (m.pen.h || m.pen.a) ? 'N. E. ' + m.pen.h + ':' + m.pen.a : m.status === 'done' ? 'ENDSTAND' : m.status === 'live' ? 'ZWISCHENSTAND' : '';
    if (sub) txt(x, sub, 540, 1004, { size: 26, w: 800, ls: 5, c: '#7CC8FF', al: 'center' });
    txt(x, (h ? h.name : H.phOf(m, 'h')).toUpperCase(), 250, 1004, { size: 30, w: 800, al: 'center', max: 260 });
    txt(x, (a ? a.name : H.phOf(m, 'a')).toUpperCase(), W - 250, 1004, { size: 30, w: 800, al: 'center', max: 260 });
    // Ereignisse unter den Teams (zur Mitte hin), Symbole an der Mitte
    const L = rows(m, 'h'), R = rows(m, 'a'), n = Math.max(L.length, R.length);
    const top = 1030, bottom = 1262;
    const rh = n ? Math.min(44, (bottom - top) / n) : 44, fs = Math.round(rh * 0.68), is = Math.round(rh * 0.78), gap = 4;
    const ZONE = 2 * is + gap; // immer nur die Breite von 2 Symbolen – mehr überlappen sich
    const icons = (row, edge, dir, cy) => {
      const k = row.mins.length, step = k > 1 ? Math.min(is + gap, (ZONE - is) / (k - 1)) : 0;
      for (let i = k - 1; i >= 0; i--) icon(x, row.type, edge + dir * (is / 2 + i * step), cy, is);
    };
    const minTxt = (row) => row.mins.filter((v) => v).map((v) => v + "'").join(', ');
    const EL = 516, ER = 564;
    if (!n && !(r.h + r.a)) txt(x, 'KEINE TORE', 540, top + 40, { size: 30, w: 800, ls: 3, c: '#9AA8CC', al: 'center' });
    L.forEach((row, i) => { const cy = top + i * rh + rh / 2; icons(row, EL, -1, cy); pair(x, row.name, minTxt(row), EL - ZONE - 14, cy + fs * 0.36, -1, fs, EL - ZONE - 14 - FL - 20); });
    R.forEach((row, i) => { const cy = top + i * rh + rh / 2; icons(row, ER, 1, cy); pair(x, row.name, minTxt(row), ER + ZONE + 14, cy + fs * 0.36, 1, fs, FR - 20 - (ER + ZONE + 14)); });
    // Fußzeile
    const day = (m && m.day) || s.day, dt = day ? new Date(day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase() : '';
    txt(x, ['SMV PARLER-GYMNASIUM', dt, s.location ? String(s.location).toUpperCase() : ''].filter(Boolean).join('  ·  '), 540, HH - 30, { size: 22, w: 700, ls: 3, c: '#8B9BC4', al: 'center', max: 960 });
    return c;
  }

  /* ---------- Bericht (KI) ---------- */
  const reports = {}; // id -> { text, source, hint, sig, loading, edit }
  const caption = (m, text) => `${text}\n\n⚽ ${H.tName(m, 'h')} ${H.sc(m).h}:${H.sc(m).a} ${H.tName(m, 'a')}${m.pen && (m.pen.h || m.pen.a) ? ' (n. E. ' + m.pen.h + ':' + m.pen.a + ')' : ''}\n#ParlerGymnasium #Oberstufenturnier #SMV #Hallenfußball`;
  const capOf = (m) => { const r = reports[m.id]; if (!r) return ''; return r.edit != null ? r.edit : caption(m, r.text); };
  async function loadReport(m, force) {
    const r = reports[m.id] || (reports[m.id] = {});
    if (r.loading) return; r.loading = true; paintReport(m);
    try {
      const j = force ? await api('/api/bericht?id=' + encodeURIComponent(m.id) + '&action=neu', {}) : await api('/api/bericht?id=' + encodeURIComponent(m.id));
      Object.assign(r, { text: j.text, source: j.source, hint: j.hint || '', sig: j.sig }); if (force || r.sigM !== baseSig(m)) r.edit = null; r.sigM = baseSig(m);
      const ed = LS.get('edit', {}); if (r.edit == null && ed[m.id] && ed[m.id].sig === r.sig) r.edit = ed[m.id].text;
    } catch (e) { r.hint = 'Bericht konnte nicht geladen werden: ' + e.message; }
    r.loading = false; paintReport(m);
  }
  function reportHTML(m) {
    const r = reports[m.id];
    if (!r || (r.loading && !r.text)) return `<div class="pr-rep-load">✍️ Bericht wird geschrieben …</div>`;
    return `<textarea data-cap="${m.id}" rows="6" aria-label="Text für den Post">${esc(capOf(m))}</textarea>
      <div class="pr-rep-act"><button class="pr-b" data-act="copy" data-id="${m.id}">📋 Text kopieren</button><button class="pr-b" data-act="rewrite" data-id="${m.id}"${r.loading ? ' disabled' : ''}>${r.loading ? 'Schreibt …' : '↻ Neu schreiben'}</button>
      <span class="pr-src">${r.source === 'ki' ? 'KI-Bericht' : 'Automatischer Text'}</span></div>${r.hint ? `<div class="pr-hint">${esc(r.hint)}</div>` : ''}`;
  }
  function paintReport(m) { const el = app.querySelector(`[data-rep="${m.id}"]`); if (el) el.innerHTML = reportHTML(m); }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (x) { ok = false; } ta.remove(); return ok;
    }
  }

  /* ---------- Seite ---------- */
  const sig = (m) => [m.id, m.status, m.home, m.away, m.events.map((e) => e.id + e.type + e.side + (e.player || '') + e.min).join(','), m.pen ? m.pen.h + '-' + m.pen.a : '', S.teams.map((t) => t.id + t.name + t.logo + t.color).join(','), photos[m.id] ? photos[m.id].src : ''].join('|');
  const baseSig = (m) => sig(m).split('|').slice(0, -1).join('|'); // ohne Spielbild (zählt nicht als neues Ergebnis)
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
    const cap = capOf(m); if (cap && await copyText(cap)) toast('Text kopiert – in Instagram einfach einfügen.');
    const f = new File([c.blob], fileName(m), { type: 'image/png' });
    try { await navigator.share({ files: [f], title: H.tName(m, 'h') + ' ' + H.sc(m).h + ':' + H.sc(m).a + ' ' + H.tName(m, 'a') }); } catch (e) { if (e.name !== 'AbortError') download(m); }
  }
  const canShare = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] })); } catch (e) { return false; } })();

  function cardHTML(m, fresh) {
    const hasPhoto = !!photos[m.id];
    return `<div class="pr-card${fresh ? ' neu' : ''}" data-id="${m.id}">
      <div class="pr-pic"><img alt="Ergebnis-Post ${esc(H.tName(m, 'h'))} gegen ${esc(H.tName(m, 'a'))}" src="${cache[m.id] && cache[m.id].sig === sig(m) ? cache[m.id].url : ''}">${hasPhoto ? '' : '<span class="pr-need">Noch kein Spielbild</span>'}</div>
      <div class="meta">${esc(H.tName(m, 'h'))} ${H.sc(m).h}:${H.sc(m).a} ${esc(H.tName(m, 'a'))}${fresh ? '<span class="pr-tag">Neu</span>' : ''}<small>${H.isTest(m) ? 'Testspiel · ' + esc(H.dayText(m)) : 'Spiel ' + m.no + ' · ' + esc(m.label || STAGES[m.stage].l)}</small></div>
      <div class="act"><label class="pr-b${hasPhoto ? '' : ' pri'}">📷 ${hasPhoto ? 'Anderes Bild' : 'Spielbild einfügen'}<input type="file" accept="image/*" data-photo="${m.id}" hidden></label>
        <button class="pr-b${hasPhoto ? ' pri' : ''}" data-act="dl" data-id="${m.id}">⬇ PNG</button>${canShare ? `<button class="pr-b" data-act="share" data-id="${m.id}">Teilen</button>` : ''}${hasPhoto ? `<button class="pr-b" data-act="nophoto" data-id="${m.id}">Bild entfernen</button>` : ''}</div>
      <div class="pr-rep" data-rep="${m.id}">${reportHTML(m)}</div></div>`;
  }
  async function render() {
    const list = done();
    const seen = LS.get('seen', null), auto = LS.get('auto', true);
    const fresh = LS.get('fresh', {});
    app.innerHTML = `<div class="ps"><div class="pr-top"><h1>Insta-<span>Posts</span></h1><span class="pr-sp"></span><a class="pr-b" href="/" target="_blank" rel="noopener">Website</a><button class="pr-b" data-act="logout">Abmelden</button></div>
      <div class="pr-opt"><label><input type="checkbox" id="auto"${auto ? ' checked' : ''}> Nach dem Einfügen des Spielbilds sofort herunterladen</label>
        <div class="pr-hint" style="flex-basis:100%">So geht's: Nach jedem Abpfiff erscheint das Spiel hier von selbst, der Bericht wird automatisch geschrieben. „📷 Spielbild einfügen“ (am besten 4:5, z. B. 1080 × 1350) – das Bild wird abgedunkelt und der Post fertig erstellt. Danach „📋 Text kopieren“ und beides bei Instagram posten.${canShare ? ' „Teilen“ kopiert den Text und öffnet direkt Instagram & Co.' : ''}</div></div>
      ${list.length ? `<div class="pr-grid">${list.map((m) => cardHTML(m, fresh[m.id])).join('')}</div>` : '<div class="pr-empty">Noch kein Spiel beendet. Nach dem ersten Abpfiff erscheint es hier automatisch.</div>'}</div>`;
    const newSeen = Object.assign({}, seen || {});
    for (const m of list) {
      if (seen && seen[m.id] !== baseSig(m)) { fresh[m.id] = 1; markFresh(m); toast('Neues Ergebnis: ' + H.tName(m, 'h') + ' ' + H.sc(m).h + ':' + H.sc(m).a + ' ' + H.tName(m, 'a')); }
      newSeen[m.id] = baseSig(m);
    }
    LS.set('seen', newSeen); LS.set('fresh', fresh);
    for (const m of list) {
      const c = await ensure(m);
      const img = app.querySelector(`.pr-card[data-id="${m.id}"] img`); if (img && img.src !== c.url) img.src = c.url;
    }
    for (const m of list) { const r = reports[m.id]; if (!r || (r.sigM !== baseSig(m) && !r.loading)) await loadReport(m); }
  }
  function markFresh(m) { const el = app.querySelector(`.pr-card[data-id="${m.id}"]`); if (!el || el.classList.contains('neu')) return; el.classList.add('neu'); const mt = el.querySelector('.meta'); if (mt) mt.insertBefore(Object.assign(document.createElement('span'), { className: 'pr-tag', textContent: 'Neu' }), mt.querySelector('small')); }
  function clearFresh(id) { const f = LS.get('fresh', {}); delete f[id]; LS.set('fresh', f); const c = app.querySelector(`.pr-card[data-id="${id}"]`); if (c) { c.classList.remove('neu'); const t = c.querySelector('.pr-tag'); if (t) t.remove(); } }
  let lastKey = null;
  async function load() {
    try {
      const n = await PT.fetchState(false);
      S = n; H = PT.make(S);
      const key = done().map(sig).join('#');
      if (key !== lastKey) { lastKey = key; await render(); }
    } catch (e) { console.error(e); if (!S) app.innerHTML = '<div class="ps pr-empty">Keine Verbindung – wird erneut versucht …</div>'; }
  }
  async function refreshCard(m) {
    const el = app.querySelector(`.pr-card[data-id="${m.id}"]`); if (!el) { lastKey = null; return load(); }
    const fresh = LS.get('fresh', {})[m.id];
    const c = await ensure(m);
    const tmp = document.createElement('div'); tmp.innerHTML = cardHTML(m, fresh); const nc = tmp.firstElementChild; el.replaceWith(nc);
    nc.querySelector('img').src = c.url; lastKey = done().map(sig).join('#');
  }
  function showLogin(msg) {
    app.innerHTML = `<form class="pr-login" id="lf"><h1>Insta-Posts</h1><div class="pr-hint">Ergebnis-Posts für den Insta-Kanal der SMV. Bitte das Presse-Passwort eingeben.</div>
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
    await Promise.all([document.fonts.load('italic 900 80px "Barlow Condensed"'), document.fonts.load('italic 800 40px "Barlow Condensed"'), document.fonts.load('italic 700 30px "Barlow Condensed"')]).catch(() => {});
    await load();
    if (!timer) timer = setInterval(() => { if (!document.hidden) load(); }, 4000);
  }
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, m = b.dataset.id && S.matches.find((x) => x.id === b.dataset.id);
    if (a === 'dl' && m) { if (!photos[m.id] && !confirm('Noch kein Spielbild eingefügt. Trotzdem ohne Bild herunterladen?')) return; await ensure(m); download(m); clearFresh(m.id); }
    if (a === 'share' && m) { await ensure(m); share(m); clearFresh(m.id); }
    if (a === 'nophoto' && m) { URL.revokeObjectURL(photos[m.id].src); delete photos[m.id]; await refreshCard(m); }
    if (a === 'copy' && m) { const ok = await copyText(capOf(m)); toast(ok ? 'Text kopiert ✓' : 'Kopieren nicht möglich – Text bitte markieren und kopieren.'); }
    if (a === 'rewrite' && m) { const ed = LS.get('edit', {}); delete ed[m.id]; LS.set('edit', ed); await loadReport(m, true); }
    if (a === 'logout') { await api('/api/auth?action=press-logout', {}).catch(() => {}); clearInterval(timer); timer = null; showLogin(); }
  });
  app.addEventListener('input', (e) => {
    const id = e.target.dataset && e.target.dataset.cap; if (!id || !reports[id]) return;
    reports[id].edit = e.target.value; const ed = LS.get('edit', {}); ed[id] = { sig: reports[id].sig, text: e.target.value }; LS.set('edit', ed);
  });
  app.addEventListener('change', async (e) => {
    if (e.target.id === 'auto') { LS.set('auto', e.target.checked); return; }
    const id = e.target.dataset && e.target.dataset.photo; if (!id) return;
    const f = e.target.files[0]; if (!f) return;
    const img = await loadImg(URL.createObjectURL(f)); if (!img) { toast('Das Bild konnte nicht geöffnet werden.'); return; }
    if (photos[id]) URL.revokeObjectURL(photos[id].src); photos[id] = img;
    const m = S.matches.find((x) => x.id === id); if (!m) return;
    await refreshCard(m);
    const q = img.naturalWidth / img.naturalHeight;
    if (Math.abs(q - 0.8) > 0.08) toast('Hinweis: Das Bild ist nicht 4:5 – es wurde mittig zugeschnitten.');
    if (LS.get('auto', true)) { download(m); clearFresh(m.id); toast('Post erstellt und heruntergeladen ✓'); }
  });

  (async () => {
    try { const me = await api('/api/auth?action=press-me'); if (me.ok) begin(); else showLogin(); }
    catch (e) { showLogin('Keine Verbindung zum Server.'); }
  })();
  window.PT_POST = { draw: (id) => draw(S.matches.find((m) => m.id === id)), photo: (id, img) => { photos[id] = img; } };
})();
