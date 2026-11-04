/* Zuschauerseite: zeigt den Turnierstand und lädt alle 2 Sekunden neu */
(function () {
  'use strict';
  const { esc, monoHTML, initials, STAGES, LEVELS, EV, safeUrl } = PT;
  const app = document.getElementById('app');
  let S = null, H = null, online = true;
  const ui = { filter: 'all', stTeam: 'all' };
  const route = () => location.hash.replace('#', '') || 'live';

  /* ---------- Bausteine ---------- */
  const clockHTML = (m, big) => `<span class="clk${big ? ' big' : ''}" data-clock="${m.id}">${H.clockText(m)}</span>`;
  const stateHTML = (m) => `<span class="cstate${m.status === 'live' && H.remaining(m) <= 0 ? ' over' : ''}" data-cstate="${m.id}">${H.clockState(m)}</span>`;
  const barHTML = (m) => `<div class="bar"><i data-bar="${m.id}" style="width:${H.pct(m)}%"></i></div>`;
  const evText = (e) => esc(H.evWho(e) || EV[e.type]) + (e.type === 'og' ? ' (ET)' : '');

  function stageHero(m, opts) {
    opts = opts || {};
    if (!m) return `<section class="stage"><div class="wrap"><div class="stage-top"><span>${esc(S.settings.school)} · SMV präsentiert</span></div><h1 style="font-size:clamp(46px,8vw,90px)">${esc(S.settings.title)}</h1><div class="nextline">Der Spielplan ist noch leer.</div></div></section>`;
    const r = H.sc(m), h = H.teamOf(m, 'h'), a = H.teamOf(m, 'a');
    const tb = (t, side) => `<a class="tb" href="${t ? '#team-' + t.id : '#spiel-' + m.id}">${monoHTML(t, 'xl')}<b>${esc(t ? t.name : H.phOf(m, side))}</b><small>${esc(t ? (t.cls || (t.group ? 'Gruppe ' + t.group : '')) : 'steht noch nicht fest')}</small></a>`;
    const evs = (side) => `<ul>${m.events.filter((e) => e.side === side).sort((x, y) => (x.min || 0) - (y.min || 0)).map((e) => `<li>${side === 'h' ? `<span class="mi">${esc(e.min || '')}′</span><i class="ic ${e.type}"></i>${evText(e)}` : `${evText(e)}<i class="ic ${e.type}"></i><span class="mi">${esc(e.min || '')}′</span>`}</li>`).join('')}</ul>`;
    let top;
    if (m.status === 'live') top = `<span class="livechip">Live</span>`;
    else if (m.status === 'done') top = `<b>Endstand</b>`;
    else top = `<b>Nächstes Spiel · ca. <span data-exp="${m.id}">${H.expTime(m)}</span> Uhr ${H.delayHTML(m)}</b>`;
    const nxt = H.nextScheduled(m);
    return `<section class="stage"><div class="wrap">
      <div class="stage-top"><span>Spiel ${esc(m.no || '')} · ${esc(m.label || STAGES[m.stage].l)}</span>${top}</div>
      <div class="sb">${tb(h, 'h')}<div class="score">${m.status === 'scheduled' ? '<span class="vs">VS</span>' : `<span>${r.h}</span><i>:</i><span>${r.a}</span>`}</div>${tb(a, 'a')}</div>
      ${m.pen ? `<div class="nextline">${m.pen.h}:${m.pen.a} nach Neunmeterschießen</div>` : ''}
      <div class="sb-clock">${clockHTML(m, true)}${stateHTML(m)}</div>${barHTML(m)}
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
    return `<a class="pr ${m.status}" href="#spiel-${m.id}"><span class="meta"><span class="no">${esc(m.no || '')}</span><span class="tm"><span data-exp="${m.id}">${H.expTime(m)}</span>${m.status === 'done' ? '' : H.delayHTML(m)}</span><span class="rd">${esc(m.label || STAGES[m.stage].l)}</span></span>${side('h')}${res}${side('a')}</a>`;
  }

  function standTable(g, compact) {
    const rows = H.standings(g);
    if (!rows.length) return `<div class="empty">Noch keine Teams${g ? ' in Gruppe ' + esc(g) : ''}.</div>`;
    const qn = H.qualN(), c = compact ? ' c' : '';
    const row = (r, i) => `<a class="st-r${c}${i < qn ? ' q' : ''}" href="#team-${r.t.id}"><span>${i + 1}</span><span class="club">${monoHTML(r.t, 's')}<span class="nm">${esc(r.t.name)}</span>${r.live ? '<span class="lvd" title="spielt gerade"></span>' : ''}</span><span>${r.sp}</span>${compact ? '' : `<span class="x">${r.s}</span><span class="x">${r.u}</span><span class="x">${r.n}</span>`}<span>${r.tf}:${r.ta}</span><span>${r.tf - r.ta > 0 ? '+' : ''}${r.tf - r.ta}</span><span class="pts">${r.pts}</span></a>`;
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
  function partnersBand() {
    if (!S.sponsors.length) return '';
    const by = (l) => S.sponsors.filter((s) => s.level === l);
    const main = by('Hauptsponsor'), mid = [...by('Premium-Partner'), ...by('Partner')], small = S.sponsors.filter((s) => !main.includes(s) && !mid.includes(s));
    const row = (l, c) => (l.length ? `<div class="prow ${c}">${l.map((s) => `<a href="#partner" title="${esc(s.name)}">${spLogo(s)}</a>`).join('')}</div>` : '');
    return `<section class="unterstuetzer"><div class="wrap"><h2>Partner</h2>${row(main, 'main')}${row(mid, '')}${row(small, 'small')}</div></section>`;
  }

  /* ---------- Ansichten ---------- */
  function vLive() {
    const f = H.featured(), list = H.sorted();
    const up = list.filter((m) => m.status === 'scheduled' && m !== f).slice(0, 5);
    const done = list.filter((m) => m.status === 'done' && m !== f).slice(-5).reverse();
    return {
      hero: stageHero(f),
      main: `
      <div class="grid2">
        <section><h2 class="sh">Nächste Spiele <a href="#spielplan">Spielplan</a></h2>${up.length ? `<div class="plan">${up.map(planRow).join('')}</div>` : '<div class="empty">Keine weiteren Spiele geplant.</div>'}</section>
        <section><h2 class="sh">Letzte Ergebnisse <a href="#spielplan">Alle</a></h2>${done.length ? `<div class="plan">${done.map(planRow).join('')}</div>` : '<div class="empty">Noch keine Ergebnisse.</div>'}</section>
      </div>
      <section><h2 class="sh">Tabellen <a href="#tabelle">Ausführlich</a></h2><div class="grid2">${H.groups().map((g) => `<div>${H.groups().length > 1 ? `<h3 class="gname" style="font-size:26px">Gruppe ${esc(g)}</h3>` : ''}${standTable(g, true)}</div>`).join('')}</div></section>
      <section><h2 class="sh">Top-Performer <a href="#statistiken">Alle Statistiken</a></h2>${performers()}</section>`
    };
  }
  function vSchedule() {
    const f = ui.filter;
    const labels = [...new Set(S.matches.filter((m) => m.stage === 'group').map((m) => m.label))].sort();
    const chips = [['all', 'Alle Spiele'], ...labels.map((l) => [l, l]), ['ko', 'Finalrunde']];
    const list = H.sorted().filter((m) => f === 'all' || (f === 'ko' ? m.stage !== 'group' : m.label === f));
    const grp = list.filter((m) => m.stage === 'group'), ko = list.filter((m) => m.stage !== 'group');
    return `<section><div class="tabs">${chips.map(([k, l]) => `<button data-act="filter" data-f="${esc(k)}" aria-pressed="${f === k}">${esc(l)}</button>`).join('')}</div>
      ${grp.length ? `<h2 class="sh">Gruppenphase <small>${esc(S.settings.durGroup)} Min. pro Spiel</small></h2><div class="plan">${grp.map(planRow).join('')}</div>` : ''}
      ${ko.length ? `<h2 class="sh" style="margin-top:30px">Finalrunde <small>K.-o. ${esc(S.settings.durKo)} Min. · Halbfinale & Finale ${esc(S.settings.durFinal)} Min.</small></h2><div class="plan">${ko.map(planRow).join('')}</div>` : ''}
      ${list.length ? '' : '<div class="empty">Keine Spiele in dieser Auswahl.</div>'}
      <p class="legend">Alle Spiele finden nacheinander auf einem Feld statt. Die Uhrzeiten passen sich live an: Bei Verspätung verschiebt sich der Plan automatisch, die Verspätung steht gelb daneben.</p></section>`;
  }
  function vTable() {
    const multi = H.groups().length > 1;
    return `${H.groups().map((g) => `<section>${multi ? `<h2 class="gname">Gruppe ${esc(g)}</h2>` : ''}${standTable(g, false)}</section>`).join('')}
    <div class="legend">${multi ? `Die ersten ${H.qualN()} jeder Gruppe ziehen ins <b>${H.qualLabel()}</b> ein. ` : ''}Punkte: Sieg ${esc(S.settings.win)}, Unentschieden ${esc(S.settings.draw)}. Bei Punktgleichheit zählt die Tordifferenz, dann die Zahl der Tore.${S.matches.some((m) => m.status === 'live') ? '<br>Ein roter Punkt heißt: Das Team spielt gerade, der aktuelle Stand ist schon eingerechnet.' : ''}</div>`;
  }
  function vStats() {
    const f = ui.stTeam;
    let l = H.playerStats().filter((x) => f === 'all' || x.t.id === f);
    l = l.filter((x) => f !== 'all' || x.g || x.y || x.r).sort((a, b) => b.g - a.g || (a.y + a.r) - (b.y + b.r) || a.p.name.localeCompare(b.p.name));
    let rank = 0, prev = -1;
    return `<div class="layout-side"><div class="side-f"><h3>Filtern nach Team</h3><button data-act="st-team" data-t="all" aria-pressed="${f === 'all'}">Alle Teams</button>${S.teams.map((t) => `<button data-act="st-team" data-t="${t.id}" aria-pressed="${f === t.id}">${esc(t.name)}</button>`).join('')}</div>
    <div class="plist">${l.length ? `<div class="ph"><span>#</span><span style="text-align:left">Spieler/in</span><span class="x">Spiele</span><span>Tore</span><span class="x">Gelb</span><span>Rot</span></div>${l.map((x, i) => { if (x.g !== prev) { rank = i + 1; prev = x.g; } return `<a class="ps" href="#team-${x.t.id}"><span class="rk">${rank}</span><span class="who"><span class="avatar" style="--c:${esc(x.t.color)}">${esc(x.p.no || initials(x.p.name))}</span><span><b>${esc(x.p.name)}</b><small>${esc(x.t.name)}</small></span></span><span class="x">${x.sp}</span><span class="big">${x.g}</span><span class="x">${x.y}</span><span>${x.r}</span></a>`; }).join('')}` : '<div class="empty">Noch keine Tore oder Karten.</div>'}</div></div>`;
  }
  function vTeams() {
    return S.teams.length ? `<div class="tgrid">${S.teams.slice().sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name, 'de', { numeric: true })).map((t) => `<a class="tcard" href="#team-${t.id}" style="--c:${esc(t.color)}">${t.photo ? `<span class="ph" style="background-image:url('${esc(t.photo)}')"></span>` : `<span class="ghost">${esc(initials(t.name))}</span>`}<span class="tinfo">${monoHTML(t, 'l')}<h3>${esc(t.name)}</h3><small>${[t.cls, t.group ? 'Gruppe ' + t.group : '', t.players.length + ' Spieler/innen'].filter(Boolean).map(esc).join(' · ')}</small></span></a>`).join('')}</div>` : '<div class="empty">Noch keine Teams angelegt.</div>';
  }
  function vTeam(id) {
    const t = H.T(id); if (!t) return '<div class="empty">Dieses Team gibt es nicht. <a href="#teams">Zu allen Teams</a></div>';
    const ms = H.sorted().filter((m) => H.teamOf(m, 'h') === t || H.teamOf(m, 'a') === t);
    const st = H.playerStats().filter((x) => x.t === t);
    return `<a class="back" href="#teams">← Alle Teams</a>
    <section><h2 class="sh">Kader <small>${t.players.length} Spieler/innen</small></h2>${t.players.length ? `<div class="roster">${t.players.slice().sort((a, b) => (a.no || 99) - (b.no || 99)).map((p) => { const x = st.find((s) => s.p === p) || { g: 0, y: 0, r: 0 }; return `<div class="pl"><span class="no">${esc(p.no || '–')}</span><b>${esc(p.name)}</b><span class="gl"><strong>${x.g}</strong>Tore${x.y || x.r ? `<br>${[x.y ? x.y + '× Gelb' : '', x.r ? x.r + '× Rot' : ''].filter(Boolean).join(', ')}` : ''}</span></div>`; }).join('')}</div>` : '<div class="empty">Noch keine Spieler eingetragen.</div>'}</section>
    <section><h2 class="sh">Spiele</h2>${ms.length ? `<div class="plan">${ms.map(planRow).join('')}</div>` : '<div class="empty">Noch keine Spiele angesetzt.</div>'}</section>`;
  }
  function vMatch(id) {
    const m = H.M(id); if (!m) return { main: '<div class="empty">Dieses Spiel gibt es nicht. <a href="#spielplan">Zum Spielplan</a></div>' };
    const ev = m.events.slice().sort((x, y) => (x.min || 0) - (y.min || 0) || (x.at || 0) - (y.at || 0));
    const lu = (side) => {
      const t = H.teamOf(m, side);
      if (!t) return `<div class="lu"><h3>${esc(H.phOf(m, side))}</h3><div class="hint">Das Team steht noch nicht fest.</div></div>`;
      return `<div class="lu"><h3>${monoHTML(t, 's')} ${esc(t.name)}</h3><ul>${t.players.slice().sort((x, y) => (x.no || 99) - (y.no || 99)).map((p) => `<li><span class="no">${esc(p.no || '')}</span>${esc(p.name)}<span class="tag">${m.events.filter((e) => e.player === p.id).map((e) => `<i class="ic ${e.type}" title="${esc(EV[e.type])}"></i>`).join('')}</span></li>`).join('')}</ul></div>`;
    };
    return {
      hero: stageHero(m, { next: false }),
      main: `<a class="back" href="#spielplan">← Spielplan</a><div class="grid2">
        <section><h2 class="sh">Spielverlauf</h2>${ev.length ? `<div class="timeline">${ev.map((e) => { const c = `<i class="ic ${e.type}"></i><span><b>${esc(H.evWho(e) || EV[e.type])}</b> <span class="hint">${esc(EV[e.type])}</span></span>`; return `<div class="tl"><div class="h">${e.side === 'h' ? c : ''}</div><div class="m">${esc(e.min || '')}′</div><div class="a">${e.side === 'a' ? c : ''}</div></div>`; }).join('')}</div>` : `<div class="empty">${m.status === 'scheduled' ? 'Das Spiel hat noch nicht begonnen.' : 'Noch keine Tore oder Karten.'}</div>`}</section>
        <section><h2 class="sh">Aufstellungen</h2><div class="lineups">${lu('h')}${lu('a')}</div></section></div>`
    };
  }
  function vPartner() {
    const lv = [...LEVELS, ...new Set(S.sponsors.map((s) => s.level).filter((l) => !LEVELS.includes(l)))];
    return S.sponsors.length ? lv.map((l) => { const list = S.sponsors.filter((s) => s.level === l); if (!list.length) return ''; return `<div class="sp-tier"><h3>${esc(l)}</h3><div class="sgrid">${list.map((s) => { const u = safeUrl(s.url); return `<div class="scard"><div class="lg">${spLogo(s)}</div><b>${esc(s.name)}</b>${s.slogan ? `<p>${esc(s.slogan)}</p>` : ''}${u ? `<a href="${esc(u)}" target="_blank" rel="noopener" style="font-weight:600;font-size:14px;overflow-wrap:anywhere">${esc(u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}</div>`; }).join('')}</div></div>`; }).join('') : '<div class="empty">Hier erscheinen bald unsere Partner.</div>';
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
  function render() {
    if (!S) return;
    const r = route(), s = S.settings, eb = esc(s.title) + (s.season ? ' ' + esc(s.season) : '');
    const cur = r.startsWith('team-') ? 'teams' : r.startsWith('spiel-') ? 'spielplan' : r;
    let hero = '', main = '';
    if (r === 'spielplan') { hero = band(eb, 'Spielplan'); main = vSchedule(); }
    else if (r === 'tabelle') { hero = band(eb, 'Tabelle'); main = vTable(); }
    else if (r === 'statistiken') { hero = band(eb, 'Spieler-Statistiken'); main = vStats(); }
    else if (r === 'teams') { hero = band(eb, 'Teams'); main = vTeams(); }
    else if (r === 'partner') { hero = band(eb, 'Partner'); main = vPartner(); }
    else if (r.startsWith('team-')) { const t = H.T(r.slice(5)); hero = band(t ? esc([t.cls, t.group ? 'Gruppe ' + t.group : ''].filter(Boolean).join(' · ') || 'Team') : eb, t ? esc(t.name) : 'Team', t ? monoHTML(t, 'xl') : ''); main = vTeam(r.slice(5)); }
    else if (r.startsWith('spiel-')) { const v = vMatch(r.slice(6)); hero = v.hero || band(eb, 'Spiel'); main = v.main; }
    else { const v = vLive(); hero = v.hero; main = v.main; }
    const live = !!H.live();
    app.innerHTML = `
    ${S.teams.length ? `<div class="tstrip"><div class="wrap">${S.teams.map((t) => `<a href="#team-${t.id}" title="${esc(t.name)}">${monoHTML(t, 's')}</a>`).join('')}</div></div>` : ''}
    <header class="hdr"><div class="wrap">
      <a class="brand" href="#live"><span class="logo logo-school" role="img" aria-label="Logo ${esc(s.school)}"></span><span class="bt"><small>${esc(s.school)}</small><b>${esc(s.title).replace(/-?(Turnier)$/i, ' <span>$1</span>')}</b></span></a>
      <nav class="nav" aria-label="Bereiche"><a class="pill${live ? ' on' : ''}" href="#live"${cur === 'live' ? ' aria-current="page"' : ''}>Live</a>${NAV.map(([k, l]) => `<a href="#${k}"${cur === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
      <div class="hdr-r"><span class="logo logo-smv" role="img" aria-label="Logo der SMV"></span></div>
    </div></header>
    ${tickerHTML()}
    ${hero}
    <main><div class="wrap">${main}</div></main>
    ${partnersBand()}
    <footer><div class="wrap"><div class="org"><span class="logo logo-school" role="img" aria-label="Logo ${esc(s.school)}"></span><span class="logo logo-smv" role="img" aria-label="Logo der SMV"></span><div>Ein Turnier der SMV<small>${esc([s.school, H.dateText(), s.location].filter(Boolean).join(' · '))}</small></div></div>
    <div class="small"><span class="conn${online ? '' : ' off'}">${online ? 'Live verbunden' : 'Keine Verbindung – wird erneut versucht'}</span> · <a href="/anzeige">Hallenanzeige</a> · <a href="/turnierleitung">Turnierleitung</a></div></div></footer>`;
    document.title = (live ? '● ' + H.tName(H.live(), 'h') + ' ' + H.sc(H.live()).h + ':' + H.sc(H.live()).a + ' ' + H.tName(H.live(), 'a') + ' · ' : '') + 'Parler Oberstufen-Turnier';
  }

  /* ---------- Uhren laufen lassen ---------- */
  setInterval(() => {
    if (!H) return;
    document.querySelectorAll('[data-clock]').forEach((el) => { const m = H.M(el.dataset.clock); if (m) el.textContent = H.clockText(m); });
    document.querySelectorAll('[data-bar]').forEach((el) => { const m = H.M(el.dataset.bar); if (m) el.style.width = H.pct(m) + '%'; });
    document.querySelectorAll('[data-cstate]').forEach((el) => { const m = H.M(el.dataset.cstate); if (m) { el.textContent = H.clockState(m); el.classList.toggle('over', m.status === 'live' && H.remaining(m) <= 0); } });
    H.tickTimes();
  }, 250);

  /* ---------- Laden & regelmäßig aktualisieren ---------- */
  async function load() {
    try {
      const n = await PT.fetchState(false);
      const changed = !S || n.rev !== S.rev || n.updated !== S.updated;
      if (!online) { online = true; S = null; }
      if (changed || !S) { S = n; H = PT.make(S); render(); }
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
    if (b.dataset.act === 'st-team') { ui.stTeam = b.dataset.t; render(); }
  });
  addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
  PT.syncTime().then(() => load()).then(schedule);
  setInterval(PT.syncTime, 5 * 60e3);
})();
