# Responsible & inclusive design

| Risk | What could go wrong | What Tempo does |
|---|---|---|
| **Privacy** | Student data leaked or misused | No account, no email, nickname only. Data stays in the browser's localStorage. The server keeps no database and **never logs student text** (only error codes). "Download my data" and "Delete everything" are in Settings. "Never send my text to an online AI" switch. The API key stays on the server. |
| **Free-tier data terms** | Free cloud tiers (Groq) may let the provider keep or use what's sent (check their current terms) | The student chooses the engine. **Local AI** runs on the laptop, so text never leaves the device. With Groq, only task text is sent, names are stripped by the prompt, and the server stores nothing. The "never send my text online" switch disables Groq but keeps Local AI and the offline rules. Say this to the judges. It shows you read the terms. |
| **Accuracy** | The AI misreads a date, which leads to a missed deadline | The AI never invents dates (prompt rule 1). Every AI value passes through `sanitize()`. The student reviews and edits before anything is added. Guesses are highlighted yellow and come with a question. |
| **Over-trust** | A student treats estimates as facts | Every estimate shows a range and a confidence level, plus *"It's a prediction, not a fact."* Every session explains *why* it's there. |
| **Hidden failure** | The app quietly crams or drops work when the week is impossible | Shows "Doesn't fit: 3h short" with options that have been re-planned and verified. It never schedules past the sleep window, and the student chooses the trade-off. |
| **Wellbeing** | Pushing a stressed student harder | Low-energy check-in halves today's load. Crunch-week and heavy-day warnings. The coach responds kindly to stress and points to a counselor or trusted adult. Self-harm language → stop coaching and give urgent help guidance. |
| **Academic integrity / misuse** | "Write my essay" | The coach refuses graded work and offers to plan it instead (prompt + offline rule). The parser only extracts planning data. |
| **Unnecessary data** | Collecting grades, health or location "because AI" | Not collected. Planning needs only tasks, dates and time. Personal names are stripped by the prompt. |
| **Accessibility** | Excluding students with visual, motor, reading or attention differences | Keyboard-only use, visible focus, screen-reader labels and live regions. Text size up to XL, high contrast, extra letter/line spacing (dyslexia), dark mode, reduced motion. Colour is never the only signal. Voice input 🎤 and read-aloud 🔊. Works on phones. |
| **Connectivity / cost** | Students without reliable internet are left out | Local AI works with no internet and no account. If even that is missing, the offline rule engine (parse, plan, coach) still works. Everything is free. |
| **Bias** | Defaults that fit only some students | Default times are only a starting point and are overridden by each student's own history. Weekend days and study windows are configurable (UAE Sat/Sun default). |

## Where human review is needed
1. **Every AI-extracted task** is reviewed by the student before it's added.
2. **Infeasible weeks:** the student, not the AI, picks the trade-off, and Tempo suggests talking to a teacher or counselor.
3. **Coach answers** are labelled "can make mistakes", and they're limited to the student's plan data.
4. **Wellbeing:** Tempo is not a counselor. Real support comes from people.

## Key limitation to state in the presentation
"Workload estimates are predictions. For a new user they're based on typical times, not on them, so we show a range and a confidence level, and they improve only as the student logs real times."
