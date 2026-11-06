// Abgleich Laptop ↔ Website – nur im Offline-Betrieb auf dem Laptop (node server.js)
//   GET  ?action=status  Zustand der automatischen Übertragung
//   POST ?action=config  automatische Übertragung ein/aus, Adresse, Online-Passwort
//   POST ?action=pull    Stand (inkl. Logos) einmalig von der Website auf den Laptop holen
//   POST ?action=push    Stand jetzt sofort auf die Website übertragen
// Ist die automatische Übertragung an, schickt der Laptop jede Änderung von selbst an die Website.
// Ohne Internet läuft alles weiter; sobald die Verbindung zurück ist, wird nachgeholt.
const fs = require('fs');
const path = require('path');
const L = require('./_lib');
const DEFAULT_ONLINE = 'https://pg-oberstufenfussballturnier.vercel.app';
const CFG_FILE = path.join(__dirname, '..', '.data', 'sync.json');

/* ---------- Einstellungen (nur auf dem Laptop, Ordner .data) ---------- */
const OLD_URLS = ['https://obt1-chi.vercel.app'];
function loadCfg() {
  let c; try { c = Object.assign({ enabled: false, url: DEFAULT_ONLINE, pass: '', uploaded: {} }, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch (e) { return { enabled: false, url: DEFAULT_ONLINE, pass: '', uploaded: {} }; }
  if (OLD_URLS.includes(String(c.url || '').replace(/\/+$/, ''))) { c.url = DEFAULT_ONLINE; c.lastOnlineRev = null; c.conflict = null; try { saveCfg(c); } catch (e) { /* egal */ } }
  return c;
}
function saveCfg(c) { fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 1)); }
const status = { state: 'aus', lastOk: 0, lastTry: 0, lastErr: '', pushedRev: null, online: null };

const imgUrls = (s) => {
  const out = new Set();
  (s.teams || []).forEach((t) => { if (t.logo) out.add(t.logo); if (t.photo) out.add(t.photo); });
  (s.sponsors || []).forEach((x) => { if (x.logo) out.add(x.logo); });
  return [...out].filter((u) => /^\/api\/img\?id=/.test(u));
};
const mapUrls = (s, map) => {
  (s.teams || []).forEach((t) => { if (map[t.logo]) t.logo = map[t.logo]; if (map[t.photo]) t.photo = map[t.photo]; });
  (s.sponsors || []).forEach((x) => { if (map[x.logo]) x.logo = map[x.logo]; });
};
const NET = 'Die Website ist nicht erreichbar (keine Internetverbindung?).';
async function req(url, opts, timeout) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout || 12000);
  let r;
  try { r = await fetch(url, Object.assign({ cache: 'no-store', signal: ctl.signal }, opts || {})); }
  catch (e) { throw Object.assign(new Error(NET), { net: true }); }
  finally { clearTimeout(t); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && !j.error) {
    let host = url; try { host = new URL(url).host; } catch (e) { /* egal */ }
    throw Object.assign(new Error('Unter ' + host + ' wurde die Turnier-Website nicht gefunden (Status 404). Bitte die Adresse prüfen: In Vercel unter Projekt → Domains steht die richtige. Wurde das Projekt umbenannt, hier die neue Adresse eintragen und speichern.'), { status: 404, notFound: true });
  }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Die Website antwortet mit Status ' + r.status + '.'), { status: r.status, data: j, headers: r.headers });
  return { j, headers: r.headers };
}
const clean = (u) => String(u || DEFAULT_ONLINE).trim().replace(/\/+$/, '');

/* ---------- Anmeldung an der Website ---------- */
let session = { url: '', cookie: '', until: 0 };
async function login(base, pass) {
  if (session.url === base && session.cookie && session.until > Date.now()) return session.cookie;
  if (!pass) throw new Error('Bitte das Passwort der Online-Turnierleitung eintragen.');
  let r;
  try { r = await fetch(base + '/api/auth?action=login', { method: 'POST', headers: { 'x-csrf': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pass }) }); }
  catch (e) { throw Object.assign(new Error(NET), { net: true }); }
  const lj = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Anmeldung auf der Website fehlgeschlagen: ' + (lj.error || 'Status ' + r.status));
  const raw = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie().join(';') : (r.headers.get('set-cookie') || '');
  const m = raw.match(/pt_s=[^;]+/); if (!m) throw new Error('Die Website hat keine Anmeldung zurückgegeben.');
  session = { url: base, cookie: m[0], until: Date.now() + 12 * 3600e3 };
  return session.cookie;
}

