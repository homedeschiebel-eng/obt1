// Torhymnen auf dem Laptop speichern (Ordner .data/audio) – nur im Offline-Betrieb (node server.js)
//   GET  ?key=team:t1           liefert die Datei (Name im Header X-Name)
//   GET  ?action=list           welche Hymnen es gibt
//   POST ?key=team:t1           Datei hochladen (Name im Header X-Name)
//   POST ?key=team:t1&action=del  löschen
//   Fernbedienung (z. B. iPad-Bedienpult → Laptop spielt ab):
//   POST ?action=cmd   { cmd: 'play'|'stop', team }   Befehl an das Hymnen-Gerät
//   GET  ?action=wait&since=N                       wartet (bis 25 s) auf den nächsten Befehl – das Hymnen-Gerät hört so mit
//   POST ?action=now   { team, name, playing }      Hymnen-Gerät meldet, was gerade läuft
//   GET  ?action=info                                ist ein Hymnen-Gerät verbunden, was läuft gerade
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
// Befehle nur im Arbeitsspeicher – sie sind nur für den Moment gedacht
const R = { seq: 0, last: null, waiters: new Set(), listenAt: 0, now: null };
const TEAM = /^[A-Za-z0-9_-]{1,40}$/;
function wake() { const w = [...R.waiters]; R.waiters.clear(); w.forEach((f) => f()); }
const meta = (key) => { try { return JSON.parse(fs.readFileSync(fileOf(key) + '.json', 'utf8')); } catch (e) { return null; } };

module.exports = async (req, res) => {
  try {
    if (L.mode() !== 'file' || !process.env.PT_LOCAL) return L.send(res, 404, { error: 'Nur im Offline-Betrieb auf dem Laptop.' });
    if (!(await L.isAdmin(req))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet.' });
    const action = L.q(req, 'action'), key = L.q(req, 'key');
    if (req.method === 'GET' && action === 'info') {
      const listening = R.waiters.size > 0 || Date.now() - R.listenAt < 35000;
      return L.send(res, 200, { listening, now: listening && R.now && R.now.playing ? R.now : null });
    }
    if (req.method === 'GET' && action === 'wait') {
      R.listenAt = Date.now();
      const since = parseInt(L.q(req, 'since'), 10);
      const reply = () => { R.listenAt = Date.now(); const x = R.last; return L.send(res, 200, { seq: R.seq, cmd: !isNaN(since) && since >= 0 && x && x.seq > since ? x : null }); };
      if (isNaN(since) || since < 0 || R.seq > since) return reply();
      let done = false;
      const fin = () => { if (done) return; done = true; clearTimeout(tm); R.waiters.delete(fin); reply(); };
      const tm = setTimeout(fin, 25000);
      R.waiters.add(fin); req.on('close', () => { if (!done) { done = true; clearTimeout(tm); R.waiters.delete(fin); } });
      return;
    }
    if (req.method === 'POST' && (action === 'cmd' || action === 'now')) {
      if (req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
      const b = await L.readJson(req);
      const team = TEAM.test(String(b.team || '')) ? String(b.team) : null;
      if (action === 'now') { R.listenAt = Date.now(); R.now = { team, name: String(b.name || '').slice(0, 120), playing: !!b.playing, at: Date.now() }; return L.send(res, 200, { ok: true }); }
      if (b.cmd !== 'play' && b.cmd !== 'stop') return L.send(res, 400, { error: 'Unbekannter Befehl.' });
      R.seq += 1; R.last = { seq: R.seq, cmd: b.cmd, team, at: Date.now() };
      wake();
      return L.send(res, 200, { ok: true, listening: R.waiters.size > 0 || Date.now() - R.listenAt < 35000 });
    }
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
