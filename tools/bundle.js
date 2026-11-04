// Erzeugt das Update-Paket für den Laptop: update/bundle.json und update/version.json
// Wird vor jedem Commit ausgeführt (node tools/bundle.js). Enthält alle Dateien des Projekts
// außer Daten, Git und dem Update-Paket selbst.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = /^(update\/|\.data\/|node_modules\/|\.git\/)|\.zip$/;
const list = execSync('git ls-files -co --exclude-standard', { cwd: ROOT }).toString().split('\n').filter((p) => p && !SKIP.test(p) && fs.existsSync(path.join(ROOT, p))).sort();
const files = {}; const h = crypto.createHash('sha256');
for (const p of list) {
  const buf = fs.readFileSync(path.join(ROOT, p));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  files[p] = { sha, b64: buf.toString('base64') }; h.update(p + ':' + sha + '\n');
}
const version = h.digest('hex').slice(0, 12);
fs.mkdirSync(path.join(ROOT, 'update'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'update', 'bundle.json'), JSON.stringify({ version, created: new Date().toISOString(), files }));
fs.writeFileSync(path.join(ROOT, 'update', 'version.json'), JSON.stringify({ version, created: new Date().toISOString(), count: list.length }, null, 1) + '\n');
console.log('Update-Paket ' + version + ': ' + list.length + ' Dateien');
