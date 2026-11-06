// Gemeinsame Funktionen für die Turnier-Schnittstelle auf Vercel
// -----------------------------------------------------------------------------
// Speicher (der erste, der eingerichtet ist, wird benutzt):
//   1. Redis (Upstash oder „Redis“ aus dem Vercel Marketplace) – empfohlen für Live-Betrieb.
//      Erkannt werden KV_REST_API_URL/_TOKEN, UPSTASH_REDIS_REST_URL/_TOKEN, REDIS_URL, KV_URL.
//   2. Vercel Blob (öffentlich oder privat) – wie bei der TSB-Seite.
//   3. Lokal (nur beim Testen mit "node dev-server.js"): Ordner .data/
// Zugang Turnierleitung: Passwort beim ersten Öffnen von /turnierleitung festlegen
// oder als Umgebungsvariable ADMIN_PASSWORD setzen (hat dann Vorrang).
// -----------------------------------------------------------------------------
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = '1.2';
const STATE_KEY = 'turnier/state.json';
const SESSION_HOURS = 14;
const START = require('../data/start.json');

/* ---------- Antworten & Anfragen ---------- */
function send(res, status, data, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  Object.keys(h).forEach((k) => res.setHeader(k, h[k]));
  res.end(JSON.stringify(data));
}
function q(req, name) {
  if (req.query && req.query[name] != null) return String(req.query[name]);
  return new URL(req.url, 'http://x').searchParams.get(name) || '';
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Die Daten sind zu groß.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const buf = await readBody(req, limit || 64 * 1024);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch (e) { return {}; }
}

