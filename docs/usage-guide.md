# Max Thinking Mode Usage Guide

This guide explains **what the mode actually does** — how each persona behavior shows up in a task, how to write task prompts, and when to choose this mode instead of the standard one.

---

## 1. The mode's behavior, end to end

The mode's persona turns the following behaviors into the working policy. You do not need to memorize them, but understanding them helps you judge "why is it so slow / why is it doing that".

### 1.1 Explore first, act later

- **Generate several candidates**: do not commit to the first idea; produce several approaches, deliberately including options beyond the first that comes to mind.
- **Simulate forward**: take each candidate to its end — the steps it would take, the results each step could produce, the failure modes it could hit, and what the final outcome would look like. Consider the plausible range of outcomes, not just the best case.
- **Evidence over guesses**: confirm assumptions with reads, searches, and small experiments. Validate critical assumptions with a minimal runnable prototype — "a five-minute experiment beats a long unverified chain of reasoning".

### 1.2 Reason with the world

- When it does not know how to do something, it **seeks prior art first** (web search, source reading, docs) before inventing from scratch.
- **Alternates thinking and tool calls**: think, gather evidence with the cheapest tool that answers the current question, think again. It never batches all reasoning up front and all tools after.

### 1.3 Breakthroughs outside the frame

When the obvious paths all fail:
- **Re-frame the problem**: question implicit constraints and say what the problem is really about;
- **Steal ideas across domains**: ask how an unrelated field solves the same shape of problem — analogy is a first-class tool;
- **Vary the constraints on purpose**: half the constraints, twice the budget, one wrong assumption removed — what would it look like?
- Keep several candidate framings alive; do not settle on the first breakthrough — the second is often cheaper and stronger.

### 1.4 Multi-perspective review and self-adversarial attack

Before acting, every serious candidate is reviewed from six perspectives, each with its bias stated:

| Perspective | Asks |
|---|---|
| User | Does it actually meet the request, and how will it feel to use? |
| Implementer | How complex is it, and how hard to maintain? |
| Architect | Does it fit the existing system and extend cleanly? |
| Failure | What are its failure modes and edge cases? |
| Tester | How would you prove it works? |
| Cost | What time, resources, and tokens does it take? |

And it plays the adversary to its own plan: names at least three concrete ways it could fail before committing; if it cannot find three, it says why.

### 1.5 Isolated adversarial review (isolated_review)

For significant decisions it calls `isolated_review` (see [isolated-review-guide.md](isolated-review-guide.md)):
- The main model authors the whole framing: task context, solution, angle, focus, question;
- Reviewers have no tools and no history; they re-think from a different angle and try to refute;
- Supports 2–3 parallel reviewers, a second adversarial round (`prior_review` + `submitter_rebuttal`), and final arbitration (`arbitrate`);
- The decision stays with the main model.

### 1.6 Ask before you guess

When the user's intent, acceptable approaches, or trade-off priorities are unclear — and inspection, search, and reasoning cannot settle them — it uses `ask_user_question` instead of deciding for the user. A wrong assumption can bias every later branch.

### 1.7 Backtrack freely

When a direction fails, contradicts the evidence, or stalls:
- Records what the dead end taught, so the next attempt does not repeat it;
- Returns to the earliest decision point where the evidence changed and picks a different branch (including options previously set aside);
- Changes the plan as often as the evidence demands, without persisting out of momentum;
- Keeps an exploration trail with todo_write.

### 1.8 Convergence condition

It keeps exploring and backtracking until **a candidate survives every perspective review with no major unresolved objection and evidence behind its key assumptions** — then converges and finishes decisively.

---

## 2. How to write task prompts

The mode decides its own exploration direction, so keep the input minimal and state what "success" means:

```
What to accomplish
What evidence defines success
How to check the result
(optional) What is out of scope / boundaries
```

**Good example**:
> Design a guest-preview feature: unauthenticated guests can preview workspace documents, but must have no write access, and must never see internal paths, IDs, or directory structure. Deliver a complete design plus a threat model. Judge the solution by its quality and breakthroughs, not code cleanliness.

**Bad example**:
> Use approach X for the guest preview; steps are 1, 2, 3… (This tells it to stop thinking and just execute.)

---

## 3. When to choose Max Thinking

| Choose Max Thinking | Choose Standard |
|---|---|
| No known answer | Routine, familiar work |
| Novel feature, unseen design | Existing clear solution |
| First instinct is likely wrong | First workable plan is enough |
| A breakthrough is the goal | Speed and cost matter more |

**Rule of thumb**: if you can say "I know how to do this", use Standard. If the answer is "I don't know, I need to think", use Max Thinking.

---

## 4. Cost expectations (honest)

- More reasoning, more tool calls, more tokens — measured at about 1.3–2× the standard mode (see [evaluation-results.md](evaluation-results.md)).
- Each `isolated_review` call spawns 1–3 fresh subagents (plus an arbiter when set), adding token cost on top.
- This is by design: the mode is chosen for that cost. If after a task it did not feel worth it, the task probably did not need this mode.

---

## 5. FAQ

**Q: It searches the web and reads source — is it going off-topic?**
No. That is "reason with the world" — seeking prior art before inventing from scratch is a core behavior.

**Q: Why does it stop and ask me?**
"Ask before you guess": your intent biases every later branch, so confirming ambiguous requirements is cheaper than guessing.

**Q: Won't isolated_review make it too slow?**
For significant decisions it is worth it. Reviewers have no tools and no history — they read only the context you pass. One review's duration scales with the context length and the reviewers' replies.

**Q: Will reviewers be too harsh on my proposal?**
Yes — that is the point. But the decision stays with the main model: it weighs the verdicts, verifies the objections, and chooses the best solution. The review is a second opinion, not a judgment.
