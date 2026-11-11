// Teameditor: jedes Team pflegt bis zur Frist (Standard 20.12., 20:00 Uhr) sein eigenes Team.
//   Team (Cookie pt_t):  GET ?action=me · POST ?action=save (alles in einem Schritt: Felder, Logo, Teambild, Hymne) · POST ?action=logout
//   Hymne abspielen:     GET ?action=hymn&id=t1   (eigenes Team oder Turnierleitung)
//   Turnierleitung:      GET ?action=access · POST ?action=access-new {id} · POST ?action=access-del {id} · GET ?action=hymns
// Die Gruppe kann ein Team nicht ändern – die legt nur die Turnierleitung fest.
const crypto = require('crypto');
let L = null, initErr = null;
try { L = require('./_lib'); } catch (e) { initErr = e; }

const MAX_PLAYERS = 12, MIN_PLAYERS = 5, MAX_HYMN = 1024 * 1024, MAX_IMG = 1.5 * 1024 * 1024;
const hymnKey = (id) => 'turnier/hymn-' + id + '.json';
function sniffAudio(b) {
  if (b.length < 12) return null;
  if (b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE') return 'audio/wav';
  if (b.slice(4, 8).toString() === 'ftyp') return 'audio/mp4';
  if (b.slice(0, 4).toString() === 'OggS') return 'audio/ogg';
  return null;
}
async function hymnMeta(id) { try { const h = JSON.parse((await L.rawGet(hymnKey(id))) || 'null'); return h && h.b64 ? { name: h.name, size: h.size, at: h.at } : null; } catch (e) { return null; } }
const err = (status, msg) => Object.assign(new Error(msg), { status });
const fmtBerlin = (ms) => new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(', ', ', ') + ' Uhr';

// Änderung am Turnierstand: lesen, ändern, als neue Version speichern
async function changeState(fn) {
  const cur = await L.readState();
  const out = fn(cur);
  const next = L.cleanState(cur); next.rev = (cur.rev || 0) + 1; next.updated = Date.now();
  await L.writeState(next);
  return out;
}
function publicTeam(t) { return { id: t.id, name: t.name, short: t.short, group: t.group, color: t.color, logo: t.logo, photo: t.photo, players: t.players.map((p) => ({ id: p.id, name: p.name, no: p.no })) }; }

function cleanInput(b, team) {
  const name = String(b.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 30) throw err(400, 'Der Teamname muss 2 bis 30 Zeichen lang sein.');
  const short = String(b.short || '').trim().toUpperCase();
  if (!/^[A-Z0-9ÄÖÜ]{2,3}$/.test(short)) throw err(400, 'Das Kürzel muss 2 bis 3 Zeichen haben (Buchstaben oder Zahlen), z. B. DYN oder A26.');
  const color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? String(b.color) : team.color;
  const list = Array.isArray(b.players) ? b.players : [];
  if (list.length > MAX_PLAYERS) throw err(400, 'Höchstens ' + MAX_PLAYERS + ' Spieler/innen pro Team.');
  if (list.length < MIN_PLAYERS) throw err(400, 'Bitte mindestens ' + MIN_PLAYERS + ' Spieler/innen eintragen.');
  const known = new Map(team.players.map((p) => [p.id, p])), nos = new Set();
  const players = list.map((p, i) => {
    const n = String((p && p.name) || '').replace(/\s+/g, ' ').trim();
    if (!n) throw err(400, 'Zeile ' + (i + 1) + ': Bitte einen Vornamen eintragen (oder die Zeile löschen).');
    if (n.length > 20 || !/^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž][A-Za-zÀ-ÖØ-öø-ÿĀ-ž .'-]*$/.test(n)) throw err(400, 'Zeile ' + (i + 1) + ': „' + n + '“ – bitte nur den Vornamen eintragen (Buchstaben, höchstens 20 Zeichen).');
    let no = p && p.no !== '' && p.no != null ? Number(p.no) : null;
    if (no != null && (!Number.isInteger(no) || no < 0 || no > 99)) throw err(400, 'Zeile ' + (i + 1) + ': Die Rückennummer muss zwischen 0 und 99 liegen.');
    if (no != null) { if (nos.has(no)) throw err(400, 'Die Rückennummer ' + no + ' ist doppelt vergeben.'); nos.add(no); }
    const id = p && known.has(p.id) ? p.id : 'p' + crypto.randomBytes(4).toString('hex');
    return { id, name: n, no };
  });
  return { name, short, color, players };
}

module.exports = async (req, res) => {
  if (initErr) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify({ error: 'Start fehlgeschlagen: ' + initErr.message })); return; }
  try {
    if (!L.mode()) return L.send(res, 503, { error: 'Der Speicher ist noch nicht eingerichtet.' });
    const action = L.q(req, 'action');
    const admin = await L.isAdmin(req);
    const tid = await L.teamOf(req);

    // ---- Hymne abspielen (eigenes Team oder Turnierleitung) ----
    if (req.method === 'GET' && action === 'hymn') {
      const id = L.q(req, 'id');
      if (!(admin || (tid && tid === id))) return L.send(res, 401, { error: 'Bitte anmelden.' });
      const h = JSON.parse((await L.rawGet(hymnKey(id))) || 'null');
      if (!h || !h.b64) { res.statusCode = 404; res.end(); return; }
      const buf = Buffer.from(h.b64, 'base64');
      res.statusCode = 200; res.setHeader('Content-Type', h.type); res.setHeader('X-Name', encodeURIComponent(h.name || 'Torhymne')); res.setHeader('Cache-Control', 'no-store');
      res.end(buf); return;
    }

    // ---- Turnierleitung: Zugänge verwalten ----
    if (action === 'access' || action === 'access-new' || action === 'access-del' || action === 'hymns') {
      if (!admin) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet.' });
      if (req.method === 'GET' && action === 'access') {
        const auth = await L.getTeamAuth(), out = {}, ids = new Set(((await L.readState()).teams || []).map((t) => t.id));
        // Zugänge gelöschter Teams aufräumen
        const stale = Object.keys(auth).filter((id) => !ids.has(id)); if (stale.length) { stale.forEach((id) => delete auth[id]); await L.setTeamAuth(auth); }
        Object.entries(auth).forEach(([id, v]) => { if (v && v.pw) out[id] = { pw: v.pw, at: v.at || 0 }; });
        return L.send(res, 200, { access: out });
      }
      if (req.method === 'GET' && action === 'hymns') {
        const S = await L.readState(), out = {};
        for (const t of S.teams || []) { const m = await hymnMeta(t.id); if (m) out[t.id] = m; }
        return L.send(res, 200, { hymns: out });
      }
      if (req.method !== 'POST' || req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
      const b = await L.readJson(req); const id = String(b.id || '');
      const S = await L.readState(), auth = await L.getTeamAuth();
      if (action === 'access-del') { delete auth[id]; await L.setTeamAuth(auth); return L.send(res, 200, { ok: true }); }
      if (!(S.teams || []).some((t) => t.id === id)) return L.send(res, 404, { error: 'Team nicht gefunden.' });
      const taken = new Set(Object.entries(auth).filter(([k]) => k !== id).map(([, v]) => String(v.pw || '').toLowerCase()));
      taken.add('smv_insta');
      let pw = L.newTeamPassword(taken);
      while (await L.checkPassword(pw)) pw = L.newTeamPassword(taken);
      auth[id] = { pw, at: Date.now() }; await L.setTeamAuth(auth);
      return L.send(res, 200, { ok: true, pw });
    }

    // ---- ab hier: angemeldetes Team ----
    if (action === 'logout') { await L.setTeamSession(res, null); return L.send(res, 200, { ok: true }); }
    if (!tid) return L.send(res, 401, { error: 'Bitte mit dem Team-Passwort anmelden.' });
    const S = await L.readState();
    const team = (S.teams || []).find((t) => t.id === tid);
    if (!team) return L.send(res, 404, { error: 'Dieses Team gibt es nicht mehr. Bitte bei der SMV melden.' });
    const until = L.teamDeadline(S.settings || {}), open = Date.now() < until;

    if (!open) return L.send(res, 410, { error: 'Der Teameditor ist seit ' + fmtBerlin(until) + ' geschlossen. Bei Fragen meldet euch bei der SMV.', closed: true });
    if (req.method === 'GET' && action === 'me') {
      return L.send(res, 200, { team: Object.assign(publicTeam(team), L.planHidden(S.settings) ? { group: '' } : {}), groupsAt: (S.settings || {}).planPublicAt || L.PLAN_PUBLIC, open, until, untilText: (S.settings || {}).teamEditUntil || L.TEAM_DEADLINE, hymn: await hymnMeta(tid), maxPlayers: MAX_PLAYERS, minPlayers: MIN_PLAYERS, maxHymn: MAX_HYMN });
    }
    if (req.method !== 'POST' || req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    if (!open) return L.send(res, 403, { error: 'Die Frist ist abgelaufen – Änderungen gehen jetzt nur noch über die SMV.' });

    // Speichern: Felder, Logo, Teambild und Hymne in einem Schritt – nur wenn alles Pflichtige da ist
    if (action === 'save') {
      const b = await L.readJson(req, 6 * 1024 * 1024);
      const v = cleanInput(b, team);
      const file = (x, max, what) => { if (!x || typeof x !== 'object' || !x.b64) return null; const buf = Buffer.from(String(x.b64), 'base64'); if (buf.length > max) throw err(400, what + ' ist zu groß.'); return buf; };
      const logoBuf = file(b.logo, MAX_IMG, 'Das Logo'), photoBuf = file(b.photo, MAX_IMG, 'Das Teambild'), hymnBuf = file(b.hymn, MAX_HYMN, 'Die Hymne (höchstens 1 MB)');
      if (logoBuf && !L.sniff(logoBuf)) throw err(400, 'Das Logo muss ein JPG-, PNG- oder WebP-Bild sein.');
      if (photoBuf && !L.sniff(photoBuf)) throw err(400, 'Das Teambild muss ein JPG-, PNG- oder WebP-Bild sein.');
      const hymnType = hymnBuf ? sniffAudio(hymnBuf) : null;
      if (hymnBuf && !hymnType) throw err(400, 'Die Hymne muss eine Audiodatei sein (MP3, M4A, WAV oder OGG).');
      const oldHymn = await hymnMeta(tid);
      const missing = [];
      if (!logoBuf && !team.logo) missing.push('Teamlogo');
      if (!hymnBuf && !oldHymn) missing.push('Torhymne');
      if (missing.length) throw err(400, 'Es fehlt noch: ' + missing.join(', ') + '.');
      // erst Dateien speichern, dann den Turnierstand
      const logo = logoBuf ? await L.putImage(logoBuf, L.sniff(logoBuf)) : team.logo;
      const photo = photoBuf ? await L.putImage(photoBuf, L.sniff(photoBuf)) : (b.photo === 'remove' ? '' : team.photo);
      if (hymnBuf) {
        const name = String((b.hymn && b.hymn.name) || 'Torhymne').replace(/[\r\n]/g, ' ').slice(0, 120);
        await L.rawSet(hymnKey(tid), JSON.stringify({ name, type: hymnType, size: hymnBuf.length, at: Date.now(), b64: hymnBuf.toString('base64') }));
      }
      const t2 = await changeState((cur) => { const x = cur.teams.find((y) => y.id === tid); if (!x) throw err(404, 'Team nicht gefunden.'); Object.assign(x, v, { logo, photo }); return publicTeam(x); });
      return L.send(res, 200, { ok: true, team: Object.assign(t2, L.planHidden(S.settings) ? { group: '' } : {}), hymn: await hymnMeta(tid) });
    }
    return L.send(res, 400, { error: 'Unbekannte Aktion.' });
  } catch (e) {
    return L.send(res, e.status || 500, { error: e.message || String(e) });
  }
};
