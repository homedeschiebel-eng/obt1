/* Gemeinsame Turnierlogik für Zuschauerseite, Turnierleitung und Hallenanzeige */
(function (root) {
  'use strict';
  const PT = {};

  /* ---------- Hilfen ---------- */
  PT.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  PT.uid = (p) => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
  PT.pad = (n) => String(n).padStart(2, '0');
  PT.fmt = (s) => { s = Math.ceil(s); return PT.pad(Math.floor(s / 60)) + ':' + PT.pad(s % 60); };
  PT.initials = (n) => {
    const w = String(n || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
    if (!w.length) return '?';
    if (w.length > 1 && /^\d+$/.test(w[w.length - 1])) return (w[0][0] + w[w.length - 1]).toUpperCase().slice(0, 3); // „Team 12“ → T12
    return (w[0][0] + (w[1] ? w[1][0] : (w[0][1] || ''))).toUpperCase();
  };
  PT.safeUrl = (u) => { u = String(u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };
  // Rückennummer: ohne Nummer steht ein Strich
  PT.hasNo = (p) => !!p && p.no != null && p.no !== '';
  PT.noText = (p) => (PT.hasNo(p) ? String(p.no) : '–');
  PT.byNo = (a, b) => (PT.hasNo(a) ? +a.no : 9999) - (PT.hasNo(b) ? +b.no : 9999) || String(a.name).localeCompare(String(b.name), 'de');
  PT.short = (t) => (t && t.short ? t.short : PT.initials(t && t.name));
  PT.monoHTML = (t, cls) => t
    ? `<span class="mono ${cls || ''}${t.logo ? ' has-logo' : ''}" style="--c:${PT.esc(t.color)}">${t.logo ? `<img src="${PT.esc(t.logo)}" alt="">` : PT.esc(PT.short(t))}</span>`
    : `<span class="mono ${cls || ''}" style="--c:#2A3560">?</span>`;
  PT.timeToMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  PT.minToTime = (n) => PT.pad(Math.floor(n / 60) % 24) + ':' + PT.pad(n % 60);

  /* ---------- Serverzeit ---------- */
  let offset = 0;
  PT.now = () => Date.now() + offset;
  PT.syncTime = async () => {
    try { const t0 = Date.now(); const r = await fetch('/api/time', { cache: 'no-store' }); const j = await r.json(); offset = j.now - (t0 + Date.now()) / 2; } catch (e) { /* Gerätezeit bleibt */ }
  };

  PT.STAGES = {
    group: { l: 'Gruppenspiel', d: 'durGroup' },
    qf: { l: 'Viertelfinale', d: 'durKo' },
    sf: { l: 'Halbfinale', d: 'durFinal' },
    third: { l: 'Spiel um Platz 3', d: 'durKo' },
    final: { l: 'Finale', d: 'durFinal' },
    test: { l: 'Testspiel', d: 'durGroup' }
  };
  PT.LEVELS = ['Hauptsponsor', 'Premium-Partner', 'Partner', 'Förderer'];
  PT.EV = { goal: 'Tor', og: 'Eigentor', yellow: 'Gelbe Karte', red: '2-Minuten-Strafe' };
  PT.PEN_SEC = 120; // Dauer einer Zeitstrafe (Spielzeit)

  PT.LOCATION = 'Großsporthalle Schwäbisch Gmünd';
  PT.normalize = (S) => {
    S = S || {};
    const old = !!(S.settings && S.settings.title !== undefined && !S.settings.day);
    S.settings = Object.assign({ title: 'Oberstufen-Turnier', school: 'Parler-Gymnasium', season: '2026', date: '', day: '2026-12-22', location: 'Großsporthalle Schwäbisch Gmünd', sport: 'Fußball', ticker: '', start: '11:30', gap: 1, koBreak: 10, koFormat: 'qf', third: true, win: 3, draw: 1, durGroup: 7, durKo: 10, durFinal: 12, vote: 'off', voteRound: 'r1' }, S.settings || {});
    if (!S.settings.teamEditUntil) S.settings.teamEditUntil = '2026-12-20T20:00';
    S.teams = S.teams || []; S.matches = S.matches || []; S.sponsors = S.sponsors || [];
    S.teams.forEach((t) => { t.players = t.players || []; });
    S.matches.forEach((m) => { m.events = m.events || []; m.clock = m.clock || { run: false, since: null, acc: 0 }; });
    S.rev = S.rev || 0;
    // Neuer, gleichmäßiger Spielplan (Version 2): automatisch übernehmen, solange noch kein Turnierspiel begonnen hat
    if ((+S.settings.planV || 0) < 2 && S.teams.length && PT.genSchedule) {
      const real = S.matches.filter((m) => m.stage !== 'test');
      const untouched = real.every((m) => m.status === 'scheduled' && !(m.events || []).length && !m.startedAt);
      if (untouched) {
        const tests = S.matches.filter((m) => m.stage === 'test');
        if (real.length) { S.matches = PT.genSchedule(S).concat(tests); if (S.current && !S.matches.some((m) => m.id === S.current)) S.current = null; }
        S.settings.planV = 2; S._migrated = true;
      } else S.settings.planV = 1;
    }
    // Ort ist immer die Großsporthalle Schwäbisch Gmünd (ältere Stände hatten „Sporthalle“)
    if (!S.settings.location || /^\s*sporthalle\s*$/i.test(S.settings.location)) { S.settings.location = PT.LOCATION; S._migrated = true; }
    // Einmalige Umstellung älterer Stände: Turniertag 22.12.2026, Start 11:30, 1 Minute Wechselzeit
    if (old) {
      const wasDefault = !S.settings.start || S.settings.start === '09:00';
      Object.assign(S.settings, { day: '2026-12-22', date: 'Dienstag, 22. Dezember 2026', season: S.settings.season || '2026' });
      if (wasDefault) { S.settings.start = '11:30'; S.settings.gap = 1; }
      PT.retime(S); S._migrated = true;
    }
    return S;
  };

  /* ---------- Auswertung zu einem Turnierstand ---------- */
  PT.make = (S) => {
    const H = {};
    H.T = (id) => (id ? S.teams.find((t) => t.id === id) || null : null);
    H.M = (id) => S.matches.find((m) => m.id === id) || null;
    H.P = (id) => { if (!id) return null; for (const t of S.teams) { const p = t.players.find((x) => x.id === id); if (p) return { p, t }; } return null; };
    H.isGoal = (e) => e.type === 'goal' || e.type === 'og';
    H.sc = (m) => { let h = 0, a = 0; m.events.forEach((e) => { if (H.isGoal(e)) { if (e.side === 'h') h++; else a++; } }); return { h, a }; };
    // Turnierspiele (ohne Testspiele) in Spielreihenfolge; Testspiele getrennt nach Datum und Uhrzeit
    H.sorted = () => S.matches.filter((m) => m.stage !== 'test').sort((a, b) => (a.no || 0) - (b.no || 0) || String(a.time).localeCompare(String(b.time)));
    H.tests = () => S.matches.filter((m) => m.stage === 'test').sort((a, b) => String(a.day || '').localeCompare(String(b.day || '')) || String(a.time).localeCompare(String(b.time)));
    H.isTest = (m) => !!m && m.stage === 'test';
    H.dayText = (m) => { const d = (m && m.day) || S.settings.day; return d ? new Date(d + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }) : ''; };
    H.groups = () => { const g = [...new Set(S.teams.map((t) => t.group || ''))].sort(); return g.length ? g : ['']; };
    H.inGroup = (m, g) => { const h = H.T(m.home), a = H.T(m.away); return !!(h && a && (h.group || '') === g && (a.group || '') === g); };
    H.qualN = () => (H.groups().length > 1 ? (S.settings.koFormat === 'sf' ? 2 : 4) : 0);
    H.qualLabel = () => (S.settings.koFormat === 'sf' ? 'Halbfinale' : 'Viertelfinale');

    H.standings = (g) => {
      const W = +S.settings.win, D = +S.settings.draw, rows = {};
      S.teams.filter((t) => (t.group || '') === g).forEach((t) => { rows[t.id] = { t, sp: 0, s: 0, u: 0, n: 0, tf: 0, ta: 0, pts: 0, live: false, form: [] }; });
      H.sorted().forEach((m) => {
        if (m.stage !== 'group' || m.status === 'scheduled') return;
        const h = rows[m.home], a = rows[m.away]; if (!h || !a) return;
        const r = H.sc(m); if (m.status === 'live') h.live = a.live = true;
        h.sp++; a.sp++; h.tf += r.h; h.ta += r.a; a.tf += r.a; a.ta += r.h;
        if (r.h > r.a) { h.s++; a.n++; h.pts += W; h.form.push('S'); a.form.push('N'); }
        else if (r.h < r.a) { a.s++; h.n++; a.pts += W; a.form.push('S'); h.form.push('N'); }
        else { h.u++; a.u++; h.pts += D; a.pts += D; h.form.push('U'); a.form.push('U'); }
      });
      // Reihenfolge: Punkte → direkter Vergleich (Punkte aus den Spielen der Punktgleichen gegeneinander) → Tordifferenz → Tore
      const list = Object.values(rows), byName = (x, y) => x.t.name.localeCompare(y.t.name, 'de', { numeric: true });
      const direct = (ids) => {
        const d = {}; ids.forEach((id) => { d[id] = { p: 0, f: 0, a: 0 }; });
        S.matches.forEach((m) => {
          if (m.stage !== 'group' || m.status === 'scheduled' || !d[m.home] || !d[m.away]) return;
          const r = H.sc(m); d[m.home].f += r.h; d[m.home].a += r.a; d[m.away].f += r.a; d[m.away].a += r.h;
          if (r.h > r.a) d[m.home].p += W; else if (r.h < r.a) d[m.away].p += W; else { d[m.home].p += D; d[m.away].p += D; }
        });
        return d;
      };
      list.sort((x, y) => y.pts - x.pts);
      const out = [];
      for (let i = 0; i < list.length;) {
        let k = i; while (k < list.length && list[k].pts === list[i].pts) k++;
        const tied = list.slice(i, k);
        if (tied.length > 1) {
          const d = direct(tied.map((r) => r.t.id));
          tied.forEach((r) => { r.dv = d[r.t.id]; });
          tied.sort((x, y) => (y.dv.p - x.dv.p) || ((y.tf - y.ta) - (x.tf - x.ta)) || (y.tf - x.tf) || byName(x, y));
        }
        out.push(...tied); i = k;
      }
      return out;
    };
    H.groupDone = (g) => { const ms = S.matches.filter((m) => m.stage === 'group' && H.inGroup(m, g)); return ms.length > 0 && ms.every((m) => m.status === 'done'); };
    H.winnerSide = (m) => {
      if (m.status !== 'done') return null;
      const r = H.sc(m); if (r.h !== r.a) return r.h > r.a ? 'h' : 'a';
      if (m.pen && m.pen.h !== m.pen.a) return m.pen.h > m.pen.a ? 'h' : 'a';
      return null;
    };
    // Platzhalter wie „1. Gruppe A“ oder „Sieger VF 2“ auflösen, sobald das Ergebnis feststeht
    H.resolvePh = (ph, depth) => {
      if (!ph || depth > 5) return null;
      let x = ph.match(/^\s*(\d+)\.\s*(?:Gruppe|Gr\.?)\s*(\S+)/i);
      if (x) {
        const g = x[2].toUpperCase(), n = +x[1];
        if (H.groupDone(g)) { const r = H.standings(g)[n - 1]; return r ? r.t : null; }
        // Schon vor Gruppenende fest, wenn der Platz rechnerisch sicher ist
        const c = H.clinch(g), id = Object.keys(c).find((k) => c[k].place === n);
        return id ? H.T(id) : null;
      }
      x = ph.match(/^\s*(Sieger|Gewinner|Verlierer)\s+(.+)$/i);
      if (x) {
        const lbl = x[2].trim().replace(/^HF\s*/i, 'Halbfinale ').replace(/^VF\s*/i, 'Viertelfinale ').toLowerCase();
        const mm = S.matches.find((m) => String(m.label || '').trim().toLowerCase() === lbl); if (!mm) return null;
        const w = H.winnerSide(mm); if (!w) return null;
        return H.teamOf(mm, /^verl/i.test(x[1]) ? (w === 'h' ? 'a' : 'h') : w, depth + 1);
      }
      return null;
    };
    /* Was ist in der Gruppe noch möglich? Für jedes Team: bester und schlechtester möglicher Platz.
       Gleichstand zählt vorsichtig (Tordifferenz unbekannt) – „sicher“ heißt also wirklich sicher. */
    const clinchMemo = {};
    H.clinch = (g) => {
      if (clinchMemo[g]) return clinchMemo[g];
      const W = +S.settings.win, D = +S.settings.draw;
      const ids = S.teams.filter((t) => (t.group || '') === g).map((t) => t.id), pts = {};
      ids.forEach((id) => { pts[id] = 0; });
      const rest = [];
      S.matches.forEach((m) => {
        if (m.stage !== 'group' || !H.inGroup(m, g)) return;
        if (m.status !== 'done') { rest.push([m.home, m.away]); return; }
        const r = H.sc(m); if (r.h > r.a) pts[m.home] += W; else if (r.h < r.a) pts[m.away] += W; else { pts[m.home] += D; pts[m.away] += D; }
      });
      const best = {}, worst = {}; ids.forEach((id) => { best[id] = ids.length; worst[id] = 1; });
      const note = (p) => ids.forEach((id) => {
        let above = 0, tie = 0; ids.forEach((o) => { if (o !== id) { if (p[o] > p[id]) above++; else if (p[o] === p[id]) tie++; } });
        best[id] = Math.min(best[id], above + 1); worst[id] = Math.max(worst[id], above + tie + 1);
      });
      if (rest.length <= 10) {
        // alle Ausgänge durchspielen (Sieg/Unentschieden/Niederlage)
        const p = Object.assign({}, pts), total = Math.pow(3, rest.length);
        for (let k = 0; k < total; k++) {
          ids.forEach((id) => { p[id] = pts[id]; });
          let c = k;
          for (const [h, a] of rest) { const o = c % 3; c = (c - o) / 3; if (o === 0) p[h] += W; else if (o === 1) p[a] += W; else { p[h] += D; p[a] += D; } }
          note(p);
        }
      } else {
        // zu viele Spiele offen: sichere Abschätzung über Mindest- und Höchstpunkte
        const left = {}; ids.forEach((id) => { left[id] = 0; }); rest.forEach(([h, a]) => { left[h]++; left[a]++; });
        ids.forEach((id) => {
          const max = pts[id] + W * left[id];
          best[id] = 1 + ids.filter((o) => o !== id && pts[o] > max).length;
          worst[id] = 1 + ids.filter((o) => o !== id && pts[o] + W * left[o] >= pts[id]).length;
        });
      }
      const N = H.qualN(), out = {};
      ids.forEach((id) => { out[id] = { best: best[id], worst: worst[id], q: N > 0 && worst[id] <= N, out: N > 0 && best[id] > N, place: best[id] === worst[id] ? best[id] : null, open: rest.length }; });
      return (clinchMemo[g] = out);
    };
    // Für den K.-o.-Baum: festes Team, vorläufiges Team (Tabellenstand/laufendes Spiel) oder offen
    H.predict = (m, side, depth) => {
      depth = depth || 0;
      const id = side === 'h' ? m.home : m.away; if (id) return { t: H.T(id), fixed: true };
      const ph = (side === 'h' ? m.homePh : m.awayPh) || '';
      const fixedT = H.resolvePh(ph, 1); if (fixedT) return { t: fixedT, fixed: true };
      if (depth > 5) return { t: null, fixed: false, ph };
      let x = ph.match(/^\s*(\d+)\.\s*(?:Gruppe|Gr\.?)\s*(\S+)/i);
      if (x) {
        const g = x[2].toUpperCase(), rows = H.standings(g), r = rows[+x[1] - 1];
        const played = S.matches.some((mm) => mm.stage === 'group' && mm.status !== 'scheduled' && H.inGroup(mm, g));
        return r && played ? { t: r.t, fixed: false, ph } : { t: null, fixed: false, ph };
      }
      x = ph.match(/^\s*(Sieger|Gewinner|Verlierer)\s+(.+)$/i);
      if (x) {
        const lbl = x[2].trim().replace(/^HF\s*/i, 'Halbfinale ').replace(/^VF\s*/i, 'Viertelfinale ').toLowerCase();
        const mm = S.matches.find((q) => String(q.label || '').trim().toLowerCase() === lbl);
        if (mm && mm.status === 'live') {
          const s = H.sc(mm);
          if (s.h !== s.a) { const lead = s.h > s.a ? 'h' : 'a', pick = /^verl/i.test(x[1]) ? (lead === 'h' ? 'a' : 'h') : lead; const p = H.predict(mm, pick, depth + 1); return { t: p.t, fixed: false, ph }; }
        }
      }
      return { t: null, fixed: false, ph };
    };
    H.teamOf = (m, side, depth) => { const id = side === 'h' ? m.home : m.away; if (id) return H.T(id); return H.resolvePh(side === 'h' ? m.homePh : m.awayPh, (depth || 0) + 1); };
    H.phOf = (m, side) => (side === 'h' ? m.homePh : m.awayPh) || 'offen';
    H.tName = (m, side) => { const t = H.teamOf(m, side); return t ? t.name : H.phOf(m, side); };

    /* Uhr (läuft rückwärts von der Spielzeit) */
    H.durOf = (m) => +m.dur || +S.settings[(PT.STAGES[m.stage] || PT.STAGES.group).d] || 10;
    H.elapsed = (m) => { const c = m.clock || {}; return Math.max(0, (c.acc || 0) + (c.run && c.since ? (PT.now() - c.since) / 1000 : 0)); };
    H.remaining = (m) => Math.max(0, H.durOf(m) * 60 - H.elapsed(m));
    H.minuteNow = (m) => Math.max(1, Math.min(H.durOf(m), Math.floor(H.elapsed(m) / 60) + 1));
    H.clockText = (m) => (m.status === 'scheduled' ? PT.pad(H.durOf(m)) + ':00' : m.status === 'done' ? 'Ende' : PT.fmt(H.remaining(m)));
    H.clockState = (m) => {
      if (m.status === 'done') return 'Abgepfiffen';
      if (m.status === 'scheduled') return H.durOf(m) + ' Min. Spielzeit';
      if (H.remaining(m) <= 0) return 'Zeit abgelaufen';
      if (!m.clock.run) return H.elapsed(m) > 0 ? 'Uhr angehalten' : 'Bereit zum Anpfiff';
      return 'Restzeit';
    };
    H.pct = (m) => (m.status === 'done' ? 100 : m.status === 'scheduled' ? 0 : Math.min(100, H.elapsed(m) / (H.durOf(m) * 60) * 100));

    /* Das Spiel, das gerade im Mittelpunkt steht (es läuft immer nur eins) */
    H.live = () => H.sorted().find((m) => m.status === 'live') || H.tests().find((m) => m.status === 'live') || null;
    H.nextScheduled = (after) => { const l = H.sorted(); const i = after ? l.indexOf(after) : -1; return l.slice(i + 1).find((m) => m.status === 'scheduled') || l.find((m) => m.status === 'scheduled') || null; };
    H.featured = () => H.live() || H.M(S.current) || H.nextScheduled() || H.sorted().filter((m) => m.status === 'done').pop() || null;

    H.playerStats = () => {
      const st = {}; S.teams.forEach((t) => t.players.forEach((p) => { st[p.id] = { p, t, g: 0, y: 0, r: 0, sp: 0 }; }));
      S.matches.forEach((m) => {
        if (m.stage === 'test') return; // Testspiele zählen nicht
        m.events.forEach((e) => { const x = st[e.player]; if (!x) return; if (e.type === 'goal') x.g++; if (e.type === 'yellow') x.y++; if (e.type === 'red') x.r++; });
        if (m.status !== 'scheduled') [m.home, m.away].forEach((id) => { const t = H.T(id); if (t) t.players.forEach((p) => { if (st[p.id]) st[p.id].sp++; }); });
      });
      return Object.values(st);
    };
    H.teamTotals = () => {
      const r = {}; S.teams.forEach((t) => { r[t.id] = { t, tf: 0, ta: 0, sp: 0 }; });
      S.matches.forEach((m) => { if (m.status === 'scheduled' || m.stage === 'test') return; const s = H.sc(m), h = r[m.home], a = r[m.away]; if (h) { h.sp++; h.tf += s.h; h.ta += s.a; } if (a) { a.sp++; a.tf += s.a; a.ta += s.h; } });
      return Object.values(r);
    };
    H.evWho = (e) => { const x = H.P(e.player); return x ? x.p.name : ''; };
    /* Voraussichtlicher Zeitplan: echte Zeiten für gespielte Spiele, „jetzt + Restzeit“ für das laufende,
       danach jeweils Wechselzeit, aber nie früher als geplant. Läuft live mit – auch wenn die Uhr steht. */
    H.plannedMs = (m) => {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(m.day || S.settings.day || ''), mins = PT.timeToMin(m.time);
      return d && mins != null ? new Date(+d[1], +d[2] - 1, +d[3], Math.floor(mins / 60), mins % 60).getTime() : null;
    };
    let tl = null, tlAt = 0;
    H.timeline = () => {
      const now = PT.now(); if (tl && now - tlAt < 900) return tl;
      const gap = (+S.settings.gap || 0) * 60000, koBreak = (+S.settings.koBreak || 0) * 60000, out = {}; let cursor = null, koSeen = false;
      H.sorted().forEach((m) => {
        const extra = PT.isKo(m) && !koSeen ? koBreak : 0; if (PT.isKo(m)) koSeen = true;
        const dur = H.durOf(m) * 60000, p = H.plannedMs(m); let start, end;
        if (m.status === 'done') { start = m.startedAt || p; end = m.endedAt || (start != null ? start + dur : null); }
        else if (m.status === 'live') { start = m.startedAt || p || now; end = now + H.remaining(m) * 1000; }
        else {
          start = p;
          if (cursor != null && start != null) start = Math.max(start, cursor + gap + extra);
          if (start != null && p != null && now > start) start = now; // überfällig: beginnt frühestens jetzt
          end = start != null ? start + dur : null;
        }
        out[m.id] = { start, end, planned: p, delay: m.status !== 'done' && start != null && p != null ? Math.max(0, Math.round((start - p) / 60000)) : 0 };
        if (end != null && (m.status !== 'done' || p == null || Math.abs(end - p) < 12 * 3600e3)) cursor = end;
      });
      H.tests().forEach((m) => { const p = H.plannedMs(m), start = m.startedAt || p; out[m.id] = { start, end: start != null ? start + H.durOf(m) * 60000 : null, planned: p, delay: 0 }; });
      tl = out; tlAt = now; return out;
    };
    const hm = (ms) => { const d = new Date(ms); return PT.pad(d.getHours()) + ':' + PT.pad(d.getMinutes()); };
    H.expTime = (m) => { const x = H.timeline()[m.id]; return x && x.start != null ? hm(x.start) : m.time; };
    H.delay = (m) => { const x = H.timeline()[m.id]; return x ? x.delay : 0; };
    H.delayHTML = (m) => { const d = H.delay(m); return `<span class="dl" data-dl="${m.id}">${d > 0 ? '+' + d : ''}</span>`; };
    H.dateText = () => S.settings.date || (S.settings.day ? new Date(S.settings.day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '');
    // Zeiten und Verspätungen auf der Seite aktualisieren (ohne alles neu zu zeichnen)
    H.tickTimes = (root) => {
      (root || document).querySelectorAll('[data-exp]').forEach((el) => { const m = H.M(el.dataset.exp); if (m) el.textContent = H.expTime(m); });
      (root || document).querySelectorAll('[data-dl]').forEach((el) => { const m = H.M(el.dataset.dl); if (m) { const d = H.delay(m); el.textContent = d > 0 ? '+' + d : ''; } });
    };
    // Laufende Zeitstrafen eines Spiels (nach Spielzeit gerechnet: hält die Uhr an, steht auch die Strafe)
    H.penalties = (m) => {
      if (!m || m.status !== 'live') return [];
      const el = H.elapsed(m);
      return m.events.filter((e) => e.type === 'red' && e.el != null && el < e.el + PT.PEN_SEC)
        .map((e) => { const x = H.P(e.player); return { e, side: e.side, name: x ? x.p.name : '', no: x ? x.p.no : null, team: x ? x.t : H.teamOf(m, e.side), left: e.el + PT.PEN_SEC - el }; });
    };
    H.penText = (m) => H.penalties(m).map((p) => `<span class="pen"><b>2′</b>${PT.esc(p.name || (p.team ? p.team.name : ''))}<em>${PT.fmt(p.left)}</em></span>`).join('');
    // Fairplay: Gelb 1 Punkt, 2-Minuten-Strafe 2 Punkte – weniger ist besser
    H.fairplay = () => {
      const r = {}; S.teams.forEach((t) => { r[t.id] = { t, y: 0, r: 0, sp: 0, pts: 0 }; });
      S.matches.forEach((m) => {
        if (m.stage === 'test' || m.status === 'scheduled') return;
        [m.home, m.away].forEach((id) => { if (r[id]) r[id].sp++; });
        m.events.forEach((e) => {
          if (e.type !== 'yellow' && e.type !== 'red') return;
          const x = H.P(e.player), id = x ? x.t.id : (e.side === 'h' ? m.home : m.away); if (!r[id]) return;
          if (e.type === 'yellow') r[id].y++; else r[id].r++;
        });
      });
      return Object.values(r).filter((x) => x.sp > 0).map((x) => Object.assign(x, { pts: x.y + 2 * x.r })).sort((a, b) => a.pts - b.pts || b.sp - a.sp || a.t.name.localeCompare(b.t.name, 'de', { numeric: true }));
    };
    H.totalGoals = () => S.matches.reduce((n, m) => { if (m.stage === 'test') return n; const s = H.sc(m); return n + s.h + s.a; }, 0);
    return H;
  };

  /* ---------- Spielplan erstellen: 2 Gruppen, ein Feld, Spiele nacheinander ----------
     Aufbau: abwechselnd ein Block mit einer ganzen Runde Gruppe A (3 Spiele, jedes Team einmal), dann ein Block Gruppe B.
     Für 6er-Gruppen ist Reihenfolge und Position im Block so berechnet (alle Möglichkeiten durchprobiert), dass jedes Team
     zwischen zwei eigenen Spielen immer 4 bis 6 Spiele Pause hat – mehr Mindestpause geht mathematisch nicht (5 Spiele
     Pause für alle ist unmöglich). Wer spielt, ist also regelmäßig dran, und niemand wartet ewig. */
  const SIX = [[[0, 1], [2, 3], [4, 5]], [[0, 2], [1, 4], [3, 5]], [[2, 4], [0, 3], [1, 5]], [[0, 4], [2, 5], [1, 3]], [[0, 5], [3, 4], [1, 2]]];
  function roundRobin(ids) {
    const list = ids.slice(); if (list.length % 2) list.push(null);
    const n = list.length, rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const ms = [];
      for (let i = 0; i < n / 2; i++) {
        const a = list[i], b = list[n - 1 - i];
        if (a && b) ms.push([a, b]);
      }
      rounds.push(ms);
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }
  // Heim/Gast so verteilen, dass jedes Team etwa gleich oft Heim ist und möglichst abwechselnd
  const homeMemo = {};
  function balanceHome(rounds) {
    const ms = [].concat(...rounds), n = ms.length;
    if (n > 18) return rounds;
    const mk = JSON.stringify(rounds); if (homeMemo[mk]) return homeMemo[mk];
    let best = null, bestCost = Infinity;
    for (let mask = 0; mask < (1 << n); mask++) {
      const home = {}, last = {}; let cost = 0;
      for (let i = 0; i < n; i++) {
        const [a, b] = (mask >> i) & 1 ? [ms[i][1], ms[i][0]] : ms[i];
        home[a] = (home[a] || 0) + 1; home[b] = home[b] || 0;
        if (last[a] === 'h') cost += 1; if (last[b] === 'a') cost += 1;
        last[a] = 'h'; last[b] = 'a';
      }
      const cnt = {}; ms.forEach(([a, b]) => { cnt[a] = (cnt[a] || 0) + 1; cnt[b] = (cnt[b] || 0) + 1; });
      Object.keys(cnt).forEach((k) => { cost += 10 * Math.max(0, Math.abs(home[k] - cnt[k] / 2) - 0.5); });
      if (cost < bestCost) { bestCost = cost; best = mask; if (!cost) break; }
    }
    let i = 0;
    return (homeMemo[mk] = rounds.map((r) => r.map((m) => ((best >> i++) & 1 ? [m[1], m[0]] : m))));
  }
  function groupRounds(ids) {
    if (ids.length === 6) return balanceHome(SIX.map((r) => r.map(([a, b]) => [ids[a], ids[b]])));
    return balanceHome(roundRobin(ids));
  }
  PT.isKo = (m) => m && m.stage !== 'group' && m.stage !== 'test';
  PT.genSchedule = (S) => {
    const st = S.settings, groups = [...new Set(S.teams.map((t) => t.group || ''))].sort();
    const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true });
    const rr = groups.map((g) => groupRounds(S.teams.filter((t) => (t.group || '') === g).sort(byName).map((t) => t.id)));
    const out = [];
    const maxRounds = Math.max(0, ...rr.map((r) => r.length));
    for (let r = 0; r < maxRounds; r++) rr.forEach((x, gi) => (x[r] || []).forEach((p) => out.push({ stage: 'group', label: groups[gi] ? 'Gruppe ' + groups[gi] : 'Vorrunde', home: p[0], away: p[1], homePh: '', awayPh: '' })));
    const ko = (stage, label, h, a) => out.push({ stage, label, home: null, away: null, homePh: h, awayPh: a });
    if (groups.length >= 2) {
      const [A, B] = groups;
      if (st.koFormat === 'sf') {
        ko('sf', 'Halbfinale 1', '1. Gruppe ' + A, '2. Gruppe ' + B);
        ko('sf', 'Halbfinale 2', '1. Gruppe ' + B, '2. Gruppe ' + A);
      } else {
        ko('qf', 'Viertelfinale 1', '1. Gruppe ' + A, '4. Gruppe ' + B);
        ko('qf', 'Viertelfinale 2', '2. Gruppe ' + B, '3. Gruppe ' + A);
        ko('qf', 'Viertelfinale 3', '1. Gruppe ' + B, '4. Gruppe ' + A);
        ko('qf', 'Viertelfinale 4', '2. Gruppe ' + A, '3. Gruppe ' + B);
        ko('sf', 'Halbfinale 1', 'Sieger VF 1', 'Sieger VF 2');
        ko('sf', 'Halbfinale 2', 'Sieger VF 3', 'Sieger VF 4');
      }
      if (st.third) ko('third', 'Spiel um Platz 3', 'Verlierer HF 1', 'Verlierer HF 2');
      ko('final', 'Finale', 'Sieger HF 1', 'Sieger HF 2');
    }
    let t = PT.timeToMin(st.start) ?? 690, koSeen = false;
    return out.map((m, i) => {
      if (PT.isKo(m) && !koSeen) { koSeen = true; if (i) t += +st.koBreak || 0; }
      const dur = +st[PT.STAGES[m.stage].d] || 10;
      const r = Object.assign({ id: 'm' + (i + 1), no: i + 1, time: PT.minToTime(t), status: 'scheduled', clock: { run: false, since: null, acc: 0 }, events: [], pen: null, dur: null }, m);
      t += dur + (+st.gap || 0);
      return r;
    });
  };
  // Uhrzeiten neu berechnen (z. B. nach geänderten Spielzeiten)
  PT.retime = (S) => {
    const H = PT.make(S); let t = PT.timeToMin(S.settings.start) ?? 690, koSeen = false;
    H.sorted().forEach((m, i) => {
      if (PT.isKo(m) && !koSeen) { koSeen = true; if (i) t += +S.settings.koBreak || 0; }
      m.time = PT.minToTime(t); t += H.durOf(m) + (+S.settings.gap || 0);
    });
  };

  /* ---------- Daten laden ---------- */
  PT.fetchState = async (fresh) => {
    const r = await fetch('/api/state' + (fresh ? '?fresh=1&t=' + Date.now() : ''), { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Status ' + r.status), { status: r.status, setup: j.setup });
    return PT.normalize(j.state);
  };

  root.PT = PT;
  if (typeof module !== 'undefined' && module.exports) module.exports = PT;
})(typeof window !== 'undefined' ? window : globalThis);
