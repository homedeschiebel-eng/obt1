// Torhymnen auf dem Laptop speichern (Ordner .data/audio) – nur im Offline-Betrieb (node server.js)
//   GET  ?key=team:t1           liefert die Datei (Name im Header X-Name)
//   GET  ?action=list           welche Hymnen es gibt
//   POST ?key=team:t1           Datei hochladen (Name im Header X-Name)
//   POST ?key=team:t1&action=del  löschen
const fs = require('fs');
const path = require('path');
const L = require('./_lib');
const DIR = path.join(__dirname, '..', '.data', 'audio');
const KEY = /^(default|team:[A-Za-z0-9_-]{1,40})$/;
const fileOf = (key) => path.join(DIR, key.replace(':', '_'));
function sniff(b) {
  if (b.length < 12) return null;
  if (b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (b.slice(4, 8).toString() === 'ftyp') return 'audio/mp4';
  if (b.slice(0, 4).toString() === 'OggS') return 'audio/ogg';
  if (b.slice(0, 4).toString() === 'fLaC') return 'audio/flac';
  return null;
}
const meta = (key) => { try { return JSON.parse(fs.readFileSync(fileOf(key) + '.json', 'utf8')); } catch (e) { return null; } };

module.exports = async (req, res) => {
  try {
    if (L.mode() !== 'file' || !process.env.PT_LOCAL) return L.send(res, 404, { error: 'Nur im Offline-Betrieb auf dem Laptop.' });
    if (!(await L.isAdmin(req))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet.' });
    const action = L.q(req, 'action'), key = L.q(req, 'key');
    if (req.method === 'GET' && action === 'list') {
      const out = {};
      if (fs.existsSync(DIR)) fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).forEach((f) => { const k = f.slice(0, -5).replace('_', ':'); const m = meta(k); if (m && fs.existsSync(fileOf(k) + '.bin')) out[k] = { name: m.name, size: m.size }; });
      return L.send(res, 200, { files: out });
    }
    if (!KEY.test(key)) return L.send(res, 400, { error: 'Ungültiger Name.' });
    if (req.method === 'GET') {
      const m = meta(key), f = fileOf(key) + '.bin';
      if (!m || !fs.existsSync(f)) { res.statusCode = 404; res.end(); return; }
      res.statusCode = 200; res.setHeader('Content-Type', m.type); res.setHeader('X-Name', encodeURIComponent(m.name)); res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(f).pipe(res); return;
    }
    if (req.method !== 'POST' || req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    if (action === 'del') { [fileOf(key) + '.bin', fileOf(key) + '.json'].forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* schon weg */ } }); return L.send(res, 200, { ok: true }); }
    const buf = await L.readBody(req, 40 * 1024 * 1024);
    const type = sniff(buf);
    if (!type) return L.send(res, 400, { error: 'Das ist keine Audiodatei (MP3, M4A, WAV, OGG).' });
    const name = decodeURIComponent(String(req.headers['x-name'] || 'Torhymne')).slice(0, 120);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(fileOf(key) + '.bin', buf);
    fs.writeFileSync(fileOf(key) + '.json', JSON.stringify({ name, type, size: buf.length, at: Date.now() }));
    return L.send(res, 200, { ok: true, name, size: buf.length });
  } catch (e) {
    return L.send(res, e.status || 500, { error: e.message || String(e) });
  }
};
