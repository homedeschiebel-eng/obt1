// Bilder (Teamlogos, Teamfotos, Partnerlogos): GET ?id=… liefert, POST lädt hoch (nur Turnierleitung)
let L = null, initErr = null;
try { L = require('./_lib'); } catch (e) { initErr = e; }

module.exports = async (req, res) => {
  if (initErr) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ error: 'Start fehlgeschlagen: ' + initErr.message })); return; }
  try {
    if (req.method === 'GET') {
      const buf = await L.getImage(L.q(req, 'id'));
      if (!buf) { res.statusCode = 404; res.end('Nicht gefunden'); return; }
      res.statusCode = 200;
      res.setHeader('Content-Type', L.sniff(buf) || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.end(buf);
      return;
    }
    if (req.method !== 'POST') return L.send(res, 405, { error: 'Nicht erlaubt.' });
    if (req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    if (!(await L.isAdmin(req))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet. Bitte neu anmelden.' });
    if (!L.mode()) return L.send(res, 503, { error: 'Der Speicher ist noch nicht eingerichtet.' });
    const buf = await L.readBody(req, 1.5 * 1024 * 1024);
    const type = L.sniff(buf);
    if (!type) return L.send(res, 400, { error: 'Nur JPG-, PNG- oder WebP-Bilder sind erlaubt.' });
    return L.send(res, 200, { url: await L.putImage(buf, type) });
  } catch (e) {
    return L.send(res, e.status || 500, { error: e.message });
  }
};
