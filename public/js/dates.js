/* Tempo — date helpers. Dates are plain "YYYY-MM-DD" strings (local time) so they
   compare correctly as strings and never drift across time zones. */
(function () {
  const T = typeof window !== 'undefined' ? (window.Tempo = window.Tempo || {}) : (globalThis.Tempo = globalThis.Tempo || {});
  if (typeof module !== 'undefined') module.exports = T;

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_LONG = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const pad = (n) => String(n).padStart(2, '0');
  const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

  T.D = {
    DAY_NAMES, DAY_LONG, MONTHS,
    today: () => fmt(new Date()),
    fmt, toDate,
    // round-trip check: JS silently turns 2026-13-45 into Feb 2027 (caught by a test)
    isDate: (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(toDate(s)) === s,
    add: (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return fmt(d); },
    diff: (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000), // days from a to b
    dow: (s) => toDate(s).getDay(),
    label: (s) => { const d = toDate(s); return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; },
    short: (s) => DAY_NAMES[toDate(s).getDay()],
    toMin: (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); },
    fromMin: (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`,
    clock: (min) => { const h = Math.floor(min / 60), m = min % 60, h12 = ((h + 11) % 12) + 1; return `${h12}:${pad(m)}${h < 12 ? 'am' : 'pm'}`; },
    dur: (min) => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; },
    // next date (>= from) that falls on weekday `dow`
    nextDow: (from, dow, strictlyAfter = false) => {
      let d = from;
      for (let i = 0; i < 8; i++) { if (T.D.dow(d) === dow && !(strictlyAfter && i === 0)) return d; d = T.D.add(d, 1); }
      return d;
    },
  };
})();
