# Tempo: a week you can actually finish

**An AI study planner for high-school students.** Type your week the way you'd text a friend. Tempo learns how long work really takes *you*, builds a realistic plan around your activities and sleep, and tells you on day one when a week doesn't fit.

Built for the **AI for Student Life** competition (RIT Dubai).

- **Live:** https://tempo-study-planner.netlify.app (home page) · https://tempo-study-planner.netlify.app/app (the planner)
- **Run it on your laptop:** see [Run it](#run-it) below. That's the only way to use the private Local AI.

---

## The problem

| What goes wrong | Why | What Tempo does |
|---|---|---|
| **We underestimate.** | People reliably predict tasks will take less time than they do: the *planning fallacy* (Buehler, Griffin & Ross, 1994). | Learns each student's personal time multiplier per subject from the sessions they log. |
| **We cram.** | Spreading study over several days beats one long session (Cepeda et al., 2006), but the night before is what usually happens. | Splits exam prep across days: overview, then active recall, then a practice test. |
| **We find out too late.** | An impossible week looks fine on Monday. Nothing tells you until Wednesday night. | Spots it on day one and offers options it has already checked: more time, an extension, or a focused version. |

**Target user:** a Grade 10–12 student with 4–6 subjects, after-school activities and about 1–3 hours a day to study, who won't fill in a 20-field planner.

---

## How the AI works: three jobs, the right tool for each

```
 student text ──► [Understand]  Local AI (Ollama) / Groq (cloud) / offline rules
                       │        → Tempo's checks → the student reviews & edits ◄── human in the loop
                       ▼
 logged times ──► [Predict]     per-subject time multiplier, Bayesian shrinkage, range + confidence
                       ▼
 time, activities ► [Plan]      split work into sessions → earliest deadline first with an urgency test,
                       │        spaced exam prep, buffers, subject switching, sleep window
                       ▼
                   plan + a "why" for each session + warnings + checked options
                       ▼
 questions ─────► [Coach]       language model working from a plan summary / offline rule coach
```

### 1. Understanding what you type (language model)
The student picks the engine from a dropdown in the planner:

| Engine | Model | Runs on | Your text goes to | Speed (measured) |
|---|---|---|---|---|
| **Local AI** | Qwen 2.5 3B through Ollama | your laptop's CPU | nowhere | 30–90 s to read a week · ~20 s per coach answer |
| **Groq** | OpenAI's gpt-oss-120b (free tier) | Groq's cloud | Groq (Tempo stores nothing) | ~2–4 s to read a week · ~1 s per coach answer |
| **Offline rules** | Tempo's own parser and coach | your browser | nowhere | instant |

**The AI never has the last word.** Small models are bad at date maths and sometimes make things up, so Tempo checks every reply:
- The model must **quote the student's words** ("next friday", "about 2 hours"), and Tempo's tested rules work out the actual dates and minutes.
- Every quote must **really appear in what the student typed**. Invented phrases are dropped, and one "about 2 hours" can't be given to two tasks.
- **Impossible values are rejected**, e.g. the date 2026-13-45.
- An activity can't also become a homework task.
- **"Chem test moved to Wednesday"** changes the existing test instead of adding a second one.
- **Safety net:** Tempo's rule parser reads the same text, and any task or update the AI dropped is added back with a note.
- **The student reviews everything** before it's added. Guesses are highlighted yellow, and missing details turn into questions instead of made-up values.
- If an engine fails (no Wi-Fi, rate limit), Tempo **falls back to the offline rules** and says so.

### 2. Predicting how long work takes *you* (statistical model)
Each logged session gives a ratio *r* = actual ÷ planned minutes. Tempo learns a time multiplier for each subject:

  *m* = exp( (Σ ln *rᵢ* + *k* · ln *m₀*) / (*n* + *k*) ), with *k* = 3

Here *m₀* is the student's overall habit across all subjects (or 1 with no data), so a subject with little history starts close to how the student usually works. Working in log space means "2× longer" and "2× shorter" count equally. Without any history, estimates start from typical times for the kind of task (worksheet ~1h, essay ~2.5h, project ~4h, test ~3h, final exam ~5h), adjusted for difficulty. **Every estimate shows a range and a confidence level** (low / medium / high), plus a plain explanation, e.g. *"You estimated 45m. From 5 past Math sessions you usually take 30% longer, so I adjusted to 1h."*

### 3. Planning (an algorithm, not a chatbot)
- Splits work into focus sessions (45 min by default) with breaks between them.
- Puts the most urgent work first, using earliest deadline first with an urgency check.
- Spreads exam prep over several days, and finishes assignments a day early as a safety buffer.
- Switches subjects between sessions, and limits sessions of one task per day.
- Works around activities, and never schedules outside the student's study hours, so sleep is protected.
- Avoids useless 10-minute slivers unless the work is urgent.
- **Every session explains why it's there.**
- When a week can't fit, Tempo **re-runs the plan for each option** (more time, an extension, a lighter version) and only offers the ones that really work. The student chooses.

**Why not let a chatbot write the schedule?** A plan must never double-book you, run past your bedtime, or quietly drop work. A language model can't promise that. An algorithm can, gives the same answer every time, and our tests check it on every plan. So the AI reads and explains, and the algorithm schedules. *(Experiment E1 in `docs/AI_DEVELOPMENT_LOG.md` sets up this comparison for the team to run.)*

### 4. Coach
Answers questions about the student's own plan: "What should I do first?", "Will I finish everything?", "Why is Chem on Tuesday?" It uses whichever engine is selected, or the built-in offline coach. **Safety rules run before any AI:**
- It refuses to do graded work and offers to plan it instead.
- Stress gets a kind reply that points to a counsellor or trusted adult.
- Self-harm language gets an urgent-help reply instead of coaching.

---

## Features

**Planner: four views,** each with its own address (`/app#plan`, `#add`, `#tasks`, `#coach`), so Back/Forward and links work.

- **Plan:**
  - **Today card:** next session, how full the day is, work left, and sessions done.
  - **Energy check-in:** Low halves today's load.
  - **Quick changes:** −30 min, +30 min, Skip today.
  - **Week calendar:** sessions coloured by subject, activities, deadlines, and a bar showing how full each day is.
  - **"Doesn't fit" cards** with the checked options.
- **Add to plan:** type or speak your week (voice input), then review the result. There are also forms for adding one task or activity at a time, and tips.
- **Tasks & activities:** grouped into "Needs your attention", "Due in the next 7 days" and "Later", with status tags. Activities can be edited.
- **Coach:** chat with suggested questions.
- **Session details:** why it's there, the estimate range, logging how long it really took (which teaches the predictor), "Can't do it today", and Mark done.
- **Instant re-planning** after every change, with a *"what changed"* message.
- **Navigation:**
  - a labelled sidebar (laptop) or bottom tab bar (phone)
  - badges for tasks that won't fit or need a date, and for an unfinished review
  - links between views
  - keyboard shortcuts: `1`–`4` switch views, `/` jumps to Add, `←` `→` change the week, `?` lists shortcuts, `Ctrl+Enter` reads your text, `Esc` closes windows
- **Profiles and settings:**
  - nickname-only profiles
  - demo profiles: *busy week* (the judges' scenario: 3 assignments, 2 exams, 2 activities, 2h/day) and *exam crunch* (a week that doesn't fit)
  - daily study minutes, session and break length, buffer days, how long to spread exam prep, study hours, which days count as the weekend (UAE Sat/Sun by default)
  - download or delete your data
- **Wellbeing:** warnings for crunch weeks and for heavy study after a full school day.
- **Accessibility:** text size up to XL, light/dark themes, high contrast, extra spacing (can help with dyslexia), reduced motion, read-aloud, full keyboard use with a skip link and focus management, screen-reader labels, colour never the only signal, works on phones.
- **Home page:** a live preview of the real planner (drag the study-time slider and watch tasks stop fitting), plus the problem, how it works, the AI, a real before-and-after test story, and responsible design.

---

## Run it

Needs **Node.js 18 or newer**.

```bash
git clone https://github.com/hexa3/tempo.git
cd tempo
npm install
npm start          # works straight away with the offline rules, with no internet and no key
```

Open **http://localhost:3000** (home page) or **http://localhost:3000/app** (planner). It also works on a phone on the same Wi-Fi.

### Turn on the AI engines (both free)
**Local AI (private, offline):**
1. Install Ollama from https://ollama.com.
2. Run `ollama pull qwen2.5:3b` (about 2 GB).
3. Make sure Ollama is running (`ollama serve`), then `npm start`.

**Groq (fast, online):**
1. Sign up at https://console.groq.com, go to **API Keys → Create API Key**, and copy it (it starts with `gsk_`).
2. Create a file called `.env` in the `tempo` folder containing `GROQ_API_KEY=gsk_...`. The file is git-ignored, so the key is never pushed.
3. Run `npm start`.

The startup log shows ✓ or ✗ for each engine, and each ✗ line says what's missing.

> **Windows (PowerShell):** `npm start` reads `.env` automatically. To set a key for one session instead, run `$env:GROQ_API_KEY="gsk_..."; npm start`.

**Notes**
- **Local AI is slow on a CPU.** The button counts the seconds so it never looks frozen. It's capped at half the CPU cores (`OLLAMA_THREADS`), and the first request loads the model, so send one before a demo.
- **Groq's free tier allows about 8,000 tokens a minute,** roughly 3 "Understand this" requests. Beyond that, Tempo uses the offline rules for a minute and says so.
- **Change models:** `OLLAMA_MODEL`, `GROQ_MODEL` (default `openai/gpt-oss-120b`). Optional engines appear when their key is set: Gemini (`GEMINI_API_KEY`) and Claude (`ANTHROPIC_API_KEY`).

### Tests
```bash
npm test           # 22 automated tests
```

---

## Online version (Netlify)

`netlify.toml` serves `public/` as a static site and sends `/api/*` to `netlify/functions/api.js`, which runs **the same code** as `server.js`. Deploys run `npm test` first.

- **Groq works online** once `GROQ_API_KEY` is set in Netlify → Site configuration → Environment variables, followed by a redeploy. The key stays on the server and never reaches the browser.
- **Local AI is laptop-only.** A website can't reach the model on your computer, and the dropdown explains this.
- **Offline rules** always work.
- Deploy from the command line: `npx netlify-cli deploy --prod`.

---

## Testing & improvement

- **22 automated tests** (`tests/scenarios.test.js`):
  - the judges' main scenario and all 7 Stage-4 tests: change available time, urgent assignment, moved exam, incomplete info, conflicting requirements, unexpected question, new profile
  - rules every plan must follow: no day over budget, no overlap with activities, nothing outside study hours, nothing after a deadline
  - the predictor learning from logged times
  - every bug we found
- **Real-browser tests** (Playwright, run during development; the scripts aren't in this repo):
  - the full flow with Local AI and with Groq through the real interface
  - 37 navigation checks on laptop and phone (Back/Forward, shortcuts, focus, dialogs, badges, tab bar, home-page menu)
  - runs against the live site
- **9 problem → change → result stories** in [`docs/TESTING.md`](docs/TESTING.md). Examples:
  - The local 3B model got both dates wrong, gave one task another's estimate, listed an activity as homework, and invented "I only have 2 hours on weekdays". All of these are now caught by Tempo's checks (test 19).
  - On the live site, Groq once filed a new task under "changes" with a made-up ID, so the task vanished. Tempo's rules now recover dropped tasks and updates (tests 21–22).
  - Netlify's "Powered by Netlify" badge covered the Coach tab on phones. It's now moved above the tab bar.

---

## Responsible design

- **Privacy:**
  - no account, email or real name, only a nickname
  - data stays in the browser
  - the server keeps no database and never logs what students type
  - a "never send my text online" switch
  - students can download or delete their data
  - API keys stay on the server
- **Accuracy:** the AI's output is checked by code, and the student confirms every task. Guesses are highlighted, and missing details become questions.
- **Honesty:** estimates come with ranges and confidence levels, every session explains itself, and an impossible week is never hidden.
- **Academic integrity:** it refuses graded work and offers to plan it instead.
- **Wellbeing:** a low-energy check-in, crunch-week warnings, and kind replies that point to a counsellor. It is not a counsellor.
- **Inclusion:** accessibility settings, works offline (no internet or key needed), works on phones, and the weekend days can be changed.

See [`docs/RESPONSIBLE_AI.md`](docs/RESPONSIBLE_AI.md) for the full risk table.

---

## Project structure

| Path | What it does |
|---|---|
| `public/index.html`, `home.css`, `js/home.js` | Home page, with the live planner preview |
| `public/app.html`, `styles.css`, `js/app.js` | The planner: views, navigation, review step, dialogs, settings, accessibility |
| `public/js/parser.js` | Offline language understanding, plus `sanitize()`, which checks all AI output, and the rules safety net |
| `public/js/predictor.js` | Workload prediction that learns from the student's history |
| `public/js/scheduler.js` | Planning engine: sessions, spacing, buffers, deadline order, checked options, what-changed diff |
| `public/js/coach.js` | Plan summary for the AI coach, safety rules, and the offline coach |
| `public/js/dates.js`, `demo.js` | Date helpers; made-up demo profiles |
| `server.js` | Serves the app and the AI endpoints (`/api/status`, `/api/parse`, `/api/coach`), keeps keys server-side, rate-limits |
| `netlify/functions/api.js`, `netlify.toml` | The same API as a Netlify Function |
| `prompts/parse.md`, `prompts/coach.md` | The AI prompts (versioned in the development log) |
| `tests/scenarios.test.js` | 22 tests |

**Tech:** plain HTML, CSS and JavaScript with no build step. The same engine files run in the browser and in Node tests, served by a small Node server.

## Docs for the competition
- [`docs/PRESENTATION.md`](docs/PRESENTATION.md): 5-minute script, a table of what to do for each judge test, Q&A prep
- [`docs/AI_DEVELOPMENT_LOG.md`](docs/AI_DEVELOPMENT_LOG.md): design decisions, prompt versions, experiments, how AI tools were used
- [`docs/TESTING.md`](docs/TESTING.md): test stories, user-testing plan, known limitations
- [`docs/RESPONSIBLE_AI.md`](docs/RESPONSIBLE_AI.md): risks, mitigations, where a human must review
- [`docs/REPORT_OUTLINE.md`](docs/REPORT_OUTLINE.md): report structure

## Known limitations
- **Cold start:** with no history, estimates use typical times and show *low* confidence. Each subject needs about 5 logged sessions.
- **The offline parser** handles common phrasing but not everything, e.g. "the Thursday after next".
- **The plan schedules time, not quality.** It doesn't know how well you studied.
- **Single device:** data lives in one browser, a deliberate trade-off for privacy.
- **Local AI is slow** without a GPU, and Groq's free tier has a per-minute limit.
- **Not yet tested with real students.** See the user-testing plan in `docs/TESTING.md`.

## Attribution
- **Language models:** Qwen 2.5 3B (Alibaba, Apache 2.0), run locally through Ollama (MIT); gpt-oss-120b (OpenAI, Apache 2.0) through the Groq API. Optional: Google Gemini API; Anthropic Claude via `@anthropic-ai/sdk` (MIT).
- **Fonts:** Geist and Geist Mono (Vercel, SIL OFL) and Instrument Serif (SIL OFL), served from Google Fonts.
- **Research:**
  - the planning fallacy (Buehler, Griffin & Ross, 1994)
  - spaced practice (Cepeda et al., 2006)
  - effective learning techniques (Dunlosky et al., 2013)
  - Earliest-Deadline-First scheduling (Liu & Layland, 1973)
- **Testing tools:** Playwright for the browser tests.
- **Data:** all demo data is made up. No real student data is used.
- **AI coding assistants** were used during development. See `docs/AI_DEVELOPMENT_LOG.md` for how, and what the team decided.
