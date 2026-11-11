/* Team-Bereich
   /team             Übersicht: so steht euer Team gerade da, was noch fehlt, Frist
   /team-bearbeiten  Bearbeiten: Teamname, Kürzel, Trikotfarbe, Logo*, Teambild, Kader*, Hymne* – Speichern nur vollständig und vor der Frist */
(function () {
  'use strict';
  const { esc } = PT;
  const EDIT = !!window.PT_TEAM_EDIT;
  const app = document.getElementById('app');
  const COLORS = [['#D62828', 'Rot'], ['#2E6BFF', 'Blau'], ['#0B2A6F', 'Dunkelblau'], ['#1E9BE0', 'Hellblau'], ['#2BA84A', 'Grün'], ['#FFD23F', 'Gelb'], ['#FF8A3D', 'Orange'], ['#8E44AD', 'Lila'], ['#E84393', 'Pink'], ['#111111', 'Schwarz'], ['#F4F4F4', 'Weiß'], ['#8A8F98', 'Grau']];
  let me = null, form = null, dirty = false, saving = false;
  const pend = { logo: null, photo: null, photoRemove: false, hymn: null }; // noch nicht gespeicherte Dateien

  async function api(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { location.replace('/login'); throw new Error('Bitte neu anmelden.'); }
    if (r.status === 410) { closedPage(j.error); throw Object.assign(new Error('geschlossen'), { closed: true }); }
    if (!r.ok) throw new Error(j.error || 'Fehler (Status ' + r.status + ')');
    return j;
  }
  const post = (url, body) => api(url, { method: 'POST', headers: { 'x-csrf': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let toastT = null;
  function toast(msg) { let el = document.getElementById('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 4000); }
  const fmtUntil = (ms) => new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  const kb = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB' : Math.round(n / 1024) + ' KB');
  const top = () => `<div class="te-top"><span class="lk"><span class="logo ls"></span><i class="sep"></i><span class="logo lm"></span></span><span class="te-sp"></span><a class="te-b sm" href="/" target="_blank" rel="noopener">Website</a><button class="te-b sm" data-act="logout">Abmelden</button></div>`;

  // Nach der Frist: Teameditor nicht mehr verfügbar
  function closedPage(msg) {
    app.innerHTML = `<div class="te"><div class="te-top"><span class="lk"><span class="logo ls"></span><i class="sep"></i><span class="logo lm"></span></span><span class="te-sp"></span></div>
      <h1 class="te-h">Team<span>editor</span></h1><div class="te-dl closed">🔒 ${esc(msg || 'Der Teameditor ist geschlossen.')}</div>
      <a class="te-b pri big" href="/">Zur Turnier-Website</a></div>`;
  }
  const dayText = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) : 'bald'; };
  // Was fehlt noch? (gleiche Regeln wie auf dem Server)
  function missingOf(t, hasLogo, hasHymn) {
    const m = [];
    if (!String(t.name || '').trim()) m.push('Teamname');
    if (!/^[A-Za-z0-9ÄÖÜäöü]{2,3}$/.test(String(t.short || '').trim())) m.push('Kürzel (2–3 Zeichen)');
    if (!hasLogo) m.push('Teamlogo');
    const n = (t.players || []).filter((p) => String(p.name || '').trim()).length;
    if (n < me.minPlayers) m.push('Kader (mind. ' + me.minPlayers + ' Spieler/innen)');
    if (!hasHymn) m.push('Torhymne');
    return m;
  }

  /* ---------- Übersicht ---------- */
  function overview() {
    const t = me.team, miss = missingOf(t, !!t.logo, !!me.hymn), open = me.open;
    app.innerHTML = `<div class="te">${top()}
      <h1 class="te-h">Euer <span>Team</span></h1>
      <div class="te-hero" style="--c:${esc(t.color)}">${PT.monoHTML(t, 'l')}<div><b>${esc(t.name)}</b><small>${esc(t.short || '–')} · ${t.group ? 'Gruppe ' + esc(t.group) : 'Gruppen und Spielplan kommen am ' + esc(dayText(me.groupsAt))}</small><span class="te-col"><i style="background:${esc(t.color)}"></i>Trikotfarbe</span></div></div>
      <div class="te-dl${open ? '' : ' closed'}">${open ? `✏️ Bearbeiten möglich bis <b>${esc(fmtUntil(me.until))}</b>.` : `🔒 Die Frist ist abgelaufen (${esc(fmtUntil(me.until))}). Änderungen gehen nur noch über die SMV.`}</div>
      <div class="te-state ${miss.length ? 'todo' : 'ok'}">${miss.length ? `<b>Noch nicht vollständig.</b> Es fehlt: ${miss.map(esc).join(', ')}.` : '<b>✓ Alles vollständig.</b> Euer Team ist startklar.'}</div>
      ${open ? `<a class="te-b pri big" href="/team-bearbeiten">Team bearbeiten</a>` : ''}
      ${t.photo ? `<section class="te-card"><h2>Teambild</h2><img class="te-photo" src="${esc(t.photo)}" alt="Teambild ${esc(t.name)}"></section>` : ''}
      <section class="te-card"><h2>Kader <small>${t.players.length} Spieler/innen</small></h2>
        ${t.players.length ? `<ul class="te-kader">${t.players.slice().sort(PT.byNo).map((p) => `<li><span>${esc(PT.noText(p))}</span>${esc(p.name)}</li>`).join('')}</ul>` : '<div class="te-hint">Noch niemand eingetragen.</div>'}</section>
      <section class="te-card"><h2>Torhymne</h2>${me.hymn ? `<div style="font-weight:700;margin-bottom:8px">🎵 ${esc(me.hymn.name)} <span class="te-hint">(${kb(me.hymn.size)})</span></div><audio controls preload="none" style="width:100%" src="/api/team?action=hymn&id=${encodeURIComponent(t.id)}&t=${me.hymn.at}"></audio>` : '<div class="te-hint">Noch keine Hymne hochgeladen.</div>'}</section>
    </div>`;
  }

  /* ---------- Bearbeiten ---------- */
  function preview(kind) { if (kind === 'logo') return pend.logo ? pend.logo.url : me.team.logo; if (kind === 'photo') return pend.photoRemove ? '' : pend.photo ? pend.photo.url : me.team.photo; return ''; }
  function editor() {
    const t = form, open = me.open, dis = open ? '' : ' disabled';
    const logo = preview('logo'), photo = preview('photo'), hymn = pend.hymn ? { name: pend.hymn.name, size: pend.hymn.size, url: pend.hymn.url } : me.hymn ? { name: me.hymn.name, size: me.hymn.size, url: '/api/team?action=hymn&id=' + encodeURIComponent(me.team.id) + '&t=' + me.hymn.at } : null;
    const team = Object.assign({}, me.team, { name: t.name, short: t.short, color: t.color, logo });
    const miss = missingOf(t, !!logo, !!hymn);
    app.innerHTML = `<div class="te">${top()}
      <a class="te-back" href="/team">← Zur Übersicht</a>
      <h1 class="te-h">Team <span>bearbeiten</span></h1>
      <div class="te-dl${open ? '' : ' closed'}">${open ? `Speichern möglich bis <b>${esc(fmtUntil(me.until))}</b>. Mit <b class="req">*</b> markierte Angaben sind Pflicht.` : `🔒 Die Frist ist abgelaufen (${esc(fmtUntil(me.until))}). Speichern ist nicht mehr möglich.`}</div>

      <section class="te-card"><h2>Team</h2>
        <div class="te-row">
          <div class="te-f"><label for="f-name">Teamname <b class="req">*</b></label><input id="f-name" type="text" maxlength="30" value="${esc(t.name)}"${dis}></div>
          <div class="te-f"><label for="f-short">Kürzel <b class="req">*</b></label><input id="f-short" type="text" maxlength="3" value="${esc(t.short)}" style="text-transform:uppercase"${dis}></div>
        </div>
        <div class="te-hint">Kürzel: 2–3 Zeichen, Buchstaben oder Zahlen (z. B. DYN oder A26) – erscheint auf der Hallenanzeige und in Tabellen.</div>
      </section>

      <section class="te-card"><h2>Trikotfarbe <b class="req">*</b> <small>voraussichtlich</small></h2>
        <div class="te-colors">${COLORS.map(([c, n]) => `<button type="button" class="te-sw" style="background:${c}" data-color="${c}" aria-label="${n}" title="${n}" aria-pressed="${t.color.toLowerCase() === c.toLowerCase()}"${dis}></button>`).join('')}
          <input type="color" id="f-color" value="${esc(t.color)}" aria-label="Eigene Farbe"${dis}></div>
      </section>

      <section class="te-card"><h2>Teamlogo <b class="req">*</b></h2>
        <div class="te-logo">${PT.monoHTML(team)}<label class="te-b sm">${logo ? 'Anderes Logo' : 'Logo auswählen'}<input type="file" accept="image/*" id="f-logo" hidden${dis}></label></div>
        <div class="te-hint" style="margin-top:8px">JPG oder PNG – wird automatisch quadratisch zugeschnitten (weißer Rand).${pend.logo ? ' <b>Neu ausgewählt – wird beim Speichern hochgeladen.</b>' : ''}</div>
      </section>

      <section class="te-card"><h2>Teambild <small>freiwillig</small></h2>
        ${photo ? `<img class="te-photo" src="${esc(photo)}" alt="Teambild">` : '<div class="te-hint" style="margin-bottom:8px">Noch kein Teambild.</div>'}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><label class="te-b sm">${photo ? 'Anderes Bild' : 'Teambild auswählen'}<input type="file" accept="image/*" id="f-photo" hidden${dis}></label>${photo ? `<button type="button" class="te-b sm del" data-act="photo-del"${dis}>Bild entfernen</button>` : ''}</div>
        <div class="te-hint" style="margin-top:8px">Erscheint auf eurer Teamseite auf der Website. Nur wenn alle Abgebildeten einverstanden sind.</div>
      </section>

      <section class="te-card"><h2>Kader <b class="req">*</b> <small>${t.players.length} von ${me.maxPlayers} · mind. ${me.minPlayers}</small></h2>
        <div class="te-hint" style="margin-bottom:10px">Nur <b>Vornamen</b> – sie erscheinen bei Toren auf Website, Hallenanzeige und Instagram. Rückennummer freiwillig.</div>
        <div class="te-pl">${t.players.map((p, i) => `<div class="te-p"><span class="n">${i + 1}</span><input type="text" data-pn="${i}" maxlength="20" placeholder="Vorname" value="${esc(p.name)}" aria-label="Vorname Spieler/in ${i + 1}"${dis}><input type="number" data-pno="${i}" min="0" max="99" inputmode="numeric" placeholder="Nr." value="${p.no == null ? '' : esc(p.no)}" aria-label="Rückennummer Spieler/in ${i + 1}"${dis}><button type="button" class="te-b sm del" data-act="p-del" data-i="${i}" aria-label="Spieler/in ${i + 1} entfernen"${dis}>✕</button></div>`).join('')}</div>
        ${t.players.length < me.maxPlayers ? `<button type="button" class="te-b" data-act="p-add" style="margin-top:10px"${dis}>+ Spieler/in</button>` : ''}
      </section>

      <section class="te-card"><h2>Torhymne <b class="req">*</b></h2>
        <div class="te-hy">${hymn ? `<div style="font-weight:700">🎵 ${esc(hymn.name)} <span class="te-hint">(${kb(hymn.size)})${pend.hymn ? ' – neu, wird beim Speichern hochgeladen' : ''}</span></div><audio controls preload="none" src="${esc(hymn.url)}"></audio>` : '<div class="te-hint">Noch keine Hymne ausgewählt.</div>'}
          <div><label class="te-b sm">${hymn ? 'Andere Hymne' : 'Hymne auswählen'}<input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" id="f-hymn" hidden${dis}></label></div>
          <div class="te-hint">Läuft in der Halle nach jedem Tor eures Teams. MP3 (oder M4A/WAV), <b>höchstens 1 MB</b> – am besten nur der Ausschnitt ab der richtigen Stelle (ca. 20–40 Sekunden). Bitte nur jugendfreie Songs.</div></div>
      </section>
      </div>
      <div class="te-bar"><span class="msg" id="msg">${!open ? 'Frist abgelaufen' : miss.length ? 'Fehlt noch: ' + esc(miss.join(', ')) : dirty ? 'Bereit zum Speichern' : 'Alles gespeichert'}</span><button class="te-b pri" data-act="save"${open && !miss.length ? '' : ' disabled'}>Speichern</button></div>`;
  }
  function refreshBar() {
    readForm();
    const hasLogo = !!preview('logo'), hasHymn = !!(pend.hymn || me.hymn), miss = missingOf(form, hasLogo, hasHymn);
    const msg = document.getElementById('msg'), btn = app.querySelector('[data-act="save"]');
    if (msg) { msg.className = 'msg'; msg.textContent = !me.open ? 'Frist abgelaufen' : miss.length ? 'Fehlt noch: ' + miss.join(', ') : dirty ? 'Bereit zum Speichern' : 'Alles gespeichert'; }
    if (btn) btn.disabled = !me.open || miss.length > 0;
  }
  function readForm() {
    if (!EDIT || !document.getElementById('f-name')) return;
    form.name = document.getElementById('f-name').value || ''; form.short = String(document.getElementById('f-short').value || '').toUpperCase();
    form.players = form.players.map((p, i) => ({ id: p.id, name: (app.querySelector(`[data-pn="${i}"]`) || {}).value || '', no: (app.querySelector(`[data-pno="${i}"]`) || {}).value }));
  }

  // Bilder vorbereiten: Logo quadratisch 240 × 240 auf Weiß, Teambild max. 1600 px als JPG
  function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Das Bild konnte nicht geöffnet werden.')); i.src = src; }); }
  const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  async function prepImage(file, square) {
    const img = await loadImage(URL.createObjectURL(file)), W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    if (square) { const s = 240, k = s / Math.max(W, H); c.width = c.height = s; g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.drawImage(img, (s - W * k) / 2, (s - H * k) / 2, W * k, H * k); }
    else { const k = Math.min(1, 1600 / Math.max(W, H)); c.width = Math.round(W * k); c.height = Math.round(H * k); g.drawImage(img, 0, 0, c.width, c.height); }
    const blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Bild konnte nicht umgewandelt werden.'))), square ? 'image/png' : 'image/jpeg', 0.85));
    return { blob, url: URL.createObjectURL(blob) };
  }

  async function save() {
    if (saving) return; readForm();
    const miss = missingOf(form, !!preview('logo'), !!(pend.hymn || me.hymn)); if (miss.length) { toast('Es fehlt noch: ' + miss.join(', ')); return; }
    saving = true; const btn = app.querySelector('[data-act="save"]'); if (btn) btn.disabled = true;
    const msg = document.getElementById('msg'); if (msg) { msg.className = 'msg'; msg.textContent = 'Wird gespeichert …'; }
    try {
      const body = { name: form.name, short: form.short, color: form.color, players: form.players.map((p) => ({ id: p.id, name: p.name, no: p.no === '' || p.no == null ? null : Number(p.no) })) };
      if (pend.logo) body.logo = { b64: await toB64(pend.logo.blob) };
      if (pend.photo) body.photo = { b64: await toB64(pend.photo.blob) }; else if (pend.photoRemove) body.photo = 'remove';
      if (pend.hymn) body.hymn = { b64: await toB64(pend.hymn.file), name: pend.hymn.name };
      await post('/api/team?action=save', body);
      dirty = false; try { sessionStorage.setItem('pt-team-saved', '1'); } catch (e) { /* egal */ }
      location.href = '/team';
    } catch (e) { if (msg) { msg.className = 'msg err'; msg.textContent = e.message; } toast(e.message); if (btn) btn.disabled = false; }
    saving = false;
  }

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act],[data-color]'); if (!b || b.disabled) return;
    if (b.dataset.color) { readForm(); form.color = b.dataset.color; dirty = true; editor(); return; }
    const a = b.dataset.act;
    if (a === 'save') return save();
    if (a === 'p-add') { readForm(); if (form.players.length < me.maxPlayers) form.players.push({ id: '', name: '', no: '' }); dirty = true; editor(); const ins = app.querySelectorAll('[data-pn]'); if (ins.length) ins[ins.length - 1].focus(); return; }
    if (a === 'p-del') { readForm(); form.players.splice(+b.dataset.i, 1); dirty = true; editor(); return; }
    if (a === 'photo-del') { readForm(); pend.photo = null; pend.photoRemove = true; dirty = true; editor(); return; }
    if (a === 'logout') { if (dirty && !confirm('Es gibt ungespeicherte Änderungen. Trotzdem abmelden?')) return; await post('/api/team?action=logout').catch(() => {}); location.href = '/login'; }
  });
  app.addEventListener('input', (e) => {
    if (!EDIT) return;
    if (e.target.id === 'f-color') { form.color = e.target.value; app.querySelectorAll('.te-sw').forEach((s) => s.setAttribute('aria-pressed', 'false')); }
    dirty = true; refreshBar();
  });
  app.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return; readForm();
    try {
      if (e.target.id === 'f-logo') { pend.logo = await prepImage(f, true); }
      else if (e.target.id === 'f-photo') { pend.photo = await prepImage(f, false); pend.photoRemove = false; }
      else if (e.target.id === 'f-hymn') {
        if (f.size > me.maxHymn) { toast('Die Datei ist ' + kb(f.size) + ' groß – höchstens 1 MB. Bitte einen kürzeren Ausschnitt nehmen.'); e.target.value = ''; return; }
        pend.hymn = { file: f, name: f.name, size: f.size, url: URL.createObjectURL(f) };
      } else return;
      dirty = true; editor();
    } catch (x) { toast(x.message); }
  });
  addEventListener('beforeunload', (e) => { if (dirty && !saving) { e.preventDefault(); e.returnValue = ''; } });

  (async () => {
    try {
      me = await api('/api/team?action=me');
      if (EDIT) { form = { name: me.team.name, short: me.team.short || '', color: me.team.color, players: me.team.players.map((p) => Object.assign({}, p)) }; editor(); }
      else { overview(); let s = null; try { s = sessionStorage.getItem('pt-team-saved'); sessionStorage.removeItem('pt-team-saved'); } catch (x) { /* egal */ } if (s) toast('Gespeichert ✓ – ist sofort auf der Website.'); }
    } catch (e) { if (!e.closed && !/anmelden/i.test(e.message)) app.innerHTML = `<div class="te"><div class="te-dl closed">${esc(e.message)}</div></div>`; }
  })();
})();