/* ---------- Speicher finden ---------- */
function findEnv(re, ok) {
  const env = process.env;
  const k = Object.keys(env).find((key) => re.test(key) && !/READ_ONLY/i.test(key) && (!ok || ok(env[key] || '')));
  return k ? env[k] : '';
}
// Speicher wird am INHALT der Umgebungsvariablen erkannt – der Name (und ein eigenes Präfix) ist egal.
const ENV = () => Object.entries(process.env).filter(([k, v]) => typeof v === 'string' && v && !/READ_ONLY/i.test(k));
// Redis über HTTP (Upstash): eine https://….upstash.io-Adresse plus passender Token
function redisRest() {
  const e = process.env;
  if ((e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL) && (e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN)) return { url: (e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL).replace(/\/$/, ''), token: e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN };
  const list = ENV();
  const u = list.find(([k, v]) => /^https:\/\/[^/\s]+\.upstash\.io\/?$/i.test(v) || (/(REST_API_URL|REST_URL)$/i.test(k) && /^https:\/\//.test(v)));
  if (!u) return null;
  const prefix = u[0].replace(/(URL)$/i, '');
  const tk = list.find(([k]) => k === prefix + 'TOKEN') || list.find(([k]) => /(REST_API_TOKEN|REST_TOKEN)$/i.test(k));
  return tk ? { url: u[1].replace(/\/$/, ''), token: tk[1] } : null;
}
// Redis über eine normale Verbindung: irgendeine Variable mit redis:// oder rediss://
function redisUrl() {
  const e = process.env, ok = (v) => /^rediss?:\/\//i.test(v || '');
  if (ok(e.REDIS_URL)) return e.REDIS_URL;
  if (ok(e.KV_URL)) return e.KV_URL;
  const hit = ENV().find(([, v]) => ok(v));
  return hit ? hit[1] : null;
}
// Vercel Blob: irgendein Token, der mit vercel_blob_rw_ beginnt, sonst eine Store-ID
function blobCreds() {
  const e = process.env, list = ENV();
  if (/^vercel_blob_rw_/.test(e.BLOB_READ_WRITE_TOKEN || '')) return { token: e.BLOB_READ_WRITE_TOKEN };
  const tok = list.find(([, v]) => /^vercel_blob_rw_/.test(v));
  if (tok) return { token: tok[1] };
  const id = e.BLOB_STORE_ID ? ['BLOB_STORE_ID', e.BLOB_STORE_ID] : list.find(([k, v]) => /STORE_ID$/i.test(k) && /^(store_)?[A-Za-z0-9]{6,}$/.test(v));
  return id ? { storeId: id[1] } : null;
}
function mode() {
  if (redisRest()) return 'redis';
  if (redisUrl()) return 'redis-tcp';
  if (blobCreds()) return 'blob';
  if (!process.env.VERCEL) return 'file';
  return null;
}
// Nur Namen (nie Inhalte) von Variablen, die nach Speicher aussehen – für die Fehlersuche
function envNames() {
  return ENV().filter(([k, v]) => (/redis|kv_|upstash|blob|stor|database|admin_password/i.test(k) || /^(rediss?:\/\/|vercel_blob_rw_|https:\/\/[^/]+\.upstash\.io)/i.test(v)) && !/TLS|CA_STORE/i.test(k)).map(([k]) => k).sort();
}
const DATA_DIR = path.join(__dirname, '..', '.data');

async function restCmd(cmd) {
  const c = redisRest();
  const r = await fetch(c.url, { method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Redis: ' + (j.error || 'Status ' + r.status));
  return j.result;
}
let tcp = null;
async function tcpClient() {
  if (tcp && tcp.isOpen) return tcp;
  const { createClient } = require('redis');
  tcp = createClient({ url: redisUrl(), socket: { connectTimeout: 8000, reconnectStrategy: (n) => (n > 3 ? false : 300) } });
  tcp.on('error', () => {});
  await tcp.connect();
  return tcp;
}
async function redis(cmd) {
  if (mode() === 'redis') return restCmd(cmd);
  const c = await tcpClient();
  return c.sendCommand(cmd.map(String));
}
let blobLib = null;
function blob() { if (!blobLib) blobLib = require('@vercel/blob'); return blobLib; }
// Blob-Stores können öffentlich oder privat sein – wir probieren öffentlich und wechseln bei Bedarf
let blobAccess = process.env.BLOB_ACCESS === 'private' ? 'private' : 'public';
const bopt = (o) => Object.assign({}, blobCreds() || {}, { access: blobAccess }, o);
const accessErr = (e) => /access|private|public/i.test((e && (e.name + ' ' + e.message)) || '') && !/not.?found/i.test(e.message || '');
async function blobPut(name, body, o) {
  try { return await blob().put(name, body, bopt(o)); }
  catch (e) { if (!accessErr(e)) throw e; blobAccess = blobAccess === 'public' ? 'private' : 'public'; return blob().put(name, body, bopt(o)); }
}
async function blobGet(name) {
  const read = async () => { const r = await blob().get(name, bopt({ useCache: false })); return r && r.stream ? Buffer.from(await new Response(r.stream).arrayBuffer()) : null; };
  try { return await read(); }
  catch (e) {
    if (/not.?found/i.test(e.name + ' ' + e.message)) return null;
    if (!accessErr(e)) throw e;
    blobAccess = blobAccess === 'public' ? 'private' : 'public';
    try { return await read(); } catch (x) { if (/not.?found/i.test(x.name + ' ' + x.message)) return null; throw x; }
  }
}
const fileOf = (key) => path.join(DATA_DIR, key.replace(/[^a-z0-9._-]/gi, '_'));
async function rawGet(key) {
  const m = mode();
  if (m === 'redis' || m === 'redis-tcp') return await redis(['GET', 'pt:' + key]);
  if (m === 'blob') { const b = await blobGet(key); return b ? b.toString('utf8') : null; }
  if (m === 'file') return fs.existsSync(fileOf(key)) ? fs.readFileSync(fileOf(key), 'utf8') : null;
  throw new Error('Kein Speicher eingerichtet.');
}
async function rawSet(key, text) {
  const m = mode();
  if (m === 'redis' || m === 'redis-tcp') return redis(['SET', 'pt:' + key, text]);
  if (m === 'blob') return blobPut(key, text, { contentType: 'application/json; charset=utf-8', addRandomSuffix: false, allowOverwrite: true });
  if (m === 'file') { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(fileOf(key), text); return; }
  throw new Error('Kein Speicher eingerichtet.');
}
// Selbsttest: einmal schreiben und lesen
async function check() {
  const out = { storage: mode(), env: envNames(), vercel: !!process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV || '', deployment: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7), write: false, read: false, error: '' };
  if (!out.storage) { out.error = 'Kein Speicher verbunden.'; return out; }
  try { const v = 'ok-' + Date.now(); await rawSet('turnier/check.txt', v); out.write = true; out.read = (await rawGet('turnier/check.txt')) === v; if (!out.read) out.error = 'Geschrieben, aber nicht wieder gelesen.'; }
  catch (e) { out.error = e.message || String(e); }
  return out;
}

/* ---------- Turnierstand ---------- */
async function readState() {
  const text = await rawGet(STATE_KEY);
  if (!text) return Object.assign(JSON.parse(JSON.stringify(START)), { rev: 0 });
  return JSON.parse(text);
}
async function writeState(s) { await rawSet(STATE_KEY, JSON.stringify(s)); }

const cut = (v, max) => Array.from(String(v == null ? '' : v)).slice(0, max).join('');
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const id = (v) => (/^[A-Za-z0-9_-]{1,40}$/.test(String(v || '')) ? String(v) : null);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const img = (v) => {
  v = String(v || '');
  if (/^\/api\/img\?id=[a-f0-9]{16,40}\.(png|jpg|webp)$/.test(v)) return v;
  if (/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\/img\/[a-f0-9.]+(png|jpg|webp)$/i.test(v)) return v;
  return '';
};
const color = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : '#2E6BFF');
// Nur bekannte Felder mit passenden Typen übernehmen
function cleanState(inp) {
  inp = obj(inp); const s = obj(inp.settings);
  const settings = {};
  ['title', 'school', 'season', 'date', 'location', 'sport', 'ticker', 'start', 'koFormat', 'vote', 'voteRound', 'impName', 'impAddr', 'impMail', 'impPhone', 'impExtra', 'impDsb', 'impDelete'].forEach((k) => { settings[k] = cut(s[k], /^(ticker|impAddr|impExtra|impDelete)$/.test(k) ? 600 : 120); });
  settings.day = /^\d{4}-\d{2}-\d{2}$/.test(String(s.day || '')) ? s.day : '';
  ['win', 'draw', 'durGroup', 'durKo', 'durFinal', 'gap', 'koBreak', 'planV'].forEach((k) => { settings[k] = Math.max(0, Math.min(90, num(s[k], 0))); });
  settings.third = !!s.third;
  const teams = arr(inp.teams).slice(0, 40).map((t) => {
    t = obj(t);
    return {
      id: id(t.id) || 't' + crypto.randomBytes(4).toString('hex'), name: cut(t.name, 40), short: cut(t.short, 5), cls: cut(t.cls, 30), group: cut(t.group, 4),
      color: color(t.color), logo: img(t.logo), photo: img(t.photo),
      players: arr(t.players).slice(0, 40).map((p) => ({ id: id(obj(p).id) || 'p' + crypto.randomBytes(4).toString('hex'), no: num(obj(p).no, null), name: cut(obj(p).name, 40) }))
    };
  });
  const STAGES = ['group', 'qf', 'third', 'sf', 'final', 'test'], TYPES = ['goal', 'og', 'yellow', 'red'];
  const matches = arr(inp.matches).slice(0, 120).map((m) => {
    m = obj(m); const c = obj(m.clock);
    return {
      id: id(m.id) || 'm' + crypto.randomBytes(4).toString('hex'), no: num(m.no, 0), time: cut(m.time, 5), day: /^\d{4}-\d{2}-\d{2}$/.test(String(m.day || '')) ? m.day : '',
      stage: STAGES.includes(m.stage) ? m.stage : 'group', label: cut(m.label, 40),
      home: id(m.home), away: id(m.away), homePh: cut(m.homePh, 40), awayPh: cut(m.awayPh, 40),
      status: ['scheduled', 'live', 'done'].includes(m.status) ? m.status : 'scheduled',
      clock: { run: !!c.run, since: num(c.since, null), acc: num(c.acc, 0) },
      startedAt: num(m.startedAt, null), endedAt: num(m.endedAt, null),
      dur: num(m.dur, null), pen: m.pen && typeof m.pen === 'object' ? { h: num(m.pen.h, 0), a: num(m.pen.a, 0) } : null,
      events: arr(m.events).slice(0, 200).map((e) => ({ id: id(obj(e).id) || 'e' + crypto.randomBytes(4).toString('hex'), type: TYPES.includes(obj(e).type) ? e.type : 'goal', side: obj(e).side === 'a' ? 'a' : 'h', player: id(obj(e).player), min: num(obj(e).min, null), at: num(obj(e).at, 0), el: num(obj(e).el, null) }))
    };
  });
  const sponsors = arr(inp.sponsors).slice(0, 60).map((x) => { x = obj(x); return { id: id(x.id) || 's' + crypto.randomBytes(4).toString('hex'), name: cut(x.name, 60), level: cut(x.level, 30), slogan: cut(x.slogan, 140), url: cut(x.url, 200), logo: img(x.logo) }; });
  return { settings, teams, matches, sponsors, current: id(inp.current), controlledBy: inp.controlledBy === 'laptop' ? 'laptop' : '', controlledAt: num(inp.controlledAt, 0) };
}

/* ---------- Bilder ---------- */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
async function putImage(buf, type) {
  const name = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 24) + '.' + EXT[type];
  const m = mode();
  if (m === 'blob') await blobPut('img/' + name, buf, { contentType: type, addRandomSuffix: false, allowOverwrite: true });
  else if (m === 'redis' || m === 'redis-tcp') await redis(['SET', 'pt:img:' + name, buf.toString('base64')]);
  else if (m === 'file') { fs.mkdirSync(path.join(DATA_DIR, 'img'), { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, 'img', name), buf); }
  else throw new Error('Kein Speicher eingerichtet.');
  return '/api/img?id=' + name;
}
async function getImage(name) {
  if (!/^[a-f0-9]{16,40}\.(png|jpg|webp)$/.test(name)) return null;
  const m = mode();
  if (m === 'redis' || m === 'redis-tcp') { const b = await redis(['GET', 'pt:img:' + name]); return b ? Buffer.from(b, 'base64') : null; }
  if (m === 'blob') return blobGet('img/' + name);
  if (m === 'file') { const f = path.join(DATA_DIR, 'img', name); return fs.existsSync(f) ? fs.readFileSync(f) : null; }
  return null;
}

/* ---------- Anmeldung ---------- */
// Passwort: Umgebungsvariable ADMIN_PASSWORD – oder beim ersten Aufruf der Turnierleitung selbst festlegen
// (wird dann nur als scrypt-Hash im Speicher abgelegt).
const AUTH_KEY = 'turnier/auth.json';
let authCache = null;
async function storedAuth() {
  if (authCache && Date.now() - authCache.t < 10000) return authCache.v;
  let v = null;
  try { const txt = mode() ? await rawGet(AUTH_KEY) : null; v = txt ? JSON.parse(txt) : null; } catch (e) { v = null; }
  authCache = { t: Date.now(), v }; return v;
}
async function authInfo() {
  if (process.env.ADMIN_PASSWORD) return { source: 'env', secretBase: 'env|' + process.env.ADMIN_PASSWORD };
  if (mode() === 'file' && process.env.PT_DEV && !(await storedAuth())) return { source: 'local', secretBase: 'local|test' };
  const a = await storedAuth();
  return a && a.hash ? { source: 'stored', secretBase: 'stored|' + a.hash } : { source: null };
}
async function secret() { const a = await authInfo(); return a.source ? crypto.createHash('sha256').update('pt|' + a.secretBase + '|' + (process.env.SESSION_SECRET || '')).digest() : null; }
const hmac = (key, exp) => exp + '.' + crypto.createHmac('sha256', key).update(String(exp)).digest('hex');
function cookies(req) {
  const out = {}; String(req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
async function isAdmin(req) {
  const key = await secret(); if (!key) return false;
  const v = cookies(req).pt_s || ''; const exp = parseInt(v.split('.')[0], 10);
  if (!exp || exp < Date.now()) return false;
  const a = Buffer.from(v), b = Buffer.from(hmac(key, exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function setSession(res, on) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  const val = on ? hmac(await secret(), Date.now() + SESSION_HOURS * 3600e3) : '';
  res.setHeader('Set-Cookie', 'pt_s=' + encodeURIComponent(val) + '; Path=/; HttpOnly; SameSite=Lax' + secure + '; Max-Age=' + (on ? SESSION_HOURS * 3600 : 0));
}
const scrypt = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
async function checkPassword(p) {
  const a = await authInfo();
  const eq = (x, y) => { const A = crypto.createHash('sha256').update(String(x)).digest(), B = crypto.createHash('sha256').update(String(y)).digest(); return crypto.timingSafeEqual(A, B); };
  if (a.source === 'env') return eq(p || '', process.env.ADMIN_PASSWORD);
  if (a.source === 'local') return eq(p || '', 'test');
  if (a.source === 'stored') { const s = await storedAuth(); return eq(scrypt(p || '', s.salt), s.hash); }
  return false;
}
async function setPassword(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  const v = { salt, hash: scrypt(p, salt), at: Date.now() };
  await rawSet(AUTH_KEY, JSON.stringify(v)); authCache = { t: Date.now(), v };
}
// Presse-Zugang (Insta-Posts herunterladen): eigenes Passwort, Umgebungsvariable PRESS_PASSWORD, sonst Standard.
// Die Presse sieht nur öffentliche Ergebnisse – das Passwort hält die Seite nur aus Suchmaschinen und vor Neugierigen fern.
const pressPw = () => process.env.PRESS_PASSWORD || 'SMV_Insta';
const pressKey = () => crypto.createHash('sha256').update('ptp|' + pressPw() + '|' + (process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '')).digest();
function checkPress(p) { const A = crypto.createHash('sha256').update(String(p || '')).digest(), B = crypto.createHash('sha256').update(pressPw()).digest(); return crypto.timingSafeEqual(A, B); }
function isPress(req) {
  const v = cookies(req).pt_p || ''; const exp = parseInt(v.split('.')[0], 10);
  if (!exp || exp < Date.now()) return false;
  const a = Buffer.from(v), b = Buffer.from(hmac(pressKey(), exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function setPressSession(res, on) {
  const secure = process.env.VERCEL ? '; Secure' : '', hours = 24 * 30;
  const val = on ? hmac(pressKey(), Date.now() + hours * 3600e3) : '';
  res.setHeader('Set-Cookie', 'pt_p=' + encodeURIComponent(val) + '; Path=/; HttpOnly; SameSite=Lax' + secure + '; Max-Age=' + (on ? hours * 3600 : 0));
}
// Sperre nach Fehlversuchen (pro Server-Instanz, als Bremse gedacht)
const fails = new Map();
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
function isLocked(req) { const f = fails.get(ipOf(req)); return !!(f && f.until > Date.now()); }
function noteFail(req) { const k = ipOf(req), f = fails.get(k) || { n: 0, until: 0 }; f.n++; if (f.n >= 8) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(k, f); return f.until > Date.now(); }
function clearFails(req) { fails.delete(ipOf(req)); }

module.exports = { rawGet, rawSet, redis, VERSION, send, q, readBody, readJson, mode, envNames, check, readState, writeState, cleanState, sniff, putImage, getImage, authInfo, isAdmin, setSession, checkPassword, setPassword, isLocked, noteFail, clearFails, checkPress, isPress, setPressSession };
