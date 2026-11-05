# Project report: outline (aim for 6–10 pages)

1. **Title, team, school.** List each member's contribution in 1–2 lines.
2. **Problem** (½ page): the specific problem, how you identified it (survey/interviews with real numbers and quotes), and why it matters (planning fallacy, cramming vs spacing).
3. **Target user** (½ page): a persona with needs. Show how each need → a design decision (e.g. "won't fill forms" → free-text input; "no reliable internet" → offline mode).
4. **Solution overview** (1 page): main user journey, with 3–4 screenshots.
5. **AI components** (1.5 pages):
   - Language understanding: two switchable LLMs (local Qwen 2.5 3B via Ollama, cloud Llama 3.3 70B via Groq) + schema-constrained JSON + sanitizer + rule-based fallback. Include the E8 comparison table
   - Workload prediction: per-subject multiplier, Bayesian shrinkage, range/confidence (include the formula)
   - Planning: chunking, exam spacing, buffers, EDF + slack test, interleaving, infeasibility options
   - Coach: grounded on a plan summary, with boundaries
   - *Why the schedule is an algorithm, not an LLM* (Experiment E1 results)
6. **AI development process** (1 page): prompt iterations from `AI_DEVELOPMENT_LOG.md`, what you accepted, changed or rejected, and how you used AI coding tools.
7. **Testing & improvement** (1 page): automated tests, user testing results, 2–3 problem → change → result stories.
8. **Responsible AI** (½ page): table from `RESPONSIBLE_AI.md` plus your key limitation.
9. **Limitations & future work.**
10. **References & attribution:** libraries, APIs, research papers, AI tools used.