/* ---------- Übertragen: Laptop → Website ---------- */
let pushing = null;
async function pushOnce(cfg, force) {
  if (pushing) return pushing;
  pushing = (async () => {
    const base = clean(cfg.url);
    // Uhrzeit der Website messen, damit die Spieluhr bei den Zuschauern genau stimmt
    const t0 = Date.now(); const { j: tj } = await req(base + '/api/time', {}, 8000); const offset = tj.now - (t0 + Date.now()) / 2;
    let cookie = await login(base, cfg.pass);
    const local = await L.readState();
    const map = {};
    for (const u of imgUrls(local)) {
      if (cfg.uploaded[u]) { map[u] = cfg.uploaded[u]; continue; }
      const buf = await L.getImage(u.split('id=')[1]); if (!buf) continue;
      const { j } = await req(base + '/api/img', { method: 'POST', headers: { 'x-csrf': '1', 'Content-Type': L.sniff(buf), Cookie: cookie }, body: buf }, 30000);
      if (j.url) { map[u] = j.url; cfg.uploaded[u] = j.url; saveCfg(cfg); }
    }
    const state = JSON.parse(JSON.stringify(local)); mapUrls(state, map);
    if (Math.abs(offset) > 1500) {
      const sh = (v) => (typeof v === 'number' && v > 0 ? Math.round(v + offset) : v);
      (state.matches || []).forEach((m) => { if (m.clock) m.clock.since = sh(m.clock.since); m.startedAt = sh(m.startedAt); m.endedAt = sh(m.endedAt); });
    }
    state.controlledBy = 'laptop'; state.controlledAt = tj.now;
    const send = async (b) => req(base + '/api/state', { method: 'POST', headers: { 'x-csrf': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ base: b, state }) }, 20000);
    const { j: on } = await req(base + '/api/state?fresh=1&t=' + Date.now());
    const onRev = (on.state && on.state.rev) || 0;
    // Schutz: Wurde online seit unserer letzten Übertragung etwas geändert (z. B. nach einem Laptop-Ausfall)?
    const conflict = (rev) => { cfg.conflict = { at: Date.now(), onlineRev: rev, lastOnlineRev: cfg.lastOnlineRev }; saveCfg(cfg); return Object.assign(new Error('Auf der Website wurde seit der letzten Übertragung etwas geändert. Bitte entscheiden: Website-Stand übernehmen oder Laptop-Stand übertragen.'), { conflict: true }); };
    if (!force && cfg.lastOnlineRev != null && onRev !== cfg.lastOnlineRev) throw conflict(onRev);
    let out;
    try { out = (await send(onRev)).j; }
    catch (e) {
      if (e.status === 409 && e.data && e.data.state) { if (!force) throw conflict(e.data.state.rev || 0); out = (await send(e.data.state.rev || 0)).j; }
      else if (e.status === 401) { session.until = 0; cookie = await login(base, cfg.pass); out = (await send(onRev)).j; }
      else throw e;
    }
    cfg.lastOnlineRev = out.rev; cfg.conflict = null; saveCfg(cfg);
    // Gegenprobe: liefert die Website (wie für Zuschauer) den neuen Stand aus?
    let seen = null;
    for (let i = 0; i < 4; i++) {
      try { const { j: chk } = await req(base + '/api/state?t=' + Date.now(), {}, 8000); seen = chk.state && chk.state.rev; } catch (e) { seen = null; }
      if (seen != null && seen >= out.rev) break;
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (!status.onlineStorage || Date.now() - (status.storageAt || 0) > 300000) { try { const { j: me } = await req(base + '/api/auth?action=me', {}, 8000); status.onlineStorage = me.storage || ''; status.onlineVersion = me.version || ''; status.storageAt = Date.now(); } catch (e) { /* egal */ } }
    status.pushedRev = local.rev; status.lastTry = Date.now(); status.online = out.rev;
    if (seen == null || seen < out.rev) {
      status.state = 'fehler'; status.lastErr = 'Übertragen, aber die Website zeigt den neuen Stand noch nicht an (Website liefert Stand ' + seen + ', erwartet ' + out.rev + '). Speicher der Website: ' + (status.onlineStorage || 'unbekannt') + '.';
    } else { status.lastOk = Date.now(); status.lastErr = ''; status.state = 'ok'; }
    return out;
  })();
  try { return await pushing; } finally { pushing = null; }
}

/* ---------- Automatik im Hintergrund ---------- */
let timer = null, wait = 2000;
function startAuto() {
  if (timer || L.mode() !== 'file') return;
  const tick = async () => {
    const cfg = loadCfg();
    if (!cfg.enabled) { status.state = 'aus'; timer = setTimeout(tick, 3000); return; }
    if (cfg.conflict) { status.state = 'konflikt'; status.lastErr = 'Auf der Website wurde seit der letzten Übertragung etwas geändert. Bitte entscheiden: Website-Stand übernehmen oder Laptop-Stand übertragen.'; timer = setTimeout(tick, 3000); return; }
    try {
      const rev = (await L.readState()).rev || 0;
      if (rev !== status.pushedRev || Date.now() - (status.lastOk || 0) > 60000 || status.state !== 'ok') {
        status.lastTry = Date.now(); await pushOnce(cfg);
      }
      wait = 2000;
    } catch (e) {
      status.state = e.conflict ? 'konflikt' : e.net ? 'offline' : 'fehler'; status.lastErr = e.message || String(e); status.lastTry = Date.now();
      wait = Math.min(20000, wait * 1.6);
    }
    timer = setTimeout(tick, wait);
  };
  timer = setTimeout(tick, 1500);
}

