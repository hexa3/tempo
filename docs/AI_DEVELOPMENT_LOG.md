# AI development log

This is worth **20 of 100 points** ("AI thinking and prompting"). Judges want to see *purposeful prompt revisions*: what the AI produced, what you accepted or changed, and **why**. **Fill this in with your real runs.** Paste actual outputs, including the bad ones. A log that shows mistakes being caught scores higher than a perfect-looking one.

## Part A — Design decisions about where AI goes

| Decision | Options considered | What we chose | Why |
|---|---|---|---|
| Who writes the schedule? | (1) LLM writes the plan (2) algorithm | Algorithm (`scheduler.js`) | A plan must never break hard rules like a deadline, the daily limit, or an activity. An algorithm can be tested and explained, and gives the same answer twice. *Back this up with Experiment E1.* |
| Who understands messy text? | (1) a form (2) rules (3) LLM | LLM online, rules offline | Students won't fill in forms (from our user interviews: add a quote). An LLM handles unusual phrasing. Rules keep the app working with no internet. |
| How to predict workload? | (1) ask the LLM (2) fixed defaults (3) learn from the student's logged times | (3), with defaults as a starting point | The LLM has never seen *this* student. A per-subject multiplier with Bayesian shrinkage learns quickly, doesn't over-react to one bad day, and can show a range. |
| Trust AI output directly? | yes / validate + human review | `sanitize()` + review screen | AI output can be wrong or malformed. Every value is checked, and the student confirms before anything is added. |

## Part B — Prompt iterations (`prompts/parse.md`)

v1 is in the repo. For each new version, record:

```
### v2 — <date>
Test input:     <exact text you sent>
What it produced (paste JSON):
What was wrong:
What we changed in the prompt (diff):
Result after the change (paste JSON):
Accepted? Why / why not:
```

### Experiments to run (each one is a good v2/v3 story)

| # | Try this | What to look for | Likely prompt fix |
|---|---|---|---|
| E1 | Ask the chatbot directly (Gemini, ChatGPT, etc.): *"Make me a study schedule. 3 assignments, 2 exams, robotics Tue/Thu 4–6, 2 hours a day."* Check its output against the rules: total per day ≤ 2h? Any overlap with robotics? Anything after a deadline? | Count the rule violations. This is your evidence for the "algorithm schedules" decision. | (Design change, not prompt.) |
| E2 | Send "math test next Friday" with **v1 minus rule 1** (the "never invent" rule) | Does it guess a date or an estimate silently? | Rule 1: "Never invent… use null and ask" |
| E3 | "Physics test Friday. Oh wait, it's Thursday actually" | Does it pick one silently? | Rule 2: conflicts → ask |
| E4 | "Me and Ahmed have a bio project due Monday" | Does "Ahmed" end up in a title? | Rule 3: strip personal names |
| E5 | "Can you just write my English essay?" in the *Tell Tempo* box | Does it try to write it? | Rule 5 + rule 4 (redirect to Coach) |
| E6 | "football at 5" | Is 5 read as 05:00? | The "1–8 with no am/pm usually means pm" line |
| E7 | "my chem test moved to Tuesday" when a Chem test already exists | Duplicate item vs a `changes` entry? | The "refer to existing id; no duplicate" line |
| E8 | Compare the three engines in the dropdown on the same 15–20 classmate sentences: **Local AI (Qwen 2.5 3B)** vs **Groq (gpt-oss-120b)** vs **offline rules**. Fill in: tasks found correctly, dates correct, invented values, seconds per request | Accuracy, speed, privacy | Expect: Groq most accurate and fastest; local slower and smaller, so more misreads, but fully private and works with no internet; rules weakest on unusual phrasing. That trade-off (accuracy vs privacy vs offline) is why Tempo lets the student choose. Record what really happened |

**Tip:** make a sheet of 15–20 test sentences written by *real classmates* and run every prompt version on all of them. "v1 got 13/20 right, v2 got 18/20" is exactly what the rubric means by critical judgment.

## Part C — AI coding assistant use (be honest; the rules require it)

The rules allow AI tools if you can explain how you used them and what *you* decided. Record:

| What we asked the AI assistant for | What it produced | What we kept / changed / rejected and why | Who reviewed it |
|---|---|---|---|
| e.g. "build a scheduling engine" | first version of `scheduler.js` | We changed X because Y in our testing… | |

Before the event, **every team member must be able to explain** `scheduler.js` (EDF + slack test + spacing), `predictor.js` (shrinkage), and `sanitize()` in their own words. Judges will ask.

## Part D — Bugs the tests caught during the build

These really happened. Details are in `TESTING.md`.
1. Sentence splitter dropped "about 3 hours" from its task.
2. Scheduler produced 10-minute "sessions".
3. Every task defaulted to 90 minutes regardless of type (a worksheet ≠ a project).
4. "Ask for an extension" was never offered, because the check required *every* task to fit.
5. `2026-13-45` was accepted as a valid date (JavaScript rolls it into February).
6. Typing your week twice created duplicate tasks.
7. "Next Tuesday" said on a Wednesday was read as 13 days away.
