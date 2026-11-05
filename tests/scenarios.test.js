/* Tempo automated tests: run with `npm test`.
   Each test is one of the judges' scenarios or a bug we found while building. */
const test = require('node:test');
const assert = require('node:assert/strict');
require('../public/js/dates.js'); require('../public/js/predictor.js'); require('../public/js/scheduler.js');
require('../public/js/parser.js'); require('../public/js/demo.js');
const T = require('../public/js/coach.js');
const { D, Scheduler, Parser, Demo, Predictor, Coach } = T;

const TODAY = '2026-11-09'; // a Monday
const plan = (p, extra = {}) => Scheduler.plan(p, { today: TODAY, ...extra });
const clone = (x) => JSON.parse(JSON.stringify(x));
const sessions = (pl) => pl.days.flatMap((d) => d.sessions);

// Invariants that must hold for EVERY plan
function checkInvariants(p, pl) {
  const S = Scheduler.settingsOf(p);
  for (const d of pl.days) {
    assert.ok(d.used <= d.budget + 0.001, `${d.date}: used ${d.used} > budget ${d.budget}`);
    const ss = d.sessions.slice().sort((a, b) => a.start - b.start);
    for (let i = 1; i < ss.length; i++) assert.ok(ss[i].start >= ss[i - 1].end, `${d.date}: sessions overlap`);
    for (const s of ss) {
      for (const c of d.commitments) assert.ok(s.end <= c.a || s.start >= c.b, `${d.date}: "${s.title}" overlaps activity "${c.title}"`);
      const w = S.weekendDays.includes(D.dow(d.date)) ? S.window.weekend : S.window.school;
      assert.ok(s.start >= D.toMin(w[0]) && s.end <= D.toMin(w[1]), `${d.date}: session outside study window (sleep protection)`);
      const it = p.items.find((x) => x.id === s.itemId);
      assert.ok(s.date < it.due || (it.due === pl.today && s.date === pl.today), `"${it.title}" scheduled on/after its deadline`);
    }
  }
}

function judgeScenario() {
  // "3 assignments due this week, two exams, two extracurriculars, only two hours a day"
  const p = Demo.busyWeek(TODAY);
  return p;
}

test('Judge scenario: main journey produces a valid, complete plan', () => {
  const p = judgeScenario(); const pl = plan(p);
  checkInvariants(p, pl);
  for (const it of p.items) assert.ok(pl.items[it.id], `${it.title} planned`);
  assert.ok(sessions(pl).length > 5);
  assert.ok(sessions(pl).every((s) => s.why && s.why.length > 20), 'every session explains itself');
});

test('Exam prep is spaced over several days, not crammed', () => {
  const p = judgeScenario(); const pl = plan(p);
  const chem = p.items.find((i) => i.subject === 'Chemistry');
  const days = new Set(sessions(pl).filter((s) => s.itemId === chem.id).map((s) => s.date));
  assert.ok(days.size >= 2, `chem prep on ${days.size} day(s)`);
});

test('Stage 4.1: changing available time re-plans and respects the new limit', () => {
  const p = judgeScenario(); const before = plan(p);
  const q = clone(p); q.settings.daily = [60, 60, 60, 60, 60, 60, 60];
  const after = plan(q);
  checkInvariants(q, after);
  assert.ok(after.days.every((d) => d.used <= 60));
  assert.ok(Scheduler.diff(before, after, q).length > 0, 'student is told what changed');
});

test('Stage 4.2: an urgent assignment (due tomorrow) is scheduled today', () => {
  const p = judgeScenario();
  p.items.push({ id: 'urgent', kind: 'assignment', title: 'Physics lab report', subject: 'Physics', due: D.add(TODAY, 1), estMin: 60 });
  const pl = plan(p);
  checkInvariants(p, pl);
  const urgent = sessions(pl).filter((s) => s.itemId === 'urgent');
  assert.ok(urgent.length && urgent.every((s) => s.date === TODAY));
  assert.equal(pl.items.urgent.unscheduled, 0);
});

