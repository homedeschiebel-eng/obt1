/* Turnierleitung: Anmeldung, Live-Cockpit, Spielplan, Teams, Partner, Einstellungen */
(function () {
  'use strict';
  const { esc, monoHTML, STAGES, LEVELS, EV, uid } = PT;
  const app = document.getElementById('app');
  let S = null, H = null;
  const ui = { tab: 'cockpit', pick: { h: 'goal', a: 'goal' }, cmdMsg: null, save: 'idle', saveMsg: '', needsRender: false };
  try { const t = sessionStorage.getItem('pt-tab'); if (t) ui.tab = t; } catch (e) { /* egal */ }

  /* ---------- Server ---------- */
  async function api(url, opts) {
    opts = opts || {};
    const r = await fetch(url, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opts, { headers: Object.assign({ 'x-csrf': '1' }, opts.headers || {}) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Status ' + r.status), { status: r.status, data: j });
    return j;
  }

  /* ---------- Änderungen: sofort anzeigen, im Hintergrund speichern ---------- */
  // Jede Änderung ist eine Funktion (S) => {...}. Bei einem Konflikt wird der neueste Stand geladen
  // und die noch nicht gespeicherten Änderungen werden darauf erneut ausgeführt.
  const queue = []; let saving = false, retryTimer = null;
  function act(fn) {
    try { fn(S); } catch (e) { act.err = e.message; toast(e.message, true); return false; }
    queue.push(fn); H = PT.make(S); render(); flush(); return true;
  }
  async function flush() {
    if (saving || !queue.length) return;
    saving = true; ui.save = 'saving'; paintSave();
    const n = queue.length;
    try {
      const j = await api('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: S.rev, state: S }) });
      S.rev = j.rev; S.updated = j.updated; queue.splice(0, n);
      ui.save = queue.length ? 'saving' : 'idle'; ui.saveMsg = '';
    } catch (e) {
      if (e.status === 409 && e.data && e.data.state) {
        S = PT.normalize(e.data.state);
        queue.forEach((fn) => { try { fn(S); } catch (x) { /* veraltet */ } });
        H = PT.make(S); render();
      } else if (e.status === 401) { saving = false; showLogin('Du bist nicht mehr angemeldet. Bitte erneut anmelden – nichts geht verloren, solange diese Seite offen bleibt.'); return; }
      else { ui.save = 'error'; ui.saveMsg = 'Nicht gespeichert: ' + e.message + ' – neuer Versuch in 3 s'; clearTimeout(retryTimer); retryTimer = setTimeout(flush, 3000); saving = false; paintSave(); return; }
    }
    saving = false; paintSave();
    if (queue.length) flush();
  }
  function paintSave() {
    const el = document.getElementById('save'); if (!el) return;
    const txt = { idle: 'Gespeichert · live', saving: 'Wird gespeichert …', error: ui.saveMsg }[ui.save] || '';
    el.className = 'save' + (ui.save === 'error' ? ' err' : ui.save === 'saving' ? ' pending' : '');
    el.textContent = txt;
  }
  // Andere Geräte der Turnierleitung: alle 4 s nach neuem Stand schauen
  setInterval(async () => {
    if (!S || saving || queue.length || document.hidden) return;
    try { const n = await PT.fetchState(true); if (n.rev !== S.rev) { S = n; H = PT.make(S); render(); } } catch (e) { /* später erneut */ }
  }, 4000);

  let toastT = null;
  function toast(msg, bad) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.className = 'toast' + (bad ? ' no' : ''); el.textContent = msg; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800);
  }

  /* ---------- Hilfen für Änderungen ---------- */
  const find = (S, id) => S.matches.find((m) => m.id === id);
  const cur = () => H.M(S.current) || H.live() || H.nextScheduled() || H.sorted()[0] || null;
  function pinTeams(S, m) { const h = PT.make(S); if (!m.home) { const t = h.teamOf(m, 'h'); if (t) m.home = t.id; } if (!m.away) { const t = h.teamOf(m, 'a'); if (t) m.away = t.id; } }
  const elapsedNow = (S, m) => PT.make(S).elapsed(m);

  const A = {
    select: (id) => (S) => { S.current = id; },
    start: (id) => (S) => {
      const m = find(S, id); if (!m) return;
      const other = S.matches.find((x) => x.status === 'live' && x.id !== id);
      if (other) throw new Error('Spiel ' + other.no + ' läuft noch. Bitte zuerst abpfeifen.');
      if (m.status === 'scheduled') { pinTeams(S, m); m.status = 'live'; m.clock = { run: true, since: PT.now(), acc: 0 }; }
      else if (m.status === 'live' && !m.clock.run) { m.clock.run = true; m.clock.since = PT.now(); }
      if (!m.startedAt) m.startedAt = PT.now();
      S.current = id;
    },
    stop: (id) => (S) => { const m = find(S, id); if (!m || !m.clock.run) return; m.clock.acc = elapsedNow(S, m); m.clock.run = false; m.clock.since = null; },
    adjust: (id, sec) => (S) => { const m = find(S, id); if (!m) return; m.clock.acc = Math.max(0, (m.clock.acc || 0) + sec); if (elapsedNow(S, m) < 0) m.clock.acc = 0; },
    reset: (id) => (S) => { const m = find(S, id); if (!m) return; m.clock = { run: false, since: null, acc: 0 }; m.startedAt = null; },
    final: (id) => (S) => { const m = find(S, id); if (!m) return; m.clock.acc = elapsedNow(S, m); m.clock.run = false; m.clock.since = null; m.status = 'done'; m.endedAt = PT.now(); },
    reopen: (id) => (S) => {
      const m = find(S, id); if (!m) return;
      const other = S.matches.find((x) => x.status === 'live' && x.id !== id);
      if (other) throw new Error('Spiel ' + other.no + ' läuft gerade. Bitte zuerst abpfeifen.');
      m.status = 'live'; m.endedAt = null; S.current = id;
    },
    event: (id, type, teamSide, pid, min, el) => (S) => {
      const m = find(S, id); if (!m) return;
      if (m.status === 'scheduled') throw new Error('Das Spiel ist noch nicht angepfiffen.');
      const side = type === 'og' ? (teamSide === 'h' ? 'a' : 'h') : teamSide;
      m.events.push({ id: uid('e'), type, side, player: pid || null, min, at: PT.now(), el: el == null ? null : Math.round(el) });
    },
    delEvent: (id, eid) => (S) => { const m = find(S, id); if (m) m.events = m.events.filter((e) => e.id !== eid); },
    undo: (id) => (S) => {
      const m = find(S, id); if (!m || !m.events.length) throw new Error('Nichts zum Zurücknehmen.');
      let last = m.events[0]; m.events.forEach((e) => { if ((e.at || 0) >= (last.at || 0)) last = e; });
      m.events = m.events.filter((e) => e !== last);
    },
    setTeam: (id, key, tid) => (S) => { const m = find(S, id); if (m) m[key] = tid || null; },
    pen: (id, pen) => (S) => { const m = find(S, id); if (m) m.pen = pen; },
    put: (path, val) => (S) => { S[path] = val; }
  };
  function addEvent(type, teamSide, pid) {
    const m = cur(); if (!m) return;
    const t = H.teamOf(m, teamSide), x = H.P(pid);
    if (act(A.event(m.id, type, teamSide, pid, H.minuteNow(m), H.elapsed(m)))) {
      toast(`${EV[type]}${x ? ': ' + x.p.name : ''}${t ? ' (' + t.name + ')' : ''} eingetragen`);
      ui.pick[teamSide] = 'goal'; render(); anthemFor(m, type, teamSide);
    }
  }


  /* ---------- Torhymnen (pro Team + allgemeine) – spielen nur auf diesem Steuergerät ----------
     Laptop (node server.js): Dateien liegen im Ordner .data/audio. Online: im Browser dieses Geräts.
     Alle Hymnen werden vorgeladen, damit sie beim Tor sofort starten. Neues Tor = alte Hymne aus, neue an. */
  const IDB = {
    db: null,
    open() { if (this.db) return Promise.resolve(this.db); return new Promise((res, rej) => { try { const r = indexedDB.open('pt-torhymne', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); } catch (e) { rej(e); } }); },
    async get(k) { const db = await this.open(); return new Promise((res) => { const q = db.transaction('files').objectStore('files').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
    async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
    async del(k) { const db = await this.open(); return new Promise((res) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); }); }
  };
  const AUD = {
    async get(key) {
      if (ui.local) { const r = await fetch('/api/audio?key=' + encodeURIComponent(key), { cache: 'no-store', credentials: 'same-origin' }); if (!r.ok) return null; return { blob: await r.blob(), name: decodeURIComponent(r.headers.get('X-Name') || 'Torhymne') }; }
      const v = await IDB.get(key); return v ? (v.blob ? v : { blob: v, name: 'Torhymne' }) : null;
    },
    async set(key, file) {
      if (ui.local) { const r = await fetch('/api/audio?key=' + encodeURIComponent(key), { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf': '1', 'X-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, body: file }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Speichern fehlgeschlagen.'); }
      else await IDB.set(key, { blob: file, name: file.name });
      await loadPlayer(key);
    },
    async del(key) {
      if (ui.local) await fetch('/api/audio?key=' + encodeURIComponent(key) + '&action=del', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf': '1' } });
      else await IDB.del(key);
      unloadPlayer(key);
    }
  };
  const anthemCfg = () => {
    let c = { on: true, vol: 0.9, max: 0 };
    try { const s = JSON.parse(localStorage.getItem('pt-hymne') || '{}'); if (!s.v2) { s.max = 0; s.v2 = true; localStorage.setItem('pt-hymne', JSON.stringify(Object.assign({}, c, s))); } c = Object.assign(c, s); } catch (e) { /* Standard */ }
    return c;
  };
  const saveCfg = (c) => { try { localStorage.setItem('pt-hymne', JSON.stringify(Object.assign(c, { v2: true }))); } catch (e) { /* egal */ } };
  const players = {}; // key -> { audio, url, name }
  function unloadPlayer(key) { const p = players[key]; if (!p) return; if (current === p) stopAnthem(false); try { p.audio.pause(); } catch (e) { /* egal */ } URL.revokeObjectURL(p.url); delete players[key]; }
  async function loadPlayer(key) {
    let f = null; try { f = await AUD.get(key); } catch (e) { f = null; }
    unloadPlayer(key); if (!f || !f.blob) return null;
    const url = URL.createObjectURL(f.blob), audio = new Audio(); audio.preload = 'auto'; audio.src = url; try { audio.load(); } catch (e) { /* egal */ }
    audio.addEventListener('ended', () => { if (current && current.audio === audio) stopAnthem(false); });
    players[key] = { audio, url, name: f.name || 'Torhymne' };
    return players[key];
  }
  let anthemsLoaded = false;
  async function preloadAnthems() {
    if (!S) return;
    const keys = ['default'].concat(S.teams.map((t) => 'team:' + t.id));
    for (const k of keys) await loadPlayer(k);
    anthemsLoaded = true;
    if (ui.tab === 'teams' || ui.tab === 'settings') render();
  }
  let current = null, fadeT = null, stopT = null;
  function stopAnthem(fade) {
    clearTimeout(stopT); clearInterval(fadeT);
    const btn = document.getElementById('hymne-stop'); if (btn) btn.remove();
    const p = current; current = null; if (!p) return;
    const a = p.audio, vol = anthemCfg().vol;
    if (!fade) { a.pause(); a.currentTime = 0; a.volume = vol; return; }
    fadeT = setInterval(() => { a.volume = Math.max(0, a.volume - 0.08); if (a.volume <= 0.01) { clearInterval(fadeT); a.pause(); a.currentTime = 0; a.volume = vol; } }, 120);
  }
  // Startet sofort (ohne Warten), damit Browser das Abspielen beim Tippen erlauben
  function playAnthem(teamId) {
    const c = anthemCfg(); if (!c.on) return;
    const p = (teamId && players['team:' + teamId]) || players.default; if (!p) return;
    stopAnthem(false); clearInterval(fadeT);
    p.audio.volume = Math.max(0, Math.min(1, +c.vol || 0.9)); p.audio.currentTime = 0;
    current = p;
    const pr = p.audio.play();
    if (pr && pr.catch) pr.catch(() => { if (current === p) { toast('Die Torhymne konnte nicht abgespielt werden. Einmal auf die Seite tippen und erneut versuchen.', true); stopAnthem(false); } });
    const b = document.createElement('button'); b.id = 'hymne-stop'; b.type = 'button'; b.className = 'btn danger big hymne-stop'; b.textContent = '■ Torhymne stoppen' + (p.name ? ' · ' + p.name : '');
    b.addEventListener('click', () => stopAnthem(true)); document.body.appendChild(b);
    if (+c.max > 0) stopT = setTimeout(() => stopAnthem(true), +c.max * 1000);
  }
  // Tor (oder Eigentor) → Hymne der Mannschaft, die das Tor bekommt
  function anthemFor(m, type, teamSide) {
    if (type !== 'goal' && type !== 'og') return;
    const side = type === 'og' ? (teamSide === 'h' ? 'a' : 'h') : teamSide;
    const t = H.teamOf(m, side); playAnthem(t ? t.id : null);
  }
  async function anthemInfo(key) { if (players[key]) return players[key].name; return ''; }

  /* ---------- Übertragung Laptop → Website: Zustand ---------- */
  function syncText() {
    const s = ui.sync; if (!s) return '';
    if (!s.enabled) return 'Automatische Übertragung ist aus.';
    const ago = s.lastOk ? Math.round((Date.now() - s.lastOk) / 1000) : null;
    if (s.state === 'ok') return 'Online aktuell ✓ – die Website zeigt den Stand vom Laptop (geprüft vor ' + (ago < 60 ? ago + ' s' : Math.round(ago / 60) + ' Min.') + ')' + (s.onlineStorage ? ' · Speicher der Website: ' + s.onlineStorage + (s.onlineStorage === 'blob' ? ' (für Live-Betrieb ist Redis besser)' : '') : '') + '.';
    if (s.state === 'offline') return 'Keine Verbindung zur Website – es geht hier normal weiter, die Übertragung wird automatisch nachgeholt.' + (ago != null ? ' Letzte Übertragung vor ' + (ago < 60 ? ago + ' s' : Math.round(ago / 60) + ' Min.') + '.' : '');
    if (s.state === 'fehler') return 'Übertragung klappt nicht: ' + (s.lastErr || 'unbekannter Fehler');
    return 'Übertragung startet …';
  }
  const pageLoaded = Date.now();
  function updText() {
    const u = ui.sync && ui.sync.update; if (!u) return 'nicht verfügbar.';
    return 'Version ' + (u.version || '–') + '. ' + (u.last || 'Wird beim Start und alle 10 Minuten geprüft – nie während eines laufenden Spiels.');
  }
  function syncBadge() {
    if (!ui.local) return '';
    const s = ui.sync || {}, on = s.enabled;
    const st = !on ? ['Offline · Laptop', '#3DDC97', '#04121F'] : s.state === 'ok' ? ['Laptop → online ✓', '#3DDC97', '#04121F'] : s.state === 'offline' ? ['Kein Internet · läuft weiter', '#FFD23F', '#1A1405'] : s.state === 'fehler' ? ['Übertragung: Fehler', '#FF3B5C', '#fff'] : ['Verbinde …', '#5CC2FF', '#04121F'];
    return `<span class="btn sm" id="sync-badge" style="background:${st[1]};border-color:${st[1]};color:${st[2]}" title="${esc(syncText())}">${st[0]}</span>`;
  }
  async function pollSync() {
    if (!ui.local || !S) return;
    try { ui.sync = await api('/api/sync?action=status'); } catch (e) { return; }
    const b = document.getElementById('sync-badge'); if (b) b.outerHTML = syncBadge();
    const m = document.getElementById('sync-msg'); if (m && !m.classList.contains('no')) { m.className = 'cmd-msg' + (ui.sync.state === 'ok' ? ' ok' : ''); m.textContent = syncText(); }
    const um = document.getElementById('upd-msg'); if (um) um.textContent = updText();
    const u = ui.sync.update; if (u && u.installedAt > pageLoaded && !document.getElementById('upd-banner')) { const d = document.createElement('div'); d.id = 'upd-banner'; d.className = 'toast'; d.style.bottom = 'auto'; d.style.top = '12px'; d.innerHTML = 'Neue Version installiert – <button class="btn sm" onclick="location.reload()">Seite neu laden</button>'; document.body.appendChild(d); }
  }
  setInterval(pollSync, 3000);

  /* ---------- Voting-Ergebnis für die Turnierleitung ---------- */
  let votes = null, votesAt = 0, votesLoading = false;
  const voteBase = () => (ui.local && ui.sync && ui.sync.enabled && ui.sync.url ? ui.sync.url.replace(/\/+$/, '') : '');
  async function loadAdminVotes() {
    if (!S || ui.tab !== 'settings') return;
    if (votesLoading) return; votesLoading = true;
    try { const r = await fetch(voteBase() + '/api/vote?action=results&t=' + Date.now(), { cache: 'no-store' }); votes = await r.json(); } catch (e) { votes = { error: true }; }
    votesAt = Date.now(); votesLoading = false;
    const el = document.getElementById('vote-res'); if (el) el.innerHTML = voteAdminHTML();
  }
  setInterval(loadAdminVotes, 5000);
  function voteAdminHTML() {
    if (Date.now() - votesAt > 3000) setTimeout(loadAdminVotes, 50);
    if (!votes) return '<div class="hint">Lade Stimmen …</div>';
    if (votes.error) return '<div class="hint">Stimmen konnten nicht geladen werden' + (voteBase() ? ' (Website nicht erreichbar).' : '.') + '</div>';
    const c = votes.counts || {}, total = Object.values(c).reduce((a, b) => a + b, 0);
    const l = Object.entries(c).map(([id, n]) => ({ x: H.P(id), n })).filter((r) => r.x).sort((a, b) => b.n - a.n).slice(0, 10);
    return `<div class="hint" style="margin-bottom:6px">${total} Stimmen von ${votes.voters || 0} Geräten${voteBase() ? ' (von der Website)' : ''}</div>` + (l.length ? `<div class="log">${l.map((r, i) => `<div class="li" style="grid-template-columns:30px auto minmax(0,1fr) auto"><span class="mi">${i + 1}.</span>${monoHTML(r.x.t, 's')}<span><b>${esc(r.x.p.name)}</b> <small>${esc(r.x.t.name)}</small></span><b>${r.n} · ${total ? Math.round(r.n / total * 100) : 0}%</b></div>`).join('')}</div>` : '<div class="hint">Noch keine Stimmen.</div>');
  }

  /* ---------- Befehlszeile ---------- */
  // Beispiele: „tor spieler 1 team 2“, „tor 7 h“, „gelb 4 gast“, „et 3 team 5“, „start“, „stopp“, „abpfiff“, „zurück“, „nächstes“
  function runCmd(text) {
    const m = cur(); let s = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    if (!m) return { ok: false, text: 'Kein Spiel ausgewählt.' };
    const ACT = [[/^(tor|t|goal)(\s|$)/, 'goal'], [/^(eigentor|et|og)(\s|$)/, 'og'], [/^(gelbe karte|gelb|gk|y)(\s|$)/, 'yellow'], [/^(2 ?min(uten)?|zeitstrafe|strafe|zeit|rote karte|rot|rk|r)(\s|$)/, 'red'],
      [/^(anpfiff|start|los|weiter|play)(\s|$)/, 'start'], [/^(stopp|stop|pause|halt)(\s|$)/, 'stop'], [/^(abpfiff|ende|schluss|aus)(\s|$)/, 'final'],
      [/^(zurück|zurueck|rückgängig|undo|z)(\s|$)/, 'undo'], [/^(nächstes|naechstes|next)(\s|spiel|$)/, 'next']];
    let type = null, rest = s;
    for (const [re, k] of ACT) { const x = s.match(re); if (x) { type = k; rest = s.slice(x[0].length).trim(); break; } }
    if (!type) return { ok: false, text: 'Befehl nicht erkannt. Beispiele: „tor spieler 1 team 2“, „gelb 4 h“, „start“, „stopp“.' };
    try {
      const run = (fn, msg) => (act(fn) ? { ok: true, text: msg } : { ok: false, text: act.err });
      if (type === 'start') return run(A.start(m.id), 'Uhr läuft.');
      if (type === 'stop') return run(A.stop(m.id), 'Uhr angehalten.');
      if (type === 'final') return run(A.final(m.id), 'Abgepfiffen.');
      if (type === 'undo') return run(A.undo(m.id), 'Letzter Eintrag entfernt.');
      if (type === 'next') { const n = H.nextScheduled(m); if (!n) return { ok: false, text: 'Kein weiteres Spiel geplant.' }; return run(A.select(n.id), 'Spiel ' + n.no + ' geladen.'); }
    } catch (e) { return { ok: false, text: e.message }; }
    // Minute: „min 5“ oder „5'“
    let min = null; rest = rest.replace(/(^|\s)(?:min\.?\s*(\d{1,2})|(\d{1,2})\s*['′])(?=\s|$)/, (a, p, x, y) => { min = +(x || y); return ' '; }).trim();
    // Team: Teamname, „h/heim/links“ oder „g/gast/rechts“
    const teams = { h: H.teamOf(m, 'h'), a: H.teamOf(m, 'a') };
    let side = null;
    const names = ['h', 'a'].filter((k) => teams[k]).map((k) => [k, teams[k].name.toLowerCase()]).sort((x, y) => y[1].length - x[1].length);
    for (const [k, n] of names) { const re = new RegExp('(^|\\s)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)'); if (re.test(rest)) { side = k; rest = rest.replace(re, ' ').trim(); break; } }
    if (!side) { const x = rest.match(/(^|\s)(h|heim|links|g|gast|rechts)$/); if (x) { side = /^(h|heim|links)$/.test(x[2]) ? 'h' : 'a'; rest = rest.slice(0, rest.length - x[0].length).trim(); } }
    rest = rest.replace(/^(nr\.?|nummer|#)\s*/, '').trim();
    const pool = (sd) => (teams[sd] ? teams[sd].players.map((p) => ({ p, sd })) : []);
    let cands = side ? pool(side) : [...pool('h'), ...pool('a')], hit = null;
    if (rest) {
      if (/^\d+$/.test(rest)) cands = cands.filter((c) => String(c.p.no) === rest);
      else {
        const ex = cands.filter((c) => c.p.name.toLowerCase() === rest);
        cands = ex.length ? ex : cands.filter((c) => c.p.name.toLowerCase().startsWith(rest)).length ? cands.filter((c) => c.p.name.toLowerCase().startsWith(rest)) : cands.filter((c) => c.p.name.toLowerCase().includes(rest));
      }
      if (!cands.length) return { ok: false, text: `Niemand gefunden für „${rest}“${side ? ' bei ' + teams[side].name : ''}.` };
      if (cands.length > 1) return { ok: false, text: `Mehrdeutig: ${cands.slice(0, 4).map((c) => c.p.name + ' (' + teams[c.sd].name + ')').join(', ')}. Bitte Team dazuschreiben, z. B. „… team 2“ oder „… h“.` };
      hit = cands[0]; side = hit.sd;
    }
    if (!side) return { ok: false, text: 'Für welches Team? Zum Beispiel „tor h“, „tor gast“ oder den Teamnamen dazuschreiben.' };
    try {
      if (!act(A.event(m.id, type, side, hit ? hit.p.id : null, min || H.minuteNow(m), H.elapsed(m)))) return { ok: false, text: act.err };
      anthemFor(m, type, side);
      return { ok: true, text: `${EV[type]}${hit ? ': ' + hit.p.name : ''} (${teams[side] ? teams[side].name : side}) eingetragen.` };
    } catch (e) { return { ok: false, text: e.message }; }
  }

  /* ---------- Ansichten ---------- */
  const clockHTML = (m, big) => `<span class="clk${big ? ' big' : ''}" data-clock="${m.id}">${H.clockText(m)}</span>`;
  const stateHTML = (m) => `<span class="cstate" data-cstate="${m.id}">${H.clockState(m)}</span>`;
  const teamOptions = (sel, ph) => `<option value="">${ph ? 'Platzhalter: ' + esc(ph) : '– Team wählen –'}</option>` + S.teams.slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}${t.group ? ' (Gr. ' + esc(t.group) + ')' : ''}</option>`).join('');
  const matchLabel = (x) => `${H.isTest(x) ? 'TEST ' + H.dayText(x) : x.no + '.'} · ${H.expTime(x)}${H.delay(x) > 0 ? ' (+' + H.delay(x) + ')' : ''} · ${x.label || STAGES[x.stage].l} – ${H.tName(x, 'h')} vs ${H.tName(x, 'a')}${x.status === 'live' ? ' · LIVE' : x.status === 'done' ? ' · ✓ ' + H.sc(x).h + ':' + H.sc(x).a : ''}`;

  function vCockpit() {
    const list = H.sorted(), m = cur();
    if (!m) return `<div class="empty">Noch keine Spiele. Im Reiter „Spielplan“ kannst du den Spielplan erstellen.</div>`;
    const r = H.sc(m), c = m.clock, canEv = m.status !== 'scheduled';
    const h = H.teamOf(m, 'h'), a = H.teamOf(m, 'a');
    let ctrl;
    if (m.status === 'scheduled') ctrl = `<button class="btn cyan big" data-act="start"${h && a ? '' : ' disabled title="Erst beide Teams wählen"'}>▶ Anpfiff</button>`;
    else if (m.status === 'live') ctrl = (c.run ? `<button class="btn primary big" data-act="stop">❚❚ Uhr anhalten</button>` : `<button class="btn cyan big" data-act="start">▶ Uhr weiter</button>`)
      + `<button class="btn big" data-act="adj" data-s="-10" title="Uhr 10 s zurück (mehr Restzeit)">−10 s</button><button class="btn big" data-act="adj" data-s="10" title="Uhr 10 s vor (weniger Restzeit)">+10 s</button>`
      + (c.run ? '' : `<button class="btn big" data-act="reset" data-confirm="Uhr wirklich auf ${H.durOf(m)}:00?">Uhr zurücksetzen</button>`)
      + `<button class="btn danger big" data-act="final" data-confirm="Wirklich abpfeifen?">Abpfiff</button>`;
    else { const n = H.nextScheduled(m); ctrl = (n ? `<button class="btn cyan big" data-act="select" data-id="${n.id}">Nächstes Spiel laden: ${esc(H.tName(n, 'h'))} – ${esc(H.tName(n, 'a'))}</button>` : '') + `<button class="btn big" data-act="reopen">Spiel wieder öffnen</button>`; }

    const col = (side) => {
      const t = H.teamOf(m, side), pick = ui.pick[side];
      if (!t) return `<div class="box ck-col" style="--c:#2A3560"><div class="head"><b>${esc(H.phOf(m, side))}</b></div><div class="hint">Wähle oben bei „Paarung“ ein Team. Dann erscheinen hier automatisch die Spielerinnen und Spieler.</div></div>`;
      const evs = (pid) => m.events.filter((e) => e.player === pid).map((e) => `<i class="ic ${e.type}"></i>`).join('');
      return `<div class="box ck-col" style="--c:${esc(t.color)}"><div class="head">${monoHTML(t, 's')}<b>${esc(t.name)}</b><span class="sc">${r[side]}</span></div>
        <div class="seg">${[['goal', 'Tor'], ['og', 'Eigentor'], ['yellow', 'Gelb'], ['red', '2 Min.']].map(([k, l]) => `<button data-act="pick" data-side="${side}" data-t="${k}" aria-pressed="${pick === k}"><i class="ic ${k}"></i>${l}</button>`).join('')}</div>
        <div class="pgrid">${t.players.slice().sort((x, y) => (x.no || 99) - (y.no || 99)).map((p) => `<button class="pbtn" data-act="ev" data-side="${side}" data-player="${p.id}"${canEv ? '' : ' disabled'}><span class="no">${esc(p.no == null ? '·' : p.no)}</span><span>${esc(p.name)}</span><span class="cnt">${evs(p.id)}</span></button>`).join('')}
        <button class="pbtn anon" data-act="ev" data-side="${side}" data-player=""${canEv ? '' : ' disabled'}>${esc(EV[pick])} ohne Namen</button></div>
        ${t.players.length ? '' : '<div class="hint" style="margin-top:8px">Für dieses Team sind noch keine Spieler eingetragen (Reiter „Teams“).</div>'}</div>`;
    };
    const ev = m.events.slice().sort((x, y) => (y.min || 0) - (x.min || 0) || (y.at || 0) - (x.at || 0));
    return `
    <div class="ck-pick"><div class="field"><label for="ck-match">Aktuelles Spiel (wird auf der Website und der Hallenanzeige gezeigt)</label><select id="ck-match">${H.tests().length ? `<optgroup label="Testspiele (zählen nicht)">${H.tests().map((x) => `<option value="${x.id}"${x === m ? ' selected' : ''}>${esc(matchLabel(x))}</option>`).join('')}</optgroup><optgroup label="Turnier">` : ''}${list.map((x) => `<option value="${x.id}"${x === m ? ' selected' : ''}>${esc(matchLabel(x))}</option>`).join('')}${H.tests().length ? '</optgroup>' : ''}</select></div>
      <div class="row"><button class="btn" data-act="prev">◀</button><button class="btn" data-act="next">▶</button><button class="btn" data-act="edit-match" data-id="${m.id}">Details</button></div></div>
    <div class="box"><h3>Paarung <small>${esc(m.label || STAGES[m.stage].l)} · Spielzeit ${H.durOf(m)} Minuten · geplant ${esc(m.time)} Uhr${m.status === 'scheduled' ? ` · voraussichtlich <b data-exp="${m.id}">${H.expTime(m)}</b> ${H.delayHTML(m)}` : ''}</small></h3><div class="frow">
      <div class="field"><label for="ck-home">Team 1</label><select id="ck-home">${teamOptions(m.home, !m.home && m.homePh ? (h ? m.homePh + ' → ' + h.name : m.homePh) : '')}</select></div>
      <div class="field"><label for="ck-away">Team 2</label><select id="ck-away">${teamOptions(m.away, !m.away && m.awayPh ? (a ? m.awayPh + ' → ' + a.name : m.awayPh) : '')}</select></div>
    </div></div>
    <div class="ck-board">
      <div class="stage-top"><span>${H.isTest(m) ? "Testspiel · " + esc(H.dayText(m)) : "Spiel " + esc(m.no) + " · " + esc(m.label || STAGES[m.stage].l)}</span>${m.status === 'live' ? '<span class="livechip">Live</span>' : `<b>${m.status === 'done' ? 'Beendet' : 'Noch nicht angepfiffen'}</b>`}</div>
      <div class="sb"><div class="tb">${monoHTML(h, 'l')}<b>${esc(h ? h.name : H.phOf(m, 'h'))}</b></div><div class="score"><span>${r.h}</span><i>:</i><span>${r.a}</span></div><div class="tb">${monoHTML(a, 'l')}<b>${esc(a ? a.name : H.phOf(m, 'a'))}</b></div></div>
      <div class="sb-clock">${clockHTML(m, true)}${stateHTML(m)}</div><div class="bar"><i data-bar="${m.id}" style="width:${H.pct(m)}%"></i></div>
      <div class="pens" data-pens="${m.id}">${H.penText(m)}</div>
      <div class="ck-ctrl">${ctrl}</div>
    </div>
    <div class="box"><h3>Befehl eingeben <small>Enter trägt ein</small></h3>
      <form class="cmd" id="cmd-form"><input id="cmd" autocomplete="off" spellcheck="false" placeholder="z. B. tor spieler 1 team 2 · gelb 4 h · start · stopp"><button class="btn primary">Eintragen</button></form>
      <div class="cmd-msg ${ui.cmdMsg ? (ui.cmdMsg.ok ? 'ok' : 'no') : ''}" id="cmd-msg">${ui.cmdMsg ? esc(ui.cmdMsg.text) : ''}</div>
      <div class="keys"><kbd>tor 7 h</kbd> Tor Nr. 7 Team 1 · <kbd>tor spieler 2 team 4</kbd> nach Name und Team · <kbd>et 3 gast</kbd> Eigentor · <kbd>gelb 4 h</kbd> Gelbe Karte · <kbd>2min 5 g</kbd> 2-Minuten-Strafe · <kbd>min 5</kbd> eigene Minute · <kbd>start</kbd> <kbd>stopp</kbd> <kbd>abpfiff</kbd> <kbd>zurück</kbd> <kbd>nächstes</kbd><br>Tasten außerhalb des Eingabefelds: <kbd>Leertaste</kbd> Uhr an/aus · <kbd>Z</kbd> letzten Eintrag zurücknehmen · <kbd>/</kbd> Befehlszeile</div></div>
    <div class="ck-teams">${col('h')}${col('a')}</div>
    ${m.stage !== 'group' ? `<div class="box"><h3>Neunmeterschießen <small>nur bei Unentschieden</small></h3><div class="frow"><div class="field"><label for="pen-h">${esc(h ? h.name : 'Team 1')}</label><input id="pen-h" type="number" min="0" inputmode="numeric" value="${m.pen ? m.pen.h : ''}"></div><div class="field"><label for="pen-a">${esc(a ? a.name : 'Team 2')}</label><input id="pen-a" type="number" min="0" inputmode="numeric" value="${m.pen ? m.pen.a : ''}"></div><div style="align-self:end"><button class="btn primary" data-act="pen">Speichern</button></div></div></div>` : ''}
    <div class="box"><h3>Spielverlauf ${m.events.length ? '<button class="btn sm" data-act="undo">Letzten Eintrag zurücknehmen</button>' : ''}</h3>${ev.length ? `<div class="log">${ev.map((e) => { const x = H.P(e.player); const ts = e.type === 'og' ? (e.side === 'h' ? 'a' : 'h') : e.side; const tt = x ? x.t : H.teamOf(m, ts); return `<div class="li"><span class="mi">${esc(e.min || '')}′</span><i class="ic ${e.type}"></i><span><b>${esc(EV[e.type])}</b>${x ? ' · ' + esc(x.p.name) : ''} <small>${esc(tt ? tt.name : '')}</small></span><button class="btn danger sm" data-act="del-ev" data-ev="${e.id}" data-confirm="Löschen?">Entfernen</button></div>`; }).join('')}</div>` : '<div class="hint">Noch keine Einträge.</div>'}</div>`;
  }

  function vPlan() {
    const s = S.settings, list = H.sorted();
    return `<div class="box"><h3>Spielplan erstellen <small>Ein Feld, alle Spiele nacheinander</small></h3>
      <form id="gen-form" class="frow" style="align-items:end">
        <div class="field"><label for="g-start">Erstes Spiel um</label><input id="g-start" name="start" type="time" value="${esc(s.start)}"></div>
        <div class="field"><label for="g-gap">Wechselzeit zwischen Spielen (Min.)</label><input id="g-gap" name="gap" type="number" min="0" max="30" value="${esc(s.gap)}"></div>
        <div class="field"><label for="g-dg">Gruppenspiel (Min.)</label><input id="g-dg" name="durGroup" type="number" min="1" max="60" value="${esc(s.durGroup)}"></div>
        <div class="field"><label for="g-dk">Viertelfinale & Platz 3 (Min.)</label><input id="g-dk" name="durKo" type="number" min="1" max="60" value="${esc(s.durKo)}"></div>
        <div class="field"><label for="g-df">Halbfinale & Finale (Min.)</label><input id="g-df" name="durFinal" type="number" min="1" max="60" value="${esc(s.durFinal)}"></div>
        <div class="field"><label for="g-ko">Finalrunde</label><select id="g-ko" name="koFormat"><option value="qf"${s.koFormat !== 'sf' ? ' selected' : ''}>Viertelfinale (Top 4 je Gruppe)</option><option value="sf"${s.koFormat === 'sf' ? ' selected' : ''}>Halbfinale (Top 2 je Gruppe)</option></select></div>
        <div class="row" style="grid-column:1/-1;gap:14px"><label class="check"><input type="checkbox" name="third" ${s.third ? 'checked' : ''}> Spiel um Platz 3</label><span style="flex:1"></span><button type="button" class="btn primary" data-act="save-times">Zeiten übernehmen</button><button type="button" class="btn danger" data-act="gen" data-confirm="Alle Spiele und Ergebnisse werden ersetzt. Sicher?">Spielplan neu erstellen</button></div>
      </form>
      <div class="hint" style="margin-top:10px">„Zeiten übernehmen“ speichert Spielzeiten und Wechselzeit und rechnet die geplanten Uhrzeiten neu, ohne Ergebnisse zu ändern. Bei Verspätung (auch wenn die Uhr angehalten ist) verschieben sich die voraussichtlichen Zeiten automatisch – auf der Website und der Hallenanzeige. „Spielplan neu erstellen“ baut alle Gruppenspiele (jeder gegen jeden) und die Finalrunde neu auf.</div></div>
    <div class="box"><h3>Testspiele <small>für Vorführungen – eigenes Datum, zählen nicht für Tabelle, Statistik und K.-o.-Baum</small> <button class="btn sm primary" data-act="new-test">+ Testspiel</button>${H.tests().length ? '<button class="btn sm danger" data-act="del-tests" data-confirm="Alle Testspiele löschen?">Alle Testspiele löschen</button>' : ''}</h3>
      ${H.tests().length ? `<div class="alist">${H.tests().map((m) => `<div class="ar${m.status === 'live' ? ' live' : ''}"><span class="no">T</span><span class="tm">${esc(m.time)}<br><small style="color:var(--muted);font-size:11px">${esc(H.dayText(m))}</small></span><span class="rd">${esc(m.label || 'Testspiel')}<br><small style="color:var(--muted)">${H.durOf(m)} Min.</small></span><span class="pair">${esc(H.tName(m, 'h'))} – ${esc(H.tName(m, 'a'))} ${m.status === 'done' ? `<small>· ${H.sc(m).h}:${H.sc(m).a}</small>` : m.status === 'live' ? '<small>· läuft</small>' : ''}</span><span class="row"><button class="btn sm" data-act="edit-test" data-id="${m.id}">Bearbeiten</button><button class="btn sm cyan" data-act="select" data-id="${m.id}" data-go="1">Ins Cockpit</button></span></div>`).join('')}</div>` : '<div class="hint">Noch keine Testspiele. Lege für deine Präsentation ein oder mehrere an – zum Beispiel mit dem Datum und der Uhrzeit der Vorführung.</div>'}</div>
    <div class="box"><h3>Alle Spiele <small>${list.length} Spiele · Ende ca. ${list.length ? esc(PT.minToTime((PT.timeToMin(list[list.length - 1].time) || 0) + H.durOf(list[list.length - 1]))) : '–'} Uhr</small> <button class="btn sm primary" data-act="new-match">+ Spiel</button></h3>
      <div class="alist">${list.map((m, i) => `<div class="ar${m.status === 'live' ? ' live' : ''}"><span class="no">${esc(m.no)}</span><span class="tm"><span data-exp="${m.id}">${H.expTime(m)}</span> ${H.delayHTML(m)}<br><small style="color:var(--muted);font-size:11px">geplant ${esc(m.time)}</small></span><span class="rd">${esc(m.label || STAGES[m.stage].l)}<br><small style="color:var(--muted)">${H.durOf(m)} Min.</small></span><span class="pair">${esc(H.tName(m, 'h'))} – ${esc(H.tName(m, 'a'))} ${m.status === 'done' ? `<small>· ${H.sc(m).h}:${H.sc(m).a}</small>` : m.status === 'live' ? '<small>· läuft</small>' : ''}</span>
        <span class="row"><button class="btn sm" data-act="up" data-id="${m.id}"${i ? '' : ' disabled'} aria-label="Nach oben">▲</button><button class="btn sm" data-act="down" data-id="${m.id}"${i < list.length - 1 ? '' : ' disabled'} aria-label="Nach unten">▼</button><button class="btn sm" data-act="edit-match" data-id="${m.id}">Bearbeiten</button><button class="btn sm cyan" data-act="select" data-id="${m.id}" data-go="1">Ins Cockpit</button></span></div>`).join('')}</div></div>`;
  }
  function vTeams() {
    return `<div class="box"><h3>Teams <small>${S.teams.length} Teams</small> <button class="btn sm primary" data-act="new-team">+ Team</button></h3>
    <div class="tlist">${S.teams.slice().sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<div class="ti" style="--c:${esc(t.color)}"><div class="t">${monoHTML(t, 'l')}<div><b>${esc(t.name)}</b><br><small>${esc([t.cls, t.group ? 'Gruppe ' + t.group : 'ohne Gruppe', t.players.length + ' Spieler/innen'].filter(Boolean).join(' · '))}</small></div></div><small>${esc(t.players.slice(0, 8).map((p) => (p.no ? p.no + ' ' : '') + p.name).join(' · '))}${t.players.length > 8 ? ' …' : ''}</small><small>${players['team:' + t.id] ? '♪ Torhymne: ' + esc(players['team:' + t.id].name) : (anthemsLoaded ? '♪ keine eigene Torhymne' : '')}</small><div class="row"><button class="btn sm primary" data-act="edit-team" data-id="${t.id}">Team & Kader bearbeiten</button></div></div>`).join('')}</div></div>
    <div class="hint">Ändert sich die Gruppeneinteilung, im Reiter „Spielplan“ den Spielplan neu erstellen.</div>`;
  }
  function vPartner() {
    return `<div class="box"><h3>Partner & Sponsoren <button class="btn sm primary" data-act="new-sponsor">+ Partner</button></h3>
    ${S.sponsors.length ? `<div class="tlist">${S.sponsors.map((s) => `<div class="ti" style="--c:var(--cyan)"><div style="background:var(--paper);color:var(--paper-ink);padding:8px 12px;min-height:60px;display:flex;align-items:center">${s.logo ? `<img src="${esc(s.logo)}" alt="" style="max-height:48px">` : `<span class="wm">${esc(s.name)}</span>`}</div><b style="font-size:19px">${esc(s.name)}</b><small>${esc(s.level)}${s.slogan ? ' · ' + esc(s.slogan) : ''}</small><div class="row"><button class="btn sm primary" data-act="edit-sponsor" data-id="${s.id}">Bearbeiten</button></div></div>`).join('')}</div>` : '<div class="hint">Noch keine Partner eingetragen. Sie erscheinen im weißen Partnerbereich der Website.</div>'}</div>`;
  }
  function vSettings() {
    const s = S.settings;
    return `<form class="box" id="set-form"><h3>Turnierdaten</h3><div style="display:grid;gap:12px">
      <div class="frow">${F('title', 'Turniername', s.title)}${F('season', 'Jahr', s.season)}${F('school', 'Schule', s.school)}</div>
      <div class="frow">${F('day', 'Turniertag', s.day, 'date')}${F('location', 'Ort', s.location)}${F('sport', 'Sportart', s.sport)}</div>
      <div class="frow">${F('win', 'Punkte für Sieg', s.win, 'number', 'min="0" max="5"')}${F('draw', 'Punkte für Unentschieden', s.draw, 'number', 'min="0" max="5"')}</div>
      ${F('ticker', 'Durchsage im Laufband (leer = keine)', s.ticker)}
      <h3 style="margin-top:8px">Impressum <small>erscheint unter „Impressum &amp; Datenschutz“ unten auf der Website</small></h3>
      <div class="frow">${F('impName', 'Verantwortlich (Name / SMV)', s.impName || '')}${F('impMail', 'E-Mail', s.impMail || '')}${F('impPhone', 'Telefon (optional)', s.impPhone || '')}</div>
      <div class="field"><label for="f-impAddr">Anschrift</label><textarea id="f-impAddr" name="impAddr" style="min-height:80px" placeholder="Parler-Gymnasium&#10;Straße Nr.&#10;PLZ Ort">${esc(s.impAddr || '')}</textarea></div>
      <div class="field"><label for="f-impExtra">Zusätzlicher Hinweis (optional)</label><textarea id="f-impExtra" name="impExtra" style="min-height:70px">${esc(s.impExtra || '')}</textarea></div>
      <div class="row"><button class="btn primary">Speichern</button></div></div></form>
    ${ui.local ? `<div class="box" id="sync-box"><h3>Automatisch online stellen <small>Laptop → Website</small></h3>
      <div class="hint" style="margin-bottom:12px">Ist das eingeschaltet, überträgt der Laptop jede Änderung nach ein paar Sekunden auf die Website (mit Logos). Ohne Internet läuft hier alles normal weiter – sobald die Verbindung zurück ist, wird automatisch nachgeholt. <b style="color:#fff">Trage dann nur noch hier auf dem Laptop ein.</b></div>
      <div class="frow" style="align-items:end">
        <div class="field"><label for="sync-url">Adresse der Website</label><input id="sync-url" type="url" value="${esc((ui.sync && ui.sync.url) || 'https://obt1-chi.vercel.app')}"></div>
        <div class="field"><label for="sync-pass">Passwort der Online-Turnierleitung</label><input id="sync-pass" type="password" autocomplete="off" placeholder="${ui.sync && ui.sync.hasPass ? 'gespeichert – nur zum Ändern eingeben' : ''}"></div>
      </div>
      <div class="row" style="margin-top:12px"><label class="check"><input id="sync-on" type="checkbox" ${ui.sync && ui.sync.enabled ? 'checked' : ''}> Automatisch übertragen</label><span style="flex:1"></span><button type="button" class="btn primary" data-act="sync-save">Speichern</button><button type="button" class="btn" data-act="sync-push">Jetzt übertragen</button></div>
      <div class="cmd-msg" id="sync-msg">${esc(syncText())}</div>
      <div class="hint" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px"><b style="color:#fff">Automatische Updates:</b> <span id="upd-msg">${esc(updText())}</span> <button type="button" class="btn sm" data-act="upd-check">Jetzt nach Updates suchen</button></div>
      <div class="hint" style="margin-top:10px">Einmalig, falls online schon Daten eingetragen sind: <button type="button" class="btn sm" data-act="sync-pull" data-confirm="Stand auf dem Laptop durch den der Website ersetzen?">Stand von der Website holen</button></div></div>` : `<div class="box"><h3>Offline-Betrieb auf dem Laptop</h3><div class="hint">Falls in der Halle das Internet ausfällt: Projekt auf GitHub herunterladen (Code → Download ZIP), auf dem Laptop Node.js installieren und im Ordner <kbd>node server.js</kbd> starten. Die Anleitung steht in OFFLINE-START.txt.</div></div>`}
    <div class="box" id="hymne-box"><h3>Torhymne <small>läuft nach jedem Tor nur auf diesem Gerät</small></h3>
      <div class="frow" style="align-items:end">
        <div class="field"><label for="hy-file">Allgemeine Torhymne – für Teams ohne eigene (MP3, M4A, WAV …)</label><input id="hy-file" type="file" accept="audio/*"><div class="hint" id="hy-name">…</div></div>
        <div class="field"><label for="hy-vol">Lautstärke</label><input id="hy-vol" type="range" min="0" max="1" step="0.05" value="${anthemCfg().vol}"></div>
        <div class="field"><label for="hy-max">Automatisch ausblenden nach (Sekunden) – 0 = ganz abspielen</label><input id="hy-max" type="number" min="0" max="300" value="${anthemCfg().max}"></div>
      </div>
      <div class="row" style="margin-top:12px"><label class="check"><input id="hy-on" type="checkbox" ${anthemCfg().on ? 'checked' : ''}> Nach jedem Tor abspielen</label><span style="flex:1"></span><button type="button" class="btn" data-act="hy-test">▶ Probe</button><button type="button" class="btn" data-act="hy-stop">■ Stopp</button><button type="button" class="btn danger" data-act="hy-del">Entfernen</button></div>
      <div class="hint" style="margin-top:8px">${ui.local ? 'Die Dateien liegen auf diesem Laptop (Ordner .data) und werden nicht ins Internet hochgeladen.' : 'Die Dateien bleiben in diesem Browser gespeichert und werden nicht ins Internet hochgeladen.'} Die Hymne jedes Teams legst du im Reiter „Teams“ → Team bearbeiten fest. Neues Tor = laufende Hymne bricht ab, die neue startet sofort.</div></div>
    <div class="box" id="vote-box"><h3>Voting „Spieler des Turniers“ <small>Zuschauer stimmen am Handy ab – eine Stimme pro Gerät</small></h3>
      <div class="hint" style="margin-bottom:10px">Status: <b style="color:#fff">${{ off: 'aus', open: 'offen – Zuschauer können abstimmen', closed: 'geschlossen – Ergebnis noch verborgen', show: 'Ergebnis wird auf der Website gezeigt' }[s.vote || 'off']}</b></div>
      <div class="row"><button type="button" class="btn primary" data-act="vote" data-v="open"${s.vote === 'open' ? ' disabled' : ''}>Voting öffnen</button><button type="button" class="btn" data-act="vote" data-v="closed"${s.vote !== 'open' ? ' disabled' : ''}>Voting schließen</button><button type="button" class="btn cyan" data-act="vote" data-v="show"${s.vote === 'show' ? ' disabled' : ''}>Ergebnis zeigen</button><button type="button" class="btn" data-act="vote" data-v="off"${!s.vote || s.vote === 'off' ? ' disabled' : ''}>Ausblenden</button><span style="flex:1"></span><button type="button" class="btn danger" data-act="vote-reset" data-confirm="Alle Stimmen verwerfen und neu starten?">Neu starten</button></div>
      <div id="vote-res" style="margin-top:14px">${voteAdminHTML()}</div></div>
    <div class="box"><h3>QR-Code-Aushang</h3><div class="hint" style="margin-bottom:10px">A4-Plakat mit QR-Code zur Website für Zuschauer und Teams – zum Ausdrucken oder als PDF speichern.</div><a class="btn primary" href="/aushang" target="_blank" rel="noopener">Aushang öffnen</a></div>
    <div class="box"><h3>Sicherung</h3><div class="row"><button class="btn" data-act="backup">Sicherung herunterladen</button><label class="btn" for="restore">Sicherung einspielen</label><input id="restore" type="file" accept="application/json,.json" hidden></div><div class="hint" style="margin-top:8px">Die Sicherung ist eine JSON-Datei mit allen Teams, Spielen und Ergebnissen.</div></div>
    <form class="box" id="pw-form"><h3>Passwort ändern</h3>${ui.pwSource === 'env' ? '<div class="hint">Das Passwort ist im Vercel-Projekt als ADMIN_PASSWORD festgelegt und kann nur dort geändert werden.</div>' : `<div class="frow" style="align-items:end"><div class="field"><label for="pw-new">Neues Passwort (mind. 6 Zeichen)</label><input id="pw-new" type="password" autocomplete="new-password"></div><div><button class="btn primary">Passwort ändern</button></div></div>`}</form>
    <div class="box"><h3>Ergebnisse zurücksetzen</h3><div class="hint" style="margin-bottom:10px">Löscht alle Tore, Karten und Spielzeiten. Teams und Spielplan bleiben. Praktisch nach einem Testlauf.</div><button class="btn danger" data-act="reset-all" data-confirm="Wirklich alle Ergebnisse löschen?">Alle Ergebnisse löschen</button></div>`;
  }

  /* ---------- Rahmen ---------- */
  const TABS = [['cockpit', 'Live-Cockpit'], ['plan', 'Spielplan'], ['teams', 'Teams'], ['partner', 'Partner'], ['settings', 'Einstellungen']];
  function render() {
    if (!S) return;
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest('#app') && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.id !== 'cmd' && !ae.closest('.ck-pick') && ae.type !== 'file') { ui.needsRender = true; return; }
    ui.needsRender = false;
    const focusCmd = ae && ae.id === 'cmd', cmdVal = focusCmd ? ae.value : '';
    const v = { cockpit: vCockpit, plan: vPlan, teams: vTeams, partner: vPartner, settings: vSettings }[ui.tab] || vCockpit;
    app.innerHTML = `<header class="tl-head"><div class="wrap">
      <a class="brand" href="/" target="_blank" rel="noopener"><span class="logo logo-school" role="img" aria-label="Logo"></span><span class="bt"><small>Turnierleitung</small><b>${esc(S.settings.title).replace(/-?(Turnier)$/i, ' <span>$1</span>')}</b></span></a>
      <nav class="tl-nav">${TABS.map(([k, l]) => `<button data-act="tab" data-t="${k}" aria-pressed="${ui.tab === k}">${l}</button>`).join('')}</nav>
      <div class="tl-side">${syncBadge()}<span id="save" class="save"></span><a class="btn sm" href="/" target="_blank" rel="noopener">Website</a><a class="btn sm" href="/anzeige" target="_blank" rel="noopener">Hallenanzeige</a><button class="btn sm" data-act="logout">Abmelden</button></div>
    </div></header>${!ui.local && S.controlledBy === 'laptop' && Date.now() - (S.controlledAt || 0) < 5 * 60e3 ? '<div class="demo" style="background:#3A2A05;color:#FFE7A3;border-bottom:1px solid #6B5210"><div class="wrap"><b>Der Laptop steuert gerade das Turnier</b> und überträgt automatisch hierher. Änderungen auf dieser Seite werden beim nächsten Abgleich überschrieben – bitte auf dem Laptop eintragen.</div></div>' : ''}<main class="tl-body"><div class="wrap">${v()}</div></main>`;
    paintSave();
    const hyName = document.getElementById('hy-name'); if (hyName) hyName.textContent = players.default ? 'Gespeichert: ' + players.default.name : 'Noch keine allgemeine Torhymne gespeichert.';
    // Falls ein Werbeblocker trotzdem Teile ausblendet: Hinweis zeigen
    const body = app.querySelector('.tl-body'); if (body && !body.offsetHeight) toast('Eine Browser-Erweiterung (z. B. Werbeblocker) blendet Teile aus. Bitte für diese Seite ausschalten.', true);
    if (focusCmd) { const el = document.getElementById('cmd'); if (el) { el.value = cmdVal; el.focus(); } }
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (ui.needsRender) render(); }, 0));
  setInterval(() => {
    if (!H) return;
    document.querySelectorAll('[data-clock]').forEach((el) => { const m = H.M(el.dataset.clock); if (m) el.textContent = H.clockText(m); });
    document.querySelectorAll('[data-bar]').forEach((el) => { const m = H.M(el.dataset.bar); if (m) el.style.width = H.pct(m) + '%'; });
    document.querySelectorAll('[data-cstate]').forEach((el) => { const m = H.M(el.dataset.cstate); if (m) el.textContent = H.clockState(m); });
    H.tickTimes();
    document.querySelectorAll('[data-pens]').forEach((el) => { const m = H.M(el.dataset.pens); if (m) { const h = H.penText(m); if (el.innerHTML !== h) el.innerHTML = h; } });
  }, 250);

  /* ---------- Dialoge ---------- */
  let modalEl = null;
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  function openModal(title, inner, onSubmit, opts) {
    closeModal(); opts = opts || {};
    modalEl = document.createElement('div'); modalEl.className = 'modal-bg';
    modalEl.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h3>${esc(title)}</h3><button class="btn" data-mact="close" type="button">Schließen</button></div>
      <form novalidate>${inner}<div class="err-msg" data-err></div><div class="foot">${opts.del ? `<button type="button" class="btn danger" data-mact="del">${esc(opts.delLabel || 'Löschen')}</button>` : ''}<div class="right"><button type="button" class="btn" data-mact="close">Abbrechen</button><button class="btn primary" type="submit">${esc(opts.submit || 'Speichern')}</button></div></div></form></div>`;
    document.body.appendChild(modalEl);
    const form = modalEl.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.dataset.busy) { modalEl.querySelector('[data-err]').textContent = 'Bild wird noch hochgeladen …'; return; }
      const err = onSubmit(new FormData(form), form);
      if (typeof err === 'string') { modalEl.querySelector('[data-err]').textContent = err; return; }
      closeModal();
    });
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
      const b = e.target.closest('[data-mact]'); if (!b) return;
      if (b.dataset.mact === 'close') closeModal();
      if (b.dataset.mact === 'del') { if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Wirklich löschen?'; return; } opts.del(); closeModal(); }
    });
    const first = form.querySelector('input,select,textarea'); if (first) first.focus();
    if (opts.after) opts.after(form);
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  const F = (name, label, val, type, extra) => `<div class="field"><label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${name}" type="${type || 'text'}" value="${esc(val == null ? '' : val)}" ${extra || ''}></div>`;
  const rosterPreview = (id) => { const t = H.T(id); if (!t) return 'Wähle ein Team, dann siehst du hier die Spielerliste.'; return t.players.length ? '<b>Kader:</b> ' + t.players.slice().sort((a, b) => (a.no || 99) - (b.no || 99)).map((p) => esc((p.no ? p.no + ' ' : '') + p.name)).join(' · ') : 'Für dieses Team sind noch keine Spieler eingetragen.'; };

  function matchForm(m) {
    const isNew = !m, last = H.sorted().pop();
    m = m || { time: last ? PT.minToTime((PT.timeToMin(last.time) || 540) + H.durOf(last) + (+S.settings.gap || 0)) : S.settings.start, stage: 'group', label: '', home: null, away: null, homePh: '', awayPh: '', dur: null };
    const opt = (sel) => '<option value="">– noch offen –</option>' + S.teams.slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}${t.group ? ' (Gr. ' + esc(t.group) + ')' : ''}</option>`).join('');
    openModal(isNew ? 'Spiel anlegen' : 'Spiel ' + m.no + ' bearbeiten', `
      <div class="frow">${F('time', 'Uhrzeit', m.time, 'time')}<div class="field"><label for="f-stage">Runde</label><select id="f-stage" name="stage">${Object.entries(STAGES).map(([k, v]) => `<option value="${k}"${m.stage === k ? ' selected' : ''}>${v.l} (${S.settings[v.d]} Min.)</option>`).join('')}</select></div>${F('label', 'Bezeichnung', m.label, 'text', 'placeholder="z. B. Gruppe A, Halbfinale 1"')}</div>
      <div class="field"><label for="f-home">Team 1</label><select id="f-home" name="home">${opt(m.home)}</select><div class="rprev" data-prev="home">${rosterPreview(m.home)}</div></div>
      ${F('homePh', 'Platzhalter für Team 1, solange es offen ist', m.homePh, 'text', 'placeholder="z. B. 1. Gruppe A oder Sieger VF 1"')}
      <div class="field"><label for="f-away">Team 2</label><select id="f-away" name="away">${opt(m.away)}</select><div class="rprev" data-prev="away">${rosterPreview(m.away)}</div></div>
      ${F('awayPh', 'Platzhalter für Team 2, solange es offen ist', m.awayPh, 'text', 'placeholder="z. B. 4. Gruppe B oder Verlierer HF 2"')}
      ${F('dur', 'Eigene Spielzeit in Minuten (leer = Standard der Runde)', m.dur || '', 'number', 'min="1" max="60"')}
      <div class="hint">Platzhalter wie „1. Gruppe A“, „Sieger VF 2“ oder „Verlierer HF 1“ werden automatisch durch das richtige Team ersetzt, sobald das Ergebnis feststeht.</div>`,
    (fd) => {
      const o = { time: fd.get('time'), stage: fd.get('stage'), label: fd.get('label').trim(), home: fd.get('home') || null, away: fd.get('away') || null, homePh: fd.get('homePh').trim(), awayPh: fd.get('awayPh').trim(), dur: parseInt(fd.get('dur'), 10) || null };
      if (!o.time) return 'Bitte eine Uhrzeit angeben.';
      if (o.home && o.home === o.away) return 'Ein Team kann nicht gegen sich selbst spielen.';
      if (!o.label) o.label = STAGES[o.stage].l;
      if (isNew) { const id = uid('m'); act((S) => { const no = Math.max(0, ...S.matches.map((x) => x.no || 0)) + 1; S.matches.push(Object.assign({ id, no, status: 'scheduled', clock: { run: false, since: null, acc: 0 }, events: [], pen: null }, o)); }); }
      else { const id = m.id; act((S) => { Object.assign(find(S, id), o); }); }
    }, { ...(isNew ? {} : { del: () => { const id = m.id; act((S) => { S.matches = S.matches.filter((x) => x.id !== id); renumber(S); if (S.current === id) S.current = null; }); }, delLabel: 'Spiel löschen' }), after: (form) => {
      ['home', 'away'].forEach((k) => form.querySelector('#f-' + k).addEventListener('change', (e) => { form.querySelector(`[data-prev="${k}"]`).innerHTML = rosterPreview(e.target.value); }));
    } });
  }
  function testForm(m) {
    const isNew = !m, today = new Date(), iso = today.getFullYear() + '-' + PT.pad(today.getMonth() + 1) + '-' + PT.pad(today.getDate());
    m = m || { day: iso, time: PT.pad(today.getHours()) + ':' + PT.pad(Math.ceil(today.getMinutes() / 5) * 5 % 60), label: 'Testspiel', home: null, away: null, dur: +S.settings.durGroup || 7 };
    const opt = (sel) => '<option value="">– Team wählen –</option>' + S.teams.slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    openModal(isNew ? 'Testspiel anlegen' : 'Testspiel bearbeiten', `
      <div class="frow">${F('day', 'Datum', m.day, 'date')}${F('time', 'Uhrzeit', m.time, 'time')}${F('dur', 'Spielzeit (Min.)', m.dur || S.settings.durGroup, 'number', 'min="1" max="60"')}</div>
      ${F('label', 'Bezeichnung', m.label || 'Testspiel', 'text', 'placeholder="z. B. Vorführung für das Kollegium"')}
      <div class="frow"><div class="field"><label for="f-home">Team 1</label><select id="f-home" name="home">${opt(m.home)}</select><div class="rprev" data-prev="home">${rosterPreview(m.home)}</div></div><div class="field"><label for="f-away">Team 2</label><select id="f-away" name="away">${opt(m.away)}</select><div class="rprev" data-prev="away">${rosterPreview(m.away)}</div></div></div>
      <div class="hint">Testspiele laufen wie echte Spiele (Uhr, Tore, Hallenanzeige, Website), zählen aber nicht für Tabelle, Statistik und K.-o.-Baum. Der Spielplan vom Turniertag bleibt unverändert.</div>`,
    (fd) => {
      const o = { stage: 'test', day: fd.get('day'), time: fd.get('time'), dur: parseInt(fd.get('dur'), 10) || null, label: fd.get('label').trim() || 'Testspiel', home: fd.get('home') || null, away: fd.get('away') || null, homePh: '', awayPh: '' };
      if (!o.day || !o.time) return 'Bitte Datum und Uhrzeit angeben.';
      if (!o.home || !o.away) return 'Bitte beide Teams wählen.';
      if (o.home === o.away) return 'Ein Team kann nicht gegen sich selbst spielen.';
      if (isNew) { const id = uid('x'); act((S) => { S.matches.push(Object.assign({ id, no: 0, status: 'scheduled', clock: { run: false, since: null, acc: 0 }, events: [], pen: null }, o)); S.current = id; }); toast('Testspiel angelegt und ins Cockpit geladen.'); }
      else { const id = m.id; act((S) => { Object.assign(find(S, id), o); }); }
    }, { ...(isNew ? {} : { del: () => { const id = m.id; act((S) => { S.matches = S.matches.filter((x) => x.id !== id); if (S.current === id) S.current = null; }); }, delLabel: 'Testspiel löschen' }), after: (form) => {
      ['home', 'away'].forEach((k) => form.querySelector('#f-' + k).addEventListener('change', (e) => { form.querySelector(`[data-prev="${k}"]`).innerHTML = rosterPreview(e.target.value); }));
    } });
  }
  function renumber(S) { S.matches.filter((m) => m.stage !== 'test').sort((a, b) => (a.no || 0) - (b.no || 0)).forEach((m, i) => { m.no = i + 1; }); }

  /* Bilder verkleinern und hochladen */
  /* Bilder laden, Logos automatisch zuschneiden und zentrieren, verkleinern, hochladen */
  function loadImage(src) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Dieses Bild konnte nicht gelesen werden. Bitte PNG oder JPG wählen.')); img.src = src; });
  }
  function readFile(file) {
    return new Promise((resolve, reject) => { const rd = new FileReader(); rd.onload = () => resolve(rd.result); rd.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.')); rd.readAsDataURL(file); });
  }
  // Leere oder weiße Ränder finden (Bereich, in dem wirklich etwas zu sehen ist)
  function contentBox(img) {
    const W = img.naturalWidth || img.width, Hh = img.naturalHeight || img.height;
    const k = Math.min(1, 600 / Math.max(W, Hh)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(Hh * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = d[i + 3];
      if (a > 24 && !(d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return { x: 0, y: 0, w: W, h: Hh };
    return { x: x0 / k, y: y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
  }
  // mode 'circle': quadratisch, Logo mittig mit Abstand, damit es ganz in den runden Rahmen passt
  // mode 'trim': nur Ränder abschneiden (für Partnerlogos)
  function prepare(img, maxW, maxH, type, mode) {
    let sx = 0, sy = 0, sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    if (mode) { const b = contentBox(img); sx = b.x; sy = b.y; sw = b.w; sh = b.h; }
    let cw, ch, dx, dy, dw, dh;
    if (mode === 'circle') {
      // Quadrat in der Größe der längeren Seite (4:5 → 5:5, 3:4 → 4:4), Logo voll und mittig, Rest weiß
      const side = Math.max(1, Math.min(maxW, Math.round(Math.max(sw, sh))));
      const k = side / Math.max(sw, sh);
      cw = ch = side; dw = sw * k; dh = sh * k; dx = (side - dw) / 2; dy = (side - dh) / 2;
    } else {
      const k = Math.min(1, maxW / sw, maxH / sh); cw = Math.max(1, Math.round(sw * k)); ch = Math.max(1, Math.round(sh * k)); dx = 0; dy = 0; dw = cw; dh = ch;
    }
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cw)); c.height = Math.max(1, Math.round(ch));
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    if (mode === 'circle') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden.'))), type, 0.85));
  }
  async function upload(file, maxW, maxH, type, mode) {
    const img = await loadImage(await readFile(file));
    const b = await prepare(img, maxW, maxH, type, mode);
    const j = await api('/api/img', { method: 'POST', headers: { 'Content-Type': type }, body: b }); return j.url;
  }
  // Bereits hochgeladene Teamlogos einmal pro Sitzung automatisch zentrieren
  let logosChecked = false;
  async function fixTeamLogos() {
    if (logosChecked || !S) return; logosChecked = true;
    let n = 0;
    for (const t of S.teams.slice()) {
      if (!t.logo) continue;
      try {
        const r = await fetch(t.logo, { cache: 'force-cache' }); if (!r.ok) continue;
        const img = await loadImage(URL.createObjectURL(await r.blob()));
        const b = contentBox(img), W = img.naturalWidth, Hh = img.naturalHeight;
        const cx = (b.x + b.w / 2) / W, cy = (b.y + b.h / 2) / Hh, fill = Math.max(b.w, b.h) / Math.max(W, Hh);
        if (Math.abs(W - Hh) <= 2 && Math.abs(cx - 0.5) < 0.02 && Math.abs(cy - 0.5) < 0.02 && fill > 0.97) continue; // schon quadratisch, mittig und voll
        const blob = await prepare(img, 240, 240, 'image/png', 'circle');
        const j = await api('/api/img', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob });
        if (j.url && j.url !== t.logo) { const id = t.id, url = j.url; act((S) => { const x = S.teams.find((y) => y.id === id); if (x) x.logo = url; }); n++; }
      } catch (e) { /* Logo bleibt, wie es ist */ }
    }
    if (n) toast(n === 1 ? '1 Teamlogo wurde automatisch zentriert.' : n + ' Teamlogos wurden automatisch zentriert.');
  }
  const imgField = (id, label, has, none) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="file" accept="image/*"><div class="hint" data-hint="${id}">${has ? `Ein Bild ist hinterlegt. <button type="button" class="btn sm" data-rm="${id}">Entfernen</button>` : none}</div></div>`;
  function wireImg(form, id, maxW, maxH, type, set, mode) {
    const hint = form.querySelector(`[data-hint="${id}"]`);
    form.addEventListener('click', (e) => { if (e.target.closest(`[data-rm="${id}"]`)) { set(''); hint.textContent = 'Wird beim Speichern entfernt.'; } });
    form.querySelector('#' + id).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      hint.textContent = 'Bild wird hochgeladen …'; form.dataset.busy = '1';
      try { const url = await upload(f, maxW, maxH, type, mode); set(url); hint.innerHTML = 'Neues Bild bereit: <img src="' + esc(url) + '" alt="" style="max-height:40px;vertical-align:middle">'; }
      catch (x) { hint.textContent = x.message; }
      delete form.dataset.busy;
    });
  }
  const COLORS = ['#2E6BFF', '#E5383B', '#F4B400', '#2BA84A', '#8E44EC', '#F2711C', '#00A8B5', '#E84393', '#6C7A89', '#3DDC97', '#C0392B', '#1ABC9C'];
  function teamForm(t) {
    const isNew = !t, newId = uid('t');
    t = t || { name: 'Team ' + (S.teams.length + 1), cls: '', group: H.groups()[0] || 'A', color: COLORS[S.teams.length % COLORS.length], players: [], logo: '', photo: '' };
    let logo = t.logo, photo = t.photo;
    const roster = t.players.slice().sort((a, b) => (a.no || 99) - (b.no || 99)).map((p) => (p.no != null ? p.no + ' ' : '') + p.name).join('\n');
    openModal(isNew ? 'Team anlegen' : 'Team bearbeiten', `
      <div class="frow">${F('name', 'Teamname', t.name, 'text', 'required')}${F('short', 'Kürzel (max. 4 Zeichen, z. B. SG)', t.short || '', 'text', 'maxlength="4" placeholder="' + esc(PT.initials(t.name)) + '" style="text-transform:uppercase"')}</div>
      <div class="frow">${F('cls', 'Klasse / Kurs (optional)', t.cls, 'text', 'placeholder="z. B. J1, J2"')}${F('group', 'Gruppe', t.group, 'text', 'placeholder="A oder B"')}${F('color', 'Teamfarbe', t.color, 'color')}</div>
      <div class="field"><label for="f-players">Spielerliste</label><textarea id="f-players" name="players" placeholder="1 Spieler 1&#10;7 Jonas M.&#10;10 Lea K.">${esc(roster)}</textarea><div class="hint">Eine Person pro Zeile, Rückennummer optional vorne. Du kannst eine Liste aus Excel oder WhatsApp einfügen. Tore bleiben erhalten, solange der Name gleich bleibt.</div></div>
      <div class="frow">${imgField('f-logo', 'Teamlogo (optional, wird automatisch quadratisch und mittig)', !!t.logo, 'Ohne Logo zeigen wir das Kürzel.')}${imgField('f-photo', 'Teamfoto (optional)', !!t.photo, 'Erscheint auf der Teamkarte.')}</div>
      <div class="field"><label for="f-anthem">Torhymne des Teams (MP3) – läuft bei jedem Tor dieses Teams</label><input id="f-anthem" type="file" accept="audio/*,.mp3"><div class="hint" data-anthem-hint>…</div></div>`,
    (fd) => {
      const name = fd.get('name').trim(); if (!name) return 'Bitte einen Teamnamen eingeben.';
      const old = t.players || [];
      const players = fd.get('players').split('\n').map((l) => l.replace(/\t/g, ' ').trim()).filter(Boolean).map((l) => { const mm = l.match(/^(\d{1,3})\s*[.)\-–:]?\s+(.+)$/); const no = mm ? +mm[1] : null, nm = (mm ? mm[2] : l).trim(); const ex = old.find((p) => p.name.toLowerCase() === nm.toLowerCase()); return { id: ex ? ex.id : uid('p'), no, name: nm }; });
      const o = { name, short: String(fd.get('short') || '').trim().toUpperCase().slice(0, 4), cls: fd.get('cls').trim(), group: fd.get('group').trim().toUpperCase(), color: fd.get('color') || '#2E6BFF', players, logo, photo };
      if (isNew) { const id = newId; act((S) => { S.teams.push(Object.assign({ id }, o)); }); }
      else { const id = t.id; act((S) => { Object.assign(S.teams.find((x) => x.id === id), o); }); }
    }, { ...(isNew ? {} : { del: () => { const id = t.id, nm = t.name; act((S) => { S.teams = S.teams.filter((x) => x.id !== id); S.matches.forEach((m) => { if (m.home === id) { m.home = null; m.homePh = m.homePh || nm; } if (m.away === id) { m.away = null; m.awayPh = m.awayPh || nm; } }); }); }, delLabel: 'Team löschen' }), after: (form) => {
      const af = form.querySelector('#f-anthem'), ah = form.querySelector('[data-anthem-hint]');
      const key = 'team:' + (isNew ? newId : t.id);
      const show = () => { const p = players[key]; ah.innerHTML = p ? '♪ <b>' + esc(p.name) + '</b> <button type="button" class="btn sm" data-anthem-test>▶ Probe</button> <button type="button" class="btn sm" data-anthem-stop>■ Stopp</button> <button type="button" class="btn sm" data-anthem-rm>Entfernen</button>' : 'Noch keine Hymne. Ohne eigene läuft die allgemeine Torhymne (Einstellungen).'; };
      show();
      af.addEventListener('change', async () => { const f = af.files[0]; if (!f) return; ah.textContent = 'Wird gespeichert …'; try { await AUD.set(key, f); toast('Torhymne gespeichert: ' + f.name); } catch (e) { toast(e.message, true); } af.value = ''; show(); });
      form.addEventListener('click', async (e) => {
        if (e.target.closest('[data-anthem-test]')) { const p = players[key]; if (p) { stopAnthem(false); current = p; p.audio.currentTime = 0; p.audio.volume = anthemCfg().vol; p.audio.play().catch(() => toast('Abspielen nicht möglich.', true)); } }
        if (e.target.closest('[data-anthem-stop]')) stopAnthem(false);
        if (e.target.closest('[data-anthem-rm]')) { await AUD.del(key); show(); }
      });
      wireImg(form, 'f-logo', 240, 240, 'image/png', (u) => { logo = u; }, 'circle'); wireImg(form, 'f-photo', 900, 560, 'image/jpeg', (u) => { photo = u; }); } });
  }
  function sponsorForm(s) {
    const isNew = !s; s = s || { name: '', level: 'Partner', slogan: '', url: '', logo: '' }; let logo = s.logo;
    openModal(isNew ? 'Partner anlegen' : 'Partner bearbeiten', `
      ${F('name', 'Name', s.name, 'text', 'required')}
      <div class="frow"><div class="field"><label for="f-level">Stufe</label><select id="f-level" name="level">${LEVELS.map((l) => `<option${l === s.level ? ' selected' : ''}>${l}</option>`).join('')}</select></div>${F('url', 'Website (optional)', s.url, 'text', 'placeholder="www.beispiel.de"')}</div>
      ${F('slogan', 'Kurzer Text (optional)', s.slogan, 'text', 'placeholder="z. B. Stiftet die Pokale"')}
      ${imgField('f-slogo', 'Logo (optional, am besten PNG mit transparentem Hintergrund)', !!s.logo, 'Ohne Logo zeigen wir den Namen als Schriftzug.')}`,
    (fd) => {
      const name = fd.get('name').trim(); if (!name) return 'Bitte einen Namen eingeben.';
      const o = { name, level: fd.get('level'), slogan: fd.get('slogan').trim(), url: fd.get('url').trim(), logo };
      if (isNew) { const id = uid('s'); act((S) => { S.sponsors.push(Object.assign({ id }, o)); }); }
      else { const id = s.id; act((S) => { Object.assign(S.sponsors.find((x) => x.id === id), o); }); }
    }, { ...(isNew ? {} : { del: () => { const id = s.id; act((S) => { S.sponsors = S.sponsors.filter((x) => x.id !== id); }); }, delLabel: 'Partner löschen' }), after: (form) => wireImg(form, 'f-slogo', 600, 240, 'image/png', (u) => { logo = u; }, 'trim') });
  }

  /* ---------- Klicks & Eingaben ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !app.contains(b) || b.disabled) return;
    if (b.dataset.confirm !== undefined && !b.classList.contains('armed')) {
      b.classList.add('armed'); const o = b.innerHTML; b.textContent = b.dataset.confirm || 'Sicher?';
      setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.innerHTML = o; } }, 3500); return;
    }
    if (!S) return;
    const a = b.dataset.act, m = cur();
    if (a === 'tab') { ui.tab = b.dataset.t; try { sessionStorage.setItem('pt-tab', ui.tab); } catch (x) { /* egal */ } render(); scrollTo(0, 0); return; }
    if (a === 'logout') { api('/api/auth?action=logout', { method: 'POST' }).finally(() => showLogin()); return; }
    if (a === 'pick') { ui.pick[b.dataset.side] = b.dataset.t; render(); return; }
    if (a === 'ev') { addEvent(ui.pick[b.dataset.side], b.dataset.side, b.dataset.player); return; }
    if (a === 'select') { act(A.select(b.dataset.id)); if (b.dataset.go) { ui.tab = 'cockpit'; render(); scrollTo(0, 0); } return; }
    if (a === 'prev' || a === 'next') { const l = H.sorted(), i = l.indexOf(m), n = l[i + (a === 'next' ? 1 : -1)]; if (n) act(A.select(n.id)); return; }
    if (a === 'edit-match') { const mm = H.M(b.dataset.id); if (H.isTest(mm)) testForm(mm); else matchForm(mm); return; }
    if (a === 'new-test') { testForm(null); return; }
    if (a === 'edit-test') { testForm(H.M(b.dataset.id)); return; }
    if (a === 'del-tests') { act((S) => { const ids = S.matches.filter((x) => x.stage === 'test').map((x) => x.id); S.matches = S.matches.filter((x) => x.stage !== 'test'); if (ids.includes(S.current)) S.current = null; }); toast('Alle Testspiele gelöscht.'); return; }
    if (a === 'new-match') { matchForm(null); return; }
    if (a === 'new-team') { teamForm(null); return; }
    if (a === 'edit-team') { teamForm(H.T(b.dataset.id)); return; }
    if (a === 'new-sponsor') { sponsorForm(null); return; }
    if (a === 'edit-sponsor') { sponsorForm(S.sponsors.find((x) => x.id === b.dataset.id)); return; }
    if (a === 'up' || a === 'down') { const id = b.dataset.id, d = a === 'up' ? -1 : 1; act((S) => { const l = S.matches.slice().sort((x, y) => (x.no || 0) - (y.no || 0)); const i = l.findIndex((x) => x.id === id), j = i + d; if (j < 0 || j >= l.length) return; const t = l[i].no; l[i].no = l[j].no; l[j].no = t; const ti = l[i].time; l[i].time = l[j].time; l[j].time = ti; }); return; }
    if (a === 'save-times' || a === 'gen') {
      const f = document.getElementById('gen-form'), fd = new FormData(f);
      const vals = { start: fd.get('start') || '09:00', gap: +fd.get('gap') || 0, durGroup: +fd.get('durGroup') || 7, durKo: +fd.get('durKo') || 10, durFinal: +fd.get('durFinal') || 12, koFormat: fd.get('koFormat'), third: !!fd.get('third') };
      if (a === 'gen') { act((S) => { Object.assign(S.settings, vals); S.matches = PT.genSchedule(S).concat(S.matches.filter((m) => m.stage === 'test')); S.current = null; }); toast('Spielplan neu erstellt: ' + S.matches.length + ' Spiele.'); }
      else { act((S) => { Object.assign(S.settings, vals); PT.retime(S); }); toast('Zeiten übernommen.'); }
      return;
    }
    if (a === 'backup') {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'turnier-sicherung-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json'; document.body.appendChild(l); l.click(); l.remove();
      return;
    }
    if (a === 'hy-test') { playAnthem(null); return; }
    if (a === 'hy-stop') { stopAnthem(true); return; }
    if (a === 'hy-del') { AUD.del('default').then(() => render()); return; }
    if (a === 'vote') { const v = b.dataset.v; act((S) => { S.settings.vote = v; if (!S.settings.voteRound) S.settings.voteRound = 'r1'; }); toast({ open: 'Voting ist offen.', closed: 'Voting geschlossen.', show: 'Ergebnis wird auf der Website gezeigt.', off: 'Voting ausgeblendet.' }[v]); return; }
    if (a === 'vote-reset') { act((S) => { S.settings.voteRound = 'r' + Date.now().toString(36); S.settings.vote = 'off'; }); votes = null; toast('Voting neu gestartet – alle bisherigen Stimmen zählen nicht mehr.'); return; }
    if (a === 'upd-check') { const um = document.getElementById('upd-msg'); um.textContent = 'Suche nach Updates …'; api('/api/sync?action=update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(() => pollSync()).catch((x) => { um.textContent = x.message; }); return; }
    if (a === 'sync-save' || a === 'sync-push' || a === 'sync-pull') {
      const msg = document.getElementById('sync-msg'), url = document.getElementById('sync-url').value, pass = document.getElementById('sync-pass').value, enabled = document.getElementById('sync-on').checked;
      const action = a === 'sync-save' ? 'config' : a === 'sync-push' ? 'push' : 'pull';
      msg.className = 'cmd-msg'; msg.textContent = { config: 'Speichere …', push: 'Übertrage auf die Website …', pull: 'Hole den Stand von der Website …' }[action];
      api('/api/sync?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, pass, enabled }) })
        .then(async (j) => {
          document.getElementById('sync-pass').value = '';
          if (action === 'pull') { S = await PT.fetchState(true); H = PT.make(S); logosChecked = false; toast(`Übernommen: ${j.teams} Teams, ${j.matches} Spiele, ${j.images} Bilder.`); }
          else toast(action === 'push' ? 'Auf die Website übertragen.' : (enabled ? 'Automatische Übertragung ist an.' : 'Automatische Übertragung ist aus.'));
          await pollSync(); render();
        })
        .catch((x) => { msg.className = 'cmd-msg no'; msg.textContent = x.message; });
      return;
    }
    if (a === 'reset-all') { act((S) => { S.matches.forEach((x) => { x.events = []; x.status = 'scheduled'; x.clock = { run: false, since: null, acc: 0 }; x.pen = null; x.startedAt = null; x.endedAt = null; }); S.current = null; }); toast('Alle Ergebnisse gelöscht.'); return; }
    if (!m) return;
    try {
      if (a === 'start') act(A.start(m.id));
      else if (a === 'stop') act(A.stop(m.id));
      else if (a === 'adj') act(A.adjust(m.id, +b.dataset.s));
      else if (a === 'reset') act(A.reset(m.id));
      else if (a === 'final') act(A.final(m.id));
      else if (a === 'reopen') act(A.reopen(m.id));
      else if (a === 'undo') act(A.undo(m.id));
      else if (a === 'del-ev') act(A.delEvent(m.id, b.dataset.ev));
      else if (a === 'pen') { const h = parseInt(document.getElementById('pen-h').value, 10), w = parseInt(document.getElementById('pen-a').value, 10); act(A.pen(m.id, isNaN(h) || isNaN(w) ? null : { h, a: w })); toast(isNaN(h) || isNaN(w) ? 'Neunmeter-Ergebnis entfernt.' : 'Neunmeter-Ergebnis gespeichert.'); }
    } catch (x) { toast(x.message, true); }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'cmd-form') {
      e.preventDefault(); const inp = document.getElementById('cmd'); const res = runCmd(inp.value);
      if (res) { ui.cmdMsg = res; if (res.ok) inp.value = ''; const el = document.getElementById('cmd-msg'); if (el) { el.className = 'cmd-msg ' + (res.ok ? 'ok' : 'no'); el.textContent = res.text; } }
    }
    if (e.target.id === 'pw-form') {
      e.preventDefault(); const inp = document.getElementById('pw-new'); if (!inp) return;
      api('/api/auth?action=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: inp.value }) })
        .then(() => { inp.value = ''; inp.blur(); toast('Passwort geändert. Andere Geräte müssen sich neu anmelden.'); })
        .catch((x) => toast(x.message, true));
      return;
    }
    if (e.target.id === 'set-form') {
      e.preventDefault(); const fd = new FormData(e.target), vals = {};
      ['title', 'season', 'school', 'day', 'location', 'sport', 'ticker', 'impName', 'impMail', 'impPhone', 'impAddr', 'impExtra'].forEach((k) => { vals[k] = String(fd.get(k) || '').trim(); });
      vals.date = vals.day ? new Date(vals.day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
      ['win', 'draw'].forEach((k) => { const v = parseInt(fd.get(k), 10); if (!isNaN(v)) vals[k] = v; });
      document.activeElement && document.activeElement.blur();
      act((S) => { Object.assign(S.settings, vals); }); toast('Turnierdaten gespeichert.');
    }
  });
  document.addEventListener('change', (e) => {
    if (!S) return;
    const id = e.target.id, m = cur();
    if (id === 'ck-match') { act(A.select(e.target.value)); e.target.blur(); return; }
    if ((id === 'ck-home' || id === 'ck-away') && m) {
      const k = id === 'ck-home' ? 'home' : 'away', o = k === 'home' ? 'away' : 'home', v = e.target.value || null;
      e.target.blur();
      if (v && v === m[o]) { toast('Ein Team kann nicht gegen sich selbst spielen.', true); render(); return; }
      act(A.setTeam(m.id, k, v)); return;
    }
    if (id === 'hy-file') { const f = e.target.files[0]; if (!f) return; AUD.set('default', f).then(() => { toast('Torhymne gespeichert: ' + f.name); render(); }).catch((x) => toast('Konnte nicht gespeichert werden: ' + x.message, true)); return; }
    if (id === 'hy-on' || id === 'hy-max' || id === 'hy-vol') { const c = anthemCfg(); c.on = document.getElementById('hy-on').checked; c.max = Math.max(0, parseInt(document.getElementById('hy-max').value, 10) || 0); c.vol = +document.getElementById('hy-vol').value; saveCfg(c); if (current && id === 'hy-vol') current.audio.volume = c.vol; return; }
    if (id === 'restore') {
      const f = e.target.files[0]; if (!f) return;
      f.text().then((txt) => { const d = JSON.parse(txt); if (!d || !Array.isArray(d.teams) || !Array.isArray(d.matches)) throw new Error('Das ist keine Turnier-Sicherung.'); act((S) => { S.settings = d.settings || S.settings; S.teams = d.teams; S.matches = d.matches; S.sponsors = d.sponsors || []; S.current = d.current || null; PT.normalize(S); }); toast('Sicherung eingespielt.'); })
        .catch((x) => toast(x.message || 'Datei konnte nicht gelesen werden.', true));
    }
  });
  addEventListener('keydown', (e) => {
    if (!S || ui.tab !== 'cockpit' || modalEl) return;
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const m = cur(); if (!m) return;
    try {
      if (e.code === 'Space') { e.preventDefault(); if (m.status === 'live' && m.clock.run) act(A.stop(m.id)); else if (m.status !== 'done') act(A.start(m.id)); }
      else if (e.key === 'z' || e.key === 'Z') { act(A.undo(m.id)); }
      else if (e.key === '/') { e.preventDefault(); const c = document.getElementById('cmd'); if (c) c.focus(); }
    } catch (x) { toast(x.message, true); }
  });

  /* ---------- Anmeldung ---------- */
  /* ---------- Anmeldung, Einrichtung, Diagnose ---------- */
  const shell = (inner) => `<div class="login"><div class="lg-card"><span class="logo logo-school" style="width:70px"></span><div><div class="eyebrow">Parler-Gymnasium · SMV</div><h1>Turnierleitung</h1></div>${inner}</div></div>`;
  function bindForm(id, fn) {
    const f = document.getElementById(id); if (!f) return;
    const first = f.querySelector('input'); if (first) first.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const err = f.querySelector('.err-msg'); err.textContent = ''; const btn = f.querySelector('button.primary'); btn.disabled = true;
      try { await fn(f); } catch (x) { err.textContent = x.message; } btn.disabled = false;
    });
  }
  function showLogin(msg) {
    S = null;
    app.innerHTML = shell(`<form id="login-form" class="lg-form">${msg ? `<div class="notice">${esc(msg)}</div>` : ''}
      <div class="field"><label for="pass">Passwort</label><input id="pass" type="password" autocomplete="current-password" required></div>
      <div class="err-msg"></div><button class="btn primary big">Anmelden</button>
      <a class="btn cyan big" href="/anzeige" style="text-align:center">Hallenanzeige öffnen</a>
      <div class="row" style="justify-content:space-between"><a class="hint" href="/">← Zur Website</a><button type="button" class="btn sm" data-diag>Diagnose</button></div></form>`);
    bindForm('login-form', async () => { await api('/api/auth?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: document.getElementById('pass').value }) }); start(); });
  }
  function showSetup() {
    app.innerHTML = shell(`<form id="setup-form" class="lg-form"><div class="notice"><b>Willkommen!</b> Lege jetzt das Passwort für die Turnierleitung fest. Damit meldest du dich und alle Helfer an der Anzeigetafel an.</div>
      <div class="field"><label for="np1">Neues Passwort (mind. 6 Zeichen)</label><input id="np1" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="field"><label for="np2">Passwort wiederholen</label><input id="np2" type="password" autocomplete="new-password" required></div>
      <div class="err-msg"></div><button class="btn primary big">Passwort festlegen</button></form>`);
    bindForm('setup-form', async () => {
      const a = document.getElementById('np1').value, b = document.getElementById('np2').value;
      if (a.length < 6) throw new Error('Das Passwort muss mindestens 6 Zeichen haben.');
      if (a !== b) throw new Error('Die beiden Passwörter sind nicht gleich.');
      await api('/api/auth?action=setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: a }) }); start();
    });
  }
  async function showDiag(prefix) {
    app.innerHTML = shell(`<div class="notice">Diagnose läuft …</div>`);
    let c = null, err = '';
    try { c = await api('/api/auth?action=check'); } catch (e) { err = e.message; }
    const line = (ok, txt) => `<li style="display:flex;gap:8px"><b style="color:${ok ? 'var(--win)' : 'var(--lose)'}">${ok ? '✓' : '✗'}</b><span>${txt}</span></li>`;
    let tips = '';
    if (!c) tips = `Die Server-Funktionen antworten nicht (${esc(err)}). Prüfe in Vercel unter „Deployments“ den obersten Eintrag: Status „Ready“? Liegt der Ordner <b>api</b> direkt im Repository (nicht in einem Unterordner)?`;
    else if (!c.storage) tips = c.env && c.env.length ? 'Es gibt Speicher-Variablen, aber keine passt. Bitte schick einen Screenshot dieser Seite.' : 'Diese Version sieht <b>keine Speicher-Variablen</b>. Prüfe in Vercel: <b>Storage</b> → dein Speicher → <b>Projects</b>: ist <b>obt1</b> verbunden und ist dabei <b>Production</b> angehakt? Danach unbedingt <b>Deployments → oberster Eintrag → ⋯ → Redeploy</b>. Variablen gelten erst für neue Deployments.';
    else if (c.error) tips = 'Der Speicher ist verbunden, aber der Test schlug fehl: <b>' + esc(c.error) + '</b>. Meist hilft: Speicher in Vercel erneut mit dem Projekt verbinden und neu deployen.';
    app.innerHTML = shell(`<div style="display:grid;gap:12px">${prefix ? `<div class="notice">${prefix}</div>` : ''}
      <ul style="list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:14px">
        ${line(!!c, 'Server-Funktionen erreichbar' + (c ? ' (Version ' + esc(c.version) + ')' : ''))}
        ${line(!!(c && c.storage), 'Speicher verbunden' + (c && c.storage ? ': ' + esc(c.storage) : ''))}
        ${line(!!(c && c.write), 'Speichern möglich')}
        ${line(!!(c && c.read), 'Lesen möglich')}
      </ul>
      ${c ? `<div class="hint">Gefundene Speicher-Variablen: ${c.env && c.env.length ? c.env.map(esc).join(', ') : 'keine'} · Umgebung: ${esc(c.vercelEnv || '–')} · Deployment: ${esc(c.deployment || '–')}</div>` : ''}
      ${tips ? `<div class="notice">${tips}</div>` : '<div class="notice"><b>Alles in Ordnung.</b></div>'}
      <div class="row"><button class="btn primary" onclick="location.reload()">Erneut prüfen</button><a class="btn" href="/">Zur Website</a></div></div>`);
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-diag]')) showDiag(); });
  async function start() {
    let me;
    try { me = await api('/api/auth?action=me'); }
    catch (e) { showDiag('<b>Die Turnierleitung kann den Server nicht erreichen.</b> ' + esc(e.message)); return; }
    if (!me.storage) { showDiag('<b>Es fehlt noch der Speicher.</b> Ohne ihn können keine Ergebnisse gespeichert werden.'); return; }
    if (!me.passwordSet) { showSetup(); return; }
    if (!me.loggedIn) { showLogin(); return; }
    ui.pwSource = me.passwordSource; ui.local = !!me.local;
    if (ui.local) { try { ui.sync = await api('/api/sync?action=status'); } catch (e) { ui.sync = null; } }
    try {
      await PT.syncTime();
      S = await PT.fetchState(true); H = PT.make(S); render();
      if (S._migrated) { delete S._migrated; act(() => {}); }
      setTimeout(fixTeamLogos, 800);
      preloadAnthems();
      if (queue.length) flush();
    } catch (e) { showDiag('<b>Der Turnierstand konnte nicht geladen werden.</b> ' + esc(e.message)); }
  }
  setInterval(PT.syncTime, 5 * 60e3);
  addEventListener('beforeunload', (e) => { if (queue.length) { e.preventDefault(); e.returnValue = ''; } });
  start();
})();
