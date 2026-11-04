/* Hallenanzeige: großes Spiel, Uhr, Torjubel – lädt alle 1,5 Sekunden neu */
(function () {
  'use strict';
  const { esc, monoHTML, STAGES } = PT;
  const app = document.getElementById('app');
  let S = null, H = null, lastKey = null, lastGoals = null;

  function render() {
    const m = H.featured(), s = S.settings;
    const top = `<div class="hx-top"><div class="l"><span class="logo logo-school"></span><span class="t">${esc(s.title).replace(/-?(Turnier)$/i, ' <span>$1</span>')}</span></div>
      <div class="r">${m ? (H.isTest(m) ? `<b>Testspiel</b>` : `Spiel ${esc(m.no)} · <b>${esc(m.label || STAGES[m.stage].l)}</b>`) : ''}</div><span class="logo logo-smv"></span></div>`;
    if (!m) { app.innerHTML = top + `<div class="hx-mid"><div class="idle-t">Gleich geht's los</div></div><div></div>`; return; }
    const r = H.sc(m), h = H.teamOf(m, 'h'), a = H.teamOf(m, 'a');
    const team = (t, side) => `<div class="hx-team" style="--c:${t ? esc(t.color) : '#2A3560'}">${monoHTML(t)}<b>${esc(t ? t.name : H.phOf(m, side))}</b><span class="bar2"></span></div>`;
    const evs = (side) => m.events.filter((e) => e.side === side).sort((x, y) => (x.min || 0) - (y.min || 0)).map((e) => `<span><span class="mi">${esc(e.min || '')}′</span><i class="ic ${e.type}"></i>${esc(H.evWho(e) || PT.EV[e.type])}</span>`).join('');
    const nxt = H.nextScheduled(m);
    const logos = S.sponsors.filter((x) => x.logo).slice(0, 6).map((x) => `<img src="${esc(x.logo)}" alt="">`).join('') || S.sponsors.slice(0, 4).map((x) => `<span>${esc(x.name)}</span>`).join('');
    app.innerHTML = top + `<div class="hx-mid">
      <div class="hx-sb">${team(h, 'h')}<div class="hx-score">${m.status === 'scheduled' ? '<span class="vs">VS</span>' : `<span>${r.h}</span><i>:</i><span>${r.a}</span>`}</div>${team(a, 'a')}</div>
      <div class="hx-clock"><span class="clk" data-clock="${m.id}">${H.clockText(m)}</span><span class="cstate" data-cstate="${m.id}">${m.status === 'scheduled' ? 'Anpfiff ca. ' + H.expTime(m) + ' Uhr' : H.clockState(m)}</span></div>
      <div class="bar"><i data-bar="${m.id}" style="width:${H.pct(m)}%"></i></div>
      <div class="hx-ev"><div>${evs('h')}</div><div>${evs('a')}</div></div></div>
      <div class="hx-bot"><span>${nxt && nxt !== m ? `Danach: <b>${esc(H.tName(nxt, 'h'))} – ${esc(H.tName(nxt, 'a'))}</b>` : esc(s.ticker || '')}</span><span class="sp">${logos}</span></div>`;
  }
  function goalFlash(m, e) {
    const t = H.teamOf(m, e.side), x = H.P(e.player);
    const el = document.createElement('div'); el.className = 'flash';
    el.innerHTML = `<div><div class="big">${e.type === 'og' ? 'Eigentor' : 'Tor!'}</div>${x ? `<div class="who">${esc(x.p.name)}</div>` : ''}<div class="tm">${esc(t ? t.name : '')} · ${H.sc(m).h}:${H.sc(m).a}</div></div>`;
    document.body.appendChild(el); setTimeout(() => el.remove(), 4600);
  }

  async function load() {
    try {
      const n = await PT.fetchState(false);
      if (S && n.rev === S.rev && n.updated === S.updated) return;
      S = n; H = PT.make(S);
      const m = H.featured();
      const goals = m ? m.events.filter(H.isGoal) : [];
      const key = m ? m.id : '';
      if (key === lastKey && lastGoals != null && goals.length > lastGoals && m.status === 'live') goalFlash(m, goals.slice().sort((x, y) => (x.at || 0) - (y.at || 0)).pop());
      lastKey = key; lastGoals = goals.length;
      render();
    } catch (e) {
      if (!S) app.innerHTML = `<div class="hx-mid" style="color:#A3B3DA;font-size:3vh">Keine Verbindung – wird erneut versucht …</div>`;
    }
  }
  setInterval(() => {
    if (!H) return;
    document.querySelectorAll('[data-clock]').forEach((el) => { const m = H.M(el.dataset.clock); if (m) { el.textContent = H.clockText(m); el.classList.toggle('over', m.status === 'live' && H.remaining(m) <= 0); } });
    document.querySelectorAll('[data-bar]').forEach((el) => { const m = H.M(el.dataset.bar); if (m) el.style.width = H.pct(m) + '%'; });
    document.querySelectorAll('[data-cstate]').forEach((el) => { const m = H.M(el.dataset.cstate); if (m) el.textContent = m.status === 'scheduled' ? 'Anpfiff ca. ' + H.expTime(m) + ' Uhr' : H.clockState(m); });
  }, 200);
  function fs() { const d = document.documentElement; if (!document.fullscreenElement) (d.requestFullscreen ? d.requestFullscreen() : Promise.reject()).catch(() => {}); else document.exitFullscreen(); }
  document.getElementById('fsbtn').addEventListener('click', fs);
  addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') fs(); });
  document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fs', !!document.fullscreenElement));
  // Bildschirm wach halten, wenn möglich
  async function wake() { try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch (e) { /* nicht unterstützt */ } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { wake(); load(); } });
  PT.syncTime().then(load).then(() => { wake(); setInterval(() => { if (!document.hidden) load(); }, 1500); });
  setInterval(PT.syncTime, 5 * 60e3);
})();
