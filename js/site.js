/* Zuschauerseite: zeigt den Turnierstand und lädt alle 2 Sekunden neu */
(function () {
  'use strict';
  const { esc, monoHTML, initials, STAGES, LEVELS, EV, safeUrl } = PT;
  const app = document.getElementById('app');
  let S = null, H = null, online = true;
  const ui = { filter: 'all', stTeam: 'all' };
  /* ---------- Adressen ohne # ----------
     /  ·  /spielplan  ·  /tabelle  ·  /k-o-baum  ·  /statistiken  ·  /fairplay  ·  /voting  ·  /teams  ·  /teams/gräter-fürth  ·  /partner  ·  /spiel/5 */
  const PAGES = ['spielplan', 'tabelle', 'statistiken', 'fairplay', 'voting', 'teams', 'partner'];
  const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
  function slugs() { const out = {}, used = {}; (S ? S.teams : []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach((t) => { let s = slug(t.name); if (used[s]) s += '-' + (++used[s]); else used[s] = 1; out[t.id] = s; }); return out; }
  // Bereich → Adresse
  function P(key) {
    if (!key || key === 'live') return '/';
    if (key === 'baum') return '/k-o-baum';
    if (key.startsWith('team-')) { const id = key.slice(5); return '/teams/' + (slugs()[id] || id); }
    if (key.startsWith('spiel-')) { const m = H && H.M(key.slice(6)); return '/spiel/' + (m && m.no && !H.isTest(m) ? m.no : key.slice(6)); }
    return '/' + key;
  }
  // Adresse → Bereich
  const route = () => {
    let p = '/'; try { p = decodeURIComponent(location.pathname); } catch (e) { p = location.pathname; }
    p = p.replace(/\/+$/, '') || '/';
    if (p === '/') return 'live';
    if (p === '/k-o-baum') return 'baum';
    let m = /^\/teams\/(.+)$/.exec(p);
    if (m) { const s = m[1].toLowerCase(), map = slugs(), id = Object.keys(map).find((k) => map[k] === s) || (S && S.teams.some((t) => t.id === m[1]) ? m[1] : null); return 'team-' + (id || '?'); }
    m = /^\/spiel\/(.+)$/.exec(p);
    if (m) { const x = S && S.matches.find((y) => String(y.no) === m[1] && y.stage !== 'test') || (S && S.matches.find((y) => y.id === m[1])); return 'spiel-' + (x ? x.id : '?'); }
    const k = p.slice(1); return PAGES.includes(k) ? k : 'live';
  };
  const isSitePath = (p) => p === '/' || /^\/(spielplan|tabelle|k-o-baum|statistiken|fairplay|voting|teams|partner)$/.test(p) || /^\/(teams|spiel)\/[^/]+$/.test(p);
  function go(url) { history.pushState(null, '', url); closeMenu(); render(); scrollTo(0, 0); }
  // alte Links mit # (z. B. /#spielplan, /#team-t1) auf neue Adressen umstellen
  function fixOldHash() { const h = location.hash.replace('#', ''); if (h && (h === 'live' || h === 'baum' || PAGES.includes(h) || /^(team|spiel)-/.test(h))) history.replaceState(null, '', P(h)); }

  /* ---------- Bausteine ---------- */
  const clockHTML = (m, big) => `<span class="clk${big ? ' big' : ''}" data-clock="${m.id}">${H.clockText(m)}</span>`;
  const stateHTML = (m) => `<span class="cstate${m.status === 'live' && H.remaining(m) <= 0 ? ' over' : ''}" data-cstate="${m.id}">${H.clockState(m)}</span>`;
  const barHTML = (m) => `<div class="bar"><i data-bar="${m.id}" style="width:${H.pct(m)}%"></i></div>`;
  const evText = (e) => esc(H.evWho(e) || EV[e.type]) + (e.type === 'og' ? ' (ET)' : '');

  function stageHero(m, opts) {
    opts = opts || {};
    if (!m) return `<section class="stage"><div class="wrap"><div class="stage-top"><span>${esc(S.settings.school)} · SMV präsentiert</span></div><h1 style="font-size:clamp(46px,8vw,90px)">${esc(S.settings.title)}</h1><div class="nextline">${S.settings.planHidden ? 'Gruppen und Spielplan kommen am ' + esc(((m) => m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) : 'bald')(/^(\d{4})-(\d{2})-(\d{2})/.exec(S.settings.planPublicAt || ''))) + '.' : 'Der Spielplan ist noch leer.'}</div></div></section>`;
    const r = H.sc(m), h = H.teamOf(m, 'h'), a = H.teamOf(m, 'a');
    const tb = (t, side) => `<a class="tb" href="${t ? P('team-' + t.id) : P('spiel-' + m.id)}">${monoHTML(t, 'xl')}<b>${esc(t ? t.name : H.phOf(m, side))}</b><small>${esc(t ? (t.cls || (t.group ? 'Gruppe ' + t.group : '')) : 'steht noch nicht fest')}</small></a>`;
    const evs = (side) => `<ul>${m.events.filter((e) => e.side === side).sort((x, y) => (x.min || 0) - (y.min || 0)).map((e) => `<li>${side === 'h' ? `<span class="mi">${esc(e.min || '')}′</span><i class="ic ${e.type}"></i>${evText(e)}` : `${evText(e)}<i class="ic ${e.type}"></i><span class="mi">${esc(e.min || '')}′</span>`}</li>`).join('')}</ul>`;
    let top;
    if (m.status === 'live') top = `<span class="livechip">Live</span>`;
    else if (m.status === 'done') top = `<b>Endstand</b>`;
    else top = `<b>Nächstes Spiel · ca. <span data-exp="${m.id}">${H.expTime(m)}</span> Uhr ${H.delayHTML(m)}</b>`;
    const nxt = H.nextScheduled(m);
    return `<section class="stage"><div class="wrap">
      <div class="stage-top"><span>${H.isTest(m) ? 'Testspiel · ' + esc(H.dayText(m)) + (m.label && m.label !== 'Testspiel' ? ' · ' + esc(m.label) : '') : 'Spiel ' + esc(m.no || '') + ' · ' + esc(m.label || STAGES[m.stage].l)}</span>${top}</div>
      <div class="sb">${tb(h, 'h')}<div class="score">${m.status === 'scheduled' ? '<span class="vs">VS</span>' : `<span>${r.h}</span><i>:</i><span>${r.a}</span>`}</div>${tb(a, 'a')}</div>
      ${m.pen ? `<div class="nextline">${m.pen.h}:${m.pen.a} nach Neunmeterschießen</div>` : ''}
      <div class="sb-clock">${clockHTML(m, true)}${stateHTML(m)}</div>${barHTML(m)}
      <div class="pens" data-pens="${m.id}">${H.penText(m)}</div>
      ${m.events.length ? `<div class="sb-ev">${evs('h')}${evs('a')}</div>` : ''}
      ${opts.next !== false && nxt && nxt !== m ? `<div class="nextline">Danach: <b>${esc(H.tName(nxt, 'h'))} – ${esc(H.tName(nxt, 'a'))}</b><span>ca. <span data-exp="${nxt.id}">${H.expTime(nxt)}</span> Uhr ${H.delayHTML(nxt)} · ${esc(nxt.label)}</span></div>` : ''}
    </div></section>`;
  }

  function planRow(m) {
    const r = H.sc(m), w = H.winnerSide(m);
    const side = (s) => { const t = H.teamOf(m, s); return `<span class="sd ${s}${t ? '' : ' ph'}${w && w !== s ? ' lost' : ''}">${s === 'h' ? `<span class="nm">${esc(t ? t.name : H.phOf(m, s))}</span>${monoHTML(t, 's')}` : `${monoHTML(t, 's')}<span class="nm">${esc(t ? t.name : H.phOf(m, s))}</span>`}</span>`; };
    let res;
    if (m.status === 'live') res = `<span class="res live">${r.h}:${r.a}<small data-clock="${m.id}">${H.clockText(m)}</small></span>`;
    else if (m.status === 'done') res = `<span class="res">${r.h}:${r.a}${m.pen ? `<small>${m.pen.h}:${m.pen.a} n.N.</small>` : ''}</span>`;
    else res = `<span class="res pending">– : –</span>`;
    return `<a class="pr ${m.status}" href="${P('spiel-' + m.id)}"><span class="meta"><span class="no">${H.isTest(m) ? 'T' : esc(m.no || '')}</span><span class="tm"><span data-exp="${m.id}">${H.expTime(m)}</span>${m.status === 'done' ? '' : H.delayHTML(m)}</span><span class="rd">${H.isTest(m) ? esc(H.dayText(m)) + '<br>' : ''}${esc(m.label || STAGES[m.stage].l)}</span></span>${side('h')}${res}${side('a')}</a>`;
  }

  function standTable(g, compact) {
    const rows = H.standings(g);
    if (!rows.length) return `<div class="empty">Noch keine Teams${g ? ' in Gruppe ' + esc(g) : ''}.</div>`;
    const qn = H.qualN(), c = compact ? ' c' : '', cl = H.clinch(g), done = H.groupDone(g);
    const tags = (id) => { const x = cl[id]; if (!x || done) return ''; return (x.q ? `<abbr class="tag q" title="Sicher in der K.-o.-Phase">Q</abbr>` : '') + (x.out ? `<abbr class="tag a" title="Sicher ausgeschieden">A</abbr>` : '') + (x.place ? `<abbr class="tag p" title="Platz ${x.place} ist sicher">P</abbr>` : ''); };
    const row = (r, i) => `<a class="st-r${c}${i < qn ? ' q' : ''}" href="${P('team-' + r.t.id)}"><span>${i + 1}</span><span class="club">${monoHTML(r.t, 's')}<span class="nm">${esc(r.t.name)}</span>${tags(r.t.id)}${r.live ? '<span class="lvd" title="spielt gerade"></span>' : ''}</span><span>${r.sp}</span>${compact ? '' : `<span class="x">${r.s}</span><span class="x">${r.u}</span><span class="x">${r.n}</span>`}<span>${r.tf}:${r.ta}</span><span>${r.tf - r.ta > 0 ? '+' : ''}${r.tf - r.ta}</span><span class="pts">${r.pts}</span></a>`;
    const head = `<div class="st-h${c}"><span>#</span><span>Team</span><span>Sp</span>${compact ? '' : '<span class="x">S</span><span class="x">U</span><span class="x">N</span>'}<span>Tore</span><span>Diff</span><span>Pkt</span></div>`;
    return `<div class="stand">${head}${qn ? `<div class="qgrp"><span class="ql">${H.qualLabel()}</span>${rows.slice(0, qn).map(row).join('')}</div>` : ''}${rows.slice(qn).map((r, i) => row(r, i + qn)).join('')}</div>`;
  }
  function perfCard(title, items) {
    return `<div class="perf"><div class="perf-h"><h3>${title}</h3>${items[0] ? `<div class="top">${monoHTML(items[0].t, 'l')}<b>${items[0].v}</b></div>` : ''}</div>
    ${items.length ? `<ol>${items.slice(0, 5).map((x, i) => `<li><span class="n">${i + 1}</span>${monoHTML(x.t, 's')}<span><b>${esc(x.name)}</b><small>${esc(x.sub)}</small></span><span class="v">${x.v}</span></li>`).join('')}</ol>` : `<div class="none">Sobald gespielt wird, erscheint hier die Rangliste.</div>`}</div>`;
  }
  function performers() {
    const ps = H.playerStats().filter((x) => x.g > 0).sort((a, b) => b.g - a.g || a.p.name.localeCompare(b.p.name)).map((x) => ({ t: x.t, name: x.p.name, sub: x.t.name, v: x.g }));
    const tt = H.teamTotals().filter((x) => x.sp > 0);
    const att = tt.slice().sort((a, b) => b.tf - a.tf || a.ta - b.ta).map((x) => ({ t: x.t, name: x.t.name, sub: x.sp + ' Spiele', v: x.tf }));
    const def = tt.slice().sort((a, b) => a.ta - b.ta || b.tf - a.tf).map((x) => ({ t: x.t, name: x.t.name, sub: x.sp + ' Spiele', v: x.ta }));
    return `<div class="grid3">${perfCard('Top-Torschützen', ps)}${perfCard('Bester Angriff', att)}${perfCard('Beste Abwehr', def)}</div>`;
  }
  const spLogo = (s) => (s.logo ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}">` : `<span class="wm">${esc(s.name)}</span>`);
  // Logo eines Partners; mit Website-Adresse ein Link dorthin (neuer Tab), sonst nur das Logo
  const partnerLink = (s) => { const u = safeUrl(s.url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(s.name)}" aria-label="${esc(s.name)} – Website öffnen">${spLogo(s)}</a>` : `<span title="${esc(s.name)}">${spLogo(s)}</span>`; };
  function partnersBand() {
    if (!S.sponsors.length) return '';
    const by = (l) => S.sponsors.filter((s) => s.level === l);
    const main = by('Hauptsponsor'), mid = [...by('Premium-Partner'), ...by('Partner')], small = S.sponsors.filter((s) => !main.includes(s) && !mid.includes(s));
    const row = (l, c) => (l.length ? `<div class="prow ${c}">${l.map(partnerLink).join('')}</div>` : '');
    return `<section class="unterstuetzer"><div class="wrap"><h2>Partner</h2>${row(main, 'main')}${row(mid, '')}${row(small, 'small')}</div></section>`;
  }

  /* ---------- Ansichten ---------- */
  // Vor dem Veröffentlichungstermin liefert der Server keine Gruppen und keinen Spielplan
  const planHidden = () => !!(S && S.settings.planHidden);
  function hiddenNote() {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(S.settings.planPublicAt || '');
    const when = m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) + (m[4] + m[5] !== '0000' ? ', ' + m[4] + ':' + m[5] + ' Uhr' : '') : 'bald';
    return `<div class="empty">📅 Gruppen und Spielplan werden am <b>${esc(when)}</b> veröffentlicht. Bis dahin findet ihr hier schon alle <a href="/teams">Teams</a>.</div>`;
  }
  function vLive() {
    if (planHidden()) return { hero: stageHero(H.featured()), main: `${voteCard()}<section><h2 class="sh">Spielplan &amp; Gruppen</h2>${hiddenNote()}</section>` };
    const f = H.featured(), list = H.sorted();
    const up = list.filter((m) => m.status === 'scheduled' && m !== f).slice(0, 5);
    const done = list.filter((m) => m.status === 'done' && m !== f).slice(-5).reverse();
    return {
      hero: stageHero(f),
      main: `${voteCard()}
      <div class="grid2">
        <section><h2 class="sh">Nächste Spiele <a href="/spielplan">Spielplan</a></h2>${up.length ? `<div class="plan">${up.map(planRow).join('')}</div>` : '<div class="empty">Keine weiteren Spiele geplant.</div>'}</section>
        <section><h2 class="sh">Letzte Ergebnisse <a href="/spielplan">Alle</a></h2>${done.length ? `<div class="plan">${done.map(planRow).join('')}</div>` : '<div class="empty">Noch keine Ergebnisse.</div>'}</section>
      </div>
      <section><h2 class="sh">Tabellen <a href="/tabelle">Ausführlich</a></h2><div class="grid2">${H.groups().map((g) => `<div>${H.groups().length > 1 ? `<h3 class="gname" style="font-size:26px">Gruppe ${esc(g)}</h3>` : ''}${standTable(g, true)}</div>`).join('')}</div></section>
      <section><h2 class="sh">Top-Performer <a href="/statistiken">Alle Statistiken</a></h2>${performers()}</section>`
    };
  }
  function vSchedule() {
    if (planHidden()) return `<section>${hiddenNote()}</section>`;
    const f = ui.filter;
    const labels = [...new Set(S.matches.filter((m) => m.stage === 'group').map((m) => m.label))].sort();
    const chips = [['all', 'Alle Spiele'], ...labels.map((l) => [l, l]), ['ko', 'Finalrunde']];
    const list = H.sorted().filter((m) => f === 'all' || (f === 'ko' ? m.stage !== 'group' : m.label === f));
    const grp = list.filter((m) => m.stage === 'group'), ko = list.filter((m) => m.stage !== 'group');
    const tests = H.tests();
    return `<section><div class="tabs">${chips.map(([k, l]) => `<button data-act="filter" data-f="${esc(k)}" aria-pressed="${f === k}">${esc(l)}</button>`).join('')}</div>
      ${tests.length && f === 'all' ? `<h2 class="sh">Testspiele <small>zählen nicht für Tabelle und Statistik</small></h2><div class="plan" style="margin-bottom:30px">${tests.map(planRow).join('')}</div>` : ''}
      ${grp.length ? `<h2 class="sh">Gruppenphase <small>${esc(S.settings.durGroup)} Min. pro Spiel</small></h2><div class="plan">${grp.map(planRow).join('')}</div>` : ''}
      ${ko.length ? `<h2 class="sh" style="margin-top:30px">Finalrunde <small>K.-o. ${esc(S.settings.durKo)} Min. · Halbfinale & Finale ${esc(S.settings.durFinal)} Min.</small></h2><div class="plan">${ko.map(planRow).join('')}</div>` : ''}
      ${list.length ? '' : '<div class="empty">Keine Spiele in dieser Auswahl.</div>'}
      <p class="legend">Alle Spiele finden nacheinander auf einem Feld statt. Die Uhrzeiten passen sich live an: Bei Verspätung verschiebt sich der Plan automatisch, die Verspätung steht gelb daneben.</p></section>`;
  }
  const tableTabs = (cur) => `<div class="tabs"><a class="tablink" href="/tabelle"${cur === 'tabelle' ? ' aria-current="page"' : ''}>Gruppen</a><a class="tablink" href="/k-o-baum"${cur === 'baum' ? ' aria-current="page"' : ''}>K.-o.-Baum</a></div>`;
  function vTable() {
    if (planHidden()) return `${tableTabs('tabelle')}${hiddenNote()}`;
    const multi = H.groups().length > 1;
    return `${tableTabs('tabelle')}${H.groups().map((g) => `<section>${multi ? `<h2 class="gname">Gruppe ${esc(g)}</h2>` : ''}${standTable(g, false)}</section>`).join('')}
    <div class="legend">${multi ? `Die ersten ${H.qualN()} jeder Gruppe ziehen ins <b>${H.qualLabel()}</b> ein. ` : ''}Punkte: Sieg ${esc(S.settings.win)}, Unentschieden ${esc(S.settings.draw)}. Bei Punktgleichheit entscheidet zuerst der direkte Vergleich, dann die Tordifferenz, dann die Zahl der Tore.<br><abbr class="tag q">Q</abbr> sicher in der K.-o.-Phase · <abbr class="tag p">P</abbr> Platz sicher · <abbr class="tag a">A</abbr> sicher ausgeschieden – egal wie die restlichen Spiele ausgehen.${S.matches.some((m) => m.status === 'live') ? '<br>Ein roter Punkt heißt: Das Team spielt gerade, der aktuelle Stand ist schon eingerechnet.' : ''}</div>`;
  }
  function vBracket() {
    if (planHidden()) return `${tableTabs('baum')}${hiddenNote()}`;
    const ko = H.sorted().filter((m) => m.stage !== 'group');
    if (!ko.length) return `${tableTabs('baum')}<div class="empty">Es ist noch keine Finalrunde geplant.</div>`;
    const cols = [['qf', 'Viertelfinale'], ['sf', 'Halbfinale'], ['final', 'Finale']].map(([k, l]) => [l, ko.filter((m) => m.stage === k)]).filter((x) => x[1].length);
    const third = ko.filter((m) => m.stage === 'third');
    const box = (m) => {
      const r = H.sc(m), w = H.winnerSide(m), started = m.status !== 'scheduled';
      const row = (side) => { const p = H.predict(m, side), t = p.t; const cls = t ? (p.fixed ? 'fixed' : 'prov') : 'open'; return `<div class="bx-t ${cls}${w ? (w === side ? ' win' : ' lost') : ''}">${monoHTML(t, 's')}<span class="nm">${esc(t ? t.name : (p.ph || H.phOf(m, side)))}</span>${started ? `<b class="sc">${r[side]}</b>` : (t && !p.fixed ? '<small class="pv">vorläufig</small>' : '')}</div>`; };
      return `<a class="bx${m.status === 'live' ? ' live' : ''}" href="${P('spiel-' + m.id)}"><div class="bx-h"><span>${esc(m.label)}</span><span>${m.status === 'live' ? '<span class="livechip">Live</span>' : m.status === 'done' ? 'Endstand' + (m.pen ? ' · ' + m.pen.h + ':' + m.pen.a + ' n.N.' : '') : 'ca. <span data-exp="' + m.id + '">' + H.expTime(m) + '</span> Uhr'}</span></div>${row('h')}${row('a')}</a>`;
    };
    const fin = ko.find((m) => m.stage === 'final'), champ = fin && H.winnerSide(fin) ? H.teamOf(fin, H.winnerSide(fin)) : null;
    return `${tableTabs('baum')}
      ${champ ? `<div class="champ">${monoHTML(champ, 'l')}<div><small>Turniersieger ${esc(S.settings.season || '')}</small><b>${esc(champ.name)}</b></div></div>` : ''}
      <div class="br-wrap"><div class="bracket" style="--cols:${cols.length}">${cols.map(([l, ms], i) => `<div class="br-col${i === cols.length - 1 ? ' last' : ''}"><h3>${l}</h3><div class="br-list">${ms.map(box).join('')}</div></div>`).join('')}</div></div>
      ${third.length ? `<h2 class="sh" style="margin-top:26px">Spiel um Platz 3</h2><div class="br-third">${third.map(box).join('')}</div>` : ''}
      <div class="legend"><span class="lg-fixed">Team steht fest</span> · <span class="lg-prov">vorläufig</span> = nach aktuellem Tabellenstand bzw. Zwischenstand des laufenden Spiels · grau = noch offen.<br>Der Baum aktualisiert sich live.</div>`;
  }
  const statTabs = (cur) => `<div class="tabs"><a class="tablink" href="/statistiken"${cur === 'statistiken' ? ' aria-current="page"' : ''}>Spieler</a><a class="tablink" href="/fairplay"${cur === 'fairplay' ? ' aria-current="page"' : ''}>Fairplay</a>${S.settings.vote && S.settings.vote !== 'off' ? `<a class="tablink" href="/voting"${cur === 'voting' ? ' aria-current="page"' : ''}>Spieler des Turniers</a>` : ''}</div>`;
  function vFair() {
    const l = H.fairplay();
    return `${statTabs('fairplay')}${l.length ? `<div class="plist"><div class="ph fp"><span>#</span><span style="text-align:left">Team</span><span class="x">Spiele</span><span>Gelb</span><span>2 Min.</span><span>Punkte</span></div>${l.map((x, i) => `<a class="ps fp" href="${P('team-' + x.t.id)}"><span class="rk">${i + 1}</span><span class="who">${monoHTML(x.t, 's')}<span><b>${esc(x.t.name)}</b><small>${esc(x.t.group ? 'Gruppe ' + x.t.group : '')}</small></span></span><span class="x">${x.sp}</span><span>${x.y}</span><span>${x.r}</span><span class="big">${x.pts}</span></a>`).join('')}</div>` : '<div class="empty">Die Fairplay-Wertung startet mit dem ersten Spiel.</div>'}
      <p class="legend">Gelbe Karte = 1 Punkt · 2-Minuten-Strafe = 2 Punkte. Wenige Punkte = fair. Testspiele zählen nicht.</p>`;
  }
  /* ---------- Voting „Spieler des Turniers“ ---------- */
  const vt = { data: null, at: 0, msg: '', q: '', pick: null };
  const voterId = () => { try { let v = localStorage.getItem('pt-voter'); if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^A-Za-z0-9_-]/g, ''); localStorage.setItem('pt-voter', v); } return v; } catch (e) { return 'g' + Math.random().toString(36).slice(2) + Date.now().toString(36); } };
  const votedFor = () => { try { return localStorage.getItem('pt-voted-' + (S.settings.voteRound || 'r1')); } catch (e) { return null; } };
  async function loadVotes(force) {
    if (!force && Date.now() - vt.at < 5000) return;
    vt.at = Date.now();
    try { const r = await fetch('/api/vote?action=results&t=' + Math.floor(Date.now() / 3000), { cache: 'no-store' }); vt.data = await r.json(); } catch (e) { /* später */ }
    if (route() === 'voting' || route() === 'live') render();
  }
  function voteResults(limit) {
    const c = (vt.data && vt.data.counts) || {}, total = Object.values(c).reduce((a, b) => a + b, 0);
    const l = Object.entries(c).map(([id, n]) => ({ x: H.P(id), n })).filter((r) => r.x).sort((a, b) => b.n - a.n).slice(0, limit || 10);
    if (!l.length) return '<div class="empty">Noch keine Stimmen.</div>';
    return `<div class="vres">${l.map((r, i) => `<div class="vr${r.n === l[0].n ? ' win' : ''}"><span class="rk">${i + 1}</span>${monoHTML(r.x.t, 's')}<span class="who"><b>${esc(r.x.p.name)}</b><small>${esc(r.x.t.name)}</small></span><span class="vbar"><i style="width:${Math.round(r.n / l[0].n * 100)}%"></i></span><span class="big">${total ? Math.round(r.n / total * 100) : 0}%</span></div>`).join('')}</div><p class="legend">${total} Stimmen</p>`;
  }
  function vVoting() {
    const st = S.settings.vote || 'off'; loadVotes(false);
    let body;
    if (st === 'open') {
      const mine = votedFor(), p = mine && H.P(mine);
      if (p) body = `<div class="vthanks">Danke! Deine Stimme ging an <b>${esc(p.p.name)}</b> (${esc(p.t.name)}).<br><span class="hint">Das Ergebnis wird nach dem Voting hier gezeigt.</span></div>`;
      else {
        const q = vt.q.trim().toLowerCase();
        const teams = S.teams.map((t) => ({ t, ps: t.players.filter((pl) => !q || pl.name.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) })).filter((x) => x.ps.length);
        body = `<p class="vlead">Wer war für dich der beste Spieler oder die beste Spielerin des Turniers? Du hast <b>eine Stimme</b>.</p>
          <div class="field vsearch"><label for="v-q">Suchen</label><input id="v-q" type="search" placeholder="Name oder Team" value="${esc(vt.q)}" autocomplete="off"></div>
          ${vt.msg ? `<div class="notice">${esc(vt.msg)}</div>` : ''}
          <div class="vteams">${teams.map((x) => `<div class="vteam"><h3>${monoHTML(x.t, 's')} ${esc(x.t.name)}</h3><div class="vlist">${x.ps.map((pl) => `<button type="button" class="vbtn${vt.pick === pl.id ? ' sel' : ''}" data-act="vpick" data-p="${pl.id}"><span class="no">${esc(PT.noText(pl))}</span>${esc(pl.name)}</button>`).join('')}</div></div>`).join('') || '<div class="empty">Niemand gefunden.</div>'}</div>
          ${vt.pick && H.P(vt.pick) ? `<div class="vconfirm"><span>Stimme für <b>${esc(H.P(vt.pick).p.name)}</b> abgeben?</span><button type="button" class="vgo" data-act="vsend">Jetzt abstimmen</button><button type="button" class="vno" data-act="vcancel">Abbrechen</button></div>` : ''}`;
      }
    } else if (st === 'show') body = voteResults(10);
    else if (st === 'closed') body = '<div class="empty">Das Voting ist beendet. Das Ergebnis wird gleich bekanntgegeben.</div>';
    else body = '<div class="empty">Das Voting startet später im Turnier.</div>';
    return `${statTabs('voting')}<h2 class="sh">Spieler des Turniers</h2>${body}`;
  }
  async function sendVote() {
    const pl = vt.pick; if (!pl) return;
    try {
      const r = await fetch('/api/vote', { method: 'POST', headers: { 'x-csrf': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ player: pl, voter: voterId() }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok || j.already) { try { localStorage.setItem('pt-voted-' + (S.settings.voteRound || 'r1'), pl); } catch (e) { /* egal */ } vt.msg = j.already ? 'Von diesem Gerät wurde schon abgestimmt.' : ''; }
      else vt.msg = j.error || 'Das hat nicht geklappt. Bitte erneut versuchen.';
    } catch (e) { vt.msg = 'Keine Verbindung. Bitte erneut versuchen.'; }
    vt.pick = null; render();
  }
  function voteCard() {
    const st = S.settings.vote || 'off';
    if (st === 'open' && !votedFor()) return '<a class="vcard" href="/voting"><b>Spieler des Turniers</b><span>Jetzt abstimmen – eine Stimme pro Handy →</span></a>';
    if (st === 'show') { loadVotes(false); const c = (vt.data && vt.data.counts) || {}; const l = Object.entries(c).sort((a, b) => b[1] - a[1]); const x = l[0] && H.P(l[0][0]); if (x && l[1] && l[1][1] === l[0][1]) return '<a class="vcard win" href="/voting"><b>Spieler des Turniers: Gleichstand</b><span>Ergebnis ansehen →</span></a>'; if (x) return `<a class="vcard win" href="/voting"><b>Spieler des Turniers: ${esc(x.p.name)}</b><span>${esc(x.t.name)} · Ergebnis ansehen →</span></a>`; }
    return '';
  }
  function vStats() {
    const f = ui.stTeam;
    let l = H.playerStats().filter((x) => f === 'all' || x.t.id === f);
    l = l.filter((x) => f !== 'all' || x.g || x.y || x.r).sort((a, b) => b.g - a.g || (a.y + a.r) - (b.y + b.r) || a.p.name.localeCompare(b.p.name));
    let rank = 0, prev = -1;
    return `${statTabs('statistiken')}<div class="layout-side"><div class="side-f"><h3>Filtern nach Team</h3><button data-act="st-team" data-t="all" aria-pressed="${f === 'all'}">Alle Teams</button>${S.teams.map((t) => `<button data-act="st-team" data-t="${t.id}" aria-pressed="${f === t.id}">${esc(t.name)}</button>`).join('')}</div>
    <div class="plist">${l.length ? `<div class="ph"><span>#</span><span style="text-align:left">Spieler/in</span><span class="x">Spiele</span><span>Tore</span><span class="x">Gelb</span><span>2 Min.</span></div>${l.map((x, i) => { if (x.g !== prev) { rank = i + 1; prev = x.g; } return `<a class="ps" href="${P('team-' + x.t.id)}"><span class="rk">${rank}</span><span class="who"><span class="avatar" style="--c:${esc(x.t.color)}">${esc(PT.noText(x.p))}</span><span><b>${esc(x.p.name)}</b><small>${esc(x.t.name)}</small></span></span><span class="x">${x.sp}</span><span class="big">${x.g}</span><span class="x">${x.y}</span><span>${x.r}</span></a>`; }).join('')}` : '<div class="empty">Noch keine Tore oder Karten.</div>'}</div></div>`;
  }
  function vTeams() {
    return S.teams.length ? `<div class="tgrid">${S.teams.slice().sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<a class="tcard" href="${P('team-' + t.id)}" style="--c:${esc(t.color)}">${t.photo ? `<span class="ph" style="background-image:url('${esc(t.photo)}')"></span>` : `<span class="ghost">${esc(PT.short(t))}</span>`}<span class="tinfo">${monoHTML(t, 'l')}<h3>${esc(t.name)}</h3><small>${[t.cls, t.group ? 'Gruppe ' + t.group : '', t.players.length + ' Spieler/innen'].filter(Boolean).map(esc).join(' · ')}</small></span></a>`).join('')}</div>` : '<div class="empty">Noch keine Teams angelegt.</div>';
  }
  function vTeam(id) {
    const t = H.T(id); if (!t) return '<div class="empty">Dieses Team gibt es nicht. <a href="/teams">Zu allen Teams</a></div>';
    const ms = H.sorted().filter((m) => H.teamOf(m, 'h') === t || H.teamOf(m, 'a') === t);
    const st = H.playerStats().filter((x) => x.t === t);
    return `<a class="back" href="/teams">← Alle Teams</a>
    <section><h2 class="sh">Kader <small>${t.players.length} Spieler/innen</small></h2>${t.players.length ? `<div class="roster">${t.players.slice().sort(PT.byNo).map((p) => { const x = st.find((s) => s.p === p) || { g: 0, y: 0, r: 0 }; return `<div class="pl"><span class="no">${esc(PT.noText(p))}</span><b>${esc(p.name)}</b><span class="gl"><strong>${x.g}</strong>Tore${x.y || x.r ? `<br>${[x.y ? x.y + '× Gelb' : '', x.r ? x.r + '× Rot' : ''].filter(Boolean).join(', ')}` : ''}</span></div>`; }).join('')}</div>` : '<div class="empty">Noch keine Spieler eingetragen.</div>'}</section>
    <section><h2 class="sh">Spiele</h2>${planHidden() ? hiddenNote() : ms.length ? `<div class="plan">${ms.map(planRow).join('')}</div>` : '<div class="empty">Noch keine Spiele angesetzt.</div>'}</section>`;
  }
  function vMatch(id) {
    const m = H.M(id); if (!m) return { main: '<div class="empty">Dieses Spiel gibt es nicht. <a href="/spielplan">Zum Spielplan</a></div>' };
    const ev = m.events.slice().sort((x, y) => (x.min || 0) - (y.min || 0) || (x.at || 0) - (y.at || 0));
    const lu = (side) => {
      const t = H.teamOf(m, side);
      if (!t) return `<div class="lu"><h3>${esc(H.phOf(m, side))}</h3><div class="hint">Das Team steht noch nicht fest.</div></div>`;
      return `<div class="lu"><h3>${monoHTML(t, 's')} ${esc(t.name)}</h3><ul>${t.players.slice().sort(PT.byNo).map((p) => `<li><span class="no">${esc(PT.noText(p))}</span>${esc(p.name)}<span class="tag">${m.events.filter((e) => e.player === p.id).map((e) => `<i class="ic ${e.type}" title="${esc(EV[e.type])}"></i>`).join('')}</span></li>`).join('')}</ul></div>`;
    };
    return {
      hero: stageHero(m, { next: false }),
      main: `<a class="back" href="/spielplan">← Spielplan</a><div class="grid2">
        <section><h2 class="sh">Spielverlauf</h2>${ev.length ? `<div class="timeline">${ev.map((e) => { const c = `<i class="ic ${e.type}"></i><span><b>${esc(H.evWho(e) || EV[e.type])}</b> <span class="hint">${esc(EV[e.type])}</span></span>`; return `<div class="tl"><div class="h">${e.side === 'h' ? c : ''}</div><div class="m">${esc(e.min || '')}′</div><div class="a">${e.side === 'a' ? c : ''}</div></div>`; }).join('')}</div>` : `<div class="empty">${m.status === 'scheduled' ? 'Das Spiel hat noch nicht begonnen.' : 'Noch keine Tore oder Karten.'}</div>`}</section>
        <section><h2 class="sh">Aufstellungen</h2><div class="lineups">${lu('h')}${lu('a')}</div></section></div>`
    };
  }
  function vPartner() {
    const lv = [...LEVELS, ...new Set(S.sponsors.map((s) => s.level).filter((l) => !LEVELS.includes(l)))];
    if (!S.sponsors.length) return '<div class="empty">Hier erscheinen bald unsere Partner.</div>';
    const list = lv.flatMap((l) => S.sponsors.filter((s) => s.level === l));
    return `<div class="plogos">${list.map((s) => `<div class="pl-tile${s.level === 'Hauptsponsor' ? ' main' : ''}">${partnerLink(s)}</div>`).join('')}</div><p class="legend">Logo antippen, um zur Website des Partners zu gelangen.</p>`;
  }

  /* ---------- Rahmen ---------- */
  const NAV = [['spielplan', 'Spielplan'], ['tabelle', 'Tabelle'], ['statistiken', 'Statistiken'], ['teams', 'Teams'], ['partner', 'Partner']];
  const TITLES = { spielplan: 'Spielplan', tabelle: 'Tabelle', statistiken: 'Spieler-Statistiken', teams: 'Teams', partner: 'Partner' };
  function band(eb, h, side) { return `<section class="band"><div class="wrap"><div style="min-width:0"><div class="eyebrow">${eb}</div><h1>${h}</h1></div>${side || ''}</div></section>`; }
  function tickerHTML() {
    const items = [];
    const lv = H.live(); if (lv) items.push(`<span class="tk-it"><span class="lv">Live</span>${esc(H.tName(lv, 'h'))} <b>${H.sc(lv).h}:${H.sc(lv).a}</b> ${esc(H.tName(lv, 'a'))}</span>`);
    H.sorted().filter((m) => m.status === 'done').slice(-6).reverse().forEach((m) => items.push(`<span class="tk-it">${esc(H.tName(m, 'h'))} <b>${H.sc(m).h}:${H.sc(m).a}</b> ${esc(H.tName(m, 'a'))}</span>`));
    if (S.settings.ticker) items.unshift(`<span class="tk-it">Info: ${esc(S.settings.ticker)}</span>`);
    if (!items.length) return '';
    const set = `<div class="tk-set">${items.join('')}</div>`;
    return `<div class="ticker" aria-label="Laufband"><div class="tk-track">${set}${set.replace('class="tk-set"', 'class="tk-set" aria-hidden="true"')}</div></div>`;
  }
  // Teamleiste: am Handy als Endlos-Band nach links (zweite Kopie für den nahtlosen Übergang)
  let lastStrip = '';
  function stripHTML() {
    if (!S.teams.length) return '';
    const teams = S.teams.slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' }));
    const logos = (hidden) => teams.map((t) => `<a href="${P('team-' + t.id)}" title="${esc(t.name)}"${hidden ? ' tabindex="-1"' : ''}>${monoHTML(t, 's')}</a>`).join('');
    return `<div class="tstrip"><div class="wrap"><div class="ts-track" style="--n:${S.teams.length}"><div class="ts-set">${logos(false)}</div><div class="ts-set ts-copy" aria-hidden="true">${logos(true)}</div></div></div></div>`;
  }
  function render() {
    if (!S) return;
    const strip = stripHTML(), oldStrip = strip === lastStrip ? app.querySelector('.tstrip') : null;
    const r = route(), s = S.settings, eb = esc(s.title) + (s.season ? ' ' + esc(s.season) : '');
    const cur = r.startsWith('team-') ? 'teams' : r.startsWith('spiel-') ? 'spielplan' : r === 'baum' ? 'tabelle' : (r === 'fairplay' || r === 'voting') ? 'statistiken' : r;
    let hero = '', main = '';
    if (r === 'spielplan') { hero = band(eb, 'Spielplan'); main = vSchedule(); }
    else if (r === 'tabelle') { hero = band(eb, 'Tabelle'); main = vTable(); }
    else if (r === 'baum') { hero = band(eb, 'K.-o.-Baum'); main = vBracket(); }
    else if (r === 'statistiken') { hero = band(eb, 'Spieler-Statistiken'); main = vStats(); }
    else if (r === 'fairplay') { hero = band(eb, 'Fairplay'); main = vFair(); }
    else if (r === 'voting') { hero = band(eb, 'Voting'); main = vVoting(); }
    else if (r === 'teams') { hero = band(eb, 'Teams'); main = vTeams(); }
    else if (r === 'partner') { hero = band(eb, 'Partner'); main = vPartner(); }
    else if (r.startsWith('team-')) { const t = H.T(r.slice(5)); hero = band(t ? esc([t.cls, t.group ? 'Gruppe ' + t.group : ''].filter(Boolean).join(' · ') || 'Team') : eb, t ? esc(t.name) : 'Team', t ? monoHTML(t, 'xl') : ''); main = vTeam(r.slice(5)); }
    else if (r.startsWith('spiel-')) { const v = vMatch(r.slice(6)); hero = v.hero || band(eb, 'Spiel'); main = v.main; }
    else { const v = vLive(); hero = v.hero; main = v.main; }
    const live = !!H.live();
    const ae = document.activeElement, keepId = ae && ae.id && app.contains(ae) ? ae.id : null, selS = keepId && ae.selectionStart != null ? ae.selectionStart : null;
    app.innerHTML = `
    ${strip}
    <header class="hdr"><div class="wrap">
      <a class="brand" href="/"><span class="lockup"><span class="logo logo-school" role="img" aria-label="Logo ${esc(s.school)}"></span><i class="lk-sep m-only"></i><span class="logo logo-smv m-only" role="img" aria-label="Logo der SMV"></span></span><span class="bt"><small>${esc(s.school)}</small><b>${esc(s.title).replace(/-?(Turnier)$/i, ' <span>$1</span>')}</b></span></a>
      <nav class="nav" aria-label="Bereiche"><a class="pill${live ? ' on' : ''}" href="/"${cur === 'live' ? ' aria-current="page"' : ''}>Live</a>${NAV.map(([k, l]) => `<a href="${P(k)}"${cur === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div class="hdr-r"><span class="logo logo-smv d-only" role="img" aria-label="Logo der SMV"></span><button class="burger m-only" type="button" data-act="menu" aria-label="Menü öffnen" aria-expanded="false" aria-controls="mnav"><span></span><span></span><span></span></button></div>
    </div></header>
    ${hero}
    <main><div class="wrap">${main}</div></main>
    ${partnersBand()}
    <footer><div class="wrap"><div class="org"><span class="logo logo-school" role="img" aria-label="Logo ${esc(s.school)}"></span><span class="logo logo-smv" role="img" aria-label="Logo der SMV"></span><div>Ein Turnier der SMV<small>${esc([s.school, H.dateText(), s.location].filter(Boolean).join(' · '))}</small></div></div>
    <div class="small"><a href="/impressum">Impressum &amp; Datenschutz</a></div></div></footer>
    ${online ? '' : '<div class="offline-note" role="status">Keine Verbindung – wird automatisch erneut versucht …</div>'}`;
    if (oldStrip) { const ns = app.querySelector('.tstrip'); if (ns) ns.replaceWith(oldStrip); }
    lastStrip = strip;
    if (keepId) { const el = document.getElementById(keepId); if (el) { el.focus(); try { if (selS != null) el.setSelectionRange(selS, selS); } catch (x) { /* egal */ } } }
    document.title = (live ? '● ' + H.tName(H.live(), 'h') + ' ' + H.sc(H.live()).h + ':' + H.sc(H.live()).a + ' ' + H.tName(H.live(), 'a') + ' · ' : '') + 'Parler Oberstufen-Turnier';
  }

  /* ---------- Uhren laufen lassen ---------- */
  setInterval(() => {
    if (!H) return;
    document.querySelectorAll('[data-clock]').forEach((el) => { const m = H.M(el.dataset.clock); if (m) el.textContent = H.clockText(m); });
    document.querySelectorAll('[data-bar]').forEach((el) => { const m = H.M(el.dataset.bar); if (m) el.style.width = H.pct(m) + '%'; });
    document.querySelectorAll('[data-cstate]').forEach((el) => { const m = H.M(el.dataset.cstate); if (m) { el.textContent = H.clockState(m); el.classList.toggle('over', m.status === 'live' && H.remaining(m) <= 0); } });
    H.tickTimes();
    document.querySelectorAll('[data-pens]').forEach((el) => { const m = H.M(el.dataset.pens); if (m) { const h = H.penText(m); if (el.innerHTML !== h) el.innerHTML = h; } });
  }, 250);

  /* ---------- Laden & regelmäßig aktualisieren ---------- */
  async function load() {
    try {
      const n = await PT.fetchState(false);
      const changed = !S || n.rev !== S.rev || n.updated !== S.updated;
      if (!online) { online = true; S = null; }
      if (changed || !S) { const first = !S; S = n; H = PT.make(S); if (first) fixOldHash(); render(); }
    } catch (e) {
      if (!S) app.innerHTML = `<div class="wrap" style="padding-block:60px"><div class="notice">${e.setup ? '<b>Die Seite ist noch nicht fertig eingerichtet.</b> ' : '<b>Keine Verbindung.</b> '}${esc(e.message)}<br>Es wird automatisch erneut versucht.${e.setup ? ' <a href="/turnierleitung">Diagnose öffnen</a>' : ''}</div></div>`;
      else if (online) { online = false; render(); }
    }
  }
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(async () => { if (!document.hidden) await load(); schedule(); }, 2000); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'filter') { ui.filter = b.dataset.f; render(); }
    if (b.dataset.act === 'vpick') { vt.pick = b.dataset.p; render(); const c = document.querySelector('.vconfirm'); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    if (b.dataset.act === 'vcancel') { vt.pick = null; render(); }
    if (b.dataset.act === 'vsend') sendVote();
    if (b.dataset.act === 'st-team') { ui.stTeam = b.dataset.t; render(); }
  });
  /* Handy-Menü (drei Striche) – liegt außerhalb von #app, damit es beim Aktualisieren offen bleibt */
  const MENU = [['live', 'Live'], ['spielplan', 'Spielplan'], ['tabelle', 'Tabelle'], ['baum', 'K.-o.-Baum'], ['statistiken', 'Statistiken'], ['fairplay', 'Fairplay'], ['teams', 'Teams'], ['partner', 'Partner']];
  let menuEl = null;
  function closeMenu() { if (!menuEl) return; menuEl.remove(); menuEl = null; document.body.classList.remove('menu-open'); const b = app.querySelector('.burger'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); } }
  function openMenu() {
    if (menuEl) return closeMenu();
    const r = route(), cur = r.startsWith('team-') ? 'teams' : r.startsWith('spiel-') ? 'spielplan' : r;
    menuEl = document.createElement('div'); menuEl.className = 'mnav'; menuEl.id = 'mnav'; menuEl.setAttribute('role', 'dialog'); menuEl.setAttribute('aria-label', 'Menü');
    menuEl.innerHTML = `<div class="mn-top"><span class="lockup"><span class="logo logo-school"></span><i class="lk-sep"></i><span class="logo logo-smv"></span></span><button class="mn-x" type="button" data-mn="close" aria-label="Menü schließen">✕</button></div>
      <nav class="mn-list">${(S && S.settings.vote && S.settings.vote !== 'off' ? MENU.concat([['voting', 'Voting']]) : MENU).map(([k, l]) => `<a href="${P(k)}"${cur === k ? ' aria-current="page"' : ''}>${k === 'live' && H && H.live() ? '<span class="lvd"></span>' : ''}${l}</a>`).join('')}</nav>`;
    document.body.appendChild(menuEl); document.body.classList.add('menu-open');
    const b = app.querySelector('.burger'); if (b) b.setAttribute('aria-expanded', 'true');
    menuEl.addEventListener('click', (e) => { if (e.target.closest('[data-mn="close"]') || e.target.closest('a')) closeMenu(); });
    const first = menuEl.querySelector('.mn-list a'); if (first) first.focus();
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-act="menu"]')) openMenu(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  addEventListener('resize', () => { if (innerWidth > 860) closeMenu(); });
  // interne Links ohne Neuladen öffnen
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]'); if (!a || a.target || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    const u = new URL(a.href, location.href); if (u.origin !== location.origin) return;
    let p = u.pathname; try { p = decodeURIComponent(p); } catch (x) { /* egal */ }
    if (!isSitePath(p.replace(/\/+$/, '') || '/')) return;
    e.preventDefault(); if (u.pathname + u.search !== location.pathname + location.search) go(u.pathname + u.search); else { closeMenu(); scrollTo(0, 0); }
  });
  addEventListener('popstate', () => { closeMenu(); render(); });
  addEventListener('hashchange', () => { fixOldHash(); closeMenu(); render(); scrollTo(0, 0); });
  document.addEventListener('input', (e) => { if (e.target.id === 'v-q') { vt.q = e.target.value; render(); } });
  PT.syncTime().then(() => load()).then(schedule);
  setInterval(PT.syncTime, 5 * 60e3);
})();
