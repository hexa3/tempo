/* Tempo — study coach.
   buildContext(): turns the plan into a compact text summary for the online AI (no names, no PII).
   offline(): a rule-based coach that answers the most common questions from the
   plan itself, so the app is still useful with no internet. */
(function () {
  const T = typeof window !== 'undefined' ? (window.Tempo = window.Tempo || {}) : (globalThis.Tempo = globalThis.Tempo || {});
  if (typeof module !== 'undefined') module.exports = T;
  const D = T.D;

  function sessionLine(s) { return `${D.clock(s.start)}–${D.clock(s.end)} ${s.title} (${s.label})`; }

  // compact = shorter summary for the small local model (fewer tokens → faster, less to confuse it)
  function buildContext(profile, plan, { compact = false } = {}) {
    const L = [];
    L.push(`Today: ${D.label(plan.today)}. Energy today: ${(profile.energy && profile.energy.date === plan.today) ? profile.energy.level : 'not set'}.`);
    L.push(`Study time per day (Sun..Sat, minutes): ${plan.settings.daily.join(', ')}. Session length ${plan.settings.sessionLen} min, break ${plan.settings.breakLen} min.`);
    L.push('TASKS:');
    for (const it of profile.items.filter((i) => !i.done)) {
      const r = plan.items[it.id];
      L.push(`- [${it.kind}] ${it.title} | subject ${it.subject} | due ${it.due ? D.label(it.due) : 'UNKNOWN'} | ` +
        (r ? `predicted ${D.dur(r.predicted.minutes)} (range ${D.dur(r.predicted.low)}–${D.dur(r.predicted.high)}, confidence ${r.predicted.confidence}), remaining ${D.dur(r.remaining)}, status ${r.status}${r.unscheduled ? `, ${D.dur(r.unscheduled)} does NOT fit` : ''}${compact ? '' : `. Estimate reasoning: ${r.predicted.why}`}` : 'not planned'));
    }
    L.push('ACTIVITIES: ' + (profile.commitments.map((c) => `${c.title} ${c.date ? D.label(c.date) : c.days.map((d) => D.DAY_NAMES[d]).join('/')} ${c.start}-${c.end}`).join('; ') || 'none'));
    L.push(`PLAN (next ${compact ? 4 : 7} days, first line is TODAY):`);
    plan.days.slice(0, compact ? 4 : 7).forEach((d) => L.push(`${D.label(d.date)} [${D.dur(d.used)} of ${D.dur(d.cap)}]: ${d.sessions.map(sessionLine).join('; ') || 'free'}`));
    L.push('WARNINGS: ' + (plan.issues.map((i) => i.message).join(' | ') || 'none'));
    return L.join('\n');
  }

  // Safety rules that run BEFORE any AI model, so they behave the same on every engine
  // (a small local model can't be trusted to refuse reliably). Returns an answer or null.
  const WORK = /\b(write|do|solve|answer|finish|complete|make)\b[^.?!]{0,40}\b(essay|homework|hw|assignment|worksheet|questions?|lab report|report|project|presentation|paper)\b/;
  function guard(q) {
    const t = String(q).toLowerCase();
    if (/\b(kill|hurt) myself|suicid|self.?harm|\bunsafe\b|end my life|want to die/.test(t))
      return 'I\'m really glad you said something. Please talk to a trusted adult or your school counselor right now, or call your local emergency number if you are in danger. Schoolwork can wait.';
    if ((WORK.test(t) && (/\b(you|for me)\b/.test(t) || /^\s*(please |pls |plz )?(write|do|solve|answer|complete|make)\b/.test(t))) || /\bgive me the answers?\b|\bthe answers? (to|for)\b/.test(t))
      return 'I can\'t do graded work for you — that wouldn\'t be fair to you or your classmates. I can break it into steps and plan when to do each one. Tap the task to see its sessions.';
    return null;
  }

  function offline(q, profile, plan) {
    const t = q.toLowerCase();
    const today = plan.days[0];
    const find = () => profile.items.find((i) => !i.done && (t.includes((i.subject || '').toLowerCase()) || i.title.toLowerCase().split(/\W+/).some((w) => w.length > 3 && t.includes(w))));

    const g = guard(q); if (g) return g;
    if (/\b(stress|stressed|overwhelm|anxious|anxiety|panic|burn(ed|t)? ?out|can'?t cope|too much)\b/.test(t))
      return `That sounds like a lot. Two things that help: tap "Low energy" so today gets lighter (I'll move work to later days and show you what changed), and do just the first session — starting is the hardest part. If it keeps feeling like this, talk to your school counselor or a trusted adult.`;
    if (/\b(tired|sick|can'?t study|no time today|skip today|busy today)\b/.test(t))
      return 'No problem — tap "Low energy" (half the load) or "Skip today" in the Today card. I\'ll re-plan and tell you exactly what moved. If something can\'t fit anymore, I\'ll show options instead of hiding it.';
    if (/\bwhy\b/.test(t)) {
      const it = find(); const s = plan.days.flatMap((d) => d.sessions).find((x) => !it || x.itemId === it.id);
      return s ? `${s.title} on ${D.label(s.date)}: ${s.why}` : 'Ask about a specific task, like "why is Chemistry on Tuesday?"';
    }
    if (/\b(how long|how much time|estimate)\b/.test(t)) {
      const it = find(); const r = it && plan.items[it.id];
      if (r) return `${it.title}: about ${D.dur(r.predicted.minutes)} (could be ${D.dur(r.predicted.low)}–${D.dur(r.predicted.high)}). ${r.predicted.why} It's a prediction, so log real times as you go and it'll improve.`;
      return `Total work left: ${D.dur(plan.stats.totalNeed)}. Ask about a specific subject for its estimate.`;
    }
    if (/\b(on track|finish|make it|enough time|will i|can i)\b/.test(t)) {
      const risky = Object.entries(plan.items).filter(([, r]) => r.status === 'at-risk');
      if (!risky.length) return `Yes, if you follow the plan, everything fits before its deadline (${D.dur(plan.stats.totalNeed)} of work). Estimates can be off, so check off sessions to keep it honest.`;
      return `Not everything fits yet: ${risky.map(([id, r]) => `${(profile.items.find((i) => i.id === id) || {}).title} is ${D.dur(r.unscheduled)} short`).join('; ')}. Look at the red card above. It has options (more time, an extension, a focused version). You choose.`;
    }
    if (/\b(now|first|next|today|start)\b/.test(t)) {
      const s = today && today.sessions[0];
      if (!s) return 'Nothing is planned for the rest of today. Enjoy the break, or use it to get ahead on the next session in your plan.';
      return `Start with ${s.title} — ${s.label} (${D.dur(s.min)}, ${D.clock(s.start)}). ${today.sessions.length > 1 ? `Then: ${today.sessions.slice(1).map((x) => x.title).join(', ')}.` : ''}`;
    }
    if (/\b(tip|how (do|should) i (study|revise)|study better|focus)\b/.test(t))
      return 'Three evidence-based habits: (1) test yourself instead of re-reading (active recall), (2) spread practice across days (spacing — that\'s why your exam prep is split up), (3) phone in another room during a session, then a real break.';
    return 'I\'m in offline mode, so I can only answer questions about your plan: "What should I do first?", "Will I finish on time?", "Why is Chemistry on Tuesday?", "How long will the essay take?"';
  }

  T.Coach = { buildContext, offline, guard };
})();
