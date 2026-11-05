# Tempo: an AI study planner that adapts to how you actually work

**Problem.** High-school students juggle assignments, exams and activities and plan with guesswork. They underestimate how long work takes (the "planning fallacy"), cram for exams the night before, and when a week is impossible no tool tells them. They just fall behind.

**User.** A Grade 10–12 student with 4–6 subjects, after-school activities, and about 1–3 hours a day to study. They are not organised by nature, and they won't fill in a 20-field form.

**Solution.** The student types (or says) their week the way they'd text a friend. Tempo:

1. **Understands it.** An AI model (a local model on the laptop, or Groq in the cloud; the student chooses) turns messy text into tasks, exams and activities. It asks when something is missing and never invents dates. The student reviews everything before it's added.
2. **Predicts real workload.** A learning model estimates how long each task will take *this* student, using the planned-vs-actual times they log (Bayesian shrinkage per subject). It shows a range and a confidence level.
3. **Plans the week.** A scheduling algorithm fits work around activities and sleep. It spreads exam prep over several days (spaced practice), finishes assignments a day early, switches subjects, and explains every session.
4. **Adapts.** Changes in time, a new urgent task, a moved exam date, low energy today, or a session that ran long all trigger an instant re-plan, and Tempo shows what changed.
5. **Is honest when it can't fit.** Tempo doesn't squeeze work into sleep or quietly drop it. It says "3h short" and offers options it has checked: more time, asking for an extension, or a focused version. The student chooses.
6. **Coaches.** The student can ask questions about the plan ("Why is Chem on Tuesday?", "Will I finish?"). It won't do graded work, and it points to a counselor when a student is struggling.

## Run it

Needs Node.js 18 or newer.

```bash
cd tempo
npm install
npm start                        # offline mode: works with no internet and no key
```

**The planner has four views**: *Plan* (today + the week), *Add to plan*, *Tasks & activities* and *Coach*. Use the sidebar on a laptop or the tab bar on a phone, or press 1–4 (press ? for all shortcuts). Each view has its own address (e.g. `app.html#coach`), so the browser's Back button works.

**Two AI engines, switchable in the app** (dropdown at the top left, next to the logo):

| Engine | What it is | Set up once | Privacy |
|---|---|---|---|
| **Local AI** | Qwen 2.5 3B running on this laptop through Ollama. Free, works with no internet | Install Ollama (ollama.com), then `ollama pull qwen2.5:3b` | Text never leaves the computer |
| **Groq** | gpt-oss-120b (OpenAI's open-weight model) in the cloud. Free tier, no card, very fast: about 3 s to read a week, under 1 s for a coach answer (measured) | Get a key at console.groq.com → API Keys, then put `GROQ_API_KEY=gsk_...` in a file called `.env` in this folder | Text is sent to Groq |
| **Offline rules** | Tempo's built-in rule parser and coach. No model at all | nothing | Nothing is sent |

Then just `npm start`. The startup log shows a ✓ or ✗ next to each engine, and the ✗ lines say what's missing. If Ollama isn't running, start it with `ollama serve`. If an engine fails mid-demo (no Wi-Fi, rate limit), Tempo falls back to the offline rules automatically and tells you.

- **Speed:** Groq answers in about a second. The local model runs on the CPU, so it's slow: reading a one-sentence week took **30–87 s** on our 12-thread laptop CPU, and a coach answer took about **20 s** (measured through the real UI). The button counts the seconds so it never looks frozen. For a live demo, use Groq and keep Local AI for the privacy point. It's capped at half the CPU cores (`OLLAMA_THREADS`) so the laptop stays usable. The first request after starting is slower because the model loads into memory first.
- **Why Qwen 2.5 3B?** It's small enough (about 2 GB) for a school laptop with no GPU, and it's good at producing structured JSON. Tempo also uses Ollama's schema-constrained output, so the reply is always valid JSON. Use `OLLAMA_MODEL=llama3.2:3b` (or any model you've pulled) to compare.
- **Optional extras:** Gemini (`GEMINI_API_KEY`, free tier) and Claude (`ANTHROPIC_API_KEY`, paid) also appear in the dropdown when their key is set. `GROQ_MODEL` and `GEMINI_MODEL` change the cloud model if a default has been retired.

