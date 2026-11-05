/* Tempo — workload predictor.
   Predicts how long a task will REALLY take this particular student.

   Idea: students are bad at estimating (the "planning fallacy"). Every time a
   student finishes a session we log planned vs actual minutes. We learn a
   personal "time multiplier" per subject using Bayesian shrinkage:
     - with no data we trust the default (multiplier 1.0)
     - each logged session pulls the multiplier toward what really happened
     - subject-level multipliers fall back to the student's overall habit
   We work in log-space (geometric mean) so "2x longer" and "2x shorter"
   count equally. The spread of past errors gives an honest range. */
(function () {
  const T = typeof window !== 'undefined' ? (window.Tempo = window.Tempo || {}) : (globalThis.Tempo = globalThis.Tempo || {});
  if (typeof module !== 'undefined') module.exports = T;

  // Default effort (minutes) when the student gives no estimate. Exams = total revision.
  const DEFAULT_MIN = { assignment: 90, exam: 240 };
  // Typical effort by task type (minutes). A starting point only — personal history overrides it.
  const TYPE_MIN = [
    [/\b(worksheet|homework|hw|reading|problem set|pset)\b/i, 60], [/\bquiz\b/i, 90],
    [/\b(essay|lab report|report|presentation|poster)\b/i, 150], [/\b(project|research paper|coursework|portfolio)\b/i, 240],
    [/\b(midterm|final|finals|mock|exam)\b/i, 300], [/\btest\b/i, 180],
  ];
  const DIFFICULTY = { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.3, 5: 1.6 };
  const PRIOR_STRENGTH = 3; // "pseudo-observations": how many real sessions it takes to move the estimate halfway

  const round5 = (x) => Math.max(5, Math.round(x / 5) * 5);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // geometric-mean shrinkage toward a prior multiplier
  function shrink(ratios, prior) {
    const n = ratios.length;
    const sumLog = ratios.reduce((s, r) => s + Math.log(clamp(r, 0.2, 5)), 0);
    return Math.exp((sumLog + PRIOR_STRENGTH * Math.log(prior)) / (n + PRIOR_STRENGTH));
  }

  function multiplierFor(subject, kind, history) {
    const all = history.map((h) => h.actualMin / h.plannedMin).filter((r) => isFinite(r) && r > 0);
    const global = shrink(all, 1);
    const subjH = history.filter((h) => sameSubject(h.subject, subject));
    const subjRatios = subjH.map((h) => h.actualMin / h.plannedMin).filter((r) => isFinite(r) && r > 0);
    const m = shrink(subjRatios, global);
    let sd = 0.35; // default uncertainty (~ +-40%) when we know little
    if (subjRatios.length >= 3) {
      const logs = subjRatios.map((r) => Math.log(r));
      const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
      sd = clamp(Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1)), 0.1, 0.6);
    }
    return { m: clamp(m, 0.5, 2.5), global, nSubject: subjRatios.length, nAll: all.length, sd };
  }

  function sameSubject(a, b) { return (a || '').toLowerCase() === (b || '').toLowerCase(); }

  function predict(item, history = []) {
    if (item.targetMin) {
      // the student explicitly chose a lighter target (e.g. after an overload warning)
      return { minutes: item.targetMin, low: item.targetMin, high: item.targetMin, confidence: 'set', multiplier: 1,
        why: `You chose a target of ${T.D.dur(item.targetMin)}.` };
    }
    const kind = item.kind === 'exam' ? 'exam' : 'assignment';
    const diff = DIFFICULTY[item.difficulty || 3] || 1;
    const userGave = Number(item.estMin) > 0;
    const typical = (TYPE_MIN.find(([re]) => re.test(item.title || '')) || [null, DEFAULT_MIN[kind]])[1];
    const base = userGave ? Number(item.estMin) : typical * diff;
    const { m, nSubject, nAll, sd } = multiplierFor(item.subject, kind, history);
    const minutes = round5(base * m);
    const spread = userGave ? sd * 0.8 : sd;
    const low = round5(minutes * Math.exp(-spread)), high = round5(minutes * Math.exp(spread));

    const parts = [];
    parts.push(userGave ? `You estimated ${T.D.dur(base)}.` :
      `No estimate given, so I started from a typical ${(item.title || kind).toLowerCase().replace(/^\S+\s/, '')} (${T.D.dur(typical)})${diff !== 1 ? `, adjusted for difficulty ${item.difficulty}/5` : ''}.`);
    if (nSubject > 0) {
      const pct = Math.round((m - 1) * 100);
      parts.push(`From ${nSubject} past ${item.subject} session${nSubject > 1 ? 's' : ''}, you usually take ${pct === 0 ? 'about as long as planned' : `${Math.abs(pct)}% ${pct > 0 ? 'longer' : 'less time'} than planned`}, so I adjusted to ${T.D.dur(minutes)}.`);
    } else if (nAll > 0 && Math.abs(m - 1) > 0.04) {
      parts.push(`No ${item.subject} history yet, so I used your overall habit (${m > 1 ? '+' : ''}${Math.round((m - 1) * 100)}%).`);
    } else {
      parts.push('I have no history for you yet — this gets more accurate as you check off sessions.');
    }
    const confidence = nSubject >= 5 ? 'high' : (nSubject >= 2 || userGave) ? 'medium' : 'low';
    return { minutes, low, high, confidence, multiplier: m, why: parts.join(' ') };
  }

  T.Predictor = { predict, multiplierFor, DEFAULT_MIN, DIFFICULTY };
})();
