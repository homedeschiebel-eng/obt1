// Der eigentliche Laptop-Server (wird von server.js gestartet und bei Updates neu gestartet).
// Gespeichert wird im Ordner .data/ neben dieser Datei.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
process.env.PT_LOCAL = '1';
let START_PORT = +process.env.PORT || 3000;
const PORT_FILE = path.join(ROOT, '.data', 'port.txt');
if (process.env.PT_RESTART) { try { START_PORT = +fs.readFileSync(PORT_FILE, 'utf8') || START_PORT; } catch (e) { /* Standard */ } }
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const BLOCKED = /^(api|\.data|\.git|node_modules|tools|update)(\/|$)|^(server|app-server|dev-server|updater)\.js$|^package(-lock)?\.json$/;

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);
  const api = p.match(/^\/api\/([a-z]+)$/);
  if (api && fs.existsSync(path.join(ROOT, 'api', api[1] + '.js'))) {
    req.query = Object.fromEntries(url.searchParams);
    Promise.resolve().then(() => require('./api/' + api[1] + '.js')(req, res)).catch((e) => { res.statusCode = 500; res.end(String(e && e.message || e)); });
    return;
  }
  // Wie auf Vercel: saubere Adressen ohne .html, kein Schrägstrich am Ende
  if (p.length > 1 && p.endsWith('/')) { res.statusCode = 308; res.setHeader('Location', p.replace(/\/+$/, '') + url.search); res.end(); return; }
  let file = p === '/' ? 'index.html' : p.slice(1);
  if (!path.extname(file) && fs.existsSync(path.join(ROOT, file + '.html'))) file += '.html';
  file = path.normalize(file).replace(/\\/g, '/');
  const full = path.join(ROOT, file);
  if (file.startsWith('..') || BLOCKED.test(file) || !full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.statusCode = 404; const nf = path.join(ROOT, '404.html');
    if (fs.existsSync(nf)) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); fs.createReadStream(nf).pipe(res); } else { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Nicht gefunden'); }
    return;
  }
  res.setHeader('Content-Type', TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', /\.(woff2|png|jpg|webp)$/.test(full) ? 'public, max-age=86400' : 'no-cache');
  fs.createReadStream(full).pipe(res);
}

function lanAddresses() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach((list) => (list || []).forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
  return out;
}
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function listen(port, tries) {
  const server = http.createServer(handler);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries < 10) return listen(port + 1, tries + 1);
    console.error('Server konnte nicht starten:', e.message); process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => {
    const base = 'http://localhost:' + port;
    try { fs.mkdirSync(path.dirname(PORT_FILE), { recursive: true }); fs.writeFileSync(PORT_FILE, String(port)); } catch (e) { /* egal */ }
    const line = '='.repeat(64);
    console.log('\n' + line + '\n  PARLER OBERSTUFEN-TURNIER – läuft offline auf diesem Laptop\n' + line);
    console.log('\n  Auf diesem Laptop (je ein eigenes Browserfenster):');
    console.log('    Turnierleitung:  ' + base + '/turnierleitung');
    console.log('    Hallenanzeige:   ' + base + '/anzeige      (Taste F = Vollbild)');
    console.log('    Website:         ' + base + '/');
    const lan = lanAddresses();
    if (lan.length) {
      console.log('\n  Andere Geräte im selben WLAN oder Hotspot (Beamer-PC, Handys):');
      lan.forEach((ip) => console.log('    http://' + ip + ':' + port + '/anzeige   ·   http://' + ip + ':' + port + '/'));
    }
    console.log('\n  Dieses Fenster offen lassen. Beenden: Strg + C\n' + line + '\n');
    if (!process.argv.includes('--no-open') && !process.env.PT_DEV && !process.env.PT_RESTART) openBrowser(base + '/turnierleitung');
    if (process.env.PT_RESTART) console.log('  Update installiert – Server läuft wieder. Browserfenster einfach neu laden.\n');
    try { require('./updater.js').start(); } catch (e) { console.error('Automatische Updates nicht verfügbar:', e.message); }
    try { require('./api/sync.js').startAuto(); } catch (e) { console.error('Automatische Übertragung nicht verfügbar:', e.message); }
  });
}
listen(START_PORT, 0);
