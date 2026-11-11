// Anmeldung der Turnierleitung: ?action=me | check | setup | login | logout | password
// Presse (Insta-Posts): ?action=press-me | press-login | press-logout
let L = null, initErr = null;
try { L = require('./_lib'); } catch (e) { initErr = e; }

module.exports = async (req, res) => {
  if (initErr) {
    res.statusCode = 500; res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Die Turnier-Funktion konnte nicht starten: ' + initErr.message + '. Meist fehlt package.json im Repository oder das Deployment ist fehlgeschlagen (Vercel → Deployments → Build Logs).', startup: true }));
    return;
  }
  const action = L.q(req, 'action');
  try {
    if (action === 'me') {
      const a = await L.authInfo();
      return L.send(res, 200, { version: L.VERSION, storage: L.mode(), passwordSet: !!a.source, passwordSource: a.source, loggedIn: await L.isAdmin(req), env: L.envNames(), local: !!process.env.PT_LOCAL && L.mode() === 'file', vercelEnv: process.env.VERCEL_ENV || '', deployment: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) });
    }
    if (action === 'press-me') return L.send(res, 200, { ok: L.isPress(req) || await L.isAdmin(req) });
    if (action === 'check') return L.send(res, 200, Object.assign({ version: L.VERSION }, await L.check()));
    if (req.method !== 'POST') return L.send(res, 405, { error: 'Nicht erlaubt.' });
    if (req.headers['x-csrf'] == null) return L.send(res, 403, { error: 'Ungültige Anfrage.' });
    if (action === 'logout') { await L.setSession(res, false); return L.send(res, 200, { ok: true }); }

    const b = await L.readJson(req);
    const pass = String(b.pass || '');
    if (action === 'press-logout') { L.setPressSession(res, false); return L.send(res, 200, { ok: true }); }
    if (action === 'press-login') {
      if (L.isLocked(req)) return L.send(res, 429, { error: 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' });
      if (!L.checkPress(pass)) { await new Promise((r) => setTimeout(r, 700)); const locked = L.noteFail(req); return L.send(res, locked ? 429 : 401, { error: locked ? 'Zu viele Fehlversuche. Bitte 15 Minuten warten.' : 'Das Passwort stimmt nicht.' }); }
      L.clearFails(req); L.setPressSession(res, true); return L.send(res, 200, { ok: true });
    }
    if (action === 'setup') {
      // Nur möglich, solange noch kein Passwort existiert
      if (!L.mode()) return L.send(res, 503, { error: 'Zuerst muss ein Speicher mit dem Vercel-Projekt verbunden sein.' });
      if ((await L.authInfo()).source) return L.send(res, 409, { error: 'Es ist bereits ein Passwort festgelegt. Bitte anmelden.' });
      if (pass.length < 6) return L.send(res, 400, { error: 'Das Passwort muss mindestens 6 Zeichen haben.' });
      await L.setPassword(pass); await L.setSession(res, true);
      return L.send(res, 200, { ok: true });
    }
    if (action === 'login') {
      if (!(await L.authInfo()).source) return L.send(res, 409, { error: 'Es ist noch kein Passwort festgelegt.', needSetup: true });
      if (L.isLocked(req)) return L.send(res, 429, { error: 'Zu viele Fehlversuche. Die Anmeldung ist für 15 Minuten gesperrt.' });
      // Presse-Passwort im selben Anmeldefeld → weiter zu den Insta-Posts
      const okAdmin = await L.checkPassword(pass);
      if (!okAdmin && L.checkPress(pass)) { L.clearFails(req); L.setPressSession(res, true); return L.send(res, 200, { ok: true, role: 'press' }); }
      // Team-Passwort → eigener Teameditor
      if (!okAdmin) { const tid = await L.findTeamByPassword(pass); if (tid) { L.clearFails(req); const auth = await L.getTeamAuth(); await L.setTeamSession(res, tid, auth[tid].pw); return L.send(res, 200, { ok: true, role: 'team' }); } }
      if (!okAdmin) {
        await new Promise((r) => setTimeout(r, 700));
        const locked = L.noteFail(req);
        return L.send(res, locked ? 429 : 401, { error: locked ? 'Zu viele Fehlversuche. Die Anmeldung ist für 15 Minuten gesperrt.' : 'Das Passwort stimmt nicht.' });
      }
      L.clearFails(req); await L.setSession(res, true);
      return L.send(res, 200, { ok: true });
    }
    if (action === 'password') {
      if (!(await L.isAdmin(req))) return L.send(res, 401, { error: 'Du bist nicht mehr angemeldet.' });
      if ((await L.authInfo()).source === 'env') return L.send(res, 400, { error: 'Das Passwort ist im Vercel-Projekt als ADMIN_PASSWORD festgelegt und kann nur dort geändert werden.' });
      if (pass.length < 6) return L.send(res, 400, { error: 'Das Passwort muss mindestens 6 Zeichen haben.' });
      await L.setPassword(pass); await L.setSession(res, true);
      return L.send(res, 200, { ok: true });
    }
    return L.send(res, 400, { error: 'Unbekannte Aktion.' });
  } catch (e) {
    return L.send(res, 500, { error: e.message || String(e) });
  }
};
