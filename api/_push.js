// Push-Benachrichtigungen für Zuschauer, die einem Team folgen.
// Ausgelöst, wenn ein neuer Turnierstand gespeichert wird (Turnierleitung oder Laptop-Abgleich):
//   ⏰ „Gleich seid ihr dran“ (wenn zwei Spiele vorher angepfiffen wird) · ▶️ Anpfiff · ⚽ Tor · 🏁 Abpfiff
// Gespeichert wird nur die Push-Adresse des Browsers und welche Teams er verfolgt – keine Namen.
const crypto = require('crypto');
const L = require('./_lib');
const PT = require('../js/core.js');

const HKEY = 'pt:push', FILE_KEY = 'turnier/push.json', VAPID_KEY = 'turnier/vapid.json';
const FRESH = 5 * 60e3; // ältere Ereignisse (z. B. nach einem Funkloch des Laptops) nicht mehr melden
const isRedis = () => L.mode() === 'redis' || L.mode() === 'redis-tcp';
const idOf = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 24);
let wp = null; try { wp = require('web-push'); } catch (e) { wp = null; }

/* ---------- Abonnements ---------- */
async function getSubs() {
  if (isRedis()) {
    const r = await L.redis(['HGETALL', HKEY]); const out = {};
    if (Array.isArray(r)) { for (let i = 0; i + 1 < r.length; i += 2) { try { out[r[i]] = JSON.parse(r[i + 1]); } catch (e) { /* kaputt */ } } }
    else if (r && typeof r === 'object') Object.entries(r).forEach(([k, v]) => { try { out[k] = JSON.parse(v); } catch (e) { /* kaputt */ } });
    return out;
  }
  try { return JSON.parse((await L.rawGet(FILE_KEY)) || '{}') || {}; } catch (e) { return {}; }
}
async function putSub(id, v) {
  if (isRedis()) return L.redis(['HSET', HKEY, id, JSON.stringify(v)]);
  const all = await getSubs(); all[id] = v; return L.rawSet(FILE_KEY, JSON.stringify(all));
}
async function delSub(id) {
  if (isRedis()) return L.redis(['HDEL', HKEY, id]);
  const all = await getSubs(); delete all[id]; return L.rawSet(FILE_KEY, JSON.stringify(all));
}

/* ---------- Schlüssel (werden beim ersten Mal erzeugt und gespeichert) ---------- */
let vapidCache = null;
async function vapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  if (vapidCache) return vapidCache;
  let v = null; try { v = JSON.parse((await L.rawGet(VAPID_KEY)) || 'null'); } catch (e) { v = null; }
  if (!v || !v.publicKey) {
    if (!wp) return null;
    await L.rawSet(VAPID_KEY, JSON.stringify(wp.generateVAPIDKeys()));
    v = JSON.parse(await L.rawGet(VAPID_KEY)); // falls zwei gleichzeitig erzeugt haben: der gespeicherte gilt
  }
  return (vapidCache = v);
}
const SUBJECT = () => process.env.VAPID_SUBJECT || 'https://pg-oberstufenfussballturnier.vercel.app';

async function sendTo(entries, payload) {
  const keys = await vapid(); if (!wp || !keys || !entries.length) return 0;
  let ok = 0;
  await Promise.allSettled(entries.map(async ([id, s]) => {
    try {
      await wp.sendNotification(s.sub, JSON.stringify(payload), { TTL: 600, urgency: 'high', timeout: 5000, vapidDetails: { subject: SUBJECT(), publicKey: keys.publicKey, privateKey: keys.privateKey } });
      ok++;
    } catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await delSub(id).catch(() => {}); }
  }));
  return ok;
}

/* ---------- Was ist neu? ---------- */
function messages(prev, next) {
  if (!next || L.planHidden(next.settings || {})) return [];
  const now = Date.now(), H = PT.make(PT.normalize(JSON.parse(JSON.stringify(next))));
  const before = new Map(((prev && prev.matches) || []).map((m) => [m.id, m]));
  const real = H.sorted().filter((m) => m.stage !== 'test');
  const out = [];
  const name = (m, side) => { const t = H.teamOf(m, side); return t ? t.name : H.phOf(m, side); };
  const ids = (m) => ['h', 'a'].map((s) => H.teamOf(m, s)).filter(Boolean).map((t) => t.id);
  const url = (m) => '/spiel/' + m.no;
  const label = (m) => 'Spiel ' + m.no + ' · ' + (m.label || PT.STAGES[m.stage].l);
  real.forEach((m, idx) => {
    const pm = before.get(m.id) || { status: 'scheduled', events: [] };
    const sc = H.sc(m), pair = name(m, 'h') + ' ' + sc.h + ':' + sc.a + ' ' + name(m, 'a');
    if (pm.status === 'scheduled' && m.status === 'live' && now - (m.startedAt || now) < FRESH) {
      out.push({ teams: ids(m), key: 'k' + m.id, p: { title: '▶️ Anpfiff: ' + name(m, 'h') + ' – ' + name(m, 'a'), body: label(m) + ' läuft jetzt.', url: url(m), tag: 'm' + m.id } });
      const soon = real[idx + 2];
      if (soon && soon.status === 'scheduled') out.push({ teams: ids(soon), key: 's' + soon.id, p: { title: '⏰ Gleich seid ihr dran!', body: label(soon) + ': ' + name(soon, 'h') + ' – ' + name(soon, 'a') + ' · ca. ' + H.expTime(soon) + ' Uhr. Bitte zum Spielfeldrand.', url: url(soon), tag: 's' + soon.id } });
    }
    const seen = new Set((pm.events || []).map((e) => e.id));
    m.events.filter((e) => !seen.has(e.id) && (e.type === 'goal' || e.type === 'og') && now - (e.at || 0) < FRESH).forEach((e) => {
      const t = H.teamOf(m, e.side), x = H.P(e.player);
      out.push({ teams: ids(m), key: 'g' + e.id, p: { title: (e.type === 'og' ? '⚽ Eigentor – Tor für ' : '⚽ Tor für ') + (t ? t.name : 'das Team') + '!', body: pair + (x ? ' · ' + x.p.name : '') + (e.min ? ' (' + e.min + '′)' : ''), url: url(m), tag: 'm' + m.id } });
    });
    if (pm.status === 'live' && m.status === 'done' && now - (m.endedAt || now) < FRESH) {
      out.push({ teams: ids(m), key: 'f' + m.id, p: { title: '🏁 Abpfiff: ' + pair, body: label(m) + (m.pen && (m.pen.h || m.pen.a) ? ' · n. E. ' + m.pen.h + ':' + m.pen.a : ''), url: url(m), tag: 'm' + m.id } });
    }
  });
  return out;
}
// Nach dem Speichern aufrufen: schickt jedem Abonnenten die Meldungen seiner Teams (jede nur einmal)
async function notify(prev, next) {
  const msgs = messages(prev, next); if (!msgs.length || !wp) return 0;
  const subs = Object.entries(await getSubs()); let n = 0;
  for (const msg of msgs) n += await sendTo(subs.filter(([, s]) => (s.teams || []).some((t) => msg.teams.includes(t))), msg.p);
  return n;
}
async function clearAll() { if (isRedis()) return L.redis(['DEL', HKEY]); return L.rawSet(FILE_KEY, '{}'); }
module.exports = { clearAll, notify, messages, getSubs, putSub, delSub, idOf, vapid, sendTo, available: () => !!wp };
