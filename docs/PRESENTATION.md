# 5-minute presentation + judge playbook

> Rehearse with a timer. Each person should be able to give **every** part, because judges ask anyone anything.
> Before the event: put your free Groq key in `.env`, run `ollama serve` (if it isn't already running), then `npm start`. Check that the log shows ✓ for both Local AI and Groq. Send one request on Local AI before judging starts so the model is already loaded (the first one is slow). Click **My time & settings** → My data → "Delete everything" so the demo profiles regenerate with today's dates. Test on the venue Wi-Fi, and **also with Wi-Fi off** (offline mode is the backup).

## Script (≈ 4:40, leaving buffer)

| Time | Rubric item | Say / do |
|---|---|---|
| 0:00–0:40 | **Problem** | "Every one of us has had a week where we didn't realise it was impossible until Wednesday night. Students underestimate how long work takes; psychologists call it the *planning fallacy*. We cram for exams even though spacing study out works much better. And no app tells you *'this week doesn't fit'*, so you just fall behind." Add your own survey number here, e.g. "X of Y students we asked…" |
| 0:40–1:00 | **Target user** | "A Grade 10–12 student with 4–6 subjects, activities after school, and 1–3 hours a day. They are not someone who fills in a 20-field planner. That shaped two design decisions: you type your week the way you'd text a friend, and the app has to work out the rest." |
| 1:00–1:30 | **Solution** | "Tempo turns that message into a realistic plan, learns how long things really take *you*, and re-plans whenever life changes. When the week is impossible, it tells you and gives you options." |
| 1:30–3:30 | **Prototype + main journey** (live) | 1. Paste/say the example → **Understand this** → point out the yellow "guessed" fields and the questions: "the AI never invents a date." 2. **Add to my plan**: toast shows what changed. 3. Open a session → read the **why** ("spread over several days because spaced practice beats cramming"). 4. Mark it **Done**, set it to took 60 instead of 45 → open a Math task and show the estimate went up: "it learned I'm slow at Math." 5. Tap **😴 Low** energy → today halves and the toast says what moved. 6. Switch to **Demo: exam crunch**: the red card says it doesn't fit and offers options → click one. |
| 3:30–3:50 | **AI component** | "AI does three jobs: understanding language (a language model: show the dropdown, which switches between a private model running on this laptop and a bigger cloud model on Groq), predicting workload (a model that learns from your logged times), and adaptive planning (a scheduling algorithm). We chose *not* to let the chatbot make the schedule, because a planner must never break hard rules, and we can test an algorithm." |
| 3:50–4:20 | **Testing & improvement** | Tell ONE story from `TESTING.md`, e.g. "When we tested 'English essay due Wednesday, about 3 hours', the 3-hour estimate disappeared. The parser split the sentence at the comma. We wrote a test, changed it to glue fragments back onto the task, and now the test passes." Then name one thing that still needs work. |
| 4:20–4:40 | **Responsible AI** | "Our key limitation: estimates are predictions. They start rough, so we show a range and a confidence level, and the student always confirms. There's no account and no real name, data stays on the device, it won't write your essay, and it points you to a counselor if you're overwhelmed." |

## Judge test playbook (Stage 3 & 4)

**Stage 3 — "3 assignments, 2 exams, 2 extracurriculars, 2 hours a day."**
Profile dropdown (top right) → **+ Load demo: busy week**. That profile *is* this scenario. Or press **2** (or the **Add** tab) and type it live (more impressive): *"Math worksheet due Thursday, English essay due Monday about 2 hours, history presentation due Friday, chem test Friday, bio quiz next Tuesday. Robotics Tue and Thu 4-5:30pm, football Mon and Wed 5-6:30. I only have 2 hours a day."*

| Judge does | You do | What they should see |
|---|---|---|
| 1. Change available time | **My time & settings** → drag a weekday slider, or −30/+30 on the Plan view | Instant re-plan, toast "what changed", day loads respect the new limit |
| 2. Add an urgent assignment | **Add** tab → type "physics lab report due tomorrow, 1 hour" → Add to my plan (jumps back to Plan) | It's scheduled today, other work moves, toast lists the changes |
| 3. Change an exam date | Type "chem test moved to next wednesday", or edit the task | Shown as a *change* (no duplicate). Prep spreads over the new window |
| 4. Incomplete info | Type "I have a history essay and a math test" | Questions asked ("When is…?"), date fields highlighted, task shown under "Needs your attention" on the Tasks view and not planned; the Tasks tab shows a badge |
| 5. Conflicting requirements | Load **exam crunch**, or add an activity overlapping another | Red badge on the Plan tab, red "Doesn't fit" card with checked options; overlap warning asks which activity wins |
| 6. Unexpected question | **Coach** tab (key 4): "can you write my essay?", "I'm so stressed", "what's the capital of France?" | Integrity refusal, kind wellbeing reply with counselor, honest "I can only answer about your plan" |
| 7. New student profile | Profile → **+ New student…** | Empty, friendly start; no errors; history starts fresh (low-confidence estimates) |

**Say this when they test limits:** "Notice it says *confidence: low* here. With no history it's using typical times. After about 5 logged sessions in a subject it becomes *high*."

## Q&A prep (answer in your own words)

- **How did you identify the problem?** → your survey/interviews (do them!). Quote real students.
- **Why would a student use this instead of Google Calendar?** → A calendar stores what you tell it. Tempo works out how long things take, when to do them, and whether the week is even possible.
- **What does the AI actually do?** → three jobs (see above). Be ready to explain shrinkage: "with little data we trust the default; each logged session pulls the estimate toward what really happened."
- **What did the AI get wrong during development?** → see `AI_DEVELOPMENT_LOG.md` and give a specific example.
- **What still needs work?** → see the "Known limitations" section of `TESTING.md`.
- **What if there's no internet?** → turn Wi-Fi off, pick **Local AI**, and show it still understands text, because the model runs on the laptop. Offline rules work even without the model.
- **Why two AI engines?** → a trade-off we measured (E8): Groq is bigger and faster but sends text online. Local is private and works offline but is slower and makes more mistakes. The student decides.
- **Privacy?** → no account, nickname only, localStorage, server never stores text, download/delete in Settings.
- **Who did what?** → each person names their part and one decision they made.
