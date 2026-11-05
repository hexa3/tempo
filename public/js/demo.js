/* Tempo — demo profiles (synthetic data only, no real students).
   Dates are generated relative to TODAY so the demo always works on competition day. */
(function () {
  const T = typeof window !== 'undefined' ? (window.Tempo = window.Tempo || {}) : (globalThis.Tempo = globalThis.Tempo || {});
  if (typeof module !== 'undefined') module.exports = T;
  const D = T.D;
  let n = 0; const id = (p) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

  // synthetic history: this student underestimates Math (~1.4x) and is accurate in English
  function history(today) {
    const h = [];
    [[45, 65], [45, 60], [30, 45], [45, 62], [40, 52]].forEach(([p, a], i) => h.push({ subject: 'Math', kind: 'assignment', plannedMin: p, actualMin: a, date: D.add(today, -10 + i) }));
    [[45, 45], [45, 50], [30, 28]].forEach(([p, a], i) => h.push({ subject: 'English', kind: 'assignment', plannedMin: p, actualMin: a, date: D.add(today, -8 + i) }));
    [[45, 50], [45, 55]].forEach(([p, a], i) => h.push({ subject: 'Chemistry', kind: 'exam', plannedMin: p, actualMin: a, date: D.add(today, -6 + i) }));
    return h;
  }

  T.Demo = {
    // The judges' example: 3 assignments this week, 2 exams, 2 extracurriculars, 2 hours a day.
    busyWeek(today = D.today()) {
      return {
        id: id('p'), nickname: 'Demo: busy week', createdAt: today,
        settings: { daily: [120, 120, 120, 120, 120, 120, 120] },
        items: [
          { id: id('i'), kind: 'assignment', title: 'Math worksheet (quadratics)', subject: 'Math', due: D.add(today, 2), estMin: 45, difficulty: 3 },
          { id: id('i'), kind: 'assignment', title: 'English essay — Macbeth', subject: 'English', due: D.add(today, 4), estMin: 120, difficulty: 4 },
          { id: id('i'), kind: 'assignment', title: 'History presentation', subject: 'History', due: D.add(today, 5), estMin: 90, difficulty: 3 },
          { id: id('i'), kind: 'exam', title: 'Chemistry test (bonding)', subject: 'Chemistry', due: D.add(today, 3), estMin: 150, difficulty: 4 },
          { id: id('i'), kind: 'exam', title: 'Biology quiz', subject: 'Biology', due: D.add(today, 6), estMin: 60, difficulty: 2 },
        ],
        commitments: [
          { id: id('c'), title: 'Robotics club', days: [2, 4], start: '16:00', end: '17:30' },
          { id: id('c'), title: 'Football practice', days: [1, 3], start: '17:00', end: '18:30' },
        ],
        history: history(today), overrides: {}, skipped: {}, done: {}, dismissed: [],
      };
    },
    // Exam week that cannot all fit → shows honest trade-offs instead of a fake plan
    overloaded(today = D.today()) {
      return {
        id: id('p'), nickname: 'Demo: exam crunch', createdAt: today,
        settings: { daily: [90, 90, 90, 90, 90, 90, 90] },
        items: [
          { id: id('i'), kind: 'exam', title: 'Math midterm', subject: 'Math', due: D.add(today, 2), estMin: 240, difficulty: 5 },
          { id: id('i'), kind: 'exam', title: 'Physics test', subject: 'Physics', due: D.add(today, 3), estMin: 180, difficulty: 4 },
          { id: id('i'), kind: 'assignment', title: 'CS project', subject: 'Computer Science', due: D.add(today, 3), estMin: 180, difficulty: 3 },
        ],
        commitments: [{ id: id('c'), title: 'Swim training', days: [0, 1, 2, 3, 4, 5, 6], start: '17:00', end: '19:00' }],
        history: history(today), overrides: {}, skipped: {}, done: {}, dismissed: [],
      };
    },
    blank(nickname = 'Me', today = D.today()) {
      return { id: id('p'), nickname, createdAt: today, settings: {}, items: [], commitments: [], history: [], overrides: {}, skipped: {}, done: {}, dismissed: [] };
    },
    exampleText: 'I have a chemistry test on Thursday and a math quiz next Monday. English essay due Wednesday, about 3 hours. History project due Friday, it\'s huge. Robotics Tue and Thu 4-6pm, football on Mondays 5 to 7pm. I only have 2 hours a day to study.',
    id,
  };
})();
