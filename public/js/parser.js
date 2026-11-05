/* Tempo — understanding what the student types.

   Two engines produce the SAME output shape:
     - An online LLM (server.js: Gemini/Groq/Claude/Ollama) when online: handles messy, unusual phrasing.
     - This offline rule engine: works with no internet, fully predictable.
   Either way, the result goes through sanitize() so the planner never receives
   impossible data, and the student reviews everything before it is added.

   Output shape:
   { items:[{kind,title,subject,due,estMin,difficulty,assumed:[]}],
     commitments:[{title,days,date,start,end,assumed:[]}],
     availability:{dailyMinutes,weekendMinutes},
     changes:[{itemId,due?,estMin?,remove?,done?}],
     questions:[string] } */
(function () {
  const T = typeof window !== 'undefined' ? (window.Tempo = window.Tempo || {}) : (globalThis.Tempo = globalThis.Tempo || {});
  if (typeof module !== 'undefined') module.exports = T;
  const D = T.D;

  const SUBJECTS = [
    ['Math', /\b(math|maths|algebra|calculus|calc|geometry|trig|trigonometry|statistics|stats)\b/],
    ['Physics', /\b(physics|phys)\b/], ['Chemistry', /\b(chemistry|chem)\b/], ['Biology', /\b(biology|bio)\b/],
    ['English', /\b(english|literature|lit|essay on [a-z]+ novel)\b/], ['History', /\b(history|hist)\b/],
    ['Geography', /\b(geography|geo)\b/], ['Arabic', /\barabic\b/], ['French', /\bfrench\b/], ['Spanish', /\bspanish\b/],
    ['Computer Science', /\b(computer science|comp ?sci|cs|coding|programming|ict)\b/], ['Economics', /\b(economics|econ)\b/],
    ['Business', /\bbusiness\b/], ['Psychology', /\b(psychology|psych)\b/], ['Art', /\b(art|design)\b/],
    ['Islamic Studies', /\b(islamic|islamiyat|quran)\b/], ['Social Studies', /\b(social studies|moral education)\b/],
    ['Science', /\bscience\b/],
  ];
  const EXAM = /\b(exam|test|quiz|midterm|mid-term|final|finals|assessment|mock|sat|act|ielts)\b/;
  const ASSIGN = /\b(assignment|homework|hw|essay|project|lab report|lab|report|worksheet|presentation|poster|coursework|problem set|pset|reading|research paper|paper|portfolio)\b/;
  const ACTIVITY = /\b(practice|training|club|robotics|soccer|football|basketball|volleyball|swim|swimming|tennis|cricket|debate|mun|band|choir|orchestra|rehearsal|drama|theatre|theater|job|shift|work|tutoring|tuition|lesson|lessons|gym|dance|karate|taekwondo|scouts|volunteering|volunteer|team)\b/;
  const ONE_OFF = /\b(appointment|dentist|doctor|party|wedding|trip|event|match|game|tournament|competition|family|dinner|birthday|interview)\b/;
  const CHANGE = /\b(moved|postponed|pushed|changed|rescheduled|delayed|brought forward|now (?:on|due)|cancel+ed|is cancel+ed|done|finished|submitted)\b/;

  const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

  function findSubject(t) { for (const [name, re] of SUBJECTS) if (re.test(t)) return name; return null; }

  // ---- dates -------------------------------------------------------------
  function findDate(t, today) {
    let m;
    if (/\btoday|tonight\b/.test(t)) return { date: today };
    if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) return { date: D.add(today, 1) };
    if (/\bday after tomorrow\b/.test(t)) return { date: D.add(today, 2) };
    if ((m = t.match(/\bin (\d+|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/))) {
      const n = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[m[1]] || Number(m[1]);
      return { date: D.add(today, m[2].startsWith('week') ? n * 7 : n) };
    }
    if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return { date: `${m[1]}-${m[2]}-${m[3]}` };
    const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
    if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MON})[a-z]*\\b`))) || (m = t.match(new RegExp(`\\b(${MON})[a-z]* (\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
      const day = Number(/\d/.test(m[1]) ? m[1] : m[2]); const mon = (/\d/.test(m[1]) ? m[2] : m[1]).slice(0, 3);
      const mi = D.MONTHS.map((x) => x.toLowerCase()).indexOf(mon);
      let y = Number(today.slice(0, 4));
      let cand = `${y}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (D.diff(today, cand) < -60) cand = `${y + 1}${cand.slice(4)}`; // "Jan 5" said in December
      return { date: cand };
    }
    const dayRe = /\b(next |this |on |by |due |coming )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?\b/;
    if ((m = t.match(dayRe))) {
      const idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[2].slice(0, 3));
      let d = D.nextDow(today, idx);
      if ((m[1] || '').trim() === 'next') {
        // "next Tuesday" = Tuesday of NEXT calendar week (weeks start Monday). Said on a
        // Wednesday that's 6 days away, not 13. People disagree on this, so we flag it.
        const weekStart = D.add(today, -((D.dow(today) + 6) % 7));
        d = D.add(weekStart, 7 + ((idx + 6) % 7));
        return { date: d, weekday: idx, ambiguous: true };
      }
      return { date: d, weekday: idx };
    }
    if (/\bend of (the )?week\b/.test(t)) return { date: D.nextDow(today, 5), assumed: true };
    if (/\bnext week\b/.test(t)) return { date: D.add(today, 7), assumed: true };
    return null;
  }

  function findWeekdays(t) {
    if (/\b(every ?day|daily)\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
    if (/\b(weekdays|school days)\b/.test(t)) return [1, 2, 3, 4, 5];
    if (/\bweekends?\b/.test(t)) return [0, 6];
    const out = [];
    const re = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|rsday|urday|sday)?s?\b/g;
    let m; while ((m = re.exec(t))) { const i = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].slice(0, 3)); if (!out.includes(i)) out.push(i); }
    return out;
  }

  // "4-6pm", "4pm to 6pm", "16:00-18:30", "from 5 till 7"
  function findTimes(t) {
    const re = /\b(?:from )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/;
    const m = t.match(re);
    if (m) {
      let h1 = Number(m[1]), h2 = Number(m[4]); const ap2 = m[6], ap1 = m[3] || ap2;
      const conv = (h, ap) => (ap === 'pm' && h < 12 ? h + 12 : ap === 'am' && h === 12 ? 0 : (!ap && h >= 1 && h <= 8 ? h + 12 : h));
      h1 = conv(h1, ap1); h2 = conv(h2, ap2 || ap1);
      if (h2 <= h1) h2 += 12;
      if (h1 < 24 && h2 <= 24) return { start: D.fromMin(h1 * 60 + Number(m[2] || 0)), end: D.fromMin(h2 * 60 + Number(m[5] || 0)) };
    }
    const one = t.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    if (one) {
      let h = Number(one[1]); if (one[3] === 'pm' && h < 12) h += 12; if (!one[3] && h >= 1 && h <= 8) h += 12;
      const dur = findMinutes(t) || 60;
      return { start: D.fromMin(h * 60 + Number(one[2] || 0)), end: D.fromMin(Math.min(23 * 60 + 55, h * 60 + Number(one[2] || 0) + dur)), assumedEnd: !findMinutes(t) };
    }
    return null;
  }

  function findMinutes(t) {
    let m;
    if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(?:\d+(?:\.\d+)?)?\s*(hours|hour|hrs|hr|h)\b/))) return Math.round(Number(m[1]) * 60);
    if ((m = t.match(/\b(an?|one|half an?) hour\b/))) return m[1].startsWith('half') ? 30 : 60;
    if ((m = t.match(/\b(\d+)\s*(minutes|minute|mins|min|m)\b/))) return Number(m[1]);
    return null;
  }

  function findDifficulty(t) {
    if (/\b(really hard|very hard|super hard|terrible at|failing|struggl\w*|hate)\b/.test(t)) return 5;
    if (/\b(hard|difficult|tough|big|huge|long|major)\b/.test(t)) return 4;
    if (/\b(easy|quick|short|small|simple)\b/.test(t)) return 2;
    return null;
  }

  // split "chem test friday and an english essay due monday" into separate clauses
  function clauses(text) {
    const KEY = new RegExp(`${EXAM.source}|${ASSIGN.source}|${ACTIVITY.source}|${ONE_OFF.source}|\\b(hours?|free|available)\\b`);
    const parts = text.toLowerCase().replace(/[’']/g, "'").split(/[\n;.!?]+|,(?!\d)|\balso\b|\bplus\b/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const p of parts) {
      const bits = p.split(/\band\b|&/);
      let cur = '';
      for (const b of bits) {
        if (cur && KEY.test(cur) && KEY.test(b) && !/^\s*(\d|[a-z]+day)/.test(b)) { out.push(cur.trim()); cur = b; }
        else cur = cur ? cur + ' and ' + b : b;
      }
      if (cur.trim()) out.push(cur.trim());
    }
    // Fragments with no task/activity of their own ("about 3 hours", "it's huge")
    // describe the previous clause → glue them back on. (Found in testing: the
    // essay lost its 3-hour estimate because it was split off.)
    const merged = [];
    for (const c of out) {
      const own = new RegExp(`${EXAM.source}|${ASSIGN.source}|${ACTIVITY.source}|${ONE_OFF.source}`).test(c);
      const avail = /\b(a day|per day|each day|every day|daily|a night|each night|weekends?)\b/.test(c);
      if (!own && !avail && merged.length) merged[merged.length - 1] += ', ' + c; else merged.push(c);
    }
    return merged;
  }

  function matchExisting(t, existing) {
    const subj = findSubject(t); const isExam = EXAM.test(t), isAssign = ASSIGN.test(t);
    const scored = existing.map((e) => {
      let s = 0;
      if (subj && e.subject && e.subject.toLowerCase() === subj.toLowerCase()) s += 2;
      if (isExam && e.kind === 'exam') s += 1; if (isAssign && e.kind === 'assignment') s += 1;
      e.title.toLowerCase().split(/\s+/).forEach((w) => { if (w.length > 3 && t.includes(w)) s += 1; });
      return { e, s };
    }).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s);
    return scored.length ? scored[0].e : null;
  }

  function parseRules(text, today, existing = []) {
    const res = { items: [], commitments: [], availability: {}, changes: [], questions: [], engine: 'offline rules' };
    for (const t of clauses(text)) {
      const date = findDate(t, today);
      // availability: "I only have 2 hours a day", "3 hours on weekends"
      if (/\b(free|available|have|got|only|study)\b/.test(t) && /\b(a day|per day|each day|every day|daily|a night|each night|weekends?|on weekdays)\b/.test(t) && findMinutes(t) && !EXAM.test(t) && !ASSIGN.test(t)) {
        const m = findMinutes(t);
        if (/\bweekends?\b/.test(t)) res.availability.weekendMinutes = m; else res.availability.dailyMinutes = m;
        continue;
      }
      // changes to things we already know about
      if (CHANGE.test(t) && existing.length) {
        const hit = matchExisting(t, existing);
        if (hit) {
          if (/\b(done|finished|submitted)\b/.test(t)) res.changes.push({ itemId: hit.id, done: true });
          else if (/cancel/.test(t)) res.changes.push({ itemId: hit.id, remove: true });
          else if (date) res.changes.push({ itemId: hit.id, due: date.date });
          else res.questions.push(`What's the new date for "${hit.title}"?`);
          continue;
        }
      }
      const subject = findSubject(t);
      if (EXAM.test(t) || ASSIGN.test(t)) {
        const kind = EXAM.test(t) && !/\b(essay|project|report|presentation)\b/.test(t) ? 'exam' : 'assignment';
        const word = (t.match(kind === 'exam' ? EXAM : ASSIGN) || [])[0] || kind;
        const topic = (t.match(/\b(?:on|about)\s+(?!mon|tue|wed|thu|fri|sat|sun|the \d)([a-z][a-z\s]{2,30}?)(?=\s+(?:due|on|by|this|next|tomorrow|for|and)\b|$)/) || [])[1];
        let title = `${subject || ''} ${word === 'hw' ? 'homework' : word}`.trim();
        if (topic && !findSubject(topic)) title += ` (${topic.trim()})`;
        const assumed = [];
        const item = { kind, title: titleCase(title), subject: subject || 'General', due: date ? date.date : null,
          estMin: kind === 'exam' ? null : findMinutes(t), difficulty: findDifficulty(t), assumed };
        if (kind === 'exam' && findMinutes(t)) item.estMin = findMinutes(t);
        if (!subject) { assumed.push('subject'); }
        if (!date) res.questions.push(`When is the ${item.title.toLowerCase()} ${kind === 'exam' ? '' : 'due'}?`.replace(/\s+\?/, '?'));
        else if (date.assumed) { assumed.push('due'); res.questions.push(`I guessed ${D.label(item.due)} for "${item.title}" — is that right?`); }
        else if (date.ambiguous) { assumed.push('due'); res.questions.push(`I read "next ${D.DAY_LONG[date.weekday]}" as ${D.label(item.due)} for "${item.title}" — right?`); }
        res.items.push(item);
        continue;
      }
      if (ACTIVITY.test(t) || ONE_OFF.test(t)) {
        const word = (t.match(ACTIVITY) || t.match(ONE_OFF))[0];
        const before = t.split(word)[0].trim().split(/\s+/).slice(-1)[0];
        const name = /^(have|got|my|i|a|an|the|and|with|has|is|at|go|to)$/.test(before) || !before ? word : `${before} ${word}`;
        const times = findTimes(t); const assumed = [];
        let days = findWeekdays(t), dt = null;
        const oneOff = ONE_OFF.test(t) && !/\b(every|each|weekly)\b/.test(t) && !/s\b/.test(((t.match(/\b(sun|mon|tue|wed|thu|fri|sat)\w*/) || [''])[0]));
        if (oneOff && date) { dt = date.date; days = []; }
        if (!days.length && !dt) { if (date) { dt = date.date; } else { res.questions.push(`Which days is ${name}?`); assumed.push('days'); } }
        const c = { title: titleCase(name), days, date: dt, start: times ? times.start : '16:00', end: times ? times.end : '18:00', assumed };
        if (!times) { assumed.push('time'); res.questions.push(`What time is ${name}? I assumed 4–6pm.`); }
        else if (times.assumedEnd) assumed.push('end time');
        res.commitments.push(c);
        continue;
      }
    }
    if (!res.items.length && !res.commitments.length && !res.changes.length && res.availability.dailyMinutes == null && res.availability.weekendMinutes == null) {
      res.questions.push('I couldn\'t find any tasks, exams or activities in that. Try something like: "Chem test Friday, English essay due Monday, robotics Tue/Thu 4–6pm".');
    }
    return res;
  }

  // Never trust raw output (from rules OR from the AI). Clamp everything.
  // `source` = what the student actually typed. When given, any phrase the AI says it "quoted"
  // must really be in there; small models sometimes invent or reuse phrases.
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9:]+/g, ' ').trim();
  function grounded(phrase, src) {
    const w = norm(phrase).split(' ').filter((x) => x.length > 2 || /\d/.test(x));
    if (!w.length) return true;
    const have = new Set(norm(src).split(' '));
    return w.filter((x) => have.has(x) || [...have].some((h) => h.length > 2 && (h.startsWith(x) || x.startsWith(h)))).length / w.length >= 0.8;
  }
  function sanitize(r, today, existing = [], source = null) {
    const out = { items: [], commitments: [], availability: {}, changes: [], questions: [], engine: r.engine || 'unknown' };
    const ids = new Set(existing.map((e) => e.id));
    const okTime = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s) && D.toMin(s) < 24 * 60;
    for (const it of r.items || []) {
      if (!it || !it.title) continue;
      const item = {
        kind: it.kind === 'exam' ? 'exam' : 'assignment',
        title: String(it.title).slice(0, 80), subject: String(it.subject || 'General').slice(0, 40),
        due: D.isDate(it.due) ? it.due : null,
        estMin: Number(it.estMin) > 0 ? Math.min(1200, Math.round(Number(it.estMin))) : null,
        difficulty: [1, 2, 3, 4, 5].includes(Number(it.difficulty)) ? Number(it.difficulty) : null,
        assumed: Array.isArray(it.assumed) ? it.assumed.slice(0, 5).map(String) : [],
      };
      // AI models (especially small local ones) slip on date arithmetic. If the model copied the
      // student's own date words, work the date out with our tested rules and trust that instead.
      if (typeof it.dueText === 'string' && it.dueText.trim()) {
        const f = findDate(it.dueText.toLowerCase().slice(0, 60), today);
        if (f && f.date && D.isDate(f.date)) {
          if (item.due && item.due !== f.date) item.fixed = `date corrected from ${it.due} to ${f.date} ("${String(it.dueText).slice(0, 40)}")`;
          item.due = f.date;
          if ((f.ambiguous || f.assumed) && !item.assumed.includes('due')) item.assumed.push('due');
        }
      }
      // same idea for estimates and difficulty: the student's own words win over the model's number
      const words = (k) => (typeof it[k] === 'string' && it[k].trim() ? it[k].toLowerCase().slice(0, 80) : null);
      if (words('estText')) { const m = findMinutes(words('estText')); if (m) item.estMin = Math.min(1200, m); }
      else if (it.estText === null && item.estMin) item.estMin = null; // a number with no words behind it was invented
      if (words('difficultyText')) { const d = findDifficulty(words('difficultyText')); if (d) item.difficulty = d; }
      else if (it.difficultyText === null) item.difficulty = null;
      if (item.due && D.diff(today, item.due) > 365) { item.due = null; item.assumed.push('due'); }
      if (source && words('estText')) {
        if (!grounded(it.estText, source)) item.estMin = null; // the student never said that
        else item._est = norm(it.estText);
      }
      item._dueText = norm(it.dueText);
      out.items.push(item);
    }
    for (const c of r.commitments || []) {
      if (!c || !c.title) continue;
      let days = (c.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      const cm = { title: String(c.title).slice(0, 60), days: [...new Set(days)], date: D.isDate(c.date) ? c.date : null,
        start: okTime(c.start) ? c.start.padStart(5, '0') : '16:00', end: okTime(c.end) ? c.end.padStart(5, '0') : '18:00',
        assumed: Array.isArray(c.assumed) ? c.assumed.map(String) : [] };
      // re-read the student's own words for days and times with the rule engine
      const when = typeof c.whenText === 'string' ? c.whenText.toLowerCase().slice(0, 80) : '';
      if (when) {
        const wd = findWeekdays(when), tm = findTimes(when);
        if (wd.length) { cm.days = wd; cm.date = null; cm.assumed = cm.assumed.filter((x) => !/day|date|when/i.test(x)); }
        else { const f = findDate(when, today); if (f && f.date) { cm.date = f.date; cm.days = []; } }
        if (tm) { cm.start = tm.start; cm.end = tm.end; cm.assumed = cm.assumed.filter((a) => !/start|end|time|when/i.test(a)); }
      }
      if (cm.days.length && cm.date) cm.date = null; // repeating activities don't have a single date
      const same = out.commitments.find((x) => x.title.toLowerCase() === cm.title.toLowerCase() && x.start === cm.start);
      if (same) { same.days = [...new Set([...same.days, ...cm.days])].sort(); continue; } // model split one activity in two
      if (D.toMin(cm.end) <= D.toMin(cm.start)) { cm.end = D.fromMin(Math.min(1435, D.toMin(cm.start) + 60)); cm.assumed.push('end time'); }
      if (!cm.days.length && !cm.date) cm.assumed.push('days');
      out.commitments.push(cm);
    }
    // a small model sometimes lists an activity ("Robotics practice") as a task too: drop those
    const acts = out.commitments.map((c) => c.title.toLowerCase().split(/\W+/)[0]).filter((w) => w.length > 2);
    const whens = out.commitments.map((c) => c.title.toLowerCase());
    const actWhen = (r.commitments || []).map((c) => c && norm(c.whenText)).filter(Boolean);
    out.items = out.items.filter((i) => !(acts.some((w) => i.title.toLowerCase().includes(w)) &&
      (!(i.due || i.estMin) || whens.includes(i.title.toLowerCase()) || (i._dueText && actWhen.includes(i._dueText)))));
    // one "about 2 hours" can't belong to two tasks: give it to the task mentioned closest before it
    if (source) {
      const src = norm(source), byPhrase = {};
      out.items.forEach((i) => { if (i._est) (byPhrase[i._est] = byPhrase[i._est] || []).push(i); });
      for (const [ph, claim] of Object.entries(byPhrase)) {
        const pos = src.indexOf(ph), count = pos < 0 ? claim.length : src.split(ph).length - 1;
        if (claim.length <= count || pos < 0) continue;
        const at = (i) => Math.max(...[i.subject, i.title.split(' ')[0]].map((w) => src.lastIndexOf(norm(w).split(' ')[0], pos)));
        const keep = claim.reduce((a, b) => (at(b) > at(a) ? b : a));
        claim.forEach((i) => { if (i !== keep) i.estMin = null; });
      }
    }
    out.items.forEach((i) => { delete i._est; delete i._dueText; });
    // "chem test got moved to Wednesday": a small model often lists this as a NEW exam.
    // If the student used a moving word and the item matches one they already have, make it a date change.
    if (source && /\b(mov(ed|ing|e)|postponed?|pushed|reschedul\w*|delayed|changed|now (on|due))\b/i.test(source)) {
      out.items = out.items.filter((it) => {
        const old = existing.find((e) => e.kind === it.kind && it.subject !== 'General' && String(e.subject || '').toLowerCase() === it.subject.toLowerCase());
        if (!old || !it.due || it.due === old.due || !ids.has(old.id)) return true;
        if (!(r.changes || []).some((c) => c && c.itemId === old.id)) (r.changes = r.changes || []).push({ itemId: old.id, due: it.due });
        return false;
      });
    }
    let a = r.availability || {};
    if (source && typeof a.text === 'string' && a.text.trim() && !grounded(a.text, source)) a = {}; // invented
    if (Number(a.dailyMinutes) >= 0 && a.dailyMinutes !== null && a.dailyMinutes !== undefined) out.availability.dailyMinutes = Math.min(720, Math.round(Number(a.dailyMinutes)));
    if (Number(a.weekendMinutes) >= 0 && a.weekendMinutes !== null && a.weekendMinutes !== undefined) out.availability.weekendMinutes = Math.min(720, Math.round(Number(a.weekendMinutes)));
    if (typeof a.text === 'string' && a.text.trim()) {
      const t = a.text.toLowerCase().slice(0, 120), m = findMinutes(t);
      if (m) {
        const wkend = /\bweekends?|saturday|sunday\b/.test(t), wkday = /\bweekdays?|school (days|nights)|a day|per day|each day|every day|daily\b/.test(t);
        if (wkend && !wkday) { out.availability.weekendMinutes = m; delete out.availability.dailyMinutes; }
        else { out.availability.dailyMinutes = m; if (!wkend) delete out.availability.weekendMinutes; }
      }
    }
    for (const ch of r.changes || []) {
      if (!ch || !ids.has(ch.itemId)) continue;
      const c = { itemId: ch.itemId };
      if (D.isDate(ch.due)) c.due = ch.due;
      if (Number(ch.estMin) > 0) c.estMin = Math.round(Number(ch.estMin));
      if (ch.remove) c.remove = true; if (ch.done) c.done = true;
      if (Object.keys(c).length > 1) out.changes.push(c);
    }
    out.questions = (r.questions || []).filter(Boolean).map(String).slice(0, 6);
    return out;
  }

  T.Parser = { parseRules, sanitize, clauses, findDate, findSubject };
})();
