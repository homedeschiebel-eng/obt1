// Voting „Spieler des Turniers“
//   GET  ?action=results   Stimmen der aktuellen Runde (öffentlich, auch für den Laptop abrufbar)
//   POST {player, voter}    eine Stimme abgeben – nur solange das Voting offen ist, eine pro Gerät
// Mit Redis wird atomar gezählt (viele gleichzeitige Stimmen gehen nicht verloren).
const crypto = require('crypto');
const L = require('./_lib');

const isRedis = () => L.mode() === 'redis' || L.mode() === 'redis-tcp';
const roundKey = (r) => String(r || 'r1').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || 'r1';
async function readJsonKey(k) { try { const t = await L.rawGet(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
let stateCache = null;
async function settings() { if (stateCache && Date.now() - stateCache.t < 3000) return stateCache.s; const s = await L.readState(); stateCache = { t: Date.now(), s }; return s; }
const hits = new Map();
function limited(ip) { const now = Date.now(), h = (hits.get(ip) || []).filter((x) => now - x < 60e3); h.push(now); hits.set(ip, h); return h.length > 40; }

async function results(round) {
  if (isRedis()) {
    const raw = await L.redis(['HGETALL', 'pt:votes:' + round]) || [];
    const counts = {}; if (Array.isArray(raw)) for (let i = 0; i < raw.length; i += 2) counts[raw[i]] = +raw[i + 1] || 0; else Object.assign(counts, raw);
    const voters = +(await L.redis(['SCARD', 'pt:voters:' + round])) || 0;
    return { counts, voters };
  }
  const d = (await readJsonKey('turnier/votes-' + round + '.json')) || { counts: {}, voters: {} };
  return { counts: d.counts || {}, voters: Object.keys(d.voters || {}).length };
}

module.exports = async (req, res) => {
  const CORS = { 'Access-Control-Allow-Origin': '*' };
  try {
    if (!L.mode()) return L.send(res, 503, { error: 'Der Speicher ist noch nicht eingerichtet.' });
    const S = await settings(); const st = S.settings || {}; const round = roundKey(st.voteRound);
    if (req.method === 'GET') {
      const r = await results(round);
      return L.send(res, 200, Object.assign({ round, status: st.vote || 'off' }, r), Object.assign({ 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'public, max-age=2' }, CORS));
    }
    if (req.method === 'OPTIONS') { res.statusCode = 204; Object.entries(Object.assign({ 'Access-Control-Allow-Methods': 'GET' }, CORS)).forEach(([k, v]) => res.setHeader(k, v)); res.end(); return; }
    if (req.method !== 'POST') return L.send(res, 405, { error: 'Nicht erlaubt.' });
    if (req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    if (st.vote !== 'open') return L.send(res, 409, { error: 'Das Voting ist gerade nicht geöffnet.' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return L.send(res, 429, { error: 'Zu viele Stimmen in kurzer Zeit. Bitte gleich noch einmal versuchen.' });
    const b = await L.readJson(req);
    const player = String(b.player || '');
    const ok = (S.teams || []).some((t) => (t.players || []).some((p) => p.id === player));
    if (!ok) return L.send(res, 400, { error: 'Diese Person steht nicht zur Wahl.' });
    const voter = crypto.createHash('sha256').update(String(b.voter || '') + '|' + round).digest('hex').slice(0, 32);
    if (!/^[A-Za-z0-9_-]{12,64}$/.test(String(b.voter || ''))) return L.send(res, 400, { error: 'Ungültige Anfrage.' });
    if (isRedis()) {
      const added = +(await L.redis(['SADD', 'pt:voters:' + round, voter]));
      if (!added) return L.send(res, 409, { error: 'Von diesem Gerät wurde schon abgestimmt.', already: true });
      await L.redis(['HINCRBY', 'pt:votes:' + round, player, '1']);
    } else {
      const k = 'turnier/votes-' + round + '.json';
      const d = (await readJsonKey(k)) || { counts: {}, voters: {} };
      if (d.voters[voter]) return L.send(res, 409, { error: 'Von diesem Gerät wurde schon abgestimmt.', already: true });
      d.voters[voter] = 1; d.counts[player] = (d.counts[player] || 0) + 1;
      await L.rawSet(k, JSON.stringify(d));
    }
    return L.send(res, 200, { ok: true });
  } catch (e) {
    return L.send(res, 500, { error: e.message || String(e) });
  }
};
