# `isolated_review` Tool Guide

The `isolated_review` tool is the distinguishing tool of the Max Thinking mode. It sends a proposal to one or more **isolated reviewers** — fresh subagents with no tools, no files, no network, and no conversation history — and returns their structured verdicts.

This guide explains every parameter, the three review shapes, how to write good review questions, and the cost implications.

---

## 1. What isolation means

A reviewer spawned by this tool is isolated **twice**:

1. **Fresh context**: the subagent provider (e.g. `spawn`) hides the parent conversation and all completed turns. The reviewer has never seen your reasoning.
2. **No tools**: a `toolFilter` that keeps no inherited tool, plus a fixed reviewer persona, leaves the reviewer with nothing but the context you pass it. It cannot read files, run commands, search the web, delegate, or ask the user.

So the reviewer answers **from your framing alone**. This is the point: you get an opinion that is genuinely independent of your own reasoning — but it is only as good as the context you provide.

---

## 2. Parameters

| Parameter | Required | Meaning |
|---|---|---|
| `task_context` | yes | Everything the reviewer needs to reason from: the problem, constraints, requirements, and any evidence. The reviewer has no tools, so **incomplete context is a silent failure** — include everything, nothing it does not need. |
| `proposed_solution` | yes | The final solution or plan you reached. The reviewer re-thinks the problem independently and tries to refute this proposal. |
| `alternative_angle` | optional | A different viewpoint to take, e.g. "from the perspective of minimal resource use" or "from the perspective of long-term maintenance". Omit to let the reviewer choose. |
| `review_focus` | optional | The aspects to scrutinize hardest, e.g. correctness, failure modes, maintainability, or security. Omit to review the proposal as a whole. |
| `review_question` | optional but recommended | The precise question you want answered, written for this scenario. See §4. |
| `reviewers` | optional | How many isolated reviewers to run in parallel (1–3, default 1). Each re-thinks independently and must contribute a point the others would miss. |
| `prior_review` | optional | Paste the first-round review's structured verdict to start a **second adversarial round**. Requires `submitter_rebuttal`. |
| `submitter_rebuttal` | optional | Your response to the first-round review — the objections you concede and those you reject, with reasons. Requires `prior_review`. |
| `arbitrate` | optional | When `true`, after the reviewers return, a final arbiter — equally isolated — weighs every verdict, adopts or rejects each objection with a reason, guards against groupthink, and returns the strongest next evolution of the chosen direction. |

### Reviewer output (structured verdict)

Each reviewer returns exactly these fields:

| Field | Meaning |
|---|---|
| `verdict` | `sound-as-is` (keep as is) / `sound-with-changes` (keep with changes) / `different-approach` (a different approach should win) |
| `objections` | Each item: one unsupported or risky point and why |
| `strongest_weakness` | The single most damaging flaw |
| `verdict_reason` | The reasoning behind the verdict |

### Arbiter output (when `arbitrate: true`)

| Field | Meaning |
|---|---|
| `final_verdict` | `sound-as-is` / `sound-with-changes` / `different-approach` |
| `decision` | The direction you should take |
| `accepted_objections` | Objections you must address |
| `rejected_objections` | Objections the arbiter rejects, with reasons |
| `evolution` | The strongest next step that would improve the direction (empty when already sound) |

---

## 3. The three review shapes

### Shape 1 — single review (default)

```
task_context + proposed_solution (+ angle / focus / question)
        └─▶ 1..3 isolated reviewers ──▶ structured verdicts
```

Use for: a design trade-off, an unfamiliar implementation, a choice between approaches.

### Shape 2 — second adversarial round

```
first review verdict  (prior_review)
        +
your rebuttal        (submitter_rebuttal)
        └─▶ reviewer re-evaluates honestly:
             concede what you answered, press what you evaded
             ──▶ final verdict in the same structured fields
```

Use for: when the first verdict challenges your plan and you want to respond, not just accept or ignore.

### Shape 3 — arbitration

```
reviewer verdicts (1..3)
        └─▶ final arbiter (equally isolated)
             adopt/reject each objection with a reason
             guard against groupthink
             ──▶ final verdict + evolution direction
```

Use for: the final call on a large decision where you want the objections weighed against each other before committing.

---

## 4. How to write a good `review_question`

The question is yours to author — choose it to fit the scenario. The persona suggests these mappings:

| Scenario | Question that fits |
|---|---|
| Design trade-off | "Is this proposal the right fit and risk for the constraints?" |
| Unfamiliar implementation | "What would make this fail in production?" |
| Choice between approaches | "Which one survives the strongest objections?" |
| Ambiguous requirement | "What does this plan assume, and does that assumption hold?" |

A good question is precise and answerable from the context alone. A vague question yields a vague verdict.

---

## 5. When to use it (and when not)

**Use it** for significant decisions: a design with high change cost, an unfamiliar implementation, a choice that is hard to reverse, an ambiguous requirement that biases later branches.

**Do not use it** for: routine fixes, trivial choices, or anything where the cost of the review (fresh subagents + tokens) exceeds the value of the second opinion.

The mode's persona only invokes `isolated_review` for significant decisions; the decision to call it stays with the model, and the decision after the review stays with the model too.

---

## 6. Cost and token behavior

- Each call spawns 1–3 fresh subagents (plus one arbiter if `arbitrate` is set), each reading the passed context and producing one reply. The child system prompt is minimal (identity plus reviewer persona, no tool sections).
- Cost scales with the length of `task_context` and the reviewers' replies.
- The child is a fresh session and does not reuse the parent's prompt prefix, so **KV cache is not shared** with the parent; the parent's log gains the tool call and its results as ordinary events.
- Parallel reviewers (2–3) run concurrently — the token cost is the sum of all reviewer runs.

---

## 7. Limitations (be honest with yourself)

- **The reviewer cannot verify anything.** It reasons only from the context you pass. If a claim depends on the repository, the code, or an external fact, pass the evidence yourself — and verify the reviewer's objections against reality before acting.
- **The framing is yours.** The reviewer answers from the angle and question you choose. A biased or incomplete `task_context` produces a review biased in the same direction. If you suspect your own framing, ask for a deliberately different angle (`alternative_angle`).
- **One synchronous review per call.** There is no background/continuable mode yet: you cannot steer a reviewer through follow-up questions in the same call. The second adversarial round (`prior_review` + `submitter_rebuttal`) is the provided way to iterate.