/* ---------- Einmal von der Website holen ---------- */
async function pull(base) {
  const { j } = await req(base + '/api/state?fresh=1&t=' + Date.now());
  if (!j.state || !Array.isArray(j.state.matches)) throw new Error('Die Website hat keinen Turnierstand geliefert.');
  let images = 0; const map = {};
  const cfg = loadCfg();
  for (const u of imgUrls(j.state)) {
    try {
      const r = await fetch(base + u); if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer()); const type = L.sniff(buf); if (!type) continue;
      const local = await L.putImage(buf, type); map[u] = local; cfg.uploaded[local] = u; images++;
    } catch (e) { /* Bild fehlt dann offline */ }
  }
  saveCfg(cfg);
  const next = L.cleanState(j.state); mapUrls(next, map);
  const cur = await L.readState();
  next.rev = (cur.rev || 0) + 1; next.updated = Date.now();
  await L.writeState(next);
  status.pushedRev = next.rev; // frisch geholt = gleicher Stand wie online
  const c2 = loadCfg(); c2.lastOnlineRev = j.state.rev || 0; c2.conflict = null; saveCfg(c2); status.state = c2.enabled ? 'ok' : 'aus'; status.lastErr = '';
  return { matches: next.matches.length, teams: next.teams.length, images };
}

const handler = async (req0, res) => {
  try {
    if (L.mode() !== 'file' || !process.env.PT_LOCAL) return L.send(res, 404, { error: 'Den Abgleich gibt es nur im Offline-Betrieb auf dem Laptop.' });
    if (!(await L.isAdmin(req0))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet.' });
    const action = L.q(req0, 'action');
    let upd = null; try { upd = require('../updater.js'); } catch (e) { upd = null; }
    if (req0.method === 'GET' && action === 'status') {
      const c = loadCfg();
      if (c.conflict && c.enabled) { status.state = 'konflikt'; }
      return L.send(res, 200, Object.assign({ enabled: c.enabled, url: c.url, hasPass: !!c.pass, conflict: c.conflict || null, update: upd ? Object.assign({}, upd.status, { version: upd.status.version || upd.localVersion() }) : null }, status));
    }
    if (req0.method !== 'POST') return L.send(res, 405, { error: 'Nicht erlaubt.' });
    if (req0.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    const b = await L.readJson(req0);
    const base = clean(b.url || loadCfg().url);
    if (!/^https?:\/\/[^/\s]+$/i.test(base)) return L.send(res, 400, { error: 'Bitte eine gültige Website-Adresse angeben, z. B. https://pg-oberstufenfussballturnier.vercel.app' });

    if (action === 'config') {
      const c = loadCfg();
      if (c.url !== base) { c.uploaded = {}; c.lastOnlineRev = null; c.conflict = null; session = { url: '', cookie: '', until: 0 }; }
      c.url = base; c.enabled = !!b.enabled; if (typeof b.pass === 'string' && b.pass) { c.pass = b.pass; session.until = 0; }
      if (c.enabled && !c.pass) return L.send(res, 400, { error: 'Für die automatische Übertragung bitte das Passwort der Online-Turnierleitung eintragen.' });
      saveCfg(c); status.pushedRev = null; status.state = c.enabled ? 'startet' : 'aus';
      if (c.enabled) { try { await pushOnce(c); } catch (e) { status.state = e.net ? 'offline' : 'fehler'; status.lastErr = e.message; } }
      return L.send(res, 200, Object.assign({ ok: true, enabled: c.enabled, url: c.url, hasPass: !!c.pass }, status));
    }
    if (action === 'pull') return L.send(res, 200, Object.assign({ ok: true }, await pull(base)));
    if (action === 'update') {
      if (!upd) return L.send(res, 400, { error: 'Automatische Updates sind hier nicht verfügbar.' });
      try { const done = await upd.check(false); return L.send(res, 200, { ok: true, installed: done, status: upd.status }); }
      catch (e) { upd.status.error = e.message; upd.status.last = 'Update fehlgeschlagen: ' + e.message; return L.send(res, 500, { error: upd.status.last }); }
    }
    if (action === 'push') {
      const c = loadCfg(); c.url = base; if (b.pass) { c.pass = b.pass; session.until = 0; } saveCfg(c);
      const out = await pushOnce(c, !!b.force);
      return L.send(res, 200, { ok: true, rev: out.rev });
    }
    return L.send(res, 400, { error: 'Unbekannte Aktion.' });
  } catch (e) {
    return L.send(res, e.status && e.status < 500 ? 400 : 500, { error: e.message || String(e) });
  }
};
handler.startAuto = startAuto;
module.exports = handler;
