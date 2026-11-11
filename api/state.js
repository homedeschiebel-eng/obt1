// Turnierstand lesen (alle) und speichern (nur Turnierleitung)
let L = null, initErr = null;
try { L = require('./_lib'); } catch (e) { initErr = e; }

// Kurzer Zwischenspeicher pro Server-Instanz, damit viele Zuschauer den Speicher nicht überlasten
let cache = null;
// Browser: nie zwischenspeichern. Vercel-CDN: höchstens 1 Sekunde (entlastet bei vielen Zuschauern).
const PUBLIC = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'public, max-age=1', 'Vercel-CDN-Cache-Control': 'public, max-age=1' };

module.exports = async (req, res) => {
  if (initErr) {
    res.statusCode = 500; res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Die Turnier-Funktion konnte nicht starten: ' + initErr.message }));
    return;
  }
  try {
    if (!L.mode()) return L.send(res, 503, { error: 'Der Speicher ist noch nicht mit dem Vercel-Projekt verbunden. Im Vercel-Projekt unter Storage einen Redis- oder Blob-Speicher anlegen, mit dem Projekt verbinden und neu deployen.', setup: true });

    if (req.method === 'GET') {
      const fresh = !!L.q(req, 'fresh');
      // Turnierleitung sieht alles – nie im CDN zwischenspeichern
      if (await L.isAdmin(req)) return L.send(res, 200, { state: await L.readState() }, { 'Cache-Control': 'private, no-store' });
      // Besucher: vor dem Veröffentlichungstermin ohne Gruppen und Spielplan
      if (!fresh && cache && Date.now() - cache.t < 700) return L.send(res, 200, cache.v, PUBLIC);
      const v = { state: L.publicView(await L.readState()) };
      cache = { t: Date.now(), v };
      return L.send(res, 200, v, fresh ? null : PUBLIC);
    }
    if (req.method !== 'POST') return L.send(res, 405, { error: 'Nicht erlaubt.' });
    if (req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    if (!(await L.isAdmin(req))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet. Bitte neu anmelden.' });

    const b = await L.readJson(req, 900 * 1024);
    const cur = await L.readState();
    const curRev = cur.rev || 0;
    if (typeof b.base !== 'number' || b.base !== curRev) return L.send(res, 409, { error: 'conflict', state: cur });
    const next = L.cleanState(b.state);
    next.rev = curRev + 1; next.updated = Date.now();
    await L.writeState(next);
    cache = { t: Date.now(), v: { state: L.publicView(next) } };
    return L.send(res, 200, { ok: true, rev: next.rev, updated: next.updated });
  } catch (e) {
    return L.send(res, e.status || 500, { error: e.message || 'Unbekannter Fehler' });
  }
};