test('Stage 4.3: moving an exam date reflows its sessions', () => {
  const p = judgeScenario(); const chem = p.items.find((i) => i.subject === 'Chemistry');
  const q = clone(p); q.items.find((i) => i.id === chem.id).due = D.add(TODAY, 8);
  const pl = plan(q);
  checkInvariants(q, pl);
  const last = sessions(pl).filter((s) => s.itemId === chem.id).map((s) => s.date).sort().pop();
  assert.ok(last > D.add(TODAY, 3), 'prep now continues past the old date');
});

test('Stage 4.4: incomplete info → asks instead of guessing', () => {
  const r = Parser.sanitize(Parser.parseRules('I have a big history essay and a math test', TODAY), TODAY);
  assert.equal(r.items.length, 2);
  assert.ok(r.items.every((i) => i.due === null), 'no invented dates');
  assert.ok(r.questions.length >= 2);
  const p = Demo.blank('t', TODAY); p.items = r.items.map((x, i) => ({ ...x, id: 'x' + i }));
  const pl = plan(p);
  assert.equal(pl.issues.filter((i) => i.code === 'missing-date').length, 2);
});

test('Stage 4.5: conflicting requirements → honest "doesn\'t fit" with real options', () => {
  const p = Demo.overloaded(TODAY); const pl = plan(p);
  checkInvariants(p, pl);
  const errs = pl.issues.filter((i) => i.code === 'cant-fit');
  assert.ok(errs.length >= 1);
  assert.ok(errs.every((e) => e.options.length >= 1));
  // every "more time" or "extension" option must actually solve the problem it claims to
  for (const e of errs) for (const o of e.options) {
    if (o.action.type === 'moveDue') { const q = clone(p); q.items.find((i) => i.id === o.action.itemId).due = o.action.due; assert.equal(plan(q).items[e.itemId].unscheduled, 0); }
    if (o.action.type === 'boost') { const q = clone(p); o.action.dates.forEach((d) => (q.overrides[d] = Scheduler.settingsOf(q).daily[D.dow(d)] + o.action.minutes)); assert.equal(plan(q).items[e.itemId].unscheduled, 0); }
  }
});

test('Stage 4.5b: overlapping activities are flagged, not silently resolved', () => {
  const p = judgeScenario();
  p.commitments.push({ id: 'dup', title: 'Debate club', days: [2], start: '17:00', end: '18:00' });
  const pl = plan(p);
  assert.ok(pl.issues.some((i) => i.code === 'activity-overlap'));
});

