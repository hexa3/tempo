/* Tempo — the planning engine.

   Input : a student profile (tasks, exams, activities, available time, history)
   Output: a day-by-day plan with clock times, a reason for every session,
           and honest warnings + options when everything can't fit.

   How it decides (in plain words):
   1. Predict real workload for each task (see predictor.js).
   2. Cut work into focus-sized chunks (default 45 min).
      - Exams: chunks are SPREAD over the days before the exam (spaced practice).
      - Assignments: aim to finish a day early (buffer) — but the true deadline is the limit.
   3. Fill each day's free time (school/activity-aware) with the most urgent chunk.
      "Most urgent" = earliest deadline (Earliest-Deadline-First, which is provably
      the best order for meeting deadlines). When nothing is critical we also
      switch subjects (interleaving) and avoid >2 sessions of one exam per day.
   4. Anything that cannot fit before its deadline is reported, with options
      the student can choose from (more time, ask for an extension, lighter version).
   The AI never silently drops work and never decides for the student. */
(function () {
  const T = typeof window !== 'undefined' ? (window.Tempo = window.Tempo || {}) : (globalThis.Tempo = globalThis.Tempo || {});
  if (typeof module !== 'undefined') module.exports = T;
  const D = T.D, P = T.Predictor;

  const DEFAULT_SETTINGS = {
    daily: [180, 120, 120, 120, 120, 120, 180], // minutes of study per weekday, Sun..Sat
    weekendDays: [0, 6],                          // UAE: Saturday + Sunday
    window: { school: ['16:00', '21:30'], weekend: ['10:00', '21:30'] }, // never past 21:30 → protects sleep
    sessionLen: 45, breakLen: 10, bufferDays: 1, examSpreadDays: 6,
  };
  const MIN_BLOCK = 15;
  const ceil5 = (x) => Math.ceil(x / 5) * 5;

  function settingsOf(p) {
    const s = Object.assign({}, DEFAULT_SETTINGS, p.settings || {});
    s.window = Object.assign({}, DEFAULT_SETTINGS.window, (p.settings || {}).window || {});
    return s;
  }

  function commitmentsOn(p, date) {
    const dow = D.dow(date);
    return (p.commitments || []).filter((c) => (c.date ? c.date === date : (c.days || []).includes(dow)) && c.start && c.end)
      .map((c) => ({ id: c.id, title: c.title, a: D.toMin(c.start), b: D.toMin(c.end) }))
      .sort((x, y) => x.a - y.a);
  }

  function freeIntervals(p, S, date, nowMin) {
    const w = S.weekendDays.includes(D.dow(date)) ? S.window.weekend : S.window.school;
    let a = D.toMin(w[0]); const b = D.toMin(w[1]);
    if (nowMin != null) a = Math.max(a, ceil5(nowMin));
    let free = a < b ? [[a, b]] : [];
    for (const c of commitmentsOn(p, date)) {
      const next = [];
      for (const [x, y] of free) {
        if (c.b <= x || c.a >= y) { next.push([x, y]); continue; }
        if (c.a > x) next.push([x, c.a]);
        if (c.b < y) next.push([c.b, y]);
      }
      free = next;
    }
    return free.filter(([x, y]) => y - x >= MIN_BLOCK);
  }

  function budgetFor(p, S, date) {
    let m = (p.overrides && p.overrides[date] != null) ? p.overrides[date] : S.daily[D.dow(date)];
    if (p.energy && p.energy.date === date) m = Math.round(m * ({ low: 0.5, ok: 1, high: 1.25 }[p.energy.level] || 1));
    if (p.skipped && p.skipped[date]) m -= p.skipped[date];
    return Math.max(0, m);
  }

  function plan(p, opts = {}) {
    const S = settingsOf(p);
    const today = opts.today || D.today();
    const history = p.history || [];
    const issues = [];

    // ---------- 1. validate + predict ----------
    const active = [];
    for (const it of p.items || []) {
      if (it.done) continue;
      if (!it.due || !D.isDate(it.due)) {
        issues.push({ severity: 'info', code: 'missing-date', itemId: it.id,
          message: `"${it.title}" has no ${it.kind === 'exam' ? 'exam date' : 'due date'} yet, so I haven't planned it. When is it?` });
        continue;
      }
      if (it.due < today) {
        issues.push({ severity: 'warn', code: 'past-date', itemId: it.id,
          message: `"${it.title}" was due ${D.label(it.due)} — that's in the past. Finished, or did the date change?`,
          options: [{ label: 'It\'s done', action: { type: 'markDone', itemId: it.id } },
                    { label: 'Change the date', action: { type: 'editItem', itemId: it.id } }] });
        continue;
      }
      const pred = P.predict(it, history);
      const remaining = Math.max(0, pred.minutes - (it.progressMin || 0));
      if (remaining <= 0) continue;
      active.push({ it, pred, remaining });
    }

    // ---------- 2. build the days ----------
    const lastDue = active.reduce((m, a) => (a.it.due > m ? a.it.due : m), today);
    const horizon = Math.min(42, Math.max(7, D.diff(today, lastDue) + 1));
    const days = [];
    for (let i = 0; i < horizon; i++) {
      const date = D.add(today, i);
      const free = freeIntervals(p, S, date, i === 0 ? opts.nowMin : null);
      const freeMin = free.reduce((s, [a, b]) => s + b - a, 0);
      const budget = budgetFor(p, S, date);
      // realistic capacity: limited by both the budget and the free window (breaks take window time)
      const cap = Math.min(budget, Math.floor(freeMin * S.sessionLen / (S.sessionLen + S.breakLen)));
      days.push({ date, budget, free, freeMin, cap, used: 0, sessions: [], commitments: commitmentsOn(p, date) });
      if (budget > 0 && cap < budget - 20 && (p.commitments || []).length && i < 7) {
        issues.push({ severity: 'info', code: 'window-limited', date,
          message: `On ${D.label(date)} your activities leave room for only ${D.dur(cap)} of the ${D.dur(budget)} you set aside.` });
      }
    }
    const dayIndex = Object.fromEntries(days.map((d, i) => [d.date, i]));

    // overlapping activities = conflicting requirements → ask, don't guess
    const seenConflict = new Set();
    for (const d of days.slice(0, 7)) {
      const cs = d.commitments;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        if (cs[j].a < cs[i].b) {
          const key = [cs[i].id, cs[j].id].sort().join('|');
          if (seenConflict.has(key)) continue; seenConflict.add(key);
          issues.push({ severity: 'warn', code: 'activity-overlap', date: d.date,
            message: `"${cs[i].title}" and "${cs[j].title}" overlap on ${D.label(d.date)} (${D.clock(cs[j].a)}–${D.clock(Math.min(cs[i].b, cs[j].b))}). You can't be in two places — which one are you going to?`,
            options: [{ label: `Keep both (I'll sort it out)`, action: { type: 'dismiss', key: 'overlap:' + key } },
                      { label: `Remove "${cs[j].title}"`, action: { type: 'removeCommitment', id: cs[j].id } }] });
        }
      }
    }

    // ---------- 3. chunk the work ----------
    const chunks = [];
    for (const a of active) {
      const { it } = a;
      const hard = it.due === today ? today : D.add(it.due, -1); // last day you can work on it
      const n = Math.max(1, Math.ceil(a.remaining / S.sessionLen));
      const size = ceil5(a.remaining / n);
      let left = a.remaining;
      const isExam = it.kind === 'exam';
      const soft = isExam ? hard : (D.diff(today, hard) > S.bufferDays ? D.add(hard, -S.bufferDays) : hard);
      const spread = isExam ? Math.min(Math.max(S.examSpreadDays, Math.ceil(n * 1.3)), 14) : 0;
      const start = isExam ? (D.diff(today, hard) + 1 > spread ? D.add(hard, -(spread - 1)) : today) : today;
      const span = D.diff(start, hard) + 1;
      for (let i = 0; i < n; i++) {
        const m = Math.min(size, left); left -= m;
        if (m <= 0) break;
        const label = isExam
          ? (i === 0 ? 'Overview + summary notes' : (i === n - 1 && n >= 3 ? 'Practice test + fix weak spots' : `Active recall ${i}/${n - 1}`))
          : (n === 1 ? 'Complete' : (i === n - 1 ? 'Finish + check' : `Part ${i + 1} of ${n}`));
        chunks.push({ it, pred: a.pred, idx: i, n, rem: m, total: m, hard, soft,
          release: isExam ? D.add(start, Math.floor((i * span) / n)) : today, label });
      }
    }

    // ---------- 4. fill the days ----------
    const futureCap = (fromIdx) => { let s = 0; for (let j = fromIdx; j < days.length; j++) s += days[j].cap; return s; };
    const capThrough = (di, left, hard) => {
      const hi = dayIndex[hard] ?? days.length - 1; let s = left;
      for (let j = di + 1; j <= hi; j++) s += days[j].cap; return s;
    };

    days.forEach((day, di) => {
      let left = day.cap, ii = 0, cursor = day.free.length ? day.free[0][0] : 0;
      let lastSubject = null; const perItem = {};
      for (let guard = 0; guard < 300 && left >= 5 && ii < day.free.length; guard++) {
        const [, iEnd] = day.free[ii];
        if (cursor < day.free[ii][0]) cursor = day.free[ii][0];
        const space = iEnd - cursor;
        if (space < MIN_BLOCK) { ii++; continue; }
        const cands = chunks.filter((c) => c.rem > 0 && c.release <= day.date && c.hard >= day.date);
        if (!cands.length) break;

        // critical = would miss its deadline if we don't do it now (EDF slack test)
        const critical = cands.filter((c) => {
          const due = chunks.reduce((s, o) => s + (o.rem > 0 && o.hard <= c.hard ? o.rem : 0), 0);
          return capThrough(di, left, c.hard) - due < S.sessionLen;
        }).sort((x, y) => (x.hard < y.hard ? -1 : x.hard > y.hard ? 1 : 0));

        let pick, reason;
        if (critical.length) { pick = critical[0]; reason = 'urgent'; }
        else {
          const score = (c) => {
            let s = D.diff(day.date, c.it.kind === 'exam' ? c.hard : c.soft);
            if (c.it.subject === lastSubject) s += 1.5;          // interleave subjects
            if ((perItem[c.it.id] || 0) >= 2) s += 10;           // spacing: max 2 sessions of one thing per day
            return s + c.idx * 0.01;
          };
          pick = cands.slice().sort((x, y) => score(x) - score(y))[0];
          reason = (lastSubject && pick.it.subject !== lastSubject && cands.some((c) => c.it.subject === lastSubject)) ? 'interleave' : 'normal';
        }

        let block = Math.min(S.sessionLen, left, pick.rem, space);
        // Avoid useless slivers (testing showed 10-minute "sessions"). If this chunk would be cut
        // short, prefer another chunk that fits whole; otherwise move to the next free gap.
        const minUseful = reason === 'urgent' ? MIN_BLOCK : 25;
        if (block < pick.rem && block < minUseful) {
          const fitter = reason === 'urgent' ? null : cands.find((c) => c !== pick && c.rem <= Math.min(left, space) && c.rem >= MIN_BLOCK);
          if (fitter) { pick = fitter; block = fitter.rem; reason = 'normal'; }
          else if (space < left) { ii++; continue; } else break;
        }
        block = Math.floor(block / 5) * 5 || block;
        day.sessions.push({
          date: day.date, start: cursor, end: cursor + block, min: block,
          itemId: pick.it.id, title: pick.it.title, subject: pick.it.subject || 'General', kind: pick.it.kind,
          label: pick.label, why: explain(pick, reason, S, day.date),
        });
        pick.rem -= block; left -= block; day.used += block;
        perItem[pick.it.id] = (perItem[pick.it.id] || 0) + 1;
        lastSubject = pick.it.subject;
        cursor += block + S.breakLen;
      }
    });

    // ---------- 5. results per item ----------
    const items = {};
    for (const a of active) {
      const mine = chunks.filter((c) => c.it.id === a.it.id);
      const unscheduled = mine.reduce((s, c) => s + c.rem, 0);
      const sessions = days.flatMap((d) => d.sessions.filter((s) => s.itemId === a.it.id));
      const finish = sessions.length ? sessions[sessions.length - 1].date : null;
      const status = unscheduled > 0 ? 'at-risk' : (a.it.kind !== 'exam' && finish && finish > mine[0].soft) ? 'tight' : 'ok';
      items[a.it.id] = { predicted: a.pred, remaining: a.remaining, scheduled: a.remaining - unscheduled, unscheduled,
        finish, status, hard: mine[0].hard, sessionsCount: sessions.length };
    }

    // ---------- 6. can't fit → explain + offer options (student chooses) ----------
    for (const a of active) {
      const r = items[a.it.id];
      if (r.unscheduled <= 0) continue;
      const options = opts.noSuggest ? [] : suggest(p, opts, today, a, r);
      issues.unshift({ severity: 'error', code: 'cant-fit', itemId: a.it.id,
        message: `"${a.it.title}" needs about ${D.dur(r.remaining)} but only ${D.dur(r.scheduled)} fits before ${D.label(a.it.due)} — ${D.dur(r.unscheduled)} short. Here are your options:`,
        options });
    }

    // ---------- 7. wellbeing checks ----------
    let run = [];
    const flush = () => {
      if (run.length >= 3) issues.push({ severity: 'warn', code: 'crunch',
        message: `Heavy stretch ${D.label(run[0].date)} – ${D.label(run[run.length - 1].date)}: every day is fully booked. Protect your sleep, and if you can, start something earlier.` });
      run = [];
    };
    for (const d of days.slice(0, 14)) { if (d.cap >= 90 && d.used >= d.cap * 0.9) run.push(d); else flush(); }
    flush();
    S.daily.forEach((m, dow) => {
      if (m > 300 && !S.weekendDays.includes(dow)) issues.push({ severity: 'warn', code: 'too-much', dismissKey: 'toomuch' + dow,
        message: `${D.DAY_NAMES[dow]}: ${D.dur(m)} of study after a full school day is a lot. Research on teens suggests sleep and breaks matter as much as hours.` });
    });

    const totalNeed = active.reduce((s, a) => s + a.remaining, 0);
    return { today, days, items, issues, settings: S,
      stats: { totalNeed, totalPlanned: days.reduce((s, d) => s + d.used, 0), capacity: futureCap(0) } };
  }

  function explain(c, reason, S, date) {
    const it = c.it, due = D.label(it.due);
    const parts = [];
    if (it.kind === 'exam') {
      parts.push(`${it.subject || ''} exam on ${due}. Session ${c.idx + 1} of ${c.n}: spread over several days because spaced practice beats one long cram.`.trim());
      if (c.label.startsWith('Practice')) parts.push('The last session is a practice test — testing yourself is one of the most effective ways to remember.');
    } else {
      parts.push(`Due ${due}.`);
      if (c.soft < c.hard) parts.push(`Planned to finish by ${D.label(c.soft)} so you have a ${S.bufferDays}-day safety buffer.`);
    }
    if (reason === 'urgent') parts.push('Scheduled now because it\'s urgent — there\'s no spare time left before the deadline.');
    if (reason === 'interleave') parts.push('Switched subject from your last session to keep your focus fresh.');
    parts.push(`Time estimate: ${c.pred.why}`);
    return parts.join(' ');
  }

  // Try concrete fixes by re-running the planner on a modified copy.
  function suggest(p, opts, today, a, r) {
    const out = [];
    const clone = () => JSON.parse(JSON.stringify(p));
    // an option "works" if THIS task now fits and no other task gets worse
    const base = plan(p, { ...opts, noSuggest: true });
    const othersShort = (res) => Object.entries(res.items).reduce((s, [id, x]) => s + (id === a.it.id ? 0 : x.unscheduled), 0);
    const baseOthers = othersShort(base);
    const fits = (q) => { const res = plan(q, { ...opts, noSuggest: true }); return res.items[a.it.id] && res.items[a.it.id].unscheduled === 0 && othersShort(res) <= baseOthers; };

    // (a) more time per day until the deadline
    const dates = []; for (let d = today; d <= r.hard; d = D.add(d, 1)) dates.push(d);
    for (const extra of [ceil5(r.unscheduled / dates.length), ceil5(r.unscheduled / dates.length) + 30]) {
      if (extra > 120) break;
      const q = clone(); q.overrides = q.overrides || {};
      const S = settingsOf(q);
      dates.forEach((d) => { q.overrides[d] = budgetFor(p, S, d) + extra; });
      if (fits(q)) {
        out.push({ label: `Study +${extra} min/day until ${D.label(r.hard)}`, action: { type: 'boost', dates, minutes: extra } });
        break;
      }
    }
    // (b) extension
    if (a.it.kind !== 'exam') {
      for (let k = 1; k <= 7; k++) {
        const q = clone(); const t = q.items.find((x) => x.id === a.it.id); t.due = D.add(a.it.due, k);
        if (fits(q)) { out.push({ label: `Ask your teacher for ${k} more day${k > 1 ? 's' : ''} (→ ${D.label(t.due)})`, action: { type: 'moveDue', itemId: a.it.id, due: t.due } }); break; }
      }
    }
    // (c) lighter version
    if (r.scheduled >= 30) {
      out.push({ label: `Do a focused version: ${D.dur(r.scheduled)} instead of ${D.dur(r.remaining)} (prioritise what's worth the most marks)`,
        action: { type: 'target', itemId: a.it.id, minutes: Math.floor(r.scheduled / 5) * 5 + (a.it.progressMin || 0) } });
    }
    if (!out.length || a.it.kind === 'exam') out.push({ label: 'Talk to your teacher or school counselor about the load', action: { type: 'dismiss', key: 'talk:' + a.it.id } });
    return out;
  }

  // What changed between two plans? (shown to the student after every edit)
  function diff(prev, next, profile) {
    if (!prev) return [];
    const title = (id) => ((profile.items || []).find((i) => i.id === id) || {}).title || 'Task';
    const summary = (pl) => {
      const m = {};
      pl.days.forEach((d) => d.sessions.forEach((s) => { (m[s.itemId] = m[s.itemId] || { first: s.date, min: 0, days: new Set() }); m[s.itemId].min += s.min; m[s.itemId].days.add(s.date); }));
      return m;
    };
    const a = summary(prev), b = summary(next), out = [];
    for (const id of Object.keys(b)) {
      if (!a[id]) { out.push(`Added "${title(id)}" — starts ${D.label(b[id].first)}`); continue; }
      if (b[id].first !== a[id].first) out.push(`"${title(id)}" now starts ${D.label(b[id].first)} (was ${D.label(a[id].first)})`);
      else if (Math.abs(b[id].min - a[id].min) >= 15) out.push(`"${title(id)}": ${D.dur(a[id].min)} → ${D.dur(b[id].min)} planned`);
      else if ([...b[id].days].join() !== [...a[id].days].join()) out.push(`"${title(id)}" sessions moved to different days`);
    }
    for (const id of Object.keys(a)) if (!b[id]) out.push(`"${title(id)}" no longer in the plan`);
    const newRisk = next.issues.filter((i) => i.code === 'cant-fit' && !prev.issues.some((j) => j.code === 'cant-fit' && j.itemId === i.itemId));
    newRisk.forEach((i) => out.unshift(`⚠ "${title(i.itemId)}" no longer fits — see options`));
    return out.slice(0, 6);
  }

  T.Scheduler = { plan, diff, DEFAULT_SETTINGS, settingsOf, freeIntervals };
})();
