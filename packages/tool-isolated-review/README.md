---
description: "Model-facing isolated review tool for users and maintainers composing the deep-think preset: sends a proposal to a tool-free reviewer that re-thinks it from a different angle and tries to refute it."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-isolated-review

English | [中文](README.zh.md)

## Summary

Use this package to give an agent an `isolated_review` tool. The main model passes the necessary task context plus its proposed solution; the tool spawns one or more fresh subagents with **no tools, no files, no network, and no conversation history**, asks each to re-think the problem from a different angle, contribute a point the others would miss, and refute the proposal, and returns each reviewer's structured verdict (`sound-as-is`, `sound-with-changes`, or `different-approach`, with objections and the strongest weakness) to the main model. The tool supports parallel reviewers (up to three) for cross-checks, a second adversarial round (`prior_review` + `submitter_rebuttal`), and a final arbiter (`arbitrate`) that adopts or rejects each objection with a reason, guards against groupthink, and returns the strongest next evolution of the chosen direction. The main model keeps authority over the final decision: it weighs the verdicts and objections and chooses the best solution.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the subagent service, a fresh-context backend such as the in-process spawn provider, and this tool; then name the provider. The tool exists exactly while its provider does, so sibling load order and provider reloads never strand it.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-subagent'
- name: '@deepseek-ai/dsh-subagent-spawn-in-process'
- name: '@deepseek-ai/dsh-tool-isolated-review'
  config:
    provider: spawn
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required | Provider name on `ctx.subagents` that spawns a fresh-context child (e.g. `spawn`) |
| `toolName` | `isolated_review` | Model-facing tool name; distinct for every loaded instance |
| `persona` | fixed reviewer identity | Per-reviewer persona shadowing the deployment persona |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-isolated-review) is the exhaustive source for every accepted field and its JSDoc.

### What the model passes

The tool schema exposes `task_context` (the necessary context the reviewer must reason from — it has no tools, so the context must be complete), `proposed_solution` (the main model's final solution or plan), and optional `alternative_angle`, `review_focus`, `review_question`, `reviewers` (1–3), `prior_review` plus `submitter_rebuttal` (a second adversarial round), and `arbitrate` (a final arbiter). The main model authors the whole framing — what each reviewer sees, the angle it takes, and the precise question it must answer — and chooses the question to fit the scenario (a design trade-off, an unfamiliar implementation, or a choice between approaches each call for different questions). Every reviewer must contribute at least one point the others would miss; the arbiter adopts or rejects each objection, guards against groupthink, and returns an evolution direction. The reviewer and arbiter replies are structured; the main model keeps the decision.

### Isolation contract

The reviewer is isolated twice over. The fresh-context provider hides the parent conversation and completed turns, and the tool applies a `toolFilter` that keeps no inherited tool plus a fixed reviewer persona, so the reviewer's prompt contains nothing but the passed context. It cannot read files, run commands, search the web, or delegate, and it cannot ask the user; it reasons from the given context alone.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers one `defineTool` and mirrors the provider lifecycle: the tool mounts when the named provider registers and unmounts when it leaves. A provider without the `toolFilter` or `persona` capability is rejected at mount — the isolation contract cannot degrade silently. Each call composes the reviewer prompt from the model's arguments, starts a foreground one-shot run through `ctx.subagents.start` with `toolFilter: { allow: [] }` and the reviewer persona, waits for the terminal result, disposes the run, and returns the reviewer's text as `{ review }`. Non-`completed` stop reasons map to an error result that preserves the reviewer's partial output and provider diagnostics, and the tool signal is the provider's cancellation channel.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Subagent seam](../subagent/README.md) — one-shot and continuable child delegation.
- [Agent](../../core/agent/README.md) — Session runtime.
- [Tools](../../core/tools/README.md) — tool registration and execution.

<a id="model-experience"></a>
## Model Experience

### What the model sees

One extra tool in the mounted preset's catalog: `isolated_review`, described in model-visible terms (send a proposal to an isolated reviewer for an independent, adversarial second opinion). The tool result is the reviewer's reply text; the model must weigh it and decide.

### Token effect

Each call spawns one fresh child that reads the passed context and produces one reply; the child's system prompt is minimal (identity plus reviewer persona, no tool sections). Cost scales with the passed context and the reviewer's reply.

### KV Cache effect

The child is a fresh session and does not reuse the parent's prompt prefix; the parent's log gains the tool call and result as ordinary events.

## Known Limitations and Deferred Work

- The reviewer reasons only from the passed context: it cannot verify claims against the repository, so the main model should pass evidence it needs and verify the reviewer's objections before acting.
- Deferred: a background/continuable review mode (multiple reviewers in parallel, or steering a reviewer through follow-up questions) is not provided; each call is one synchronous review.
- No runtime invariant companion is published. This plugin registers one tool and holds no independently observable runtime state; the owned relationship (the tool's provider lifecycle) is registry-disposed with the fiber and exercised by the package's REAL-composition tests.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
