/* Teameditor: Teamname, Kürzel, Trikotfarbe, Logo, Spieler (nur Vornamen, Nummer freiwillig) und Torhymne – bis zur Frist */
(function () {
  'use strict';
  const { esc } = PT;
  const app = document.getElementById('app');
  const COLORS = [['#D62828', 'Rot'], ['#2E6BFF', 'Blau'], ['#0B2A6F', 'Dunkelblau'], ['#1E9BE0', 'Hellblau'], ['#2BA84A', 'Grün'], ['#FFD23F', 'Gelb'], ['#FF8A3D', 'Orange'], ['#8E44AD', 'Lila'], ['#E84393', 'Pink'], ['#111111', 'Schwarz'], ['#F4F4F4', 'Weiß'], ['#8A8F98', 'Grau']];
  let me = null, form = null, dirty = false, saving = false;

  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { location.replace('/login'); throw new Error('Bitte neu anmelden.'); }
    if (!r.ok) throw new Error(j.error || 'Fehler (Status ' + r.status + ')');
    return j;
  }
  const post = (url, body, headers) => api(url, { method: 'POST', headers: Object.assign({ 'x-csrf': '1' }, headers || {}), body });
  let toastT = null;
  function toast(msg) { let el = document.getElementById('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3800); }
  const fmtUntil = (ms) => new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB' : Math.round(n / 1024) + ' KB');

  function render() {
    const t = form, open = me.open, dis = open ? '' : ' disabled';
    const team = Object.assign({}, me.team, { name: t.name, short: t.short, color: t.color });
    app.innerHTML = `<div class="te">
      <div class="te-top"><span class="lk"><span class="logo ls"></span><i class="sep"></i><span class="logo lm"></span></span><span class="te-sp"></span><a class="te-b sm" href="/" target="_blank" rel="noopener">Website</a><button class="te-b sm" data-act="logout">Abmelden</button></div>
      <h1 class="te-h">Team<span>editor</span></h1>
      <p class="te-sub">${esc(me.team.name)}${me.team.group ? ` · <span class="te-grp">Gruppe ${esc(me.team.group)}</span>` : ' · Gruppe wird noch von der SMV eingeteilt'}</p>
      <div class="te-dl${open ? '' : ' closed'}">${open ? `✏️ Ihr könnt alles bis <b>${esc(fmtUntil(me.until))}</b> ändern.` : `🔒 Die Frist ist abgelaufen (${esc(fmtUntil(me.until))}). Änderungen gehen nur noch über die SMV.`}</div>

      <section class="te-card"><h2>Team</h2>
        <div class="te-row">
          <div class="te-f"><label for="f-name">Teamname</label><input id="f-name" type="text" maxlength="30" value="${esc(t.name)}"${dis}></div>
          <div class="te-f"><label for="f-short">Kürzel</label><input id="f-short" type="text" maxlength="3" value="${esc(t.short)}" style="text-transform:uppercase"${dis}></div>
        </div>
        <div class="te-hint">Kürzel: 2–3 Zeichen, Buchstaben oder Zahlen (z. B. DYN oder A26) – erscheint auf der Hallenanzeige und in Tabellen.</div>
      </section>

      <section class="te-card"><h2>Trikotfarbe <small>voraussichtlich</small></h2>
        <div class="te-colors">${COLORS.map(([c, n]) => `<button type="button" class="te-sw" style="background:${c}" data-color="${c}" aria-label="${n}" title="${n}" aria-pressed="${t.color.toLowerCase() === c.toLowerCase()}"${dis}></button>`).join('')}
          <input type="color" id="f-color" value="${esc(t.color)}" aria-label="Eigene Farbe"${dis}></div>
        <div class="te-hint" style="margin-top:8px">Die Farbe erscheint als Teamfarbe auf Website und Hallenanzeige.</div>
      </section>

      <section class="te-card"><h2>Teamlogo <small>freiwillig</small></h2>
        <div class="te-logo">${PT.monoHTML(team)}<div style="display:grid;gap:8px">
          <label class="te-b sm${open ? '' : ' disabled'}">${me.team.logo ? 'Anderes Logo' : 'Logo hochladen'}<input type="file" accept="image/*" id="f-logo" hidden${dis}></label>
          ${me.team.logo ? `<button type="button" class="te-b sm del" data-act="logo-del"${dis}>Logo entfernen</button>` : ''}</div></div>
        <div class="te-hint" style="margin-top:8px">JPG oder PNG. Das Logo wird automatisch quadratisch zugeschnitten (weißer Rand).</div>
      </section>

      <section class="te-card"><h2>Spieler/innen <small>${t.players.length} von ${me.maxPlayers}</small></h2>
        <div class="te-hint" style="margin-bottom:10px">Nur <b>Vornamen</b> – sie erscheinen bei Toren auf Website, Hallenanzeige und Instagram. Rückennummer freiwillig.</div>
        <div class="te-pl">${t.players.map((p, i) => `<div class="te-p"><span class="n">${i + 1}</span><input type="text" data-pn="${i}" maxlength="20" placeholder="Vorname" value="${esc(p.name)}" aria-label="Vorname Spieler/in ${i + 1}"${dis}><input type="number" data-pno="${i}" min="0" max="99" inputmode="numeric" placeholder="Nr." value="${p.no == null ? '' : esc(p.no)}" aria-label="Rückennummer Spieler/in ${i + 1}"${dis}><button type="button" class="te-b sm del" data-act="p-del" data-i="${i}" aria-label="Spieler/in ${i + 1} entfernen"${dis}>✕</button></div>`).join('')}</div>
        ${t.players.length < me.maxPlayers ? `<button type="button" class="te-b" data-act="p-add" style="margin-top:10px"${dis}>+ Spieler/in</button>` : ''}
      </section>

      <section class="te-card"><h2>Torhymne <small>freiwillig</small></h2>
        <div class="te-hy">${me.hymn ? `<div style="font-weight:700">🎵 ${esc(me.hymn.name)} <span class="te-hint">(${kb(me.hymn.size)})</span></div><audio controls preload="none" src="/api/team?action=hymn&id=${encodeURIComponent(me.team.id)}&t=${me.hymn.at}"></audio>` : '<div class="te-hint">Noch keine Hymne hochgeladen.</div>'}
          <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="te-b sm${open ? '' : ' disabled'}">${me.hymn ? 'Andere Hymne' : 'Hymne hochladen'}<input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" id="f-hymn" hidden${dis}></label>${me.hymn ? `<button type="button" class="te-b sm del" data-act="hymn-del"${dis}>Hymne entfernen</button>` : ''}</div>
          <div class="te-hint">Läuft in der Halle nach jedem Tor eures Teams. MP3 (oder M4A/WAV), <b>höchstens 1 MB</b> – am besten nur den Ausschnitt ab der Stelle, die laufen soll (ca. 20–40 Sekunden). Bitte nur jugendfreie Songs.</div></div>
      </section>
      </div>
      <div class="te-bar"><span class="msg" id="msg">${open ? (dirty ? 'Noch nicht gespeichert' : 'Alles gespeichert') : 'Nur Ansicht'}</span><button class="te-b pri" data-act="save"${open ? '' : ' disabled'}>Speichern</button></div>`;
  }
  function setMsg(txt, cls) { const el = document.getElementById('msg'); if (el) { el.textContent = txt; el.className = 'msg' + (cls ? ' ' + cls : ''); } }
  function markDirty() { dirty = true; setMsg('Noch nicht gespeichert'); }
  function readForm() {
    const v = (id) => (document.getElementById(id) || {}).value;
    form.name = v('f-name') || ''; form.short = String(v('f-short') || '').toUpperCase();
    form.players = form.players.map((p, i) => ({ id: p.id, name: (app.querySelector(`[data-pn="${i}"]`) || {}).value || '', no: (app.querySelector(`[data-pno="${i}"]`) || {}).value }));
  }

  // Logo quadratisch auf Weiß, 240 × 240
  function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Das Bild konnte nicht geöffnet werden.')); i.src = src; }); }
  async function squareLogo(file) {
    const img = await loadImage(URL.createObjectURL(file)), W = img.naturalWidth, H = img.naturalHeight, side = 240, k = side / Math.max(W, H);
    const c = document.createElement('canvas'); c.width = c.height = side; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.fillStyle = '#fff'; g.fillRect(0, 0, side, side); g.drawImage(img, (side - W * k) / 2, (side - H * k) / 2, W * k, H * k);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht umgewandelt werden.'))), 'image/png'));
  }

  async function save() {
    if (saving) return; readForm(); saving = true; setMsg('Wird gespeichert …');
    try {
      const j = await post('/api/team?action=save', JSON.stringify({ name: form.name, short: form.short, color: form.color, players: form.players.map((p) => ({ id: p.id, name: p.name, no: p.no === '' || p.no == null ? null : Number(p.no) })) }), { 'Content-Type': 'application/json' });
      me.team = j.team; form = { name: j.team.name, short: j.team.short, color: j.team.color, players: j.team.players.map((p) => Object.assign({}, p)) };
      dirty = false; render(); setMsg('Gespeichert ✓', 'ok'); toast('Gespeichert ✓ – ist sofort auf der Website.');
    } catch (e) { setMsg(e.message, 'err'); toast(e.message); }
    saving = false;
  }

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act],[data-color]'); if (!b || b.disabled) return;
    if (b.dataset.color) { readForm(); form.color = b.dataset.color; render(); markDirty(); return; }
    const a = b.dataset.act;
    if (a === 'save') return save();
    if (a === 'p-add') { readForm(); if (form.players.length < me.maxPlayers) form.players.push({ id: '', name: '', no: '' }); render(); markDirty(); const ins = app.querySelectorAll('[data-pn]'); if (ins.length) ins[ins.length - 1].focus(); return; }
    if (a === 'p-del') { readForm(); form.players.splice(+b.dataset.i, 1); render(); markDirty(); return; }
    if (a === 'logo-del') { if (!confirm('Logo wirklich entfernen?')) return; readForm(); try { await post('/api/team?action=logo&del=1', ''); me.team.logo = ''; render(); toast('Logo entfernt.'); } catch (x) { toast(x.message); } return; }
    if (a === 'hymn-del') { if (!confirm('Torhymne wirklich entfernen?')) return; readForm(); try { await post('/api/team?action=hymn&del=1', ''); me.hymn = null; render(); toast('Hymne entfernt.'); } catch (x) { toast(x.message); } return; }
    if (a === 'logout') { if (dirty && !confirm('Es gibt ungespeicherte Änderungen. Trotzdem abmelden?')) return; await post('/api/team?action=logout', '').catch(() => {}); location.href = '/login'; }
  });
  app.addEventListener('input', (e) => {
    if (e.target.id === 'f-color') { form.color = e.target.value; app.querySelectorAll('.te-sw').forEach((s) => s.setAttribute('aria-pressed', 'false')); markDirty(); return; }
    if (e.target.matches('input[type=text],input[type=number]')) markDirty();
  });
  app.addEventListener('change', async (e) => {
    if (e.target.id === 'f-logo') {
      const f = e.target.files[0]; if (!f) return; readForm(); toast('Logo wird hochgeladen …');
      try { const blob = await squareLogo(f); const j = await post('/api/team?action=logo', blob, { 'Content-Type': 'image/png' }); me.team.logo = j.logo; render(); if (dirty) setMsg('Noch nicht gespeichert'); toast('Logo gespeichert ✓'); } catch (x) { toast(x.message); }
      return;
    }
    if (e.target.id === 'f-hymn') {
      const f = e.target.files[0]; if (!f) return; readForm();
      if (f.size > me.maxHymn) { toast('Die Datei ist ' + kb(f.size) + ' groß – höchstens 1 MB. Bitte einen kürzeren Ausschnitt nehmen.'); e.target.value = ''; return; }
      toast('Hymne wird hochgeladen …');
      try { const j = await post('/api/team?action=hymn', f, { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name) }); me.hymn = j.hymn; render(); if (dirty) setMsg('Noch nicht gespeichert'); toast('Hymne gespeichert ✓'); } catch (x) { toast(x.message); }
    }
  });
  addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  (async () => {
    try {
      me = await api('/api/team?action=me');
      form = { name: me.team.name, short: me.team.short || '', color: me.team.color, players: me.team.players.map((p) => Object.assign({}, p)) };
      render();
    } catch (e) { if (!/anmelden/i.test(e.message)) app.innerHTML = `<div class="te"><div class="te-dl closed">${esc(e.message)}</div></div>`; }
  })();
})();
