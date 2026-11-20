// Benachrichtigungen abonnieren (Zuschauer, die einem Team folgen)
//   GET  ?action=key                  öffentlicher Schlüssel für den Browser
//   POST ?action=sub   { sub, teams } Abo anlegen/ändern (welche Teams)
//   POST ?action=unsub { endpoint }   Abo löschen
//   POST ?action=test  { endpoint }   Probe-Benachrichtigung nur an dieses Gerät
//   GET  ?action=count · POST ?action=clear   (nur Turnierleitung) Anzahl / alle Abos löschen
let L = null, P = null, initErr = null;
try { L = require('./_lib'); P = require('./_push'); } catch (e) { initErr = e; }

module.exports = async (req, res) => {
  if (initErr) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ error: 'Start fehlgeschlagen: ' + initErr.message })); return; }
  try {
    if (!L.mode()) return L.send(res, 503, { error: 'Der Speicher ist noch nicht eingerichtet.' });
    const action = L.q(req, 'action');
    if (req.method === 'GET' && action === 'key') {
      const k = P.available() ? await P.vapid() : null;
      return L.send(res, 200, { key: k ? k.publicKey : null, available: !!k });
    }
    // Turnierleitung: Anzahl der angemeldeten Geräte, alle löschen
    if (action === 'count' || action === 'clear') {
      if (!(await L.isAdmin(req))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet.' });
      if (action === 'clear') { if (req.method !== 'POST' || req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' }); await P.clearAll(); return L.send(res, 200, { ok: true }); }
      const subs = Object.values(await P.getSubs()); const per = {};
      subs.forEach((s) => (s.teams || []).forEach((t) => { per[t] = (per[t] || 0) + 1; }));
      return L.send(res, 200, { devices: subs.length, perTeam: per, available: P.available() });
    }
    if (req.method !== 'POST' || req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    const b = await L.readJson(req, 16 * 1024);
    if (action === 'sub') {
      const s = b.sub || {}, k = s.keys || {};
      if (!/^https:\/\/[^\s]{10,800}$/.test(String(s.endpoint || '')) || !k.p256dh || !k.auth) return L.send(res, 400, { error: 'Ungültiges Abo.' });
      const known = new Set(((await L.readState()).teams || []).map((t) => t.id));
      const teams = (Array.isArray(b.teams) ? b.teams : []).map(String).filter((t) => known.has(t)).slice(0, 20);
      const id = P.idOf(s.endpoint);
      if (!teams.length) { await P.delSub(id); return L.send(res, 200, { ok: true, teams: [] }); }
      await P.putSub(id, { sub: { endpoint: s.endpoint, keys: { p256dh: String(k.p256dh).slice(0, 200), auth: String(k.auth).slice(0, 100) } }, teams, at: Date.now() });
      return L.send(res, 200, { ok: true, teams });
    }
    if (action === 'unsub') { await P.delSub(P.idOf(String(b.endpoint || ''))); return L.send(res, 200, { ok: true }); }
    if (action === 'test') {
      const id = P.idOf(String(b.endpoint || '')), s = (await P.getSubs())[id];
      if (!s) return L.send(res, 404, { error: 'Dieses Gerät ist nicht angemeldet.' });
      const n = await P.sendTo([[id, s]], { title: '🔔 Benachrichtigungen sind an', body: 'So sieht es aus, wenn dein Team spielt oder ein Tor schießt.', url: '/', tag: 'test' });
      return L.send(res, n ? 200 : 502, n ? { ok: true } : { error: 'Die Probe-Benachrichtigung konnte nicht zugestellt werden.' });
    }
    return L.send(res, 400, { error: 'Unbekannte Aktion.' });
  } catch (e) {
    return L.send(res, e.status || 500, { error: e.message || String(e) });
  }
};