test('Stage 4.6: unexpected question → offline coach stays grounded and safe', () => {
  const p = judgeScenario(); const pl = plan(p);
  assert.match(Coach.offline('can you write my essay for me', p, pl), /can't do graded work/);
  assert.match(Coach.offline('I feel really stressed', p, pl), /counselor/);
  assert.ok(Coach.offline('what is the meaning of life', p, pl).length > 10);
  assert.match(Coach.buildContext(p, pl), /PLAN \(next 7 days/);
});

test('Stage 4.7: brand-new student profile works (empty + new history)', () => {
  const p = Demo.blank('new', TODAY); const pl = plan(p);
  assert.equal(sessions(pl).length, 0);
  assert.equal(pl.issues.filter((i) => i.severity === 'error').length, 0);
});

test('Predictor learns: a student who is slow at Math gets bigger Math estimates', () => {
  const item = { kind: 'assignment', title: 'Math homework', subject: 'Math', estMin: 60 };
  const fresh = Predictor.predict(item, []);
  const slow = Predictor.predict(item, Array.from({ length: 6 }, () => ({ subject: 'Math', plannedMin: 45, actualMin: 70 })));
  assert.equal(fresh.minutes, 60);
  assert.ok(slow.minutes > 75, `learned ${slow.minutes}`);
  assert.ok(slow.minutes < 60 * 70 / 45 + 1, 'shrinkage keeps it from over-reacting');
  assert.equal(slow.confidence, 'high');
});

test('Energy check-in: "low" halves today and moves work to later days', () => {
  const p = judgeScenario(); const before = plan(p);
  const q = clone(p); q.energy = { date: TODAY, level: 'low' };
  const after = plan(q);
  assert.ok(after.days[0].used <= before.days[0].budget / 2);
});

test('Bug fix: no useless 10-minute slivers when not urgent', () => {
  const p = judgeScenario(); const pl = plan(p);
  const tiny = sessions(pl).filter((s) => s.min < 20 && !/urgent/.test(s.why));
  assert.equal(tiny.length, 0, tiny.map((s) => `${s.date} ${s.title} ${s.min}`).join(', '));
});

test('Parser: messy sentence → tasks, activities, availability', () => {
  const r = Parser.sanitize(Parser.parseRules(Demo.exampleText, TODAY), TODAY);
  const titles = r.items.map((i) => i.title).join(' | ');
  assert.equal(r.items.length, 4, titles);
  assert.equal(r.items.find((i) => i.subject === 'Chemistry').kind, 'exam');
  assert.equal(r.items.find((i) => i.subject === 'Chemistry').due, '2026-11-12'); // Thursday
  assert.equal(r.items.find((i) => i.subject === 'Math').due, '2026-11-16');      // NEXT Monday
  assert.equal(r.items.find((i) => i.subject === 'English').estMin, 180);         // "about 3 hours" (bug fix)
  assert.equal(r.items.find((i) => i.subject === 'History').difficulty, 4);       // "it's huge"
  const robo = r.commitments.find((c) => /Robotics/.test(c.title));
  assert.deepEqual(robo.days, [2, 4]); assert.equal(robo.start, '16:00'); assert.equal(robo.end, '18:00');
  assert.equal(r.availability.dailyMinutes, 120);
});

test('Parser: updates to existing tasks become changes, not duplicates', () => {
  const existing = [{ id: 'chem1', title: 'Chemistry test', subject: 'Chemistry', kind: 'exam', due: '2026-11-12' }];
  const r = Parser.sanitize(Parser.parseRules('my chem test got moved to next tuesday', TODAY, existing), TODAY, existing);
  assert.equal(r.items.length, 0);
  assert.deepEqual(r.changes, [{ itemId: 'chem1', due: '2026-11-17' }]);
});

test('Sanitizer rejects impossible AI output', () => {
  const bad = { items: [{ kind: 'exam', title: 'X', subject: 'Math', due: '2026-13-45', estMin: -5, difficulty: 9 }],
    commitments: [{ title: 'Y', days: [9, 2], start: '25:00', end: '10:00' }], changes: [{ itemId: 'nope', due: '2026-11-11' }] };
  const r = Parser.sanitize(bad, TODAY, []);
  assert.equal(r.items[0].due, null); assert.equal(r.items[0].estMin, null); assert.equal(r.items[0].difficulty, null);
  assert.deepEqual(r.commitments[0].days, [2]); assert.equal(r.changes.length, 0);
});

test('Bug fix: small local model got "next Wednesday" wrong → date re-checked from the student\'s words', () => {
  // Real output from qwen2.5:3b on Thu 5 Nov: "Chem test next Wednesday" → 2026-11-13 (a Friday).
  const ai = { items: [
    { kind: 'exam', title: 'Chemistry test', subject: 'Chemistry', dueText: 'next Wednesday', due: '2026-11-13', estMin: null, difficulty: 4, assumed: [] },
    { kind: 'assignment', title: 'Essay', subject: 'English', dueText: 'some time soon', due: '2026-11-20', estMin: null, difficulty: null, assumed: [] },
  ] };
  const r = Parser.sanitize(ai, '2026-11-05', []);
  assert.equal(r.items[0].due, '2026-11-11');            // Wednesday of next week
  assert.ok(r.items[0].fixed);                            // the student is told it was corrected
  assert.ok(r.items[0].assumed.includes('due'));          // "next X" is still confirmed with the student
  assert.equal(r.items[1].due, '2026-11-20');             // words we can't read → keep the model's date
  assert.equal(r.items[1].fixed, undefined);
});

test('Safety rules run before ANY AI engine (same on local, Groq, offline) and don\'t block planning questions', () => {
  // Found while testing: the local 3B model offered to "help finish" an essay instead of refusing,
  // and the old rule missed "write my ENGLISH essay" while wrongly blocking "when should I do my homework?".
  for (const q of ['can you write my english essay for me?', 'do my math homework', 'give me the answers to the worksheet', 'solve these questions for me'])
    assert.match(Coach.guard(q), /can't do graded work/, q);
  assert.match(Coach.guard('I want to hurt myself'), /trusted adult/);
  for (const q of ['when should I do my homework?', 'help me plan my essay', 'how long will the essay take?', 'I finished my lab report early'])
    assert.equal(Coach.guard(q), null, q);
});

test('Sanitizer checks AI "quotes" against what the student really typed', () => {
  // Real output from qwen2.5:3b on Thu 5 Nov. It gave the chem test the essay's "about 2 hours",
  // listed robotics as both an activity and a task, and invented "I only have 2 hours on weekdays".
  const src = 'chem test next friday, english essay due monday about 2 hours, robotics tue and thu 4-5:30';
  const ai = {
    items: [
      { kind: 'exam', title: 'Chemistry test', subject: 'Chemistry', dueText: 'next Friday', due: '2026-11-18', estText: 'about 2 hours', estMin: 120, assumed: ['due'] },
      { kind: 'assignment', title: 'English essay', subject: 'English', dueText: 'Monday', due: '2026-11-10', estText: 'about 2 hours', estMin: 120, assumed: ['due'] },
      { kind: 'assignment', title: 'Robotics practice', subject: 'Robotics', dueText: 'Tues and Thurs 4-5:30', due: null, estText: null, estMin: null, assumed: [] },
    ],
    commitments: [{ title: 'Robotics practice', whenText: 'Tues and Thurs 4-5:30', days: [2, 4], date: null, start: '16:00', end: '17:30', assumed: [] }],
    availability: { text: 'I only have 2 hours on weekdays', dailyMinutes: 120, weekendMinutes: null },
  };
  const r = Parser.sanitize(ai, '2026-11-05', [], src);
  assert.deepEqual(r.items.map((i) => [i.title, i.due, i.estMin]), [['Chemistry test', '2026-11-13', null], ['English essay', '2026-11-09', 120]]);
  assert.equal(r.commitments.length, 1);
  assert.deepEqual(r.availability, {});                    // never said → not applied
  const said = Parser.sanitize(ai, '2026-11-05', [], src + '. I only have 2 hours on weekdays');
  assert.equal(said.availability.dailyMinutes, 120);       // really said → applied
});

test('"Chem test moved to next Wednesday" becomes a date change even when the AI lists it as a new exam', () => {
  // Found in the end-to-end test of the redesigned UI with qwen2.5:3b (Thu 5 Nov).
  const existing = [{ id: 'chem1', title: 'Chemistry test (bonding)', subject: 'Chemistry', kind: 'exam', due: '2026-11-08' }];
  const src = 'physics lab report due tomorrow about 1 hour, chem test moved to next wednesday';
  const ai = { items: [
    { kind: 'assignment', title: 'physics lab report', subject: 'Physics', dueText: 'tomorrow', due: '2026-11-06', estText: 'about 1 hour', estMin: 60, assumed: [] },
    { kind: 'exam', title: 'Chemistry test', subject: 'Chemistry', dueText: 'next wednesday', due: '2026-11-11', estText: null, estMin: null, assumed: [] },
  ], commitments: [], changes: [], questions: [] };
  const r = Parser.sanitize(ai, '2026-11-05', existing, src);
  assert.deepEqual(r.items.map((i) => i.title), ['physics lab report']);
  assert.deepEqual(r.changes, [{ itemId: 'chem1', due: '2026-11-11' }]);
  // without a "moved" word, a second chemistry exam is kept as new (the review screen asks about duplicates)
  const r2 = Parser.sanitize(ai, '2026-11-05', existing, 'physics lab report due tomorrow, chem test next wednesday');
  assert.equal(r2.items.length, 2);
});
