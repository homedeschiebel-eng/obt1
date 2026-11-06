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
  // Foto oben (eigenes Foto der Presse, sonst Teamfoto des Siegers), Ergebnis als unterer Block wie eine Bauchbinde
  function cover(x, img, dx, dy, dw, dh) { const k = Math.max(dw / img.naturalWidth, dh / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k; x.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) * 0.35, w, h); }
  async function logoBox(x, t, bx, by, bw) {
    x.save(); rr(x, bx, by, bw, bw, 26); x.fillStyle = 'rgba(6,11,28,.92)'; x.shadowColor = t ? t.color : '#2E6BFF'; x.shadowBlur = 34; x.fill(); x.shadowBlur = 0;
    x.lineWidth = 4; x.strokeStyle = t ? t.color : '#2A3560'; x.stroke(); x.restore();
    const img = t && t.logo ? await loadImg(t.logo) : null, pad = bw * 0.13, inner = bw - 2 * pad;
    if (img) {
      x.save(); rr(x, bx + pad, by + pad, inner, inner, 18); x.fillStyle = '#fff'; x.fill(); x.clip();
      const k = Math.min((inner - 16) / img.naturalWidth, (inner - 16) / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
      x.drawImage(img, bx + bw / 2 - w / 2, by + bw / 2 - h / 2, w, h); x.restore();
    } else {
      x.beginPath(); x.arc(bx + bw / 2, by + bw / 2, inner / 2, 0, Math.PI * 2); x.fillStyle = t ? t.color : '#2A3560'; x.fill();
      x.lineWidth = 5; x.strokeStyle = 'rgba(255,255,255,.3)'; x.stroke();
      txt(x, t ? PT.short(t) : '?', bx + bw / 2, by + bw / 2 + inner * 0.13, { size: inner * 0.36, w: 900, al: 'center', max: inner * 0.8 });
    }
  }
  async function draw(m) {
    const c = document.createElement('canvas'); c.width = W; c.height = HH; const x = c.getContext('2d');
    const s = S.settings, r = H.sc(m), h = H.teamOf(m, 'h'), a = H.teamOf(m, 'a');
    const win = r.h > r.a || (r.h === r.a && m.pen && m.pen.h > m.pen.a) ? h : r.a > r.h || (m.pen && m.pen.a > m.pen.h) ? a : (h && h.photo ? h : a);
    const photo = photos[m.id] || (win && win.photo ? await loadImg(win.photo) : null);
    const BASE = '#060B1C', Y0 = 640; // ab hier beginnt der Ergebnis-Block
    x.fillStyle = BASE; x.fillRect(0, 0, W, HH);
    if (photo) {
      cover(x, photo, 0, 0, W, 860);
    } else {
      let g = x.createLinearGradient(0, 0, 0, 860); g.addColorStop(0, '#173A86'); g.addColorStop(1, '#0A1430'); x.fillStyle = g; x.fillRect(0, 0, W, 860);
      g = x.createRadialGradient(540, 330, 30, 540, 330, 620); g.addColorStop(0, 'rgba(46,107,255,.6)'); g.addColorStop(1, 'rgba(46,107,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, 860);
      x.save(); x.strokeStyle = 'rgba(255,255,255,.04)'; x.lineWidth = 2; for (let i = -900; i < W; i += 26) { x.beginPath(); x.moveTo(i, 860); x.lineTo(i + 520, 0); x.stroke(); } x.restore();
      const smvBig = await loadImg('/img/smv.png');
      if (smvBig) { x.save(); x.globalAlpha = 0.09; const k = 470 / smvBig.naturalHeight; x.drawImage(whiteLogo(smvBig), 540 - smvBig.naturalWidth * k / 2, 95, smvBig.naturalWidth * k, 470); x.restore(); }
      txt(x, String(s.title || 'Oberstufen-Turnier').toUpperCase(), 540, 395, { size: 104, w: 900, al: 'center', max: 940 });
      txt(x, ((s.school || 'Parler-Gymnasium') + (s.season ? ' · ' + s.season : '')).toUpperCase(), 540, 455, { size: 36, w: 700, ls: 8, c: '#9EC9FF', al: 'center', max: 900 });
    }
    // Übergänge: oben dunkel für die Logos, unten in den Ergebnis-Block
    let g = x.createLinearGradient(0, 0, 0, 230); g.addColorStop(0, 'rgba(6,11,28,.75)'); g.addColorStop(1, 'rgba(6,11,28,0)'); x.fillStyle = g; x.fillRect(0, 0, W, 230);
    g = x.createLinearGradient(0, Y0 - 280, 0, Y0 + 60); g.addColorStop(0, 'rgba(6,11,28,0)'); g.addColorStop(0.75, 'rgba(6,11,28,.94)'); g.addColorStop(1, BASE); x.fillStyle = g; x.fillRect(0, Y0 - 280, W, 340); x.fillStyle = BASE; x.fillRect(0, Y0 + 60, W, 880 - Y0);
    g = x.createRadialGradient(540, Y0 + 230, 20, 540, Y0 + 230, 500); g.addColorStop(0, 'rgba(46,107,255,.30)'); g.addColorStop(1, 'rgba(46,107,255,0)'); x.fillStyle = g; x.fillRect(0, Y0 - 280, W, HH - Y0 + 280);
    // Kopfzeile über dem Foto
    const [sch, smv] = await Promise.all([loadImg('/img/schule.png'), loadImg('/img/smv.png')]);
    if (sch) { const k = 92 / sch.naturalHeight; x.drawImage(whiteLogo(sch), 48, 36, sch.naturalWidth * k, 92); }
    if (smv) { const k = 98 / smv.naturalHeight; x.drawImage(whiteLogo(smv), W - 48 - smv.naturalWidth * k, 33, smv.naturalWidth * k, 98); }
    if (photo) txt(x, (String(s.title || 'Oberstufen-Turnier') + (s.season ? ' ' + s.season : '')).toUpperCase(), 540, 92, { size: 30, w: 700, ls: 6, c: '#DCE6FF', al: 'center', max: 640 });
    // Titel des Spiels (wie „Matchday 05“)
    const head = H.isTest(m) ? 'TESTSPIEL' : 'SPIEL ' + String(m.no).padStart(2, '0') + ' · ' + String(m.label || STAGES[m.stage].l).toUpperCase();
    x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 18; txt(x, head, 540, Y0 + 50, { size: 66, w: 900, ls: 3, al: 'center', max: 900 }); x.restore();
    // Logos + Spielstand
    const RY = Y0 + 85, BW = 196;
    await logoBox(x, h, 70, RY + 12, BW); await logoBox(x, a, W - 70 - BW, RY + 12, BW);
    x.save(); rr(x, 300, RY, 480, 220, 30); x.fillStyle = 'rgba(4,8,24,.95)'; x.shadowColor = '#2E6BFF'; x.shadowBlur = 55; x.fill(); x.shadowBlur = 0; x.lineWidth = 5; x.strokeStyle = '#2E6BFF'; x.stroke(); x.restore();
    x.save(); x.shadowColor = 'rgba(92,194,255,.95)'; x.shadowBlur = 32;
    g = x.createLinearGradient(0, RY + 20, 0, RY + 200); g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#7CC4FF');
    txt(x, r.h + ':' + r.a, 540, RY + 182, { size: 190, w: 900, al: 'center', max: 420, c: g }); x.restore();
    const sub = m.pen && (m.pen.h || m.pen.a) ? 'N. E. ' + m.pen.h + ':' + m.pen.a : m.status === 'done' ? 'ENDSTAND' : m.status === 'live' ? 'ZWISCHENSTAND' : '';
    if (sub) { x.save(); rr(x, 440, RY + 202, 200, 38, 8); x.fillStyle = m.pen ? '#1E9BE0' : '#2E6BFF'; x.fill(); x.restore(); txt(x, sub, 540, RY + 230, { size: 26, w: 800, ls: 3, al: 'center', max: 186 }); }
    txt(x, (h ? h.name : H.phOf(m, 'h')).toUpperCase(), 70 + BW / 2, RY + BW + 58, { size: 32, w: 800, al: 'center', max: 230 });
    txt(x, (a ? a.name : H.phOf(m, 'a')).toUpperCase(), W - 70 - BW / 2, RY + BW + 58, { size: 32, w: 800, al: 'center', max: 230 });
    // Ereignisse unter dem Spielstand
    const L = rows(m, 'h'), R = rows(m, 'a'), n = Math.max(L.length, R.length);
    const top = RY + BW + 92, bottom = HH - 70;
    const rh = n ? Math.min(54, (bottom - top) / n) : 54, fs = Math.round(rh * 0.6), is = Math.round(rh * 0.8), gap = 4;
    if (!n) txt(x, r.h + r.a ? '' : 'KEINE TORE', 540, top + 46, { size: 38, w: 800, c: '#6F80AD', al: 'center' });
    if (n) { x.fillStyle = 'rgba(255,255,255,.10)'; x.fillRect(539, top + 4, 2, n * rh - 8); }
    const ZONE = 2 * is + gap; // immer nur die Breite von 2 Symbolen – mehr überlappen sich
    const icons = (row, edge, dir, cy) => { // edge = Kante an der Mittellinie, dir -1: nach links, 1: nach rechts
      const k = row.mins.length, step = k > 1 ? Math.min(is + gap, (ZONE - is) / (k - 1)) : 0;
      // von außen nach innen zeichnen, damit der Ball an der Mittellinie oben liegt
      for (let i = k - 1; i >= 0; i--) icon(x, row.type, edge + dir * (is / 2 + i * step), cy, is);
    };
    const minTxt = (row) => row.mins.filter((v) => v).map((v) => v + "'").join(', ');
    const MIN = 128, NL = 60 + MIN + 12, NR = W - 60 - MIN - 12, EL = 518, ER = 562;
    L.forEach((row, i) => {
      const cy = top + i * rh + rh / 2, base = cy + fs * 0.36;
      txt(x, minTxt(row), 60, base, { size: fs, w: 800, c: '#5CC2FF', max: MIN });
      txt(x, row.name, NL, base, { size: fs, w: 800, max: EL - ZONE - 16 - NL });
      icons(row, EL, -1, cy);
    });
    R.forEach((row, i) => {
      const cy = top + i * rh + rh / 2, base = cy + fs * 0.36;
      icons(row, ER, 1, cy);
      txt(x, row.name, NR, base, { size: fs, w: 800, al: 'right', max: NR - (ER + ZONE + 16) });
      txt(x, minTxt(row), W - 60, base, { size: fs, w: 800, c: '#5CC2FF', al: 'right', max: MIN });
    });
    // Fußzeile
    x.fillStyle = 'rgba(46,107,255,.9)'; x.fillRect(60, HH - 58, W - 120, 2);
    const day = (m && m.day) || s.day, dt = day ? new Date(day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase() : '';
    txt(x, 'SMV PARLER-GYMNASIUM', 60, HH - 20, { size: 26, w: 800, ls: 2 });
    txt(x, [dt, s.location ? String(s.location).toUpperCase() : ''].filter(Boolean).join(' · '), W - 60, HH - 20, { size: 26, w: 700, c: '#A3B3DA', al: 'right', max: 560 });
    return c;
  }

  /* ---------- Seite ---------- */
  const sig = (m) => [m.id, m.status, m.home, m.away, m.events.map((e) => e.id + e.type + e.side + (e.player || '') + e.min).join(','), m.pen ? m.pen.h + '-' + m.pen.a : '', S.teams.map((t) => t.id + t.name + t.logo + t.photo + t.color).join(','), photos[m.id] ? photos[m.id].src : ''].join('|');
  const baseSig = (m) => sig(m).split('|').slice(0, -1).join('|'); // ohne eigenes Foto (zählt nicht als neues Ergebnis)
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
        <div class="pr-hint" style="flex-basis:100%">Nach jedem Abpfiff erscheint das Spiel hier von selbst (Format 4:5, 1080 × 1350 px). Diese Seite offen lassen, damit neue Ergebnisse automatisch kommen. Mit „📷 Foto“ setzt du oben ein eigenes Bild ein (sonst Teamfoto des Siegers).${canShare ? ' „Teilen“ öffnet direkt Instagram & Co.' : ''}</div></div>
      ${list.length ? `<div class="pr-grid">${list.map((m) => `<div class="pr-card${fresh[m.id] ? ' neu' : ''}" data-id="${m.id}"><img alt="Ergebnis-Post ${esc(H.tName(m, 'h'))} gegen ${esc(H.tName(m, 'a'))}" src="${cache[m.id] && cache[m.id].sig === sig(m) ? cache[m.id].url : ''}">
        <div class="meta">${esc(H.tName(m, 'h'))} ${H.sc(m).h}:${H.sc(m).a} ${esc(H.tName(m, 'a'))}${fresh[m.id] ? '<span class="pr-tag">Neu</span>' : ''}<small>${H.isTest(m) ? 'Testspiel · ' + esc(H.dayText(m)) : 'Spiel ' + m.no + ' · ' + esc(m.label || STAGES[m.stage].l)}</small></div>
        <div class="act"><button class="pr-b pri" data-act="dl" data-id="${m.id}">⬇ PNG</button><label class="pr-b">📷 Foto<input type="file" accept="image/*" data-photo="${m.id}" hidden></label>${photos[m.id] ? `<button class="pr-b" data-act="nophoto" data-id="${m.id}">Foto weg</button>` : ''}${canShare ? `<button class="pr-b" data-act="share" data-id="${m.id}">Teilen</button>` : ''}</div></div>`).join('')}</div>` : '<div class="pr-empty">Noch kein Spiel beendet. Nach dem ersten Abpfiff erscheint der Post hier automatisch.</div>'}</div>`;
    // Bilder erzeugen (und neue automatisch herunterladen)
    const newSeen = Object.assign({}, seen || {});
    for (const m of list) {
      const c = await ensure(m);
      const img = app.querySelector(`.pr-card[data-id="${m.id}"] img`); if (img && img.src !== c.url) img.src = c.url;
      if (seen && seen[m.id] !== baseSig(m)) { fresh[m.id] = 1; markFresh(m); if (auto) { download(m); toast('Neuer Post heruntergeladen: ' + H.tName(m, 'h') + ' ' + H.sc(m).h + ':' + H.sc(m).a + ' ' + H.tName(m, 'a')); } }
      newSeen[m.id] = baseSig(m);
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
    if (a === 'nophoto' && m) { URL.revokeObjectURL(photos[m.id].src); delete photos[m.id]; await refreshCard(m); }
    if (a === 'logout') { await api('/api/auth?action=press-logout', {}).catch(() => {}); clearInterval(timer); timer = null; showLogin(); }
  });
  function clearFresh(id) { const f = LS.get('fresh', {}); delete f[id]; LS.set('fresh', f); const c = app.querySelector(`.pr-card[data-id="${id}"]`); if (c) { c.classList.remove('neu'); const t = c.querySelector('.pr-tag'); if (t) t.remove(); } }
  // Eigenes Foto für den oberen Teil – bleibt nur in diesem Browser, wird nicht hochgeladen
  async function refreshCard(m) { lastKey = null; await render(); }
  app.addEventListener('change', async (e) => {
    const id = e.target.dataset && e.target.dataset.photo;
    if (id) { const f = e.target.files[0]; if (!f) return; const img = await loadImg(URL.createObjectURL(f)); if (!img) { toast('Das Bild konnte nicht geöffnet werden.'); return; } if (photos[id]) URL.revokeObjectURL(photos[id].src); photos[id] = img; const m = S.matches.find((x) => x.id === id); if (m) { await refreshCard(m); toast('Foto eingesetzt – jetzt „⬇ PNG“ oder „Teilen“.'); } return; } if (e.target.id === 'auto') { LS.set('auto', e.target.checked); toast(e.target.checked ? 'Neue Ergebnisse werden automatisch heruntergeladen.' : 'Automatischer Download aus.'); } });

  (async () => {
    try { const me = await api('/api/auth?action=press-me'); if (me.ok) begin(); else showLogin(); }
    catch (e) { showLogin('Keine Verbindung zum Server.'); }
  })();
  window.PT_POST = { draw: (id) => draw(S.matches.find((m) => m.id === id)) };
})();
