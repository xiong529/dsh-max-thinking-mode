# dsh-max-thinking-mode

**最大思考模式（Max Thinking mode）** for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) — a selectable agent preset for problems without a known answer: novel features, unseen designs, and implementations you have not built before.

The mode mounts the standard toolset and adds two things:

1. a **persona prefix** that makes branch-and-bound reasoning part of the working policy — generate several candidates, simulate each forward, gather evidence over guesses, review from six perspectives, play the adversary to your own plan, backtrack freely, and only converge when every serious candidate survived review;
2. an **`isolated_review` tool** — send a proposal to one or more fresh subagents with no tools, no files, no network, and no conversation history; each re-thinks the problem from a different angle and tries to refute it, returning a structured verdict. Supports parallel cross-checks (2–3 reviewers), a second adversarial round, and a final arbiter.

> **What this mode is for**: hard, ambiguous, or easily-misjudged tasks where the first idea is often wrong. For routine fixes and familiar errors, the standard mode is faster and cheaper.
>
> **Measured**: five real tasks against the standard mode — the Max Thinking mode won the breakthrough-strength dimension every time (26 vs 17 independent breakthroughs across the five tasks) at 1.3–2× the token cost. See [docs/evaluation-results.md](docs/evaluation-results.md).

---

## Installation

The bundle is a plain Cordis bundle: one `@deepseek-ai/dsh-agent-preset` declaration plus the self-contained `isolated_review` tool package. Install it into a profile with the DSH plugin manager, or declare it in a profile's `cordis.patch.yml`.

### Prerequisites

- DeepSeek Harness with the preset roster (the web app) — `@deepseek-ai/dsh-web-app` installed, which provides the `dsh-agent-preset` registry and the standard toolset this preset composes.
- Node.js `^22.19 || >=24` and `pnpm` for building the bundled tool package.

### Option A — install via the plugin manager (recommended)

In the DSH Web UI **Plugins** page (or via the `plugin_manager` API), install this repository as a bundle:

```
plugin_manager install_bundle --target <path-to-this-repo>
```

The bundle declares the `preset-max-thinking` row. After installation the **Max Thinking** mode appears in the new-task mode picker and the Agent-preset settings roster.

### Option B — declare the bundle in a profile

Add this repository as a bundle in `$DSH_HOME/profiles/<name>/package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-headless",
        "@dsh-max-thinking/dsh-max-thinking-mode"
      ]
    }
  }
}
```

### Building the tool package

The `isolated_review` tool ships as source (`packages/tool-isolated-review`). To build its runtime bundle:

```sh
pnpm install
pnpm build
```

---

## Using the mode

1. Start a new task in the Web GUI and pick **Max Thinking** from the mode menu.
2. Describe what to accomplish, the evidence that defines success, and how to judge the result. Keep the input minimal — the mode is designed to decide its own exploration direction.
3. Expect more reasoning, more tool calls, and more tokens than the standard mode. That is the point; the mode is chosen for that cost.

The persona makes these behaviors explicit and observable:

- **Reason with the world, not just in your head**: seek prior art (web search, source, docs) before inventing from scratch; validate critical assumptions with minimal runnable prototypes; alternate thinking with cheap tool probes.
- **Breakthroughs outside the frame**: re-frame the problem, borrow across domains, vary constraints on purpose, keep several candidate framings alive, judge success by solution strength rather than code cleanliness.
- **Multi-perspective review**: user, implementer, architect, failure/edge, tester, cost — each with its bias stated, weighed against each other.
- **Adversarial self-attack**: name at least three concrete ways the plan could fail before committing.
- **Isolated review** (`isolated_review`): for significant decisions, send your proposal to tool-free reviewers who re-think from a different angle and try to refute it; the main model keeps the decision.
- **Ask before you guess**: confirm ambiguous requirements with `ask_user_question` instead of silently picking one of several readings.
- **Backtrack freely**: return to the earliest decision point where the evidence changed; keep an exploration trail so a retreat never repeats a dead end.

---

## Contents

```
presets/max-thinking.patch.yml     the agent-preset declaration (persona + standard toolset + isolated_review)
packages/tool-isolated-review/     the isolated_review tool (self-contained Cordis plugin package)
docs/evaluation-results.md         five-task measurement: Max Thinking vs standard mode
docs/evaluating-agent-preset-modes.zh.md  the evaluation protocol used
docs/max-thinking-engine-design.md a design sketch for a next-generation "thinking engine" version
```

## Design

The mode is a bundle patch only: it changes no agent-loop, guard, or runtime code. All behavior comes from the persona section the preset's `dsh-persona` row contributes, plus one additional tool. Capabilities and permission semantics otherwise match the standard preset.

- The `isolated_review` tool enforces isolation twice: the subagent provider's fresh-context semantics hide the parent conversation, and a `toolFilter` that keeps no inherited tool plus a fixed reviewer persona leave the reviewer with nothing but the passed context to reason from.
- Structured verdicts (`sound-as-is` / `sound-with-changes` / `different-approach`, with objections and the strongest weakness) make review output machine-readable and hard to hand-wave.

## License

MIT — see [LICENSE](LICENSE). The bundled tool package is adapted from `@deepseek-ai/dsh-tool-isolated-review` (MIT, part of the DeepSeek Harness project).

## Links

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Agent presets](https://github.com/deepseek-ai/deepseek-harness) → `packages/bundle/web-app/presets/` (the shipped `standard`/`ptc`/`minimal`/`cordis`/`deep-think` presets)
