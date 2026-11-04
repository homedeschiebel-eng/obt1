// Zum Ausprobieren auf dem eigenen Rechner: node dev-server.js  →  http://localhost:3000
// Speichert in den Ordner .data/. Passwort der Turnierleitung lokal: test (oder ADMIN_PASSWORD setzen).
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = +process.env.PORT || 3000;
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const PAGES = { '/': 'index.html', '/admin': 'admin.html', '/turnierleitung': 'admin.html', '/anzeige': 'anzeige.html' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (m && fs.existsSync(path.join(ROOT, 'api', m[1] + '.js'))) {
    req.query = Object.fromEntries(url.searchParams);
    try { await require('./api/' + m[1] + '.js')(req, res); } catch (e) { res.statusCode = 500; res.end(String(e)); }
    return;
  }
  let file = PAGES[url.pathname] || url.pathname.slice(1);
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || /^(api|\.data|node_modules)/.test(file) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.statusCode = 404; res.end('Nicht gefunden'); return; }
  res.setHeader('Content-Type', TYPES[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => console.log('Turnier läuft lokal: http://localhost:' + PORT + '  ·  Turnierleitung: http://localhost:' + PORT + '/turnierleitung (Passwort: ' + (process.env.ADMIN_PASSWORD || 'test') + ')'));
