// Kurzer Spielbericht für den Insta-Post (Presse / Turnierleitung)
//   GET  ?id=m5            Bericht holen (wird beim ersten Mal geschrieben und gespeichert)
//   POST ?id=m5&action=neu  neu schreiben lassen
// Mit ANTHROPIC_API_KEY (Vercel → Settings → Environment Variables) schreibt Claude den Text,
// ohne Schlüssel oder ohne Internet entsteht ein automatischer Text aus den Spieldaten.
const crypto = require('crypto');
const L = require('./_lib');
const PT = require('../js/core.js');

const MODEL = 'claude-opus-5-5';
const keyOf = (id) => 'turnier/bericht/' + id + '.json';

function facts(S, m) {
  const H = PT.make(S), r = H.sc(m);
  const name = (side) => { const t = H.teamOf(m, side); return t ? t.name : H.phOf(m, side); };
  const ev = m.events.slice().sort((a, b) => (a.min || 0) - (b.min || 0) || (a.at || 0) - (b.at || 0)).map((e) => {
    const x = H.P(e.player);
    return { minute: e.min || null, art: { goal: 'Tor', og: 'Eigentor', yellow: 'Gelbe Karte', red: '2-Minuten-Strafe' }[e.type], fuer: name(e.side), spieler: x ? x.p.name : null, spielerTeam: x ? x.t.name : null };
  });
  return {
    spiel: H.isTest(m) ? 'Testspiel' : 'Spiel ' + m.no + ' · ' + (m.label || PT.STAGES[m.stage].l),
    runde: PT.STAGES[m.stage].l,
    heim: name('h'), gast: name('a'), tore: { heim: r.h, gast: r.a },
    elfmeterschiessen: m.pen && (m.pen.h || m.pen.a) ? { heim: m.pen.h, gast: m.pen.a } : null,
    spielzeitMinuten: H.durOf ? H.durOf(m) : null,
    ereignisse: ev
  };
}
const sigOf = (f) => crypto.createHash('sha1').update(JSON.stringify(f)).digest('hex').slice(0, 16);

// Ohne KI: ein ordentlicher Text aus den Daten
function plain(f) {
  const { heim, gast } = f, h = f.tore.heim, a = f.tore.gast;
  const goals = {};
  f.ereignisse.filter((e) => e.art === 'Tor' && e.spieler).forEach((e) => { goals[e.spieler] = (goals[e.spieler] || 0) + 1; });
  const top = Object.entries(goals).sort((x, y) => y[1] - x[1])[0];
  let s;
  if (f.elfmeterschiessen) { const w = f.elfmeterschiessen.heim > f.elfmeterschiessen.gast ? heim : gast; s = `${heim} und ${gast} trennen sich nach regulärer Spielzeit ${h}:${a} – im Elfmeterschießen setzt sich ${w} mit ${Math.max(f.elfmeterschiessen.heim, f.elfmeterschiessen.gast)}:${Math.min(f.elfmeterschiessen.heim, f.elfmeterschiessen.gast)} durch!`; }
  else if (h === a) s = h ? `Packendes ${h}:${a}-Unentschieden zwischen ${heim} und ${gast} – hier wollte keiner verlieren!` : `${heim} und ${gast} trennen sich torlos 0:0 – beide Abwehrreihen standen sicher.`;
  else { const w = h > a ? heim : gast, l = h > a ? gast : heim, d = Math.abs(h - a); s = d >= 3 ? `Deutliche Sache: ${w} gewinnt ${Math.max(h, a)}:${Math.min(h, a)} gegen ${l}.` : `${w} holt sich den ${Math.max(h, a)}:${Math.min(h, a)}-Sieg gegen ${l}.`; }
  if (top && top[1] >= 2) s += ` ${top[0]} trifft ${top[1] === 2 ? 'doppelt' : top[1] + '-mal'}.`;
  else if (top) s += ` Unter anderem trifft ${top[0]}.`;
  return s;
}

async function ai(f) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch (e) { return null; }
  const client = new Anthropic({ timeout: 45000, maxRetries: 1 });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: 'Du schreibst kurze Spielberichte für den Instagram-Kanal der SMV (Schülermitverantwortung) des Parler-Gymnasiums Schwäbisch Gmünd zum Oberstufen-Fußballturnier in der Sporthalle. ' +
      'Schreibe 2 bis 3 kurze Sätze auf Deutsch, locker und sportlich wie ein Sportkanal, positiv und fair gegenüber beiden Teams. ' +
      'Nutze nur die Fakten aus den Spieldaten – erfinde keine Spielszenen, Zitate, Zuschauerzahlen oder Tabellenplätze. Nenne Torschützen mit Namen, wenn sie in den Daten stehen. ' +
      'Eigentore und Strafen nur sachlich erwähnen, niemanden bloßstellen. Höchstens zwei passende Emojis, keine Hashtags, keine Anführungszeichen um den ganzen Text. Gib nur den Bericht aus.',
    messages: [{ role: 'user', content: 'Spieldaten:\n' + JSON.stringify(f, null, 1) }]
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return text || null;
}

module.exports = async (req, res) => {
  try {
    if (!(L.isPress(req) || await L.isAdmin(req))) return L.send(res, 401, { error: 'Bitte anmelden.' });
    const id = L.q(req, 'id');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return L.send(res, 400, { error: 'Ungültiges Spiel.' });
    const S = await L.readState();
    const m = (S.matches || []).find((x) => x.id === id);
    if (!m) return L.send(res, 404, { error: 'Spiel nicht gefunden.' });
    const f = facts(S, m), sig = sigOf(f);
    const force = req.method === 'POST' && L.q(req, 'action') === 'neu';
    if (force && req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    if (!force) {
      try { const c = JSON.parse((await L.rawGet(keyOf(id))) || 'null'); if (c && c.sig === sig && c.text) return L.send(res, 200, c); } catch (e) { /* neu schreiben */ }
    }
    let text = null, source = 'auto', err = '';
    try { text = await ai(f); if (text) source = 'ki'; } catch (e) { err = e.message || String(e); }
    if (!text) text = plain(f);
    const out = { sig, text, source, at: Date.now(), hint: source === 'ki' ? '' : (process.env.ANTHROPIC_API_KEY ? 'KI gerade nicht erreichbar – automatischer Text.' + (err ? ' (' + err.slice(0, 120) + ')' : '') : 'Automatischer Text (für KI-Berichte ANTHROPIC_API_KEY in Vercel eintragen).') };
    // Nur speichern, wenn es ein KI-Text ist (oder gar keine KI eingerichtet) – sonst beim nächsten Mal erneut versuchen
    if (source === 'ki' || !process.env.ANTHROPIC_API_KEY) { try { await L.rawSet(keyOf(id), JSON.stringify(out)); } catch (e) { /* trotzdem ausliefern */ } }
    return L.send(res, 200, out);
  } catch (e) {
    return L.send(res, e.status || 500, { error: e.message || String(e) });
  }
};
