// Automatische Updates für den Laptop
// Holt neue Versionen von der Website (Update-Paket unter /update/), prüft jede Datei
// und installiert sie – aber nur, wenn gerade kein Spiel läuft. Ändern sich Server-Dateien,
// startet der Server kurz neu (server.js übernimmt das). Daten in .data bleiben unberührt.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = path.join(ROOT, '.data');
const DEFAULT_SOURCE = 'https://pg-oberstufenfussballturnier.vercel.app';
const EVERY = 10 * 60e3;
const SERVER_FILES = /^(api\/|app-server\.js$|updater\.js$|package\.json$)/;
const status = { version: '', checkedAt: 0, installedAt: 0, last: '', error: '' };

function localVersion() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'update', 'version.json'), 'utf8')).version || ''; } catch (e) { return ''; } }
function source() {
  try { const c = JSON.parse(fs.readFileSync(path.join(DATA, 'sync.json'), 'utf8')); const u = String(c.url || '').replace(/\/+$/, ''); if (/^https?:\/\//.test(u) && u !== 'https://obt1-chi.vercel.app') return u; } catch (e) { /* Standard */ }
  return DEFAULT_SOURCE;
}
async function getJson(url, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 20000);
  try { const r = await fetch(url, { cache: 'no-store', signal: ctl.signal }); if (!r.ok) throw new Error('Status ' + r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function gameLive() {
  try { const L = require('./api/_lib'); const s = await L.readState(); return (s.matches || []).some((m) => m.status === 'live'); } catch (e) { return false; }
}
const safePath = (p) => typeof p === 'string' && p && !p.startsWith('/') && !p.includes('\\') && !p.split('/').some((x) => x === '..' || x === '') && !/^(\.data|\.git|node_modules)(\/|$)/.test(p);

async function check(force) {
  status.checkedAt = Date.now(); status.version = localVersion();
  const base = source();
  let remote;
  try { remote = await getJson(base + '/update/version.json?t=' + Date.now(), 15000); }
  catch (e) { status.error = ''; status.last = 'Kein Update geprüft (keine Verbindung).'; return false; }
  if (!remote || !remote.version || remote.version === status.version) { status.last = 'Aktuell (' + (status.version || '–') + ').'; status.error = ''; return false; }
  if (!force && await gameLive()) { status.last = 'Neue Version ' + remote.version + ' gefunden – wird nach dem laufenden Spiel installiert.'; return false; }
  const bundle = await getJson(base + '/update/bundle.json?v=' + encodeURIComponent(remote.version), 60000);
  if (!bundle || bundle.version !== remote.version || !bundle.files) throw new Error('Update-Paket unvollständig.');
  const changed = [];
  for (const [p, f] of Object.entries(bundle.files)) {
    if (!safePath(p)) throw new Error('Ungültiger Dateipfad im Update: ' + p);
    const buf = Buffer.from(f.b64, 'base64');
    if (crypto.createHash('sha256').update(buf).digest('hex') !== f.sha) throw new Error('Prüfsumme stimmt nicht: ' + p);
    const full = path.join(ROOT, p);
    let old = null; try { old = fs.readFileSync(full); } catch (e) { /* neu */ }
    if (old && old.equals(buf)) continue;
    changed.push({ p, full, buf });
  }
  // erst alles geprüft – dann schreiben
  for (const c of changed) { fs.mkdirSync(path.dirname(c.full), { recursive: true }); const tmp = c.full + '.update-tmp'; fs.writeFileSync(tmp, c.buf); fs.renameSync(tmp, c.full); }
  fs.mkdirSync(path.join(ROOT, 'update'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'update', 'version.json'), JSON.stringify(remote, null, 1) + '\n');
  status.installedAt = Date.now(); status.version = remote.version; status.error = '';
  status.last = 'Version ' + remote.version + ' installiert (' + changed.length + ' Dateien).';
  console.log('  Update: ' + status.last);
  if (changed.some((c) => SERVER_FILES.test(c.p))) setTimeout(() => process.exit(75), 300); // server.js startet neu
  return true;
}

let timer = null;
function start() {
  if (timer || process.env.PT_NO_UPDATE) return;
  const loop = async () => { try { await check(false); } catch (e) { status.error = e.message; status.last = 'Update fehlgeschlagen: ' + e.message; } timer = setTimeout(loop, EVERY); };
  timer = setTimeout(loop, 15000);
}
module.exports = { start, check, status, localVersion };
