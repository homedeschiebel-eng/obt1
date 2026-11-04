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
  PT.monoHTML = (t, cls) => t
    ? `<span class="mono ${cls || ''}" style="--c:${PT.esc(t.color)}">${t.logo ? `<img src="${PT.esc(t.logo)}" alt="">` : PT.esc(PT.initials(t.name))}</span>`
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
    final: { l: 'Finale', d: 'durFinal' }
  };
  PT.LEVELS = ['Hauptsponsor', 'Premium-Partner', 'Partner', 'Förderer'];
  PT.EV = { goal: 'Tor', og: 'Eigentor', yellow: 'Gelbe Karte', red: 'Rote Karte' };

  PT.normalize = (S) => {
    S = S || {};
    S.settings = Object.assign({ title: 'Oberstufen-Turnier', school: 'Parler-Gymnasium', season: '', date: '', location: '', sport: 'Fußball', ticker: '', start: '09:00', gap: 2, koFormat: 'qf', third: true, win: 3, draw: 1, durGroup: 7, durKo: 10, durFinal: 12 }, S.settings || {});
    S.teams = S.teams || []; S.matches = S.matches || []; S.sponsors = S.sponsors || [];
    S.teams.forEach((t) => { t.players = t.players || []; });
    S.matches.forEach((m) => { m.events = m.events || []; m.clock = m.clock || { run: false, since: null, acc: 0 }; });
    S.rev = S.rev || 0;
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
    H.sorted = () => S.matches.slice().sort((a, b) => (a.no || 0) - (b.no || 0) || String(a.time).localeCompare(String(b.time)));
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
      return Object.values(rows).sort((x, y) => y.pts - x.pts || (y.tf - y.ta) - (x.tf - x.ta) || y.tf - x.tf || x.t.name.localeCompare(y.t.name, 'de', { numeric: true }));
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
      if (x) { const g = x[2].toUpperCase(); if (!H.groupDone(g)) return null; const r = H.standings(g)[+x[1] - 1]; return r ? r.t : null; }
      x = ph.match(/^\s*(Sieger|Gewinner|Verlierer)\s+(.+)$/i);
      if (x) {
        const lbl = x[2].trim().replace(/^HF\s*/i, 'Halbfinale ').replace(/^VF\s*/i, 'Viertelfinale ').toLowerCase();
        const mm = S.matches.find((m) => String(m.label || '').trim().toLowerCase() === lbl); if (!mm) return null;
        const w = H.winnerSide(mm); if (!w) return null;
        return H.teamOf(mm, /^verl/i.test(x[1]) ? (w === 'h' ? 'a' : 'h') : w, depth + 1);
      }
      return null;
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
    H.live = () => H.sorted().find((m) => m.status === 'live') || null;
    H.nextScheduled = (after) => { const l = H.sorted(); const i = after ? l.indexOf(after) : -1; return l.slice(i + 1).find((m) => m.status === 'scheduled') || l.find((m) => m.status === 'scheduled') || null; };
    H.featured = () => H.live() || H.M(S.current) || H.nextScheduled() || H.sorted().filter((m) => m.status === 'done').pop() || null;

    H.playerStats = () => {
      const st = {}; S.teams.forEach((t) => t.players.forEach((p) => { st[p.id] = { p, t, g: 0, y: 0, r: 0, sp: 0 }; }));
      S.matches.forEach((m) => {
        m.events.forEach((e) => { const x = st[e.player]; if (!x) return; if (e.type === 'goal') x.g++; if (e.type === 'yellow') x.y++; if (e.type === 'red') x.r++; });
        if (m.status !== 'scheduled') [m.home, m.away].forEach((id) => { const t = H.T(id); if (t) t.players.forEach((p) => { if (st[p.id]) st[p.id].sp++; }); });
      });
      return Object.values(st);
    };
    H.teamTotals = () => {
      const r = {}; S.teams.forEach((t) => { r[t.id] = { t, tf: 0, ta: 0, sp: 0 }; });
      S.matches.forEach((m) => { if (m.status === 'scheduled') return; const s = H.sc(m), h = r[m.home], a = r[m.away]; if (h) { h.sp++; h.tf += s.h; h.ta += s.a; } if (a) { a.sp++; a.tf += s.a; a.ta += s.h; } });
      return Object.values(r);
    };
    H.evWho = (e) => { const x = H.P(e.player); return x ? x.p.name : ''; };
    H.totalGoals = () => S.matches.reduce((n, m) => { const s = H.sc(m); return n + s.h + s.a; }, 0);
    return H;
  };

  /* ---------- Spielplan erstellen: 2 Gruppen, ein Feld, Spiele nacheinander ---------- */
  function roundRobin(ids) {
    const list = ids.slice(); if (list.length % 2) list.push(null);
    const n = list.length, rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const ms = [];
      for (let i = 0; i < n / 2; i++) {
        const a = list[i], b = list[n - 1 - i];
        if (a && b) ms.push(r % 2 ? [b, a] : [a, b]);
      }
      rounds.push(ms);
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }
  PT.genSchedule = (S) => {
    const st = S.settings, groups = [...new Set(S.teams.map((t) => t.group || ''))].sort();
    const rr = groups.map((g) => roundRobin(S.teams.filter((t) => (t.group || '') === g).map((t) => t.id)));
    const out = [];
    const maxRounds = Math.max(0, ...rr.map((r) => r.length));
    for (let r = 0; r < maxRounds; r++) {
      const maxM = Math.max(0, ...rr.map((x) => (x[r] || []).length));
      for (let i = 0; i < maxM; i++) rr.forEach((x, gi) => { const p = (x[r] || [])[i]; if (p) out.push({ stage: 'group', label: groups[gi] ? 'Gruppe ' + groups[gi] : 'Vorrunde', home: p[0], away: p[1], homePh: '', awayPh: '' }); });
    }
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
    let t = PT.timeToMin(st.start) ?? 540;
    return out.map((m, i) => {
      const dur = +st[PT.STAGES[m.stage].d] || 10;
      const r = Object.assign({ id: 'm' + (i + 1), no: i + 1, time: PT.minToTime(t), status: 'scheduled', clock: { run: false, since: null, acc: 0 }, events: [], pen: null, dur: null }, m);
      t += dur + (+st.gap || 0);
      return r;
    });
  };
  // Uhrzeiten neu berechnen (z. B. nach geänderten Spielzeiten)
  PT.retime = (S) => {
    const H = PT.make(S); let t = PT.timeToMin(S.settings.start) ?? 540;
    H.sorted().forEach((m) => { m.time = PT.minToTime(t); t += H.durOf(m) + (+S.settings.gap || 0); });
  };

  /* ---------- Daten laden ---------- */
  PT.fetchState = async (fresh) => {
    const r = await fetch('/api/state' + (fresh ? '?fresh=1&t=' + Date.now() : ''), { cache: fresh ? 'no-store' : 'default' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'Status ' + r.status), { status: r.status, setup: j.setup });
    return PT.normalize(j.state);
  };

  root.PT = PT;
  if (typeof module !== 'undefined' && module.exports) module.exports = PT;
})(typeof window !== 'undefined' ? window : globalThis);
