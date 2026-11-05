/* Tempo home page: the hero preview is the real planner (scheduler.js + predictor.js)
   running on the demo student, so the slider shows genuine re-planning, not an animation. */
(function () {
  const { D, Scheduler, Demo } = window.Tempo;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PALETTE = ['#c2410c', '#0f766e', '#a16207', '#9d174d', '#1d4ed8', '#4d7c0f', '#6d28d9', '#b91c1c', '#0e7490'];
  const color = (subject) => { let h = 0; for (const ch of String(subject || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

  const today = D.today();
  const student = Demo.busyWeek(today);
  const slider = $('#pvSlider');
  const SHOW = 5;

  function render() {
    const mins = Number(slider.value);
    student.settings.daily = [mins, mins, mins, mins, mins, mins, mins];
    // plan as if it's 3pm, so today's afternoon is still open whatever time the visitor arrives
    const plan = Scheduler.plan(student, { today, nowMin: 15 * 60, noSuggest: true });
    $('#pvOut').textContent = D.dur(mins);
    $('#pvRange').textContent = `${D.label(today)} – ${D.label(D.add(today, SHOW - 1))}`;

    let html = '';
    for (let i = 0; i < SHOW; i++) {
      const date = D.add(today, i), day = plan.days[i];
      const dues = student.items.filter((it) => it.due === date);
      const rows = [
        ...day.commitments.map((c) => ({ t: c.a, h: `<div class="pv-c">${esc(c.title)}</div>` })),
        ...day.sessions.map((s) => ({ t: s.start, h: `<div class="pv-s" style="--c:${color(s.subject)}"><b>${esc(s.subject)}</b><span><i>${D.clock(s.start)}</i><i>${D.dur(s.min)}</i></span></div>` })),
      ].sort((a, b) => a.t - b.t).map((x) => x.h).join('');
      html += `<div class="pv-day ${i === 0 ? 'today' : ''}">
        <div class="pv-dh"><b>${D.toDate(date).getDate()}</b><span>${i === 0 ? 'Today' : D.DAY_NAMES[D.dow(date)]}</span></div>
        ${dues.map((it) => `<div class="pv-due">${it.kind === 'exam' ? 'Exam' : 'Due'}: ${esc(it.subject)}</div>`).join('')}
        ${rows}
      </div>`;
    }
    $('#pvWeek').innerHTML = html;

    const short = Object.entries(plan.items).filter(([, r]) => r.unscheduled > 0);
    const st = $('#pvStatus');
    if (!short.length) {
      st.className = 'pv-status ok';
      st.innerHTML = `<b>Everything fits.</b><span>${D.dur(plan.stats.totalNeed)} of work, with a safety buffer before each deadline.</span>`;
    } else {
      const missing = short.reduce((s, [, r]) => s + r.unscheduled, 0);
      const names = short.map(([id]) => student.items.find((x) => x.id === id).subject);
      st.className = 'pv-status bad';
      st.innerHTML = `<b>${short.length} won't fit.</b><span>${esc(names.join(', '))} ${short.length > 1 ? 'are' : 'is'} ${D.dur(missing)} short in total. In the app, Tempo offers options it has checked instead of cramming.</span>`;
    }
    return plan;
  }

  const first = render();
  slider.addEventListener('input', render);

  // a live number for the "predicting" card, straight from the predictor
  const math = student.items.find((x) => x.subject === 'Math');
  const r = math && first.items[math.id];
  if (r) {
    $('#pvLearn').innerHTML = `<b>Live, from the demo student:</b> ${esc(r.predicted.why)} Likely range ${D.dur(r.predicted.low)}–${D.dur(r.predicted.high)}, confidence <b>${esc(r.predicted.confidence)}</b>.`;
  }
})();
