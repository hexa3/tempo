/* Tempo — app controller: state, rendering and user actions.
   All data lives in this browser (localStorage). Nothing is uploaded except the text
   a student chooses to send to the AI, and that is never stored on the server. */
(function () {
  const { D, Scheduler, Parser, Demo, Coach } = window.Tempo;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'tempo.v1';
  // muted, print-like subject colours that read on warm paper and in dark mode
  const PALETTE = ['#c2410c', '#0f766e', '#a16207', '#9d174d', '#1d4ed8', '#4d7c0f', '#6d28d9', '#b91c1c', '#0e7490'];
  const ICON = {
    pin: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 21v-6M7 4h10l-1.5 5L18 13H6l2.5-4z"/></svg>',
    check: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    ask: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3M12 17v.5"/></svg>',
    speak: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  };
  const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const longDate = (s) => { const d = D.toDate(s); return `${D.DAY_LONG[d.getDay()][0].toUpperCase() + D.DAY_LONG[d.getDay()].slice(1)}, ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`; };
  const color = (subject) => { let h = 0; for (const ch of String(subject || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

  // ---------------- state ----------------
  let store, plan = null, prevPlan = null, weekOffset = 0, pending = null, ai = { providers: [] };
  const chat = {};

  function load() {
    try { store = JSON.parse(localStorage.getItem(KEY)); } catch { store = null; }
    if (!store || !Array.isArray(store.profiles) || !store.profiles.length) {
      const demo = Demo.busyWeek();
      store = { profiles: [demo, Demo.overloaded(), Demo.blank('Me')], activeId: demo.id, prefs: {} };
    }
    store.prefs = store.prefs || {};
    if (!store.profiles.find((p) => p.id === store.activeId)) store.activeId = store.profiles[0].id;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode: still works for this session */ } }
  const P = () => store.profiles.find((p) => p.id === store.activeId);
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  function replan(showDiff) {
    const p = P();
    ['overrides', 'skipped', 'done'].forEach((k) => (p[k] = p[k] || {}));
    p.dismissed = p.dismissed || []; p.history = p.history || []; p.log = p.log || [];
    plan = Scheduler.plan(p, { today: D.today(), nowMin: nowMin() });
    if (showDiff && prevPlan) {
      const changes = Scheduler.diff(prevPlan, plan, p);
      toast(changes.length ? `<strong>Re-planned.</strong> What changed:<ul>${changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<strong>Re-planned.</strong> No sessions needed to move.');
    }
    prevPlan = plan;
    render();
  }
  function mutate(fn) { fn(P()); save(); replan(true); }

  // ---------------- rendering ----------------
  function render() { renderProfiles(); renderToday(); renderAlerts(); renderWeek(); renderTasks(); renderActs(); renderChat(); renderPill(); renderBadges(); }

  // ---------------- navigation: four views, one URL each (#plan #add #tasks #coach) ----------------
  const VIEWS = { plan: 'Plan', add: 'Add to plan', tasks: 'Tasks & activities', coach: 'Coach' };
  let view = null;
  function currentView() { const h = location.hash.slice(1); return VIEWS[h] ? h : 'plan'; }
  function showView() {
    const v = currentView();
    if (v === view) return;
    const first = view === null; view = v;
    document.querySelectorAll('.view').forEach((el) => { el.hidden = el.dataset.view !== v; });
    document.querySelectorAll('[data-nav]').forEach((a) => { if (a.dataset.nav === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = `${VIEWS[v]} · Tempo`;
    if (!first) {
      window.scrollTo(0, 0);
      // move focus to the new view's heading so keyboard and screen-reader users land in the right place
      const target = (pendingFocus && $(pendingFocus)) || document.querySelector(`#h-${v}`);
      if (target) target.focus({ preventScroll: true });
    }
    pendingFocus = null;
    if (v === 'coach') { const c = $('#chat'); c.scrollTop = 1e6; }
  }
  let pendingFocus = null;
  function go(v, focusEl) {
    pendingFocus = focusEl || null;
    if (location.hash !== '#' + v) { location.hash = v; showView(); } // switch now; the later hashchange is a no-op
    else { if (focusEl) { const el = $(focusEl); el && el.focus(); } pendingFocus = null; }
  }
  function renderBadges() {
    const risk = Object.values(plan.items).filter((r) => r.status === 'at-risk').length;
    const p = P(), needInfo = p.items.filter((i) => !i.done && !plan.items[i.id]).length;
    const set = (k, n, title) => document.querySelectorAll(`[data-badge="${k}"]`).forEach((b) => {
      b.hidden = !n; b.textContent = n === true ? '' : String(n);
      if (n) b.setAttribute('aria-label', title); else b.removeAttribute('aria-label');
      b.setAttribute('role', 'status');
    });
    set('plan', risk, `${risk} task${risk === 1 ? '' : 's'} won't fit`);
    set('tasks', needInfo, `${needInfo} task${needInfo === 1 ? '' : 's'} need a date`);
    set('add', pending ? true : 0, 'Waiting for you to check');
  }

  // ---------------- AI engine choice ----------------
  // 'local' (Ollama on this computer), 'groq' (online), … or 'offline' (built-in rules).
  const engineInfo = (id) => ai.providers.find((p) => p.id === id);
  function engine() {
    const e = engineInfo(store.prefs.engine);
    if (!e || !e.ready) return null;
    if (store.prefs.offlineOnly && e.where === 'online') return null; // privacy switch blocks online engines only
    return e;
  }
  function renderPill() {
    const wrap = $('#aiPill'), sel = $('#aiEngine'), e = engine();
    const cur = e ? e.id : 'offline';
    const label = (p) => p.id === 'local' ? `Local AI (${p.model})` : `${p.name} (online)`;
    sel.innerHTML = ai.providers.map((p) => {
      const blocked = !p.ready || (store.prefs.offlineOnly && p.where === 'online');
      return `<option value="${p.id}" ${p.id === cur ? 'selected' : ''} ${blocked ? 'disabled' : ''}>${esc(label(p))}${p.ready ? '' : ' (not set up)'}</option>`;
    }).join('') + `<option value="offline" ${cur === 'offline' ? 'selected' : ''}>Offline rules (no AI model)</option>`;
    wrap.classList.toggle('on', !!e);
    wrap.title = e ? `${e.name} (${e.model}) understands your text, ${e.where}. ${e.id === 'local' ? 'Nothing leaves this computer.' : 'Your text is sent to ' + e.name + '.'} Planning always runs on your device.`
      : 'No AI model: built-in rules understand your text. Planning works fully.' +
        ai.providers.filter((p) => !p.ready).map((p) => `\n${p.name}: ${p.reason}`).join('');
  }
  async function callAI(endpoint, payload) {
    const e = engine();
    const wrap = $('#aiPill'); wrap.classList.add('busy');
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, provider: e.id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || res.status);
      return j;
    } finally { wrap.classList.remove('busy'); }
  }

  function renderProfiles() {
    $('#profileSelect').innerHTML = store.profiles.map((p) => `<option value="${p.id}" ${p.id === store.activeId ? 'selected' : ''}>${esc(p.nickname)}</option>`).join('') +
      '<option value="__new">+ New student…</option><option value="__demo1">+ Load demo: busy week</option><option value="__demo2">+ Load demo: exam crunch</option>';
  }

  function renderToday() {
    const p = P(), day = plan.days[0], el = $('#todayCard');
    const energy = p.energy && p.energy.date === plan.today ? p.energy.level : 'ok';
    const next = day.sessions[0];
    const atRisk = Object.values(plan.items).filter((r) => r.status === 'at-risk').length;
    const doneToday = (p.log || []).filter((l) => l.date === plan.today);
    const pct = day.cap ? Math.min(100, Math.round((day.used / Math.max(day.cap, 1)) * 100)) : 0;
    const left = Object.keys(plan.items).length;
    el.innerHTML = `
      <div class="today-top">
        <div><h2 id="todayH">Today</h2><div class="display">${esc(longDate(plan.today))}</div></div>
        <span class="tag ${atRisk ? 'at-risk' : 'ok'}">${atRisk ? `${atRisk} task${atRisk > 1 ? 's' : ''} won't fit` : 'Everything fits'}</span>
      </div>
      ${next ? `<div class="next">
          <div class="next-time">${D.clock(next.start)}<small>${D.dur(next.min)}</small></div>
          <div style="min-width:0"><div class="eyebrow">Next up</div><div class="next-title">${esc(next.title)}</div>
            <div class="next-sub"><i style="background:${color(next.subject)}"></i>${esc(next.subject)} · ${esc(next.label)}</div></div>
          <button class="btn" data-sess="0:0">Open</button></div>`
        : left === 0
          ? `<div class="next free"><div><div class="next-title">Nothing planned yet.</div><div class="next-sub">Tell Tempo what's coming up and it will build your plan.</div></div><a class="btn primary" href="#add">Add your week →</a></div>`
          : `<div class="next free"><div><div class="next-title">Nothing left for today.</div><div class="next-sub">${day.cap === 0 ? 'No study time is available for the rest of today.' : 'Rest, or get ahead with tomorrow\'s first session.'}</div></div></div>`}
      <div class="stats">
        <div class="stat"><div class="eyebrow">Planned today</div><b>${D.dur(day.used)} <small>of ${D.dur(day.cap)}</small></b><div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div></div>
        <div class="stat"><div class="eyebrow">Work left</div><b>${D.dur(plan.stats.totalNeed)}</b><a class="link-row" href="#tasks">${left} task${left === 1 ? '' : 's'} →</a></div>
        <div class="stat"><div class="eyebrow">Done today</div><b>${doneToday.length}</b><span class="small muted">session${doneToday.length === 1 ? '' : 's'} logged</span></div>
      </div>
      <div class="energy-row">
        <span class="label">Energy today</span>
        <div class="seg" role="group" aria-label="Energy today">
          <button class="btn small" data-energy="low" aria-pressed="${energy === 'low'}">Low</button>
          <button class="btn small" data-energy="ok" aria-pressed="${energy === 'ok'}">Normal</button>
          <button class="btn small" data-energy="high" aria-pressed="${energy === 'high'}">High</button>
        </div>
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Change today's study time">
          <button class="btn small" data-today="-30">−30 min</button>
          <button class="btn small" data-today="30">+30 min</button>
          <button class="btn small" data-today="skip">Skip today</button>
        </div>
      </div>`;
  }

  function issueKey(i) { return i.dismissKey || `${i.code}:${i.itemId || ''}:${i.date || ''}`; }
  function renderAlerts() {
    const p = P();
    const list = plan.issues.filter((i) => !p.dismissed.includes(issueKey(i)) && !(i.options || []).some((o) => o.action.type === 'dismiss' && p.dismissed.includes(o.action.key)));
    const label = { error: 'Doesn\'t fit', warn: 'Heads up', info: 'Note' };
    $('#alerts').innerHTML = list.slice(0, 6).map((i, n) => `
      <div class="alert ${i.severity}" role="${i.severity === 'error' ? 'alert' : 'note'}">
        <div><strong class="k">${label[i.severity]}:</strong>${esc(i.message)}</div>
        <div class="row">${(i.options || []).map((o, k) => `<button class="btn small" data-opt="${n}:${k}">${esc(o.label)}</button>`).join('')}
          ${i.severity !== 'error' ? `<button class="btn small ghost" data-dismiss="${esc(issueKey(i))}">Dismiss</button>` : ''}</div>
      </div>`).join('') + (list.some((i) => i.severity === 'error') ? '<p class="alert-foot">Tempo won\'t secretly drop work or squeeze it into your sleep. You choose the trade-off.</p>' : '');
    $('#alerts').dataset.n = '';
    $('#alerts')._issues = list;
  }

  function renderWeek() {
    const p = P(), start = weekOffset * 7;
    const a = D.toDate(D.add(plan.today, start)), b = D.toDate(D.add(plan.today, start + 6));
    $('#weekLabel').textContent = a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${MONTH_LONG[b.getMonth()]}` : `${a.getDate()} ${D.MONTHS[a.getMonth()]} – ${b.getDate()} ${D.MONTHS[b.getMonth()]}`;
    $('#weekPrev').disabled = weekOffset === 0;
    $('#weekToday').disabled = weekOffset === 0;
    $('#weekH').textContent = weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : `In ${weekOffset} weeks`;
    let html = '';
    for (let i = start; i < start + 7; i++) {
      const date = D.add(plan.today, i), day = plan.days[i];
      const dues = p.items.filter((it) => !it.done && it.due === date);
      const logs = (p.log || []).filter((l) => l.date === date);
      const commits = day ? day.commitments : [];
      const items = [
        ...commits.map((c) => ({ t: c.a, h: `<div class="commit"><span class="mono">${D.clock(c.a)}</span>${esc(c.title)}</div>` })),
        ...logs.map((l) => ({ t: l.start ?? 0, h: `<div class="sess done" style="--c:${color(l.subject)}"><span class="tm">${ICON.check} ${D.dur(l.min)}</span><span class="st">${esc(l.title)}</span></div>` })),
        ...(day ? day.sessions.map((s, k) => ({ t: s.start, h: `<button class="sess ${s.kind === 'exam' ? 'exam' : ''}" style="--c:${color(s.subject)}" data-sess="${i}:${k}" aria-label="${esc(`${D.clock(s.start)} ${s.title}, ${s.label}, ${D.dur(s.min)}. Open details`)}"><span class="tm"><span>${D.clock(s.start)}</span><span>${D.dur(s.min)}</span></span><span class="st">${esc(s.title)}</span><span class="sl">${esc(s.label)}</span></button>` })) : []),
      ].sort((a, b) => a.t - b.t).map((x) => x.h).join('');
      html += `<div class="day ${i === 0 ? 'is-today' : ''}" role="listitem" aria-label="${esc(D.label(date))}">
        <div class="day-h"><span class="dnum">${D.toDate(date).getDate()}</span><span class="dow">${i === 0 ? 'Today' : D.DAY_NAMES[D.dow(date)]}</span><span class="load" title="${day && day.cap ? `${D.dur(day.used)} planned of ${D.dur(day.cap)} available` : ''}">${day && day.cap ? D.dur(day.used).replace(' ', '') : ''}</span></div>
        <div class="day-bar" aria-hidden="true"><i style="width:${day && day.cap ? Math.min(100, Math.round(day.used / day.cap * 100)) : 0}%"></i></div>
        ${dues.map((it) => `<div class="due-flag">${ICON.pin}<span>${it.kind === 'exam' ? 'Exam' : 'Due'}: ${esc(it.title)}</span></div>`).join('')}
        ${items || '<div class="empty small">Free</div>'}
      </div>`;
    }
    $('#week').innerHTML = html;
  }

  function renderTasks() {
    const p = P();
    const open = p.items.filter((i) => !i.done).sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1);
    const done = p.items.filter((i) => i.done);
    const statusText = { ok: 'On track', tight: 'Tight', 'at-risk': 'Won\'t fit' };
    const weekEnd = D.add(plan.today, 6);
    const row = (it) => {
      const r = plan.items[it.id];
      return `<li class="row-btn" tabindex="0" role="button" data-item="${it.id}" aria-label="Edit ${esc(it.title)}">
        <span class="dot" style="background:${color(it.subject)}"></span>
        <div class="grow"><div class="t">${esc(it.title)}</div>
          <div class="meta">${it.due ? `${it.kind === 'exam' ? 'Exam' : 'Due'} ${esc(D.label(it.due))}` : '<strong>No date yet</strong>'}${r ? ` · ~${D.dur(r.predicted.minutes)}${it.progressMin ? `, ${D.dur(it.progressMin)} done` : ''}` : ''}</div></div>
        ${r ? `<span class="tag ${r.status}">${statusText[r.status]}</span>` : `<span class="tag tight">Needs a date</span>`}
        <svg class="i chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </li>`;
    };
    const groups = [
      ['Needs your attention', open.filter((i) => !plan.items[i.id] || plan.items[i.id].status === 'at-risk'), 'warn'],
      ['Due in the next 7 days', open.filter((i) => plan.items[i.id] && plan.items[i.id].status !== 'at-risk' && i.due && i.due <= weekEnd), ''],
      ['Later', open.filter((i) => plan.items[i.id] && plan.items[i.id].status !== 'at-risk' && (!i.due || i.due > weekEnd)), ''],
    ].filter(([, list]) => list.length);
    $('#taskList').innerHTML = (groups.map(([title, list, cls]) => `<div class="group-h ${cls}"><span>${title}</span><span>${list.length}</span></div><ul class="list">${list.map(row).join('')}</ul>`).join('') ||
      '<p class="empty">No tasks yet. <a class="link-row" href="#add">Tell Tempo about your week →</a></p>') +
      (done.length ? `<p class="small muted" style="margin:.9rem 0 0">${ICON.check} ${done.length} finished</p>` : '');
    const n = open.length;
    $('#tasksEyebrow').textContent = n ? `${n} open task${n === 1 ? '' : 's'} · ${p.commitments.length} activit${p.commitments.length === 1 ? 'y' : 'ies'}` : 'Everything Tempo is planning around';
  }

  function renderActs() {
    const p = P();
    $('#actList').innerHTML = p.commitments.map((c) => `<li tabindex="0" role="button" data-act="${c.id}" aria-label="Edit ${esc(c.title)}">
      <span class="act-dot"></span>
      <div class="grow"><div class="t">${esc(c.title)}</div><div class="meta">${c.date ? esc(D.label(c.date)) : c.days.map((d) => D.DAY_NAMES[d]).join(', ')} · ${D.clock(D.toMin(c.start))}–${D.clock(D.toMin(c.end))}</div></div>
    </li>`).join('') || '<li class="empty">No activities yet. Add sports, clubs or a job so Tempo plans around them.</li>';
  }

  function renderChat() {
    const msgs = chat[store.activeId] || [];
    $('#chat').innerHTML = msgs.map((m) => `<div class="msg ${m.me ? 'me' : 'bot'}">${esc(m.text)}${m.src ? `<span class="src">${esc(m.src)}</span>` : ''}</div>`).join('') ||
      '<div class="msg bot">Ask me about your plan: why something is scheduled, what to do first, or whether you\'ll finish on time. I won\'t do your homework, but I\'ll help you plan it.<span class="src">coach</span></div>';
    $('#chat').scrollTop = 1e6;
    $('#coachChips').innerHTML = ['What should I do first?', 'Will I finish everything?', 'Why is my next session there?', 'How long will my biggest task take?', 'I\'m stressed'].map((q) => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  }

  // ---------------- review of understood text (human in the loop) ----------------
  function renderReview() {
    const el = $('#review');
    if (!pending) { el.innerHTML = ''; return; }
    const r = pending, p = P();
    const as = (o, f) => (o.assumed || []).includes(f) ? 'assumedField' : '';
    const kindSel = (k) => `<select data-f="kind"><option value="assignment" ${k !== 'exam' ? 'selected' : ''}>Assignment</option><option value="exam" ${k === 'exam' ? 'selected' : ''}>Exam / test</option></select>`;
    const dayBoxes = (days) => `<div class="days-pick">${D.DAY_NAMES.map((n, i) => `<label><input type="checkbox" data-day="${i}" ${days.includes(i) ? 'checked' : ''}>${n}</label>`).join('')}</div>`;
    const count = r.items.length + r.commitments.length + r.changes.length + (r.availability.dailyMinutes != null || r.availability.weekendMinutes != null ? 1 : 0);
    el.innerHTML = `<div class="review">
      <div class="review-head"><strong>${count ? `I found ${count} thing${count > 1 ? 's' : ''}. Check them.` : 'I couldn\'t find anything to plan.'}</strong>
        <span class="small muted">Read by <strong style="color:var(--ink)">${esc(r.engine)}</strong>. AI can misread, so nothing is added until you say so. <span class="tag assumed plain">Yellow</span> means it guessed.</span>
        ${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}</div>
      ${r.questions.map((q) => `<div class="q">${ICON.ask}<span>${esc(q)}</span></div>`).join('')}
      ${r.items.map((it, i) => { const dup = p.items.find((x) => !x.done && x.kind === it.kind && x.subject.toLowerCase() === it.subject.toLowerCase() && it.subject !== 'General'); return `<div class="rv" data-kind="item" data-i="${i}">
        <div class="rv-head"><label><input type="checkbox" data-f="keep" ${dup ? '' : 'checked'}> Add this</label><span class="tag info plain">${it.kind === 'exam' ? 'Exam' : 'Task'}</span></div>
        ${dup ? `<div class="q full">${ICON.ask}<span>You already have <strong>${esc(dup.title)}</strong> (${esc(dup.due ? D.label(dup.due) : 'no date')}). Is this the same thing? I've left it unticked. Tick "Add this" if it's different.</span></div>` : ''}
        <label class="full">Title<input data-f="title" value="${esc(it.title)}"></label>
        <label>Type${kindSel(it.kind)}</label>
        <label>Subject<input data-f="subject" value="${esc(it.subject)}" class="${as(it, 'subject')}"></label>
        <label>${it.kind === 'exam' ? 'Exam date' : 'Due date'}<input type="date" data-f="due" value="${esc(it.due || '')}" class="${as(it, 'due') || (!it.due ? 'assumedField' : '')}"></label>
        <label>Your estimate (min, optional)<input type="number" min="0" step="15" data-f="estMin" value="${it.estMin || ''}" placeholder="AI will predict"></label>
        <label class="full">Difficulty<select data-f="difficulty">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${(it.difficulty || 3) === d ? 'selected' : ''}>${d} — ${['very easy', 'easy', 'normal', 'hard', 'very hard'][d - 1]}</option>`).join('')}</select></label>
      </div>`; }).join('')}
      ${r.commitments.map((c, i) => `<div class="rv" data-kind="commit" data-i="${i}">
        <div class="rv-head"><label><input type="checkbox" data-f="keep" checked> Add this</label><span class="tag info plain">Activity</span></div>
        <label class="full">Activity<input data-f="title" value="${esc(c.title)}"></label>
        <div class="full ${as(c, 'days')}" style="border-radius:8px">${c.date ? `<label>One-off date<input type="date" data-f="date" value="${esc(c.date)}"></label>` : dayBoxes(c.days)}</div>
        <label>Starts<input type="time" data-f="start" value="${esc(c.start)}" class="${as(c, 'time')}"></label>
        <label>Ends<input type="time" data-f="end" value="${esc(c.end)}" class="${as(c, 'time') || as(c, 'end time')}"></label>
      </div>`).join('')}
      ${r.availability.dailyMinutes != null ? `<label class="q"><span><input type="checkbox" data-avail="daily" checked style="width:auto"> Set study time to <strong>${D.dur(r.availability.dailyMinutes)}</strong> per school day</span></label>` : ''}
      ${r.availability.weekendMinutes != null ? `<label class="q"><span><input type="checkbox" data-avail="weekend" checked style="width:auto"> Set weekend study time to <strong>${D.dur(r.availability.weekendMinutes)}</strong></span></label>` : ''}
      ${r.changes.map((c, i) => { const it = p.items.find((x) => x.id === c.itemId); return `<label class="q"><span><input type="checkbox" data-change="${i}" checked style="width:auto"> ${esc(it ? it.title : '?')}: ${c.remove ? 'remove it' : c.done ? 'mark as finished' : c.due ? `move to <strong>${esc(D.label(c.due))}</strong>` : `new estimate ${D.dur(c.estMin)}`}</span></label>`; }).join('')}
      <div class="row">${count ? '<button class="btn primary" id="btnAccept">Add to my plan</button>' : ''}<button class="btn ghost" id="btnDiscard">Discard</button></div>
    </div>`;
  }

  function acceptReview() {
    const r = pending, el = $('#review'), skipped = [];
    mutate((p) => {
      el.querySelectorAll('.rv[data-kind="item"]').forEach((card) => {
        const g = (f) => card.querySelector(`[data-f="${f}"]`);
        if (!g('keep').checked) return;
        p.items.push({ id: Demo.id('i'), kind: g('kind').value, title: g('title').value.trim() || 'Task', subject: g('subject').value.trim() || 'General',
          due: g('due').value || null, estMin: Number(g('estMin').value) || null, difficulty: Number(g('difficulty').value) || 3, progressMin: 0, source: r.engine });
      });
      el.querySelectorAll('.rv[data-kind="commit"]').forEach((card) => {
        const g = (f) => card.querySelector(`[data-f="${f}"]`);
        if (!g('keep').checked) return;
        const days = [...card.querySelectorAll('[data-day]')].filter((x) => x.checked).map((x) => Number(x.dataset.day));
        const date = g('date') ? g('date').value : null;
        if (!days.length && !date) { skipped.push(g('title').value); return; }
        p.commitments.push({ id: Demo.id('c'), title: g('title').value.trim() || 'Activity', days, date: date || null, start: g('start').value || '16:00', end: g('end').value || '18:00' });
      });
      p.settings = p.settings || {};
      const daily = (p.settings.daily || Scheduler.DEFAULT_SETTINGS.daily).slice();
      const wk = (p.settings.weekendDays || Scheduler.DEFAULT_SETTINGS.weekendDays);
      if (el.querySelector('[data-avail="daily"]:checked')) daily.forEach((_, i) => { if (!wk.includes(i) || r.availability.weekendMinutes == null) daily[i] = r.availability.dailyMinutes; });
      if (el.querySelector('[data-avail="weekend"]:checked')) wk.forEach((i) => (daily[i] = r.availability.weekendMinutes));
      p.settings.daily = daily;
      el.querySelectorAll('[data-change]:checked').forEach((box) => {
        const c = r.changes[Number(box.dataset.change)], it = p.items.find((x) => x.id === c.itemId);
        if (!it) return;
        if (c.remove) p.items = p.items.filter((x) => x.id !== it.id);
        else if (c.done) it.done = true;
        else { if (c.due) it.due = c.due; if (c.estMin) it.estMin = c.estMin; }
      });
    });
    pending = null; $('#tellInput').value = ''; renderReview(); renderBadges();
    go('plan');
    if (skipped.length) setTimeout(() => toast(`Didn't add ${skipped.map(esc).join(', ')}: pick which days it happens.`), 2500);
  }

  async function understand() {
    const text = $('#tellInput').value.trim();
    if (!text) { $('#tellInput').focus(); return; }
    const btn = $('#btnParse'); btn.disabled = true; btn.textContent = 'Understanding…';
    const today = D.today(), p = P();
    const existing = p.items.filter((i) => !i.done).map(({ id, title, subject, kind, due }) => ({ id, title, subject, kind, due }));
    let raw, note = '';
    const e = engine();
    if (e) {
      const t0 = Date.now(), label = e.id === 'local' ? 'Local AI is reading' : `${e.name} is reading`;
      const tick = () => { btn.textContent = `${label}… ${Math.round((Date.now() - t0) / 1000)}s`; };
      tick(); const timer = setInterval(tick, 1000);
      try { raw = await callAI('/api/parse', { text, today, weekday: D.DAY_LONG[D.dow(today)], existing }); }
      catch (err) { note = `${e.name} was unavailable (${err.message}), so the offline rules read it instead`; }
      finally { clearInterval(timer); }
    }
    if (!raw) raw = Parser.parseRules(text, today, existing);
    pending = Parser.sanitize(raw, today, existing, text);
    const fixed = pending.items.filter((i) => i.fixed).map((i) => `${i.title}: ${i.fixed}`);
    pending.note = [note, fixed.length ? `Tempo checked the AI's dates and corrected ${fixed.length}: ${fixed.join('; ')}` : ''].filter(Boolean).join('. ');
    btn.disabled = false; btn.textContent = 'Understand this';
    renderReview(); renderBadges();
    const first = $('#review .review'); if (first) { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
    $('#review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------------- coach ----------------
  async function askCoach(q) {
    if (!q.trim()) return;
    const msgs = (chat[store.activeId] = chat[store.activeId] || []);
    msgs.push({ me: true, text: q }); renderChat();
    let answer, src;
    const e = engine(), g = Coach.guard(q);
    if (g) { answer = g; src = 'Tempo safety rule · same answer on every AI engine'; }
    else if (e) {
      msgs.push({ text: e.id === 'local' ? 'Thinking on this computer. This can take up to a minute…' : 'Thinking…' }); renderChat();
      try {
        answer = (await callAI('/api/coach', { question: q, context: Coach.buildContext(P(), plan, { compact: e.id === 'local' }) })).answer;
        src = `${e.name}${e.id === 'local' ? ' on this computer' : ''} · based on your plan · can make mistakes`;
      } catch { /* fall through to offline */ }
      msgs.pop();
    }
    if (!answer) { answer = Coach.offline(q, P(), plan); src = 'Offline coach · answers from your plan data'; }
    msgs.push({ text: answer, src }); renderChat();
  }

  // ---------------- actions from alerts ----------------
  function applyAction(a) {
    if (a.type === 'editItem') return openItem(a.itemId);
    mutate((p) => {
      const it = p.items.find((x) => x.id === a.itemId);
      const S = Scheduler.settingsOf(p);
      if (a.type === 'markDone' && it) it.done = true;
      if (a.type === 'removeCommitment') p.commitments = p.commitments.filter((c) => c.id !== a.id);
      if (a.type === 'dismiss') p.dismissed.push(a.key);
      if (a.type === 'moveDue' && it) it.due = a.due;
      if (a.type === 'target' && it) it.targetMin = a.minutes;
      if (a.type === 'boost') a.dates.forEach((d) => { p.overrides[d] = (p.overrides[d] ?? S.daily[D.dow(d)]) + a.minutes; });
    });
  }

  // ---------------- dialogs ----------------
  const dlg = $('#dlg'), body = $('#dlgBody');
  function openDialog(html, bind) {
    body.innerHTML = html + '<button type="button" class="icon-btn dlg-x" aria-label="Close"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    const h = body.querySelector('h2'); if (h) h.id = 'dlgTitle';
    body.querySelector('.dlg-x').onclick = () => dlg.close();
    bind && bind(body); dlg.showModal();
    const f = body.querySelector('input:not([type=checkbox]),select,.actions .btn.primary,button'); f && f.focus();
  }
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // click outside closes
  const close = () => dlg.close();

  function openSession(i, k) {
    const s = plan.days[i].sessions[k], it = P().items.find((x) => x.id === s.itemId), r = plan.items[s.itemId];
    openDialog(`
      <div class="eyebrow" style="color:${color(s.subject)}">${esc(s.subject)} · ${esc(s.label)}</div>
      <h2>${esc(s.title)}</h2>
      <div class="sess-meta">${esc(D.label(s.date))} · ${D.clock(s.start)}–${D.clock(s.end)} · ${D.dur(s.min)}</div>
      <div class="why"><strong>Why this session is here</strong><br>${esc(s.why)}</div>
      ${r ? `<div class="small conf">Total estimate: <strong>${D.dur(r.predicted.minutes)}</strong> (likely ${D.dur(r.predicted.low)}–${D.dur(r.predicted.high)}) · confidence: <strong>${r.predicted.confidence}</strong>. It's a prediction, not a fact.</div>` : ''}
      <fieldset><legend>Did it? How long did it really take?</legend>
        <div class="row"><input type="number" id="actual" value="${s.min}" min="5" max="600" step="5" style="width:6rem" aria-label="Minutes it took"> <span class="small">minutes</span>
        <button type="button" class="btn small ghost" data-adj="-10">−10</button><button type="button" class="btn small ghost" data-adj="10">+10</button></div>
        <p class="small muted" style="margin:.4rem 0 0">This teaches Tempo how long ${esc(s.subject)} really takes <em>you</em>.</p>
      </fieldset>
      <div class="actions">
        ${i === 0 ? '<button type="button" class="btn ghost" id="sSkip">Can\'t do it today</button>' : ''}
        <button type="button" class="btn ghost" id="sEdit">Edit task</button>
        <button type="button" class="btn ghost" id="sClose">Close</button>
        <button type="button" class="btn primary" id="sDone">${ICON.check} Mark done</button>
      </div>`, (b) => {
      b.querySelectorAll('[data-adj]').forEach((x) => x.onclick = () => { const a = b.querySelector('#actual'); a.value = Math.max(5, Number(a.value) + Number(x.dataset.adj)); });
      b.querySelector('#sClose').onclick = close;
      b.querySelector('#sEdit').onclick = () => { close(); openItem(s.itemId); };
      if (b.querySelector('#sSkip')) b.querySelector('#sSkip').onclick = () => { close(); mutate((p) => { p.skipped[plan.today] = (p.skipped[plan.today] || 0) + s.min; }); };
      b.querySelector('#sDone').onclick = () => {
        const actual = Math.max(5, Number(b.querySelector('#actual').value) || s.min);
        close();
        mutate((p) => {
          const t = p.items.find((x) => x.id === s.itemId); if (!t) return;
          t.progressMin = (t.progressMin || 0) + s.min;
          p.history.push({ subject: t.subject, kind: t.kind, plannedMin: s.min, actualMin: actual, date: D.today() });
          p.log.push({ date: D.today(), itemId: t.id, title: t.title, subject: t.subject, min: actual, start: s.date === D.today() ? s.start : nowMin() });
        });
      };
    });
  }

  function openItem(id) {
    const p = P(), isNew = !id;
    const it = isNew ? { kind: 'assignment', title: '', subject: '', due: D.add(D.today(), 3), estMin: null, difficulty: 3, progressMin: 0 } : p.items.find((x) => x.id === id);
    const r = !isNew && plan.items[id];
    openDialog(`
      <h2>${isNew ? 'Add a task or exam' : 'Edit task'}</h2>
      <label>Title<input id="fTitle" value="${esc(it.title)}" required placeholder="e.g. Physics lab report"></label>
      <div class="grid2">
        <label>Type<select id="fKind"><option value="assignment">Assignment</option><option value="exam" ${it.kind === 'exam' ? 'selected' : ''}>Exam / test</option></select></label>
        <label>Subject<input id="fSubject" value="${esc(it.subject)}" placeholder="e.g. Physics"></label>
        <label>Due / exam date<input type="date" id="fDue" value="${esc(it.due || '')}"></label>
        <label>Difficulty<select id="fDiff">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${(it.difficulty || 3) === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label>Your estimate (minutes)<input type="number" id="fEst" min="0" step="15" value="${it.estMin || ''}" placeholder="let Tempo predict"></label>
        <label>Already done (minutes)<input type="number" id="fProg" min="0" step="15" value="${it.progressMin || 0}"></label>
      </div>
      ${it.targetMin ? `<div class="small">You chose a focused target of ${D.dur(it.targetMin)}. <button type="button" class="btn small ghost" id="fClearTarget">Use full estimate again</button></div>` : ''}
      ${r ? `<div class="why"><strong>Tempo's prediction: ${D.dur(r.predicted.minutes)}</strong> (likely ${D.dur(r.predicted.low)}–${D.dur(r.predicted.high)}, confidence ${r.predicted.confidence})<br><span class="small">${esc(r.predicted.why)}</span></div>` : ''}
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn ghost danger" id="fDel">Delete</button><button type="button" class="btn ghost" id="fFin">Mark finished</button>'}
        <button type="button" class="btn ghost" id="fCancel">Cancel</button>
        <button type="button" class="btn primary" id="fSave">Save</button>
      </div>`, (b) => {
      b.querySelector('#fCancel').onclick = close;
      if (!isNew) {
        b.querySelector('#fDel').onclick = () => { if (confirm(`Delete "${it.title}"?`)) { close(); mutate((q) => { q.items = q.items.filter((x) => x.id !== id); }); } };
        b.querySelector('#fFin').onclick = () => { close(); mutate((q) => { q.items.find((x) => x.id === id).done = true; }); };
      }
      if (b.querySelector('#fClearTarget')) b.querySelector('#fClearTarget').onclick = () => { close(); mutate((q) => { delete q.items.find((x) => x.id === id).targetMin; }); };
      b.querySelector('#fSave').onclick = () => {
        const v = { title: b.querySelector('#fTitle').value.trim(), kind: b.querySelector('#fKind').value, subject: b.querySelector('#fSubject').value.trim() || 'General',
          due: b.querySelector('#fDue').value || null, difficulty: Number(b.querySelector('#fDiff').value), estMin: Number(b.querySelector('#fEst').value) || null, progressMin: Number(b.querySelector('#fProg').value) || 0 };
        if (!v.title) { b.querySelector('#fTitle').focus(); return; }
        close();
        mutate((q) => { if (isNew) q.items.push({ id: Demo.id('i'), ...v, source: 'manual' }); else Object.assign(q.items.find((x) => x.id === id), v); });
      };
    });
  }

  function openAct(id) {
    const p = P(), isNew = !id;
    const c = isNew ? { title: '', days: [], date: null, start: '16:00', end: '17:30' } : p.commitments.find((x) => x.id === id);
    openDialog(`
      <h2>${isNew ? 'Add an activity' : 'Edit activity'}</h2>
      <label>Name<input id="aTitle" value="${esc(c.title)}" placeholder="e.g. Basketball practice"></label>
      <div><div class="small muted">Repeats on</div><div class="days-pick">${D.DAY_NAMES.map((n, i) => `<label><input type="checkbox" data-day="${i}" ${c.days.includes(i) ? 'checked' : ''}>${n}</label>`).join('')}</div></div>
      <label>…or one-off date<input type="date" id="aDate" value="${esc(c.date || '')}"></label>
      <div class="grid2"><label>Starts<input type="time" id="aStart" value="${esc(c.start)}"></label><label>Ends<input type="time" id="aEnd" value="${esc(c.end)}"></label></div>
      <div class="actions">${isNew ? '' : '<button type="button" class="btn ghost danger" id="aDel">Delete</button>'}<button type="button" class="btn ghost" id="aCancel">Cancel</button><button type="button" class="btn primary" id="aSave">Save</button></div>`, (b) => {
      b.querySelector('#aCancel').onclick = close;
      if (!isNew) b.querySelector('#aDel').onclick = () => { close(); mutate((q) => { q.commitments = q.commitments.filter((x) => x.id !== id); }); };
      b.querySelector('#aSave').onclick = () => {
        const days = [...b.querySelectorAll('[data-day]')].filter((x) => x.checked).map((x) => Number(x.dataset.day));
        const v = { title: b.querySelector('#aTitle').value.trim() || 'Activity', days, date: b.querySelector('#aDate').value || null, start: b.querySelector('#aStart').value, end: b.querySelector('#aEnd').value };
        if (!v.days.length && !v.date) { alert('Pick the days it repeats, or a one-off date.'); return; }
        if (D.toMin(v.end) <= D.toMin(v.start)) { alert('The end time must be after the start time.'); return; }
        if (v.date) v.days = [];
        close();
        mutate((q) => { if (isNew) q.commitments.push({ id: Demo.id('c'), ...v }); else Object.assign(q.commitments.find((x) => x.id === id), v); });
      };
    });
  }

  function openSettings() {
    const p = P(), S = Scheduler.settingsOf(p);
    const opt = (vals, cur, fmt = (x) => x) => vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${fmt(v)}</option>`).join('');
    openDialog(`
      <h2>My time &amp; settings</h2>
      <label>Nickname (no real name needed)<input id="sNick" value="${esc(p.nickname)}"></label>
      <div><strong class="small">Study time I can give each day</strong>
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="slider-row"><span>${D.DAY_NAMES[d]}</span><input type="range" min="0" max="360" step="15" value="${S.daily[d]}" data-daily="${d}" aria-label="${D.DAY_LONG[d]} study minutes"><output>${D.dur(S.daily[d])}</output></div>`).join('')}
      </div>
      <div class="grid2">
        <label>Focus session length<select id="sLen">${opt([25, 30, 45, 50, 60], S.sessionLen, (v) => v + ' min')}</select></label>
        <label>Break between sessions<select id="sBreak">${opt([5, 10, 15], S.breakLen, (v) => v + ' min')}</select></label>
        <label>Finish assignments early by<select id="sBuf">${opt([0, 1, 2], S.bufferDays, (v) => v + ' day' + (v === 1 ? '' : 's'))}</select></label>
        <label>Spread exam prep over<select id="sSpread">${opt([3, 5, 6, 8, 10], S.examSpreadDays, (v) => v + ' days')}</select></label>
        <label>School days: from<input type="time" id="sWs" value="${S.window.school[0]}"></label>
        <label>…until (protects sleep)<input type="time" id="sWe" value="${S.window.school[1]}"></label>
        <label>Weekends: from<input type="time" id="sKs" value="${S.window.weekend[0]}"></label>
        <label>…until<input type="time" id="sKe" value="${S.window.weekend[1]}"></label>
      </div>
      <div><div class="small muted">My weekend days</div><div class="days-pick">${D.DAY_NAMES.map((n, i) => `<label><input type="checkbox" data-wk="${i}" ${S.weekendDays.includes(i) ? 'checked' : ''}>${n}</label>`).join('')}</div></div>
      <details><summary class="small">My data</summary><div class="row" style="margin-top:.5rem">
        <button type="button" class="btn small" id="sExport">Download my data</button>
        <button type="button" class="btn small ghost" id="sClearOver">Reset one-day changes</button>
        <button type="button" class="btn small danger" id="sDelete">Delete this profile</button>
        <button type="button" class="btn small danger" id="sWipe">Delete everything</button></div></details>
      <div class="actions"><button type="button" class="btn ghost" id="sCancel">Cancel</button><button type="button" class="btn primary" id="sSave">Save</button></div>`, (b) => {
      b.querySelectorAll('[data-daily]').forEach((r) => r.oninput = () => { r.nextElementSibling.textContent = D.dur(Number(r.value)); });
      b.querySelector('#sCancel').onclick = close;
      b.querySelector('#sExport').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(P(), null, 2)], { type: 'application/json' })); a.download = `tempo-${P().nickname.replace(/\W+/g, '-')}.json`; a.click(); };
      b.querySelector('#sClearOver').onclick = () => { close(); mutate((q) => { q.overrides = {}; q.skipped = {}; q.energy = null; }); };
      b.querySelector('#sDelete').onclick = () => { if (store.profiles.length < 2) return alert('This is your only profile.'); if (!confirm('Delete this profile and all its data?')) return; close(); store.profiles = store.profiles.filter((x) => x.id !== p.id); store.activeId = store.profiles[0].id; save(); prevPlan = null; replan(false); };
      b.querySelector('#sWipe').onclick = () => { if (!confirm('Delete ALL Tempo data from this browser?')) return; try { localStorage.removeItem(KEY); } catch {} location.reload(); };
      b.querySelector('#sSave').onclick = () => {
        close();
        mutate((q) => {
          q.nickname = b.querySelector('#sNick').value.trim() || q.nickname;
          const daily = [0, 0, 0, 0, 0, 0, 0]; b.querySelectorAll('[data-daily]').forEach((r) => (daily[Number(r.dataset.daily)] = Number(r.value)));
          q.settings = { ...q.settings, daily, sessionLen: Number(b.querySelector('#sLen').value), breakLen: Number(b.querySelector('#sBreak').value),
            bufferDays: Number(b.querySelector('#sBuf').value), examSpreadDays: Number(b.querySelector('#sSpread').value),
            weekendDays: [...b.querySelectorAll('[data-wk]')].filter((x) => x.checked).map((x) => Number(x.dataset.wk)),
            window: { school: [b.querySelector('#sWs').value, b.querySelector('#sWe').value], weekend: [b.querySelector('#sKs').value, b.querySelector('#sKe').value] } };
        });
      };
    });
  }

  function applyPrefs() {
    const pr = store.prefs, r = document.documentElement;
    r.style.setProperty('--fs', ({ s: '15px', m: '16px', l: '18px', xl: '21px' })[pr.fs || 'm']);
    pr.theme && pr.theme !== 'auto' ? r.setAttribute('data-theme', pr.theme) : r.removeAttribute('data-theme');
    r.setAttribute('data-contrast', pr.contrast ? 'high' : 'normal');
    r.setAttribute('data-readable', pr.readable ? 'on' : 'off');
    r.setAttribute('data-motion', pr.motion === 'off' ? 'off' : 'on');
  }

  function openA11y() {
    const pr = store.prefs;
    openDialog(`
      <h2>Accessibility</h2>
      <label>Text size<select id="xFs">${[['s', 'Small'], ['m', 'Normal'], ['l', 'Large'], ['xl', 'Extra large']].map(([v, n]) => `<option value="${v}" ${(pr.fs || 'm') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Theme<select id="xTheme">${[['auto', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, n]) => `<option value="${v}" ${(pr.theme || 'auto') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="xContrast" ${pr.contrast ? 'checked' : ''}> High contrast</label>
      <label class="check"><input type="checkbox" id="xRead" ${pr.readable ? 'checked' : ''}> Extra letter &amp; line spacing (can help with dyslexia)</label>
      <label class="check"><input type="checkbox" id="xMotion" ${pr.motion === 'off' ? 'checked' : ''}> Reduce motion</label>
      <button type="button" class="btn" id="xSpeak">${ICON.speak} Read today's plan aloud</button>
      <p class="small muted">Everything works with a keyboard (Tab / Enter), and colours always have a text label too. You can also speak instead of typing with the microphone button (Chrome, Edge, Safari).</p>
      <div class="actions"><button type="button" class="btn primary" id="xDone">Done</button></div>`, (b) => {
      const upd = () => { Object.assign(pr, { fs: b.querySelector('#xFs').value, theme: b.querySelector('#xTheme').value, contrast: b.querySelector('#xContrast').checked, readable: b.querySelector('#xRead').checked, motion: b.querySelector('#xMotion').checked ? 'off' : 'on' }); applyPrefs(); save(); };
      b.querySelectorAll('select,input').forEach((x) => (x.onchange = upd));
      b.querySelector('#xDone').onclick = close;
      b.querySelector('#xSpeak').onclick = speakToday;
    });
  }

  function speakToday() {
    if (!('speechSynthesis' in window)) return alert('Your browser can\'t read aloud.');
    const d = plan.days[0];
    const text = d.sessions.length ? `Today you have ${d.sessions.length} sessions. ` + d.sessions.map((s) => `At ${D.clock(s.start)}, ${s.title}, ${s.label}, for ${s.min} minutes.`).join(' ') : 'Nothing is planned for the rest of today.';
    speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function openAbout() {
    openDialog(`
      <h2>How Tempo uses AI, and its limits</h2>
      <div class="why small"><strong>What the AI does</strong><br>
        1. <strong>Understands</strong> what you type and turns it into tasks. You pick the engine at the top: <em>Local AI</em> (Qwen 2.5 3B on this computer, private), <em>Groq</em> (gpt-oss-120b online, fast) or the built-in <em>offline rules</em>. Tempo's own code then checks the AI's dates and quotes, and you review everything before it's added.<br>
        2. <strong>Predicts</strong> how long tasks will really take <em>you</em>, learning from the times you log.<br>
        3. <strong>Plans</strong>: a scheduling algorithm on your device spreads exam prep, adds buffers, switches subjects, and re-plans whenever something changes.<br>
        4. <strong>Coaches</strong>: answers questions about your plan.</div>
      <div class="why small"><strong>Limits: please read</strong><br>
        • Time estimates are predictions. They start rough and improve as you log real times.<br>
        • Tempo doesn't know your teacher's expectations, your grades, or how you feel unless you tell it.<br>
        • The AI can misread dates or tasks. That's why you always confirm, and yellow marks guesses.<br>
        • It is not a counselor. If you're struggling, talk to a trusted adult or your school counselor.<br>
        • It will never do your graded work for you.</div>
      <div class="why small"><strong>Privacy</strong><br>
        • No account, no real name, no email. Everything is stored only in this browser.<br>
        • Only the text you choose to send (and a summary of your plan for coach questions) goes to the AI. The server does not store it.<br>
        • Download or delete your data any time in Settings → My data.</div>
      <label class="check"><input type="checkbox" id="oOff" ${store.prefs.offlineOnly ? 'checked' : ''}> Never send my text to an online AI (only Local AI or offline rules)</label>
      <div class="actions"><button type="button" class="btn primary" id="oDone">Done</button></div>`, (b) => {
      b.querySelector('#oOff').onchange = (e) => { store.prefs.offlineOnly = e.target.checked; save(); renderPill(); };
      b.querySelector('#oDone').onclick = close;
    });
  }

  function openKeys() {
    openDialog(`
      <h2>Keyboard shortcuts</h2>
      <dl class="keys">
        <dt><kbd>1</kbd></dt><dd>Plan: today and this week</dd>
        <dt><kbd>2</kbd> or <kbd>/</kbd></dt><dd>Add to plan (puts the cursor in the box)</dd>
        <dt><kbd>3</kbd></dt><dd>Tasks &amp; activities</dd>
        <dt><kbd>4</kbd></dt><dd>Coach</dd>
        <dt><kbd>Ctrl</kbd> <kbd>Enter</kbd></dt><dd>Understand what you typed</dd>
        <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous / next week (on the Plan view)</dd>
        <dt><kbd>Esc</kbd></dt><dd>Close a window like this one</dd>
        <dt><kbd>?</kbd></dt><dd>Show these shortcuts</dd>
      </dl>
      <p class="small muted">Shortcuts are ignored while you're typing. Tab moves between everything on the page, and the browser's Back button goes to the previous view.</p>
      <div class="actions"><button type="button" class="btn primary" id="kDone">Got it</button></div>`, (b) => { b.querySelector('#kDone').onclick = close; });
  }

  // ---------------- toast ----------------
  let toastTimer;
  function toast(html) {
    const t = $('#toast'); t.innerHTML = html; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 6500);
  }

  // ---------------- wiring ----------------
  function wire() {
    $('#aiEngine').onchange = (ev) => {
      store.prefs.engine = ev.target.value; save(); renderPill();
      const e = engine();
      toast(e ? `Now using <strong>${esc(e.name)}</strong> (${esc(e.model)}), ${e.where === 'online' ? 'online' : 'private, on this computer'}.` : 'Now using the <strong>offline rules</strong>. Nothing is sent anywhere.');
    };
    $('#btnParse').onclick = understand;
    $('#tellInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) understand(); });
    $('#btnExample').onclick = () => { $('#tellInput').value = Demo.exampleText; $('#tellInput').focus(); };
    $('#review').addEventListener('click', (e) => {
      if (e.target.id === 'btnAccept') acceptReview();
      if (e.target.id === 'btnDiscard') { pending = null; renderReview(); }
    });
    $('#btnAddTask').onclick = () => openItem(null);
    $('#btnAddAct').onclick = () => openAct(null);
    document.querySelectorAll('[data-new]').forEach((b) => (b.onclick = () => (b.dataset.new === 'task' ? openItem(null) : openAct(null))));
    const OPEN = { settings: openSettings, a11y: openA11y, about: openAbout, keys: openKeys };
    document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => OPEN[b.dataset.open]()));
    const week = (d) => { weekOffset = Math.min(5, Math.max(0, weekOffset + d)); renderWeek(); };
    $('#weekPrev').onclick = () => week(-1);
    $('#weekNext').onclick = () => week(1);
    $('#weekToday').onclick = () => { weekOffset = 0; renderWeek(); };
    window.addEventListener('hashchange', () => showView());
    // the skip link must not change the hash (that would switch views)
    document.querySelector('.skip').onclick = (e) => { e.preventDefault(); const h = document.querySelector(`#h-${view}`); (h || $('#main')).focus(); };
    document.addEventListener('keydown', (e) => {
      if (dlg.open || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,textarea,select,[contenteditable]')) return;
      const k = e.key;
      if (k === '1') go('plan'); else if (k === '2') go('add', '#tellInput'); else if (k === '3') go('tasks'); else if (k === '4') go('coach', '#coachInput');
      else if (k === '/') { e.preventDefault(); go('add', '#tellInput'); }
      else if (k === '?') openKeys();
      else if (view === 'plan' && (k === 'ArrowLeft' || k === 'ArrowRight') && !e.target.closest('.sess,button')) week(k === 'ArrowLeft' ? -1 : 1);
    });
    $('#profileSelect').onchange = (e) => {
      const v = e.target.value;
      if (v === '__new') { const name = prompt('Nickname for the new student (no real name needed):', 'Student'); if (name) { const pr = Demo.blank(name.slice(0, 30)); store.profiles.push(pr); store.activeId = pr.id; } }
      else if (v === '__demo1') { const pr = Demo.busyWeek(); store.profiles.push(pr); store.activeId = pr.id; }
      else if (v === '__demo2') { const pr = Demo.overloaded(); store.profiles.push(pr); store.activeId = pr.id; }
      else store.activeId = v;
      save(); prevPlan = null; pending = null; renderReview(); weekOffset = 0; replan(false); go('plan');
    };
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-sess],[data-item],[data-act],[data-energy],[data-today],[data-opt],[data-dismiss],[data-q]');
      if (!t) return;
      if (t.dataset.sess) { const [i, k] = t.dataset.sess.split(':').map(Number); if (plan.days[i] && plan.days[i].sessions[k]) openSession(i, k); }
      else if (t.dataset.item) openItem(t.dataset.item);
      else if (t.dataset.act) openAct(t.dataset.act);
      else if (t.dataset.energy) mutate((p) => { p.energy = { date: D.today(), level: t.dataset.energy }; });
      else if (t.dataset.today) mutate((p) => {
        const S = Scheduler.settingsOf(p), d = D.today(), cur = p.overrides[d] ?? S.daily[D.dow(d)];
        p.overrides[d] = t.dataset.today === 'skip' ? 0 : Math.max(0, cur + Number(t.dataset.today));
      });
      else if (t.dataset.opt) { const [n, k] = t.dataset.opt.split(':').map(Number); applyAction($('#alerts')._issues[n].options[k].action); }
      else if (t.dataset.dismiss) mutate((p) => { p.dismissed.push(t.dataset.dismiss); });
      else if (t.dataset.q) askCoach(t.dataset.q);
    });
    document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('li[data-item],li[data-act]')) { e.preventDefault(); e.target.click(); } });
    $('#coachForm').onsubmit = (e) => { e.preventDefault(); const q = $('#coachInput').value; $('#coachInput').value = ''; askCoach(q); };

    // voice input
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const mic = $('#btnMic'); mic.hidden = false; let rec = null;
      mic.onclick = () => {
        if (rec) { rec.stop(); return; }
        rec = new SR(); rec.lang = 'en-US'; rec.interimResults = false;
        rec.onresult = (ev) => { const ta = $('#tellInput'); ta.value = (ta.value ? ta.value + ' ' : '') + ev.results[0][0].transcript; };
        rec.onend = () => { rec = null; mic.classList.remove('rec'); };
        mic.classList.add('rec'); rec.start();
      };
    }
    // re-plan every 5 minutes so "today" stays accurate as time passes
    setInterval(() => { if (!dlg.open) replan(false); }, 5 * 60 * 1000);
  }

  async function checkAI() {
    try { const r = await fetch('/api/status'); if (r.ok) ai = { providers: (await r.json()).providers || [] }; } catch { ai = { providers: [] }; }
    // first visit: prefer the private local model, then a cloud one, else offline rules.
    // (If the chosen engine is down later, Tempo falls back to offline rules without changing the choice.)
    if (!store.prefs.engine) {
      const first = ['local', 'groq', 'gemini', 'claude'].map(engineInfo).find((p) => p && p.ready);
      store.prefs.engine = first ? first.id : 'offline'; save();
    }
    renderPill();
  }

  load(); applyPrefs(); wire(); replan(false); showView(); checkAI();
  window.addEventListener('focus', checkAI); // e.g. Ollama was started after the page opened
})();