Open http://localhost:3000 (home page) or http://localhost:3000/app.html (the planner) in Chrome, Firefox, Safari or Edge, on a laptop or a phone on the same Wi-Fi. Demo profiles load automatically.

```bash
npm test                         # 20 automated scenario tests (judge scenarios + bugs we fixed)
```

## Online version (Netlify)

`netlify.toml` serves `public/` as a static site and sends `/api/*` to `netlify/functions/api.js`, which runs the same code as `server.js`.
- **Groq works online** once you add `GROQ_API_KEY` in Netlify → Site configuration → Environment variables, then redeploy. The key stays on Netlify and is never sent to the browser.
- **Local AI doesn't work online.** It runs on your laptop, and a website can't reach that. The dropdown says so.
- **Offline rules always work,** even with no key.

## How it works

```
 student text ──► [Understand]  local LLM (Ollama) / cloud LLM (Groq) / rule engine
                       │        → sanitize() → student reviews & edits ◄── human in the loop
                       ▼
 logged times ──► [Predict]     per-subject time multiplier, Bayesian shrinkage, range + confidence
                       ▼
 time, activities ► [Plan]      chunk work → Earliest-Deadline-First with slack test,
                       │        exam spacing, buffers, interleaving, sleep window
                       ▼
                   plan + "why" for each session + warnings + checked options
                       ▼
 questions ─────► [Coach]       LLM grounded in a plan summary / offline rule coach
```

**Where we used an LLM and where we didn't.** The LLM handles *language*: messy text and open questions. The *plan* comes from a deterministic algorithm. An LLM-written schedule can look right and still break hard rules, such as overlapping an activity, going over the daily limit, or scheduling work after the deadline. An algorithm can be tested (see `tests/`), gives the same answer every time, and can explain every decision. *(Team: run this comparison yourselves. Experiment E1 in `docs/AI_DEVELOPMENT_LOG.md` sets it up. Record what really happened.)*

| File | What it does |
|---|---|
| `public/js/parser.js` | Offline language understanding, plus `sanitize()`, which checks all AI output |
| `public/js/predictor.js` | Workload prediction that learns from the student's history |
| `public/js/scheduler.js` | Planning engine: spacing, buffers, EDF, infeasibility options, what-changed diff |
| `public/js/coach.js` | Plan summary for the AI coach, plus the offline coach |
| `public/js/app.js` | Interface: review step, week view, check-ins, settings, accessibility |
| `server.js` | Serves the app, keeps the API key on the server, talks to the local model (Ollama) or Groq, chosen per request |
| `prompts/*.md` | The prompts (versioned; see `docs/AI_DEVELOPMENT_LOG.md`) |
| `tests/scenarios.test.js` | Judge scenarios + regression tests |

## Docs for the competition
- `docs/PRESENTATION.md`: 5-minute script, judge test playbook, Q&A prep
- `docs/AI_DEVELOPMENT_LOG.md`: prompt iterations, what we accepted or changed, and why
- `docs/TESTING.md`: problems found → change → result; user testing plan; known limits
- `docs/RESPONSIBLE_AI.md`: privacy, accuracy, accessibility, misuse, human review
- `docs/REPORT_OUTLINE.md`: project report structure

## Attribution
- Language models for text understanding and the coach: Qwen 2.5 3B (Alibaba, Apache 2.0) run locally through Ollama (MIT); gpt-oss-120b (OpenAI, Apache 2.0) through the Groq API. Optional: Google Gemini API; Anthropic Claude via the official `@anthropic-ai/sdk` (MIT).
- Learning-science ideas: spaced practice and retrieval practice (Dunlosky et al., 2013, *Improving Students' Learning With Effective Learning Techniques*); the planning fallacy (Buehler, Griffin & Ross, 1994).
- Earliest-Deadline-First scheduling (Liu & Layland, 1973).
- All demo data is synthetic. No real student data is used.
- AI coding assistants were used during development. See `docs/AI_DEVELOPMENT_LOG.md` for how, and what we decided ourselves.
