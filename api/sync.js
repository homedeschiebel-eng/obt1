// Abgleich Laptop ↔ Website – nur im Offline-Betrieb auf dem Laptop (node server.js)
//   ?action=pull  Stand (inkl. Logos) von der Website auf den Laptop holen
//   ?action=push  Stand (inkl. Logos) vom Laptop auf die Website hochladen (braucht das Online-Passwort)
const L = require('./_lib');
const DEFAULT_ONLINE = 'https://obt1-chi.vercel.app';

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
async function getJson(url, opts) {
  let r;
  try { r = await fetch(url, Object.assign({ cache: 'no-store' }, opts || {})); }
  catch (e) { throw new Error('Die Website ist nicht erreichbar. Ist der Laptop mit dem Internet verbunden?'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Die Website antwortet mit Status ' + r.status + '.'), { status: r.status, data: j });
  return j;
}

module.exports = async (req, res) => {
  try {
    if (L.mode() !== 'file' || !process.env.PT_LOCAL) return L.send(res, 404, { error: 'Der Abgleich gibt es nur im Offline-Betrieb auf dem Laptop.' });
    if (req.method !== 'POST') return L.send(res, 405, { error: 'Nicht erlaubt.' });
    if (req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    if (!(await L.isAdmin(req))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet.' });
    const b = await L.readJson(req);
    const base = String(b.url || DEFAULT_ONLINE).trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+$/i.test(base)) return L.send(res, 400, { error: 'Bitte eine gültige Website-Adresse angeben, z. B. https://obt1-chi.vercel.app' });
    const action = L.q(req, 'action');

    if (action === 'pull') {
      const j = await getJson(base + '/api/state?fresh=1&t=' + Date.now());
      if (!j.state || !Array.isArray(j.state.matches)) throw new Error('Die Website hat keinen Turnierstand geliefert.');
      let images = 0;
      const map = {};
      for (const u of imgUrls(j.state)) {
        try {
          const r = await fetch(base + u); if (!r.ok) continue;
          const buf = Buffer.from(await r.arrayBuffer()); const type = L.sniff(buf); if (!type) continue;
          map[u] = await L.putImage(buf, type); images++;
        } catch (e) { /* Bild fehlt dann offline */ }
      }
      const next = L.cleanState(j.state); mapUrls(next, map);
      const cur = await L.readState();
      next.rev = (cur.rev || 0) + 1; next.updated = Date.now();
      await L.writeState(next);
      return L.send(res, 200, { ok: true, matches: next.matches.length, teams: next.teams.length, images });
    }

    if (action === 'push') {
      if (!b.pass) return L.send(res, 400, { error: 'Bitte das Passwort der Online-Turnierleitung eingeben.' });
      let r;
      try { r = await fetch(base + '/api/auth?action=login', { method: 'POST', headers: { 'x-csrf': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: b.pass }) }); }
      catch (e) { throw new Error('Die Website ist nicht erreichbar. Ist der Laptop mit dem Internet verbunden?'); }
      const lj = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Anmeldung auf der Website fehlgeschlagen: ' + (lj.error || 'Status ' + r.status));
      const raw = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie().join(';') : (r.headers.get('set-cookie') || '');
      const m = raw.match(/pt_s=[^;]+/); if (!m) throw new Error('Die Website hat keine Anmeldung zurückgegeben.');
      const cookie = m[0];
      const local = await L.readState();
      const map = {}; let images = 0;
      for (const u of imgUrls(local)) {
        const buf = await L.getImage(u.split('id=')[1]); if (!buf) continue;
        try { const up = await getJson(base + '/api/img', { method: 'POST', headers: { 'x-csrf': '1', 'Content-Type': L.sniff(buf), Cookie: cookie }, body: buf }); if (up.url) { map[u] = up.url; images++; } } catch (e) { /* Bild bleibt */ }
      }
      const state = JSON.parse(JSON.stringify(local)); mapUrls(state, map);
      const online = await getJson(base + '/api/state?fresh=1&t=' + Date.now());
      const out = await getJson(base + '/api/state', { method: 'POST', headers: { 'x-csrf': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ base: (online.state && online.state.rev) || 0, state }) });
      return L.send(res, 200, { ok: true, rev: out.rev, images });
    }
    return L.send(res, 400, { error: 'Unbekannte Aktion.' });
  } catch (e) {
    return L.send(res, e.status && e.status < 500 ? 400 : 500, { error: e.message || String(e) });
  }
};
