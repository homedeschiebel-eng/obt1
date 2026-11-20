// Besucher-Statistik – nur für Besucher, die im Banner zugestimmt haben (ohne Google, ohne fremde Dienste).
//   POST ?action=hit    { t: 'view'|'leave'|'ping', vid, path, secs, ref, dev }   (vom Browser, auch per sendBeacon)
//   GET  ?action=report&day=JJJJ-MM-TT    (Turnierleitung) Auswertung eines Tages + Liste aller Tage
//   POST ?action=clear                     (Turnierleitung) alles löschen
// Gespeichert werden nur Zählerstände je Tag – keine IP-Adressen, keine Namen, keine einzelnen Verläufe.
let L = null, initErr = null;
try { L = require('./_lib'); } catch (e) { initErr = e; }

const isRedis = () => L.mode() === 'redis' || L.mode() === 'redis-tcp';
const FILE_KEY = 'turnier/stats.json', LIVE_MS = 90e3;
const KINDS = ['pv', 'city', 'hour', 'dev', 'ref', 'dur', 'durn', 'login'];
function berlin(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now || Date.now())).map((x) => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hour: p.hour };
}
const pairs = (r) => { const o = {}; if (Array.isArray(r)) { for (let i = 0; i + 1 < r.length; i += 2) o[r[i]] = +r[i + 1] || 0; } else if (r && typeof r === 'object') Object.entries(r).forEach(([k, v]) => { o[k] = +v || 0; }); return o; };
const cleanPath = (p) => { p = String(p || '/').slice(0, 120); return /^\/[\p{L}\p{N}/._-]*$/u.test(p) ? p : '/'; };
const word = (s, n) => String(s || '').replace(/[^\p{L}\p{N} .()/-]/gu, '').trim().slice(0, n || 60);

/* ---------- Speicher ---------- */
async function fileGet() { try { return JSON.parse((await L.rawGet(FILE_KEY)) || '{}') || {}; } catch (e) { return {}; } }
async function record(ev) {
  const { day, hour } = berlin();
  if (isRedis()) {
    const k = (x) => 'pt:an:' + day + ':' + x, cmds = [['SADD', 'pt:an:days', day]];
    if (ev.vid) cmds.push(['ZADD', 'pt:an:live', String(Date.now()), ev.vid]);
    if (ev.t === 'view') { cmds.push(['HINCRBY', k('pv'), ev.path, '1'], ['HINCRBY', k('hour'), hour, '1']); if (ev.vid) cmds.push(['PFADD', k('uv'), ev.vid]); if (ev.first) { cmds.push(['HINCRBY', k('city'), ev.city, '1'], ['HINCRBY', k('dev'), ev.dev, '1'], ['HINCRBY', k('ref'), ev.ref, '1']); } }
    if (ev.t === 'leave' && ev.secs > 0) cmds.push(['HINCRBY', k('dur'), ev.path, String(ev.secs)], ['HINCRBY', k('durn'), ev.path, '1']);
    if (ev.t === 'login') cmds.push(['HINCRBY', k('login'), ev.role, '1']);
    await Promise.all(cmds.map((c) => L.redis(c)));
    return;
  }
  const all = await fileGet(); all.days = all.days || {}; all.live = all.live || {};
  const d = all.days[day] = all.days[day] || {}; KINDS.forEach((x) => { d[x] = d[x] || {}; }); d.uv = d.uv || {};
  const inc = (h, key, n) => { h[key] = (h[key] || 0) + n; };
  if (ev.vid) all.live[ev.vid] = Date.now();
  Object.keys(all.live).forEach((v) => { if (Date.now() - all.live[v] > LIVE_MS) delete all.live[v]; });
  if (ev.t === 'view') { inc(d.pv, ev.path, 1); inc(d.hour, hour, 1); if (ev.vid) d.uv[ev.vid] = 1; if (ev.first) { inc(d.city, ev.city, 1); inc(d.dev, ev.dev, 1); inc(d.ref, ev.ref, 1); } }
  if (ev.t === 'leave' && ev.secs > 0) { inc(d.dur, ev.path, ev.secs); inc(d.durn, ev.path, 1); }
  if (ev.t === 'login') inc(d.login, ev.role, 1);
  await L.rawSet(FILE_KEY, JSON.stringify(all));
}
async function report(day) {
  if (isRedis()) {
    const k = (x) => 'pt:an:' + day + ':' + x, now = Date.now();
    const [days, uv, live, ...h] = await Promise.all([L.redis(['SMEMBERS', 'pt:an:days']), L.redis(['PFCOUNT', k('uv')]), L.redis(['ZCOUNT', 'pt:an:live', String(now - LIVE_MS), '+inf']), ...KINDS.map((x) => L.redis(['HGETALL', k(x)]))]);
    L.redis(['ZREMRANGEBYSCORE', 'pt:an:live', '0', String(now - 3600e3)]).catch(() => {});
    const out = { day, days: (days || []).sort().reverse(), visitors: +uv || 0, live: +live || 0 }; KINDS.forEach((x, i) => { out[x] = pairs(h[i]); }); return out;
  }
  const all = await fileGet(), d = (all.days || {})[day] || {}, now = Date.now();
  const out = { day, days: Object.keys(all.days || {}).sort().reverse(), visitors: Object.keys(d.uv || {}).length, live: Object.values(all.live || {}).filter((t) => now - t < LIVE_MS).length };
  KINDS.forEach((x) => { out[x] = d[x] || {}; }); return out;
}
async function clearAll() {
  if (isRedis()) { const days = (await L.redis(['SMEMBERS', 'pt:an:days'])) || []; const keys = ['pt:an:days', 'pt:an:live']; days.forEach((d) => KINDS.concat('uv').forEach((x) => keys.push('pt:an:' + d + ':' + x))); await L.redis(['DEL', ...keys]); return; }
  await L.rawSet(FILE_KEY, '{}');
}

