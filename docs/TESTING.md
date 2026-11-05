# Testing & improvement

Run `npm test`. There are 19 automated tests covering the judges' scenarios plus every bug below. Every plan is also checked against *invariants*: no day over budget, no overlap with activities, nothing outside the sleep-protecting window, nothing after its deadline.

## Problem → Test → Change → Result

Use **one** of these in the presentation and keep the others for Q&A.

### 1. The essay lost its time estimate
- **Problem:** "English essay due Wednesday, about 3 hours" → the essay was created with *no* estimate.
- **Testing:** printed the parser's clauses: `['english essay due wednesday', 'about 3 hours']`. The comma split the sentence, so "about 3 hours" became an orphan.
- **Change:** fragments with no task of their own get glued back onto the previous clause (`parser.js → clauses()`).
- **Result:** estimate = 180 min. Locked in by the test *"Parser: messy sentence → tasks…"*. "It's huge" → difficulty 4 was fixed by the same change.

### 2. Ten-minute "sessions"
- **Problem:** the plan contained blocks like *"Chemistry, Overview: 10 min"*, which are useless for studying.
- **Testing:** the smoke-test output showed chunks being cut to fill leftover minutes at the end of each day.
- **Change:** a block under 25 min is only allowed when it's urgent. Otherwise Tempo picks a different chunk that fits whole, or moves to the next free gap.
- **Result:** test *"Bug fix: no useless 10-minute slivers"* passes.

### 3. "Ask your teacher for an extension" never appeared
- **Problem:** in an overloaded week the only option offered was "do a lighter version".
- **Testing:** each option is checked by re-running the planner. The check required *every* task to fit, and in an overloaded week some other task always failed, so no extension ever "worked".
- **Change:** an option counts if *this* task now fits and *no other task gets worse*.
- **Result:** the History project gets "Ask for 2 more days (→ Sun 15 Nov)". The test also proves each offered option really works.

### 4. Impossible dates accepted
- **Problem:** the sanitizer accepted `2026-13-45` from AI output.
- **Testing:** test *"Sanitizer rejects impossible AI output"* failed. JavaScript's `Date` silently turned it into 14 Feb 2027.
- **Change:** round-trip check: a date is valid only if formatting it again gives the same string.
- **Result:** test passes. This matters because a hallucinated date would otherwise move a task silently.

### 5. Duplicate tasks
- **Problem:** typing your week again created a second "Chemistry test".
- **Change:** the review screen detects same subject + same type, explains it, and leaves the new one unticked.
- **Result:** in the UI smoke test, 3 duplicates were flagged and 0 created.

### 6. "Next Tuesday"
- **Problem:** said on a Wednesday, it resolved to 13 days later. Most people mean 6.
- **Change:** "next X" = X in the next calendar week. Because people genuinely disagree, Tempo also asks to confirm it.

### 7. The local model "quoted" things nobody said
- **Problem:** we gave the local model (qwen2.5:3b) *"chem test next friday, english essay due monday about 2 hours, robotics tue and thu 4-5:30"*. It got both dates wrong (Wed 18 and Tue 10), gave the chem test the essay's "about 2 hours", listed robotics as an activity *and* a task, and invented *"I only have 2 hours on weekdays"*.
- **Testing:** we saved the exact reply as a test (*"Sanitizer checks AI quotes…"*).
- **Change:** the model must copy the student's own words for dates and estimates, and Tempo's tested rules work out the actual dates. Then every "quote" is checked against what the student really typed. Invented quotes are dropped, a phrase used once can only belong to one task, and an activity can't also be a task.
- **Result:** Fri 13, Mon 9, the estimate stays on the essay only, robotics appears once, and the availability change isn't applied. **Lesson:** a small model is useful for reading messy text, but its output has to be checked by code you can test.

## User testing (do this with real students; it's the strongest evidence you can have)

1. Recruit 5–8 students from different grades. Get permission and record **no names**.
2. Give each one the task: *"Tell Tempo about your real week, then find out what you should do first today."* Don't help them.
3. Record: time to the first plan, where they got stuck, what they said out loud, and whether the AI misread anything.
4. Ask them to rate 1–5: *"I'd use this next week"*, *"The plan feels realistic"*, *"I understood why sessions were placed where they are"*.
5. Fix the top 1–2 issues, re-test with 2 new students, and record the before/after.

| Tester | Grade | Time to plan | Got stuck at | AI misread | Would use (1–5) | Quote |
|---|---|---|---|---|---|---|
| T1 | | | | | | |

## Known limitations (say these confidently; judges reward honesty)

- **Cold start:** with no history, estimates use typical times and are shown as low confidence. A new user needs about 5 logged sessions per subject.
- **The offline parser is rule-based:** it handles common phrasing but not everything (for example "the Thursday after next"). The online model handles more, but can still misread, which is why the review step exists.
- **The plan doesn't know quality:** it schedules time, not how well you studied. A future version could ask "how confident do you feel?" after exam sessions.
- **The plan is greedy:** EDF is optimal for meeting deadlines, but the "nice" preferences (subject switching, spacing) are heuristics, not a proven optimum.
- **Single device:** data is in the browser, so there's no phone↔laptop sync. That's deliberate for privacy, but it's a real trade-off.
- **Not tested by real students yet** ← replace this line with your results.
