/* Turnierleitung: Anmeldung, Live-Cockpit, Spielplan, Teams, Partner, Einstellungen */
(function () {
  'use strict';
  const { esc, monoHTML, STAGES, LEVELS, EV, uid } = PT;
  const app = document.getElementById('app');
  let S = null, H = null;
  const ui = { tab: 'cockpit', pick: { h: 'goal', a: 'goal' }, cmdMsg: null, save: 'idle', saveMsg: '', needsRender: false };
  try { const t = sessionStorage.getItem('pt-tab'); if (t) ui.tab = t; } catch (e) { /* egal */ }

  /* ---------- Server ---------- */
  async function api(url, opts) {
    opts = opts || {};
    const r = await fetch(url, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opts, { headers: Object.assign({ 'x-csrf': '1' }, opts.headers || {}) }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Status ' + r.status), { status: r.status, data: j });
    return j;
  }

  /* ---------- Änderungen: sofort anzeigen, im Hintergrund speichern ---------- */
  // Jede Änderung ist eine Funktion (S) => {...}. Bei einem Konflikt wird der neueste Stand geladen
  // und die noch nicht gespeicherten Änderungen werden darauf erneut ausgeführt.
  const queue = []; let saving = false, retryTimer = null;
  function act(fn) {
    try { fn(S); } catch (e) { act.err = e.message; toast(e.message, true); return false; }
    queue.push(fn); H = PT.make(S); render(); flush(); return true;
  }
  async function flush() {
    if (saving || !queue.length) return;
    saving = true; ui.save = 'saving'; paintSave();
    const n = queue.length;
    try {
      const j = await api('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: S.rev, state: S }) });
      S.rev = j.rev; S.updated = j.updated; queue.splice(0, n);
      ui.save = queue.length ? 'saving' : 'idle'; ui.saveMsg = '';
    } catch (e) {
      if (e.status === 409 && e.data && e.data.state) {
        S = PT.normalize(e.data.state);
        queue.forEach((fn) => { try { fn(S); } catch (x) { /* veraltet */ } });
        H = PT.make(S); render();
      } else if (e.status === 401) { saving = false; showLogin('Du bist nicht mehr angemeldet. Bitte erneut anmelden – nichts geht verloren, solange diese Seite offen bleibt.'); return; }
      else { ui.save = 'error'; ui.saveMsg = 'Nicht gespeichert: ' + e.message + ' – neuer Versuch in 3 s'; clearTimeout(retryTimer); retryTimer = setTimeout(flush, 3000); saving = false; paintSave(); return; }
    }
    saving = false; paintSave();
    if (queue.length) flush();
  }
  function paintSave() {
    const el = document.getElementById('save'); if (!el) return;
    const txt = { idle: 'Gespeichert · live', saving: 'Wird gespeichert …', error: ui.saveMsg }[ui.save] || '';
    el.className = 'save' + (ui.save === 'error' ? ' err' : ui.save === 'saving' ? ' pending' : '');
    el.textContent = txt;
  }
  // Andere Geräte der Turnierleitung: alle 4 s nach neuem Stand schauen
  setInterval(async () => {
    if (!S || saving || queue.length || document.hidden) return;
    try { const n = await PT.fetchState(true); if (n.rev !== S.rev) { S = n; H = PT.make(S); render(); } } catch (e) { /* später erneut */ }
  }, 4000);

  let toastT = null;
  function toast(msg, bad) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.className = 'toast' + (bad ? ' no' : ''); el.textContent = msg; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800);
  }

  /* ---------- Hilfen für Änderungen ---------- */
  const find = (S, id) => S.matches.find((m) => m.id === id);
  const cur = () => H.M(S.current) || H.live() || H.nextScheduled() || H.sorted()[0] || null;
  function pinTeams(S, m) { const h = PT.make(S); if (!m.home) { const t = h.teamOf(m, 'h'); if (t) m.home = t.id; } if (!m.away) { const t = h.teamOf(m, 'a'); if (t) m.away = t.id; } }
  const elapsedNow = (S, m) => PT.make(S).elapsed(m);

  const A = {
    select: (id) => (S) => { S.current = id; },
    start: (id) => (S) => {
      const m = find(S, id); if (!m) return;
      const other = S.matches.find((x) => x.status === 'live' && x.id !== id);
      if (other) throw new Error('Spiel ' + other.no + ' läuft noch. Bitte zuerst abpfeifen.');
      if (m.status === 'scheduled') { pinTeams(S, m); m.status = 'live'; m.clock = { run: true, since: PT.now(), acc: 0 }; }
      else if (m.status === 'live' && !m.clock.run) { m.clock.run = true; m.clock.since = PT.now(); }
      if (!m.startedAt) m.startedAt = PT.now();
      S.current = id;
    },
    stop: (id) => (S) => { const m = find(S, id); if (!m || !m.clock.run) return; m.clock.acc = elapsedNow(S, m); m.clock.run = false; m.clock.since = null; },
    adjust: (id, sec) => (S) => { const m = find(S, id); if (!m) return; m.clock.acc = Math.max(0, (m.clock.acc || 0) + sec); if (elapsedNow(S, m) < 0) m.clock.acc = 0; },
    reset: (id) => (S) => { const m = find(S, id); if (!m) return; m.clock = { run: false, since: null, acc: 0 }; m.startedAt = null; },
    final: (id) => (S) => { const m = find(S, id); if (!m) return; m.clock.acc = elapsedNow(S, m); m.clock.run = false; m.clock.since = null; m.status = 'done'; m.endedAt = PT.now(); },
    reopen: (id) => (S) => {
      const m = find(S, id); if (!m) return;
      const other = S.matches.find((x) => x.status === 'live' && x.id !== id);
      if (other) throw new Error('Spiel ' + other.no + ' läuft gerade. Bitte zuerst abpfeifen.');
      m.status = 'live'; m.endedAt = null; S.current = id;
    },
    event: (id, type, teamSide, pid, min) => (S) => {
      const m = find(S, id); if (!m) return;
      if (m.status === 'scheduled') throw new Error('Das Spiel ist noch nicht angepfiffen.');
      const side = type === 'og' ? (teamSide === 'h' ? 'a' : 'h') : teamSide;
      m.events.push({ id: uid('e'), type, side, player: pid || null, min, at: PT.now() });
    },
    delEvent: (id, eid) => (S) => { const m = find(S, id); if (m) m.events = m.events.filter((e) => e.id !== eid); },
    undo: (id) => (S) => {
      const m = find(S, id); if (!m || !m.events.length) throw new Error('Nichts zum Zurücknehmen.');
      let last = m.events[0]; m.events.forEach((e) => { if ((e.at || 0) >= (last.at || 0)) last = e; });
      m.events = m.events.filter((e) => e !== last);
    },
    setTeam: (id, key, tid) => (S) => { const m = find(S, id); if (m) m[key] = tid || null; },
    pen: (id, pen) => (S) => { const m = find(S, id); if (m) m.pen = pen; },
    put: (path, val) => (S) => { S[path] = val; }
  };
  function addEvent(type, teamSide, pid) {
    const m = cur(); if (!m) return;
    const t = H.teamOf(m, teamSide), x = H.P(pid);
    if (act(A.event(m.id, type, teamSide, pid, H.minuteNow(m)))) {
      toast(`${EV[type]}${x ? ': ' + x.p.name : ''}${t ? ' (' + t.name + ')' : ''} eingetragen`);
      ui.pick[teamSide] = 'goal'; render();
    }
  }

  /* ---------- Befehlszeile ---------- */
  // Beispiele: „tor spieler 1 team 2“, „tor 7 h“, „gelb 4 gast“, „et 3 team 5“, „start“, „stopp“, „abpfiff“, „zurück“, „nächstes“
  function runCmd(text) {
    const m = cur(); let s = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    if (!m) return { ok: false, text: 'Kein Spiel ausgewählt.' };
    const ACT = [[/^(tor|t|goal)(\s|$)/, 'goal'], [/^(eigentor|et|og)(\s|$)/, 'og'], [/^(gelbe karte|gelb|gk|y)(\s|$)/, 'yellow'], [/^(rote karte|rot|rk|r)(\s|$)/, 'red'],
      [/^(anpfiff|start|los|weiter|play)(\s|$)/, 'start'], [/^(stopp|stop|pause|halt)(\s|$)/, 'stop'], [/^(abpfiff|ende|schluss|aus)(\s|$)/, 'final'],
      [/^(zurück|zurueck|rückgängig|undo|z)(\s|$)/, 'undo'], [/^(nächstes|naechstes|next)(\s|spiel|$)/, 'next']];
    let type = null, rest = s;
    for (const [re, k] of ACT) { const x = s.match(re); if (x) { type = k; rest = s.slice(x[0].length).trim(); break; } }
    if (!type) return { ok: false, text: 'Befehl nicht erkannt. Beispiele: „tor spieler 1 team 2“, „gelb 4 h“, „start“, „stopp“.' };
    try {
      const run = (fn, msg) => (act(fn) ? { ok: true, text: msg } : { ok: false, text: act.err });
      if (type === 'start') return run(A.start(m.id), 'Uhr läuft.');
      if (type === 'stop') return run(A.stop(m.id), 'Uhr angehalten.');
      if (type === 'final') return run(A.final(m.id), 'Abgepfiffen.');
      if (type === 'undo') return run(A.undo(m.id), 'Letzter Eintrag entfernt.');
      if (type === 'next') { const n = H.nextScheduled(m); if (!n) return { ok: false, text: 'Kein weiteres Spiel geplant.' }; return run(A.select(n.id), 'Spiel ' + n.no + ' geladen.'); }
    } catch (e) { return { ok: false, text: e.message }; }
    // Minute: „min 5“ oder „5'“
    let min = null; rest = rest.replace(/(^|\s)(?:min\.?\s*(\d{1,2})|(\d{1,2})\s*['′])(?=\s|$)/, (a, p, x, y) => { min = +(x || y); return ' '; }).trim();
    // Team: Teamname, „h/heim/links“ oder „g/gast/rechts“
    const teams = { h: H.teamOf(m, 'h'), a: H.teamOf(m, 'a') };
    let side = null;
    const names = ['h', 'a'].filter((k) => teams[k]).map((k) => [k, teams[k].name.toLowerCase()]).sort((x, y) => y[1].length - x[1].length);
    for (const [k, n] of names) { const re = new RegExp('(^|\\s)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)'); if (re.test(rest)) { side = k; rest = rest.replace(re, ' ').trim(); break; } }
    if (!side) { const x = rest.match(/(^|\s)(h|heim|links|g|gast|rechts)$/); if (x) { side = /^(h|heim|links)$/.test(x[2]) ? 'h' : 'a'; rest = rest.slice(0, rest.length - x[0].length).trim(); } }
    rest = rest.replace(/^(nr\.?|nummer|#)\s*/, '').trim();
    const pool = (sd) => (teams[sd] ? teams[sd].players.map((p) => ({ p, sd })) : []);
    let cands = side ? pool(side) : [...pool('h'), ...pool('a')], hit = null;
    if (rest) {
      if (/^\d+$/.test(rest)) cands = cands.filter((c) => String(c.p.no) === rest);
      else {
        const ex = cands.filter((c) => c.p.name.toLowerCase() === rest);
        cands = ex.length ? ex : cands.filter((c) => c.p.name.toLowerCase().startsWith(rest)).length ? cands.filter((c) => c.p.name.toLowerCase().startsWith(rest)) : cands.filter((c) => c.p.name.toLowerCase().includes(rest));
      }
      if (!cands.length) return { ok: false, text: `Niemand gefunden für „${rest}“${side ? ' bei ' + teams[side].name : ''}.` };
      if (cands.length > 1) return { ok: false, text: `Mehrdeutig: ${cands.slice(0, 4).map((c) => c.p.name + ' (' + teams[c.sd].name + ')').join(', ')}. Bitte Team dazuschreiben, z. B. „… team 2“ oder „… h“.` };
      hit = cands[0]; side = hit.sd;
    }
    if (!side) return { ok: false, text: 'Für welches Team? Zum Beispiel „tor h“, „tor gast“ oder den Teamnamen dazuschreiben.' };
    try {
      if (!act(A.event(m.id, type, side, hit ? hit.p.id : null, min || H.minuteNow(m)))) return { ok: false, text: act.err };
      return { ok: true, text: `${EV[type]}${hit ? ': ' + hit.p.name : ''} (${teams[side] ? teams[side].name : side}) eingetragen.` };
    } catch (e) { return { ok: false, text: e.message }; }
  }

  /* ---------- Ansichten ---------- */
  const clockHTML = (m, big) => `<span class="clk${big ? ' big' : ''}" data-clock="${m.id}">${H.clockText(m)}</span>`;
  const stateHTML = (m) => `<span class="cstate" data-cstate="${m.id}">${H.clockState(m)}</span>`;
  const teamOptions = (sel, ph) => `<option value="">${ph ? 'Platzhalter: ' + esc(ph) : '– Team wählen –'}</option>` + S.teams.slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}${t.group ? ' (Gr. ' + esc(t.group) + ')' : ''}</option>`).join('');
  const matchLabel = (x) => `${x.no}. · ${H.expTime(x)}${H.delay(x) > 0 ? ' (+' + H.delay(x) + ')' : ''} · ${x.label || STAGES[x.stage].l} – ${H.tName(x, 'h')} vs ${H.tName(x, 'a')}${x.status === 'live' ? ' · LIVE' : x.status === 'done' ? ' · ✓ ' + H.sc(x).h + ':' + H.sc(x).a : ''}`;

  function vCockpit() {
    const list = H.sorted(), m = cur();
    if (!m) return `<div class="empty">Noch keine Spiele. Im Reiter „Spielplan“ kannst du den Spielplan erstellen.</div>`;
    const r = H.sc(m), c = m.clock, canEv = m.status !== 'scheduled';
    const h = H.teamOf(m, 'h'), a = H.teamOf(m, 'a');
    let ctrl;
    if (m.status === 'scheduled') ctrl = `<button class="btn cyan big" data-act="start"${h && a ? '' : ' disabled title="Erst beide Teams wählen"'}>▶ Anpfiff</button>`;
    else if (m.status === 'live') ctrl = (c.run ? `<button class="btn primary big" data-act="stop">❚❚ Uhr anhalten</button>` : `<button class="btn cyan big" data-act="start">▶ Uhr weiter</button>`)
      + `<button class="btn big" data-act="adj" data-s="-10" title="Uhr 10 s zurück (mehr Restzeit)">−10 s</button><button class="btn big" data-act="adj" data-s="10" title="Uhr 10 s vor (weniger Restzeit)">+10 s</button>`
      + (c.run ? '' : `<button class="btn big" data-act="reset" data-confirm="Uhr wirklich auf ${H.durOf(m)}:00?">Uhr zurücksetzen</button>`)
      + `<button class="btn danger big" data-act="final" data-confirm="Wirklich abpfeifen?">Abpfiff</button>`;
    else { const n = H.nextScheduled(m); ctrl = (n ? `<button class="btn cyan big" data-act="select" data-id="${n.id}">Nächstes Spiel laden: ${esc(H.tName(n, 'h'))} – ${esc(H.tName(n, 'a'))}</button>` : '') + `<button class="btn big" data-act="reopen">Spiel wieder öffnen</button>`; }

    const col = (side) => {
      const t = H.teamOf(m, side), pick = ui.pick[side];
      if (!t) return `<div class="box ck-col" style="--c:#2A3560"><div class="head"><b>${esc(H.phOf(m, side))}</b></div><div class="hint">Wähle oben bei „Paarung“ ein Team. Dann erscheinen hier automatisch die Spielerinnen und Spieler.</div></div>`;
      const evs = (pid) => m.events.filter((e) => e.player === pid).map((e) => `<i class="ic ${e.type}"></i>`).join('');
      return `<div class="box ck-col" style="--c:${esc(t.color)}"><div class="head">${monoHTML(t, 's')}<b>${esc(t.name)}</b><span class="sc">${r[side]}</span></div>
        <div class="seg">${[['goal', 'Tor'], ['og', 'Eigentor'], ['yellow', 'Gelb'], ['red', 'Rot']].map(([k, l]) => `<button data-act="pick" data-side="${side}" data-t="${k}" aria-pressed="${pick === k}"><i class="ic ${k}"></i>${l}</button>`).join('')}</div>
        <div class="pgrid">${t.players.slice().sort((x, y) => (x.no || 99) - (y.no || 99)).map((p) => `<button class="pbtn" data-act="ev" data-side="${side}" data-player="${p.id}"${canEv ? '' : ' disabled'}><span class="no">${esc(p.no == null ? '·' : p.no)}</span><span>${esc(p.name)}</span><span class="cnt">${evs(p.id)}</span></button>`).join('')}
        <button class="pbtn anon" data-act="ev" data-side="${side}" data-player=""${canEv ? '' : ' disabled'}>${esc(EV[pick])} ohne Namen</button></div>
        ${t.players.length ? '' : '<div class="hint" style="margin-top:8px">Für dieses Team sind noch keine Spieler eingetragen (Reiter „Teams“).</div>'}</div>`;
    };
    const ev = m.events.slice().sort((x, y) => (y.min || 0) - (x.min || 0) || (y.at || 0) - (x.at || 0));
    return `
    <div class="ck-pick"><div class="field"><label for="ck-match">Aktuelles Spiel (wird auf der Website und der Hallenanzeige gezeigt)</label><select id="ck-match">${list.map((x) => `<option value="${x.id}"${x === m ? ' selected' : ''}>${esc(matchLabel(x))}</option>`).join('')}</select></div>
      <div class="row"><button class="btn" data-act="prev">◀</button><button class="btn" data-act="next">▶</button><button class="btn" data-act="edit-match" data-id="${m.id}">Details</button></div></div>
    <div class="box"><h3>Paarung <small>${esc(m.label || STAGES[m.stage].l)} · Spielzeit ${H.durOf(m)} Minuten · geplant ${esc(m.time)} Uhr${m.status === 'scheduled' ? ` · voraussichtlich <b data-exp="${m.id}">${H.expTime(m)}</b> ${H.delayHTML(m)}` : ''}</small></h3><div class="frow">
      <div class="field"><label for="ck-home">Team 1</label><select id="ck-home">${teamOptions(m.home, !m.home && m.homePh ? (h ? m.homePh + ' → ' + h.name : m.homePh) : '')}</select></div>
      <div class="field"><label for="ck-away">Team 2</label><select id="ck-away">${teamOptions(m.away, !m.away && m.awayPh ? (a ? m.awayPh + ' → ' + a.name : m.awayPh) : '')}</select></div>
    </div></div>
    <div class="ck-board">
      <div class="stage-top"><span>Spiel ${esc(m.no)} · ${esc(m.label || STAGES[m.stage].l)}</span>${m.status === 'live' ? '<span class="livechip">Live</span>' : `<b>${m.status === 'done' ? 'Beendet' : 'Noch nicht angepfiffen'}</b>`}</div>
      <div class="sb"><div class="tb">${monoHTML(h, 'l')}<b>${esc(h ? h.name : H.phOf(m, 'h'))}</b></div><div class="score"><span>${r.h}</span><i>:</i><span>${r.a}</span></div><div class="tb">${monoHTML(a, 'l')}<b>${esc(a ? a.name : H.phOf(m, 'a'))}</b></div></div>
      <div class="sb-clock">${clockHTML(m, true)}${stateHTML(m)}</div><div class="bar"><i data-bar="${m.id}" style="width:${H.pct(m)}%"></i></div>
      <div class="ck-ctrl">${ctrl}</div>
    </div>
    <div class="box"><h3>Befehl eingeben <small>Enter trägt ein</small></h3>
      <form class="cmd" id="cmd-form"><input id="cmd" autocomplete="off" spellcheck="false" placeholder="z. B. tor spieler 1 team 2 · gelb 4 h · start · stopp"><button class="btn primary">Eintragen</button></form>
      <div class="cmd-msg ${ui.cmdMsg ? (ui.cmdMsg.ok ? 'ok' : 'no') : ''}" id="cmd-msg">${ui.cmdMsg ? esc(ui.cmdMsg.text) : ''}</div>
      <div class="keys"><kbd>tor 7 h</kbd> Tor Nr. 7 Team 1 · <kbd>tor spieler 2 team 4</kbd> nach Name und Team · <kbd>et 3 gast</kbd> Eigentor · <kbd>gelb</kbd> / <kbd>rot</kbd> Karten · <kbd>min 5</kbd> eigene Minute · <kbd>start</kbd> <kbd>stopp</kbd> <kbd>abpfiff</kbd> <kbd>zurück</kbd> <kbd>nächstes</kbd><br>Tasten außerhalb des Eingabefelds: <kbd>Leertaste</kbd> Uhr an/aus · <kbd>Z</kbd> letzten Eintrag zurücknehmen · <kbd>/</kbd> Befehlszeile</div></div>
    <div class="ck-teams">${col('h')}${col('a')}</div>
    ${m.stage !== 'group' ? `<div class="box"><h3>Neunmeterschießen <small>nur bei Unentschieden</small></h3><div class="frow"><div class="field"><label for="pen-h">${esc(h ? h.name : 'Team 1')}</label><input id="pen-h" type="number" min="0" inputmode="numeric" value="${m.pen ? m.pen.h : ''}"></div><div class="field"><label for="pen-a">${esc(a ? a.name : 'Team 2')}</label><input id="pen-a" type="number" min="0" inputmode="numeric" value="${m.pen ? m.pen.a : ''}"></div><div style="align-self:end"><button class="btn primary" data-act="pen">Speichern</button></div></div></div>` : ''}
    <div class="box"><h3>Spielverlauf ${m.events.length ? '<button class="btn sm" data-act="undo">Letzten Eintrag zurücknehmen</button>' : ''}</h3>${ev.length ? `<div class="log">${ev.map((e) => { const x = H.P(e.player); const ts = e.type === 'og' ? (e.side === 'h' ? 'a' : 'h') : e.side; const tt = x ? x.t : H.teamOf(m, ts); return `<div class="li"><span class="mi">${esc(e.min || '')}′</span><i class="ic ${e.type}"></i><span><b>${esc(EV[e.type])}</b>${x ? ' · ' + esc(x.p.name) : ''} <small>${esc(tt ? tt.name : '')}</small></span><button class="btn danger sm" data-act="del-ev" data-ev="${e.id}" data-confirm="Löschen?">Entfernen</button></div>`; }).join('')}</div>` : '<div class="hint">Noch keine Einträge.</div>'}</div>`;
  }

  function vPlan() {
    const s = S.settings, list = H.sorted();
    return `<div class="box"><h3>Spielplan erstellen <small>Ein Feld, alle Spiele nacheinander</small></h3>
      <form id="gen-form" class="frow" style="align-items:end">
        <div class="field"><label for="g-start">Erstes Spiel um</label><input id="g-start" name="start" type="time" value="${esc(s.start)}"></div>
        <div class="field"><label for="g-gap">Wechselzeit zwischen Spielen (Min.)</label><input id="g-gap" name="gap" type="number" min="0" max="30" value="${esc(s.gap)}"></div>
        <div class="field"><label for="g-dg">Gruppenspiel (Min.)</label><input id="g-dg" name="durGroup" type="number" min="1" max="60" value="${esc(s.durGroup)}"></div>
        <div class="field"><label for="g-dk">Viertelfinale & Platz 3 (Min.)</label><input id="g-dk" name="durKo" type="number" min="1" max="60" value="${esc(s.durKo)}"></div>
        <div class="field"><label for="g-df">Halbfinale & Finale (Min.)</label><input id="g-df" name="durFinal" type="number" min="1" max="60" value="${esc(s.durFinal)}"></div>
        <div class="field"><label for="g-ko">Finalrunde</label><select id="g-ko" name="koFormat"><option value="qf"${s.koFormat !== 'sf' ? ' selected' : ''}>Viertelfinale (Top 4 je Gruppe)</option><option value="sf"${s.koFormat === 'sf' ? ' selected' : ''}>Halbfinale (Top 2 je Gruppe)</option></select></div>
        <div class="row" style="grid-column:1/-1;gap:14px"><label class="check"><input type="checkbox" name="third" ${s.third ? 'checked' : ''}> Spiel um Platz 3</label><span style="flex:1"></span><button type="button" class="btn primary" data-act="save-times">Zeiten übernehmen</button><button type="button" class="btn danger" data-act="gen" data-confirm="Alle Spiele und Ergebnisse werden ersetzt. Sicher?">Spielplan neu erstellen</button></div>
      </form>
      <div class="hint" style="margin-top:10px">„Zeiten übernehmen“ speichert Spielzeiten und Wechselzeit und rechnet die geplanten Uhrzeiten neu, ohne Ergebnisse zu ändern. Bei Verspätung (auch wenn die Uhr angehalten ist) verschieben sich die voraussichtlichen Zeiten automatisch – auf der Website und der Hallenanzeige. „Spielplan neu erstellen“ baut alle Gruppenspiele (jeder gegen jeden) und die Finalrunde neu auf.</div></div>
    <div class="box"><h3>Alle Spiele <small>${list.length} Spiele · Ende ca. ${list.length ? esc(PT.minToTime((PT.timeToMin(list[list.length - 1].time) || 0) + H.durOf(list[list.length - 1]))) : '–'} Uhr</small> <button class="btn sm primary" data-act="new-match">+ Spiel</button></h3>
      <div class="alist">${list.map((m, i) => `<div class="ar${m.status === 'live' ? ' live' : ''}"><span class="no">${esc(m.no)}</span><span class="tm"><span data-exp="${m.id}">${H.expTime(m)}</span> ${H.delayHTML(m)}<br><small style="color:var(--muted);font-size:11px">geplant ${esc(m.time)}</small></span><span class="rd">${esc(m.label || STAGES[m.stage].l)}<br><small style="color:var(--muted)">${H.durOf(m)} Min.</small></span><span class="pair">${esc(H.tName(m, 'h'))} – ${esc(H.tName(m, 'a'))} ${m.status === 'done' ? `<small>· ${H.sc(m).h}:${H.sc(m).a}</small>` : m.status === 'live' ? '<small>· läuft</small>' : ''}</span>
        <span class="row"><button class="btn sm" data-act="up" data-id="${m.id}"${i ? '' : ' disabled'} aria-label="Nach oben">▲</button><button class="btn sm" data-act="down" data-id="${m.id}"${i < list.length - 1 ? '' : ' disabled'} aria-label="Nach unten">▼</button><button class="btn sm" data-act="edit-match" data-id="${m.id}">Bearbeiten</button><button class="btn sm cyan" data-act="select" data-id="${m.id}" data-go="1">Ins Cockpit</button></span></div>`).join('')}</div></div>`;
  }
  function vTeams() {
    return `<div class="box"><h3>Teams <small>${S.teams.length} Teams</small> <button class="btn sm primary" data-act="new-team">+ Team</button></h3>
    <div class="tlist">${S.teams.slice().sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<div class="ti" style="--c:${esc(t.color)}"><div class="t">${monoHTML(t, 'l')}<div><b>${esc(t.name)}</b><br><small>${esc([t.cls, t.group ? 'Gruppe ' + t.group : 'ohne Gruppe', t.players.length + ' Spieler/innen'].filter(Boolean).join(' · '))}</small></div></div><small>${esc(t.players.slice(0, 8).map((p) => (p.no ? p.no + ' ' : '') + p.name).join(' · '))}${t.players.length > 8 ? ' …' : ''}</small><div class="row"><button class="btn sm primary" data-act="edit-team" data-id="${t.id}">Team & Kader bearbeiten</button></div></div>`).join('')}</div></div>
    <div class="hint">Ändert sich die Gruppeneinteilung, im Reiter „Spielplan“ den Spielplan neu erstellen.</div>`;
  }
  function vPartner() {
    return `<div class="box"><h3>Partner & Sponsoren <button class="btn sm primary" data-act="new-sponsor">+ Partner</button></h3>
    ${S.sponsors.length ? `<div class="tlist">${S.sponsors.map((s) => `<div class="ti" style="--c:var(--cyan)"><div style="background:var(--paper);color:var(--paper-ink);padding:8px 12px;min-height:60px;display:flex;align-items:center">${s.logo ? `<img src="${esc(s.logo)}" alt="" style="max-height:48px">` : `<span class="wm">${esc(s.name)}</span>`}</div><b style="font-size:19px">${esc(s.name)}</b><small>${esc(s.level)}${s.slogan ? ' · ' + esc(s.slogan) : ''}</small><div class="row"><button class="btn sm primary" data-act="edit-sponsor" data-id="${s.id}">Bearbeiten</button></div></div>`).join('')}</div>` : '<div class="hint">Noch keine Partner eingetragen. Sie erscheinen im weißen Partnerbereich der Website.</div>'}</div>`;
  }
  function vSettings() {
    const s = S.settings;
    return `<form class="box" id="set-form"><h3>Turnierdaten</h3><div style="display:grid;gap:12px">
      <div class="frow">${F('title', 'Turniername', s.title)}${F('season', 'Jahr', s.season)}${F('school', 'Schule', s.school)}</div>
      <div class="frow">${F('day', 'Turniertag', s.day, 'date')}${F('location', 'Ort', s.location)}${F('sport', 'Sportart', s.sport)}</div>
      <div class="frow">${F('win', 'Punkte für Sieg', s.win, 'number', 'min="0" max="5"')}${F('draw', 'Punkte für Unentschieden', s.draw, 'number', 'min="0" max="5"')}</div>
      ${F('ticker', 'Durchsage im Laufband (leer = keine)', s.ticker)}
      <div class="row"><button class="btn primary">Speichern</button></div></div></form>
    <div class="box"><h3>QR-Code-Aushang</h3><div class="hint" style="margin-bottom:10px">A4-Plakat mit QR-Code zur Website für Zuschauer und Teams – zum Ausdrucken oder als PDF speichern.</div><a class="btn primary" href="/aushang" target="_blank" rel="noopener">Aushang öffnen</a></div>
    <div class="box"><h3>Sicherung</h3><div class="row"><button class="btn" data-act="backup">Sicherung herunterladen</button><label class="btn" for="restore">Sicherung einspielen</label><input id="restore" type="file" accept="application/json,.json" hidden></div><div class="hint" style="margin-top:8px">Die Sicherung ist eine JSON-Datei mit allen Teams, Spielen und Ergebnissen.</div></div>
    <form class="box" id="pw-form"><h3>Passwort ändern</h3>${ui.pwSource === 'env' ? '<div class="hint">Das Passwort ist im Vercel-Projekt als ADMIN_PASSWORD festgelegt und kann nur dort geändert werden.</div>' : `<div class="frow" style="align-items:end"><div class="field"><label for="pw-new">Neues Passwort (mind. 6 Zeichen)</label><input id="pw-new" type="password" autocomplete="new-password"></div><div><button class="btn primary">Passwort ändern</button></div></div>`}</form>
    <div class="box"><h3>Ergebnisse zurücksetzen</h3><div class="hint" style="margin-bottom:10px">Löscht alle Tore, Karten und Spielzeiten. Teams und Spielplan bleiben. Praktisch nach einem Testlauf.</div><button class="btn danger" data-act="reset-all" data-confirm="Wirklich alle Ergebnisse löschen?">Alle Ergebnisse löschen</button></div>`;
  }

  /* ---------- Rahmen ---------- */
  const TABS = [['cockpit', 'Live-Cockpit'], ['plan', 'Spielplan'], ['teams', 'Teams'], ['partner', 'Partner'], ['settings', 'Einstellungen']];
  function render() {
    if (!S) return;
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest('#app') && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.id !== 'cmd' && !ae.closest('.ck-pick') && ae.type !== 'file') { ui.needsRender = true; return; }
    ui.needsRender = false;
    const focusCmd = ae && ae.id === 'cmd', cmdVal = focusCmd ? ae.value : '';
    const v = { cockpit: vCockpit, plan: vPlan, teams: vTeams, partner: vPartner, settings: vSettings }[ui.tab] || vCockpit;
    app.innerHTML = `<header class="tl-head"><div class="wrap">
      <a class="brand" href="/" target="_blank" rel="noopener"><span class="logo logo-school" role="img" aria-label="Logo"></span><span class="bt"><small>Turnierleitung</small><b>${esc(S.settings.title).replace(/-?(Turnier)$/i, ' <span>$1</span>')}</b></span></a>
      <nav class="tl-nav">${TABS.map(([k, l]) => `<button data-act="tab" data-t="${k}" aria-pressed="${ui.tab === k}">${l}</button>`).join('')}</nav>
      <div class="tl-side"><span id="save" class="save"></span><a class="btn sm" href="/" target="_blank" rel="noopener">Website</a><a class="btn sm" href="/anzeige" target="_blank" rel="noopener">Hallenanzeige</a><button class="btn sm" data-act="logout">Abmelden</button></div>
    </div></header><main class="tl-body"><div class="wrap">${v()}</div></main>`;
    paintSave();
    // Falls ein Werbeblocker trotzdem Teile ausblendet: Hinweis zeigen
    const body = app.querySelector('.tl-body'); if (body && !body.offsetHeight) toast('Eine Browser-Erweiterung (z. B. Werbeblocker) blendet Teile aus. Bitte für diese Seite ausschalten.', true);
    if (focusCmd) { const el = document.getElementById('cmd'); if (el) { el.value = cmdVal; el.focus(); } }
  }
  document.addEventListener('focusout', () => setTimeout(() => { if (ui.needsRender) render(); }, 0));
  setInterval(() => {
    if (!H) return;
    document.querySelectorAll('[data-clock]').forEach((el) => { const m = H.M(el.dataset.clock); if (m) el.textContent = H.clockText(m); });
    document.querySelectorAll('[data-bar]').forEach((el) => { const m = H.M(el.dataset.bar); if (m) el.style.width = H.pct(m) + '%'; });
    document.querySelectorAll('[data-cstate]').forEach((el) => { const m = H.M(el.dataset.cstate); if (m) el.textContent = H.clockState(m); });
    H.tickTimes();
  }, 250);

  /* ---------- Dialoge ---------- */
  let modalEl = null;
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
  function openModal(title, inner, onSubmit, opts) {
    closeModal(); opts = opts || {};
    modalEl = document.createElement('div'); modalEl.className = 'modal-bg';
    modalEl.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-h"><h3>${esc(title)}</h3><button class="btn" data-mact="close" type="button">Schließen</button></div>
      <form novalidate>${inner}<div class="err-msg" data-err></div><div class="foot">${opts.del ? `<button type="button" class="btn danger" data-mact="del">${esc(opts.delLabel || 'Löschen')}</button>` : ''}<div class="right"><button type="button" class="btn" data-mact="close">Abbrechen</button><button class="btn primary" type="submit">${esc(opts.submit || 'Speichern')}</button></div></div></form></div>`;
    document.body.appendChild(modalEl);
    const form = modalEl.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.dataset.busy) { modalEl.querySelector('[data-err]').textContent = 'Bild wird noch hochgeladen …'; return; }
      const err = onSubmit(new FormData(form), form);
      if (typeof err === 'string') { modalEl.querySelector('[data-err]').textContent = err; return; }
      closeModal();
    });
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
      const b = e.target.closest('[data-mact]'); if (!b) return;
      if (b.dataset.mact === 'close') closeModal();
      if (b.dataset.mact === 'del') { if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Wirklich löschen?'; return; } opts.del(); closeModal(); }
    });
    const first = form.querySelector('input,select,textarea'); if (first) first.focus();
    if (opts.after) opts.after(form);
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  const F = (name, label, val, type, extra) => `<div class="field"><label for="f-${name}">${esc(label)}</label><input id="f-${name}" name="${name}" type="${type || 'text'}" value="${esc(val == null ? '' : val)}" ${extra || ''}></div>`;
  const rosterPreview = (id) => { const t = H.T(id); if (!t) return 'Wähle ein Team, dann siehst du hier die Spielerliste.'; return t.players.length ? '<b>Kader:</b> ' + t.players.slice().sort((a, b) => (a.no || 99) - (b.no || 99)).map((p) => esc((p.no ? p.no + ' ' : '') + p.name)).join(' · ') : 'Für dieses Team sind noch keine Spieler eingetragen.'; };

  function matchForm(m) {
    const isNew = !m, last = H.sorted().pop();
    m = m || { time: last ? PT.minToTime((PT.timeToMin(last.time) || 540) + H.durOf(last) + (+S.settings.gap || 0)) : S.settings.start, stage: 'group', label: '', home: null, away: null, homePh: '', awayPh: '', dur: null };
    const opt = (sel) => '<option value="">– noch offen –</option>' + S.teams.slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.name)}${t.group ? ' (Gr. ' + esc(t.group) + ')' : ''}</option>`).join('');
    openModal(isNew ? 'Spiel anlegen' : 'Spiel ' + m.no + ' bearbeiten', `
      <div class="frow">${F('time', 'Uhrzeit', m.time, 'time')}<div class="field"><label for="f-stage">Runde</label><select id="f-stage" name="stage">${Object.entries(STAGES).map(([k, v]) => `<option value="${k}"${m.stage === k ? ' selected' : ''}>${v.l} (${S.settings[v.d]} Min.)</option>`).join('')}</select></div>${F('label', 'Bezeichnung', m.label, 'text', 'placeholder="z. B. Gruppe A, Halbfinale 1"')}</div>
      <div class="field"><label for="f-home">Team 1</label><select id="f-home" name="home">${opt(m.home)}</select><div class="rprev" data-prev="home">${rosterPreview(m.home)}</div></div>
      ${F('homePh', 'Platzhalter für Team 1, solange es offen ist', m.homePh, 'text', 'placeholder="z. B. 1. Gruppe A oder Sieger VF 1"')}
      <div class="field"><label for="f-away">Team 2</label><select id="f-away" name="away">${opt(m.away)}</select><div class="rprev" data-prev="away">${rosterPreview(m.away)}</div></div>
      ${F('awayPh', 'Platzhalter für Team 2, solange es offen ist', m.awayPh, 'text', 'placeholder="z. B. 4. Gruppe B oder Verlierer HF 2"')}
      ${F('dur', 'Eigene Spielzeit in Minuten (leer = Standard der Runde)', m.dur || '', 'number', 'min="1" max="60"')}
      <div class="hint">Platzhalter wie „1. Gruppe A“, „Sieger VF 2“ oder „Verlierer HF 1“ werden automatisch durch das richtige Team ersetzt, sobald das Ergebnis feststeht.</div>`,
    (fd) => {
      const o = { time: fd.get('time'), stage: fd.get('stage'), label: fd.get('label').trim(), home: fd.get('home') || null, away: fd.get('away') || null, homePh: fd.get('homePh').trim(), awayPh: fd.get('awayPh').trim(), dur: parseInt(fd.get('dur'), 10) || null };
      if (!o.time) return 'Bitte eine Uhrzeit angeben.';
      if (o.home && o.home === o.away) return 'Ein Team kann nicht gegen sich selbst spielen.';
      if (!o.label) o.label = STAGES[o.stage].l;
      if (isNew) { const id = uid('m'); act((S) => { const no = Math.max(0, ...S.matches.map((x) => x.no || 0)) + 1; S.matches.push(Object.assign({ id, no, status: 'scheduled', clock: { run: false, since: null, acc: 0 }, events: [], pen: null }, o)); }); }
      else { const id = m.id; act((S) => { Object.assign(find(S, id), o); }); }
    }, { ...(isNew ? {} : { del: () => { const id = m.id; act((S) => { S.matches = S.matches.filter((x) => x.id !== id); renumber(S); if (S.current === id) S.current = null; }); }, delLabel: 'Spiel löschen' }), after: (form) => {
      ['home', 'away'].forEach((k) => form.querySelector('#f-' + k).addEventListener('change', (e) => { form.querySelector(`[data-prev="${k}"]`).innerHTML = rosterPreview(e.target.value); }));
    } });
  }
  function renumber(S) { S.matches.sort((a, b) => (a.no || 0) - (b.no || 0)).forEach((m, i) => { m.no = i + 1; }); }

  /* Bilder verkleinern und hochladen */
  function resize(file, maxW, maxH, type) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, maxW / img.width, maxH / img.height); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k)); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht umgewandelt werden.'))), type, 0.85); }; img.onerror = () => reject(new Error('Dieses Bild konnte nicht gelesen werden. Bitte PNG oder JPG wählen.')); img.src = rd.result; };
      rd.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.')); rd.readAsDataURL(file);
    });
  }
  async function upload(file, maxW, maxH, type) { const b = await resize(file, maxW, maxH, type); const j = await api('/api/img', { method: 'POST', headers: { 'Content-Type': type }, body: b }); return j.url; }
  const imgField = (id, label, has, none) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="file" accept="image/*"><div class="hint" data-hint="${id}">${has ? `Ein Bild ist hinterlegt. <button type="button" class="btn sm" data-rm="${id}">Entfernen</button>` : none}</div></div>`;
  function wireImg(form, id, maxW, maxH, type, set) {
    const hint = form.querySelector(`[data-hint="${id}"]`);
    form.addEventListener('click', (e) => { if (e.target.closest(`[data-rm="${id}"]`)) { set(''); hint.textContent = 'Wird beim Speichern entfernt.'; } });
    form.querySelector('#' + id).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      hint.textContent = 'Bild wird hochgeladen …'; form.dataset.busy = '1';
      try { const url = await upload(f, maxW, maxH, type); set(url); hint.innerHTML = 'Neues Bild bereit: <img src="' + esc(url) + '" alt="" style="max-height:40px;vertical-align:middle">'; }
      catch (x) { hint.textContent = x.message; }
      delete form.dataset.busy;
    });
  }
  const COLORS = ['#2E6BFF', '#E5383B', '#F4B400', '#2BA84A', '#8E44EC', '#F2711C', '#00A8B5', '#E84393', '#6C7A89', '#3DDC97', '#C0392B', '#1ABC9C'];
  function teamForm(t) {
    const isNew = !t;
    t = t || { name: 'Team ' + (S.teams.length + 1), cls: '', group: H.groups()[0] || 'A', color: COLORS[S.teams.length % COLORS.length], players: [], logo: '', photo: '' };
    let logo = t.logo, photo = t.photo;
    const roster = t.players.slice().sort((a, b) => (a.no || 99) - (b.no || 99)).map((p) => (p.no != null ? p.no + ' ' : '') + p.name).join('\n');
    openModal(isNew ? 'Team anlegen' : 'Team bearbeiten', `
      ${F('name', 'Teamname', t.name, 'text', 'required')}
      <div class="frow">${F('cls', 'Klasse / Kurs (optional)', t.cls, 'text', 'placeholder="z. B. J1, J2"')}${F('group', 'Gruppe', t.group, 'text', 'placeholder="A oder B"')}${F('color', 'Teamfarbe', t.color, 'color')}</div>
      <div class="field"><label for="f-players">Spielerliste</label><textarea id="f-players" name="players" placeholder="1 Spieler 1&#10;7 Jonas M.&#10;10 Lea K.">${esc(roster)}</textarea><div class="hint">Eine Person pro Zeile, Rückennummer optional vorne. Du kannst eine Liste aus Excel oder WhatsApp einfügen. Tore bleiben erhalten, solange der Name gleich bleibt.</div></div>
      <div class="frow">${imgField('f-logo', 'Teamlogo (optional)', !!t.logo, 'Ohne Logo zeigen wir das Kürzel.')}${imgField('f-photo', 'Teamfoto (optional)', !!t.photo, 'Erscheint auf der Teamkarte.')}</div>`,
    (fd) => {
      const name = fd.get('name').trim(); if (!name) return 'Bitte einen Teamnamen eingeben.';
      const old = t.players || [];
      const players = fd.get('players').split('\n').map((l) => l.replace(/\t/g, ' ').trim()).filter(Boolean).map((l) => { const mm = l.match(/^(\d{1,3})\s*[.)\-–:]?\s+(.+)$/); const no = mm ? +mm[1] : null, nm = (mm ? mm[2] : l).trim(); const ex = old.find((p) => p.name.toLowerCase() === nm.toLowerCase()); return { id: ex ? ex.id : uid('p'), no, name: nm }; });
      const o = { name, cls: fd.get('cls').trim(), group: fd.get('group').trim().toUpperCase(), color: fd.get('color') || '#2E6BFF', players, logo, photo };
      if (isNew) { const id = uid('t'); act((S) => { S.teams.push(Object.assign({ id }, o)); }); }
      else { const id = t.id; act((S) => { Object.assign(S.teams.find((x) => x.id === id), o); }); }
    }, { ...(isNew ? {} : { del: () => { const id = t.id, nm = t.name; act((S) => { S.teams = S.teams.filter((x) => x.id !== id); S.matches.forEach((m) => { if (m.home === id) { m.home = null; m.homePh = m.homePh || nm; } if (m.away === id) { m.away = null; m.awayPh = m.awayPh || nm; } }); }); }, delLabel: 'Team löschen' }), after: (form) => { wireImg(form, 'f-logo', 240, 240, 'image/png', (u) => { logo = u; }); wireImg(form, 'f-photo', 900, 560, 'image/jpeg', (u) => { photo = u; }); } });
  }
  function sponsorForm(s) {
    const isNew = !s; s = s || { name: '', level: 'Partner', slogan: '', url: '', logo: '' }; let logo = s.logo;
    openModal(isNew ? 'Partner anlegen' : 'Partner bearbeiten', `
      ${F('name', 'Name', s.name, 'text', 'required')}
      <div class="frow"><div class="field"><label for="f-level">Stufe</label><select id="f-level" name="level">${LEVELS.map((l) => `<option${l === s.level ? ' selected' : ''}>${l}</option>`).join('')}</select></div>${F('url', 'Website (optional)', s.url, 'text', 'placeholder="www.beispiel.de"')}</div>
      ${F('slogan', 'Kurzer Text (optional)', s.slogan, 'text', 'placeholder="z. B. Stiftet die Pokale"')}
      ${imgField('f-slogo', 'Logo (optional, am besten PNG mit transparentem Hintergrund)', !!s.logo, 'Ohne Logo zeigen wir den Namen als Schriftzug.')}`,
    (fd) => {
      const name = fd.get('name').trim(); if (!name) return 'Bitte einen Namen eingeben.';
      const o = { name, level: fd.get('level'), slogan: fd.get('slogan').trim(), url: fd.get('url').trim(), logo };
      if (isNew) { const id = uid('s'); act((S) => { S.sponsors.push(Object.assign({ id }, o)); }); }
      else { const id = s.id; act((S) => { Object.assign(S.sponsors.find((x) => x.id === id), o); }); }
    }, { ...(isNew ? {} : { del: () => { const id = s.id; act((S) => { S.sponsors = S.sponsors.filter((x) => x.id !== id); }); }, delLabel: 'Partner löschen' }), after: (form) => wireImg(form, 'f-slogo', 600, 240, 'image/png', (u) => { logo = u; }) });
  }

  /* ---------- Klicks & Eingaben ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !app.contains(b) || b.disabled) return;
    if (b.dataset.confirm !== undefined && !b.classList.contains('armed')) {
      b.classList.add('armed'); const o = b.innerHTML; b.textContent = b.dataset.confirm || 'Sicher?';
      setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.innerHTML = o; } }, 3500); return;
    }
    if (!S) return;
    const a = b.dataset.act, m = cur();
    if (a === 'tab') { ui.tab = b.dataset.t; try { sessionStorage.setItem('pt-tab', ui.tab); } catch (x) { /* egal */ } render(); scrollTo(0, 0); return; }
    if (a === 'logout') { api('/api/auth?action=logout', { method: 'POST' }).finally(() => showLogin()); return; }
    if (a === 'pick') { ui.pick[b.dataset.side] = b.dataset.t; render(); return; }
    if (a === 'ev') { addEvent(ui.pick[b.dataset.side], b.dataset.side, b.dataset.player); return; }
    if (a === 'select') { act(A.select(b.dataset.id)); if (b.dataset.go) { ui.tab = 'cockpit'; render(); scrollTo(0, 0); } return; }
    if (a === 'prev' || a === 'next') { const l = H.sorted(), i = l.indexOf(m), n = l[i + (a === 'next' ? 1 : -1)]; if (n) act(A.select(n.id)); return; }
    if (a === 'edit-match') { matchForm(H.M(b.dataset.id)); return; }
    if (a === 'new-match') { matchForm(null); return; }
    if (a === 'new-team') { teamForm(null); return; }
    if (a === 'edit-team') { teamForm(H.T(b.dataset.id)); return; }
    if (a === 'new-sponsor') { sponsorForm(null); return; }
    if (a === 'edit-sponsor') { sponsorForm(S.sponsors.find((x) => x.id === b.dataset.id)); return; }
    if (a === 'up' || a === 'down') { const id = b.dataset.id, d = a === 'up' ? -1 : 1; act((S) => { const l = S.matches.slice().sort((x, y) => (x.no || 0) - (y.no || 0)); const i = l.findIndex((x) => x.id === id), j = i + d; if (j < 0 || j >= l.length) return; const t = l[i].no; l[i].no = l[j].no; l[j].no = t; const ti = l[i].time; l[i].time = l[j].time; l[j].time = ti; }); return; }
    if (a === 'save-times' || a === 'gen') {
      const f = document.getElementById('gen-form'), fd = new FormData(f);
      const vals = { start: fd.get('start') || '09:00', gap: +fd.get('gap') || 0, durGroup: +fd.get('durGroup') || 7, durKo: +fd.get('durKo') || 10, durFinal: +fd.get('durFinal') || 12, koFormat: fd.get('koFormat'), third: !!fd.get('third') };
      if (a === 'gen') { act((S) => { Object.assign(S.settings, vals); S.matches = PT.genSchedule(S); S.current = null; }); toast('Spielplan neu erstellt: ' + S.matches.length + ' Spiele.'); }
      else { act((S) => { Object.assign(S.settings, vals); PT.retime(S); }); toast('Zeiten übernommen.'); }
      return;
    }
    if (a === 'backup') {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'turnier-sicherung-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json'; document.body.appendChild(l); l.click(); l.remove();
      return;
    }
    if (a === 'reset-all') { act((S) => { S.matches.forEach((x) => { x.events = []; x.status = 'scheduled'; x.clock = { run: false, since: null, acc: 0 }; x.pen = null; x.startedAt = null; x.endedAt = null; }); S.current = null; }); toast('Alle Ergebnisse gelöscht.'); return; }
    if (!m) return;
    try {
      if (a === 'start') act(A.start(m.id));
      else if (a === 'stop') act(A.stop(m.id));
      else if (a === 'adj') act(A.adjust(m.id, +b.dataset.s));
      else if (a === 'reset') act(A.reset(m.id));
      else if (a === 'final') act(A.final(m.id));
      else if (a === 'reopen') act(A.reopen(m.id));
      else if (a === 'undo') act(A.undo(m.id));
      else if (a === 'del-ev') act(A.delEvent(m.id, b.dataset.ev));
      else if (a === 'pen') { const h = parseInt(document.getElementById('pen-h').value, 10), w = parseInt(document.getElementById('pen-a').value, 10); act(A.pen(m.id, isNaN(h) || isNaN(w) ? null : { h, a: w })); toast(isNaN(h) || isNaN(w) ? 'Neunmeter-Ergebnis entfernt.' : 'Neunmeter-Ergebnis gespeichert.'); }
    } catch (x) { toast(x.message, true); }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'cmd-form') {
      e.preventDefault(); const inp = document.getElementById('cmd'); const res = runCmd(inp.value);
      if (res) { ui.cmdMsg = res; if (res.ok) inp.value = ''; const el = document.getElementById('cmd-msg'); if (el) { el.className = 'cmd-msg ' + (res.ok ? 'ok' : 'no'); el.textContent = res.text; } }
    }
    if (e.target.id === 'pw-form') {
      e.preventDefault(); const inp = document.getElementById('pw-new'); if (!inp) return;
      api('/api/auth?action=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: inp.value }) })
        .then(() => { inp.value = ''; inp.blur(); toast('Passwort geändert. Andere Geräte müssen sich neu anmelden.'); })
        .catch((x) => toast(x.message, true));
      return;
    }
    if (e.target.id === 'set-form') {
      e.preventDefault(); const fd = new FormData(e.target), vals = {};
      ['title', 'season', 'school', 'day', 'location', 'sport', 'ticker'].forEach((k) => { vals[k] = String(fd.get(k) || '').trim(); });
      vals.date = vals.day ? new Date(vals.day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
      ['win', 'draw'].forEach((k) => { const v = parseInt(fd.get(k), 10); if (!isNaN(v)) vals[k] = v; });
      document.activeElement && document.activeElement.blur();
      act((S) => { Object.assign(S.settings, vals); }); toast('Turnierdaten gespeichert.');
    }
  });
  document.addEventListener('change', (e) => {
    if (!S) return;
    const id = e.target.id, m = cur();
    if (id === 'ck-match') { act(A.select(e.target.value)); e.target.blur(); return; }
    if ((id === 'ck-home' || id === 'ck-away') && m) {
      const k = id === 'ck-home' ? 'home' : 'away', o = k === 'home' ? 'away' : 'home', v = e.target.value || null;
      e.target.blur();
      if (v && v === m[o]) { toast('Ein Team kann nicht gegen sich selbst spielen.', true); render(); return; }
      act(A.setTeam(m.id, k, v)); return;
    }
    if (id === 'restore') {
      const f = e.target.files[0]; if (!f) return;
      f.text().then((txt) => { const d = JSON.parse(txt); if (!d || !Array.isArray(d.teams) || !Array.isArray(d.matches)) throw new Error('Das ist keine Turnier-Sicherung.'); act((S) => { S.settings = d.settings || S.settings; S.teams = d.teams; S.matches = d.matches; S.sponsors = d.sponsors || []; S.current = d.current || null; PT.normalize(S); }); toast('Sicherung eingespielt.'); })
        .catch((x) => toast(x.message || 'Datei konnte nicht gelesen werden.', true));
    }
  });
  addEventListener('keydown', (e) => {
    if (!S || ui.tab !== 'cockpit' || modalEl) return;
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const m = cur(); if (!m) return;
    try {
      if (e.code === 'Space') { e.preventDefault(); if (m.status === 'live' && m.clock.run) act(A.stop(m.id)); else if (m.status !== 'done') act(A.start(m.id)); }
      else if (e.key === 'z' || e.key === 'Z') { act(A.undo(m.id)); }
      else if (e.key === '/') { e.preventDefault(); const c = document.getElementById('cmd'); if (c) c.focus(); }
    } catch (x) { toast(x.message, true); }
  });

  /* ---------- Anmeldung ---------- */
  /* ---------- Anmeldung, Einrichtung, Diagnose ---------- */
  const shell = (inner) => `<div class="login"><div class="lg-card"><span class="logo logo-school" style="width:70px"></span><div><div class="eyebrow">Parler-Gymnasium · SMV</div><h1>Turnierleitung</h1></div>${inner}</div></div>`;
  function bindForm(id, fn) {
    const f = document.getElementById(id); if (!f) return;
    const first = f.querySelector('input'); if (first) first.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const err = f.querySelector('.err-msg'); err.textContent = ''; const btn = f.querySelector('button.primary'); btn.disabled = true;
      try { await fn(f); } catch (x) { err.textContent = x.message; } btn.disabled = false;
    });
  }
  function showLogin(msg) {
    S = null;
    app.innerHTML = shell(`<form id="login-form" class="lg-form">${msg ? `<div class="notice">${esc(msg)}</div>` : ''}
      <div class="field"><label for="pass">Passwort</label><input id="pass" type="password" autocomplete="current-password" required></div>
      <div class="err-msg"></div><button class="btn primary big">Anmelden</button>
      <div class="row" style="justify-content:space-between"><a class="hint" href="/">← Zur Website</a><button type="button" class="btn sm" data-diag>Diagnose</button></div></form>`);
    bindForm('login-form', async () => { await api('/api/auth?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: document.getElementById('pass').value }) }); start(); });
  }
  function showSetup() {
    app.innerHTML = shell(`<form id="setup-form" class="lg-form"><div class="notice"><b>Willkommen!</b> Lege jetzt das Passwort für die Turnierleitung fest. Damit meldest du dich und alle Helfer an der Anzeigetafel an.</div>
      <div class="field"><label for="np1">Neues Passwort (mind. 6 Zeichen)</label><input id="np1" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="field"><label for="np2">Passwort wiederholen</label><input id="np2" type="password" autocomplete="new-password" required></div>
      <div class="err-msg"></div><button class="btn primary big">Passwort festlegen</button></form>`);
    bindForm('setup-form', async () => {
      const a = document.getElementById('np1').value, b = document.getElementById('np2').value;
      if (a.length < 6) throw new Error('Das Passwort muss mindestens 6 Zeichen haben.');
      if (a !== b) throw new Error('Die beiden Passwörter sind nicht gleich.');
      await api('/api/auth?action=setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: a }) }); start();
    });
  }
  async function showDiag(prefix) {
    app.innerHTML = shell(`<div class="notice">Diagnose läuft …</div>`);
    let c = null, err = '';
    try { c = await api('/api/auth?action=check'); } catch (e) { err = e.message; }
    const line = (ok, txt) => `<li style="display:flex;gap:8px"><b style="color:${ok ? 'var(--win)' : 'var(--lose)'}">${ok ? '✓' : '✗'}</b><span>${txt}</span></li>`;
    let tips = '';
    if (!c) tips = `Die Server-Funktionen antworten nicht (${esc(err)}). Prüfe in Vercel unter „Deployments“ den obersten Eintrag: Status „Ready“? Liegt der Ordner <b>api</b> direkt im Repository (nicht in einem Unterordner)?`;
    else if (!c.storage) tips = c.env && c.env.length ? 'Es gibt Speicher-Variablen, aber keine passt. Bitte schick einen Screenshot dieser Seite.' : 'Diese Version sieht <b>keine Speicher-Variablen</b>. Prüfe in Vercel: <b>Storage</b> → dein Speicher → <b>Projects</b>: ist <b>obt1</b> verbunden und ist dabei <b>Production</b> angehakt? Danach unbedingt <b>Deployments → oberster Eintrag → ⋯ → Redeploy</b>. Variablen gelten erst für neue Deployments.';
    else if (c.error) tips = 'Der Speicher ist verbunden, aber der Test schlug fehl: <b>' + esc(c.error) + '</b>. Meist hilft: Speicher in Vercel erneut mit dem Projekt verbinden und neu deployen.';
    app.innerHTML = shell(`<div style="display:grid;gap:12px">${prefix ? `<div class="notice">${prefix}</div>` : ''}
      <ul style="list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:14px">
        ${line(!!c, 'Server-Funktionen erreichbar' + (c ? ' (Version ' + esc(c.version) + ')' : ''))}
        ${line(!!(c && c.storage), 'Speicher verbunden' + (c && c.storage ? ': ' + esc(c.storage) : ''))}
        ${line(!!(c && c.write), 'Speichern möglich')}
        ${line(!!(c && c.read), 'Lesen möglich')}
      </ul>
      ${c ? `<div class="hint">Gefundene Speicher-Variablen: ${c.env && c.env.length ? c.env.map(esc).join(', ') : 'keine'} · Umgebung: ${esc(c.vercelEnv || '–')} · Deployment: ${esc(c.deployment || '–')}</div>` : ''}
      ${tips ? `<div class="notice">${tips}</div>` : '<div class="notice"><b>Alles in Ordnung.</b></div>'}
      <div class="row"><button class="btn primary" onclick="location.reload()">Erneut prüfen</button><a class="btn" href="/">Zur Website</a></div></div>`);
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-diag]')) showDiag(); });
  async function start() {
    let me;
    try { me = await api('/api/auth?action=me'); }
    catch (e) { showDiag('<b>Die Turnierleitung kann den Server nicht erreichen.</b> ' + esc(e.message)); return; }
    if (!me.storage) { showDiag('<b>Es fehlt noch der Speicher.</b> Ohne ihn können keine Ergebnisse gespeichert werden.'); return; }
    if (!me.passwordSet) { showSetup(); return; }
    if (!me.loggedIn) { showLogin(); return; }
    ui.pwSource = me.passwordSource;
    try {
      await PT.syncTime();
      S = await PT.fetchState(true); H = PT.make(S); render();
      if (S._migrated) { delete S._migrated; act(() => {}); }
      if (queue.length) flush();
    } catch (e) { showDiag('<b>Der Turnierstand konnte nicht geladen werden.</b> ' + esc(e.message)); }
  }
  setInterval(PT.syncTime, 5 * 60e3);
  addEventListener('beforeunload', (e) => { if (queue.length) { e.preventDefault(); e.returnValue = ''; } });
  start();
})();