const handler = async (req, res) => {
  if (initErr) { res.statusCode = 500; res.end(); return; }
  try {
    if (!L.mode()) return L.send(res, 503, { error: 'Kein Speicher.' });
    const action = L.q(req, 'action');
    if (action === 'hit' && req.method === 'POST') {
      // sendBeacon schickt keinen eigenen Kopf mit – darum hier ohne x-csrf; es werden nur Zähler erhöht
      const b = await L.readJson(req, 4 * 1024);
      const t = ['view', 'leave', 'ping'].includes(b.t) ? b.t : null; if (!t) return L.send(res, 400, { error: 'ungültig' });
      const vid = /^[a-z0-9-]{8,40}$/i.test(String(b.vid || '')) ? String(b.vid) : '';
      const hdr = (n) => { try { return decodeURIComponent(String(req.headers[n] || '')); } catch (e) { return ''; } };
      const city = word(hdr('x-vercel-ip-city')) ? word(hdr('x-vercel-ip-city')) + (hdr('x-vercel-ip-country') && hdr('x-vercel-ip-country') !== 'DE' ? ' (' + word(hdr('x-vercel-ip-country'), 3) + ')' : '') : (process.env.PT_LOCAL ? 'Laptop-Netz (Halle)' : 'unbekannt');
      await record({ t, vid, path: cleanPath(b.path), secs: Math.max(0, Math.min(3600, Math.round(+b.secs || 0))), first: !!b.first, ref: word(b.ref, 40) || 'direkt', dev: ['Handy', 'Tablet', 'Computer'].includes(b.dev) ? b.dev : 'unbekannt', city });
      res.statusCode = 204; res.end(); return;
    }
    if (!(await L.isAdmin(req))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet.' });
    if (action === 'report') { const day = /^\d{4}-\d{2}-\d{2}$/.test(L.q(req, 'day')) ? L.q(req, 'day') : berlin().day; return L.send(res, 200, await report(day)); }
    if (action === 'clear' && req.method === 'POST' && req.headers['x-csrf'] != null) { await clearAll(); return L.send(res, 200, { ok: true }); }
    return L.send(res, 400, { error: 'Unbekannte Aktion.' });
  } catch (e) { return L.send(res, 500, { error: e.message || String(e) }); }
};
// Anmeldungen zählen (Turnierleitung, Team, Presse) – ohne Namen
handler.countLogin = (role) => record({ t: 'login', role: ['admin', 'team', 'press'].includes(role) ? role : 'admin' }).catch(() => {});
module.exports = handler;
